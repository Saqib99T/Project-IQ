"""
Internal endpoints blueprint — called by Rasa action server, not public.
Routes: /internal/operators/reset-status, /internal/operators/available,
        /internal/queue/enqueue, /internal/alert
"""
from flask import Blueprint, request, jsonify
from web.api.impl import operator as _op

bp = Blueprint('internal', __name__)


@bp.route('/internal/alert', methods=['POST'])
def internal_alert():
    """Receive an error alert from another process (e.g. the action server) and
    fan it out to admins via notify_admins. The caller's AdminAlertHandler has
    already deduped/capped, so this just forwards. Best-effort, never raises."""
    from web.api.impl.notify import notify_admins
    data    = request.get_json(silent=True) or {}
    title   = (data.get('title') or 'Action server error')[:120]
    body    = data.get('body') or ''
    payload = data.get('payload') if isinstance(data.get('payload'), dict) else {}
    try:
        notify_admins(type='system_error', title=title, body=body, payload=payload)
    except Exception:
        pass
    return jsonify({'ok': True})


@bp.route('/internal/operators/reset-status', methods=['GET'])
def internal_reset_operator_status():
    return _op.internal_reset_operator_status()


@bp.route('/internal/operators/available', methods=['GET'])
def internal_operators_available():
    return _op.internal_operators_available()


@bp.route('/internal/queue/enqueue', methods=['POST'])
def internal_queue_enqueue():
    return _op.internal_queue_enqueue()
