"""
common.db._messages — conversation logging and message retrieval.
"""
import logging
from datetime import datetime
from typing import Dict, List, Optional
from psycopg2.extras import RealDictCursor
from common.db._connection import _get_connection, _release_connection


logger = logging.getLogger(__name__)
def log_conversation_start(sender_id: str, app_id: str = "General",
                            user_id: str = None, user_name: str = None,
                            org_id: str = None, product_id: str = None) -> int:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            'SELECT id, ended_at, org_id, product_id FROM conversations WHERE sender_id = %s ORDER BY id DESC LIMIT 1',
            (sender_id,)
        )
        row = cursor.fetchone()
        if row and not row.get('ended_at'):
            updates = ['last_activity = %s']
            params = [datetime.now()]
            if user_id:
                updates.append('user_id = %s'); params.append(user_id)
            if user_name:
                updates.append('user_name = %s'); params.append(user_name)
            # Backfill org_id / product_id on an existing untagged conversation.
            if org_id and not row.get('org_id'):
                updates.append('org_id = %s'); params.append(org_id)
            if product_id and not row.get('product_id'):
                updates.append('product_id = %s'); params.append(product_id)
            params.append(sender_id)
            cursor.execute(f'UPDATE conversations SET {", ".join(updates)} WHERE sender_id = %s', params)
            conn.commit()
            return row['id']
        cursor.execute(
            'INSERT INTO conversations (sender_id, app_id, user_id, user_name, org_id, product_id, started_at, last_activity) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id',
            (sender_id, app_id, user_id, user_name, org_id, product_id, datetime.now(), datetime.now())
        )
        new_id = cursor.fetchone()['id']
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def log_message(sender_id: str, message_type: str, text: str, intent: str = None,
                app_id: str = "General", user_id: str = None, ticket_id: str = None,
                org_id: str = None, product_id: str = None):
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        conv_id = log_conversation_start(sender_id, app_id, user_id=user_id, org_id=org_id, product_id=product_id)
        cursor.execute(
            'INSERT INTO messages (conversation_id, sender, text, intent, app_id, user_id, ticket_id, timestamp) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
            (conv_id, message_type, text[:500] if text else "", intent, app_id, user_id, ticket_id, datetime.now())
        )
        if ticket_id:
            cursor.execute('UPDATE conversations SET last_activity=%s, ticket_id=%s WHERE id=%s',
                           (datetime.now(), ticket_id, conv_id))
        else:
            cursor.execute('UPDATE conversations SET last_activity=%s WHERE id=%s', (datetime.now(), conv_id))
        conn.commit()
    finally:
        _release_connection(conn)


def log_intent(sender_id: str, intent: str, confidence: float = None):
    pass  # Intent is logged with messages


def log_feedback(sender_id: str, feedback_type: str, app_id: str = "General",
                 user_id: str = None, ticket_id: str = None, rating: int = None,
                 comments: str = None):
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        if feedback_type in ('up', 'positive'):
            feedback_type = 'positive'
        elif feedback_type in ('down', 'negative'):
            feedback_type = 'negative'
        conv_id = log_conversation_start(sender_id, app_id, user_id=user_id)
        cursor.execute(
            'INSERT INTO feedback (conversation_id, type, app_id, user_id, ticket_id, rating, comments, timestamp) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
            (conv_id, feedback_type, app_id, user_id, ticket_id, rating, comments, datetime.now())
        )
        if feedback_type == 'positive':
            cursor.execute('UPDATE conversations SET resolved = TRUE WHERE id = %s', (conv_id,))
        conn.commit()
    except Exception as e:
        logger.error("Error saving feedback: %s", e)
        conn.rollback()
    finally:
        _release_connection(conn)


def log_action(sender_id: str, action_name: str, success: bool = True,
               app_id: str = "General", user_id: str = None, ticket_id: str = None):
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        conv_id = log_conversation_start(sender_id, app_id, user_id=user_id)
        cursor.execute(
            'INSERT INTO actions (conversation_id, action_name, success, app_id, user_id, ticket_id, timestamp) '
            'VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (conv_id, action_name, 1 if success else 0, app_id, user_id, ticket_id, datetime.now())
        )
        conn.commit()
    except Exception as e:
        logger.error("Error logging action: %s", e)
        conn.rollback()
    finally:
        _release_connection(conn)


def get_conversation_transcript(sender_id: str) -> List[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT id FROM conversations WHERE sender_id = %s', (sender_id,))
        row = cursor.fetchone()
        if not row:
            return []
        cursor.execute(
            'SELECT sender, text, intent, timestamp FROM messages '
            'WHERE conversation_id = %s ORDER BY timestamp ASC', (row['id'],)
        )
        return [dict(r) for r in cursor.fetchall()]
    finally:
        _release_connection(conn)


def end_conversation(conversation_id: int):
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('UPDATE conversations SET ended_at = %s WHERE id = %s',
                       (datetime.now(), conversation_id))
        conn.commit()
    except Exception as e:
        logger.error("Error ending conversation %s: %s", conversation_id, e)
        conn.rollback()
    finally:
        _release_connection(conn)
