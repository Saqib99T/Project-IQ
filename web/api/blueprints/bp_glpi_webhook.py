"""
GLPI Webhook blueprint.

GLPI sends a POST to /webhooks/glpi on every ticket event (create,
update, followup added, solution added, close).

We look up which user owns the ticket, then call notify_user() to
send an in-app notification + Expo push.

Setup in GLPI (10.x):
  Administration → Notifications → Webhook Notifications → Add
    URL:    https://your-domain.com/webhooks/glpi
    Secret: <same value as GLPI_WEBHOOK_SECRET in app.config>
    Events: Ticket (Add / Update), ITILFollowup (Add), ITILSolution (Add)

GLPI sends the header:  X-Glpi-Signature: <secret>
"""
import hmac
import logging
import asyncio

from flask import Blueprint, request, jsonify

logger = logging.getLogger(__name__)

bp = Blueprint('glpi_webhook', __name__)

# GLPI ticket status ID → human label
TICKET_STATUS = {
    1: 'New',
    2: 'Processing (assigned)',
    3: 'Processing (planned)',
    4: 'Pending',
    5: 'Solved',
    6: 'Closed',
}

# Status IDs we want to notify the user about (skip trivial internal updates)
NOTIFY_STATUS_IDS = {2, 4, 5, 6}


def _validate_secret(secret: str) -> bool:
    from common.config_manager import get_glpi_webhook_config
    expected = get_glpi_webhook_config().get('secret', '')
    if not expected or expected == 'change-me-to-a-random-secret':
        logger.warning('[GLPI Webhook] No secret configured — accepting all requests')
        return True
    incoming = request.headers.get('X-Glpi-Signature', '')
    return hmac.compare_digest(incoming, expected)


def _get_sender_for_ticket(ticket_id: int) -> tuple[str | None, str | None]:
    """
    Return (sender_id, app_id) for a GLPI ticket.
    1. Check our ticket_senders table (fast — no API call).
    2. Fallback: call GLPI API to get requester GLPI user ID →
       reverse-lookup iam_sub → derive sender_id.
    """
    # Fast path
    try:
        from common.db.iam_glpi_users import get_sender_by_ticket_id
        sender_id = get_sender_by_ticket_id(ticket_id)
        if sender_id:
            return sender_id, None
    except Exception as e:
        logger.warning(f'[GLPI Webhook] ticket_senders lookup error: {e}')

    # Fallback: GLPI API
    try:
        from action_server.actions.glpi_service import GlpiService
        from common.config_manager import get_glpi_config
        from common.db.iam_glpi_users import get_iam_sub_by_glpi_user_id

        cfg  = get_glpi_config()
        glpi = GlpiService(cfg['api_url'], cfg['app_token'], cfg['user_token'])

        async def _fetch():
            session = await glpi.init_session()
            if not session:
                return None
            try:
                ticket = await glpi.get_ticket(session, str(ticket_id))
                return ticket
            finally:
                await glpi.kill_session(session)

        ticket_data = asyncio.run(_fetch())
        if not ticket_data:
            return None, None

        glpi_user_id = ticket_data.get('_users_id_requester') or \
                       ticket_data.get('users_id_requester')
        if not glpi_user_id:
            return None, None

        iam_sub = get_iam_sub_by_glpi_user_id(int(glpi_user_id))
        if not iam_sub:
            return None, None

        return f'iam-{iam_sub}', None

    except Exception as e:
        logger.error(f'[GLPI Webhook] GLPI API fallback error: {e}')
        return None, None


@bp.route('/webhooks/glpi', methods=['POST'])
def glpi_webhook():
    """Receive GLPI event, look up the user, send notification."""
    try:
        if not _validate_secret(request.headers.get('X-Glpi-Signature', '')):
            logger.warning('[GLPI Webhook] Invalid secret')
            return jsonify({'error': 'Forbidden'}), 403

        payload = request.get_json(silent=True) or {}
        logger.info(f'[GLPI Webhook] received: {payload}')

        itemtype = payload.get('itemtype', '')
        event    = payload.get('event', '')
        items_id = payload.get('items_id')
        changes  = payload.get('changes', {})
        input_   = payload.get('input', {})

        # ── Ticket events ─────────────────────────────────────────────────────
        if itemtype == 'Ticket':
            ticket_id = int(items_id) if items_id else None
            if not ticket_id:
                return jsonify({'ok': True, 'skipped': 'no ticket id'}), 200

            if event == 'add':
                # New ticket created externally (e.g. by admin directly in GLPI)
                # Nothing to notify — our app already notifies on its own ticket creation
                return jsonify({'ok': True, 'skipped': 'ticket add handled by chat flow'}), 200

            if event in ('update', 'update_many'):
                new_status = changes.get('status', [None, None])[1] \
                    if isinstance(changes.get('status'), list) else None

                if new_status not in NOTIFY_STATUS_IDS:
                    return jsonify({'ok': True, 'skipped': f'status {new_status} not notifiable'}), 200

                label = TICKET_STATUS.get(new_status, f'Status {new_status}')
                sender_id, app_id = _get_sender_for_ticket(ticket_id)
                if not sender_id:
                    return jsonify({'ok': True, 'skipped': 'user not found'}), 200

                from web.api.impl.notify import notify_user
                notify_user(
                    user_id=sender_id,
                    type='ticket_update',
                    app_id=app_id,
                    title=f'Ticket #{ticket_id} — {label}',
                    body=_status_message(new_status),
                    payload={'ticket_id': ticket_id},
                )
                return jsonify({'ok': True, 'notified': sender_id}), 200

        # ── ITILFollowup — technician added a comment ─────────────────────────
        if itemtype == 'ITILFollowup' and event == 'add':
            ticket_id = int(input_.get('items_id', 0)) or \
                        int(payload.get('items_id', 0))
            if not ticket_id:
                return jsonify({'ok': True, 'skipped': 'no ticket id in followup'}), 200

            # Only notify for technician replies (is_private=0, sourcetype=1)
            if input_.get('is_private') == 1:
                return jsonify({'ok': True, 'skipped': 'private followup'}), 200

            sender_id, app_id = _get_sender_for_ticket(ticket_id)
            if not sender_id:
                return jsonify({'ok': True, 'skipped': 'user not found'}), 200

            content  = (input_.get('content') or '').strip()
            preview  = content[:80] + '…' if len(content) > 80 else content

            from web.api.impl.notify import notify_user
            notify_user(
                user_id=sender_id,
                type='ticket_update',
                app_id=app_id,
                title=f'New update on Ticket #{ticket_id}',
                body=preview or 'A technician has replied to your ticket.',
                payload={'ticket_id': ticket_id},
            )
            return jsonify({'ok': True, 'notified': sender_id}), 200

        # ── ITILSolution — ticket solved ──────────────────────────────────────
        if itemtype == 'ITILSolution' and event == 'add':
            ticket_id = int(input_.get('items_id', 0)) or \
                        int(payload.get('items_id', 0))
            if not ticket_id:
                return jsonify({'ok': True, 'skipped': 'no ticket id in solution'}), 200

            sender_id, app_id = _get_sender_for_ticket(ticket_id)
            if not sender_id:
                return jsonify({'ok': True, 'skipped': 'user not found'}), 200

            from web.api.impl.notify import notify_user
            notify_user(
                user_id=sender_id,
                type='ticket_update',
                app_id=app_id,
                title=f'Ticket #{ticket_id} has been resolved ✅',
                body='Your ticket has been marked as solved. Please confirm if the issue is fixed.',
                payload={'ticket_id': ticket_id},
            )
            return jsonify({'ok': True, 'notified': sender_id}), 200

        return jsonify({'ok': True, 'skipped': f'unhandled {itemtype}/{event}'}), 200

    except Exception as e:
        logger.error(f'[GLPI Webhook] unhandled error: {e}', exc_info=True)
        return jsonify({'error': str(e)}), 500


def _status_message(status_id: int) -> str:
    return {
        2: 'A technician has been assigned to your ticket.',
        4: 'Your ticket is pending additional information.',
        5: 'Your ticket has been resolved. Please confirm if the issue is fixed.',
        6: 'Your ticket has been closed.',
    }.get(status_id, 'Your ticket status has been updated.')
