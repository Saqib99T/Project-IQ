"""
User-facing API blueprint.
Routes: /api/user/conversations, /api/user/conversation/*/messages, /api/user/session/feedback
"""
from flask import Blueprint, request, jsonify
from common.conversation_db import _get_connection, _release_connection
from psycopg2.extras import RealDictCursor

bp = Blueprint('user_api', __name__)


@bp.route('/api/user/conversations', methods=['GET'])
def user_get_conversations():
    conn = None
    try:
        user_name     = request.args.get('user_name', '').strip()
        app_id_filter = request.args.get('app_id', '').strip()
        if not user_name:
            return jsonify({"success": False, "error": "user_name is required"}), 400

        conn   = _get_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query  = '''
            SELECT c.sender_id, c.started_at, c.last_activity, c.user_name, c.user_id, c.app_id,
                   (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count,
                   (SELECT m.text FROM messages m
                    WHERE m.conversation_id = c.id AND m.sender = 'user'
                    ORDER BY m.timestamp ASC LIMIT 1) AS preview,
                   (SELECT f.rating FROM feedback f WHERE f.conversation_id = c.id
                    ORDER BY f.timestamp DESC LIMIT 1) AS rating
            FROM conversations c
            WHERE (c.user_name = %s OR c.user_id = %s)
        '''
        params = [user_name, user_name]
        if app_id_filter:
            query += ' AND c.app_id = %s'
            params.append(app_id_filter)
        query += ' ORDER BY c.started_at DESC LIMIT 50'
        cursor.execute(query, tuple(params))
        conversations = []
        for row in cursor.fetchall():
            if not row['preview']:
                continue
            conversations.append({
                'sender_id':    row['sender_id'],
                'started_at':   row['started_at'].isoformat()   if row['started_at']   else None,
                'last_activity':row['last_activity'].isoformat() if row['last_activity'] else None,
                'preview':      (row['preview'] or '')[:100],
                'rating':       row.get('rating'),
            })
        return jsonify({'success': True, 'data': conversations})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
    finally:
        if conn: _release_connection(conn)


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
        if conn: _release_connection(conn)


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
                print(f"[feedback] queue rating update failed (non-fatal): {e}")

        return jsonify({'success': True, 'message': 'Feedback saved'})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500
