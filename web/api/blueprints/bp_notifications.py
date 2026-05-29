"""
Notifications blueprint.

Routes:
  GET  /notifications           — list for the authenticated user
  POST /notifications/:id/read  — mark one read
  POST /notifications/read-all  — mark all read
  POST /notifications/push-token — register Expo push token
"""
from flask import Blueprint, request, jsonify
import web.api.shared as _s

bp = Blueprint('notifications', __name__)


def _get_user_id() -> str | None:
    """Extract user_id from IAM Bearer or fallback to query param (guest sender_id)."""
    from common.iam_service import get_iam_user_from_request, IamTokenError
    try:
        user = get_iam_user_from_request(request)
        if user:
            return f"iam-{user['sub']}"
    except IamTokenError:
        pass
    # Fallback: ?sender_id=... for unauthenticated callers
    return request.args.get('sender_id') or (request.get_json(silent=True) or {}).get('sender_id')


@bp.route('/notifications', methods=['GET'])
def list_notifications():
    user_id = _get_user_id()
    if not user_id:
        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    try:
        from common.db._notifications import get_notifications, get_unread_count
        notifications = get_notifications(user_id, limit=50)
        unread        = get_unread_count(user_id)
        return jsonify({'success': True, 'data': notifications, 'unread_count': unread})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/notifications/<notification_id>/read', methods=['POST'])
def mark_one_read(notification_id):
    user_id = _get_user_id()
    if not user_id:
        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    try:
        from common.db._notifications import mark_read, get_unread_count
        mark_read(notification_id, user_id)
        unread = get_unread_count(user_id)
        # Push updated count via Socket.IO so the badge updates instantly
        _s.sio.emit('notification_count', {'unread_count': unread},
                    room=f"user:{user_id}")
        return jsonify({'success': True, 'unread_count': unread})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/notifications/read-all', methods=['POST'])
def mark_all_read_route():
    user_id = _get_user_id()
    if not user_id:
        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    try:
        from common.db._notifications import mark_all_read
        count = mark_all_read(user_id)
        _s.sio.emit('notification_count', {'unread_count': 0},
                    room=f"user:{user_id}")
        return jsonify({'success': True, 'marked': count})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/notifications/push-token', methods=['POST'])
def register_push_token():
    """Mobile app calls this after login to register its Expo push token."""
    user_id = _get_user_id()
    if not user_id:
        return jsonify({'success': False, 'error': 'Authentication required'}), 401
    try:
        data     = request.get_json(silent=True) or {}
        token    = (data.get('token') or '').strip()
        platform = data.get('platform', 'expo')
        if not token:
            return jsonify({'success': False, 'error': 'token required'}), 400
        from common.db._notifications import upsert_push_token
        upsert_push_token(user_id, token, platform)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
