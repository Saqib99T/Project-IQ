"""
common.db._analytics — dashboard queries, conversation history, app management.
"""
from datetime import datetime
from typing import Dict, List, Optional
from psycopg2.extras import RealDictCursor
from common.db._connection import _get_connection, _release_connection

# Action names that mark a conversation as escalated (handed off / ticketed) or
# as having engaged the knowledge base. Used by the deflection metrics.
_ESCALATION_ACTIONS = ('action_request_handoff', 'action_create_ticket_from_form')
_KB_ACTIONS = ('action_search_knowledge_base', 'action_search_kb_before_ticket')


def _deflection_from_row(row: Dict) -> Dict:
    """Pure: turn the deflection aggregate row into rates (testable without a DB)."""
    row = row or {}
    total = row.get('total_conversations') or 0
    escalated = row.get('escalated') or 0
    bot_resolved = row.get('bot_resolved') or 0
    kb_engaged = row.get('kb_engaged') or 0
    kb_deflected = row.get('kb_deflected') or 0
    return {
        'total_conversations': total,
        'escalated': escalated,
        'bot_resolved': bot_resolved,
        'deflection_rate': round(bot_resolved / total * 100, 1) if total else 0.0,
        'kb_engaged': kb_engaged,
        'kb_deflected': kb_deflected,
        'kb_deflection_rate': round(kb_deflected / kb_engaged * 100, 1) if kb_engaged else 0.0,
    }


def get_deflection_metrics(window: str = "30 days", org_id: str = None,
                           app_id: str = None) -> Dict:
    """Bot-resolved vs escalated + KB deflection over `window`.

    A conversation is 'escalated' if it triggered a handoff or ticket-create
    action, 'kb_engaged' if it ran a KB search, and 'kb_deflected' if it used
    the KB but did NOT escalate. `window` is parameterized (::interval) so it's
    injection-safe; callers should still pass a vetted value.
    """
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        where = ["a.timestamp > NOW() - %s::interval"]
        params: List = [window]
        join = ""
        if org_id:
            join = "JOIN conversations c ON c.id = a.conversation_id"
            where.append("c.org_id = %s"); params.append(org_id)
        if app_id and app_id != "all":
            where.append("a.app_id = %s"); params.append(app_id)
        cur.execute(f"""
            WITH conv AS (
                SELECT a.conversation_id,
                       BOOL_OR(a.action_name IN %s) AS used_kb,
                       BOOL_OR(a.action_name IN %s) AS escalated
                FROM actions a {join}
                WHERE {" AND ".join(where)}
                GROUP BY a.conversation_id
            )
            SELECT COUNT(*)                                          AS total_conversations,
                   COUNT(*) FILTER (WHERE escalated)                 AS escalated,
                   COUNT(*) FILTER (WHERE NOT escalated)             AS bot_resolved,
                   COUNT(*) FILTER (WHERE used_kb)                   AS kb_engaged,
                   COUNT(*) FILTER (WHERE used_kb AND NOT escalated) AS kb_deflected
            FROM conv
        """, (_KB_ACTIONS, _ESCALATION_ACTIONS, *params))
        return _deflection_from_row(cur.fetchone())
    finally:
        conn.rollback()
        _release_connection(conn)


def get_analytics_summary(app_id: str = None, org_id: str = None) -> Dict:
    """org_id scopes every figure to one tenant (None = all, for platform admins).
    messages/feedback have no org column, so they are scoped by joining conversations."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        _app = app_id and app_id != "all"

        # conversations — has org_id directly
        cw, cp = [], []
        if org_id: cw.append("org_id = %s"); cp.append(org_id)
        if _app:   cw.append("app_id = %s"); cp.append(app_id)
        c_where = (" WHERE " + " AND ".join(cw)) if cw else ""
        cursor.execute(f'SELECT COUNT(*) as count FROM conversations{c_where}', tuple(cp))
        total_conversations = cursor.fetchone()['count']

        # messages/feedback/intents have no org column → scope via conversations join.
        # mw/mp build the shared WHERE for a table aliased `m` joined to conversations `c`.
        def _scoped(table_alias):
            w, p = [], []
            if org_id: w.append("c.org_id = %s"); p.append(org_id)
            if _app:   w.append(f"{table_alias}.app_id = %s"); p.append(app_id)
            join = "JOIN conversations c ON c.id = {0}.conversation_id".format(table_alias) if org_id else ""
            where = (" WHERE " + " AND ".join(w)) if w else ""
            return join, where, p

        mj, mw, mp = _scoped("m")
        cursor.execute(f'SELECT COUNT(*) as count FROM messages m {mj}{mw}', tuple(mp))
        total_messages = cursor.fetchone()['count']

        feedback_positive = feedback_negative = 0
        for ftype in ('positive', 'negative'):
            fj, fw, fp = _scoped("f")
            fw = (fw + " AND f.type = %s") if fw else " WHERE f.type = %s"
            fp = fp + [ftype]
            cursor.execute(f'SELECT COUNT(*) as count FROM feedback f {fj}{fw}', tuple(fp))
            cnt = cursor.fetchone()['count']
            if ftype == 'positive': feedback_positive = cnt
            else: feedback_negative = cnt

        total_feedback = feedback_positive + feedback_negative
        resolution_rate = round((feedback_positive / total_feedback) * 100, 1) if total_feedback > 0 else 0

        ij, iw, ip = _scoped("m")
        iw = (iw + " AND m.intent IS NOT NULL AND m.intent != ''") if iw else " WHERE m.intent IS NOT NULL AND m.intent != ''"
        cursor.execute(
            f"SELECT m.intent, COUNT(*) as count FROM messages m {ij}{iw} "
            "GROUP BY m.intent ORDER BY count DESC LIMIT 10", tuple(ip)
        )
        top_intents = [(row['intent'], row['count']) for row in cursor.fetchall()]

        today = datetime.now().date()
        tw, tp = ["DATE(last_activity) = %s"], [today]
        if org_id: tw.append("org_id = %s"); tp.append(org_id)
        if _app:   tw.append("app_id = %s"); tp.append(app_id)
        cursor.execute(f"SELECT COUNT(*) as count FROM conversations WHERE {' AND '.join(tw)}", tuple(tp))
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
                              date_from: str = None, date_to: str = None,
                              org_id: str = None) -> List[Dict]:
    """org_id scopes results to one tenant (None = all, for platform admins)."""
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
        if org_id:
            query += ' AND c.org_id = %s'; params.append(org_id)
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
