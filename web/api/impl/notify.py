"""
Notification dispatch helper.

notify_user()     — send to a chat end-user (identified by sender_id / iam-sub)
notify_operator() — send to one operator by their DB id
notify_admins()   — broadcast to all admin/operator accounts
"""
import logging
import threading

logger = logging.getLogger(__name__)


def notify_user(
    user_id: str,
    type: str,
    title: str,
    body: str = None,
    app_id: str = None,
    payload: dict = None,
) -> None:
    """
    Fire-and-forget: creates a notification and sends push in a background thread
    so the calling Socket.IO event handler never blocks.
    """
    threading.Thread(
        target=_dispatch,
        args=(user_id, type, title, body, app_id, payload),
        daemon=True,
    ).start()


def _dispatch(user_id, type, title, body, app_id, payload):
    try:
        from common.db._notifications import (
            create_notification, get_unread_count, get_push_tokens,
        )
        import web.api.shared as _s

        # 1. Persist the notification
        notif_id = create_notification(
            user_id=user_id, type=type, title=title,
            body=body, app_id=app_id, payload=payload,
        )
        if not notif_id:
            return

        unread = get_unread_count(user_id)

        # 2. Live badge update via Socket.IO
        try:
            _s.sio.emit(
                'new_notification',
                {
                    'id':           notif_id,
                    'type':         type,
                    'title':        title,
                    'body':         body,
                    'payload':      payload,
                    'unread_count': unread,
                },
                room=f"user:{user_id}",
            )
        except Exception as e:
            logger.warning(f"[Notify] SIO emit failed: {e}")

        # 3. Expo push notification (best-effort)
        tokens = get_push_tokens(user_id)
        if tokens:
            _send_expo_push(tokens, title, body, payload)

    except Exception as e:
        logger.error(f"[Notify] dispatch error: {e}")


def _send_expo_push(tokens: list, title: str, body: str, data: dict = None):
    """Send via Expo Push API (https://exp.host/--/api/v2/push/send)."""
    try:
        import requests
        messages = [
            {
                'to':    t,
                'title': title,
                'body':  body or '',
                'data':  data or {},
                'sound': 'default',
            }
            for t in tokens
            if t.startswith('ExponentPushToken') or t.startswith('ExpoPushToken')
        ]
        if not messages:
            return
        resp = requests.post(
            'https://exp.host/--/api/v2/push/send',
            json=messages,
            headers={'Accept': 'application/json', 'Content-Type': 'application/json'},
            timeout=8,
        )
        if resp.status_code != 200:
            logger.warning(f"[Notify] Expo push returned {resp.status_code}")
    except Exception as e:
        logger.warning(f"[Notify] Expo push error: {e}")


# ── Operator / admin helpers ──────────────────────────────────────────────────

def notify_operator(
    operator_id: int,
    type: str,
    title: str,
    body: str = None,
    payload: dict = None,
) -> None:
    """
    Notify a specific operator (by their DB integer id).
    Delivers via:
      - Socket.IO to room operator:{operator_id}
      - DB notification row (keyed iam-{iam_sub} if available)
      - Expo push if they have a token
    """
    threading.Thread(
        target=_dispatch_operator,
        args=(operator_id, type, title, body, payload),
        daemon=True,
    ).start()


def notify_admins(
    type: str,
    title: str,
    body: str = None,
    payload: dict = None,
) -> None:
    """Broadcast a notification to all active operators and admins."""
    threading.Thread(
        target=_dispatch_admins,
        args=(type, title, body, payload),
        daemon=True,
    ).start()


def _dispatch_operator(operator_id, type, title, body, payload):
    try:
        import web.api.shared as _s
        from common.db._notifications import create_notification, get_push_tokens

        # Look up iam_sub so we can persist to DB and send push
        user_id = None
        try:
            from common.conversation_db import _get_connection, _release_connection
            conn = _get_connection()
            try:
                cur = conn.cursor()
                cur.execute("SELECT iam_sub FROM operators WHERE id = %s", (operator_id,))
                row = cur.fetchone()
                if row and row[0]:
                    user_id = f"iam-{row[0]}"
            finally:
                conn.rollback()
                _release_connection(conn)
        except Exception as e:
            logger.warning(f"[Notify] operator iam_sub lookup failed: {e}")

        # 1. Persist to DB if we have a user_id
        notif_id = None
        if user_id:
            notif_id = create_notification(
                user_id=user_id, type=type, title=title, body=body, payload=payload,
            )

        # 2. Live Socket.IO to operator room
        try:
            _s.sio.emit(
                'new_notification',
                {'id': notif_id, 'type': type, 'title': title, 'body': body, 'payload': payload},
                room=f"operator:{operator_id}",
            )
        except Exception as e:
            logger.warning(f"[Notify] SIO operator emit failed: {e}")

        # 3. Expo push
        if user_id:
            tokens = get_push_tokens(user_id)
            if tokens:
                _send_expo_push(tokens, title, body, payload)

    except Exception as e:
        logger.error(f"[Notify] _dispatch_operator error: {e}")


def _dispatch_admins(type, title, body, payload):
    """Notify all active operators/admins."""
    try:
        from common.conversation_db import _get_connection, _release_connection
        conn = _get_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT id, iam_sub FROM operators WHERE is_active = TRUE")
            ops = cur.fetchall()
        finally:
            conn.rollback()
            _release_connection(conn)

        for op_id, iam_sub in (ops or []):
            _dispatch_operator(op_id, type, title, body, payload)

        # Also emit to admin_live room (admin panel watchers with no operator account)
        try:
            import web.api.shared as _s
            _s.sio.emit(
                'new_notification',
                {'type': type, 'title': title, 'body': body, 'payload': payload},
                room='admin_live',
            )
        except Exception as e:
            logger.warning(f"[Notify] admin_live emit failed: {e}")

    except Exception as e:
        logger.error(f"[Notify] _dispatch_admins error: {e}")
