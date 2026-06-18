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
        _room = _room_user(sender_id)
        try:
            _members = sio.server.manager.rooms.get('/', {}).get(_room)
            _n = len(_members) if _members else 0
        except Exception:
            _n = -1
        print(f"[SIO emit_to_user] event={event} room={_room} members={_n}", flush=True)
        sio.emit(event, payload, room=_room)
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
            # Convenience shortcuts on g
            g.org_id           = user.get('org_id', '')
            g.org_name         = user.get('org_name', '')
            g.is_platform_admin = user.get('is_platform_admin', False)
            g.is_client_admin  = user.get('is_client_admin', False)
            g.is_operator      = user.get('is_operator', False)
            g.product_roles    = user.get('product_roles', [])
            g.channel          = user.get('channel', 'internal')
        except IamTokenError as e:
            return jsonify({'error': str(e)}), 401
        return f(*args, **kwargs)
    return decorated


# ── Multi-tenant scope helpers ────────────────────────────────────────────────

def caller_org_scope():
    """Return the org_id a caller's data must be scoped to, or None when they may
    see all tenants. Requires g.iam_user (route wrapped in @require_iam_token).

    - Tenant admins/operators/users → ALWAYS their own org (an override is ignored,
      so a tenant can never read another tenant's data).
    - Platform/super admins → may optionally filter to ONE tenant via the
      `X-Org-Id` header (or `?org_id=`), set by the super-admin tenant switcher.
      No selection → None (sees all tenants)."""
    from flask import g, request
    user = getattr(g, 'iam_user', None) or {}
    if user.get('is_platform_admin'):
        override = (request.headers.get('X-Org-Id')
                    or request.args.get('org_id') or '').strip()
        return override or None
    return user.get('org_id') or None


def get_org_filter(override_org_id: str = None) -> tuple:
    """
    Return (sql_fragment, params_dict) for WHERE clause based on caller's role.
    Platform admin can optionally filter to a specific org via override_org_id.
    """
    from flask import g
    user = getattr(g, 'iam_user', None)
    if not user:
        return "1=0", {}   # no access if not authenticated

    if user.get('is_platform_admin'):
        if override_org_id:
            return "org_id = %(org_id)s", {'org_id': override_org_id}
        return "1=1", {}   # sees everything

    if user.get('is_client_admin') or user.get('is_operator'):
        org_id = user.get('org_id') or ''
        return "org_id = %(org_id)s", {'org_id': org_id}

    # Members only see their own data — caller must add sender_id filter too
    return "org_id = %(org_id)s", {'org_id': user.get('org_id', '')}


def get_operator_queue_filter() -> tuple:
    """
    Return (sql_fragment, params_dict) scoping handoff_queue to what
    this operator is allowed to see.
    """
    from flask import g
    from common.config_manager import get_platform_config

    user = getattr(g, 'iam_user', None)
    if not user:
        return "1=0", {}

    platform_org = get_platform_config().get('org_id', '')

    # 99Tech Project IQ Operator → sees platform channel only
    if user.get('org_id') == platform_org and platform_org:
        sql = "support_org_id = %(support_org_id)s AND channel = 'platform'"
        params = {'support_org_id': platform_org}
    else:
        # Client Operator → sees their org's internal queue
        sql    = "user_org_id = %(org_id)s AND channel = 'internal'"
        params = {'org_id': user.get('org_id', '')}

    # Narrow to assigned products if operator has product-specific roles
    product_roles = user.get('product_roles', [])
    if product_roles:
        sql += " AND product_id = ANY(%(products)s)"
        params['products'] = product_roles

    return sql, params


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
