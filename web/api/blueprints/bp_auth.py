"""
Authentication blueprint — admin login/logout/verify + operator login/logout/token.
"""
import asyncio
import uuid
import time
import base64
import hashlib
import hmac
import json as _json

import eventlet
import eventlet.tpool

from flask import Blueprint, request, jsonify
from common.conversation_db import _get_connection, _release_connection
import web.api.shared as _s

bp = Blueprint('auth', __name__)

# ── Admin auth ─────────────────────────────────────────────────────────────────

@bp.route('/admin/login', methods=['POST'])
def admin_login():
    """Authenticate admin via local credentials OR GLPI."""
    try:
        data     = request.get_json() or {}
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()

        if not username or not password:
            return jsonify({"success": False, "error": "Username and password are required"}), 400

        # 1. Local fallback (works even when GLPI is down)
        from common.config_manager import get_all_config as _gcfg
        cfg        = _gcfg()
        local_user = cfg.get('SERVER', {}).get('admin_user', 'admin')
        local_pass = cfg.get('SERVER', {}).get('admin_password', 'projectiq123')

        if username == local_user and password == local_pass:
            token = f"local-{uuid.uuid4()}"
            _s.admin_sessions[token] = {
                "user_id": 0, "user_name": "admin", "firstname": "Administrator",
                "profile_id": 4, "profile_name": "Super-Admin (Local)"
            }
            print(f"[ADMIN AUTH] Local login: {username}")
            return jsonify({"success": True, "session_token": token,
                            "user": {"id": 0, "name": "admin",
                                     "firstname": "Administrator",
                                     "profile": "Super-Admin (Local)"}})

        # 2. GLPI auth
        from action_server.actions.glpi_service import GlpiService
        from common.config_manager import get_glpi_config
        glpi_cfg     = get_glpi_config()
        glpi_service = GlpiService(glpi_cfg['api_url'], glpi_cfg['app_token'], glpi_cfg['user_token'])

        result = eventlet.tpool.execute(
            asyncio.run, glpi_service.login_with_credentials(username, password)
        )
        if not result.get('success'):
            return jsonify({"success": False, "error": result.get('error', 'Authentication failed')}), 401

        profile_id   = result.get('profile_id')
        profile_name = result.get('profile_name', '')
        print(f"[ADMIN AUTH] {username} profile_id={profile_id} name={profile_name}")

        is_admin = (profile_id in _s.ALLOWED_ADMIN_PROFILE_IDS or
                    profile_name in _s.ALLOWED_ADMIN_PROFILE_NAMES)
        if not is_admin:
            eventlet.tpool.execute(asyncio.run, glpi_service.kill_session(result['session_token']))
            return jsonify({"success": False,
                            "error": f"Profile '{profile_name}' is not authorised."}), 403

        token = result['session_token']
        _s.admin_sessions[token] = {
            "user_id": result.get('user_id'), "user_name": result.get('user_name'),
            "firstname": result.get('user_firstname'),
            "profile_id": profile_id, "profile_name": profile_name
        }
        return jsonify({"success": True, "session_token": token,
                        "user": {"id": result.get('user_id'), "name": result.get('user_name'),
                                 "firstname": result.get('user_firstname'), "profile": profile_name}})
    except Exception as e:
        print(f"[ADMIN AUTH] login error: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/logout', methods=['POST'])
def admin_logout():
    try:
        data  = request.get_json() or {}
        token = data.get('session_token') or request.headers.get('X-Session-Token')
        if token:
            _s.admin_sessions.pop(token, None)
            try:
                from action_server.actions.glpi_service import GlpiService
                from common.config_manager import get_glpi_config
                cfg = get_glpi_config()
                GlpiService(cfg['api_url'], cfg['app_token'], cfg['user_token']).kill_session(token)
            except Exception:
                pass
        return jsonify({"success": True, "message": "Logged out"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route('/admin/verify', methods=['POST'])
def admin_verify():
    try:
        data  = request.get_json() or {}
        token = data.get('session_token') or request.headers.get('X-Session-Token')
        if not token:
            return jsonify({"valid": False, "error": "No session token provided"}), 401

        info = _s.admin_sessions.get(token)
        if info:
            return jsonify({"valid": True, "user": {
                "id": info.get('user_id'), "name": info.get('user_name'),
                "firstname": info.get('firstname'), "profile": info.get('profile_name')
            }})

        # Not in cache — try GLPI
        try:
            from action_server.actions.glpi_service import GlpiService
            from common.config_manager import get_glpi_config
            cfg          = get_glpi_config()
            glpi_service = GlpiService(cfg['api_url'], cfg['app_token'], cfg['user_token'])
            import asyncio
            user_info    = asyncio.run(glpi_service._get_current_user(token))
            if user_info and user_info.get('id'):
                pid   = user_info.get('profile_id')
                pname = user_info.get('profile_name', '')
                if pid in _s.ALLOWED_ADMIN_PROFILE_IDS or pname in _s.ALLOWED_ADMIN_PROFILE_NAMES:
                    _s.admin_sessions[token] = user_info
                    return jsonify({"valid": True, "user": {
                        "id": user_info.get('id'), "name": user_info.get('name'),
                        "firstname": user_info.get('firstname'), "profile": pname
                    }})
        except Exception:
            pass
        return jsonify({"valid": False, "error": "Session expired or invalid"}), 401
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)}), 500


@bp.route('/admin/profile', methods=['GET'])
def get_active_profile():
    from common.config_manager import get_profile
    profile = get_profile()
    return jsonify({"success": True, "profile": profile, "is_prod": profile == "prod"})


# ── Operator auth ──────────────────────────────────────────────────────────────

@bp.route('/operator/login', methods=['POST'])
def operator_login():
    """Authenticate operator via GLPI credentials + group membership check."""
    try:
        data     = request.get_json(silent=True) or {}
        username = data.get('username', '').strip()
        password = data.get('password', '').strip()
        if not username or not password:
            return jsonify({'error': 'username and password required'}), 400

        from common.config_manager import get_handoff_config, get_glpi_config
        hcfg           = get_handoff_config()
        required_group = (hcfg.get('glpi_support_group_name') or 'Support').strip()
        enforce_group  = str(hcfg.get('glpi_group_enforcement', 'true')).lower() in ('true', '1', 'yes')

        from action_server.actions.glpi_service import GlpiService
        from common.ttl_cache import glpi_group_cache
        glpi_cfg     = get_glpi_config()
        glpi_service = GlpiService(glpi_cfg['api_url'], glpi_cfg['app_token'], glpi_cfg['user_token'])

        async def _glpi_check():
            result = await glpi_service.login_with_credentials(username, password)
            if not result.get('success'):
                return False, 'Authentication failed — check your credentials'
            op_session = result['session_token']
            user_id    = result.get('user_id')
            await glpi_service.kill_session(op_session)
            if not user_id:
                return False, 'Could not retrieve user ID'

            if not enforce_group:
                return True, None

            cache_key   = f"groups:{user_id}"
            group_names = glpi_group_cache.get(cache_key)
            if group_names is None:
                admin_session = await glpi_service.init_session()
                if not admin_session:
                    return False, 'Admin session unavailable'
                try:
                    groups      = await glpi_service.get_user_groups(admin_session, user_id)
                    group_names = set()
                    for g in groups:
                        gid = g.get('groups_id')
                        if isinstance(gid, str):
                            group_names.add(gid.strip())
                        for field in ('name', 'completename'):
                            val = g.get(field)
                            if val:
                                group_names.add(str(val).strip())
                    glpi_group_cache.set(cache_key, group_names)
                finally:
                    await glpi_service.kill_session(admin_session)

            if not any(n.lower() == required_group.lower() for n in group_names):
                return False, (f"Access denied. You must be a member of '{required_group}'.")
            return True, None

        try:
            allowed, err_msg = eventlet.tpool.execute(asyncio.run, _glpi_check())
        except Exception as glpi_err:
            print(f"[OPERATOR AUTH] GLPI error: {glpi_err}")
            return jsonify({'error': 'ITSM unreachable. Cannot verify credentials.'}), 503

        if not allowed:
            return jsonify({'error': err_msg}), 403

        # Auto-provision local operator record
        from common.conversation_db import get_operator_by_username, create_operator, update_operator_last_seen
        op = get_operator_by_username(username)
        if not op:
            op_id = create_operator(
                username=username, display_name=username,
                password_hash='glpi-managed', email=None,
                team='Support', app_ids=['IT'], max_concurrent=3
            )
            op = {'id': op_id, 'username': username, 'display_name': username,
                  'team': 'Support', 'app_ids': ['IT'], 'max_concurrent': 3,
                  'status': 'offline'}
        else:
            update_operator_last_seen(op['id'])

        expiry_hours = _s.get_operator_jwt_expiry_hours()
        now          = int(time.time())
        token        = _s.jwt_encode({
            'sub': op['id'], 'username': username, 'type': 'operator',
            'exp': now + expiry_hours * 3600
        }, _s.get_operator_jwt_secret())

        # Mark online
        from common.conversation_db import update_operator
        update_operator(op['id'], status='online')

        print(f"[OPERATOR AUTH] '{username}' logged in")
        return jsonify({
            'token':    token,
            'operator': {
                'id': op['id'], 'username': username,
                'display_name': op.get('display_name', username),
                'team': op.get('team'), 'app_ids': op.get('app_ids', []),
                'max_concurrent': op.get('max_concurrent', 3), 'status': 'online'
            }
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@bp.route('/operator/token/refresh', methods=['POST'])
def operator_token_refresh():
    """Re-issue a JWT for an operator whose token recently expired (grace: 24 h)."""
    try:
        auth = request.headers.get('Authorization', '')
        if not auth.startswith('Bearer '):
            return jsonify({'error': 'Missing token'}), 401
        token  = auth[7:]
        secret = _s.get_operator_jwt_secret()

        parts = token.split('.')
        if len(parts) != 3:
            return jsonify({'error': 'Malformed token'}), 401
        header_b, body_b, sig_b = parts
        expected_sig = base64.urlsafe_b64encode(
            hmac.new(secret.encode(), f"{header_b}.{body_b}".encode(), hashlib.sha256).digest()
        ).rstrip(b'=').decode()
        if not hmac.compare_digest(sig_b, expected_sig):
            return jsonify({'error': 'Invalid token signature'}), 401

        padding = 4 - len(body_b) % 4
        payload = _json.loads(base64.urlsafe_b64decode(body_b + '=' * padding))
        if payload.get('type') != 'operator':
            return jsonify({'error': 'Not an operator token'}), 401

        now = int(time.time())
        exp = payload.get('exp', 0)
        if exp < now and now - exp > 86400:
            return jsonify({'error': 'Token too old — please log in again'}), 401

        expiry_hours = _s.get_operator_jwt_expiry_hours()
        new_token    = _s.jwt_encode({
            'sub': payload['sub'], 'username': payload.get('username', ''),
            'type': 'operator', 'exp': now + expiry_hours * 3600
        }, secret)
        return jsonify({'token': new_token})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/operator/logout', methods=['POST'])
@_s.require_operator_token
def operator_logout(**kwargs):
    try:
        conn = _get_connection()
        try:
            cur = conn.cursor()
            cur.execute("UPDATE operators SET status = 'offline', last_seen = NOW() WHERE id = %s",
                        (kwargs['_operator_id'],))
            conn.commit()
        finally:
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
