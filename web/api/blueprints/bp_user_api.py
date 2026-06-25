"""
User-facing API blueprint.
Routes: /api/user/conversations, /api/user/conversation/*/messages, /api/user/session/feedback
"""
import logging
from flask import Blueprint, request, jsonify
from common.conversation_db import _get_connection, _release_connection
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)

bp = Blueprint('user_api', __name__)


@bp.route('/api/user/conversations', methods=['GET'])
def user_get_conversations():
    conn = None
    try:
        user_name     = request.args.get('user_name', '').strip()
        # IAM sub — the STABLE per-user key stored on every conversation row
        # (user_id). Preferred over user_name, which is a display name/email that
        # may not match what was stored (→ "No previous conversations"). The
        # widget now sends both; we match on either.
        user_id       = request.args.get('user_id', '').strip()
        app_id_filter = request.args.get('app_id', '').strip()
        search_term   = request.args.get('search', '').strip()
        if not user_name and not user_id:
            return jsonify({"success": False, "error": "user_name or user_id is required"}), 400

        conn   = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        # Match on the IAM sub and/or the display name — whichever the caller
        # supplied. The sub is the reliable one; user_name is a best-effort
        # fallback for legacy/guest rows.
        match_conds, match_params = [], []
        if user_id:
            match_conds.append('c.user_id = %s'); match_params.append(user_id)
        if user_name:
            match_conds.append('c.user_name = %s'); match_params.append(user_name)
        query  = '''
            SELECT c.sender_id, c.started_at, c.last_activity, c.user_name, c.user_id, c.app_id,
                   (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count,
                   (SELECT m.text FROM messages m
                    WHERE m.conversation_id = c.id AND m.sender = 'user'
                      AND m.text NOT LIKE '/%%'
                    ORDER BY m.timestamp ASC LIMIT 1) AS preview,
                   (SELECT m.text FROM messages m
                    WHERE m.conversation_id = c.id AND m.sender = 'user'
                    ORDER BY m.timestamp ASC LIMIT 1) AS first_user,
                   (SELECT m.text FROM messages m
                    WHERE m.conversation_id = c.id AND m.sender = 'bot'
                    ORDER BY m.timestamp ASC LIMIT 1) AS first_bot,
                   (SELECT f.rating FROM feedback f WHERE f.conversation_id = c.id
                    ORDER BY f.timestamp DESC LIMIT 1) AS rating
            FROM conversations c
            WHERE (''' + ' OR '.join(match_conds) + ')'
        params = list(match_params)
        if app_id_filter:
            query += ' AND c.app_id = %s'
            params.append(app_id_filter)
        if search_term:
            query += (' AND EXISTS (SELECT 1 FROM messages ms WHERE ms.conversation_id = c.id'
                      ' AND ms.text ILIKE %s)')
            params.append(f'%{search_term}%')
        query += ' ORDER BY c.started_at DESC LIMIT 100'
        cursor.execute(query, tuple(params))

        def _humanize(t):
            """Turn a button/intent payload into a readable preview:
            '/request_human_agent{...}' → 'request human agent'."""
            t = (t or '').strip()
            if t.startswith('/'):
                t = t[1:].split('{', 1)[0].replace('_', ' ').strip()
            return t

        conversations = []
        for row in cursor.fetchall():
            # Skip only genuinely empty conversations; a session whose user turns
            # were all button clicks (slash payloads) still gets a humanized
            # preview so it shows up in history (every session = one record).
            if not row['msg_count']:
                continue
            preview = (row['preview']
                       or _humanize(row['first_user'])
                       or (row['first_bot'] or '').strip()
                       or '(no message)')
            conversations.append({
                'sender_id':    row['sender_id'],
                'started_at':   row['started_at'].isoformat()   if row['started_at']   else None,
                'last_activity':row['last_activity'].isoformat() if row['last_activity'] else None,
                'preview':      preview[:80],
                'app_id':       row.get('app_id') or 'General',
                'rating':       row.get('rating'),
            })
        return jsonify({'success': True, 'data': conversations})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)


@bp.route('/api/user/conversation/<sender_id>/messages', methods=['GET'])
def user_get_conversation_messages(sender_id):
    conn = None
    try:
        conn   = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT id FROM conversations WHERE sender_id = %s', (sender_id,))
        row = cursor.fetchone()
        if not row:
            return jsonify({'success': True, 'data': []})
        cursor.execute(
            'SELECT sender, text, timestamp FROM messages WHERE conversation_id = %s ORDER BY timestamp ASC',
            (row['id'],)
        )
        messages = [
            {'id': f'hist-{i}', 'sender': m['sender'], 'text': m['text'] or '',
             'timestamp': m['timestamp'].isoformat() if m['timestamp'] else None}
            for i, m in enumerate(cursor.fetchall())
        ]
        return jsonify({'success': True, 'data': messages})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn:
            conn.rollback()
            _release_connection(conn)


@bp.route('/api/user/session/feedback', methods=['POST'])
def save_session_feedback():
    try:
        from common.conversation_db import log_feedback
        data      = request.get_json() or {}
        sender_id = data.get('sender_id', '').strip()
        rating    = data.get('rating')
        comments  = data.get('comments', '').strip()
        app_id    = data.get('app_id', 'General')
        queue_id  = data.get('queue_id')

        if not sender_id:
            return jsonify({'success': False, 'error': 'sender_id is required'}), 400
        if rating and (not isinstance(rating, int) or not (1 <= rating <= 5)):
            return jsonify({'success': False, 'error': 'rating must be 1–5'}), 400

        feedback_type = 'positive' if rating and rating >= 4 else ('negative' if rating else 'neutral')
        log_feedback(sender_id=sender_id, feedback_type=feedback_type,
                     app_id=app_id, user_id=data.get('user_id'), rating=rating, comments=comments)

        if queue_id and rating:
            try:
                conn = _get_connection()
                try:
                    cur = conn.cursor()
                    cur.execute("UPDATE handoff_queue SET agent_rating = %s WHERE id = %s",
                                (int(rating), int(queue_id)))
                    conn.commit()
                finally:
                    _release_connection(conn)
            except Exception as e:
                logger.warning("[feedback] queue rating update failed (non-fatal): %s", e)

        return jsonify({'success': True, 'message': 'Feedback saved'})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
