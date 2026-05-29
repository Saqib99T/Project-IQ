"""
Notification dispatch helper.

Call notify_user() from anywhere (Socket.IO events, Rasa action callbacks, etc.)
to create a DB notification row, emit a live Socket.IO badge update, and
optionally send an Expo push notification.
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
