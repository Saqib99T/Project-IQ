"""
Admin API Module
Flask API for admin dashboard operations, analytics, and static file serving.
Consolidated server running on port 8181.
Extensible for any plugin modules like Firecrawl, Airbyte...
"""

import eventlet
import eventlet.tpool
eventlet.monkey_patch()
# Make psycopg2 cooperative under eventlet — without this, every DB query BLOCKS
# the single eventlet hub, so Socket.IO events (handoff queue updates,
# handoff_assigned, operator↔user message relay) fire seconds late and the bot
# replies in the gap. patch_psycopg() lets DB calls yield so emits are real-time.
try:
    from psycogreen.eventlet import patch_psycopg
    patch_psycopg()
    print("[eventlet] psycopg2 patched green — DB calls won't block the hub", flush=True)
except Exception as _pg_e:
    print(f"[eventlet] WARNING: psycogreen unavailable ({_pg_e}); DB calls may block Socket.IO", flush=True)

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
import json
import sys
import os
import asyncio
from typing import Optional


# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from common.conversation_db import (
    get_themes, get_theme, create_theme, update_theme, delete_theme,
    get_default_theme, get_app_list, get_chat_app, create_chat_app, update_chat_app, delete_chat_app,
    _get_connection, _release_connection
)
from common.analytics_store import get_analytics_summary, get_recent_conversations
from common.config_manager import get_all_config as get_file_config, set_all_config as save_file_config, get_profile, get_rasa_config
from web.api.studio_service import studio_service

# Static files directories
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'public')
WIDGET_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'dist-widget')

# Service URLs from profile config (resolved once at startup)
_rasa_cfg = get_rasa_config()
RASA_URL = _rasa_cfg['api_url'].rstrip('/')
ACTION_URL = _rasa_cfg['action_url']

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'projectiq-iam-pkce-secret-change-in-prod')
CORS(app)

# Populate shared.py with runtime values so blueprints can import them
import web.api.shared as _shared
_shared.configure(
    rasa_url=RASA_URL,
    action_url=ACTION_URL,
    static_dir=STATIC_DIR,
    widget_dir=WIDGET_DIR,
)

# ── Socket.IO initialisation ─────────────────────────────────────────────────
# Deferred until config is available; re-initialised in _init_socketio().
# socketio is a module-level singleton used everywhere.
_socketio_instance: Optional['SocketIO'] = None

def _get_socketio() -> 'SocketIO':
    """Return the SocketIO singleton, initialising lazily if needed."""
    global _socketio_instance
    if _socketio_instance is None:
        _init_socketio()
    return _socketio_instance  # type: ignore[return-value]

def _init_socketio():
    """Initialise SocketIO using config values (called at first use or startup)."""
    global _socketio_instance
    try:
        from common.config_manager import get_handoff_config
        _hcfg = get_handoff_config()
        _cors_origins = _hcfg.get('socketio_cors_allowed_origins', '*')
        _async_mode   = _hcfg.get('socketio_async_mode', 'eventlet')
        _ping_timeout  = int(_hcfg.get('socketio_ping_timeout', 60))
        _ping_interval = int(_hcfg.get('socketio_ping_interval', 25))
    except Exception:
        _cors_origins = '*'
        _async_mode   = 'eventlet'
        _ping_timeout  = 60
        _ping_interval = 25

    # Redis message bus — enables Socket.IO events to work across Gunicorn workers.
    # Only activated when redis_enabled=true in config. Falls back to in-process
    # (single-worker) mode silently if Redis is not configured or unreachable.
    _message_queue = None
    try:
        from common.config_manager import get_all_config as _gcfg
        _rcfg = _gcfg().get('REDIS', {})
        if str(_rcfg.get('redis_enabled', 'false')).lower() in ('true', '1', 'yes'):
            _host = _rcfg.get('redis_host', 'localhost')
            _port = _rcfg.get('redis_port', 6379)
            _db   = _rcfg.get('redis_db', 0)
            _pw   = _rcfg.get('redis_password') or ''
            _auth = f':{_pw}@' if _pw else ''
            _message_queue = f'redis://{_auth}{_host}:{_port}/{_db}'
            print(f'[SocketIO] Using Redis message bus: redis://{_host}:{_port}/{_db}')
    except Exception as _mq_err:
        print(f'[SocketIO] Redis bus unavailable, using in-process mode. ({_mq_err})')

    _socketio_instance = SocketIO(
        app,
        cors_allowed_origins=_cors_origins,
        async_mode=_async_mode,
        ping_timeout=_ping_timeout,
        ping_interval=_ping_interval,
        message_queue=_message_queue,
        logger=False,
        engineio_logger=False,
    )
    # Sync the shared.sio instance so blueprints use the same SocketIO object
    _shared.sio = _socketio_instance

# Initialise eagerly so background threads can use it before first request
_init_socketio()

# ── Room naming helpers ──────────────────────────────────────────────────────
# user:{sender_id}          — user's browser tab
# operator:{operator_id}    — operator dashboard tab
# admin_live                — admin live-monitor overview
# admin_watch:{conv_id}     — admin deep-watching a single conversation
# queue_overview            — lightweight overview pushed to all operator tabs

def _room_user(sender_id: str) -> str:
    return f"user:{sender_id}"

def _room_operator(op_id) -> str:
    return f"operator:{op_id}"

def _room_admin_watch(conv_id) -> str:
    return f"admin_watch:{conv_id}"


# Simple KB cache for admin panel
class AdminKBCache:
    """Lightweight KB cache for admin panel - loads articles at startup.

    Sources from itsm-service (via the KB bot service account) when configured,
    falling back to the legacy GLPI KB otherwise.
    """
    def __init__(self):
        self.articles = []
        self.last_update = None
        self.is_loading = False
        self.source = "itsm"

    def load_articles(self):
        """Load articles, preferring itsm-service over the legacy GLPI KB."""
        if self.is_loading:
            return False

        self.is_loading = True
        try:
            # Prefer the live itsm-service KB (KB bot service account). When that
            # token isn't configured, fall back to the LOCAL kb_articles mirror
            # (populated by kb_sync from itsm) so the admin KB page still shows data.
            if self._load_from_itsm():
                return True
            return self._load_from_db()
        finally:
            self.is_loading = False

    def _load_from_db(self):
        """Fallback: load articles from the local kb_articles mirror."""
        try:
            from common.conversation_db import _get_connection, _release_connection
            from psycopg2.extras import RealDictCursor
            from datetime import datetime
            conn = _get_connection()
            try:
                cur = conn.cursor(cursor_factory=RealDictCursor)
                cur.execute("SELECT id, title, content, question, category, updated_at "
                            "FROM kb_articles ORDER BY title")
                rows = cur.fetchall()
            finally:
                conn.rollback()
                _release_connection(conn)
            transformed = []
            for r in rows:
                body = r.get('content') or ''
                transformed.append({
                    "id": f"local_{r['id']}",
                    "title": r.get('title') or 'Untitled',
                    "category": r.get('category') or 'general',
                    "source": "local",
                    "glpi_id": None,
                    "itsm_id": None,
                    "is_faq": False,
                    "date_modified": r['updated_at'].isoformat() if r.get('updated_at') else '',
                    "question": r.get('question') or '',
                    "answer": (body[:200] + '...') if body else '',
                })
            self.articles = transformed
            self.last_update = datetime.now().isoformat()
            self.source = "local-mirror"
            print(f"[Admin KB Cache] Loaded {len(transformed)} articles from local kb_articles mirror")
            return True
        except Exception as e:
            print(f"[Admin KB Cache] local kb_articles load failed: {e}")
            return False

    def _load_from_itsm(self):
        """Load articles from itsm-service as the KB bot. Returns False to fall back."""
        try:
            from common.iam_service import get_kb_bot_token
            from common.config_manager import get_itsm_config
            from action_server.actions.itsm_service import ITSMService
            from datetime import datetime

            token = get_kb_bot_token()
            if not token:
                return False

            async def _fetch_articles():
                itsm = ITSMService(get_itsm_config()['service_url'])
                spaces = await itsm.list_kb_spaces(token)
                if not spaces:
                    return []
                articles = []
                seen_ids = set()
                for space in spaces:
                    slug = space.get('slug')
                    if not slug:
                        continue
                    cursor = None
                    while True:
                        params = [("limit", "100"), ("status", "published")]
                        if cursor:
                            params.append(("cursor", cursor))
                        result = await itsm._request(
                            "GET", f"/api/v1/kb/spaces/{slug}/articles", token, params=params
                        )
                        if not result:
                            break
                        items = result.get("items", []) if isinstance(result, dict) else result
                        for article in items:
                            if article.get("id") in seen_ids:
                                continue
                            seen_ids.add(article.get("id"))
                            articles.append(article)
                        cursor = result.get("next_cursor") if isinstance(result, dict) else None
                        if not cursor or not items:
                            break
                return articles

            itsm_articles = eventlet.tpool.execute(asyncio.run, _fetch_articles())
            if not itsm_articles:
                return False

            transformed = []
            for article in itsm_articles:
                body = article.get('body') or ''
                transformed.append({
                    "id": f"itsm_{article['id']}",
                    "title": article.get('title', 'Untitled'),
                    "category": "general",
                    "source": "itsm",
                    "glpi_id": None,
                    "itsm_id": article.get('id'),
                    "is_faq": False,
                    "date_modified": article.get('updated_at', ''),
                    "question": article.get('excerpt', ''),
                    "answer": body[:200] + '...' if body else ''
                })

            self.articles = transformed
            self.last_update = datetime.now().isoformat()
            self.source = "itsm"
            print(f"[Admin KB Cache] Loaded {len(transformed)} articles from itsm-service")
            return True
        except Exception as e:
            print(f"[Admin KB Cache] itsm-service KB load failed: {e}")
            return False


    def get_status(self):
        """Get cache status."""
        return {
            "article_count": len(self.articles),
            "last_refresh": self.last_update,
            "source": self.source,
            "glpi_connected": True
        }

    def get_articles(self, page=1, limit=50, search_filter=""):
        """Get paginated articles."""
        filtered = self.articles

        if search_filter:
            search_filter = search_filter.lower()
            filtered = [
                article for article in self.articles
                if search_filter in article.get('title', '').lower() or
                   search_filter in article.get('question', '').lower()
            ]

        total_count = len(filtered)
        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        paginated = filtered[start_idx:end_idx]
        total_pages = (total_count + limit - 1) // limit if limit > 0 else 0

        return {
            "articles": paginated,
            "count": len(paginated),
            "total": total_count,
            "page": page,
            "total_pages": total_pages,
            "limit": limit
        }

# Initialize KB cache
admin_kb_cache = AdminKBCache()

# Load articles at startup in background
import threading
def load_kb_at_startup():
    import time
    time.sleep(2)  # Wait for server to start
    print("[Admin KB Cache] Loading articles from Project IQ at startup...")
    admin_kb_cache.load_articles()

threading.Thread(target=load_kb_at_startup, daemon=True).start()


@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


# Serve static files - Flask handles /static/* automatically via static_folder

# ── Clean URLs (canonical) ────────────────────────────────────────────────────

# ── Phase 3: Socket.IO events + background workers ───────────────────────────
from web.api.impl.socketio_events import register_sio_events, start_background_workers

_sio = _get_socketio()
register_sio_events(_sio)
start_background_workers()


# ── Blueprint registration (Phase 2.1 — activate when ready) ─────────────────
# To activate:
#   1. Uncomment the register_blueprints(app) call below.
#   2. For each route now in a blueprint, remove its @app.route decorator here.
#      Flask raises a duplicate-endpoint error if both are active.
#   3. Restart the server and verify all routes respond correctly.
#
# The blueprint files are in admin/api/blueprints/. Activation guide:
#   admin/api/blueprints/register.py
#
from web.api.blueprints.register import register_blueprints
register_blueprints(app)


if __name__ == '__main__':
    import os as _os
    _port = int(_os.environ.get('ADMIN_PORT', 8181))
    print(f"Starting Unified Server on port {_port}...")
    print(f"Admin files from: {STATIC_DIR}")
    print(f"Widget files from: {WIDGET_DIR}")
    print(f"  Admin Dashboard:        http://<YOUR_IP>:{_port}/admin")
    print(f"  Chat Widget (IT):       http://<YOUR_IP>:{_port}/")
    print(f"  Operator Console:       http://<YOUR_IP>:{_port}/operator")
    print(f"  Chat Widget (ACC):      http://<YOUR_IP>:{_port}/acc.html")
    # Use socketio.run instead of app.run so eventlet serves WebSocket upgrades
    _sio.run(app, host='0.0.0.0', port=_port, allow_unsafe_werkzeug=True)
