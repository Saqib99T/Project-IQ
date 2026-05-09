"""
Chat and handoff blueprint.
Routes: /webhooks/rest/webhook, /handoff/status/*, /handoff/end
"""
from datetime import datetime as _dt
from flask import Blueprint, request, jsonify
from common.conversation_db import _get_connection, _release_connection
from psycopg2.extras import RealDictCursor
import web.api.shared as _s

bp = Blueprint('chat', __name__)


@bp.route('/handoff/status/<sender_id>', methods=['GET'])
def handoff_status(sender_id):
    """Widget polls this on reconnect to restore handoff state."""
    try:
        conn = _get_connection()
        try:
            cur = conn.cursor(cursor_factory=RealDictCursor)
            cur.execute(
                "SELECT id, handoff_state, assigned_operator_id FROM conversations WHERE sender_id = %s",
                (sender_id,)
            )
            conv = cur.fetchone()
            if not conv:
                return jsonify({'handoff_state': 'bot_active'})
            state = conv.get('handoff_state') or 'bot_active'

            if state == 'queued':
                cur.execute(
                    "SELECT hq.id, hq.queue_position, hq.queued_at FROM handoff_queue hq "
                    "WHERE hq.sender_id = %s AND hq.status = 'waiting' ORDER BY hq.queued_at DESC LIMIT 1",
                    (sender_id,)
                )
                q = cur.fetchone()
                if not q:
                    cur.execute(
                        "UPDATE conversations SET handoff_state = 'bot_active', assigned_operator_id = NULL WHERE id = %s",
                        (conv['id'],)
                    )
                    conn.commit()
                    return jsonify({'handoff_state': 'bot_active'})
                from web.api.impl.operator import get_handoff_runtime_config_for_api
                cfg        = get_handoff_runtime_config_for_api()
                avg_handle = float(cfg.get('queue', {}).get('avg_handle_time_mins', 8))
                pos        = q.get('queue_position') or 1
                return jsonify({'handoff_state': 'queued',
                                'queue_position': pos, 'wait_mins': round(pos * avg_handle)})

            if state == 'assigned':
                op_name = None
                if conv.get('assigned_operator_id'):
                    cur.execute("SELECT display_name FROM operators WHERE id = %s",
                                (conv['assigned_operator_id'],))
                    op = cur.fetchone()
                    if op:
                        op_name = op['display_name']
                return jsonify({'handoff_state': 'assigned', 'operator_name': op_name})

            return jsonify({'handoff_state': state})
        finally:
            _release_connection(conn)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/handoff/end', methods=['POST'])
def handoff_end():
    """Widget / mobile app calls this when user logs out or ends their session."""
    try:
        data      = request.get_json(silent=True) or {}
        sender_id = (data.get('sender_id') or '').strip()
        if not sender_id:
            return jsonify({'error': 'sender_id required'}), 400

        user_name = (data.get('user_name') or '').strip()
        conn = _get_connection()
        try:
            cur = conn.cursor(cursor_factory=RealDictCursor)

            # If user_name provided, close ALL stale sessions for this user first
            # Match senderIds with pattern: user-{appId}-{username}-{suffix}
            if user_name:
                cur.execute(
                    "UPDATE handoff_queue SET status = 'abandoned', abandoned_at = NOW(), "
                    "closing_note = 'User started new session' "
                    "WHERE status IN ('waiting', 'assigned') "
                    "AND id IN ("
                    "  SELECT hq.id FROM handoff_queue hq "
                    "  JOIN conversations c ON c.id = hq.conversation_id "
                    "  WHERE c.sender_id != %s "
                    "  AND c.sender_id LIKE %s"
                    ")",
                    (sender_id, f'user-%-{user_name}-%')
                )
                cur.execute(
                    "UPDATE conversations SET handoff_state = 'closed', assigned_operator_id = NULL "
                    "WHERE sender_id != %s AND handoff_state IN ('queued', 'assigned') "
                    "AND sender_id LIKE %s",
                    (sender_id, f'user-%-{user_name}-%')
                )

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
                conn.commit()
                return jsonify({'success': True, 'detail': 'no active handoff'})

            queue_id     = row['id']
            conv_id      = row['conversation_id']
            op_id        = row['operator_id']
            was_assigned = row['status'] == 'assigned'

            if was_assigned:
                cur.execute(
                    "UPDATE handoff_queue SET status = 'abandoned', abandoned_at = %s, "
                    "closing_note = 'User ended session', "
                    "handle_time_secs = EXTRACT(EPOCH FROM (NOW() - assigned_at))::INT WHERE id = %s",
                    (_dt.now(), queue_id)
                )
                new_state = 'closed'
            else:
                cur.execute(
                    "UPDATE handoff_queue SET status = 'abandoned', abandoned_at = %s, "
                    "closing_note = 'User left queue' WHERE id = %s",
                    (_dt.now(), queue_id)
                )
                new_state = 'bot_active'

            cur.execute(
                "UPDATE conversations SET handoff_state = %s, assigned_operator_id = NULL WHERE id = %s",
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

        if was_assigned and op_id:
            _s.sio.emit('user_left', {
                'conversation_id': conv_id, 'sender_id': sender_id,
                'message': 'The user has ended the conversation.',
            }, room=_s._room_operator(op_id))

        _s.sio.emit('queue_item_removed',
                    {'queue_id': queue_id, 'status': 'abandoned'}, room='queue_overview')
        _s.emit_queue_overview()
        return jsonify({'success': True, 'was_assigned': was_assigned})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/webhooks/rest/webhook', methods=['POST'])
def chat_webhook_proxy():
    """
    Proxy endpoint for chat messages.
    Logs all bot responses and gates traffic during human handoff.
    """
    try:
        import requests
        import json
        from datetime import datetime as _dt
        from common.conversation_db import log_conversation_start, log_message

        data         = request.get_json()
        sender_id    = data.get('sender', 'unknown')
        message_text = data.get('message', '')
        metadata     = data.get('metadata', {})

        # Auto-Assist draft calls — proxy to Rasa, skip DB logging
        if sender_id.startswith('__draft__'):
            try:
                r = requests.post(f"{_s.RASA_URL}/webhooks/rest/webhook", json=data, timeout=10)
                return jsonify(r.json()), r.status_code
            except Exception:
                return jsonify([]), 200

        app_id    = metadata.get('app_id', 'General')
        user_id   = metadata.get('user_id')
        user_name = metadata.get('user_name')
        ticket_id = metadata.get('ticket_id')
        client_meta = {k: metadata.get(k, '') for k in
                       ('browser', 'os', 'device_type', 'page_url', 'device_id') if metadata.get(k)}

        # ── Handoff passive mode gate ──────────────────────────────────────────
        handoff_state = 'bot_active'
        try:
            conn = _get_connection()
            try:
                cur = conn.cursor(cursor_factory=RealDictCursor)
                cur.execute("SELECT id, handoff_state, assigned_operator_id "
                            "FROM conversations WHERE sender_id = %s", (sender_id,))
                row = cur.fetchone()
                if row:
                    handoff_state = row.get('handoff_state') or 'bot_active'
                    if client_meta:
                        cur.execute("UPDATE conversations SET client_metadata = %s "
                                    "WHERE id = %s AND client_metadata IS NULL",
                                    (json.dumps(client_meta), row['id']))
                        conn.commit()
            finally:
                _release_connection(conn)
        except Exception as e:
            print(f"[Handoff gate] DB check failed: {e}")

        is_login = message_text.strip().startswith('/login')

        if handoff_state == 'queued' and not is_login:
            log_conversation_start(sender_id, app_id, user_id=user_id, user_name=user_name)
            log_message(sender_id, 'user', message_text, app_id=app_id,
                        user_id=user_id, ticket_id=ticket_id)
            return jsonify([{"text": "⏳ You are in the queue. An agent will be with you shortly."}]), 200

        if handoff_state == 'assigned' and not is_login:
            log_conversation_start(sender_id, app_id, user_id=user_id, user_name=user_name)
            log_message(sender_id, 'user', message_text, app_id=app_id,
                        user_id=user_id, ticket_id=ticket_id)
            try:
                conn2 = _get_connection()
                try:
                    cur2 = conn2.cursor(cursor_factory=RealDictCursor)
                    cur2.execute("SELECT id, assigned_operator_id FROM conversations WHERE sender_id = %s",
                                 (sender_id,))
                    prow = cur2.fetchone()
                finally:
                    _release_connection(conn2)
                if prow and prow.get('assigned_operator_id'):
                    _s.emit_to_operator(prow['assigned_operator_id'], 'user_message', {
                        'conversation_id': prow['id'], 'sender_id': sender_id,
                        'text': message_text, 'timestamp': _dt.now().isoformat(),
                    })
                    _s.sio.emit('live_message', {
                        'conversation_id': prow['id'], 'sender': 'user',
                        'text': message_text, 'timestamp': _dt.now().isoformat(),
                    }, room=_s._room_admin_watch(prow['id']))
            except Exception as e:
                print(f"[SIO relay] error (non-fatal): {e}")
            return jsonify([]), 200
        # ── End gate ──────────────────────────────────────────────────────────

        log_conversation_start(sender_id, app_id, user_id=user_id, user_name=user_name)
        log_message(sender_id, 'user', message_text, app_id=app_id,
                    user_id=user_id, ticket_id=ticket_id)

        rasa_resp = requests.post(f"{_s.RASA_URL}/webhooks/rest/webhook", json=data, timeout=30)
        bot_responses = rasa_resp.json() if rasa_resp.status_code == 200 else []

        # Strip spurious fallback appended by RulePolicy when real responses exist
        _FALLBACK_PREFIXES = (
            "I'm not sure I understand",
            "I’m not sure I understand",
            "I'm sorry, I didn't verify",
        )
        if len(bot_responses) > 1:
            filtered = [r for r in bot_responses
                        if not any(r.get('text', '').startswith(p) for p in _FALLBACK_PREFIXES)]
            if filtered:
                bot_responses = filtered

        for r in bot_responses:
            if r.get('text'):
                log_message(sender_id, 'bot', r['text'], app_id=app_id,
                            user_id=user_id, ticket_id=ticket_id)

        return jsonify(bot_responses), rasa_resp.status_code
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"error": str(e)}), 500
