"""
common.db._analytics — dashboard queries, conversation history, app management.
"""
from datetime import datetime
from typing import Dict, List, Optional
from psycopg2.extras import RealDictCursor
from common.db._connection import _get_connection, _release_connection


def get_analytics_summary(app_id: str = None) -> Dict:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        af = " WHERE app_id = %s" if (app_id and app_id != "all") else ""
        ap = (app_id,) if (app_id and app_id != "all") else ()

        cursor.execute(f'SELECT COUNT(*) as count FROM conversations{af}', ap)
        total_conversations = cursor.fetchone()['count']

        if app_id and app_id != "all":
            cursor.execute('SELECT COUNT(*) as count FROM messages WHERE app_id = %s', (app_id,))
        else:
            cursor.execute('SELECT COUNT(*) as count FROM messages')
        total_messages = cursor.fetchone()['count']

        for ftype in ('positive', 'negative'):
            if app_id and app_id != "all":
                cursor.execute(f"SELECT COUNT(*) as count FROM feedback WHERE type='{ftype}' AND app_id=%s", (app_id,))
            else:
                cursor.execute(f"SELECT COUNT(*) as count FROM feedback WHERE type='{ftype}'")
            if ftype == 'positive':
                feedback_positive = cursor.fetchone()['count']
            else:
                feedback_negative = cursor.fetchone()['count']

        total_feedback = feedback_positive + feedback_negative
        resolution_rate = round((feedback_positive / total_feedback) * 100, 1) if total_feedback > 0 else 0

        if app_id and app_id != "all":
            cursor.execute(
                "SELECT intent, COUNT(*) as count FROM messages "
                "WHERE intent IS NOT NULL AND intent != '' AND app_id = %s "
                "GROUP BY intent ORDER BY count DESC LIMIT 10", (app_id,)
            )
        else:
            cursor.execute(
                "SELECT intent, COUNT(*) as count FROM messages "
                "WHERE intent IS NOT NULL AND intent != '' "
                "GROUP BY intent ORDER BY count DESC LIMIT 10"
            )
        top_intents = [(row['intent'], row['count']) for row in cursor.fetchall()]

        today = datetime.now().date()
        if app_id and app_id != "all":
            cursor.execute(
                "SELECT COUNT(*) as count FROM conversations WHERE DATE(last_activity)=%s AND app_id=%s",
                (today, app_id)
            )
        else:
            cursor.execute(
                "SELECT COUNT(*) as count FROM conversations WHERE DATE(last_activity)=%s", (today,)
            )
        conversations_today = cursor.fetchone()['count']

        return {
            "total_conversations": total_conversations,
            "total_messages": total_messages,
            "feedback_positive": feedback_positive,
            "feedback_negative": feedback_negative,
            "resolution_rate": resolution_rate,
            "top_intents": top_intents,
            "conversations_today": conversations_today,
            "intent_distribution": dict(top_intents),
            "app_id": app_id or "all"
        }
    finally:
        _release_connection(conn)


def get_recent_conversations(limit: int = 50, app_id: str = None, user_search: str = None,
                              ticket_status: str = None, date_filter: str = None,
                              date_from: str = None, date_to: str = None) -> List[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = '''
            SELECT c.id, c.sender_id, c.app_id, c.user_id, c.user_name, c.ticket_id,
                   c.started_at, c.last_activity, c.resolved,
                   (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id) as message_count,
                   (SELECT type FROM feedback WHERE conversation_id=c.id ORDER BY timestamp DESC LIMIT 1) as feedback,
                   (SELECT COUNT(*) FROM actions WHERE conversation_id=c.id AND action_name='action_create_glpi_ticket') as tickets_created,
                   (SELECT COUNT(*) FROM actions WHERE conversation_id=c.id AND action_name='action_update_glpi_ticket') as tickets_updated
            FROM conversations c WHERE 1=1'''
        params = []
        if app_id and app_id != 'all':
            query += ' AND c.app_id = %s'; params.append(app_id)
        if user_search:
            query += ' AND (c.sender_id ILIKE %s OR c.user_id ILIKE %s OR c.user_name ILIKE %s)'
            t = f'%{user_search}%'; params.extend([t, t, t])
        if ticket_status == 'created':
            query += " AND EXISTS (SELECT 1 FROM actions a WHERE a.conversation_id=c.id AND a.action_name='action_create_glpi_ticket' AND a.success=1)"
        elif ticket_status == 'resolved':
            query += " AND (c.resolved=1 OR EXISTS (SELECT 1 FROM actions a WHERE a.conversation_id=c.id AND a.action_name='action_verify_glpi_resolution'))"
        elif ticket_status == 'updated':
            query += " AND EXISTS (SELECT 1 FROM actions a WHERE a.conversation_id=c.id AND a.action_name IN ('action_update_glpi_ticket','action_view_ticket_comments'))"
        elif ticket_status == 'none':
            query += " AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.conversation_id=c.id AND a.action_name IN ('action_create_glpi_ticket','action_update_glpi_ticket','action_check_glpi_status'))"
        if date_filter == '24h':
            query += " AND c.last_activity >= NOW() - INTERVAL '24 hours'"
        elif date_filter == '7d':
            query += " AND c.last_activity >= NOW() - INTERVAL '7 days'"
        elif date_filter == '30d':
            query += " AND c.last_activity >= NOW() - INTERVAL '30 days'"
        query += ' ORDER BY c.last_activity DESC LIMIT %s'; params.append(limit)
        cursor.execute(query, tuple(params))
        result = []
        for row in cursor.fetchall():
            cursor.execute(
                "SELECT DISTINCT intent FROM messages WHERE conversation_id=%s AND intent IS NOT NULL AND intent!='' LIMIT 5",
                (row['id'],)
            )
            intents = [r['intent'] for r in cursor.fetchall()]
            ticket_activity = 'created' if row['tickets_created'] > 0 else ('updated' if row['tickets_updated'] > 0 else None)
            sid = row['sender_id']
            display = row.get('user_name') or row.get('user_id') or (sid[:12] + "..." if sid and len(sid) > 12 else sid)
            result.append({
                "id": row['id'],
                "sender_id": sid[:12] + "..." if sid and len(sid) > 12 else sid,
                "sender_id_full": sid,
                "display_name": display,
                "user_name": row.get('user_name'),
                "user_id": row.get('user_id'),
                "app_id": row['app_id'] or "General",
                "ticket_id": row.get('ticket_id'),
                "ticket_activity": ticket_activity,
                "started_at": row['started_at'].isoformat() if row['started_at'] else None,
                "last_activity": row['last_activity'].isoformat() if row['last_activity'] else None,
                "message_count": row['message_count'],
                "intents": intents,
                "feedback": row['feedback'],
                "resolved": bool(row['resolved'])
            })
        return result
    finally:
        _release_connection(conn)


# ── App management ────────────────────────────────────────────────────────────

def get_app_list() -> List[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT id, app_id, name, description, is_active FROM chat_apps WHERE is_active=1 ORDER BY name')
        return [dict(r) for r in cursor.fetchall()]
    finally:
        _release_connection(conn)


def get_chat_app(app_id: str) -> Optional[Dict]:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT id, app_id, name, description, is_active FROM chat_apps WHERE app_id=%s', (app_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        _release_connection(conn)


def create_chat_app(app_id: str, name: str, description: str = None) -> int:
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            'INSERT INTO chat_apps (app_id, name, description) VALUES (%s,%s,%s) RETURNING id',
            (app_id, name, description)
        )
        new_id = cursor.fetchone()['id']
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def update_chat_app(app_id: str, name: str = None, description: str = None, is_active: int = None) -> bool:
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        updates, params = [], []
        if name is not None: updates.append("name=%s"); params.append(name)
        if description is not None: updates.append("description=%s"); params.append(description)
        if is_active is not None: updates.append("is_active=%s"); params.append(is_active)
        if not updates: return False
        params.append(app_id)
        cursor.execute(f"UPDATE chat_apps SET {', '.join(updates)} WHERE app_id=%s", params)
        conn.commit()
        return cursor.rowcount > 0
    finally:
        _release_connection(conn)


def delete_chat_app(app_id: str) -> bool:
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('UPDATE chat_apps SET is_active=0 WHERE app_id=%s', (app_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        _release_connection(conn)
