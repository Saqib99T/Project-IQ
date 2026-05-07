"""
Operator management blueprint.
Routes: /operator/heartbeat, /operator/me, /operator/status,
        /operator/queue/*, /operator/conversation/*, /operator/message,
        /operator/ai-draft, /operator/user-history/*
"""
import re as _re
from flask import Blueprint, request, jsonify
from common.conversation_db import _get_connection, _release_connection
from psycopg2.extras import RealDictCursor
import web.api.shared as _s

bp = Blueprint('operator', __name__)


def _hcfg():
    from web.api.impl.operator import get_handoff_runtime_config_for_api
    return get_handoff_runtime_config_for_api()


def _get_handoff_cfg_value(key, default=None):
    try:
        from common.config_manager import get_handoff_config
        return get_handoff_config().get(key, default)
    except Exception:
        return default


# ── Online state ──────────────────────────────────────────────────────────────

@bp.route('/operator/heartbeat', methods=['POST'])
@_s.require_operator_token
def operator_heartbeat(**kwargs):
    try:
        from datetime import datetime as _dt
        from common.conversation_db import (
            update_operator_last_seen, get_operator_current_load, get_operator, update_operator
        )
        op_id = kwargs['_operator_id']
        op    = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404

        current_load = get_operator_current_load(op_id)
        cfg          = _hcfg()

        if op['status'] == 'away':
            new_status = 'away'
        elif cfg['operators']['auto_busy_on_max_load'] and current_load >= op['max_concurrent']:
            new_status = 'busy'
        else:
            new_status = 'available'

        last_seen     = op.get('last_seen')
        status_changed = (new_status != op['status'])
        secs_since    = (
            (_dt.now() - last_seen).total_seconds() if last_seen and not getattr(last_seen, 'tzinfo', None)
            else (_dt.now(last_seen.tzinfo) - last_seen).total_seconds() if last_seen else 999
        )
        watchdog_secs = int(_get_handoff_cfg_value('operator_heartbeat_timeout_secs', 90))
        if status_changed or secs_since >= watchdog_secs / 2:
            update_operator_last_seen(op_id, status=new_status)

        return jsonify({'status': new_status, 'current_load': current_load,
                        'max_concurrent': op['max_concurrent']})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/operator/me', methods=['GET'])
@_s.require_operator_token
def operator_me(**kwargs):
    try:
        from common.conversation_db import get_operator, get_operator_current_load, get_queue
        op_id = kwargs['_operator_id']
        op    = get_operator(op_id)
        if not op:
            return jsonify({'error': 'Operator not found'}), 404
        my_active = [q for q in get_queue(status='assigned') if q.get('operator_id') == op_id]
        return jsonify({'operator': op, 'current_load': get_operator_current_load(op_id),
                        'active_conversations': my_active})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/operator/status', methods=['POST', 'PUT'])
@_s.require_operator_token
def operator_set_status(**kwargs):
    try:
        from common.conversation_db import update_operator, update_operator_last_seen, get_operator_current_load, get_operator
        data       = request.get_json(silent=True) or {}
        new_status = data.get('status', '')
        if new_status not in ('available', 'away'):
            return jsonify({"error": "status must be 'available' or 'away'"}), 400
        op_id = kwargs['_operator_id']
        if new_status == 'available':
            op   = get_operator(op_id)
            load = get_operator_current_load(op_id)
            cfg  = _hcfg()
            if cfg['operators']['auto_busy_on_max_load'] and op and load >= op['max_concurrent']:
                new_status = 'busy'
        update_operator(op_id, status=new_status)
        update_operator_last_seen(op_id)
        return jsonify({'success': True, 'status': new_status})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Queue management ──────────────────────────────────────────────────────────

@bp.route('/operator/queue', methods=['GET'])
@_s.require_operator_token
def operator_get_queue(**kwargs):
    from web.api.impl.operator import operator_get_queue as _fn
    return _fn(**kwargs)


@bp.route('/operator/queue/claim', methods=['POST'])
@_s.require_operator_token
def operator_claim(**kwargs):
    from web.api.impl.operator import operator_claim as _fn
    return _fn(**kwargs)


@bp.route('/operator/queue/resolve', methods=['POST'])
@_s.require_operator_token
def operator_resolve(**kwargs):
    from web.api.impl.operator import operator_resolve as _fn
    return _fn(**kwargs)


@bp.route('/operator/queue/release', methods=['POST'])
@_s.require_operator_token
def operator_release(**kwargs):
    from web.api.impl.operator import operator_release as _fn
    return _fn(**kwargs)


@bp.route('/operator/queue/rate-context', methods=['POST'])
@_s.require_operator_token
def operator_rate_context(**kwargs):
    from web.api.impl.operator import operator_rate_context as _fn
    return _fn(**kwargs)


# ── Conversation + messaging ──────────────────────────────────────────────────

@bp.route('/operator/conversation/<int:conversation_id>', methods=['GET'])
@_s.require_operator_token
def operator_get_conversation(conversation_id, **kwargs):
    from web.api.impl.operator import operator_get_conversation as _fn
    return _fn(conversation_id, **kwargs)


@bp.route('/operator/message', methods=['POST'])
@_s.require_operator_token
def operator_send_message(**kwargs):
    from web.api.impl.operator import operator_send_message as _fn
    return _fn(**kwargs)


@bp.route('/operator/ai-draft', methods=['POST'])
@_s.require_operator_token
def operator_ai_draft(**kwargs):
    from web.api.impl.operator import operator_ai_draft as _fn
    return _fn(**kwargs)


# ── Interaction history ───────────────────────────────────────────────────────

@bp.route('/operator/user-history/<sender_id>', methods=['GET'])
@_s.require_operator_token
def operator_user_history(sender_id, **kwargs):
    from web.api.impl.operator import operator_user_history as _fn
    return _fn(sender_id, **kwargs)
