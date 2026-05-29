"""
Notification CRUD.

Types used across the system:
  ticket_created   — user created a ticket
  handoff_queued   — user entered the support queue
  handoff_assigned — operator accepted the session
  handoff_ended    — session closed by operator
  ticket_update    — ticket status changed in GLPI
"""
import logging
from typing import List, Optional, Dict, Any

from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)


def create_notification(
    user_id: str,
    type: str,
    title: str,
    body: str = None,
    app_id: str = None,
    payload: dict = None,
) -> Optional[str]:
    """Insert a notification row. Returns the new UUID or None on error."""
    from common.conversation_db import _get_connection, _release_connection
    import json
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            INSERT INTO notifications (user_id, app_id, type, title, body, payload)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, created_at
            """,
            (user_id, app_id, type, title, body,
             json.dumps(payload) if payload else None),
        )
        row = cur.fetchone()
        conn.commit()
        return str(row['id']) if row else None
    except Exception as e:
        logger.error(f"[Notifications] create error: {e}")
        return None
    finally:
        if conn:
            _release_connection(conn)


def get_notifications(user_id: str, limit: int = 30) -> List[Dict[str, Any]]:
    """Return recent notifications for a user (unread first, then newest)."""
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT id, user_id, app_id, type, title, body, payload, read, created_at
            FROM notifications
            WHERE user_id = %s
            ORDER BY read ASC, created_at DESC
            LIMIT %s
            """,
            (user_id, limit),
        )
        rows = cur.fetchall()
        return [
            {
                'id':         str(r['id']),
                'user_id':    r['user_id'],
                'app_id':     r['app_id'],
                'type':       r['type'],
                'title':      r['title'],
                'body':       r['body'],
                'payload':    r['payload'],
                'read':       r['read'],
                'created_at': r['created_at'].isoformat() if r['created_at'] else None,
            }
            for r in rows
        ]
    except Exception as e:
        logger.error(f"[Notifications] get error: {e}")
        return []
    finally:
        if conn:
            _release_connection(conn)


def get_unread_count(user_id: str) -> int:
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id = %s AND read = FALSE",
            (user_id,),
        )
        return cur.fetchone()[0]
    except Exception as e:
        logger.error(f"[Notifications] count error: {e}")
        return 0
    finally:
        if conn:
            _release_connection(conn)


def mark_read(notification_id: str, user_id: str) -> bool:
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            "UPDATE notifications SET read = TRUE WHERE id = %s AND user_id = %s",
            (notification_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    except Exception as e:
        logger.error(f"[Notifications] mark_read error: {e}")
        return False
    finally:
        if conn:
            _release_connection(conn)


def mark_all_read(user_id: str) -> int:
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            "UPDATE notifications SET read = TRUE WHERE user_id = %s AND read = FALSE",
            (user_id,),
        )
        conn.commit()
        return cur.rowcount
    except Exception as e:
        logger.error(f"[Notifications] mark_all_read error: {e}")
        return 0
    finally:
        if conn:
            _release_connection(conn)


# ── Push token helpers ────────────────────────────────────────────────────────

def upsert_push_token(user_id: str, token: str, platform: str = None) -> None:
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            """
            INSERT INTO push_tokens (user_id, token, platform, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (user_id, token) DO UPDATE
              SET platform = EXCLUDED.platform, updated_at = NOW()
            """,
            (user_id, token, platform),
        )
        conn.commit()
    except Exception as e:
        logger.error(f"[Notifications] upsert_push_token error: {e}")
    finally:
        if conn:
            _release_connection(conn)


def get_push_tokens(user_id: str) -> List[str]:
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            "SELECT token FROM push_tokens WHERE user_id = %s",
            (user_id,),
        )
        return [r[0] for r in cur.fetchall()]
    except Exception as e:
        logger.error(f"[Notifications] get_push_tokens error: {e}")
        return []
    finally:
        if conn:
            _release_connection(conn)
