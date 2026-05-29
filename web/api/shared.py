"""
Shared state for all Admin API blueprints.

Import this module to access the SocketIO instance, auth decorators,
session dicts, JWT helpers, and emit helpers.

Nothing here imports from admin_api.py — zero circular imports.
admin_api.py calls shared.configure() after the Flask app is created.
"""
import hashlib
import hmac
import base64
import json
import os
from functools import wraps
from typing import Optional

from flask import request, jsonify, current_app
from flask_socketio import SocketIO

# ── SocketIO singleton (bound to Flask app in admin_api.py via init_app) ──────
sio = SocketIO()

# ── Shared mutable state ──────────────────────────────────────────────────────
# Admin dashboard sessions: token → {user_id, user_name, ...}
admin_sessions: dict = {}

# Runtime config — set by admin_api.configure() at startup
RASA_URL:    str = ''
ACTION_URL:  str = ''
STATIC_DIR:  str = ''
WIDGET_DIR:  str = ''


# Admin dashboard: GLPI profile IDs / names allowed to log in
ALLOWED_ADMIN_PROFILE_IDS:   list = [4]               # 4 = GLPI Super-Admin
ALLOWED_ADMIN_PROFILE_NAMES: list = ['Super-Admin']


def configure(rasa_url: str, action_url: str, static_dir: str, widget_dir: str) -> None:
    """Called once by admin_api.py after the Flask app is fully initialised."""
    global RASA_URL, ACTION_URL, STATIC_DIR, WIDGET_DIR
    RASA_URL   = rasa_url
    ACTION_URL = action_url
    STATIC_DIR = static_dir
    WIDGET_DIR = widget_dir


# ── Room name helpers ─────────────────────────────────────────────────────────
def _room_user(sender_id: str) -> str:
    return f"user:{sender_id}"

def _room_operator(op_id) -> str:
    return f"operator:{op_id}"

def _room_admin_watch(conv_id) -> str:
    return f"admin_watch:{conv_id}"


# ── Thread-safe emit helpers ──────────────────────────────────────────────────
def emit_to_user(sender_id: str, event: str, payload: dict) -> None:
    try:
        sio.emit(event, payload, room=_room_user(sender_id))
    except Exception as e:
        print(f"[SIO] emit_to_user error ({event}): {e}")


def emit_to_operator(op_id, event: str, payload: dict) -> None:
    try:
        sio.emit(event, payload, room=_room_operator(op_id))
    except Exception as e:
        print(f"[SIO] emit_to_operator error ({event}): {e}")


def emit_queue_overview() -> None:
    """Push a lightweight queue summary to all operator tabs."""
    try:
        from common.conversation_db import get_queue
        waiting  = get_queue(status='waiting')
        assigned = get_queue(status='assigned')
        sio.emit('queue_overview_update', {
            'waiting_count':  len(waiting),
            'assigned_count': len(assigned),
        }, room='queue_overview')
    except Exception as e:
        print(f"[SIO] emit_queue_overview error: {e}")


# ── JWT helpers (stdlib only — no PyJWT required) ────────────────────────────
def jwt_encode(payload: dict, secret: str) -> str:
    """Minimal HS256 JWT encoder."""
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


def jwt_decode(token: str, secret: str) -> Optional[dict]:
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
        padding = 4 - len(body_b) % 4
        payload = json.loads(base64.urlsafe_b64decode(body_b + '=' * padding))
        if 'exp' in payload and payload['exp'] < int(time.time()):
            return None
        return payload
    except Exception:
        return None


def get_operator_jwt_secret() -> str:
    from common.config_manager import get_handoff_config
    return get_handoff_config()['operator_jwt_secret']


def get_operator_jwt_expiry_hours() -> int:
    from common.config_manager import get_handoff_config
    return int(get_handoff_config().get('operator_jwt_expiry_hours', 24))


# ── Auth decorators ───────────────────────────────────────────────────────────
def require_operator_token(f):
    """Decorator: validates operator JWT, injects _operator_id into kwargs."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Missing or invalid Authorization header'}), 401
        token = auth[7:]
        payload = jwt_decode(token, get_operator_jwt_secret())
        if not payload or payload.get('type') != 'operator':
            return jsonify({'error': 'Invalid or expired token'}), 401
        kwargs['_operator_id'] = payload['sub']
        kwargs['_operator_username'] = payload.get('username', '')
        return f(*args, **kwargs)
    return decorated


def require_iam_token(f):
    """Decorator: validates Keycloak Bearer JWT, injects g.iam_user into Flask context."""
    @wraps(f)
    def decorated(*args, **kwargs):
        from flask import g
        from common.iam_service import get_iam_user_from_request, IamTokenError
        try:
            user = get_iam_user_from_request(request)
            if not user:
                return jsonify({'error': 'Missing Authorization header'}), 401
            g.iam_user = user
        except IamTokenError as e:
            return jsonify({'error': str(e)}), 401
        return f(*args, **kwargs)
    return decorated


def require_role(role: str):
    """Decorator factory: requires require_iam_token already applied + a specific realm role."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            from flask import g
            user = getattr(g, 'iam_user', None)
            if not user:
                return jsonify({'error': 'Not authenticated'}), 401
            if role not in user.get('realm_roles', []):
                return jsonify({'error': f'Role required: {role}'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator


def get_iam_user_or_guest(request_obj) -> dict | None:
    """
    Try to extract IAM user from request.
    Returns normalised user dict or None if no Bearer token (guest).
    Raises IamTokenError if token present but invalid.
    """
    from common.iam_service import get_iam_user_from_request
    return get_iam_user_from_request(request_obj)


def require_admin_token(f):
    """Decorator: validates admin session token or dev-mode bypass."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            token = auth[7:]
            # Check admin_sessions dict
            session_data = admin_sessions.get(token)
            if session_data:
                kwargs['_admin_username'] = session_data.get('user_name', 'admin')
                return f(*args, **kwargs)
            # Check JWT-based admin token
            payload = jwt_decode(token, get_operator_jwt_secret())
            if payload and payload.get('type') == 'admin':
                kwargs['_admin_username'] = payload.get('username', 'admin')
                return f(*args, **kwargs)
        from common.config_manager import get_profile
        if get_profile() == 'local':
            kwargs['_admin_username'] = 'dev_admin'
            return f(*args, **kwargs)
        return jsonify({'error': 'Admin authentication required'}), 401
    return decorated


# ── Password helpers ──────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    salt = os.urandom(16).hex()
    h = hashlib.sha256(f"{salt}{plain}".encode()).hexdigest()
    return f"{salt}:{h}"


def verify_password(plain: str, stored: str) -> bool:
    try:
        if stored == 'glpi-managed':
            return False
        salt, hashed = stored.split(':', 1)
        return hashlib.sha256(f"{salt}{plain}".encode()).hexdigest() == hashed
    except Exception:
        return False
