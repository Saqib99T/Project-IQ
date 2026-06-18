"""
Sessions blueprint.
Routes: /admin/sessions/*
Active sessions and chat history for admin.
"""
from flask import Blueprint, request, jsonify
from common.conversation_db import _get_connection, _release_connection
from psycopg2.extras import RealDictCursor
from datetime import datetime
import web.api.shared as _s

bp = Blueprint('sessions', __name__)


def _fmt(dt):
    if not dt:
        return None
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


# ── Active Sessions ───────────────────────────────────────────────────────────

@bp.route('/admin/sessions/active', methods=['GET'])
@_s.require_iam_token
def active_sessions():
    try:
        app_id     = request.args.get('app_id')
        sess_type  = request.args.get('type')       # 'chatbot' | 'handoff'
        op_id      = request.args.get('operator_id')
        scope_org  = _s.caller_org_scope()           # tenant isolation
        conn = _get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                where = [
                    "c.handoff_state IS NOT NULL",
                    # Bot sessions: only if active in last 2 hours
                    # Handoff sessions (queued/assigned): always show
                    "(c.handoff_state IN ('queued','assigned') OR "
                    "(c.handoff_state = 'bot_active' AND c.last_activity > NOW() - INTERVAL '2 hours'))"
                ]
                params = []
                if scope_org:
                    where.append("c.org_id = %s"); params.append(scope_org)
                if app_id:
                    where.append("c.app_id = %s"); params.append(app_id)
                if op_id:
                    where.append("c.assigned_operator_id = %s"); params.append(int(op_id))
                if sess_type == 'chatbot':
                    where.append("c.handoff_state = 'bot_active'")
                elif sess_type == 'handoff':
                    where.append("c.handoff_state IN ('queued','assigned')")

                cur.execute(f"""
                    SELECT DISTINCT ON (COALESCE(NULLIF(c.user_name,''), c.sender_id))
                           c.id, c.sender_id, c.app_id, c.handoff_state,
                           c.assigned_operator_id, c.started_at, c.last_activity,
                           c.user_name, c.user_id, c.frustration_score,
                           c.handoff_count,
                           o.display_name AS operator_name,
                           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
                           hq.id AS queue_id, hq.status AS queue_status,
                           hq.queued_at, hq.assigned_at, hq.priority
                    FROM conversations c
                    LEFT JOIN operators o ON o.id = c.assigned_operator_id
                    LEFT JOIN handoff_queue hq ON hq.conversation_id = c.id
                        AND hq.status IN ('waiting','assigned')
                    WHERE {' AND '.join(where)}
                    ORDER BY COALESCE(NULLIF(c.user_name,''), c.sender_id), c.last_activity DESC NULLS LAST
                    LIMIT 200
                """, params)
                rows = [dict(r) for r in cur.fetchall()]
                for r in rows:
                    for k in ('started_at','last_activity','queued_at','assigned_at'):
                        r[k] = _fmt(r[k])
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True, 'sessions': rows, 'count': len(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/admin/sessions/active/<int:conv_id>/messages', methods=['GET'])
@_s.require_iam_token
def active_session_messages(conv_id):
    try:
        scope_org = _s.caller_org_scope()
        conn = _get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Tenant isolation: only return messages if the conversation belongs
                # to the caller's org (scope_org None = platform admin → any).
                cur.execute("""
                    SELECT sender, text, intent, timestamp
                    FROM messages WHERE conversation_id = %s
                      AND (%s IS NULL OR conversation_id IN (
                            SELECT id FROM conversations WHERE org_id = %s))
                    ORDER BY timestamp ASC
                """, (conv_id, scope_org, scope_org))
                msgs = [dict(r) for r in cur.fetchall()]
                for m in msgs:
                    m['timestamp'] = _fmt(m['timestamp'])
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True, 'messages': msgs})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/admin/sessions/transfer', methods=['POST'])
def admin_transfer_session():
    """Admin force-assigns a chatbot session to an operator."""
    try:
        data     = request.get_json(silent=True) or {}
        conv_id  = data.get('conversation_id')
        op_id    = data.get('operator_id')
        if not conv_id or not op_id:
            return jsonify({'error': 'conversation_id and operator_id required'}), 400

        conn = _get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get conversation
                cur.execute("SELECT sender_id, app_id, handoff_state FROM conversations WHERE id = %s", (conv_id,))
                conv = cur.fetchone()
                if not conv:
                    return jsonify({'error': 'Conversation not found'}), 404

                cur.execute("SELECT display_name FROM operators WHERE id = %s", (op_id,))
                op = cur.fetchone()
                if not op:
                    return jsonify({'error': 'Operator not found'}), 404

                # Close any existing queue item
                cur.execute("""
                    UPDATE handoff_queue SET status='abandoned', abandoned_at=NOW(),
                    closing_note='Reassigned by admin'
                    WHERE conversation_id=%s AND status IN ('waiting','assigned')
                """, (conv_id,))

                # Create new queue item assigned directly to operator
                cur.execute("""
                    INSERT INTO handoff_queue
                    (conversation_id, sender_id, app_id, status, operator_id, assigned_at, queued_at, priority)
                    VALUES (%s, %s, %s, 'assigned', %s, NOW(), NOW(), 5)
                    RETURNING id
                """, (conv_id, conv['sender_id'], conv['app_id'], op_id))
                qid = cur.fetchone()['id']

                cur.execute("""
                    UPDATE conversations SET handoff_state='assigned', assigned_operator_id=%s
                    WHERE id=%s
                """, (op_id, conv_id))
                cur.execute("""
                    INSERT INTO handoff_state_log
                    (conversation_id, from_state, to_state, triggered_by, triggered_by_id, note)
                    VALUES (%s, %s, 'assigned', 'admin', NULL, 'Admin transferred to operator')
                """, (conv_id, conv['handoff_state']))
                conn.commit()

            # Notify operator via socket
            try:
                from web.api.shared import emit_to_operator, emit_to_user
                emit_to_operator(op_id, 'new_queue_item', {'queue_id': qid})
                emit_to_user(conv['sender_id'], 'handoff_assigned', {
                    'operator_name': op['display_name'],
                    'message': f"✅ You've been connected to **{op['display_name']}**.",
                })
            except Exception:
                pass
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/admin/sessions/end', methods=['POST'])
def admin_end_session():
    """Admin force-ends an active session."""
    try:
        data    = request.get_json(silent=True) or {}
        conv_id = data.get('conversation_id')
        if not conv_id:
            return jsonify({'error': 'conversation_id required'}), 400

        conn = _get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT sender_id FROM conversations WHERE id=%s", (conv_id,))
                conv = cur.fetchone()
                cur.execute("""
                    UPDATE handoff_queue SET status='abandoned', abandoned_at=NOW(),
                    closing_note='Ended by admin'
                    WHERE conversation_id=%s AND status IN ('waiting','assigned')
                """, (conv_id,))
                cur.execute("""
                    UPDATE conversations SET handoff_state='closed', assigned_operator_id=NULL
                    WHERE id=%s
                """, (conv_id,))
                conn.commit()
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# ── Chat History ──────────────────────────────────────────────────────────────

@bp.route('/admin/sessions/history', methods=['GET'])
@_s.require_iam_token
def session_history():
    try:
        scope_org = _s.caller_org_scope()            # tenant isolation
        app_id    = request.args.get('app_id')
        op_id     = request.args.get('operator_id')
        status    = request.args.get('status')       # 'resolved'|'abandoned'|'chatbot'
        date_from = request.args.get('date_from')
        date_to   = request.args.get('date_to')
        search    = request.args.get('search', '').strip()
        page      = max(1, int(request.args.get('page', 1)))
        per_page  = min(100, int(request.args.get('per_page', 50)))
        offset    = (page - 1) * per_page

        conn = _get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                where = ["1=1"]
                params = []
                if scope_org:
                    where.append("c.org_id = %s"); params.append(scope_org)
                if app_id:
                    where.append("c.app_id = %s"); params.append(app_id)
                if op_id:
                    where.append("hq.operator_id = %s"); params.append(int(op_id))
                if date_from:
                    where.append("c.started_at >= %s"); params.append(date_from)
                if date_to:
                    where.append("c.started_at <= %s"); params.append(date_to)
                if status == 'resolved':
                    where.append("hq.status = 'resolved'")
                elif status == 'abandoned':
                    where.append("hq.status = 'abandoned'")
                elif status == 'chatbot':
                    where.append("hq.id IS NULL")
                if search:
                    where.append("(c.user_name ILIKE %s OR c.sender_id ILIKE %s)")
                    params += [f'%{search}%', f'%{search}%']

                count_params = params.copy()
                cur.execute(f"""
                    SELECT COUNT(DISTINCT c.id)
                    FROM conversations c
                    LEFT JOIN handoff_queue hq ON hq.conversation_id = c.id
                    LEFT JOIN operators o ON o.id = hq.operator_id
                    WHERE {' AND '.join(where)}
                """, count_params)
                total = cur.fetchone()['count']

                params += [per_page, offset]
                cur.execute(f"""
                    SELECT c.id, c.sender_id, c.app_id, c.started_at, c.ended_at,
                           c.last_activity, c.user_name, c.user_id, c.handoff_state,
                           c.handoff_count, c.frustration_score,
                           hq.id AS queue_id, hq.status AS handoff_status,
                           hq.operator_id, hq.queued_at, hq.assigned_at,
                           hq.resolved_at, hq.abandoned_at,
                           hq.handle_time_secs, hq.wait_time_secs,
                           hq.closing_note,
                           o.display_name AS operator_name,
                           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
                    FROM conversations c
                    LEFT JOIN handoff_queue hq ON hq.conversation_id = c.id
                    LEFT JOIN operators o ON o.id = hq.operator_id
                    WHERE {' AND '.join(where)}
                    ORDER BY COALESCE(c.ended_at, c.last_activity) DESC NULLS LAST
                    LIMIT %s OFFSET %s
                """, params)
                rows = [dict(r) for r in cur.fetchall()]
                for r in rows:
                    for k in ('started_at','ended_at','last_activity','queued_at',
                              'assigned_at','resolved_at','abandoned_at'):
                        r[k] = _fmt(r[k])
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({
            'success': True, 'sessions': rows,
            'total': total, 'page': page, 'per_page': per_page
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/admin/sessions/history/<int:conv_id>/messages', methods=['GET'])
@_s.require_iam_token
def history_messages(conv_id):
    try:
        scope_org = _s.caller_org_scope()
        conn = _get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Tenant isolation: only the conversation's own org may read it.
                cur.execute("""
                    SELECT sender, text, intent, timestamp
                    FROM messages WHERE conversation_id = %s
                      AND (%s IS NULL OR conversation_id IN (
                            SELECT id FROM conversations WHERE org_id = %s))
                    ORDER BY timestamp ASC
                """, (conv_id, scope_org, scope_org))
                msgs = [dict(r) for r in cur.fetchall()]
                for m in msgs:
                    m['timestamp'] = _fmt(m['timestamp'])
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True, 'messages': msgs})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@bp.route('/admin/sessions/history/export', methods=['GET'])
@_s.require_iam_token
def export_history():
    """Export history as CSV."""
    import csv, io
    try:
        scope_org = _s.caller_org_scope()            # tenant isolation
        conn = _get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT c.id, c.sender_id, c.app_id, c.user_name,
                           c.started_at, c.ended_at, c.handoff_state,
                           hq.status AS handoff_status, o.display_name AS operator,
                           hq.handle_time_secs, hq.wait_time_secs,
                           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id) AS messages
                    FROM conversations c
                    LEFT JOIN handoff_queue hq ON hq.conversation_id=c.id
                    LEFT JOIN operators o ON o.id=hq.operator_id
                    WHERE (%s IS NULL OR c.org_id = %s)
                    ORDER BY c.started_at DESC LIMIT 5000
                """, (scope_org, scope_org))
                rows = cur.fetchall()
        finally:
            conn.rollback()
            _release_connection(conn)

        output = io.StringIO()
        writer = csv.writer(output)
        if rows:
            writer.writerow(rows[0].keys())
            for r in rows:
                writer.writerow([_fmt(v) if isinstance(v, datetime) else v for v in r.values()])

        from flask import Response
        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={'Content-Disposition': 'attachment; filename=chat_history.csv'}
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/admin/sessions/operators', methods=['GET'])
def sessions_operators():
    """List operators for filter dropdowns."""
    try:
        conn = _get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT id, display_name, status FROM operators WHERE is_active=TRUE AND username != 'admin' ORDER BY display_name")
                ops = [dict(r) for r in cur.fetchall()]
        finally:
            conn.rollback()
            _release_connection(conn)
        return jsonify({'success': True, 'operators': ops})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
