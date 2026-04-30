

# --- Eventlet monkey patch must be first ---
import eventlet
eventlet.monkey_patch()

import re
import json
import asyncio
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
from action_server.actions.glpi_service import GlpiService
from typing import Optional

"""
Admin API Module
Flask API for admin dashboard operations, analytics, and static file serving.
Consolidated server running on port 8181.
Extensible for any plugin modules like Firecrawl, Airbyte...
"""
"""
Admin API Module
Flask API for admin dashboard operations, analytics, and static file serving.
Consolidated server running on port 8181.
Extensible for any plugin modules like Firecrawl, Airbyte...
"""

import eventlet
import eventlet.tpool
eventlet.monkey_patch()

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room, rooms
import sys
import os


# --- GLPI KB Cleanup Endpoint ---
# The app instance must be defined before using @app.route

# ...existing code...

# Place this after app = Flask(...) and CORS(app)

from common.conversation_db import (
    get_themes, get_theme, create_theme, update_theme, delete_theme,
    get_default_theme, get_app_list, get_chat_app, create_chat_app, update_chat_app, delete_chat_app,
    _get_connection, _release_connection
)
from common.analytics_store import get_analytics_summary, get_recent_conversations
from common.config_manager import get_all_config as get_file_config, set_all_config as save_file_config, get_profile, get_rasa_config
from admin.api.studio_service import studio_service

# Static files directories
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'public')
WIDGET_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'ui', 'dist-widget')

# Service URLs from profile config (resolved once at startup)
_rasa_cfg = get_rasa_config()
RASA_URL = _rasa_cfg['api_url'].rstrip('/')
ACTION_URL = _rasa_cfg['action_url']

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
CORS(app)

# --- GLPI KB Cleanup Endpoint ---
@app.route('/admin/api/glpi_kb_cleanup', methods=['POST'])
def glpi_kb_cleanup():
    """Trigger GLPI KB cleanup: replace all 'glpi' with '' in KB articles."""
    from common.config_manager import get_glpi_config

    glpi_config = get_glpi_config()
    api_uri = glpi_config.get('api_url')
    app_token = glpi_config.get('app_token')
    user_token = glpi_config.get('user_token')
    if not (api_uri and app_token and user_token):
        return jsonify({"success": False, "error": "Missing GLPI config."}), 500

    glpi = GlpiService(api_uri, app_token, user_token)
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        session_token = loop.run_until_complete(glpi.init_session())
        if not session_token:
            return jsonify({"success": False, "error": "GLPI authentication failed."}), 500
        updated_count = loop.run_until_complete(glpi.remove_glpi_from_kb(session_token))
        return jsonify({"success": True, "updated_count": updated_count})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

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

    _socketio_instance = SocketIO(
        app,
        cors_allowed_origins=_cors_origins,
        async_mode=_async_mode,
        ping_timeout=_ping_timeout,
        ping_interval=_ping_interval,
        logger=False,
        engineio_logger=False,
    )

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
    """Lightweight KB cache for admin panel - loads GLPI articles at startup."""
    def __init__(self):
        self.articles = []
        self.last_update = None
        self.is_loading = False

    def load_articles(self):
        """Load articles from GLPI KB."""
        if self.is_loading:
            return False

        self.is_loading = True
        try:
            from action_server.actions.glpi_service import GlpiService
            from common.config_manager import get_glpi_config
            from datetime import datetime

            glpi_config = get_glpi_config()
            glpi_service = GlpiService(
                api_uri=glpi_config['api_url'],
                app_token=glpi_config['app_token'],
                user_token=glpi_config['user_token']
            )

            async def _fetch_articles():
                session_token = await glpi_service.init_session()
                if not session_token:
                    print("[Admin KB Cache] Failed to connect to Project IQ")
                    return None
                
                try:
                    return await glpi_service.get_all_knowbase_items(session_token)
                finally:
                    await glpi_service.kill_session(session_token)

            glpi_articles = asyncio.run(_fetch_articles())
            if glpi_articles is None:
                return False

            # Transform to simplified format
            transformed = []
            for article in glpi_articles:
                full_answer = article.get('answer', '') or ''
                transformed.append({
                    "id": f"glpi_{article['id']}",
                    "title": article.get('name', 'Untitled'),
                    "category": article.get('category', 'General') or 'General',
                    "source": "glpi",
                    "glpi_id": article['id'],
                    "is_faq": article.get('is_faq', 0) == 1,
                    "date_modified": article.get('date_mod', ''),
                    "question": article.get('question', ''),
                    "content": full_answer,
                    "answer": full_answer[:200] + '...' if len(full_answer) > 200 else full_answer,
                })

            self.articles = transformed
            self.last_update = datetime.now().isoformat()
            print(f"[Admin KB Cache] Loaded {len(transformed)} articles from Project IQ")
            return True



        except Exception as e:
            log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
            os.makedirs(log_dir, exist_ok=True)
            debug_log = os.path.join(log_dir, "admin_kb_debug.log")
            with open(debug_log, "w") as f:
                f.write(f"Error loading articles: {e}\n")
                import traceback
                f.write(traceback.format_exc())
            print(f"[Admin KB Cache] Error loading articles: {e}")
            return False
        finally:
            self.is_loading = False

    def get_status(self):
        """Get cache status."""
        return {
            "article_count": len(self.articles),
            "last_refresh": self.last_update,
            "source": "glpi",
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
@app.route('/')
def serve_index():
    return send_from_directory(WIDGET_DIR, 'it.html')

@app.route('/bot')
def serve_bot():
    return send_from_directory(WIDGET_DIR, 'it.html')

@app.route('/opt')
def serve_opt():
    resp = send_from_directory(STATIC_DIR, 'operator.html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/admin')
def serve_admin():
    return send_from_directory(STATIC_DIR, 'admin.html')

@app.route('/operator')
def serve_operator():
    resp = send_from_directory(STATIC_DIR, 'operator.html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

# ── Legacy .html aliases (kept for backwards compatibility) ───────────────────
@app.route('/admin.html')
def serve_admin_html():
    return send_from_directory(STATIC_DIR, 'admin.html')

@app.route('/operator.html')
def serve_operator_html():
    resp = send_from_directory(STATIC_DIR, 'operator.html')
    resp.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/it.html')
def serve_it_widget():
    return send_from_directory(WIDGET_DIR, 'it.html')

@app.route('/inspector.html')
def serve_inspector():
    return send_from_directory(STATIC_DIR, 'inspector.html')

@app.route('/analytics.html')
def serve_analytics():
    return send_from_directory(STATIC_DIR, 'analytics.html')

@app.route('/overview')
def serve_overview():
    docs_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', 'docs')
    return send_from_directory(os.path.abspath(docs_dir), 'ProjectIQ-Overview.html')

@app.route('/glpi-chat-widget.js')
def serve_widget_js():
    return send_from_directory(WIDGET_DIR, 'glpi-chat-widget.js')

@app.route('/acc.html')
def serve_acc_widget():
    return send_from_directory(WIDGET_DIR, 'acc.html')

@app.route('/modern-web-interface.css')
def serve_widget_css():
    return send_from_directory(WIDGET_DIR, 'modern-web-interface.css')

@app.route('/<path:filename>')
def serve_widget_assets(filename):
    """Fallback route for widget assets - try widget dir if not in public"""
    import os
    # First try public directory (admin panel)
    public_path = os.path.join(STATIC_DIR, filename)
    if os.path.exists(public_path):
        return send_from_directory(STATIC_DIR, filename)
    # Then try widget directory
    widget_path = os.path.join(WIDGET_DIR, filename)
    if os.path.exists(widget_path):
        return send_from_directory(WIDGET_DIR, filename)
    # Not found in either
    return "File not found", 404

# Default configuration keys
DEFAULT_CONFIG_KEYS = [
    'GLPI_API_URL',
    'GLPI_APP_TOKEN',
    'GLPI_USER_TOKEN',
    'RASA_API_URL',
    'DB_HOST',
    'DB_PORT',
    'DB_NAME',
    'DB_USER',
    'DB_PASSWORD',
    'WIDGET_TITLE',
    'WIDGET_SUBTITLE',
    'FIRECRAWL_API_KEY',
    'FIRECRAWL_API_URL',
    'SESSION_TIMEOUT_MINUTES',
]


@app.route('/admin/profile', methods=['GET'])
def get_active_profile():
    """Get the active profile name (local or prod)."""
    profile = get_profile()
    return jsonify({"success": True, "profile": profile, "is_prod": profile == "prod"})


@app.route('/admin/config', methods=['GET'])
def get_all_config():
    """Get all configuration values from app.config file."""
    try:
        config = get_file_config()
        # Ensure all default keys exist
        for key in DEFAULT_CONFIG_KEYS:
            if key not in config:
                config[key] = ''
        config['_profile'] = get_profile()
        return jsonify({"success": True, "config": config})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/config', methods=['POST'])
def save_config():
    """Save configuration values to app.config file."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400
        
        save_file_config(data)
        return jsonify({"success": True, "message": "Configuration saved to app.config"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/config/<key>', methods=['GET'])
def get_config_key(key):
    """Get a specific configuration value from app.config file."""
    try:
        config = get_file_config()
        return jsonify({"success": True, "value": config.get(key, '')})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/config/<key>', methods=['POST'])
def set_config_key(key):
    """Set a specific configuration value in app.config file."""
    try:
        data = request.get_json()
        value = data.get('value', '')
        save_file_config({key: value})
        return jsonify({"success": True, "message": f"{key} saved to app.config"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# =====================
# THEMES ENDPOINTS
# =====================

@app.route('/admin/themes', methods=['GET'])
def list_themes():
    """Get all themes."""
    try:
        themes = get_themes()
        # Parse settings JSON for each theme
        for theme in themes:
            if theme.get('settings'):
                try:
                    theme['settings'] = json.loads(theme['settings'])
                except:
                    pass
        return jsonify({"success": True, "themes": themes})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/themes', methods=['POST'])
def add_theme():
    """Create a new theme."""
    try:
        data = request.get_json()
        name = data.get('name', 'Untitled Theme')
        settings = data.get('settings', {})
        is_default = data.get('is_default', False)
        
        # Convert settings to JSON string
        settings_json = json.dumps(settings) if isinstance(settings, dict) else settings
        
        theme_id = create_theme(name, settings_json, is_default)
        return jsonify({"success": True, "theme_id": theme_id, "message": "Theme created"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/themes/<int:theme_id>', methods=['GET'])
def get_theme_by_id(theme_id):
    """Get a specific theme."""
    try:
        theme = get_theme(theme_id)
        if not theme:
            return jsonify({"success": False, "error": "Theme not found"}), 404
        
        # Parse settings JSON
        if theme.get('settings'):
            try:
                theme['settings'] = json.loads(theme['settings'])
            except:
                pass
        
        return jsonify({"success": True, "theme": theme})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/themes/<int:theme_id>', methods=['PUT'])
def modify_theme(theme_id):
    """Update a theme."""
    try:
        data = request.get_json()
        name = data.get('name')
        settings = data.get('settings')
        is_default = data.get('is_default')
        
        # Convert settings to JSON string if provided
        settings_json = None
        if settings is not None:
            settings_json = json.dumps(settings) if isinstance(settings, dict) else settings
        
        update_theme(theme_id, name, settings_json, is_default)
        return jsonify({"success": True, "message": "Theme updated"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/themes/<int:theme_id>', methods=['DELETE'])
def remove_theme(theme_id):
    """Delete a theme."""
    try:
        delete_theme(theme_id)
        return jsonify({"success": True, "message": "Theme deleted"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/themes/default', methods=['GET'])
def get_default():
    """Get the default theme."""
    try:
        theme = get_default_theme()
        if theme and theme.get('settings'):
            try:
                theme['settings'] = json.loads(theme['settings'])
            except:
                pass
        return jsonify({"success": True, "theme": theme})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# =====================
# ANALYTICS ENDPOINTS
# =====================

@app.route('/api/status', methods=['GET'])
def system_status():
    """System status dashboard — Python-native checks, safe under eventlet."""
    import socket, re, os, glob, urllib.request, urllib.error
    from datetime import datetime

    def _tpool(fn, *args, **kwargs):
        """Run a blocking call in a real thread (safe under eventlet monkey-patch)."""
        try:
            return eventlet.tpool.execute(fn, *args, **kwargs)
        except Exception:
            return None

    def _shell(cmd, timeout=5):
        """Run a shell command in a real thread to avoid eventlet blocking."""
        import subprocess
        def _run():
            try:
                r = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, timeout=timeout)
                return r.stdout.decode('utf-8', errors='replace').strip()
            except Exception:
                return ''
        return _tpool(_run) or ''

    # ── Ports — read /proc/net/tcp[6] directly (no subprocess, no socket) ──
    _listening_ports = set()
    try:
        for path in ('/proc/net/tcp', '/proc/net/tcp6'):
            try:
                with open(path) as f:
                    for line in f.readlines()[1:]:
                        parts = line.split()
                        if len(parts) >= 4 and parts[3] == '0A':  # 0A = LISTEN
                            local_addr = parts[1]
                            port_hex = local_addr.split(':')[1]
                            _listening_ports.add(int(port_hex, 16))
            except Exception:
                pass
    except Exception:
        pass

    def port_listening(port):
        return port in _listening_ports

    # ── Services (systemctl) ──────────────────────────────────────────────
    # Service check: read systemd private state files (works in any user context)
    def _svc_info(svc):
        """Check service state by reading /run/systemd and /proc directly."""
        # Try reading the MainPID from systemd's runtime state
        pid = None
        state = 'unknown'
        mem_str = 'n/a'
        uptime = 'n/a'
        try:
            # /run/systemd/units/ has per-unit state
            unit_state_path = f'/run/systemd/units/{svc}.service'
            if os.path.exists(unit_state_path):
                with open(unit_state_path) as f:
                    for line in f:
                        if line.startswith('MAINPID='):
                            pid = int(line.strip().split('=')[1])
                        if line.startswith('ACTIVE='):
                            state = line.strip().split('=')[1]
        except Exception:
            pass

        # Fallback: search /proc for the process name
        if state == 'unknown' or pid is None:
            try:
                keyword_map = {
                    'project-iq-rasa':    'rasa run',
                    'project-iq-actions': 'rasa run actions',
                    'project-iq-admin':   'admin.api.admin_api',
                }
                keyword = keyword_map.get(svc, svc)
                for entry in os.listdir('/proc'):
                    if not entry.isdigit():
                        continue
                    try:
                        with open(f'/proc/{entry}/cmdline', 'rb') as f:
                            cmd = f.read().replace(b'\x00', b' ').decode('utf-8', errors='replace')
                        if keyword in cmd:
                            pid = int(entry)
                            state = 'active'
                            break
                    except Exception:
                        pass
                if state == 'unknown':
                    state = 'inactive'
            except Exception:
                pass

        # Memory from /proc/<pid>/status
        if pid:
            try:
                with open(f'/proc/{pid}/status') as f:
                    for line in f:
                        if line.startswith('VmRSS:'):
                            kb = int(line.split()[1])
                            mem_str = f'{kb//1024}M' if kb < 1024*1024 else f'{kb//1024//1024}G'
                            break
            except Exception:
                pass
            # Start time from /proc/<pid>/stat
            try:
                with open('/proc/stat') as f:
                    for line in f:
                        if line.startswith('btime'):
                            boot_time = int(line.split()[1])
                            break
                with open(f'/proc/{pid}/stat') as f:
                    fields = f.read().split()
                    import time as _time
                    starttime_ticks = int(fields[21])
                    hz = os.sysconf('SC_CLK_TCK')
                    start_epoch = boot_time + starttime_ticks / hz
                    elapsed = int(_time.time() - start_epoch)
                    if elapsed < 60:   uptime = f'{elapsed}s'
                    elif elapsed < 3600: uptime = f'{elapsed//60}m {elapsed%60}s'
                    else: uptime = f'{elapsed//3600}h {(elapsed%3600)//60}m'
            except Exception:
                pass

        return state, mem_str, uptime

    _svc_display = {
        'project-iq-rasa':    'ML Platform Core',
        'project-iq-actions': 'ML Platform Actions',
        'project-iq-admin':   'Admin API',
    }
    services = []
    for svc in ['project-iq-rasa', 'project-iq-actions', 'project-iq-admin']:
        state, mem_str, uptime = _svc_info(svc)
        services.append({'name':   _svc_display.get(svc, svc),
                         'state':  state,
                         'mem':    mem_str,
                         'uptime': uptime,
                         'ok':     state == 'active'})

    # ── Docker containers ─────────────────────────────────────────────────
    raw = _shell('docker ps -a --format "{{.Names}}\t{{.Status}}" 2>/dev/null | grep -E "glpi|firecrawl"')
    containers = []
    for line in raw.splitlines():
        if '\t' in line:
            name, status = line.split('\t', 1)
            containers.append({'name': name, 'status': status,
                                'ok': status.lower().startswith('up')})

    # ── Ports ─────────────────────────────────────────────────────────────
    port_labels = {5005: 'ML Platform Core', 5055: 'ML Platform Actions', 8181: 'Admin API',
                   5432: 'PostgreSQL', 8083: 'ITSM', 3002: 'Firecrawl'}
    ports = [{'port': p, 'label': port_labels[p], 'ok': port_listening(p)}
             for p in port_labels]

    # ── App health — raw TCP socket HTTP (safe under eventlet tpool) ────────
    import socket as _sock
    def _http_raw(host, port, path='/', timeout=4):
        """Minimal HTTP GET via raw socket in a real thread."""
        def _req():
            try:
                s = _sock.socket(_sock.AF_INET, _sock.SOCK_STREAM)
                s.settimeout(timeout)
                s.connect((host, port))
                req = f'GET {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\n\r\n'
                s.sendall(req.encode())
                data = b''
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                    if len(data) > 32768:
                        break
                s.close()
                text = data.decode('utf-8', errors='replace')
                status_match = re.match(r'HTTP/\S+ (\d+)', text)
                code = int(status_match.group(1)) if status_match else None
                return code, text
            except Exception:
                return None, ''
        return _tpool(_req) or (None, '')

    health = []

    # ML Platform
    rasa_code, rasa_body = _http_raw('127.0.0.1', 5005, '/version')
    m = re.search(r'"version":"([^"]+)"', rasa_body)
    health.append({'name': 'ML Platform', 'ok': bool(m),
                   'detail': f'v{m.group(1)}' if m else 'no response'})

    # Admin API (self — check port directly, skip HTTP to avoid self-loop)
    admin_up = 8181 in _listening_ports
    health.append({'name': 'Admin API', 'ok': admin_up,
                   'detail': 'listening' if admin_up else 'not listening'})

    # ITSM
    glpi_code, glpi_body = _http_raw('127.0.0.1', 8083, '/')
    glpi_ok = bool(re.search(r'Authentication|GLPI', glpi_body, re.I))
    m2 = re.search(r'<title>([^<]+)</title>', glpi_body, re.I)
    health.append({'name': 'ITSM', 'ok': glpi_ok,
                   'detail': m2.group(1).strip() if m2 else ('up' if glpi_ok else 'no response')})

    # PostgreSQL (use existing DB connection)
    pg_ok, pg_detail = False, 'cannot connect'
    try:
        from common.conversation_db import _get_connection, _release_connection
        conn = _get_connection()
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) FROM conversations')
        conv_count = cur.fetchone()[0]
        cur.execute('SELECT COUNT(*) FROM operators')
        ops_count = cur.fetchone()[0]
        cur.close()
        _release_connection(conn)
        pg_ok, pg_detail = True, f'{conv_count} conversations, {ops_count} operators'
    except Exception as e:
        pg_detail = str(e)[:80]
    health.append({'name': 'PostgreSQL', 'ok': pg_ok, 'detail': pg_detail})

    # ── System resources (read /proc directly) ────────────────────────────
    resources = {'cpu_used': None, 'mem_used': 'n/a', 'mem_total': 'n/a',
                 'mem_pct': 0, 'swap_used': 'n/a', 'swap_total': 'n/a',
                 'disk': [], 'load': 'n/a', 'cpus': 'n/a'}
    try:
        # Load average
        with open('/proc/loadavg') as f:
            la = f.read().split()
            resources['load'] = f'{la[0]} {la[1]} {la[2]}'

        # CPU count
        resources['cpus'] = str(os.cpu_count() or 'n/a')

        # CPU usage — two /proc/stat samples 0.3s apart (inside tpool real thread)
        def _cpu_pct():
            import time as _time
            def _read_stat():
                with open('/proc/stat') as f:
                    l = f.readline().split()
                vals = list(map(int, l[1:8]))   # user nice sys idle iowait irq softirq
                idle  = vals[3] + vals[4]        # idle + iowait
                total = sum(vals)
                return idle, total
            try:
                i1, t1 = _read_stat()
                _time.sleep(0.3)
                i2, t2 = _read_stat()
                dt = t2 - t1
                di = i2 - i1
                return round((1 - di / dt) * 100) if dt else 0
            except Exception:
                return 0
        resources['cpu_used'] = _tpool(_cpu_pct) or 0

        # Memory from /proc/meminfo
        meminfo = {}
        with open('/proc/meminfo') as f:
            for line in f:
                k, v = line.split(':', 1)
                meminfo[k.strip()] = int(v.strip().split()[0])  # kB
        mem_total_kb  = meminfo.get('MemTotal', 0)
        mem_avail_kb  = meminfo.get('MemAvailable', 0)
        mem_used_kb   = mem_total_kb - mem_avail_kb
        swap_total_kb = meminfo.get('SwapTotal', 0)
        swap_free_kb  = meminfo.get('SwapFree', 0)
        swap_used_kb  = swap_total_kb - swap_free_kb

        def _fmt(kb):
            if kb >= 1024**2: return f'{kb/1024**2:.1f}G'
            if kb >= 1024:    return f'{kb/1024:.0f}M'
            return f'{kb}K'

        resources['mem_total'] = _fmt(mem_total_kb)
        resources['mem_used']  = _fmt(mem_used_kb)
        resources['mem_pct']   = round(mem_used_kb / mem_total_kb * 100) if mem_total_kb else 0
        resources['swap_total'] = _fmt(swap_total_kb)
        resources['swap_used']  = _fmt(swap_used_kb)

        # Disk usage via os.statvfs for / and /home
        disk_lines = []
        seen = set()
        for path in ['/', '/home']:
            try:
                st = os.statvfs(path)
                total = st.f_blocks * st.f_frsize
                free  = st.f_bfree  * st.f_frsize
                used  = total - free
                pct   = round(used / total * 100) if total else 0
                key   = (st.f_fsid if hasattr(st, 'f_fsid') else path)
                if key not in seen:
                    seen.add(key)
                    def _fmt_b(b):
                        if b >= 1024**3: return f'{b/1024**3:.1f}G'
                        if b >= 1024**2: return f'{b/1024**2:.0f}M'
                        return f'{b//1024}K'
                    raw_str = f'disk  {_fmt_b(total)}  {_fmt_b(used)}  {_fmt_b(free)}  {pct}%  {path}'
                    disk_lines.append({'raw': raw_str, 'pct': pct})
            except Exception:
                pass
        # prepend header row for the JS table renderer
        resources['disk'] = [{'raw': 'Filesystem  Size  Used  Avail  Use%  Mount', 'pct': 0}] + disk_lines

    except Exception:
        pass

    # ── Recent errors (journalctl) ────────────────────────────────────────
    errors = []
    for svc in ['project-iq-rasa', 'project-iq-actions', 'project-iq-admin']:
        label = _svc_display.get(svc, svc)
        raw_e = _shell(f'journalctl -u {svc} -p err -n 5 --no-pager --output=short 2>/dev/null | grep -v "^--" | tail -5')
        errors.append({'service': label,
                       'errors': [l for l in raw_e.splitlines() if l.strip()]})

    # ── Rasa model ────────────────────────────────────────────────────────
    model_dir = '/home/user/project-iq/core/models'
    model_files = sorted(glob.glob(f'{model_dir}/*.tar.gz'), key=os.path.getmtime, reverse=True)
    if model_files:
        f = model_files[0]
        try:    size_bytes = os.path.getsize(f)
        except: size_bytes = 0
        def _fmt_size(b):
            if b >= 1024**3: return f'{b/1024**3:.1f}G'
            if b >= 1024**2: return f'{b/1024**2:.0f}M'
            return f'{b//1024}K'
        try:    mtime = datetime.fromtimestamp(os.path.getmtime(f)).strftime('%Y-%m-%d %H:%M:%S')
        except: mtime = 'unknown'
        model = {'found': True, 'name': os.path.basename(f),
                 'size': _fmt_size(size_bytes), 'trained': mtime,
                 'count': str(len(model_files))}
    else:
        model = {'found': False}

    return jsonify({
        'timestamp':  datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'services':   services,
        'containers': containers,
        'ports':      ports,
        'health':     health,
        'resources':  resources,
        'errors':     errors,
        'model':      model,
    })


@app.route('/admin/analytics/apps', methods=['GET'])
def list_apps():
    """Get list of distinct app IDs for filtering."""
    try:
        apps = get_app_list()
        return jsonify({
            "success": True,
            "apps": apps
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/admin/analytics/summary', methods=['GET'])
def analytics_summary():
    """Get overall analytics summary. Supports ?app_id= filter."""
    try:
        app_id = request.args.get('app_id', None)
        print(f"[DEBUG] analytics_summary called with app_id={app_id}")
        summary = get_analytics_summary(app_id=app_id)
        print(f"[DEBUG] Summary returned: {summary.get('total_conversations')} conversations, {summary.get('total_messages')} messages")
        return jsonify({
            "success": True,
            "data": summary
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/admin/analytics/conversations', methods=['GET'])
def recent_conversations():
    """Get recent conversations with filters.
    
    Query params:
        app_id: Filter by app
        user: Search by user name/id
        ticket_status: 'created', 'updated', 'resolved', 'none'
        date: '24h', '7d', '30d', 'custom'
        date_from: YYYY-MM-DD (for custom range)
        date_to: YYYY-MM-DD (for custom range)
        limit: Max results (default 50)
    """
    try:
        app_id = request.args.get('app_id', None)
        user_search = request.args.get('user', None)
        ticket_status = request.args.get('ticket_status', None)
        date_filter = request.args.get('date', None)
        date_from = request.args.get('date_from', None)
        date_to = request.args.get('date_to', None)
        limit = request.args.get('limit', 50, type=int)
        
        conversations = get_recent_conversations(
            limit=limit,
            app_id=app_id if app_id != 'all' else None,
            user_search=user_search,
            ticket_status=ticket_status if ticket_status != 'all' else None,
            date_filter=date_filter if date_filter != 'all' else None,
            date_from=date_from,
            date_to=date_to
        )
        
        return jsonify({
            "success": True,
            "data": conversations,
            "count": len(conversations)
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/admin/analytics/intents', methods=['GET'])
def intent_distribution():
    """Get intent distribution data. Supports ?app_id= filter."""
    try:
        app_id = request.args.get('app_id', None)
        summary = get_analytics_summary(app_id=app_id)
        return jsonify({
            "success": True,
            "data": {
                "intents": summary.get("intent_distribution", {}),
                "top_intents": summary.get("top_intents", [])
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route('/admin/analytics/feedback', methods=['GET'])
def feedback_metrics():
    """Get feedback metrics. Supports ?app_id= filter."""
    try:
        app_id = request.args.get('app_id', None)
        summary = get_analytics_summary(app_id=app_id)
        return jsonify({
            "success": True,
            "data": {
                "positive": summary.get("feedback_positive", 0),
                "negative": summary.get("feedback_negative", 0),
                "resolution_rate": summary.get("resolution_rate", 0)
            }
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# =====================
# SATISFACTION RATINGS
# =====================

@app.route('/analytics/satisfaction', methods=['GET'])
@app.route('/admin/analytics/satisfaction', methods=['GET'])
def satisfaction_ratings():
    """Get satisfaction ratings distribution with optional date filter."""
    try:
        days = request.args.get('days', '30')
        
        # Query satisfaction ratings from feedback table
        from common.conversation_db import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Build date filter
        date_filter = ""
        if days != 'all':
            try:
                days_int = int(days)
                date_filter = f"AND timestamp >= NOW() - INTERVAL '{days_int} days'"
            except ValueError:
                pass
        
        # Query ratings from feedback
        cursor.execute(f"""
            SELECT 
                CASE 
                    WHEN feedback_text LIKE '%%5 stars%%' THEN 5
                    WHEN feedback_text LIKE '%%4 stars%%' THEN 4
                    WHEN feedback_text LIKE '%%3 stars%%' THEN 3
                    WHEN feedback_text LIKE '%%2 stars%%' THEN 2
                    WHEN feedback_text LIKE '%%1 star%%' THEN 1
                    ELSE 0
                END as rating,
                COUNT(*) as count
            FROM feedback 
            WHERE feedback_text LIKE '%%Satisfaction%%' {date_filter}
            GROUP BY rating
            ORDER BY rating DESC
        """)
        
        results = cursor.fetchall()
        
        ratings = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        total = 0
        weighted_sum = 0
        
        for row in results:
            rating, count = row[0], row[1]
            if rating > 0:
                ratings[rating] = count
                total += count
                weighted_sum += rating * count
        
        average = weighted_sum / total if total > 0 else 0
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "data": {
                "ratings": ratings,
                "total": total,
                "average": round(average, 2)
            }
        })
    except Exception as e:
        print(f"Error in satisfaction_ratings: {e}")
        return jsonify({
            "success": True,
            "data": {
                "ratings": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
                "total": 0,
                "average": 0
            }
        })




# =====================
# HEALTH CHECK
# =====================

@app.route('/health', methods=['GET'])
@app.route('/admin/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "ok", "service": "admin-api"})


# =====================
# RASA PROXY (For Remote Debugger)
# =====================
import requests

@app.route('/api/rasa/<path:path>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def proxy_rasa(path):
    """Proxy requests to Rasa Core (Port 5005) to avoid CORS/Localhost issues."""
    rasa_url = f"{RASA_URL}/{path}"
    
    try:
        json_headers = {'Accept': 'application/json'}
        if request.method == 'GET':
            resp = requests.get(rasa_url, params=request.args, headers=json_headers)
        elif request.method == 'POST':
            resp = requests.post(rasa_url, json=request.get_json(), headers=json_headers)
        elif request.method == 'PUT':
            resp = requests.put(rasa_url, json=request.get_json(), headers=json_headers)
        elif request.method == 'DELETE':
            resp = requests.delete(rasa_url, headers=json_headers)
            
        return jsonify(resp.json()), resp.status_code
    except Exception as e:
        return jsonify({"error": f"Rasa Proxy Error: {str(e)}"}), 500


# =====================
# ADMIN AUTHENTICATION
# =====================

from action_server.actions.glpi_service import GlpiService
from common.config_manager import get_glpi_config

# Admin profile IDs allowed to access admin dashboard
# GLPI Default: Super-Admin = 4
# Adjust this list based on your GLPI installation
ALLOWED_ADMIN_PROFILE_IDS = [4]  # Only Super-Admin
ALLOWED_ADMIN_PROFILE_NAMES = ['Super-Admin']  # Fallback by name

# Storage for active admin sessions (in production, use Redis or DB)
admin_sessions = {}


@app.route('/admin/login', methods=['POST'])
def admin_login():
    """
    Authenticate admin user via Local Config OR GLPI API.
    """
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')
        
        if not username or not password:
            return jsonify({
                "success": False,
                "error": "Username and password are required"
            }), 400
            
        # 1. LOCAL FALLBACK (Priority)
        # Allows access to Studio even if GLPI is down or user not in GLPI
        config = get_file_config()
        local_user = config.get('ADMIN_USER', 'admin')
        local_pass = config.get('ADMIN_PASSWORD', 'projectiq123')
        
        if username == local_user and password == local_pass:
            # Generate local session
            import uuid
            token = f"local-{uuid.uuid4()}"
            
            admin_sessions[token] = {
                "user_id": 0,
                "user_name": "admin",
                "firstname": "Administrator",
                "profile_id": 4, # Super-Admin ID equivalent
                "profile_name": "Super-Admin (Local)"
            }
            
            print(f"[ADMIN AUTH] Local login successful for user: {username}")
            return jsonify({
                "success": True,
                "session_token": token,
                "user": {
                    "id": 0,
                    "name": "admin",
                    "firstname": "Administrator",
                    "profile": "Super-Admin (Local)"
                }
            })

        # 2. GLPI AUTHENTICATION (Standard)
        # Get GLPI config
        glpi_config = get_glpi_config()
        glpi_service = GlpiService(
            glpi_config['api_url'],
            glpi_config['app_token'],
            glpi_config['user_token']
        )
        
        # Authenticate with GLPI (Async wrapper)
        import asyncio
        result = asyncio.run(glpi_service.login_with_credentials(username, password))
        
        if not result['success']:
            return jsonify({
                "success": False,
                "error": result.get('error', 'Authentication failed')
            }), 401
        
        # Check if user has admin profile
        profile_id = result.get('profile_id')
        profile_name = result.get('profile_name', '')
        
        # Debug logging
        print(f"[ADMIN AUTH] User: {username}, Profile ID: {profile_id}, Profile Name: {profile_name}")
        print(f"[ADMIN AUTH] Allowed IDs: {ALLOWED_ADMIN_PROFILE_IDS}, Allowed Names: {ALLOWED_ADMIN_PROFILE_NAMES}")
        
        is_admin = (
            profile_id in ALLOWED_ADMIN_PROFILE_IDS or
            profile_name in ALLOWED_ADMIN_PROFILE_NAMES
        )
        
        if not is_admin:
            # Kill the GLPI session since user is not authorized
            glpi_service.kill_session(result['session_token'])
            return jsonify({
                "success": False,
                "error": f"Access denied. Your profile '{profile_name}' is not authorized to access the admin dashboard."
            }), 403
        
        # Store session
        session_token = result['session_token']
        admin_sessions[session_token] = {
            "user_id": result.get('user_id'),
            "user_name": result.get('user_name'),
            "firstname": result.get('user_firstname'),
            "profile_id": profile_id,
            "profile_name": profile_name
        }
        
        return jsonify({
            "success": True,
            "session_token": session_token,
            "user": {
                "id": result.get('user_id'),
                "name": result.get('user_name'),
                "firstname": result.get('user_firstname'),
                "profile": profile_name
            }
        })
        
    except Exception as e:
        print(f"Admin login error: {e}")
        return jsonify({
            "success": False,
            "error": f"Login error: {str(e)}"
        }), 500


@app.route('/admin/logout', methods=['POST'])
def admin_logout():
    """Logout admin user and kill GLPI session."""
    try:
        data = request.get_json() or {}
        session_token = data.get('session_token') or request.headers.get('X-Session-Token')
        
        if session_token:
            # Remove from local sessions
            if session_token in admin_sessions:
                del admin_sessions[session_token]
            
            # Kill GLPI session
            try:
                glpi_config = get_glpi_config()
                glpi_service = GlpiService(
                    glpi_config['api_url'],
                    glpi_config['app_token'],
                    glpi_config['user_token']
                )
                glpi_service.kill_session(session_token)
            except:
                pass  # Session might already be expired
        
        return jsonify({"success": True, "message": "Logged out"})
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/verify', methods=['POST'])
def admin_verify():
    """Verify if a session token is still valid."""
    try:
        data = request.get_json() or {}
        session_token = data.get('session_token') or request.headers.get('X-Session-Token')
        
        if not session_token:
            return jsonify({"valid": False, "error": "No session token provided"}), 401
        
        # Check local cache first
        if session_token in admin_sessions:
            user_info = admin_sessions[session_token]
            return jsonify({
                "valid": True,
                "user": {
                    "id": user_info.get('user_id'),
                    "name": user_info.get('user_name'),
                    "firstname": user_info.get('firstname'),
                    "profile": user_info.get('profile_name')
                }
            })
        
        # Token not in cache - verify with GLPI
        try:
            glpi_config = get_glpi_config()
            glpi_service = GlpiService(
                glpi_config['api_url'],
                glpi_config['app_token'],
                glpi_config['user_token']
            )
            user_info = glpi_service._get_current_user(session_token)
            
            if user_info and user_info.get('id'):
                # Check if admin
                profile_id = user_info.get('profile_id')
                profile_name = user_info.get('profile_name', '')
                
                is_admin = (
                    profile_id in ALLOWED_ADMIN_PROFILE_IDS or
                    profile_name in ALLOWED_ADMIN_PROFILE_NAMES
                )
                
                if is_admin:
                    # Cache the session
                    admin_sessions[session_token] = user_info
                    return jsonify({
                        "valid": True,
                        "user": {
                            "id": user_info.get('id'),
                            "name": user_info.get('name'),
                            "firstname": user_info.get('firstname'),
                            "profile": profile_name
                        }
                    })
        except:
            pass
        
        return jsonify({"valid": False, "error": "Session expired or invalid"}), 401
        
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)}), 500


# =====================
# OBSERVABILITY ENDPOINTS
# =====================

import random
import time
from datetime import datetime, timedelta

@app.route('/admin/observability/metrics', methods=['GET'])
def get_system_metrics():
    """Get system metrics using psutil for real data."""
    conn = None
    try:
        import psutil
        import os
        import platform
        from common.conversation_db import _get_connection, _release_connection

        # Get real system metrics
        cpu_percent = psutil.cpu_percent(interval=0.1)
        cpu_count = psutil.cpu_count()

        memory = psutil.virtual_memory()
        memory_percent = memory.percent
        memory_used = memory.used
        memory_total = memory.total

        # Get disk usage - handle Windows vs Unix paths
        if platform.system() == 'Windows':
            # Use the drive where the script is running (typically C:)
            disk_path = os.path.splitdrive(os.getcwd())[0] + '\\'
        else:
            disk_path = '/'

        disk = psutil.disk_usage(disk_path)
        disk_percent = disk.percent
        disk_used = disk.used
        disk_total = disk.total

        # Get per-service metrics
        services = {}
        current_pid = os.getpid()

        # Helper function to find process by name or port
        def find_process_metrics(name_patterns, port=None):
            """Find a process and return its CPU and memory usage."""
            matched_processes = []
            try:
                for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                    try:
                        proc_info = proc.info
                        proc_name = proc_info.get('name', '').lower()
                        cmdline = ' '.join(proc_info.get('cmdline', [])).lower() if proc_info.get('cmdline') else ''

                        # Check if process matches any pattern
                        for pattern in name_patterns:
                            pattern_lower = pattern.lower()
                            if pattern_lower in proc_name or pattern_lower in cmdline:
                                matched_processes.append(proc)
                                break  # Found match, move to next process
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        continue

                # If we found matching processes, aggregate their metrics
                if matched_processes:
                    total_cpu = 0.0
                    total_mem = 0.0
                    count = 0

                    for proc in matched_processes:
                        try:
                            cpu = proc.cpu_percent(interval=0.5)  # Blocking — accurate reading
                            mem = proc.memory_percent()
                            total_cpu += cpu
                            total_mem += mem
                            count += 1
                        except (psutil.NoSuchProcess, psutil.AccessDenied):
                            continue

                    if count > 0:
                        return {
                            'cpu': round(total_cpu, 1),
                            'memory': round(total_mem, 1),
                            'pid': matched_processes[0].pid,
                            'count': count
                        }
            except Exception as e:
                print(f"Error finding process {name_patterns}: {e}")
            return {'cpu': 0.0, 'memory': 0.0, 'pid': None, 'count': 0}

        # Get metrics for each service
        # Look for rasa.exe or python running rasa
        services['rasa'] = find_process_metrics(['rasa.exe', 'rasa run'])
        # Look for rasa_sdk (actions server) - check for python process running rasa_sdk
        services['actions'] = find_process_metrics(['rasa_sdk', 'rasa-sdk', 'rasa_sdk.cli', 'actions.py'])
        # Look for postgres
        services['database'] = find_process_metrics(['postgres.exe', 'postgres', 'postgresql'])

        # Admin API is the current process
        try:
            current_proc = psutil.Process(current_pid)
            services['admin'] = {
                'cpu': round(current_proc.cpu_percent(interval=0.5), 1),
                'memory': round(current_proc.memory_percent(), 1),
                'pid': current_pid
            }
        except Exception as e:
            print(f"Error getting current process metrics: {e}")
            services['admin'] = {'cpu': 0.0, 'memory': 0.0, 'pid': current_pid}

        # Get real performance metrics from database
        try:
            conn = _get_connection()
            cursor = conn.cursor()

            # Response time: avg ms between each user msg and the NEAREST following bot msg
            # Try last 7 days first, fall back to all-time if no data
            cursor.execute('''
                WITH bot_responses AS (
                    SELECT
                        bot.id,
                        bot.conversation_id,
                        bot.timestamp AS bot_ts,
                        (
                            SELECT MAX(u.timestamp)
                            FROM messages u
                            WHERE u.conversation_id = bot.conversation_id
                              AND u.sender = 'user'
                              AND u.timestamp < bot.timestamp
                        ) AS prev_user_ts
                    FROM messages bot
                    WHERE bot.sender = 'bot'
                      AND bot.timestamp > NOW() - INTERVAL '7 days'
                )
                SELECT AVG(EXTRACT(EPOCH FROM (bot_ts - prev_user_ts)) * 1000)
                FROM bot_responses
                WHERE prev_user_ts IS NOT NULL
            ''')
            result = cursor.fetchone()
            avg_response_time = round(result[0]) if result and result[0] else 0

            # If still 0 (no data in last 7 days), try all-time
            if avg_response_time == 0:
                cursor.execute('''
                    WITH bot_responses AS (
                        SELECT
                            bot.timestamp AS bot_ts,
                            (
                                SELECT MAX(u.timestamp)
                                FROM messages u
                                WHERE u.conversation_id = bot.conversation_id
                                  AND u.sender = 'user'
                                  AND u.timestamp < bot.timestamp
                            ) AS prev_user_ts
                        FROM messages bot
                        WHERE bot.sender = 'bot'
                    )
                    SELECT AVG(EXTRACT(EPOCH FROM (bot_ts - prev_user_ts)) * 1000)
                    FROM bot_responses
                    WHERE prev_user_ts IS NOT NULL
                ''')
                result = cursor.fetchone()
                avg_response_time = round(result[0]) if result and result[0] else 0

            # Throughput: messages per minute averaged over last 24 hours
            # Falls back to all-time average if no recent data
            cursor.execute('''
                SELECT COUNT(*) FROM messages
                WHERE timestamp > NOW() - INTERVAL '24 hours'
            ''')
            daily_messages = cursor.fetchone()[0] or 0
            throughput = round(daily_messages / 1440.0, 2)  # per minute over 24h

            if throughput == 0:
                # All-time fallback: total messages / total elapsed minutes
                cursor.execute('''
                    SELECT COUNT(*),
                           EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60.0
                    FROM messages
                ''')
                row = cursor.fetchone()
                if row and row[0] and row[1] and row[1] > 0:
                    throughput = round(row[0] / row[1], 2)

            # Error rate: % of bot messages that are fallbacks/errors in last 7 days
            # Falls back to all-time if no recent data
            cursor.execute('''
                SELECT
                    COUNT(*) FILTER (WHERE
                        text ILIKE '%error%' OR
                        text ILIKE '%failed%' OR
                        text ILIKE '%sorry%' OR
                        text ILIKE '%not sure%' OR
                        text ILIKE '%don''t understand%' OR
                        text ILIKE '%couldn''t%' OR
                        text ILIKE '%unable%' OR
                        text ILIKE '%cannot%' OR
                        text ILIKE '%not understand%'
                    ) AS errors,
                    COUNT(*) AS total
                FROM messages
                WHERE sender = 'bot'
                  AND timestamp > NOW() - INTERVAL '7 days'
            ''')
            result = cursor.fetchone()
            if result and result[1] and result[1] > 0:
                error_rate = round((result[0] / result[1]) * 100, 2)
            else:
                # All-time fallback
                cursor.execute('''
                    SELECT
                        COUNT(*) FILTER (WHERE
                            text ILIKE '%error%' OR text ILIKE '%failed%' OR
                            text ILIKE '%sorry%' OR text ILIKE '%not sure%' OR
                            text ILIKE '%don''t understand%' OR text ILIKE '%couldn''t%' OR
                            text ILIKE '%unable%' OR text ILIKE '%cannot%' OR
                            text ILIKE '%not understand%'
                        ) AS errors,
                        COUNT(*) AS total
                    FROM messages
                    WHERE sender = 'bot'
                ''')
                result = cursor.fetchone()
                error_rate = round((result[0] / result[1]) * 100, 2) if result and result[1] else 0

            cursor.close()
        except Exception as e:
            print(f"Error getting performance metrics: {e}")
            avg_response_time = 0
            throughput = 0
            error_rate = 0
        finally:
            if conn:
                _release_connection(conn)
                conn = None

        data = {
            "success": True,
            "data": {
                "cpu_percent": round(cpu_percent, 1),
                "cpu_count": cpu_count,
                "memory_percent": round(memory_percent, 1),
                "memory_used": memory_used,
                "memory_total": memory_total,
                "disk_percent": round(disk_percent, 1),
                "disk_used": disk_used,
                "disk_total": disk_total,
                "avg_response_time": avg_response_time,
                "throughput": throughput,
                "error_rate": error_rate,
                "services": services
            }
        }
        return jsonify(data)
    except Exception as e:
        print(f"Error in get_system_metrics: {e}")
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                _release_connection(conn)
            except:
                pass

@app.route('/admin/observability/database/stats', methods=['GET'])
def get_db_stats():
    """Get database statistics."""
    conn = None
    try:
        from common.conversation_db import _get_connection, _release_connection
        conn = _get_connection()
        cursor = conn.cursor()

        # Count rows in key tables
        tables = ['conversations', 'messages', 'feedback', 'users']
        stats = {}

        for table in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                stats[table] = cursor.fetchone()[0]
            except Exception as e:
                conn.rollback()
                stats[table] = 0

        # Recent activity
        try:
            cursor.execute("SELECT COUNT(*) FROM messages WHERE timestamp > NOW() - INTERVAL '1 hour'")
            msgs_hour = cursor.fetchone()[0]
        except:
            conn.rollback()
            msgs_hour = 0

        try:
            cursor.execute("SELECT COUNT(*) FROM conversations WHERE start_time > CURRENT_DATE")
            convs_today = cursor.fetchone()[0]
        except:
            conn.rollback()
            convs_today = 0

        # Get real average response time
        try:
            cursor.execute('''
                SELECT AVG(
                    EXTRACT(EPOCH FROM (
                        bot.timestamp - user_msg.timestamp
                    ))
                ) * 1000 as avg_ms
                FROM messages bot
                JOIN messages user_msg ON bot.conversation_id = user_msg.conversation_id
                    AND bot.timestamp > user_msg.timestamp
                WHERE bot.sender = 'bot'
                    AND user_msg.sender = 'user'
                    AND bot.timestamp > NOW() - INTERVAL '24 hours'
                LIMIT 5000
            ''')
            result = cursor.fetchone()
            avg_response_ms = round(result[0]) if result and result[0] else 0
        except:
            conn.rollback()
            avg_response_ms = 0

        cursor.close()
        return jsonify({
            "success": True,
            "data": {
                "tables": stats,
                "activity": {
                    "messages_last_hour": msgs_hour,
                    "conversations_today": convs_today
                },
                "performance": {
                    "avg_response_ms": avg_response_ms
                }
            }
        })
    except Exception as e:
        print(f"DB Stats Error: {e}")
        if conn:
            conn.rollback()
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            _release_connection(conn)

@app.route('/admin/observability/logs', methods=['GET'])
def get_recent_logs():
    """Get recent application logs."""
    try:
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        logs = []
        log_files = {
            'rasa': os.path.join(base_path, 'Log', 'core.log'),
            'actions': os.path.join(base_path, 'Log', 'actions.log'),
            'admin': os.path.join(base_path, 'Log', 'admin_new.err')
        }

        for source, path in log_files.items():
            if os.path.exists(path):
                try:
                    with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                        # Get last 20 lines
                        all_lines = f.readlines()
                        lines = all_lines[-20:] if len(all_lines) > 20 else all_lines

                        for line in lines:
                            if not line.strip():
                                continue

                            level = 'INFO'
                            if 'ERROR' in line.upper() or 'Exception' in line:
                                level = 'ERROR'
                            elif 'WARNING' in line.upper() or 'WARN' in line.upper():
                                level = 'WARNING'
                            elif 'DEBUG' in line.upper():
                                level = 'DEBUG'

                            logs.append({
                                "timestamp": datetime.now().isoformat(),
                                "level": level,
                                "source": source,
                                "message": line.strip()[:300]
                            })
                except Exception as e:
                    print(f"Error reading log file {path}: {e}")

        return jsonify({
            "success": True,
            "data": logs[-50:]
        })
    except Exception as e:
        print(f"Error in get_recent_logs: {e}")
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/admin/health/<service>', methods=['GET'])
def service_health(service):
    """Check health of specific service."""
    try:
        import requests
        healthy = True

        if service == 'database':
            from common.conversation_db import _get_connection, _release_connection
            try:
                conn = _get_connection()
                _release_connection(conn)
            except:
                healthy = False
        elif service == 'rasa':
            try:
                response = requests.get(
                    f'{RASA_URL}/status',
                    headers={'Accept': 'application/json'},
                    timeout=3
                )
                healthy = response.status_code == 200
            except:
                healthy = False
        elif service == 'actions':
            try:
                action_health = ACTION_URL.replace('/webhook', '/health')
                response = requests.get(action_health, timeout=3)
                healthy = response.status_code == 200
            except:
                healthy = False

        return jsonify({
            "status": "ok",
            "healthy": healthy,
            "service": service
        })
    except Exception as e:
        return jsonify({"status": "error", "healthy": False, "error": str(e)})

# =============================
# KNOWLEDGE BASE ENDPOINTS
# =============================

@app.route('/admin/kb/status', methods=['GET'])
def get_kb_status():
    """Get knowledge base status from cache (fast)."""
    try:
        status = admin_kb_cache.get_status()
        return jsonify({
            "success": True,
            "status": status
        })
    except Exception as e:
        print(f"Error getting KB status: {e}")
        return jsonify({
            "success": False,
            "error": str(e),
            "status": {
                "article_count": 0,
                "last_refresh": None,
                "source": "error",
                "model_info": None
            }
        }), 500

@app.route('/admin/kb/refresh', methods=['POST'])
def refresh_kb_cache():
    """Refresh KB cache from Project IQ."""
    try:
        print("[KB Admin] Manual refresh triggered")

        # Reload articles from GLPI
        success = admin_kb_cache.load_articles()

        if success:
            status = admin_kb_cache.get_status()
            return jsonify({
                "success": True,
                "message": f"KB cache refreshed. Loaded {status['article_count']} articles from Project IQ.",
                "status": status
            })
        else:
            return jsonify({
                "success": False,
                "message": "Failed to refresh KB cache. Check logs for details.",
                "status": admin_kb_cache.get_status()
            }), 500

    except Exception as e:
        print(f"Error refreshing KB cache: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e),
            "message": "Failed to refresh KB cache"
        }), 500

@app.route('/admin/kb/articles', methods=['GET'])
def get_kb_articles():
    """Get all KB articles from Admin KB cache with pagination."""
    try:
        # Get pagination parameters
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 50))
        search_filter = request.args.get('filter', '')

        # Get articles from admin KB cache
        result = admin_kb_cache.get_articles(page, limit, search_filter)

        return jsonify({
            "success": True,
            **result,
            "source": "glpi"
        })

    except Exception as e:
        print(f"Error getting KB articles: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e),
            "articles": []
        }), 500



@app.route('/admin/kb/search', methods=['POST'])
def test_kb_search():
    """Test search endpoint with detailed score display for debugging."""
    try:
        from admin.api.kb_cache_manager import kb_cache

        # Get search query from request
        data = request.get_json()
        query = data.get('query', '')

        if not query:
            return jsonify({
                "success": False,
                "error": "Query parameter is required"
            }), 400

        # Perform search
        results = kb_cache.search_articles(query)

        # Format results with detailed scores
        formatted_results = []
        for result in results:
            formatted_results.append({
                "article": {
                    "id": result['article'].get('id'),
                    "title": result['article'].get('title'),
                    "category": result['article'].get('category'),
                    "content": result['article'].get('content', '')[:200] + '...',
                    "source": result['article'].get('source'),
                    "glpi_id": result['article'].get('glpi_id'),
                    "is_faq": result['article'].get('is_faq', False),
                    "date_modified": result['article'].get('date_modified')
                },
                "scores": {
                    "final_score": round(result.get('score', 0), 3),
                    "semantic_score": round(result.get('semantic_score', 0), 3),
                    "keyword_score": round(result.get('keyword_score', 0), 3)
                },
                "source": result.get('source', 'unknown')
            })

        return jsonify({
            "success": True,
            "query": query,
            "result_count": len(formatted_results),
            "results": formatted_results
        })

    except Exception as e:
        print(f"Error in KB search test: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e),
            "results": []
        }), 500

# =====================
# URL INGESTION (FIRECRAWL)
# =====================

@app.route('/admin/kb/ingest-url', methods=['POST'])
def ingest_url():
    """Scrape a single URL and add it to the KB."""
    try:
        data = request.get_json()
        url = data.get('url', '')
        category = data.get('category', None)

        if not url:
            return jsonify({"success": False, "error": "URL is required"}), 400

        from common.firecrawl_ingester import ingest_url_to_kb
        result = ingest_url_to_kb(url, category)

        return jsonify({"success": True, **result})
    except ImportError as e:
        return jsonify({"success": False, "error": f"Firecrawl not installed: {e}"}), 500
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        print(f"Error ingesting URL: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/kb/crawl-site', methods=['POST'])
def crawl_site_endpoint():
    """Crawl an entire website and add all pages to the KB."""
    try:
        data = request.get_json()
        url = data.get('url', '')
        limit = data.get('limit', 50)
        category = data.get('category', None)

        if not url:
            return jsonify({"success": False, "error": "URL is required"}), 400

        from common.firecrawl_ingester import ingest_crawl_to_kb
        result = ingest_crawl_to_kb(url, limit, category)

        return jsonify({"success": True, **result})
    except ImportError as e:
        return jsonify({"success": False, "error": f"Firecrawl not installed: {e}"}), 500
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        print(f"Error crawling site: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/kb/ingest-urls', methods=['POST'])
def ingest_urls():
    """Batch scrape multiple URLs and add them to the KB."""
    try:
        data = request.get_json()
        urls = data.get('urls', [])
        category = data.get('category', None)

        if not urls or not isinstance(urls, list):
            return jsonify({"success": False, "error": "urls (list) is required"}), 400

        from common.firecrawl_ingester import ingest_batch_to_kb
        result = ingest_batch_to_kb(urls, category)

        return jsonify({"success": True, **result})
    except ImportError as e:
        return jsonify({"success": False, "error": f"Firecrawl not installed: {e}"}), 500
    except Exception as e:
        print(f"Error batch ingesting URLs: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/kb/data-sources', methods=['GET'])
def get_data_sources():
    """Get all tracked data sources (Firecrawl + Airbyte)."""
    try:
        from common.firecrawl_ingester import get_data_sources as _get_sources
        sources = _get_sources()
        return jsonify({"success": True, "data": sources})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []}), 500


# =====================
# FIRECRAWL CONFIGURATION & UTILITIES
# =====================

@app.route('/admin/firecrawl/config', methods=['GET'])
def get_firecrawl_config():
    """Get Firecrawl configuration (API key + URL)."""
    try:
        config = get_file_config()
        return jsonify({
            "success": True,
            "api_key": config.get('FIRECRAWL_API_KEY', ''),
            "api_url": config.get('FIRECRAWL_API_URL', 'http://localhost:3002'),
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/firecrawl/config', methods=['POST'])
def save_firecrawl_config():
    """Save Firecrawl configuration."""
    try:
        data = request.get_json()
        save_file_config({
            'FIRECRAWL_API_KEY': data.get('api_key', 'fc-selfhosted'),
            'FIRECRAWL_API_URL': data.get('api_url', 'http://localhost:3002'),
        })
        return jsonify({"success": True, "message": "Firecrawl configuration saved"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/firecrawl/test', methods=['POST'])
def test_firecrawl_connection():
    """Test connection to the Firecrawl instance."""
    try:
        import requests as _requests
        data = request.get_json() or {}
        cfg = get_file_config()
        api_url = (data.get('api_url') or cfg.get('FIRECRAWL_API_URL', 'http://localhost:3002')).rstrip('/')

        # Use /is-production — Firecrawl's own e2e health probe, no auth required
        probe_url = f"{api_url}/is-production"
        try:
            resp = _requests.get(probe_url, timeout=5)
            if resp.status_code == 200:
                return jsonify({"success": True, "message": "Firecrawl is running", "url": api_url})
            else:
                return jsonify({"success": False,
                                "message": f"Firecrawl returned HTTP {resp.status_code}",
                                "url": api_url})
        except _requests.exceptions.ConnectionError:
            return jsonify({"success": False,
                            "message": f"Connection refused — nothing is listening at {api_url}. "
                                       f"Start Firecrawl (Docker) then retry.",
                            "url": api_url}), 200
        except _requests.exceptions.Timeout:
            return jsonify({"success": False,
                            "message": f"Timed out connecting to {api_url}. "
                                       f"Check that Firecrawl is running and the URL is correct.",
                            "url": api_url}), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e),
                        "message": f"Unexpected error: {e}"}), 200


@app.route('/admin/firecrawl/crawl-jobs', methods=['GET'])
def get_firecrawl_crawl_jobs():
    """Get history of all Firecrawl crawl/scrape jobs."""
    try:
        from common.firecrawl_ingester import get_data_sources as _get_sources
        sources = _get_sources()
        # Filter to only firecrawl sources
        fc_sources = [s for s in sources if 'firecrawl' in s.get('source_type', '').lower()]
        return jsonify({"success": True, "data": fc_sources})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []}), 500


# =====================
# DATA CONNECTORS (AIRBYTE)
# =====================

@app.route('/admin/connectors/sources', methods=['GET'])
def list_connector_sources():
    """List available Airbyte connector types."""
    try:
        from common.airbyte_connector import list_available_sources
        sources = list_available_sources()
        return jsonify({"success": True, "sources": sources})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/connectors/sources/<source_type>/schema', methods=['GET'])
def get_connector_schema(source_type):
    """Get configuration schema for a specific connector type."""
    try:
        from common.airbyte_connector import get_source_config_schema
        schema = get_source_config_schema(source_type)
        if schema:
            return jsonify({"success": True, "schema": schema})
        return jsonify({"success": False, "error": f"Unknown source type: {source_type}"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/connectors/sync', methods=['POST'])
def sync_connector():
    """Trigger a sync from an Airbyte data source."""
    try:
        data = request.get_json()
        source_type = data.get('source_type', '')
        config = data.get('config', {})
        streams = data.get('streams', None)

        if not source_type:
            return jsonify({"success": False, "error": "source_type is required"}), 400
        if not config:
            return jsonify({"success": False, "error": "config is required"}), 400

        from common.airbyte_connector import sync_source
        result = sync_source(source_type, config, streams)

        return jsonify({"success": True, **result})
    except ImportError as e:
        return jsonify({"success": False, "error": f"PyAirbyte not installed: {e}"}), 500
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400
    except Exception as e:
        print(f"Error syncing connector: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)}), 500


# =====================
# INSPECTOR ENDPOINTS
# =====================

import yaml
from datetime import datetime
from common.conversation_db import _get_connection, _release_connection, get_conversation_transcript
from psycopg2.extras import RealDictCursor


def get_stories_and_rules():
    """Parse stories.yml and rules.yml to extract flow definitions."""
    flows = {"stories": [], "rules": []}
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    stories_path = os.path.join(project_root, "core", "data", "stories.yml")
    if os.path.exists(stories_path):
        with open(stories_path, 'r', encoding='utf-8') as f:
            try:
                data = yaml.safe_load(f)
                if data:
                    flows["stories"] = data.get("stories", [])
            except Exception as e:
                print(f"[ERROR] Error parsing stories.yml: {e}")

    rules_path = os.path.join(project_root, "core", "data", "rules.yml")
    if os.path.exists(rules_path):
        with open(rules_path, 'r', encoding='utf-8') as f:
            try:
                data = yaml.safe_load(f)
                if data:
                    flows["rules"] = data.get("rules", [])
            except Exception as e:
                print(f"[ERROR] Error parsing rules.yml: {e}")

    return flows


def get_domain_info():
    """Parse domain.yml to extract intents, entities, actions, and slots."""
    base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    domain_path = os.path.join(base_path, "domain.yml")
    print(f"[DEBUG] Loading domain from: {domain_path}")
    
    domain = {"intents": [], "entities": [], "actions": [], "slots": {}, "responses": []}
    
    if os.path.exists(domain_path):
        with open(domain_path, 'r', encoding='utf-8') as f:
            try:
                data = yaml.safe_load(f)
                domain["intents"] = data.get("intents", [])
                domain["entities"] = data.get("entities", [])
                domain["actions"] = data.get("actions", [])
                domain["slots"] = data.get("slots", {})
                domain["responses"] = list(data.get("responses", {}).keys())
            except Exception as e:
                print(f"Error parsing domain.yml: {e}")
    
    return domain


# =====================
# STUDIO ENDPOINTS
# =====================

@app.route('/admin/studio/flows', methods=['GET'])
def studio_flows():
    """Get all flows (stories and rules) for visualization."""
    try:
        flows_data = get_stories_and_rules()
        
        # Transform to flat list with type indicator
        flows = []
        
        for story in flows_data.get('stories', []):
            steps = []
            for step in story.get('steps', []):
                if isinstance(step, dict):
                    if 'intent' in step:
                        steps.append(f"intent: {step['intent']}")
                    elif 'action' in step:
                        steps.append(step['action'])
                    elif 'or' in step:
                        steps.append(f"or: {step['or']}")
            flows.append({
                'name': story.get('story', 'Unnamed'),
                'type': 'story',
                'steps': steps
            })
        
        for rule in flows_data.get('rules', []):
            steps = []
            for step in rule.get('steps', []):
                if isinstance(step, dict):
                    if 'intent' in step:
                        steps.append(f"intent: {step['intent']}")
                    elif 'action' in step:
                        steps.append(step['action'])
            flows.append({
                'name': rule.get('rule', 'Unnamed'),
                'type': 'rule',
                'steps': steps
            })
        
        return jsonify({"success": True, "flows": flows})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/responses', methods=['GET'])
def studio_responses():
    """Get all response templates from domain.yml."""
    try:
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        domain_path = os.path.join(base_path, "domain.yml")
        
        responses = []
        if os.path.exists(domain_path):
            with open(domain_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
                resp_data = data.get('responses', {})
                
                for name, templates in resp_data.items():
                    text = ''
                    if isinstance(templates, list) and len(templates) > 0:
                        text = templates[0].get('text', '') if isinstance(templates[0], dict) else str(templates[0])
                    responses.append({
                        'name': name,
                        'text': text,
                        'variations': len(templates) if isinstance(templates, list) else 1
                    })
        
        return jsonify({"success": True, "responses": responses})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/intents', methods=['GET'])
def studio_intents():
    """Get intent training examples from nlu.yml."""
    try:
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        nlu_path = os.path.join(base_path, "data", "nlu.yml")
        print(f"[DEBUG] Loading NLU from: {nlu_path}")
        
        intents = []
        if os.path.exists(nlu_path):
            with open(nlu_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
                nlu_data = data.get('nlu', [])
                
                for item in nlu_data:
                    intent_name = item.get('intent', '')
                    examples = item.get('examples', '')
                    
                    # Parse examples (they're in markdown list format)
                    if isinstance(examples, str):
                        for line in examples.strip().split('\n'):
                            line = line.strip()
                            if line.startswith('- '):
                                intents.append({
                                    'intent': intent_name,
                                    'example': line[2:]
                                })
        
        return jsonify({"success": True, "intents": intents})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/test/message', methods=['POST'])
def test_message():
    """Send a test message to Rasa and return response with NLU data."""
    try:
        import requests
        
        data = request.get_json()
        message = data.get('message', '')
        sender = data.get('sender', 'test-user')
        
        if not message:
            return jsonify({"success": False, "error": "Message required"})
        
        rasa_url = RASA_URL
        
        # Send to Rasa webhook
        response = requests.post(
            f"{rasa_url}/webhooks/rest/webhook",
            json={"sender": sender, "message": message},
            timeout=30
        )
        
        responses = response.json() if response.status_code == 200 else []
        
        # Also get NLU parse
        nlu_response = requests.post(
            f"{rasa_url}/model/parse",
            json={"text": message},
            timeout=10
        )
        
        nlu_data = nlu_response.json() if nlu_response.status_code == 200 else {}
        
        return jsonify({
            "success": True,
            "responses": responses,
            "nlu": nlu_data
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/inspector/conversations', methods=['GET'])
def inspector_list_conversations():
    """Get list of conversations with detailed info for inspector."""
    conn = None
    try:
        limit = request.args.get('limit', 100, type=int)
        app_id_filter    = request.args.get('app_id', None)
        has_handoff_filter = request.args.get('has_handoff', None)
        user_filter      = request.args.get('user', None)
        date_filter      = request.args.get('date', None)
        date_from_filter = request.args.get('date_from', None)
        date_to_filter   = request.args.get('date_to', None)
        ticket_filter    = request.args.get('ticket_status', None)

        conn = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Detect which optional tables/columns exist to keep the query safe across migrations
        cursor.execute("""
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('handoff_queue', 'operators')
        """)
        existing_tables = {r['table_name'] for r in cursor.fetchall()}
        has_handoff_table   = 'handoff_queue' in existing_tables
        has_operators_table = 'operators'      in existing_tables

        cursor.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'conversations'
              AND column_name IN ('user_id','user_name','ticket_id',
                                  'handoff_state','handoff_count','assigned_operator_id')
        """)
        existing_cols = {r['column_name'] for r in cursor.fetchall()}

        # Build SELECT list explicitly — no alias inside functions
        sel = [
            "c.id", "c.sender_id", "c.app_id",
            ("c.user_id"   if 'user_id'   in existing_cols else "NULL as user_id"),
            ("c.user_name" if 'user_name' in existing_cols else "NULL as user_name"),
            "c.started_at", "c.last_activity", "c.resolved",
            ("c.ticket_id" if 'ticket_id' in existing_cols else "NULL as ticket_id"),
            ("COALESCE(c.handoff_state, 'bot_active') as handoff_state"
             if 'handoff_state' in existing_cols else "'bot_active' as handoff_state"),
            ("COALESCE(c.handoff_count, 0) as handoff_count"
             if 'handoff_count' in existing_cols else "0 as handoff_count"),
            ("EXISTS(SELECT 1 FROM handoff_queue hq WHERE hq.conversation_id = c.id) as had_handoff"
             if has_handoff_table else "FALSE as had_handoff"),
            ("(SELECT o.display_name FROM operators o WHERE o.id = c.assigned_operator_id) as operator_name"
             if has_operators_table and 'assigned_operator_id' in existing_cols else "NULL as operator_name"),
            "(SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count",
            "(SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender = 'user') as user_message_count",
            "(SELECT COUNT(*) FROM actions WHERE conversation_id = c.id) as action_count",
            "(SELECT type FROM feedback WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as feedback",
        ]
        query = "SELECT " + ", ".join(sel) + " FROM conversations c"

        params = []
        conditions = []
        if app_id_filter:
            conditions.append("c.app_id = %s")
            params.append(app_id_filter)
        if has_handoff_filter == '1' and has_handoff_table:
            conditions.append("EXISTS (SELECT 1 FROM handoff_queue hq WHERE hq.conversation_id = c.id)")
        elif has_handoff_filter == '0' and has_handoff_table:
            conditions.append("NOT EXISTS (SELECT 1 FROM handoff_queue hq WHERE hq.conversation_id = c.id)")
        if user_filter and existing_cols & {'user_name', 'user_id'}:
            pattern = f"%{user_filter}%"
            parts = []
            if 'user_name' in existing_cols: parts.append("c.user_name ILIKE %s"); params.append(pattern)
            if 'user_id'   in existing_cols: parts.append("c.user_id ILIKE %s");   params.append(pattern)
            parts.append("c.sender_id ILIKE %s"); params.append(pattern)
            conditions.append("(" + " OR ".join(parts) + ")")
        if date_filter == '24h':
            conditions.append("c.started_at >= NOW() - INTERVAL '24 hours'")
        elif date_filter == '7d':
            conditions.append("c.started_at >= NOW() - INTERVAL '7 days'")
        elif date_filter == '30d':
            conditions.append("c.started_at >= NOW() - INTERVAL '30 days'")
        if date_from_filter:
            conditions.append("c.started_at >= %s"); params.append(date_from_filter)
        if date_to_filter:
            conditions.append("c.started_at <= %s"); params.append(date_to_filter + ' 23:59:59')
        if ticket_filter == 'none' and 'ticket_id' in existing_cols:
            conditions.append("(c.ticket_id IS NULL OR c.ticket_id = '')")
        elif ticket_filter in ('created', 'resolved', 'closed') and 'ticket_id' in existing_cols:
            conditions.append("c.ticket_id IS NOT NULL AND c.ticket_id != ''")
        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY c.id DESC LIMIT %s"
        params.append(limit)

        cursor.execute(query, tuple(params))
        conversations = []

        for row in cursor.fetchall():
            # Use user_name if available, then user_id, then shortened sender_id
            display_name = row.get('user_name') or row.get('user_id') or (row['sender_id'][:12] + "..." if row['sender_id'] and len(row['sender_id']) > 12 else row['sender_id'])
            conversations.append({
                "id": row['id'],
                "sender_id": row['sender_id'],
                "sender_id_short": row['sender_id'][:12] + "..." if row['sender_id'] and len(row['sender_id']) > 12 else row['sender_id'],
                "user_name": row.get('user_name'),
                "display_name": display_name,
                "app_id": row['app_id'] or "General",
                "user_id": row['user_id'],
                "started_at": row['started_at'].isoformat() if row['started_at'] else None,
                "last_activity": row['last_activity'].isoformat() if row['last_activity'] else None,
                "resolved": bool(row['resolved']),
                "handoff_state": row.get('handoff_state') or 'bot_active',
                "handoff_count": row.get('handoff_count') or 0,
                "had_handoff": bool(row.get('had_handoff')),
                "operator_name": row.get('operator_name'),
                "message_count": row['message_count'],
                "user_message_count": row['user_message_count'],
                "action_count": row['action_count'],
                "feedback": row['feedback']
            })
        
        return jsonify({"success": True, "data": conversations, "count": len(conversations)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            _release_connection(conn)


@app.route('/inspector/conversation/<sender_id>', methods=['GET'])
def inspector_get_conversation_detail(sender_id):
    """Get detailed conversation data including messages, intents, actions."""
    conn = None
    try:
        conn = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute('SELECT * FROM conversations WHERE sender_id = %s', (sender_id,))
        conv = cursor.fetchone()
        
        if not conv:
            return jsonify({"success": False, "error": "Conversation not found"}), 404
        
        conv_id = conv['id']
        
        # Get messages
        cursor.execute('''
            SELECT id, sender, text, intent, timestamp
            FROM messages WHERE conversation_id = %s ORDER BY timestamp ASC
        ''', (conv_id,))
        messages = []
        intent_history = []
        
        for row in cursor.fetchall():
            msg = {
                "id": row['id'], "sender": row['sender'], "text": row['text'],
                "intent": row['intent'],
                "timestamp": row['timestamp'].isoformat() if row['timestamp'] else None
            }
            messages.append(msg)
            if row['intent']:
                intent_history.append({
                    "intent": row['intent'],
                    "message": row['text'][:50] + "..." if row['text'] and len(row['text']) > 50 else row['text'],
                    "timestamp": row['timestamp'].isoformat() if row['timestamp'] else None
                })
        
        # Get actions
        cursor.execute('''
            SELECT action_name, success, timestamp
            FROM actions WHERE conversation_id = %s ORDER BY timestamp ASC
        ''', (conv_id,))
        actions = [{"action": row['action_name'], "success": bool(row['success']),
                    "timestamp": row['timestamp'].isoformat() if row['timestamp'] else None} 
                   for row in cursor.fetchall()]
        
        # Get feedback
        cursor.execute('SELECT type, timestamp FROM feedback WHERE conversation_id = %s ORDER BY timestamp ASC', (conv_id,))
        feedback = [{"type": row['type'], "timestamp": row['timestamp'].isoformat() if row['timestamp'] else None}
                    for row in cursor.fetchall()]

        # Get handoff sessions
        cursor.execute('''
            SELECT hq.id, hq.status, hq.trigger_reason, hq.queued_at, hq.assigned_at,
                   hq.resolved_at, hq.wait_time_secs, hq.handle_time_secs,
                   hq.return_to_bot, hq.closing_note, hq.agent_rating,
                   o.display_name as operator_name, o.username as operator_username
            FROM handoff_queue hq
            LEFT JOIN operators o ON o.id = hq.operator_id
            WHERE hq.conversation_id = %s
            ORDER BY hq.queued_at ASC
        ''', (conv_id,))
        handoff_sessions = []
        for row in cursor.fetchall():
            handoff_sessions.append({
                "id": row['id'],
                "status": row['status'],
                "trigger_reason": row['trigger_reason'],
                "operator_name": row.get('operator_name'),
                "operator_username": row.get('operator_username'),
                "queued_at": row['queued_at'].isoformat() if row['queued_at'] else None,
                "assigned_at": row['assigned_at'].isoformat() if row['assigned_at'] else None,
                "resolved_at": row['resolved_at'].isoformat() if row['resolved_at'] else None,
                "wait_time_secs": row.get('wait_time_secs'),
                "handle_time_secs": row.get('handle_time_secs'),
                "return_to_bot": row.get('return_to_bot'),
                "closing_note": row.get('closing_note'),
                "agent_rating": row.get('agent_rating'),
            })

        # Get operator messages and merge into the main message list
        cursor.execute('''
            SELECT om.message_text, om.sent_at, om.queue_id,
                   o.display_name as operator_name, o.username as operator_username
            FROM operator_messages om
            LEFT JOIN operators o ON o.id = om.operator_id
            WHERE om.conversation_id = %s
            ORDER BY om.sent_at ASC
        ''', (conv_id,))
        for row in cursor.fetchall():
            messages.append({
                "id": None,
                "sender": "operator",
                "operator_name": row.get('operator_name') or row.get('operator_username') or 'Agent',
                "text": row['message_text'],
                "intent": None,
                "timestamp": row['sent_at'].isoformat() if row['sent_at'] else None,
            })

        # Sort all messages (bot + user + operator) by timestamp
        messages.sort(key=lambda m: m['timestamp'] or '')

        return jsonify({
            "success": True,
            "data": {
                "conversation": {
                    "id": conv['id'], "sender_id": conv['sender_id'], "app_id": conv['app_id'],
                    "user_id": conv['user_id'],
                    "handoff_state": conv.get('handoff_state') or 'bot_active',
                    "handoff_count": conv.get('handoff_count') or 0,
                    "started_at": conv['started_at'].isoformat() if conv['started_at'] else None,
                    "last_activity": conv['last_activity'].isoformat() if conv['last_activity'] else None,
                    "resolved": bool(conv['resolved'])
                },
                "messages": messages, "intent_history": intent_history, "actions": actions,
                "feedback": feedback, "handoff_sessions": handoff_sessions,
                "stats": {
                    "total_messages": len(messages),
                    "user_messages": len([m for m in messages if m['sender'] == 'user']),
                    "bot_messages": len([m for m in messages if m['sender'] == 'bot']),
                    "operator_messages": len([m for m in messages if m['sender'] == 'operator']),
                    "actions_executed": len(actions),
                    "unique_intents": len(set(m['intent'] for m in messages if m['intent']))
                }
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            _release_connection(conn)


@app.route('/inspector/flows', methods=['GET'])
def inspector_get_flows():
    """Get all defined conversation flows from stories and rules."""
    try:
        flows = get_stories_and_rules()
        flow_diagrams = []
        
        for story in flows.get("stories", []):
            if isinstance(story, dict) and "story" in story:
                flow_diagrams.append({
                    "name": story.get("story", "Unknown"), "type": "story",
                    "steps": story.get("steps", [])
                })
        
        for rule in flows.get("rules", []):
            if isinstance(rule, dict) and "rule" in rule:
                flow_diagrams.append({
                    "name": rule.get("rule", "Unknown"), "type": "rule",
                    "steps": rule.get("steps", [])
                })
        
        return jsonify({"success": True, "data": flow_diagrams, "count": len(flow_diagrams)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/inspector/intents', methods=['GET'])
def inspector_get_intent_stats():
    """Get intent statistics."""
    conn = None
    try:
        conn = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute('''
            SELECT intent, COUNT(*) as count FROM messages 
            WHERE intent IS NOT NULL AND intent != '' GROUP BY intent ORDER BY count DESC
        ''')
        intent_distribution = {row['intent']: row['count'] for row in cursor.fetchall()}
        
        cursor.execute('''
            SELECT EXTRACT(HOUR FROM timestamp) as hour, COUNT(*) as count
            FROM messages WHERE intent IS NOT NULL AND timestamp > NOW() - INTERVAL '24 hours'
            GROUP BY EXTRACT(HOUR FROM timestamp) ORDER BY hour
        ''')
        hourly_activity = {int(row['hour']): row['count'] for row in cursor.fetchall()}
        
        domain = get_domain_info()
        
        return jsonify({
            "success": True,
            "data": {
                "distribution": intent_distribution, "hourly_activity": hourly_activity,
                "known_intents": domain["intents"],
                "total_intent_messages": sum(intent_distribution.values())
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            _release_connection(conn)


@app.route('/inspector/actions', methods=['GET'])
def inspector_get_action_stats():
    """Get action execution statistics."""
    conn = None
    try:
        conn = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute('''
            SELECT action_name, COUNT(*) as total,
                   SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
                   SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count
            FROM actions GROUP BY action_name ORDER BY total DESC
        ''')
        
        action_stats = []
        for row in cursor.fetchall():
            total = row['total']
            success = row['success_count'] or 0
            action_stats.append({
                "action": row['action_name'], "total": total, "success": success,
                "failure": row['failure_count'] or 0,
                "success_rate": round((success / total) * 100, 1) if total > 0 else 0
            })
        
        return jsonify({"success": True, "data": action_stats})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            _release_connection(conn)


@app.route('/inspector/domain', methods=['GET'])
def inspector_get_domain():
    """Get domain configuration (intents, entities, actions, slots)."""
    try:
        domain = get_domain_info()
        return jsonify({"success": True, "data": domain})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/inspector/health', methods=['GET'])
def inspector_health():
    """Inspector health check."""
    return jsonify({"status": "healthy", "service": "inspector-api", "timestamp": datetime.now().isoformat()})


# Health Check Endpoints for Observability
@app.route('/health/rasa', methods=['GET'])
def health_rasa():
    """Check if Rasa Core is running."""
    try:
        import requests
        response = requests.get(
            f'{RASA_URL}/status',
            headers={'Accept': 'application/json'},
            timeout=3
        )
        return jsonify({"healthy": response.status_code == 200, "service": "rasa-core"})
    except:
        return jsonify({"healthy": False, "service": "rasa-core"})


@app.route('/health/actions', methods=['GET'])
def health_actions():
    """Check if Action Server is running."""
    try:
        import requests
        action_health = ACTION_URL.replace('/webhook', '/health')
        response = requests.get(action_health, timeout=3)
        return jsonify({"healthy": response.status_code == 200, "service": "action-server"})
    except:
        return jsonify({"healthy": False, "service": "action-server"})


@app.route('/health/database', methods=['GET'])
def health_database():
    """Check if Database is accessible."""
    conn = None
    try:
        conn = _get_connection()
        cursor = conn.cursor()
        cursor.execute('SELECT 1')
        cursor.close()
        return jsonify({"healthy": True, "service": "database"})
    except:
        return jsonify({"healthy": False, "service": "database"})
    finally:
        if conn:
            _release_connection(conn)


@app.route('/observability/metrics', methods=['GET'])
def observability_metrics():
    """Get observability metrics."""
    conn = None
    try:
        conn = _get_connection()
        cursor = conn.cursor()
        
        # Get response time stats from last 1000 messages
        cursor.execute('''
            SELECT AVG(EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (PARTITION BY conversation_id ORDER BY timestamp))))
            FROM messages 
            WHERE sender = 'bot' 
            LIMIT 1000
        ''')
        avg_response = cursor.fetchone()[0] or 0
        
        # Get throughput (messages per minute in last hour)
        cursor.execute('''
            SELECT COUNT(*) 
            FROM messages 
            WHERE timestamp > NOW() - INTERVAL '1 hour'
        ''')
        hourly_messages = cursor.fetchone()[0] or 0
        throughput = round(hourly_messages / 60, 2)
        
        # Get error rate from actions table
        cursor.execute('''
            SELECT 
                COUNT(*) FILTER (WHERE status = 'error') as errors,
                COUNT(*) as total
            FROM actions
            WHERE timestamp > NOW() - INTERVAL '24 hours'
        ''')
        result = cursor.fetchone()
        errors = result[0] if result[0] else 0
        total = result[1] if result[1] else 1
        error_rate = round((errors / total) * 100, 2) if total > 0 else 0
        
        return jsonify({
            "success": True,
            "data": {
                "avg_response_time": round(avg_response * 1000, 0) if avg_response else 100,  # ms
                "throughput": throughput,
                "error_rate": f"{error_rate}%",
                "healthy_services": 3  # TODO: count actual healthy services
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            _release_connection(conn)


# ============================================================================
# INSPECTOR DEBUG APIs - Real-time Debugging
# ============================================================================

@app.route('/inspector/parse', methods=['POST'])
def inspector_parse_message():
    """Parse a message through Rasa NLU and return intent/entity analysis."""
    try:
        from admin.api.rasa_debug import parse_message
        
        data = request.get_json()
        text = data.get('text', '')
        sender_id = data.get('sender_id', 'debug_user')
        
        if not text:
            return jsonify({"success": False, "error": "Text is required"})
        
        result = parse_message(text, sender_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/inspector/conversation/<sender_id>/debug', methods=['GET'])
def inspector_conversation_debug(sender_id):
    """Get detailed debug information for a conversation including NLU results and slot changes."""
    try:
        from admin.api.rasa_debug import get_conversation_debug
        
        result = get_conversation_debug(sender_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/inspector/conversation/<sender_id>/tracker', methods=['GET'])
def inspector_conversation_tracker(sender_id):
    """Get current tracker state (slots, active loop, latest action)."""
    try:
        from admin.api.rasa_debug import get_tracker
        
        result = get_tracker(sender_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/inspector/domain/info', methods=['GET'])
def inspector_domain_info():
    """Get Rasa domain information (intents, entities, slots, actions)."""
    try:
        from admin.api.rasa_debug import get_domain_info
        
        result = get_domain_info()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


# ============================================================================
# USER HISTORY APIs - Chat widget conversation history
# ============================================================================

@app.route('/api/user/conversations', methods=['GET'])
def user_get_conversations():
    """Get conversation history list for a specific user (for chat widget history panel)."""
    conn = None
    try:
        user_name = request.args.get('user_name', '').strip()
        app_id_filter = request.args.get('app_id', '').strip()

        if not user_name:
            return jsonify({"success": False, "error": "user_name is required"}), 400

        conn = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        print(f"[HISTORY DEBUG] Looking for conversations - user_name: {user_name}, app_id: {app_id_filter}")

        # First, let's see ALL conversations for this app to debug
        if app_id_filter:
            cursor.execute('SELECT sender_id, user_name, user_id, app_id FROM conversations WHERE app_id = %s LIMIT 20', (app_id_filter,))
        else:
            cursor.execute('SELECT sender_id, user_name, user_id, app_id FROM conversations LIMIT 20')

        all_convs = cursor.fetchall()
        print(f"[HISTORY DEBUG] ALL conversations in DB (app={app_id_filter}): {len(all_convs)} total")
        for c in all_convs:
            print(f"[HISTORY DEBUG]   - sender_id={c.get('sender_id')}, user_name={c.get('user_name')}, user_id={c.get('user_id')}, app_id={c.get('app_id')}")

        query = '''
            SELECT
                c.sender_id,
                c.started_at,
                c.last_activity,
                c.user_name,
                c.user_id,
                c.app_id,
                (
                    SELECT COUNT(*) FROM messages m
                    WHERE m.conversation_id = c.id
                ) as msg_count,
                (
                    SELECT m.text FROM messages m
                    WHERE m.conversation_id = c.id AND m.sender = 'user'
                    ORDER BY m.timestamp ASC LIMIT 1
                ) as preview,
                (
                    SELECT f.rating FROM feedback f
                    WHERE f.conversation_id = c.id
                    ORDER BY f.timestamp DESC LIMIT 1
                ) as rating
            FROM conversations c
            WHERE (c.user_name = %s OR c.user_id = %s)
        '''
        params = [user_name, user_name]

        if app_id_filter:
            query += ' AND c.app_id = %s'
            params.append(app_id_filter)

        query += ' ORDER BY c.started_at DESC LIMIT 50'
        print(f"[HISTORY DEBUG] Query params: {params}")
        cursor.execute(query, tuple(params))

        all_rows = cursor.fetchall()
        print(f"[HISTORY DEBUG] Found {len(all_rows)} matching conversations")
        for row in all_rows:
            print(f"[HISTORY DEBUG] Conv: sender_id={row['sender_id']}, user_name={row.get('user_name')}, user_id={row.get('user_id')}, app_id={row.get('app_id')}, msg_count={row.get('msg_count')}, has_preview={bool(row['preview'])}")

        conversations = []
        for row in all_rows:
            if not row['preview']:
                print(f"[HISTORY DEBUG] Skipping conv {row['sender_id']} - no user message preview (msg_count={row.get('msg_count')})")
                continue
            conversations.append({
                'sender_id': row['sender_id'],
                'started_at': row['started_at'].isoformat() if row['started_at'] else None,
                'last_activity': row['last_activity'].isoformat() if row['last_activity'] else None,
                'preview': (row['preview'] or '')[:100],
                'rating': row.get('rating')
            })

        print(f"[HISTORY DEBUG] Returning {len(conversations)} conversations to client")
        return jsonify({'success': True, 'data': conversations})
    except Exception as e:
        print(f"[HISTORY DEBUG] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            _release_connection(conn)


@app.route('/api/user/conversation/<sender_id>/messages', methods=['GET'])
def user_get_conversation_messages(sender_id):
    """Get all messages for a conversation (read-only history view in chat widget)."""
    conn = None
    try:
        conn = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        cursor.execute('SELECT id FROM conversations WHERE sender_id = %s', (sender_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'success': True, 'data': []})

        cursor.execute('''
            SELECT sender, text, timestamp
            FROM messages
            WHERE conversation_id = %s
            ORDER BY timestamp ASC
        ''', (row['id'],))

        messages = [
            {
                'id': f'hist-{i}',
                'sender': m['sender'],
                'text': m['text'] or '',
                'timestamp': m['timestamp'].isoformat() if m['timestamp'] else None
            }
            for i, m in enumerate(cursor.fetchall())
        ]

        return jsonify({'success': True, 'data': messages})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            _release_connection(conn)


@app.route('/api/user/session/feedback', methods=['POST'])
def save_session_feedback():
    """Save session feedback with rating and comments.

    Accepts optional queue_id to also stamp handoff_queue.agent_rating so
    the operator sees the user's rating in the session history.
    """
    try:
        from common.conversation_db import log_feedback

        data = request.get_json()
        sender_id = data.get('sender_id', '').strip()
        rating    = data.get('rating')
        comments  = data.get('comments', '').strip()
        app_id    = data.get('app_id', 'General')
        user_id   = data.get('user_id')
        queue_id  = data.get('queue_id')

        if not sender_id:
            return jsonify({'success': False, 'error': 'sender_id is required'}), 400

        if rating and (not isinstance(rating, int) or rating < 1 or rating > 5):
            return jsonify({'success': False, 'error': 'rating must be between 1 and 5'}), 400

        # Determine feedback type based on rating
        feedback_type = 'positive' if rating and rating >= 4 else 'negative' if rating else 'neutral'

        # Save to feedback log
        log_feedback(
            sender_id=sender_id,
            feedback_type=feedback_type,
            app_id=app_id,
            user_id=user_id,
            rating=rating,
            comments=comments
        )

        # Also stamp handoff_queue.agent_rating so operator sees it in history
        if queue_id and rating:
            try:
                conn = _get_connection()
                try:
                    cursor = conn.cursor()
                    cursor.execute(
                        "UPDATE handoff_queue SET agent_rating = %s WHERE id = %s",
                        (int(rating), int(queue_id))
                    )
                    conn.commit()
                finally:
                    _release_connection(conn)
            except Exception as _re:
                print(f"[feedback] could not update handoff_queue rating (non-fatal): {_re}")

        return jsonify({'success': True, 'message': 'Feedback saved successfully'})
    except Exception as e:
        print(f"Error saving feedback: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# ============================================================================
# STUDIO APIs - No-Code Editor
# ============================================================================

@app.route('/admin/studio/nlu', methods=['GET'])
def studio_get_nlu():
    """Get all NLU training data organized by intent."""
    try:
        from admin.api.training_manager import get_nlu_data
        
        result = get_nlu_data()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/nlu/example', methods=['POST'])
def studio_add_nlu_example():
    """Add a new NLU training example."""
    try:
        from admin.api.training_manager import add_nlu_example
        
        data = request.get_json()
        intent = data.get('intent')
        text = data.get('text')
        
        if not intent or not text:
            return jsonify({"success": False, "error": "Intent and text are required"})
        
        result = add_nlu_example(intent, text)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/nlu/example', methods=['DELETE'])
def studio_delete_nlu_example():
    """Delete an NLU training example."""
    try:
        from admin.api.training_manager import delete_nlu_example
        
        data = request.get_json()
        intent = data.get('intent')
        text = data.get('text')
        
        if not intent or not text:
            return jsonify({"success": False, "error": "Intent and text are required"})
        
        result = delete_nlu_example(intent, text)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/stories', methods=['GET'])
def studio_get_stories():
    """Get all stories and rules."""
    try:
        from admin.api.training_manager import get_stories_data
        
        result = get_stories_data()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/responses', methods=['GET'])
def studio_get_responses():
    """Get all response templates from domain."""
    try:
        from admin.api.training_manager import get_domain_responses
        
        result = get_domain_responses()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/train', methods=['POST'])
def studio_start_training():
    """Start model training in background."""
    try:
        from admin.api.training_manager import start_training
        
        result = start_training()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/train/<job_id>', methods=['GET'])
def studio_training_status(job_id):
    """Get training job status."""
    try:
        from admin.api.training_manager import get_training_status
        
        result = get_training_status(job_id)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/admin/studio/models', methods=['GET'])
def studio_list_models():
    """List available trained models."""
    try:
        from admin.api.training_manager import get_available_models
        
        result = get_available_models()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/observability/logs', methods=['GET'])
def observability_logs():
    """Get recent system logs."""
    try:
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
        logs = []
        
        # Read recent error logs if available
        error_log = os.path.join(log_dir, 'action_server.err')
        if os.path.exists(error_log):
            with open(error_log, 'r') as f:
                lines = f.readlines()
                logs.extend(lines[-20:])  # Last 20 lines
        
        return jsonify({"success": True, "data": logs})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []})


# ============================================================================
# OBSERVABILITY APIs - Real Monitoring
# ============================================================================

@app.route('/observability/processes', methods=['GET'])
def observability_processes():
    """Get detailed status of all Rasa-related processes."""
    try:
        from admin.api.process_monitor import get_all_service_processes, get_system_resources, ensure_collector_running
        ensure_collector_running()
        
        processes = get_all_service_processes()
        system = get_system_resources()
        
        return jsonify({
            "success": True,
            "data": {
                "services": processes,
                "system": system
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/observability/metrics/history', methods=['GET'])
def observability_metrics_history():
    """Get historical metrics for charts."""
    try:
        from admin.api.process_monitor import get_metrics_history, ensure_collector_running
        ensure_collector_running()
        
        points = request.args.get('points', 60, type=int)
        history = get_metrics_history(points)
        
        return jsonify({
            "success": True,
            "data": history
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/observability/logs/filtered', methods=['GET'])
def observability_logs_filtered():
    """Get filtered logs from all log files."""
    try:
        from admin.api.log_parser import get_all_logs
        
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
        level = request.args.get('level', None)
        max_lines = request.args.get('limit', 100, type=int)
        
        logs = get_all_logs(log_dir, max_lines=max_lines, level_filter=level)
        
        return jsonify({
            "success": True,
            "data": logs
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []})


@app.route('/observability/logs/search', methods=['GET'])
def observability_logs_search():
    """Search logs for a query string."""
    try:
        from admin.api.log_parser import search_logs
        
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
        query = request.args.get('q', '')
        max_results = request.args.get('limit', 50, type=int)
        
        if not query:
            return jsonify({"success": False, "error": "Query parameter 'q' is required"})
        
        results = search_logs(log_dir, query, max_results)
        
        return jsonify({
            "success": True,
            "data": results,
            "query": query
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "data": []})


@app.route('/observability/logs/stats', methods=['GET'])
def observability_logs_stats():
    """Get log file statistics."""
    try:
        from admin.api.log_parser import get_log_stats
        
        log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'Log')
        stats = get_log_stats(log_dir)
        
        return jsonify({
            "success": True,
            "data": stats
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/observability/database/stats', methods=['GET'])
def observability_database_stats():
    """Get database connection and table statistics."""
    try:
        from common.conversation_db import get_connection
        
        conn = get_connection()
        if not conn:
            return jsonify({
                "success": False,
                "error": "Could not connect to database"
            })
        
        cursor = conn.cursor()
        
        # Get table sizes
        tables = {}
        for table in ['conversations', 'messages', 'feedback', 'actions', 'themes', 'apps']:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM {table}")
                tables[table] = cursor.fetchone()[0]
            except:
                tables[table] = 0
        
        # Get recent activity
        cursor.execute("""
            SELECT COUNT(*) FROM messages 
            WHERE created_at > NOW() - INTERVAL '1 hour'
        """)
        messages_last_hour = cursor.fetchone()[0]
        
        cursor.execute("""
            SELECT COUNT(*) FROM conversations 
            WHERE created_at > NOW() - INTERVAL '24 hours'
        """)
        conversations_today = cursor.fetchone()[0]
        
        # Get average response time (from message pairs)
        cursor.execute("""
            WITH user_messages AS (
                SELECT sender_id, created_at, ROW_NUMBER() OVER (PARTITION BY sender_id ORDER BY created_at) as rn
                FROM messages WHERE role = 'user'
            ),
            bot_messages AS (
                SELECT sender_id, created_at, ROW_NUMBER() OVER (PARTITION BY sender_id ORDER BY created_at) as rn
                FROM messages WHERE role = 'assistant'
            )
            SELECT AVG(EXTRACT(EPOCH FROM (b.created_at - u.created_at)) * 1000)::INT as avg_ms
            FROM user_messages u
            JOIN bot_messages b ON u.sender_id = b.sender_id AND u.rn = b.rn
            WHERE b.created_at > u.created_at
            AND b.created_at - u.created_at < INTERVAL '1 minute'
        """)
        result = cursor.fetchone()
        avg_response_ms = result[0] if result and result[0] else 0
        
        cursor.close()
        conn.close()
        
        return jsonify({
            "success": True,
            "data": {
                "tables": tables,
                "total_rows": sum(tables.values()),
                "activity": {
                    "messages_last_hour": messages_last_hour,
                    "conversations_today": conversations_today
                },
                "performance": {
                    "avg_response_ms": avg_response_ms
                }
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route('/handoff/status/<sender_id>', methods=['GET'])
def handoff_status(sender_id):
    """
    Widget calls this on every page load / Socket.IO reconnect to restore
    handoff state without waiting for a push event.

    Returns the current handoff state plus enough context for the widget
    to re-render queue banners, typing indicator, etc.

    No auth required — sender_id is the opaque UUID generated by the widget.
    """
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor as _RDC
            cur = conn.cursor(cursor_factory=_RDC)

            # Current conversation state
            cur.execute(
                "SELECT id, handoff_state, assigned_operator_id "
                "FROM conversations WHERE sender_id = %s",
                (sender_id,)
            )
            conv = cur.fetchone()
            if not conv:
                return jsonify({'handoff_state': 'bot_active'})

            state = conv.get('handoff_state') or 'bot_active'

            if state == 'queued':
                cur.execute(
                    "SELECT hq.id, hq.queue_position, hq.queued_at "
                    "FROM handoff_queue hq "
                    "WHERE hq.sender_id = %s AND hq.status = 'waiting' "
                    "ORDER BY hq.queued_at DESC LIMIT 1",
                    (sender_id,)
                )
                q = cur.fetchone()
                if not q:
                    # Queue row missing — heal conversation state
                    cur.execute(
                        "UPDATE conversations SET handoff_state = 'bot_active', "
                        "assigned_operator_id = NULL WHERE id = %s",
                        (conv['id'],)
                    )
                    conn.commit()
                    return jsonify({'handoff_state': 'bot_active'})

                # Estimate wait time
                cfg = get_handoff_runtime_config_for_api()
                avg_handle = float(cfg.get('queue', {}).get('avg_handle_time_mins', 8))
                pos = q.get('queue_position') or 1
                wait_mins = round(pos * avg_handle)

                return jsonify({
                    'handoff_state':  'queued',
                    'queue_position': pos,
                    'wait_mins':      wait_mins,
                })

            if state == 'assigned':
                operator_name = None
                if conv.get('assigned_operator_id'):
                    cur.execute(
                        "SELECT display_name FROM operators WHERE id = %s",
                        (conv['assigned_operator_id'],)
                    )
                    op = cur.fetchone()
                    if op:
                        operator_name = op['display_name']
                return jsonify({
                    'handoff_state': 'assigned',
                    'operator_name': operator_name,
                })

            return jsonify({'handoff_state': state})
        finally:
            _release_connection(conn)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/handoff/end', methods=['POST'])
def handoff_end():
    """
    REST endpoint called by chat widget / mobile app when user logs out or
    ends their session.  Resolves any active handoff for the given sender_id
    and notifies the assigned operator.
    """
    try:
        from datetime import datetime as _dt
        data = request.get_json(silent=True) or {}
        sender_id = (data.get('sender_id') or '').strip()
        if not sender_id:
            return jsonify({'error': 'sender_id required'}), 400

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor as _RDC
            cur = conn.cursor(cursor_factory=_RDC)
            cur.execute(
                "SELECT hq.id, hq.status, hq.conversation_id, hq.operator_id "
                "FROM handoff_queue hq "
                "JOIN conversations c ON c.id = hq.conversation_id "
                "WHERE c.sender_id = %s AND hq.status IN ('waiting', 'assigned') "
                "ORDER BY hq.queued_at DESC LIMIT 1",
                (sender_id,)
            )
            row = cur.fetchone()
            if not row:
                return jsonify({'success': True, 'detail': 'no active handoff'})

            queue_id  = row['id']
            conv_id   = row['conversation_id']
            op_id     = row['operator_id']
            was_assigned = row['status'] == 'assigned'

            if was_assigned:
                # User left mid-chat — mark abandoned, NOT resolved.
                # 'resolved' is set ONLY when operator clicks "Resolve".
                cur.execute(
                    "UPDATE handoff_queue "
                    "SET status = 'abandoned', abandoned_at = %s, closing_note = 'User ended session', "
                    "handle_time_secs = EXTRACT(EPOCH FROM (NOW() - assigned_at))::INT "
                    "WHERE id = %s",
                    (_dt.now(), queue_id)
                )
                new_state = 'closed'
            else:
                cur.execute(
                    "UPDATE handoff_queue "
                    "SET status = 'abandoned', abandoned_at = %s, closing_note = 'User left queue' "
                    "WHERE id = %s",
                    (_dt.now(), queue_id)
                )
                new_state = 'bot_active'

            cur.execute(
                "UPDATE conversations SET handoff_state = %s, assigned_operator_id = NULL "
                "WHERE id = %s",
                (new_state, conv_id)
            )
            cur.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
                "VALUES (%s, %s, %s, 'user', NULL, 'User ended session')",
                (conv_id, 'assigned' if was_assigned else 'queued', new_state)
            )
            conn.commit()
        finally:
            _release_connection(conn)

        # Notify operator via Socket.IO
        if was_assigned and op_id:
            _sio.emit('user_left', {
                'conversation_id': conv_id,
                'sender_id':       sender_id,
                'message':         'The user has ended the conversation.',
            }, room=_room_operator(op_id))

        _sio.emit('queue_item_removed', {
            'queue_id': queue_id,
            'status': 'abandoned'
        }, room='queue_overview')
        _emit_queue_overview()

        return jsonify({'success': True, 'was_assigned': was_assigned})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/webhooks/rest/webhook', methods=['POST'])
def chat_webhook_proxy():
    """
    Proxy endpoint for chat messages that automatically logs all bot responses.
    This captures ALL bot messages (from actions AND templates) and logs them to the database.

    HANDOFF PASSIVE MODE GATE:
    When a conversation is in 'queued' or 'assigned' state, the message is logged
    but NOT forwarded to Rasa. In 'assigned' state it is relayed to the operator.
    This keeps the bot completely silent during human handoff.
    """
    try:
        import requests
        from common.conversation_db import log_conversation_start, log_message

        data = request.get_json()
        sender_id = data.get('sender', 'unknown')
        message_text = data.get('message', '')
        metadata = data.get('metadata', {})

        # Auto Assist draft calls use __draft__ prefix — proxy to Rasa but skip all DB logging
        if sender_id.startswith('__draft__'):
            try:
                r = requests.post(f"{RASA_URL}/webhooks/rest/webhook", json=data, timeout=10)
                return jsonify(r.json()), r.status_code
            except Exception:
                return jsonify([]), 200

        # Extract context from metadata
        app_id = metadata.get('app_id', 'General')
        user_id = metadata.get('user_id', None)
        user_name = metadata.get('user_name', None)
        ticket_id = metadata.get('ticket_id', None)

        # Store client technical metadata on first message (used in Context Package)
        client_meta = {
            k: metadata.get(k, '')
            for k in ('browser', 'os', 'device_type', 'page_url', 'device_id')
            if metadata.get(k)
        }

        # ── HANDOFF PASSIVE MODE GATE ─────────────────────────────────────────
        # Check handoff_state BEFORE logging or forwarding.
        # Use a safe fallback — if DB is unavailable, default to bot_active.
        handoff_state = 'bot_active'
        try:
            conn = _get_connection()
            try:
                from psycopg2.extras import RealDictCursor as _RDC
                _cur = conn.cursor(cursor_factory=_RDC)
                _cur.execute(
                    "SELECT id, handoff_state, assigned_operator_id "
                    "FROM conversations WHERE sender_id = %s",
                    (sender_id,)
                )
                _row = _cur.fetchone()
                if _row:
                    handoff_state = _row.get('handoff_state') or 'bot_active'
                    # Store client metadata if not already stored
                    if client_meta:
                        _cur.execute(
                            "UPDATE conversations SET client_metadata = %s "
                            "WHERE id = %s AND client_metadata IS NULL",
                            (json.dumps(client_meta), _row['id'])
                        )
                        conn.commit()
            finally:
                _release_connection(conn)
        except Exception as _gate_err:
            print(f"[Handoff gate] DB check failed (safe default bot_active): {_gate_err}")
            handoff_state = 'bot_active'

        # Always allow /login through — user must be able to re-authenticate
        # regardless of handoff state
        is_login = message_text.strip().startswith('/login')

        if handoff_state == 'queued' and not is_login:
            # Log the message but do NOT forward to Rasa. Return holding message.
            log_conversation_start(sender_id, app_id, user_id=user_id, user_name=user_name)
            log_message(sender_id, 'user', message_text, intent=None,
                        app_id=app_id, user_id=user_id, ticket_id=ticket_id)
            return jsonify([{
                "text": "⏳ You are in the queue. An agent will be with you shortly."
            }]), 200

        if handoff_state == 'assigned' and not is_login:
            # Log and relay to operator in real-time via Socket.IO.
            log_conversation_start(sender_id, app_id, user_id=user_id, user_name=user_name)
            log_message(sender_id, 'user', message_text, intent=None,
                        app_id=app_id, user_id=user_id, ticket_id=ticket_id)
            # Look up the assigned operator and emit to their room.
            try:
                _proxy_conn = _get_connection()
                try:
                    from psycopg2.extras import RealDictCursor as _PRDC
                    _proxy_cur = _proxy_conn.cursor(cursor_factory=_PRDC)
                    _proxy_cur.execute(
                        "SELECT id, assigned_operator_id FROM conversations WHERE sender_id = %s",
                        (sender_id,)
                    )
                    _proxy_row = _proxy_cur.fetchone()
                finally:
                    _release_connection(_proxy_conn)
                if _proxy_row and _proxy_row.get('assigned_operator_id'):
                    _emit_to_operator(_proxy_row['assigned_operator_id'], 'user_message', {
                        'conversation_id': _proxy_row['id'],
                        'sender_id':       sender_id,
                        'text':            message_text,
                        'timestamp':       _sio_dt.now().isoformat(),
                    })
                    # Also push to any admin watching this conversation
                    _sio.emit('live_message', {
                        'conversation_id': _proxy_row['id'],
                        'sender':          'user',
                        'text':            message_text,
                        'timestamp':       _sio_dt.now().isoformat(),
                    }, room=_room_admin_watch(_proxy_row['id']))
            except Exception as _relay_err:
                print(f"[SIO relay] assigned relay error (non-fatal): {_relay_err}")
            return jsonify([]), 200
        # ── END PASSIVE MODE GATE ─────────────────────────────────────────────

        # Log the user message
        log_conversation_start(sender_id, app_id, user_id=user_id, user_name=user_name)
        log_message(sender_id, 'user', message_text, intent=None,
                    app_id=app_id, user_id=user_id, ticket_id=ticket_id)

        # Forward to Rasa (normal bot_active flow)
        rasa_response = requests.post(
            f"{RASA_URL}/webhooks/rest/webhook",
            json=data,
            timeout=30
        )

        bot_responses = rasa_response.json() if rasa_response.status_code == 200 else []

        # ── STRIP SPURIOUS FALLBACK ────────────────────────────────────────────
        # Rasa's RulePolicy sometimes appends the default fallback message
        # (utter_default / utter_please_rephrase) alongside real action
        # responses (e.g., GDPR consent, queue confirmation, handoff flow).
        # When the response already contains other meaningful messages, the
        # fallback is noise — strip it.
        _FALLBACK_PREFIXES = (
            "I'm not sure I understand",
            "I\u2019m not sure I understand",
            "I'm sorry, I didn't verify",
        )
        if len(bot_responses) > 1:
            filtered = [
                r for r in bot_responses
                if not any(r.get('text', '').startswith(p) for p in _FALLBACK_PREFIXES)
            ]
            # Only use filtered list if we still have real responses left
            if filtered:
                bot_responses = filtered
        # ── END STRIP SPURIOUS FALLBACK ───────────────────────────────────────

        # Log ALL bot responses
        for response in bot_responses:
            response_text = response.get('text', '')
            if response_text:
                log_message(sender_id, 'bot', response_text, intent=None,
                            app_id=app_id, user_id=user_id, ticket_id=ticket_id)

        # Log actions from Rasa tracker in a background thread (non-blocking)
        def _log_actions_async(sid, a_app_id, a_user_id, a_ticket_id):
            try:
                from common.conversation_db import log_action as _log_action
                tr = requests.get(f"{RASA_URL}/conversations/{sid}/tracker", timeout=3)
                if tr.status_code != 200:
                    return
                events = tr.json().get('events', [])
                # Walk events backwards from the end; collect action events
                # until we hit the last user message event.
                recent_actions = []
                for ev in reversed(events):
                    if ev.get('event') == 'user':
                        break
                    if ev.get('event') == 'action':
                        name = ev.get('name', '')
                        # Skip internal Rasa bookkeeping actions
                        if name and name not in ('action_session_start', 'action_listen'):
                            recent_actions.append(name)
                for action_name in recent_actions:
                    _log_action(sid, action_name, success=True,
                                app_id=a_app_id, user_id=a_user_id, ticket_id=a_ticket_id)
            except Exception:
                pass
        import threading
        threading.Thread(
            target=_log_actions_async,
            args=(sender_id, app_id, user_id, ticket_id),
            daemon=True
        ).start()

        return jsonify(bot_responses), rasa_response.status_code

    except Exception as e:
        print(f"Error in chat_webhook_proxy: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500



# ============================================================================
# RASA STUDIO APIs
# ============================================================================

@app.route('/admin/studio/files', methods=['GET'])
def studio_list_files():
    """List editable files."""
    try:
        files = studio_service.get_editable_files()
        return jsonify({"success": True, "files": files})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/admin/studio/file', methods=['GET', 'POST'])
def studio_manage_file():
    """Read or write a file."""
    try:
        filename = request.args.get('file') if request.method == 'GET' else request.json.get('file')
        if not filename:
            return jsonify({"success": False, "error": "Filename required"}), 400

        if request.method == 'GET':
            content = studio_service.read_file(filename)
            if content is None:
                return jsonify({"success": False, "error": "File not found"}), 404
            return jsonify({"success": True, "content": content})
            
        elif request.method == 'POST':
            content = request.json.get('content')
            if content is None:
                return jsonify({"success": False, "error": "Content required"}), 400
            
            studio_service.write_file(filename, content)
            return jsonify({"success": True, "message": "File saved successfully"})
            
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 403
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/admin/studio/history', methods=['GET'])
def studio_file_history():
    """Get backup history for a file."""
    try:
        filename = request.args.get('file')
        if not filename:
            return jsonify({"success": False, "error": "Filename required"}), 400
            
        history = studio_service.get_history(filename)
        return jsonify({"success": True, "history": history})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/admin/studio/restore', methods=['POST'])
def studio_restore_backup():
    """Restore a file from backup."""
    try:
        data = request.json
        filename = data.get('file')
        backup = data.get('backup')
        
        if not filename or not backup:
            return jsonify({"success": False, "error": "Filename and backup required"}), 400
            
        studio_service.restore_backup(filename, backup)
        return jsonify({"success": True, "message": "File restored successfully"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/admin/studio/train', methods=['POST'])
def studio_train_model():
    """Trigger model training."""
    try:
        started = studio_service.train_model()
        if started:
            return jsonify({"success": True, "message": "Training started"})
        else:
            return jsonify({"success": False, "error": "Training already in progress"}), 409
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/admin/studio/train/status', methods=['GET'])
def studio_train_status():
    """Get training status."""
    try:
        status = studio_service.get_training_status()
        return jsonify({"success": True, "status": status})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/admin/studio/stats', methods=['GET'])
def studio_stats():
    """Get project statistics."""
    try:
        stats = studio_service.get_project_stats()
        return jsonify({"success": True, "data": stats})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ======================================================================
# HANDOFF — PHASE 1 ENDPOINTS
# Operator auth, internal queue helpers, admin operator CRUD,
# and handoff config management.
# All JWT/config values come from get_handoff_config() — nothing hardcoded.
# ======================================================================

import hashlib
import hmac
import base64
import re as _re
from functools import wraps

# ── JWT helpers (no external dependency — pure stdlib) ─────────────────

def _jwt_encode(payload: dict, secret: str) -> str:
    """Minimal HS256 JWT encoder (stdlib only, no PyJWT required)."""
    import time
    header = base64.urlsafe_b64encode(
        json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    ).rstrip(b'=').decode()
    payload.setdefault('iat', int(time.time()))
    body = base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).rstrip(b'=').decode()
    sig_input = f"{header}.{body}".encode()
    sig = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), sig_input, hashlib.sha256).digest()
    ).rstrip(b'=').decode()
    return f"{header}.{body}.{sig}"


def _jwt_decode(token: str, secret: str) -> Optional[dict]:
    """Decode and verify a HS256 JWT. Returns payload dict or None if invalid."""
    import time
    try:
        parts = token.split('.')
        if len(parts) != 3:
            return None
        header_b, body_b, sig_b = parts
        sig_input = f"{header_b}.{body_b}".encode()
        expected_sig = base64.urlsafe_b64encode(
            hmac.new(secret.encode(), sig_input, hashlib.sha256).digest()
        ).rstrip(b'=').decode()
        if not hmac.compare_digest(sig_b, expected_sig):
            return None
        # Pad body for base64 decoding
        padding = 4 - len(body_b) % 4
        payload = json.loads(base64.urlsafe_b64decode(body_b + '=' * padding))
        # Check expiry
        if 'exp' in payload and payload['exp'] < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def _get_operator_jwt_secret() -> str:
    from common.config_manager import get_handoff_config
    return get_handoff_config()['operator_jwt_secret']


def _get_operator_jwt_expiry_hours() -> int:
    from common.config_manager import get_handoff_config
    return int(get_handoff_config().get('operator_jwt_expiry_hours', 24))


def _require_operator_token(f):
    """Decorator: validates operator JWT, injects operator_id into kwargs."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid Authorization header'}), 401
        token = auth[7:]
        payload = _jwt_decode(token, _get_operator_jwt_secret())
        if not payload or payload.get('type') != 'operator':
            return jsonify({'error': 'Invalid or expired token'}), 401
        kwargs['_operator_id'] = payload['sub']
        kwargs['_operator_username'] = payload.get('username', '')
        return f(*args, **kwargs)
    return decorated


def _require_admin_token(f):
    """Decorator: validates admin session (reuses existing admin auth pattern)."""
    @wraps(f)
    def decorated(*args, **kwargs):
        # Reuse the same admin auth mechanism used elsewhere in this file
        # Check for admin JWT in Authorization header or session cookie
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            token = auth[7:]
            payload = _jwt_decode(token, _get_operator_jwt_secret())
            if payload and payload.get('type') == 'admin':
                kwargs['_admin_username'] = payload.get('username', 'admin')
                return f(*args, **kwargs)
        # Fallback: allow if running in local/dev profile (no strict admin auth yet)
        from common.config_manager import get_profile
        if get_profile() == 'local':
            kwargs['_admin_username'] = 'dev_admin'
            return f(*args, **kwargs)
        return jsonify({'error': 'Admin authentication required'}), 401
    return decorated


# ── Password hashing (stdlib only) ────────────────────────────────────

def _hash_password(plain: str) -> str:
    """SHA-256 + salt password hash. Use bcrypt in a future security hardening pass."""
    salt = os.urandom(16).hex()
    h = hashlib.sha256(f"{salt}{plain}".encode()).hexdigest()
    return f"{salt}:{h}"


def _verify_password(plain: str, stored: str) -> bool:
    try:
        salt, h = stored.split(':', 1)
        return hmac.compare_digest(
            hashlib.sha256(f"{salt}{plain}".encode()).hexdigest(), h
        )
    except Exception:
        return False


# ── Operator auth endpoints ────────────────────────────────────────────

@app.route('/operator/login', methods=['POST'])
def operator_login():
    """
    Authenticate an operator and return a JWT token.

    Authentication flow:
    1. Authenticate credentials against GLPI (the sole auth source).
    2. Verify the user belongs to the required GLPI support group.
    3. Auto-create / update the local operator record (used only for
       metadata, JWT subject ID, and chat history — NOT for password checks).
    4. Issue a signed JWT on success.
    """
    import time, asyncio
    try:
        data = request.get_json(silent=True) or {}
        username = (data.get('username') or '').strip().lower()
        password = data.get('password') or ''
        if not username or not password:
            return jsonify({'error': 'username and password required'}), 400

        # ── Authenticate via GLPI ─────────────────────────────────────────────
        hcfg = get_handoff_config_for_login()
        required_group = (hcfg.get('glpi_support_group_name') or 'Support').strip()
        glpi_cfg     = get_glpi_config()
        glpi_service = GlpiService(
            glpi_cfg['api_url'],
            glpi_cfg['app_token'],
            glpi_cfg['user_token'],
        )

        async def _glpi_check():
            # Step 1: verify the operator's GLPI credentials are valid
            result = await glpi_service.login_with_credentials(username, password)
            if not result.get('success'):
                return False, 'Authentication failed — check your credentials'
            op_session = result['session_token']
            user_id    = result.get('user_id')
            # Kill the operator session immediately — we only needed it to verify credentials
            await glpi_service.kill_session(op_session)

            if not user_id:
                return False, 'Could not retrieve user ID'

            # Step 2: use the admin token session to fetch groups + display name
            admin_session = await glpi_service.init_session()
            if not admin_session:
                return False, 'Admin session unavailable — cannot verify group membership'
            try:
                groups = await glpi_service.get_user_groups(admin_session, user_id)
                group_names = set()
                for g in groups:
                    gid = g.get('groups_id')
                    if isinstance(gid, str):
                        group_names.add(gid.strip())
                    for field in ('name', 'completename'):
                        val = g.get(field)
                        if val:
                            group_names.add(str(val).strip())
                required_lower = required_group.lower()
                if not any(n.lower() == required_lower for n in group_names):
                    return False, (
                        f"Access denied. You must be a member of the "
                        f"'{required_group}' group in ITSM to access the operator console."
                    )
                return True, None
            finally:
                await glpi_service.kill_session(admin_session)

        try:
            allowed, err_msg = asyncio.run(_glpi_check())
        except Exception as glpi_err:
            print(f"[OPERATOR AUTH] GLPI check error: {glpi_err}")
            return jsonify({'error': 'ITSM is unreachable. Cannot verify credentials.'}), 503

        if not allowed:
            print(f"[OPERATOR AUTH] Denied '{username}': {err_msg}")
            return jsonify({'error': err_msg}), 403

        print(f"[OPERATOR AUTH] GLPI auth + group check passed for '{username}' (group: {required_group})")
        # ── end GLPI authentication ───────────────────────────────────────────

        # ── Auto-provision / update local operator record ─────────────────────
        from common.conversation_db import (
            get_operator_by_username, update_operator_last_seen,
            create_operator,
        )
        op = get_operator_by_username(username)
        if not op:
            # First-time login: create a local record (no password stored)
            new_id = create_operator(
                username=username,
                display_name=username,
                password_hash='glpi-managed',   # placeholder — never checked
            )
            op = get_operator_by_username(username)
            print(f"[OPERATOR AUTH] Auto-created local operator record for '{username}' (id={new_id})")
        # ── end auto-provision ────────────────────────────────────────────────

        expiry_hours = _get_operator_jwt_expiry_hours()
        exp = int(time.time()) + expiry_hours * 3600
        payload = {
            'sub': op['id'],
            'username': op['username'],
            'type': 'operator',
            'exp': exp,
        }
        token = _jwt_encode(payload, _get_operator_jwt_secret())
        # DB status is managed exclusively by the heartbeat — no update here
        print(f"[OPERATOR AUTH] Login success for '{username}' (id={op['id']})")
        return jsonify({
            'token':          token,
            'operator_id':    op['id'],
            'display_name':   op['display_name'],
            'team':           op.get('team'),
            'app_ids':        op.get('app_ids', []),
            'max_concurrent': op.get('max_concurrent', 3),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_handoff_config_for_login():
    """Thin wrapper so operator_login can call get_handoff_config without circular import risk."""
    from common.config_manager import get_handoff_config
    return get_handoff_config()


@app.route('/operator/token/refresh', methods=['POST'])
def operator_token_refresh():
    """Issue a fresh JWT for an operator whose token has expired.

    Accepts the expired token (signature still valid), verifies it ignoring
    the exp claim, and returns a new token with a new expiry window.
    Grace period: token must have expired within the last 24 hours.
    """
    import time
    try:
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Missing token'}), 401
        token = auth[7:]
        secret = _get_operator_jwt_secret()

        # Decode without expiry check to read the payload
        parts = token.split('.')
        if len(parts) != 3:
            return jsonify({'error': 'Malformed token'}), 401
        header_b, body_b, sig_b = parts
        sig_input = f"{header_b}.{body_b}".encode()
        expected_sig = base64.urlsafe_b64encode(
            hmac.new(secret.encode(), sig_input, hashlib.sha256).digest()
        ).rstrip(b'=').decode()
        if not hmac.compare_digest(sig_b, expected_sig):
            return jsonify({'error': 'Invalid token signature'}), 401

        import json as _json
        padding = 4 - len(body_b) % 4
        payload = _json.loads(base64.urlsafe_b64decode(body_b + '=' * padding))

        if payload.get('type') != 'operator':
            return jsonify({'error': 'Not an operator token'}), 401

        # Grace period: only refresh if expired within last 24 h
        exp = payload.get('exp', 0)
        now = int(time.time())
        if exp > now:
            pass  # not expired yet — still valid, refresh fine
        elif now - exp > 86400:
            return jsonify({'error': 'Token too old to refresh — please log in again'}), 401

        # Issue new token
        expiry_hours = _get_operator_jwt_expiry_hours()
        new_payload = {
            'sub':      payload['sub'],
            'username': payload.get('username', ''),
            'type':     'operator',
            'exp':      now + expiry_hours * 3600,
        }
        new_token = _jwt_encode(new_payload, secret)
        return jsonify({'token': new_token})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/logout', methods=['POST'])
@_require_operator_token
def operator_logout(**kwargs):
    """Mark operator as offline."""
    try:
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE operators SET status = 'offline', last_seen = NOW() WHERE id = %s",
                (kwargs['_operator_id'],)
            )
            conn.commit()
        finally:
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/heartbeat', methods=['POST'])
@_require_operator_token
def operator_heartbeat(**kwargs):
    """Single source of truth for operator online state.

    Every 25 s the console calls this. We update last_seen and derive the
    correct status here — nowhere else touches these two columns while
    the operator is active.

    Status rules (in priority order):
      1. If status is 'away'  → keep 'away'  (manually set by operator)
      2. If load >= max       → 'busy'
      3. Otherwise            → 'available'
    Logout sets 'offline' explicitly; watchdog sets 'offline' on timeout.
    """
    try:
        from common.conversation_db import (
            update_operator_last_seen, get_operator_current_load, get_operator
        )
        op_id = kwargs['_operator_id']
        op = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404

        current_load = get_operator_current_load(op_id)
        cfg = get_handoff_runtime_config_for_api()

        if op['status'] == 'away':
            new_status = 'away'
        elif cfg['operators']['auto_busy_on_max_load'] and current_load >= op['max_concurrent']:
            new_status = 'busy'
        else:
            new_status = 'available'

        # Only write to DB when something actually changed or last_seen is getting stale.
        # "Stale" threshold = half the watchdog timeout so we always write before the
        # watchdog would mark the operator offline.
        from datetime import datetime as _dt
        last_seen = op.get('last_seen')
        status_changed = (new_status != op['status'])
        secs_since = (
            (_dt.now() - last_seen).total_seconds()
            if last_seen and not getattr(last_seen, 'tzinfo', None)
            else (_dt.now(last_seen.tzinfo) - last_seen).total_seconds()
            if last_seen else 999
        )
        watchdog_secs = int(_get_handoff_cfg_value('operator_heartbeat_timeout_secs', 90))
        needs_refresh = secs_since >= watchdog_secs / 2  # write at least every ~45 s

        if status_changed or needs_refresh:
            update_operator_last_seen(op_id, status=new_status)

        return jsonify({
            'status': new_status,
            'current_load': current_load,
            'max_concurrent': op['max_concurrent']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/me', methods=['GET'])
@_require_operator_token
def operator_me(**kwargs):
    """Return operator profile and active queue assignments."""
    try:
        from common.conversation_db import (
            get_operator, get_operator_current_load, get_queue
        )
        op_id = kwargs['_operator_id']
        op = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404
        active = get_queue(status='assigned')
        my_active = [q for q in active if q.get('operator_id') == op_id]
        return jsonify({
            'operator': op,
            'current_load': get_operator_current_load(op_id),
            'active_conversations': my_active
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/status', methods=['POST', 'PUT'])
@_require_operator_token
def operator_set_status(**kwargs):
    """Let operator toggle available / away (not busy — that's system-managed)."""
    try:
        from common.conversation_db import update_operator, get_operator_current_load, get_operator
        data = request.get_json(silent=True) or {}
        new_status = data.get('status', '')
        if new_status not in ('available', 'away'):
            return jsonify({"error": "status must be 'available' or 'away'"}), 400
        op_id = kwargs['_operator_id']
        # Don't allow setting available if at capacity
        if new_status == 'available':
            op = get_operator(op_id)
            load = get_operator_current_load(op_id)
            cfg = get_handoff_runtime_config_for_api()
            if cfg['operators']['auto_busy_on_max_load'] and op and load >= op['max_concurrent']:
                new_status = 'busy'
        update_operator(op_id, status=new_status)
        from common.conversation_db import update_operator_last_seen
        update_operator_last_seen(op_id)
        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Internal queue endpoints (called by Rasa action server) ───────────

def get_handoff_runtime_config_for_api():
    """Thin wrapper so endpoints don't need a DB connection arg."""
    from common.conversation_db import get_handoff_runtime_config
    return get_handoff_runtime_config()


@app.route('/internal/operators/reset-status', methods=['GET'])
def internal_reset_operator_status():
    """Dev/debug: force all active operators to status=available with last_seen=NOW."""
    try:
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE operators SET status = 'available', last_seen = NOW() "
                "WHERE is_active = TRUE"
            )
            updated = cursor.rowcount
            conn.commit()
        finally:
            _release_connection(conn)
        return jsonify({'success': True, 'updated': updated})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/internal/operators/available', methods=['GET'])
def internal_operators_available():
    """Check operator availability for a given app_id.
    Called by Rasa action server before offering handoff to user.
    Add ?debug=1 to see why operators are being filtered out.
    """
    try:
        from common.conversation_db import get_available_operators, get_queue
        app_id = request.args.get('app_id')
        debug  = request.args.get('debug') == '1'
        eligible = get_available_operators(app_id)

        if debug:
            from psycopg2.extras import RealDictCursor as _RDC
            _dc = _get_connection()
            try:
                _cur = _dc.cursor(cursor_factory=_RDC)
                _cur.execute(
                    "SELECT id, username, display_name, status, is_active, app_ids, "
                    "last_seen, NOW() as db_now, "
                    "EXTRACT(EPOCH FROM (NOW() - last_seen))::INT as secs_since_seen "
                    "FROM operators"
                )
                all_ops = [dict(r) for r in _cur.fetchall()]
                for o in all_ops:
                    if o.get('last_seen'): o['last_seen'] = o['last_seen'].isoformat()
                    if o.get('db_now'):    o['db_now']    = o['db_now'].isoformat()
            finally:
                _release_connection(_dc)
            return jsonify({'eligible': eligible, 'all_operators': all_ops,
                            'filter_app_id': app_id})

        waiting = get_queue(app_id=app_id, status='waiting')
        assigned = get_queue(app_id=app_id, status='assigned')

        free_slots = sum(
            max(0, op['max_concurrent'] - op['current_load']) for op in eligible
        )
        online_count = len(eligible)
        queue_depth = len(waiting)

        # Estimate wait time
        cfg = get_handoff_runtime_config_for_api()
        if free_slots > 0 and online_count > 0:
            # Simple estimate: queue items ahead / available operators × avg handle
            avg_handle = _get_avg_handle_time(app_id) or 300  # default 5min
            wait_secs = int((queue_depth * avg_handle) / max(free_slots, 1))
        elif online_count > 0:
            avg_handle = _get_avg_handle_time(app_id) or 300
            wait_secs = int((max(queue_depth, 1) * avg_handle) / max(online_count, 1))
        else:
            wait_secs = 0

        return jsonify({
            'online': online_count > 0,
            'free_slots': free_slots,
            'online_count': online_count,
            'queue_depth': queue_depth,
            'wait_secs': wait_secs,
            'wait_mins': round(wait_secs / 60, 1)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _get_avg_handle_time(app_id: str = None) -> Optional[int]:
    """7-day rolling average of handle_time_secs for an app."""
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            if app_id:
                cursor.execute(
                    "SELECT AVG(handle_time_secs) AS avg_handle "
                    "FROM handoff_queue "
                    "WHERE app_id = %s AND status = 'resolved' "
                    "AND resolved_at > NOW() - INTERVAL '7 days'",
                    (app_id,)
                )
            else:
                cursor.execute(
                    "SELECT AVG(handle_time_secs) AS avg_handle "
                    "FROM handoff_queue "
                    "WHERE status = 'resolved' "
                    "AND resolved_at > NOW() - INTERVAL '7 days'"
                )
            row = cursor.fetchone()
            val = row['avg_handle'] if row and row['avg_handle'] else None
            return int(val) if val else None
        finally:
            _release_connection(conn)
    except Exception:
        return None


@app.route('/internal/queue/enqueue', methods=['POST'])
def internal_queue_enqueue():
    """Create a queue entry. Called by Rasa action server on confirmed handoff."""
    try:
        from common.conversation_db import (
            enqueue_handoff, log_handoff_consent, get_queue
        )
        data = request.get_json(silent=True) or {}
        sender_id     = data.get('sender_id')
        app_id        = data.get('app_id', 'General')
        trigger_reason = data.get('trigger_reason', 'user_request')
        trigger_detail = data.get('trigger_detail')
        priority       = data.get('priority')
        consent_given  = data.get('consent_given', False)
        ip_hash        = data.get('ip_hash')

        if not sender_id:
            return jsonify({'error': 'sender_id required'}), 400

        # Get or create conversation record (mobile users hit Rasa directly so no row may exist yet)
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            from datetime import datetime
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT id FROM conversations WHERE sender_id = %s ORDER BY id DESC LIMIT 1", (sender_id,)
            )
            row = cursor.fetchone()
            if not row:
                now = datetime.utcnow()
                cursor.execute(
                    "INSERT INTO conversations (sender_id, app_id, started_at, last_activity) "
                    "VALUES (%s, %s, %s, %s) RETURNING id",
                    (sender_id, app_id, now, now)
                )
                row = cursor.fetchone()
                conn.commit()
        finally:
            _release_connection(conn)

        conversation_id = row['id']

        # Log GDPR consent
        if consent_given:
            log_handoff_consent(sender_id, conversation_id, True, ip_hash)

        # Apply routing rules
        target_team, required_skill, priority_boost = _apply_routing_rules(
            app_id, trigger_detail or {}
        )
        if priority is None:
            cfg = get_handoff_runtime_config_for_api()
            priority = cfg['queue']['default_priority']
        priority = min(9, priority + priority_boost)

        # Build basic context package (rule-based summary for Phase 1)
        context_package = _build_context_package(sender_id, conversation_id, trigger_reason, trigger_detail)

        entry = enqueue_handoff(
            conversation_id=conversation_id,
            sender_id=sender_id,
            app_id=app_id,
            trigger_reason=trigger_reason,
            trigger_detail=trigger_detail,
            priority=priority,
            context_package=context_package,
            target_team=target_team,
            required_skill=required_skill
        )

        if entry is None:
            return jsonify({'error': 'Queue is full or enqueue failed'}), 503

        # ── Phase 3: notify operators of new queue item ───────────────────
        try:
            cfg = get_handoff_runtime_config_for_api()
            avg_handle = float(cfg.get('queue', {}).get('avg_handle_time_mins', 8))
            pos = int(entry.get('queue_position', 1))
            wait_mins = round(pos * avg_handle)
            queued_at_str = str(entry.get('queued_at', ''))
            _sio.emit('new_queue_item', {
                'queue_id':           entry['id'],
                'queue_position':     pos,
                'wait_estimate_mins': wait_mins,
                'app_id':             app_id,
                'target_team':        target_team,
                'required_skill':     required_skill,
                'trigger_reason':     trigger_reason,
                'queued_at':          queued_at_str,
            }, room='queue_overview')
            _emit_queue_overview()
            print(f"[SIO enqueue] Emitted new_queue_item to queue_overview (queue_id={entry['id']}, pos={pos})")
            # Confirm to the user they're in queue
            _emit_to_user(sender_id, 'handoff_queued', {
                'conversation_id':    conversation_id,
                'queue_position':     pos,
                'wait_estimate_mins': wait_mins,
            })
        except Exception as _nqe:
            import traceback
            print(f"[SIO enqueue] notify error (non-fatal): {_nqe}")
            traceback.print_exc()
        # ── end Phase 3 ───────────────────────────────────────────────────

        return jsonify({
            'success': True,
            'queue_id': entry['id'],
            'position': entry.get('queue_position', 1),
            'wait_secs': 0,
            'wait_mins': 0
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def _apply_routing_rules(app_id: str, trigger_detail: dict) -> tuple:
    """Evaluate routing rules table and return (target_team, required_skill, priority_boost)."""
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT * FROM handoff_routing_rules "
                "WHERE is_active = TRUE ORDER BY sort_order ASC"
            )
            rules = cursor.fetchall()
        finally:
            _release_connection(conn)

        intent   = trigger_detail.get('intent', '')
        keywords = trigger_detail.get('last_message', '').lower()

        for rule in rules:
            match_type  = rule['match_type']
            match_value = rule['match_value'].lower()
            matched = False

            if match_type == 'intent' and intent.lower() == match_value:
                matched = True
            elif match_type == 'keyword' and match_value in keywords:
                matched = True
            elif match_type == 'app_id' and app_id.lower() == match_value:
                matched = True

            if matched:
                return (
                    rule.get('target_team'),
                    rule.get('required_skill'),
                    rule.get('priority_boost', 0)
                )
    except Exception:
        pass
    return (None, None, 0)


def _build_context_package(sender_id: str, conversation_id: int,
                            trigger_reason: str, trigger_detail: dict) -> dict:
    """Build a rule-based context package. No LLM calls in Phase 1."""
    from datetime import datetime as _dt
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT user_name, user_id, app_id, ticket_id, started_at, "
                "low_conf_streak, frustration_score, client_metadata "
                "FROM conversations WHERE id = %s",
                (conversation_id,)
            )
            conv = cursor.fetchone()
            if not conv:
                return {}

            # Last 20 messages for transcript and summary
            cursor.execute(
                "SELECT sender, text, intent, timestamp FROM messages "
                "WHERE conversation_id = %s ORDER BY timestamp ASC",
                (conversation_id,)
            )
            messages = cursor.fetchall()
        finally:
            _release_connection(conn)

        # Mask sensitive data in transcript
        masked_transcript = []
        for msg in messages:
            masked_text, _ = _mask_sensitive(msg['text'] or '')
            masked_transcript.append({
                'sender': msg['sender'],
                'text': masked_text,
                'intent': msg.get('intent'),
                'timestamp': msg['timestamp'].isoformat() if msg['timestamp'] else None
            })

        # Rule-based summary
        intents = [m['intent'] for m in messages if m.get('intent')]
        last_user_msg = next(
            (m['text'] for m in reversed(messages) if m['sender'] == 'user'), ''
        )
        summary = (
            f"User {conv.get('user_name') or conv.get('user_id') or sender_id} "
            f"was in a {conv.get('app_id', 'General')} support conversation. "
        )
        if conv.get('ticket_id'):
            summary += f"Related ticket: #{conv['ticket_id']}. "
        if intents:
            summary += f"Main topics: {', '.join(dict.fromkeys(intents)[-5:])}. "
        summary += f"Handoff triggered by: {trigger_reason}. "
        summary += f"Last user message: \"{last_user_msg[:200]}\""

        client_meta = conv.get('client_metadata') or {}

        return {
            'package_version': '1.0',
            'generated_at': _dt.utcnow().isoformat() + 'Z',
            'consent_given': True,
            'user_profile': {
                'display_name': conv.get('user_name'),
                'glpi_user_id': conv.get('user_id'),
                'app_id': conv.get('app_id'),
            },
            'session': {
                'sender_id': sender_id,
                'conversation_id': conversation_id,
                'started_at': conv['started_at'].isoformat() if conv.get('started_at') else None,
                'message_count': len(messages),
                'related_ticket_id': conv.get('ticket_id'),
            },
            'trigger': {
                'reason': trigger_reason,
                'detail': trigger_detail,
                'low_conf_streak': conv.get('low_conf_streak', 0),
                'frustration_score': conv.get('frustration_score', 0.0),
            },
            'ai_summary': summary,
            'transcript': masked_transcript[-20:],
            'technical_data': {
                'browser': client_meta.get('browser', ''),
                'os': client_meta.get('os', ''),
                'device_type': client_meta.get('device_type', ''),
                'page_url': client_meta.get('page_url', ''),
                'ip_address': '[MASKED]',
            }
        }
    except Exception as e:
        return {'error': str(e)}


def _mask_sensitive(text: str) -> tuple:
    """Mask passwords, card numbers, and IBANs. Returns (masked_text, list_of_masked_types)."""
    cfg = get_handoff_runtime_config_for_api().get('gdpr', {})
    masked_types = []
    patterns = []
    if cfg.get('mask_passwords', True):
        patterns.append(('password', r'(?i)(password|pwd|passwort)\s*[:=]\s*\S+'))
    if cfg.get('mask_card_numbers', True):
        patterns.append(('card_number', r'\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b'))
    if cfg.get('mask_ibans', True):
        patterns.append(('iban', r'\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b'))
    if cfg.get('mask_emails', False):
        patterns.append(('email', r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Z|a-z]{2,}\b'))
    for mask_type, pattern in patterns:
        if _re.search(pattern, text):
            text = _re.sub(pattern, f'[{mask_type.upper()}_REDACTED]', text)
            masked_types.append(mask_type)
    return text, masked_types


# ── Admin operator CRUD endpoints ─────────────────────────────────────

@app.route('/admin/operators', methods=['GET'])
def admin_list_operators():
    """List all operators."""
    try:
        from common.conversation_db import get_operators, get_operator_current_load
        include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'
        ops = get_operators(include_inactive=include_inactive)
        # Attach live load to each operator
        for op in ops:
            op['current_load'] = get_operator_current_load(op['id'])
        return jsonify({'success': True, 'operators': ops, 'count': len(ops)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/operators', methods=['POST'])
def admin_create_operator():
    """Create a new operator account."""
    try:
        from common.conversation_db import create_operator
        data = request.get_json(silent=True) or {}
        username     = (data.get('username') or '').strip().lower()
        display_name = (data.get('display_name') or '').strip()
        password     = data.get('password') or ''
        if not username or not display_name or not password:
            return jsonify({'error': 'username, display_name, and password are required'}), 400
        if len(password) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400

        new_id = create_operator(
            username=username,
            display_name=display_name,
            password_hash=_hash_password(password),
            email=data.get('email'),
            team=data.get('team'),
            app_ids=data.get('app_ids', []),
            max_concurrent=data.get('max_concurrent'),
            shift_schedule=data.get('shift_schedule')
        )
        return jsonify({'success': True, 'operator_id': new_id}), 201
    except Exception as e:
        if 'unique' in str(e).lower():
            return jsonify({'error': 'Username already exists'}), 409
        return jsonify({'error': str(e)}), 500


@app.route('/admin/operators/<int:operator_id>', methods=['GET'])
def admin_get_operator(operator_id):
    """Get a single operator by ID."""
    try:
        from common.conversation_db import get_operator, get_operator_current_load, get_operator_stats
        op = get_operator(operator_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404
        op['current_load'] = get_operator_current_load(operator_id)
        op['stats'] = get_operator_stats(operator_id)
        return jsonify({'success': True, 'operator': op})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/operators/<int:operator_id>', methods=['PUT'])
def admin_update_operator(operator_id):
    """Update operator fields. Password change requires 'new_password' key."""
    try:
        from common.conversation_db import update_operator, get_operator
        if not get_operator(operator_id):
            return jsonify({'error': 'Operator not found'}), 404
        data = request.get_json(silent=True) or {}
        updates = {}
        for field in ('display_name', 'email', 'team', 'app_ids',
                      'max_concurrent', 'shift_schedule', 'is_active'):
            if field in data:
                updates[field] = data[field]
        if 'new_password' in data:
            if len(data['new_password']) < 8:
                return jsonify({'error': 'Password must be at least 8 characters'}), 400
            updates['password_hash'] = _hash_password(data['new_password'])
        if not updates:
            return jsonify({'error': 'No valid fields to update'}), 400
        update_operator(operator_id, **updates)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/operators/<int:operator_id>', methods=['DELETE'])
def admin_deactivate_operator(operator_id):
    """Soft-deactivate an operator (is_active = False)."""
    try:
        from common.conversation_db import update_operator, get_operator
        if not get_operator(operator_id):
            return jsonify({'error': 'Operator not found'}), 404
        update_operator(operator_id, is_active=False, status='offline')
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/operators/<int:operator_id>/stats', methods=['GET'])
def admin_operator_stats(operator_id):
    """Return performance statistics for one operator."""
    try:
        from common.conversation_db import get_operator_stats, get_operator
        if not get_operator(operator_id):
            return jsonify({'error': 'Operator not found'}), 404
        stats = get_operator_stats(operator_id)
        return jsonify({'success': True, 'stats': stats})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Handoff config endpoints ───────────────────────────────────────────

@app.route('/admin/handoff/config', methods=['GET'])
def admin_get_handoff_config():
    """Return the current runtime handoff configuration."""
    try:
        cfg = get_handoff_runtime_config_for_api()
        return jsonify({'success': True, 'config': cfg})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/handoff/config', methods=['PUT'])
def admin_update_handoff_config():
    """Update runtime handoff configuration. Deep-merges the submitted object
    over the existing config so partial updates are safe."""
    try:
        from common.conversation_db import (
            get_handoff_runtime_config, set_handoff_runtime_config, _deep_merge
        )
        data = request.get_json(silent=True)
        if not data or not isinstance(data, dict):
            return jsonify({'error': 'JSON body required'}), 400
        current = get_handoff_runtime_config()
        merged = _deep_merge(current, data)
        set_handoff_runtime_config(merged)
        return jsonify({'success': True, 'config': merged})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Routing rules endpoints ────────────────────────────────────────────

@app.route('/admin/handoff/routing', methods=['GET'])
def admin_list_routing_rules():
    """Return all handoff routing rules ordered by sort_order."""
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT * FROM handoff_routing_rules ORDER BY sort_order ASC, created_at ASC"
            )
            rules = [dict(r) for r in cursor.fetchall()]
            for r in rules:
                if r.get('created_at'):
                    r['created_at'] = r['created_at'].isoformat()
        finally:
            _release_connection(conn)
        return jsonify({'success': True, 'rules': rules, 'count': len(rules)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/handoff/routing', methods=['POST'])
def admin_create_routing_rule():
    """Create a new routing rule."""
    try:
        data = request.get_json(silent=True) or {}
        rule_name   = (data.get('rule_name') or '').strip()
        match_type  = data.get('match_type', '')
        match_value = (data.get('match_value') or '').strip()
        if not rule_name or not match_type or not match_value:
            return jsonify({'error': 'rule_name, match_type, and match_value are required'}), 400
        if match_type not in ('intent', 'keyword', 'app_id', 'entity'):
            return jsonify({"error": "match_type must be intent, keyword, app_id, or entity"}), 400

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "INSERT INTO handoff_routing_rules "
                "(rule_name, match_type, match_value, target_team, required_skill, "
                "priority_boost, sort_order) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (
                    rule_name, match_type, match_value,
                    data.get('target_team'), data.get('required_skill'),
                    data.get('priority_boost', 0), data.get('sort_order', 99)
                )
            )
            new_id = cursor.fetchone()['id']
            conn.commit()
        finally:
            _release_connection(conn)
        return jsonify({'success': True, 'rule_id': new_id}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/handoff/routing/<int:rule_id>', methods=['PUT'])
def admin_update_routing_rule(rule_id):
    """Update a routing rule."""
    try:
        data = request.get_json(silent=True) or {}
        allowed = ('rule_name', 'match_type', 'match_value', 'target_team',
                   'required_skill', 'priority_boost', 'sort_order', 'is_active')
        updates = {k: data[k] for k in allowed if k in data}
        if not updates:
            return jsonify({'error': 'No valid fields to update'}), 400
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            set_parts = ', '.join(f"{k} = %s" for k in updates)
            params = list(updates.values()) + [rule_id]
            cursor.execute(
                f"UPDATE handoff_routing_rules SET {set_parts} WHERE id = %s", params
            )
            conn.commit()
            if cursor.rowcount == 0:
                return jsonify({'error': 'Rule not found'}), 404
        finally:
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/handoff/routing/<int:rule_id>', methods=['DELETE'])
def admin_delete_routing_rule(rule_id):
    """Delete a routing rule."""
    try:
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM handoff_routing_rules WHERE id = %s", (rule_id,)
            )
            conn.commit()
            if cursor.rowcount == 0:
                return jsonify({'error': 'Rule not found'}), 404
        finally:
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/handoff/routing/test', methods=['POST'])
def admin_test_routing():
    """Simulate routing for a given message and app_id without creating a queue entry."""
    try:
        data = request.get_json(silent=True) or {}
        app_id  = data.get('app_id', 'General')
        message = data.get('message', '')
        intent  = data.get('intent', '')
        trigger_detail = {'last_message': message, 'intent': intent}
        target_team, required_skill, priority_boost = _apply_routing_rules(app_id, trigger_detail)
        return jsonify({
            'success': True,
            'result': {
                'target_team': target_team or '(default pool)',
                'required_skill': required_skill,
                'priority_boost': priority_boost,
                'final_priority': min(9, 5 + priority_boost)
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Operator queue management endpoints (Phase 1 REST — Phase 3 adds Socket.IO) ──

@app.route('/operator/queue', methods=['GET'])
@_require_operator_token
def operator_get_queue(**kwargs):
    """Return queue items visible to this operator.
    ?status=waiting  (default) — items available to claim
    ?status=assigned           — items currently assigned to THIS operator
    """
    try:
        from common.conversation_db import get_operator, get_queue
        op      = get_operator(kwargs['_operator_id'])
        if not op:
            return jsonify({'error': 'Operator not found'}), 404
        op_id   = kwargs['_operator_id']
        status  = request.args.get('status', 'waiting')

        if status == 'assigned':
            # Return only this operator's active chats
            all_assigned = get_queue(status='assigned')
            items = [i for i in all_assigned if i.get('operator_id') == op_id]
        else:
            # Waiting items routed to this operator's app_ids / team
            items = []
            app_ids = op.get('app_ids') or []
            if app_ids:
                for app_id in app_ids:
                    items += get_queue(app_id=app_id, team=op.get('team'), status='waiting')
            else:
                # No app restriction — see all waiting items
                items = get_queue(status='waiting')
            # Deduplicate
            seen = set()
            unique = []
            for item in items:
                if item['id'] not in seen:
                    seen.add(item['id'])
                    unique.append(item)
            items = unique
            items.sort(key=lambda x: (-x.get('priority', 5), x.get('queued_at', '')))

        return jsonify({'success': True, 'items': items, 'count': len(items)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/queue/claim', methods=['POST'])
@_require_operator_token
def operator_claim(**kwargs):
    """Claim a waiting queue item."""
    try:
        from common.conversation_db import (
            get_operator, get_operator_current_load, update_operator
        )
        from datetime import datetime as _dt
        data    = request.get_json(silent=True) or {}
        queue_id = data.get('queue_id')
        if not queue_id:
            return jsonify({'error': 'queue_id required'}), 400

        op_id = kwargs['_operator_id']
        op    = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404

        load = get_operator_current_load(op_id)
        if load >= op['max_concurrent']:
            return jsonify({'error': 'You are at maximum concurrent chat capacity'}), 409

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            # Atomic claim — only succeeds if item is still waiting
            cursor.execute(
                "UPDATE handoff_queue "
                "SET status = 'assigned', operator_id = %s, assigned_at = %s, "
                "wait_time_secs = EXTRACT(EPOCH FROM (NOW() - queued_at))::INT "
                "WHERE id = %s AND status = 'waiting' "
                "RETURNING *",
                (op_id, _dt.now(), queue_id)
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Queue item not found or already claimed'}), 409

            # Update conversation state
            cursor.execute(
                "UPDATE conversations SET handoff_state = 'assigned', assigned_operator_id = %s "
                "WHERE id = %s",
                (op_id, row['conversation_id'])
            )
            # Log state transition
            cursor.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id) "
                "VALUES (%s, 'queued', 'assigned', 'operator', %s)",
                (row['conversation_id'], str(op_id))
            )
            conn.commit()

            # Auto-set busy if now at capacity
            cfg = get_handoff_runtime_config_for_api()
            new_load = load + 1
            if cfg['operators']['auto_busy_on_max_load'] and new_load >= op['max_concurrent']:
                update_operator(op_id, status='busy')

            # ── Phase 3: real-time notifications ──────────────────────────
            _row_dict = dict(row)
            # Tell the user they've been picked up
            try:
                from psycopg2.extras import RealDictCursor as _CRC
                _claim_conn = _get_connection()
                try:
                    _claim_cur = _claim_conn.cursor(cursor_factory=_CRC)
                    _claim_cur.execute(
                        "SELECT sender_id FROM conversations WHERE id = %s",
                        (row['conversation_id'],)
                    )
                    _claim_cr = _claim_cur.fetchone()
                finally:
                    _release_connection(_claim_conn)
                if _claim_cr:
                    _row_dict['sender_id'] = _claim_cr['sender_id']
                    _emit_to_user(_claim_cr['sender_id'], 'handoff_assigned', {
                        'conversation_id':    row['conversation_id'],
                        'operator_name':      op.get('display_name', 'an agent'),
                        'message': (
                            f"✅ {op.get('display_name', 'An agent')} has joined the conversation. "
                            "You can now chat with them directly."
                        ),
                    })
            except Exception as _ce:
                print(f"[SIO claim] notify user error (non-fatal): {_ce}")
            # Tell all operators the item was removed from the queue
            _sio.emit('queue_item_updated', {
                'queue_id':   row['id'],
                'status':     'assigned',
                'operator_id': op_id,
            }, room='queue_overview')
            _emit_queue_overview()
            # ── end Phase 3 ───────────────────────────────────────────────

            return jsonify({'success': True, 'queue_item': _row_dict})
        finally:
            _release_connection(conn)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/queue/resolve', methods=['POST'])
@_require_operator_token
def operator_resolve(**kwargs):
    """Resolve a conversation — optionally return to bot."""
    try:
        from common.conversation_db import update_operator, get_operator_current_load, get_operator
        from datetime import datetime as _dt
        data         = request.get_json(silent=True) or {}
        queue_id     = data.get('queue_id')
        return_to_bot = data.get('return_to_bot', True)
        closing_note  = data.get('closing_note', '')
        if not queue_id:
            return jsonify({'error': 'queue_id required'}), 400

        op_id = kwargs['_operator_id']
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "UPDATE handoff_queue "
                "SET status = 'resolved', resolved_at = %s, return_to_bot = %s, "
                "closing_note = %s, "
                "handle_time_secs = EXTRACT(EPOCH FROM (NOW() - assigned_at))::INT "
                "WHERE id = %s AND operator_id = %s AND status = 'assigned' "
                "RETURNING conversation_id",
                (_dt.now(), return_to_bot, closing_note, queue_id, op_id)
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Queue item not found or not assigned to you'}), 409

            conv_id = row['conversation_id']
            new_state = 'bot_active' if return_to_bot else 'closed'
            cursor.execute(
                "UPDATE conversations SET handoff_state = %s, assigned_operator_id = NULL "
                "WHERE id = %s",
                (new_state, conv_id)
            )
            cursor.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
                "VALUES (%s, 'assigned', %s, 'operator', %s, %s)",
                (conv_id, new_state, str(op_id), closing_note)
            )
            conn.commit()

            # Auto-restore available if load drops below max
            cfg = get_handoff_runtime_config_for_api()
            op = get_operator(op_id)
            new_load = get_operator_current_load(op_id)
            if (cfg['operators']['auto_busy_on_max_load']
                    and op and op['status'] == 'busy'
                    and new_load < op['max_concurrent']):
                update_operator(op_id, status='available')

            # ── Phase 3: real-time notifications ──────────────────────────
            try:
                _res_conn = _get_connection()
                try:
                    from psycopg2.extras import RealDictCursor as _RRC
                    _res_cur = _res_conn.cursor(cursor_factory=_RRC)
                    _res_cur.execute(
                        "SELECT sender_id FROM conversations WHERE id = %s",
                        (conv_id,)
                    )
                    _res_cr = _res_cur.fetchone()
                finally:
                    _release_connection(_res_conn)
                if _res_cr:
                    op_name = op.get('display_name', 'The agent') if op else 'The agent'
                    if return_to_bot:
                        _emit_to_user(_res_cr['sender_id'], 'handoff_resolved', {
                            'conversation_id': conv_id,
                            'queue_id': queue_id,
                            'message': (
                                f"✅ {op_name} has closed the session. "
                                "I'm back to assist you. Is there anything else I can help with?"
                            ),
                            'return_to_bot': True,
                            'request_feedback': True,
                        })
                    else:
                        _emit_to_user(_res_cr['sender_id'], 'handoff_resolved', {
                            'conversation_id': conv_id,
                            'queue_id': queue_id,
                            'message': "The session has been closed. Thank you.",
                            'return_to_bot': False,
                            'request_feedback': True,
                        })
            except Exception as _re:
                print(f"[SIO resolve] notify user error (non-fatal): {_re}")
            _sio.emit('queue_item_removed', {'queue_id': queue_id, 'status': 'resolved'},
                      room='queue_overview')
            _emit_queue_overview()
            # ── end Phase 3 ───────────────────────────────────────────────

            return jsonify({'success': True, 'return_to_bot': return_to_bot})
        finally:
            _release_connection(conn)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/queue/release', methods=['POST'])
@_require_operator_token
def operator_release(**kwargs):
    """Release an assigned conversation back to the queue."""
    try:
        from datetime import datetime as _dt
        data     = request.get_json(silent=True) or {}
        queue_id = data.get('queue_id')
        reason   = data.get('reason', 'released')
        note     = data.get('note', '')
        if not queue_id:
            return jsonify({'error': 'queue_id required'}), 400

        op_id = kwargs['_operator_id']
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "UPDATE handoff_queue "
                "SET status = 'waiting', operator_id = NULL, assigned_at = NULL "
                "WHERE id = %s AND operator_id = %s AND status = 'assigned' "
                "RETURNING conversation_id, app_id",
                (queue_id, op_id)
            )
            row = cursor.fetchone()
            if not row:
                return jsonify({'error': 'Queue item not found or not assigned to you'}), 409
            cursor.execute(
                "UPDATE conversations SET handoff_state = 'queued', assigned_operator_id = NULL "
                "WHERE id = %s",
                (row['conversation_id'],)
            )
            cursor.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
                "VALUES (%s, 'assigned', 'queued', 'operator', %s, %s)",
                (row['conversation_id'], str(op_id), note)
            )
            conn.commit()
            from common.conversation_db import _recalculate_queue_positions
            _recalculate_queue_positions(row['app_id'])

            # ── Phase 3: real-time notifications ──────────────────────────
            try:
                _rel_conn2 = _get_connection()
                try:
                    from psycopg2.extras import RealDictCursor as _RLRC
                    _rel_cur2 = _rel_conn2.cursor(cursor_factory=_RLRC)
                    _rel_cur2.execute(
                        "SELECT sender_id FROM conversations WHERE id = %s",
                        (row['conversation_id'],)
                    )
                    _rel_cr2 = _rel_cur2.fetchone()
                finally:
                    _release_connection(_rel_conn2)
                if _rel_cr2:
                    _emit_to_user(_rel_cr2['sender_id'], 'handoff_queued', {
                        'conversation_id': row['conversation_id'],
                        'message': "⏳ The agent returned your chat to the queue. You'll be connected to the next available agent.",
                    })
            except Exception as _rle:
                print(f"[SIO release] notify user error (non-fatal): {_rle}")
            _sio.emit('queue_item_updated', {'queue_id': queue_id, 'status': 'waiting'},
                      room='queue_overview')
            _emit_queue_overview()
            # ── end Phase 3 ───────────────────────────────────────────────
        finally:
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/queue/rate-context', methods=['POST'])
@_require_operator_token
def operator_rate_context(**kwargs):
    """Operator rates the quality of the AI context package."""
    try:
        data     = request.get_json(silent=True) or {}
        queue_id = data.get('queue_id')
        rating   = data.get('rating')
        note     = data.get('note', '')
        if not queue_id or rating is None:
            return jsonify({'error': 'queue_id and rating required'}), 400
        if not (1 <= int(rating) <= 5):
            return jsonify({'error': 'rating must be between 1 and 5'}), 400
        conn = _get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE handoff_queue SET agent_rating = %s, agent_rating_note = %s "
                "WHERE id = %s AND operator_id = %s",
                (int(rating), note, queue_id, kwargs['_operator_id'])
            )
            conn.commit()
            if cursor.rowcount == 0:
                return jsonify({'error': 'Queue item not found or not yours'}), 404
        finally:
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/conversation/<int:conversation_id>', methods=['GET'])
@_require_operator_token
def operator_get_conversation(conversation_id, **kwargs):
    """Return interleaved message history scoped to a session window.

    Optional query params:
      from_time — ISO timestamp, only return messages at or after this time
      to_time   — ISO timestamp, only return messages before or at this time
    """
    try:
        from datetime import datetime as _dt
        from_time = request.args.get('from_time')
        to_time   = request.args.get('to_time')

        def _ts(s):
            if not s:
                return None
            try:
                return _dt.fromisoformat(s.replace('Z', '+00:00'))
            except Exception:
                return None

        ft = _ts(from_time)
        tt = _ts(to_time)

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)

            # Build time filter clauses
            extra = ""
            params_base = [conversation_id]
            if ft:
                extra += " AND timestamp >= %s"
                params_base.append(ft)
            if tt:
                extra += " AND timestamp <= %s"
                params_base.append(tt)

            cursor.execute(
                f"SELECT sender, text, intent, timestamp FROM messages "
                f"WHERE conversation_id = %s AND sender != 'operator'{extra} "
                f"ORDER BY timestamp ASC",
                params_base
            )
            bot_msgs = [
                {**dict(m), 'source': 'chat',
                 'timestamp': m['timestamp'].isoformat() if m['timestamp'] else None}
                for m in cursor.fetchall()
            ]

            # Operator messages
            op_params = [conversation_id]
            op_extra = ""
            if ft:
                op_extra += " AND om.sent_at >= %s"
                op_params.append(ft)
            if tt:
                op_extra += " AND om.sent_at <= %s"
                op_params.append(tt)

            cursor.execute(
                f"SELECT om.message_text AS text, om.sent_at AS timestamp, "
                f"o.display_name AS operator_name "
                f"FROM operator_messages om "
                f"JOIN operators o ON o.id = om.operator_id "
                f"WHERE om.conversation_id = %s{op_extra} ORDER BY om.sent_at ASC",
                op_params
            )
            op_msgs = [
                {'sender': 'operator', 'text': m['text'],
                 'operator_name': m['operator_name'], 'source': 'operator',
                 'timestamp': m['timestamp'].isoformat() if m['timestamp'] else None}
                for m in cursor.fetchall()
            ]
        finally:
            _release_connection(conn)

        all_msgs = sorted(bot_msgs + op_msgs, key=lambda x: x.get('timestamp') or '')
        return jsonify({'success': True, 'messages': all_msgs, 'count': len(all_msgs)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/message', methods=['POST'])
@_require_operator_token
def operator_send_message(**kwargs):
    """Send a message from operator to user (stored; Socket.IO relay added in Phase 3)."""
    try:
        from datetime import datetime as _dt
        data            = request.get_json(silent=True) or {}
        conversation_id = data.get('conversation_id')
        text            = (data.get('text') or '').strip()
        if not conversation_id or not text:
            return jsonify({'error': 'conversation_id and text required'}), 400

        op_id = kwargs['_operator_id']
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            # Verify this operator owns the assigned conversation
            cursor.execute(
                "SELECT id FROM handoff_queue "
                "WHERE conversation_id = %s AND operator_id = %s AND status = 'assigned'",
                (conversation_id, op_id)
            )
            q = cursor.fetchone()
            if not q:
                return jsonify({'error': 'Not assigned to this conversation'}), 403

            cursor.execute(
                "INSERT INTO operator_messages "
                "(conversation_id, queue_id, operator_id, message_text) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (conversation_id, q['id'], op_id, text)
            )
            msg_id = cursor.fetchone()['id']
            # Also log to messages table for unified history
            cursor.execute(
                "INSERT INTO messages (conversation_id, sender, text, timestamp) "
                "VALUES (%s, 'operator', %s, %s)",
                (conversation_id, text, _dt.now())
            )
            cursor.execute(
                "UPDATE conversations SET last_activity = %s WHERE id = %s",
                (_dt.now(), conversation_id)
            )
            # Fetch sender_id for Socket.IO relay
            cursor.execute(
                "SELECT sender_id FROM conversations WHERE id = %s",
                (conversation_id,)
            )
            _om_cr = cursor.fetchone()
            conn.commit()
        finally:
            _release_connection(conn)

        # ── Phase 3: relay operator message to user in real-time ──────────
        if _om_cr:
            _emit_to_user(_om_cr['sender_id'], 'operator_message', {
                'conversation_id': conversation_id,
                'message_id':      msg_id,
                'sender_id':       _om_cr['sender_id'],
                'text':            text,
                'timestamp':       _dt.now().isoformat(),
            })
            _sio.emit('live_message', {
                'conversation_id': conversation_id,
                'sender':          'operator',
                'operator_id':     op_id,
                'text':            text,
                'timestamp':       _dt.now().isoformat(),
            }, room=_room_admin_watch(conversation_id))
        # ── end Phase 3 ───────────────────────────────────────────────────

        return jsonify({'success': True, 'message_id': msg_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/ai-draft', methods=['POST'])
@_require_operator_token
def operator_ai_draft(**kwargs):
    """Ask Rasa to suggest a reply for the last user message in a conversation.
    Uses a throw-away sender_id so it never pollutes the real conversation slot."""
    import requests as _req
    try:
        data            = request.get_json(silent=True) or {}
        conversation_id = data.get('conversation_id')
        if not conversation_id:
            return jsonify({'error': 'conversation_id required'}), 400

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            # Verify this operator owns the conversation
            cursor.execute(
                "SELECT hq.id FROM handoff_queue hq "
                "WHERE hq.conversation_id = %s AND hq.operator_id = %s AND hq.status = 'assigned'",
                (conversation_id, kwargs['_operator_id'])
            )
            if not cursor.fetchone():
                return jsonify({'error': 'Not assigned to this conversation'}), 403

            # Get the last user message
            cursor.execute(
                "SELECT text FROM messages "
                "WHERE conversation_id = %s AND sender = 'user' "
                "ORDER BY timestamp DESC LIMIT 1",
                (conversation_id,)
            )
            row = cursor.fetchone()
        finally:
            _release_connection(conn)

        if not row or not row['text']:
            return jsonify({'draft': '', 'no_message': True})

        last_user_msg = row['text']
        # Use a throw-away sender_id — prefix with __draft__ so we can purge later
        draft_sender = f"__draft__{conversation_id}"

        try:
            resp = _req.post(
                f"{RASA_URL}/webhooks/rest/webhook",
                json={'sender': draft_sender, 'message': last_user_msg},
                timeout=5,
            )
            resp.raise_for_status()
            responses = resp.json()
            # Filter out fallback / boilerplate responses
            filtered = []
            for r in responses:
                txt = (r.get('text') or '').strip()
                if not txt:
                    continue
                if txt.startswith("I'm not sure I understand"):
                    continue
                if txt.startswith("I didn't quite get that"):
                    continue
                filtered.append(txt)
            draft_text = ' '.join(filtered).strip()
        except Exception:
            draft_text = ''

        return jsonify({'draft': draft_text, 'source_message': last_user_msg})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/user-history/<sender_id>', methods=['GET'])
@_require_operator_token
def operator_user_history(sender_id, **kwargs):
    """Return the last N handoff sessions for a user — all sessions, all conversations.

    sender_id may be a full scoped id like user-IT-saqib-abc123.
    We extract the username (third segment) and match ALL sender_ids for
    that user so sessions created under different session suffixes are included.
    Fallback: exact sender_id match if the id doesn't follow the user- pattern.
    """
    try:
        limit = min(int(request.args.get('limit', 11)), 25)

        # Extract username from sender_id pattern: user-{appId}-{username}-{sessionId}
        # The session suffix (if any) is a base36 timestamp appended at login:
        # >= 6 chars of pure lowercase alphanumerics [0-9a-z].
        # Usernames are typically short like "saqib" or "support-it1", which never
        # end in a 6+ char all-lowercase-alphanumeric token — so we can detect
        # and strip the suffix reliably.
        import re as _re
        parts = sender_id.split('-')
        if len(parts) >= 3 and parts[0] == 'user':
            app_id_part = parts[1]
            remaining   = parts[2:]          # everything after appId
            # Strip session suffix: last segment that is >=6 all-lowercase-alphanumeric chars
            if (len(remaining) > 1
                    and _re.match(r'^[0-9a-z]{6,12}$', remaining[-1])):
                username_parts = remaining[:-1]  # drop session suffix
            else:
                username_parts = remaining       # old format, no suffix
            username_part  = '-'.join(username_parts)
            sender_pattern = f"user-{app_id_part}-{username_part}%"
            use_pattern    = True
        else:
            sender_pattern = sender_id
            use_pattern    = False

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            where_clause = "c.sender_id LIKE %s" if use_pattern else "c.sender_id = %s"
            cursor.execute(
                f"""
                SELECT hq.id        AS queue_id,
                       hq.conversation_id,
                       hq.status    AS handoff_status,
                       hq.queued_at,
                       hq.resolved_at,
                       hq.abandoned_at,
                       hq.trigger_reason,
                       hq.closing_note,
                       c.app_id,
                       c.sender_id,
                       (SELECT text FROM messages
                        WHERE conversation_id = c.id AND sender = 'user'
                              AND timestamp >= hq.queued_at
                        ORDER BY timestamp ASC LIMIT 1) AS first_user_msg,
                       (SELECT intent FROM messages
                        WHERE conversation_id = c.id AND sender = 'user'
                              AND intent IS NOT NULL AND timestamp >= hq.queued_at
                        ORDER BY timestamp DESC LIMIT 1) AS last_intent
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE {where_clause}
                ORDER BY hq.queued_at DESC NULLS LAST
                LIMIT %s
                """,
                (sender_pattern, limit)
            )
            rows = cursor.fetchall()
        finally:
            _release_connection(conn)

        history = []
        for r in rows:
            history.append({
                'queue_id':        r['queue_id'],
                'conversation_id': r['conversation_id'],
                'app_id':          r['app_id'] or 'General',
                'handoff_status':  r['handoff_status'],
                'queued_at':       r['queued_at'].isoformat() if r['queued_at'] else None,
                'resolved_at':     r['resolved_at'].isoformat() if r['resolved_at'] else None,
                'abandoned_at':    r['abandoned_at'].isoformat() if r['abandoned_at'] else None,
                'trigger_reason':  r['trigger_reason'],
                'closing_note':    r['closing_note'],
                'first_user_msg':  (r['first_user_msg'] or '')[:120],
                'last_intent':     r['last_intent'],
            })
        return jsonify({'success': True, 'history': history, 'count': len(history)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Admin force-handoff and queue overview ────────────────────────────

@app.route('/admin/handoff/force', methods=['POST'])
def admin_force_handoff():
    """Admin manually pushes a bot conversation into the handoff queue."""
    try:
        from common.conversation_db import enqueue_handoff, log_handoff_consent
        data        = request.get_json(silent=True) or {}
        sender_id   = data.get('sender_id')
        priority    = data.get('priority', 7)
        reason_note = data.get('reason', 'Admin escalation')
        skip_consent = data.get('skip_consent', False)
        app_id      = data.get('app_id', 'General')

        if not sender_id:
            return jsonify({'error': 'sender_id required'}), 400

        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT id, handoff_state FROM conversations WHERE sender_id = %s",
                (sender_id,)
            )
            row = cursor.fetchone()
        finally:
            _release_connection(conn)

        if not row:
            return jsonify({'error': 'Conversation not found'}), 404
        if row['handoff_state'] in ('queued', 'assigned'):
            return jsonify({'error': 'Conversation is already in handoff'}), 409

        conversation_id = row['id']
        if skip_consent:
            log_handoff_consent(sender_id, conversation_id, True, None)

        context_package = _build_context_package(
            sender_id, conversation_id, 'admin_forced',
            {'reason': reason_note, 'admin': data.get('admin_username', 'admin')}
        )
        target_team, required_skill, _ = _apply_routing_rules(app_id, {})
        entry = enqueue_handoff(
            conversation_id=conversation_id,
            sender_id=sender_id,
            app_id=app_id,
            trigger_reason='admin_forced',
            trigger_detail={'reason': reason_note},
            priority=min(9, priority),
            context_package=context_package,
            target_team=data.get('target_team') or target_team,
            required_skill=data.get('required_skill') or required_skill
        )
        if not entry:
            return jsonify({'error': 'Queue is full or enqueue failed'}), 503

        # ── Phase 3: notify operator dashboards of admin-forced queue item ─
        try:
            _sio.emit('new_queue_item', {
                'queue_id':       entry['id'],
                'queue_position': entry.get('queue_position', 1),
                'app_id':         app_id,
                'trigger_reason': 'admin_forced',
                'queued_at':      entry.get('queued_at', ''),
            }, room='queue_overview')
            _emit_queue_overview()
            _sio.emit('conversation_state_change', {
                'sender_id': sender_id,
                'from_state': 'bot_active',
                'to_state':   'queued',
                'triggered_by': 'admin',
            }, room='admin_live')
        except Exception as _afe:
            print(f"[SIO admin_force] notify error (non-fatal): {_afe}")
        # ── end Phase 3 ───────────────────────────────────────────────────

        return jsonify({'success': True, 'queue_id': entry['id'],
                        'position': entry.get('queue_position', 1)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/handoff/analytics', methods=['GET'])
def admin_handoff_analytics():
    """
    Handoff analytics for the given time window.
    Query params:
        days   — lookback window in days (default 7, max 90)
        app_id — filter by app (optional)
    Returns:
        summary KPIs, daily volume series, operator performance table,
        trigger breakdown, top intents at handoff, CSAT distribution.
    """
    try:
        from psycopg2.extras import RealDictCursor
        days   = min(int(request.args.get('days', 7)), 90)
        app_id = request.args.get('app_id') or None

        conn = _get_connection()
        try:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            # ── 1. Summary KPIs ──────────────────────────────────────────────
            app_filter = "AND c.app_id = %s" if app_id else ""
            params_base = [days, app_id] if app_id else [days]

            cur.execute(f"""
                SELECT
                    COUNT(*)                                                  AS total_handoffs,
                    COUNT(*) FILTER (WHERE hq.status = 'resolved')           AS resolved,
                    COUNT(*) FILTER (WHERE hq.status = 'abandoned')          AS abandoned,
                    ROUND(AVG(hq.wait_time_secs)   FILTER (WHERE hq.wait_time_secs   IS NOT NULL) / 60.0, 1) AS avg_wait_mins,
                    ROUND(AVG(hq.handle_time_secs) FILTER (WHERE hq.handle_time_secs IS NOT NULL) / 60.0, 1) AS avg_handle_mins,
                    ROUND(AVG(hq.agent_rating)     FILTER (WHERE hq.agent_rating      IS NOT NULL), 2)       AS avg_csat,
                    COUNT(*) FILTER (WHERE hq.agent_rating IS NOT NULL)      AS csat_responses
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                {app_filter}
            """, params_base)
            kpis = dict(cur.fetchone() or {})
            total = kpis.get('total_handoffs') or 0
            resolved = kpis.get('resolved') or 0
            kpis['resolution_rate'] = round(resolved / total * 100, 1) if total else 0

            # ── 2. Daily volume (last N days) ────────────────────────────────
            cur.execute(f"""
                SELECT
                    DATE(hq.queued_at)                                         AS day,
                    COUNT(*)                                                    AS total,
                    COUNT(*) FILTER (WHERE hq.status = 'resolved')             AS resolved,
                    COUNT(*) FILTER (WHERE hq.status = 'abandoned')            AS abandoned,
                    ROUND(AVG(hq.wait_time_secs) / 60.0, 1)                   AS avg_wait_mins
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                {app_filter}
                GROUP BY DATE(hq.queued_at)
                ORDER BY day ASC
            """, params_base)
            daily = [dict(r) for r in cur.fetchall()]
            for d in daily:
                if d.get('day'):
                    d['day'] = d['day'].isoformat()

            # ── 3. Operator performance ──────────────────────────────────────
            cur.execute(f"""
                SELECT
                    o.display_name,
                    o.team,
                    COUNT(hq.id)                                                AS handled,
                    COUNT(*) FILTER (WHERE hq.status = 'resolved')             AS resolved,
                    ROUND(AVG(hq.handle_time_secs) / 60.0, 1)                  AS avg_handle_mins,
                    ROUND(AVG(hq.wait_time_secs)   / 60.0, 1)                  AS avg_wait_mins,
                    ROUND(AVG(hq.agent_rating) FILTER (WHERE hq.agent_rating IS NOT NULL), 2) AS avg_csat,
                    COUNT(hq.agent_rating)                                      AS csat_count
                FROM handoff_queue hq
                JOIN operators o ON o.id = hq.operator_id
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                  AND hq.operator_id IS NOT NULL
                  {app_filter}
                GROUP BY o.id, o.display_name, o.team
                ORDER BY handled DESC
            """, params_base)
            operators = [dict(r) for r in cur.fetchall()]

            # ── 4. Trigger breakdown ─────────────────────────────────────────
            cur.execute(f"""
                SELECT
                    hq.trigger_reason,
                    COUNT(*) AS count
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                {app_filter}
                GROUP BY hq.trigger_reason
                ORDER BY count DESC
            """, params_base)
            triggers = [dict(r) for r in cur.fetchall()]

            # ── 5. Top intents at handoff (last message intent) ──────────────
            cur.execute(f"""
                SELECT
                    m.intent,
                    COUNT(*) AS count
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                JOIN LATERAL (
                    SELECT intent FROM messages
                    WHERE conversation_id = hq.conversation_id
                      AND sender = 'user' AND intent IS NOT NULL
                    ORDER BY timestamp DESC LIMIT 1
                ) m ON TRUE
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                  {app_filter}
                  AND m.intent IS NOT NULL
                GROUP BY m.intent
                ORDER BY count DESC
                LIMIT 10
            """, params_base)
            top_intents = [dict(r) for r in cur.fetchall()]

            # ── 6. CSAT distribution (1-5) ───────────────────────────────────
            cur.execute(f"""
                SELECT
                    hq.agent_rating AS rating,
                    COUNT(*)        AS count
                FROM handoff_queue hq
                JOIN conversations c ON c.id = hq.conversation_id
                WHERE hq.queued_at > NOW() - INTERVAL '%s days'
                  AND hq.agent_rating IS NOT NULL
                  {app_filter}
                GROUP BY hq.agent_rating
                ORDER BY hq.agent_rating
            """, params_base)
            csat_dist = [dict(r) for r in cur.fetchall()]

        finally:
            _release_connection(conn)

        return jsonify({
            'success':     True,
            'days':        days,
            'app_id':      app_id,
            'kpis':        kpis,
            'daily':       daily,
            'operators':   operators,
            'triggers':    triggers,
            'top_intents': top_intents,
            'csat_dist':   csat_dist,
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/admin/monitor/queue', methods=['GET'])
def admin_monitor_queue():
    """Queue overview: waiting items + online operators with current load."""
    try:
        from common.conversation_db import (
            get_queue, get_operators, get_operator_current_load, get_available_operators
        )
        app_id = request.args.get('app_id')
        waiting  = get_queue(app_id=app_id, status='waiting')
        assigned = get_queue(app_id=app_id, status='assigned')
        ops      = get_operators()
        op_list  = []
        for op in ops:
            load = get_operator_current_load(op['id'])
            op_list.append({
                'id':             op['id'],
                'display_name':   op['display_name'],
                'team':           op.get('team'),
                'status':         op.get('status', 'offline'),
                'current_load':   load,
                'max_concurrent': op.get('max_concurrent', 3),
                'last_seen':      op.get('last_seen')
            })

        avg_wait = None
        if waiting:
            from datetime import datetime as _dt
            waits = []
            for item in waiting:
                if item.get('queued_at'):
                    try:
                        qt = _dt.fromisoformat(item['queued_at'])
                        waits.append((_dt.now() - qt).total_seconds())
                    except Exception:
                        pass
            avg_wait = round(sum(waits) / len(waits) / 60, 1) if waits else 0

        return jsonify({
            'success': True,
            'waiting_count': len(waiting),
            'assigned_count': len(assigned),
            'avg_wait_mins': avg_wait,
            'waiting': waiting,
            'assigned': assigned,
            'operators': op_list
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================================
# HANDOFF — PHASE 3: REAL-TIME SOCKET.IO LAYER
# All rooms, event handlers, background threads.
# Nothing here references Rasa — all state is in Postgres.
# ============================================================================

import time as _time
from datetime import datetime as _sio_dt

_sio = _get_socketio()  # shorthand reference after init

# ── Connection / join handlers ───────────────────────────────────────────────

@_sio.on('connect')
def _sio_connect():
    """Client connected — rooms joined via explicit join_* events below."""
    pass


@_sio.on('disconnect')
def _sio_disconnect():
    pass


@_sio.on('user_end_session')
def _sio_user_end_session(data):
    """
    Chat widget emits this when the user ends their session (logout, manual end,
    inactivity timeout) while a handoff is active.
    payload: { sender_id: str }
    Cancels any queued or assigned handoff and notifies the operator.
    """
    sender_id = (data or {}).get('sender_id', '')
    if not sender_id:
        return
    try:
        from datetime import datetime as _dt
        from psycopg2.extras import RealDictCursor as _RRC
        conn = _get_connection()
        try:
            cur = conn.cursor(cursor_factory=_RRC)
            # Find active queue item for this sender
            cur.execute(
                "SELECT hq.id, hq.status, hq.conversation_id, hq.operator_id "
                "FROM handoff_queue hq "
                "JOIN conversations c ON c.id = hq.conversation_id "
                "WHERE c.sender_id = %s AND hq.status IN ('waiting', 'assigned') "
                "ORDER BY hq.queued_at DESC LIMIT 1",
                (sender_id,)
            )
            row = cur.fetchone()
            if not row:
                return  # No active handoff — nothing to do

            queue_id  = row['id']
            conv_id   = row['conversation_id']
            op_id     = row['operator_id']
            was_assigned = row['status'] == 'assigned'

            if was_assigned:
                # User disconnected mid-chat — abandoned, NOT resolved.
                cur.execute(
                    "UPDATE handoff_queue "
                    "SET status = 'abandoned', abandoned_at = %s, closing_note = 'User ended session', "
                    "handle_time_secs = EXTRACT(EPOCH FROM (NOW() - assigned_at))::INT "
                    "WHERE id = %s",
                    (_dt.now(), queue_id)
                )
                new_state = 'closed'
            else:
                cur.execute(
                    "UPDATE handoff_queue "
                    "SET status = 'abandoned', abandoned_at = %s, closing_note = 'User left queue' "
                    "WHERE id = %s",
                    (_dt.now(), queue_id)
                )
                new_state = 'bot_active'

            cur.execute(
                "UPDATE conversations SET handoff_state = %s, assigned_operator_id = NULL "
                "WHERE id = %s",
                (new_state, conv_id)
            )
            cur.execute(
                "INSERT INTO handoff_state_log "
                "(conversation_id, from_state, to_state, triggered_by, triggered_by_id, note) "
                "VALUES (%s, %s, %s, 'user', NULL, 'User ended session')",
                (conv_id, 'assigned' if was_assigned else 'queued', new_state)
            )
            conn.commit()
        finally:
            _release_connection(conn)

        # Notify operator if they were in an active chat
        if was_assigned and op_id:
            _sio.emit('user_left', {
                'conversation_id': conv_id,
                'sender_id':       sender_id,
                'message':         'The user has ended the conversation.',
            }, room=_room_operator(op_id))

        # Refresh queue overview for all operators
        _sio.emit('queue_item_removed', {'queue_id': queue_id, 'status': 'abandoned'},
                  room='queue_overview')
        _emit_queue_overview()

    except Exception as _e:
        print(f"[SIO user_end_session] error (non-fatal): {_e}")


@_sio.on('join_user')
def _sio_join_user(data):
    """
    Chat widget calls this to subscribe to handoff events for a given sender.
    payload: { sender_id: str }
    """
    sender_id = (data or {}).get('sender_id', '')
    if sender_id:
        join_room(_room_user(sender_id))


@_sio.on('leave_user')
def _sio_leave_user(data):
    sender_id = (data or {}).get('sender_id', '')
    if sender_id:
        leave_room(_room_user(sender_id))


@_sio.on('join_operator')
def _sio_join_operator(data):
    """
    Operator dashboard calls this after JWT login.
    payload: { operator_id: int|str, token: str }
    Validates the JWT before admitting to the operator room.
    """
    try:
        token   = (data or {}).get('token', '')
        payload = _jwt_decode(token, _get_handoff_cfg_value('operator_jwt_secret'))
        op_id   = payload.get('sub') or payload.get('operator_id')
        if not op_id:
            return
        join_room(_room_operator(op_id))
        join_room('queue_overview')
        # Room membership only — DB status is managed exclusively by the heartbeat
        emit('joined_operator', {'operator_id': op_id, 'room': _room_operator(op_id)})
    except Exception:
        pass


@_sio.on('leave_operator')
def _sio_leave_operator(data):
    op_id = (data or {}).get('operator_id')
    if op_id:
        leave_room(_room_operator(op_id))
        leave_room('queue_overview')


@_sio.on('join_admin_live')
def _sio_join_admin_live(data):
    """Admin overview room — no auth for now (admin API is behind separate auth)."""
    join_room('admin_live')
    join_room('queue_overview')


@_sio.on('join_admin_watch')
def _sio_join_admin_watch(data):
    """Admin deep-watching a specific conversation."""
    conv_id = (data or {}).get('conversation_id')
    if conv_id:
        join_room(_room_admin_watch(conv_id))


@_sio.on('leave_admin_watch')
def _sio_leave_admin_watch(data):
    conv_id = (data or {}).get('conversation_id')
    if conv_id:
        leave_room(_room_admin_watch(conv_id))


# ── Typing indicators ────────────────────────────────────────────────────────

@_sio.on('user_typing')
def _sio_user_typing(data):
    """
    Chat widget emits this when user starts/stops typing.
    payload: { sender_id: str, conversation_id: int, typing: bool }
    Forwarded to the operator room for that conversation.
    """
    try:
        conv_id = (data or {}).get('conversation_id')
        if not conv_id:
            return
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor as _RDC2
            cur = conn.cursor(cursor_factory=_RDC2)
            cur.execute(
                "SELECT assigned_operator_id FROM conversations WHERE id = %s",
                (conv_id,)
            )
            row = cur.fetchone()
        finally:
            _release_connection(conn)
        if row and row.get('assigned_operator_id'):
            _sio.emit('user_typing', {
                'conversation_id': conv_id,
                'typing': data.get('typing', False),
            }, room=_room_operator(row['assigned_operator_id']))
    except Exception:
        pass


@_sio.on('operator_typing')
def _sio_operator_typing(data):
    """
    Operator dashboard emits this when typing in reply box.
    payload: { sender_id: str, conversation_id: int, typing: bool }
    Forwarded to the user room.
    """
    sender_id = (data or {}).get('sender_id')
    if sender_id:
        _sio.emit('operator_typing', {
            'conversation_id': data.get('conversation_id'),
            'typing': data.get('typing', False),
        }, room=_room_user(sender_id))


# ── Public helper — emit to user room ────────────────────────────────────────

def _emit_to_user(sender_id: str, event: str, payload: dict):
    """Thread-safe emit to a user's Socket.IO room."""
    try:
        _sio.emit(event, payload, room=_room_user(sender_id))
    except Exception as _e:
        print(f"[SIO] emit_to_user error ({event}): {_e}")


def _emit_to_operator(op_id, event: str, payload: dict):
    """Thread-safe emit to an operator's Socket.IO room."""
    try:
        _sio.emit(event, payload, room=_room_operator(op_id))
    except Exception as _e:
        print(f"[SIO] emit_to_operator error ({event}): {_e}")


def _emit_queue_overview():
    """Push a lightweight queue summary to all operator tabs."""
    try:
        from common.conversation_db import get_queue, get_operators, get_operator_current_load
        waiting  = get_queue(status='waiting')
        assigned = get_queue(status='assigned')
        _sio.emit('queue_overview_update', {
            'waiting_count':  len(waiting),
            'assigned_count': len(assigned),
        }, room='queue_overview')
    except Exception as _e:
        print(f"[SIO] queue_overview emit error: {_e}")


def _get_handoff_cfg_value(key: str, default=None):
    """Safely read a single handoff config key."""
    try:
        from common.config_manager import get_handoff_config
        return get_handoff_config().get(key, default)
    except Exception:
        return default


# ── Background: queue timeout ────────────────────────────────────────────────
# After ask_user_after_mins of waiting, send user a Remain/Leave message.

def _queue_timeout_worker():
    """
    Polls DB for queue items whose wait exceeds ask_user_after_mins.
    Sends a Socket.IO message to the user with Remain/Leave options.
    Runs every 30 s.
    """
    import traceback
    _time.sleep(10)  # brief startup grace
    while True:
        try:
            from common.conversation_db import get_handoff_runtime_config
            cfg        = get_handoff_runtime_config()
            ask_after  = int(cfg.get('queue', {}).get('ask_user_after_mins', 10))
            timeout_total = int(cfg.get('queue', {}).get('timeout_total_mins', 30))

            conn = _get_connection()
            try:
                from psycopg2.extras import RealDictCursor as _QTRC
                cur = conn.cursor(cursor_factory=_QTRC)
                # Items waiting longer than ask_after mins that haven't been asked yet
                cur.execute("""
                    SELECT hq.id, hq.conversation_id, c.sender_id,
                           EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60 AS wait_mins
                    FROM handoff_queue hq
                    JOIN conversations c ON c.id = hq.conversation_id
                    WHERE hq.status = 'waiting'
                      AND hq.queued_at IS NOT NULL
                      AND (hq.timeout_asked_at IS NULL)
                      AND EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60 >= %s
                """, (ask_after,))
                rows = cur.fetchall() or []
                for row in rows:
                    # Mark as asked so we don't repeat
                    cur.execute(
                        "UPDATE handoff_queue SET timeout_asked_at = NOW() WHERE id = %s",
                        (row['id'],)
                    )
                    conn.commit()
                    _emit_to_user(row['sender_id'], 'handoff_timeout_choice', {
                        'conversation_id': row['conversation_id'],
                        'wait_mins':       round(row['wait_mins'], 1),
                        'message':         (
                            f"⏳ You've been waiting for {round(row['wait_mins'], 0):.0f} minutes. "
                            "Would you like to keep waiting or leave your email so an agent can follow up?"
                        ),
                        'options': [
                            {'label': '🕐 Remain in Queue', 'value': 'remain'},
                            {'label': '📧 Leave my email', 'value': 'leave_email'},
                        ],
                    })

                # Also emit total timeout (abandon queue, back to bot)
                cur.execute("""
                    SELECT hq.id, hq.conversation_id, c.sender_id
                    FROM handoff_queue hq
                    JOIN conversations c ON c.id = hq.conversation_id
                    WHERE hq.status = 'waiting'
                      AND hq.queued_at IS NOT NULL
                      AND EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60 >= %s
                """, (timeout_total,))
                expired = cur.fetchall() or []
                for row in expired:
                    cur.execute(
                        "UPDATE handoff_queue SET status = 'abandoned' WHERE id = %s",
                        (row['id'],)
                    )
                    cur.execute(
                        "UPDATE conversations SET handoff_state = 'bot_active', assigned_operator_id = NULL "
                        "WHERE id = %s",
                        (row['conversation_id'],)
                    )
                    cur.execute(
                        "INSERT INTO handoff_state_log "
                        "(conversation_id, from_state, to_state, triggered_by, note) "
                        "VALUES (%s, 'queued', 'bot_active', 'system', 'queue timeout')",
                        (row['conversation_id'],)
                    )
                    conn.commit()
                    _emit_to_user(row['sender_id'], 'handoff_abandoned', {
                        'conversation_id': row['conversation_id'],
                        'message': (
                            "⚠️ The queue wait exceeded our limit. "
                            "I'm returning you to the bot. You can create a ticket and an agent will follow up."
                        ),
                    })
                    _emit_queue_overview()
            finally:
                _release_connection(conn)
        except Exception:
            traceback.print_exc()
        _time.sleep(30)


# ── Background: wait-time refresh ────────────────────────────────────────────
# Every 60 s push updated wait estimate to all queued users.

def _wait_refresh_worker():
    """Push wait_update to each queued user every 60 s."""
    import traceback
    _time.sleep(15)
    while True:
        try:
            conn = _get_connection()
            try:
                from psycopg2.extras import RealDictCursor as _WRRC
                cur = conn.cursor(cursor_factory=_WRRC)
                cur.execute("""
                    SELECT hq.id, hq.queue_position, c.sender_id,
                           ROUND(EXTRACT(EPOCH FROM (NOW() - hq.queued_at)) / 60) AS wait_mins
                    FROM handoff_queue hq
                    JOIN conversations c ON c.id = hq.conversation_id
                    WHERE hq.status = 'waiting'
                """)
                rows = cur.fetchall() or []
            finally:
                _release_connection(conn)

            from common.conversation_db import get_handoff_runtime_config
            cfg = get_handoff_runtime_config()
            avg_handle = float(cfg.get('queue', {}).get('avg_handle_time_mins', 8))

            for row in rows:
                pos = int(row['queue_position'] or 1)
                est = round(pos * avg_handle)
                _emit_to_user(row['sender_id'], 'wait_update', {
                    'queue_position':   pos,
                    'wait_estimate_mins': est,
                    'actual_wait_mins': int(row['wait_mins'] or 0),
                })
        except Exception:
            traceback.print_exc()
        _time.sleep(60)


# ── Background: priority boost ───────────────────────────────────────────────
# Every 5 min increment priority of long-waiting items (max 9).

def _priority_boost_worker():
    """Boost priority of items waiting > 5 min, capped at 9."""
    import traceback
    _time.sleep(20)
    while True:
        try:
            conn = _get_connection()
            try:
                cur = conn.cursor()
                cur.execute("""
                    UPDATE handoff_queue
                    SET priority = LEAST(priority + 1, 9)
                    WHERE status = 'waiting'
                      AND queued_at IS NOT NULL
                      AND EXTRACT(EPOCH FROM (NOW() - queued_at)) / 60 >= 5
                      AND priority < 9
                """)
                conn.commit()
            finally:
                _release_connection(conn)
        except Exception:
            traceback.print_exc()
        _time.sleep(300)  # every 5 min


# ── Background: operator heartbeat watchdog ──────────────────────────────────
# Marks operators offline if they haven't sent a heartbeat recently.

def _heartbeat_watchdog():
    """Set operators offline if last_seen > heartbeat_timeout_secs ago."""
    import traceback
    _time.sleep(30)
    while True:
        try:
            timeout_secs = int(_get_handoff_cfg_value('operator_heartbeat_timeout_secs', 90))
            conn = _get_connection()
            try:
                from psycopg2.extras import RealDictCursor as _HWRC
                cur = conn.cursor(cursor_factory=_HWRC)
                cur.execute("""
                    UPDATE operators
                    SET status = 'offline'
                    WHERE status IN ('available', 'busy', 'away')
                      AND last_seen IS NOT NULL
                      AND EXTRACT(EPOCH FROM (NOW() - last_seen)) > %s
                    RETURNING id, display_name
                """, (timeout_secs,))
                gone_offline = cur.fetchall() or []
                if gone_offline:
                    conn.commit()
                    for op in gone_offline:
                        print(f"[Heartbeat watchdog] Operator {op['display_name']} set offline (missed heartbeat)")
                        _sio.emit('capacity_update', {
                            'operator_id': op['id'],
                            'status': 'offline',
                        }, room='queue_overview')
            finally:
                _release_connection(conn)
        except Exception:
            traceback.print_exc()
        _time.sleep(30)


# ── Background: orphaned state healer ────────────────────────────────────────
# Conversations stuck as 'queued' or 'assigned' but with no live queue row
# (can happen after a crash or manual DB edit) are reset to 'bot_active'.

def _orphan_state_healer():
    """Every 5 minutes, heal conversations whose handoff_state is out of sync."""
    import traceback
    _time.sleep(60)  # give the server time to fully boot first
    while True:
        try:
            conn = _get_connection()
            try:
                cur = conn.cursor()
                # conversations marked 'queued' but no waiting queue row
                cur.execute("""
                    UPDATE conversations
                    SET handoff_state = 'bot_active', assigned_operator_id = NULL
                    WHERE handoff_state = 'queued'
                      AND NOT EXISTS (
                          SELECT 1 FROM handoff_queue hq
                          WHERE hq.conversation_id = conversations.id
                            AND hq.status = 'waiting'
                      )
                """)
                healed_queued = cur.rowcount

                # conversations marked 'assigned' but no assigned queue row
                cur.execute("""
                    UPDATE conversations
                    SET handoff_state = 'bot_active', assigned_operator_id = NULL
                    WHERE handoff_state = 'assigned'
                      AND NOT EXISTS (
                          SELECT 1 FROM handoff_queue hq
                          WHERE hq.conversation_id = conversations.id
                            AND hq.status = 'assigned'
                      )
                """)
                healed_assigned = cur.rowcount

                if healed_queued or healed_assigned:
                    conn.commit()
                    print(f"[OrphanHealer] Healed {healed_queued} queued + {healed_assigned} assigned orphans")
                else:
                    conn.rollback()
            finally:
                _release_connection(conn)
        except Exception:
            traceback.print_exc()
        _time.sleep(300)  # run every 5 minutes


# ── Start all background threads ─────────────────────────────────────────────

import threading as _threading

_threading.Thread(target=_queue_timeout_worker,  daemon=True, name='sio-queue-timeout').start()
_threading.Thread(target=_wait_refresh_worker,   daemon=True, name='sio-wait-refresh').start()
_threading.Thread(target=_priority_boost_worker, daemon=True, name='sio-priority-boost').start()
_threading.Thread(target=_heartbeat_watchdog,    daemon=True, name='sio-heartbeat-watchdog').start()
_threading.Thread(target=_orphan_state_healer,   daemon=True, name='sio-orphan-healer').start()


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
