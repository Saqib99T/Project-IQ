"""
Admin API Module
Flask API for admin dashboard operations, analytics, and static file serving.
Consolidated server running on port 8181.
Extensible for any plugin modules like Firecrawl, Airbyte...
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
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
                transformed.append({
                    "id": f"glpi_{article['id']}",
                    "title": article.get('name', 'Untitled'),
                    "category": "general",
                    "source": "glpi",
                    "glpi_id": article['id'],
                    "is_faq": article.get('is_faq', 0) == 1,
                    "date_modified": article.get('date_mod', ''),
                    "question": article.get('question', ''),
                    "answer": article.get('answer', '')[:200] + '...' if article.get('answer') else ''
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
@app.route('/')
def serve_index():
    return send_from_directory(STATIC_DIR, 'admin.html')

@app.route('/admin.html')
def serve_admin():
    return send_from_directory(STATIC_DIR, 'admin.html')

@app.route('/inspector.html')
def serve_inspector():
    return send_from_directory(STATIC_DIR, 'inspector.html')

@app.route('/analytics.html')
def serve_analytics():
    return send_from_directory(STATIC_DIR, 'analytics.html')

@app.route('/glpi-chat-widget.js')
def serve_widget_js():
    return send_from_directory(WIDGET_DIR, 'glpi-chat-widget.js')

@app.route('/it.html')
def serve_it_widget():
    return send_from_directory(WIDGET_DIR, 'it.html')

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
        api_url = data.get('api_url') or get_file_config().get('FIRECRAWL_API_URL', 'http://localhost:3002')
        api_key = data.get('api_key') or get_file_config().get('FIRECRAWL_API_KEY', 'fc-selfhosted')

        # Firecrawl responds at / with {"message":"Firecrawl API"}
        root_url = api_url.rstrip('/') + '/'
        resp = _requests.get(root_url, timeout=5)

        if resp.status_code == 200 and 'firecrawl' in resp.text.lower():
            return jsonify({"success": True, "message": "Firecrawl is running", "status_code": resp.status_code})
        elif resp.status_code == 200:
            return jsonify({"success": True, "message": "Server reachable", "status_code": resp.status_code})
        else:
            return jsonify({"success": False, "message": f"Unexpected status {resp.status_code}", "status_code": resp.status_code})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "message": "Could not reach Firecrawl — is it running?"}), 200


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
        app_id_filter = request.args.get('app_id', None)
        
        conn = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        query = '''
            SELECT 
                c.id, c.sender_id, c.app_id, c.user_id, c.user_name,
                c.started_at, c.last_activity, c.resolved,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender = 'user') as user_message_count,
                (SELECT COUNT(*) FROM actions WHERE conversation_id = c.id) as action_count,
                (SELECT type FROM feedback WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as feedback
            FROM conversations c
        '''
        
        params = []
        if app_id_filter:
            query += " WHERE c.app_id = %s"
            params.append(app_id_filter)
        
        query += " ORDER BY c.last_activity DESC LIMIT %s"
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
        
        return jsonify({
            "success": True,
            "data": {
                "conversation": {
                    "id": conv['id'], "sender_id": conv['sender_id'], "app_id": conv['app_id'],
                    "user_id": conv['user_id'],
                    "started_at": conv['started_at'].isoformat() if conv['started_at'] else None,
                    "last_activity": conv['last_activity'].isoformat() if conv['last_activity'] else None,
                    "resolved": bool(conv['resolved'])
                },
                "messages": messages, "intent_history": intent_history, "actions": actions, "feedback": feedback,
                "stats": {
                    "total_messages": len(messages),
                    "user_messages": len([m for m in messages if m['sender'] == 'user']),
                    "bot_messages": len([m for m in messages if m['sender'] == 'bot']),
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
    """Save session feedback with rating and comments."""
    try:
        from common.conversation_db import log_feedback

        data = request.get_json()
        sender_id = data.get('sender_id', '').strip()
        rating = data.get('rating')
        comments = data.get('comments', '').strip()
        app_id = data.get('app_id', 'General')
        user_id = data.get('user_id')

        if not sender_id:
            return jsonify({'success': False, 'error': 'sender_id is required'}), 400

        if rating and (not isinstance(rating, int) or rating < 1 or rating > 5):
            return jsonify({'success': False, 'error': 'rating must be between 1 and 5'}), 400

        # Determine feedback type based on rating
        feedback_type = 'positive' if rating and rating >= 4 else 'negative' if rating else 'neutral'

        # Save feedback
        log_feedback(
            sender_id=sender_id,
            feedback_type=feedback_type,
            app_id=app_id,
            user_id=user_id,
            rating=rating,
            comments=comments
        )

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


@app.route('/webhooks/rest/webhook', methods=['POST'])
def chat_webhook_proxy():
    """
    Proxy endpoint for chat messages that automatically logs all bot responses.
    This captures ALL bot messages (from actions AND templates) and logs them to the database.
    """
    try:
        import requests
        from common.conversation_db import log_conversation_start, log_message

        data = request.get_json()
        sender_id = data.get('sender', 'unknown')
        message_text = data.get('message', '')
        metadata = data.get('metadata', {})

        # Extract context from metadata
        app_id = metadata.get('app_id', 'General')
        user_id = metadata.get('user_id', None)
        ticket_id = metadata.get('ticket_id', None)

        # Log the user message
        conv_id = log_conversation_start(sender_id, app_id, user_id=user_id)
        log_message(sender_id, 'user', message_text, intent=None, app_id=app_id, user_id=user_id, ticket_id=ticket_id)

        # Forward to Rasa
        rasa_url = RASA_URL

        rasa_response = requests.post(
            f"{rasa_url}/webhooks/rest/webhook",
            json=data,
            timeout=30
        )

        bot_responses = rasa_response.json() if rasa_response.status_code == 200 else []

        # Log ALL bot responses
        for response in bot_responses:
            response_text = response.get('text', '')
            if response_text:
                log_message(sender_id, 'bot', response_text, intent=None, app_id=app_id, user_id=user_id, ticket_id=ticket_id)

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
    return get_handoff_config()['operator_jwt_expiry_hours']


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
    """Authenticate an operator and return a JWT token."""
    import time
    try:
        data = request.get_json(silent=True) or {}
        username = (data.get('username') or '').strip().lower()
        password = data.get('password') or ''
        if not username or not password:
            return jsonify({'error': 'username and password required'}), 400

        from common.conversation_db import get_operator_by_username, update_operator_last_seen
        op = get_operator_by_username(username)
        if not op or not _verify_password(password, op['password_hash']):
            return jsonify({'error': 'Invalid credentials'}), 401

        expiry_hours = _get_operator_jwt_expiry_hours()
        exp = int(time.time()) + expiry_hours * 3600
        payload = {
            'sub': op['id'],
            'username': op['username'],
            'type': 'operator',
            'exp': exp
        }
        token = _jwt_encode(payload, _get_operator_jwt_secret())
        update_operator_last_seen(op['id'], status='available')
        return jsonify({
            'token': token,
            'operator_id': op['id'],
            'display_name': op['display_name'],
            'team': op.get('team'),
            'app_ids': op.get('app_ids', []),
            'max_concurrent': op.get('max_concurrent', 3)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/logout', methods=['POST'])
@_require_operator_token
def operator_logout(**kwargs):
    """Mark operator as offline."""
    try:
        from common.conversation_db import update_operator_last_seen
        update_operator_last_seen(kwargs['_operator_id'], status='offline')
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/operator/heartbeat', methods=['POST'])
@_require_operator_token
def operator_heartbeat(**kwargs):
    """Keep operator session alive and return current load."""
    try:
        from common.conversation_db import (
            update_operator_last_seen, get_operator_current_load, get_operator
        )
        op_id = kwargs['_operator_id']
        op = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404

        current_load = get_operator_current_load(op_id)
        # Auto-manage busy status based on load
        cfg = get_handoff_runtime_config_for_api()
        if cfg['operators']['auto_busy_on_max_load']:
            if current_load >= op['max_concurrent'] and op['status'] == 'available':
                update_operator_last_seen(op_id, status='busy')
                op['status'] = 'busy'
            elif current_load < op['max_concurrent'] and op['status'] == 'busy':
                update_operator_last_seen(op_id, status='available')
                op['status'] = 'available'
            else:
                update_operator_last_seen(op_id)
        else:
            update_operator_last_seen(op_id)

        return jsonify({
            'status': op['status'],
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


@app.route('/operator/status', methods=['PUT'])
@_require_operator_token
def operator_set_status(**kwargs):
    """Let operator toggle available / away (not busy — that's system-managed)."""
    try:
        from common.conversation_db import update_operator, get_operator_current_load, get_operator
        data = request.get_json(silent=True) or {}
        new_status = data.get('status', '')
        if new_status not in ('available', 'away'):
            return jsonify({'error': "status must be 'available' or 'away'"}), 400
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


@app.route('/internal/operators/available', methods=['GET'])
def internal_operators_available():
    """Check operator availability for a given app_id.
    Called by Rasa action server before offering handoff to user.
    """
    try:
        from common.conversation_db import get_available_operators, get_queue
        app_id = request.args.get('app_id')
        eligible = get_available_operators(app_id)
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

        # Get conversation id
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            cursor.execute(
                "SELECT id FROM conversations WHERE sender_id = %s", (sender_id,)
            )
            row = cursor.fetchone()
        finally:
            _release_connection(conn)

        if not row:
            return jsonify({'error': 'Conversation not found'}), 404
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

        return jsonify({
            'success': True,
            'queue_id': entry['id'],
            'position': entry.get('queue_position', 1),
            'wait_secs': 0,   # Will be pushed via Socket.IO in Phase 3
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
            return jsonify({'error': "match_type must be intent, keyword, app_id, or entity"}), 400

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
    """Return waiting queue items visible to this operator."""
    try:
        from common.conversation_db import get_operator, get_queue
        op = get_operator(kwargs['_operator_id'])
        if not op:
            return jsonify({'error': 'Operator not found'}), 404
        items = []
        for app_id in (op.get('app_ids') or []):
            items += get_queue(app_id=app_id, team=op.get('team'), status='waiting')
        # Deduplicate by queue id
        seen = set()
        unique = []
        for item in items:
            if item['id'] not in seen:
                seen.add(item['id'])
                unique.append(item)
        unique.sort(key=lambda x: (-x.get('priority', 5), x.get('queued_at', '')))
        return jsonify({'success': True, 'queue': unique, 'count': len(unique)})
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

            return jsonify({'success': True, 'queue_item': dict(row)})
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
    """Return interleaved message history (bot + operator messages) for a conversation."""
    try:
        conn = _get_connection()
        try:
            from psycopg2.extras import RealDictCursor
            cursor = conn.cursor(cursor_factory=RealDictCursor)
            # Bot + user messages
            cursor.execute(
                "SELECT sender, text, intent, timestamp FROM messages "
                "WHERE conversation_id = %s ORDER BY timestamp ASC",
                (conversation_id,)
            )
            bot_msgs = [
                {**dict(m), 'source': 'chat',
                 'timestamp': m['timestamp'].isoformat() if m['timestamp'] else None}
                for m in cursor.fetchall()
            ]
            # Operator messages
            cursor.execute(
                "SELECT om.message_text AS text, om.sent_at AS timestamp, "
                "o.display_name AS operator_name "
                "FROM operator_messages om "
                "JOIN operators o ON o.id = om.operator_id "
                "WHERE om.conversation_id = %s ORDER BY om.sent_at ASC",
                (conversation_id,)
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
            conn.commit()
        finally:
            _release_connection(conn)

        return jsonify({'success': True, 'message_id': msg_id})
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
        return jsonify({'success': True, 'queue_id': entry['id'],
                        'position': entry.get('queue_position', 1)})
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


if __name__ == '__main__':
    import os as _os
    _port = int(_os.environ.get('ADMIN_PORT', 8181))
    print(f"Starting Unified Server on port {_port}...")
    print(f"Admin files from: {STATIC_DIR}")
    print(f"Widget files from: {WIDGET_DIR}")
    print(f"  Admin Dashboard:        http://<YOUR_IP>:{_port}/admin.html")
    print(f"  Chat Widget (IT):       http://<YOUR_IP>:{_port}/it.html")
    print(f"  Chat Widget (ACC):      http://<YOUR_IP>:{_port}/acc.html")
    app.run(host='0.0.0.0', port=_port)
