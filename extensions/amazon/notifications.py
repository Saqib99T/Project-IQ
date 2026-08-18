"""
Amazon SP-API Notifications API — order-event delivery via AWS SQS
(docs/AMAZON_INTEGRATION_PLAN.md Phase 4).

*** UNVALIDATED AGAINST LIVE SP-API AS OF THIS BUILD ***
This module was written against SP-API documentation, not live-tested — this
repo's credentials are incomplete (client_id is unset in common/app.config)
and notifications_enabled defaults false. Before enabling in any real
environment: confirm register_destination()/subscribe() succeed in the
SP-API sandbox with full Solution Provider Portal credentials, exactly the
same "validate against reality, not docs" discipline the rest of this
integration's build used (see the Feeds API finding in
docs/AMAZON_INTEGRATION_PLAN.md §6 — that one turned out to be blocked only
once actually tried).

Unlike find_order() (Orders API, GET), destinations/subscriptions are
one-time-per-seller setup calls (POST) — not something run per request.
Reuses AmazonService's existing per-tenant token/session handling via
amazon_service._post() rather than a second HTTP client.

Consumer: run_consumer_forever() is spawned as a background eventlet
greenthread (see web/api/web_api.py's startup, matching the existing
KB-cache-refresh background-thread pattern in this repo — no new task-queue
framework adopted for this one poller) — gated behind
notifications_enabled, so it's a no-op unless explicitly turned on.
"""
import json
import logging
import time
from typing import Any, Dict, Optional

from common.config_manager import get_amazon_notifications_config
from extensions.amazon.service import amazon_service

logger = logging.getLogger(__name__)

_ORDER_EVENT_TYPE = "ORDER_STATUS_CHANGE"


async def register_destination(org_id: str) -> Optional[str]:
    """One-time setup: point SP-API notifications at this deployment's SQS
    queue. Returns the destinationId on success. UNVALIDATED — see module
    docstring."""
    cfg = get_amazon_notifications_config()
    if not cfg["sqs_queue_arn"]:
        logger.warning("[Amazon Notifications] sqs_queue_arn not configured, skipping register_destination")
        return None

    body = await amazon_service._post(org_id, "/notifications/v1/destinations", {
        "name": "project-iq-order-events",
        "resourceSpecification": {"sqs": {"arn": cfg["sqs_queue_arn"]}},
    })
    if not body:
        return None
    destination_id = (body.get("payload") or {}).get("destinationId")
    logger.info("[Amazon Notifications] org %s registered destination %s", org_id, destination_id)
    return destination_id


async def subscribe(org_id: str, destination_id: str, event_type: str = _ORDER_EVENT_TYPE) -> bool:
    """One-time setup: subscribe the registered destination to an event type.
    UNVALIDATED — see module docstring."""
    body = await amazon_service._post(
        org_id, f"/notifications/v1/subscriptions/{event_type}",
        {"payloadVersion": "1.0", "destinationId": destination_id},
    )
    ok = body is not None
    logger.info("[Amazon Notifications] org %s subscribe %s -> %s", org_id, event_type, ok)
    return ok


def _decode_message(raw_body: str) -> Optional[Dict[str, Any]]:
    """SP-API notification messages are JSON with a `notificationType` and
    `payload` — parsed defensively since this hasn't been validated against
    a real message yet."""
    try:
        return json.loads(raw_body)
    except (TypeError, ValueError) as exc:
        logger.warning("[Amazon Notifications] could not decode message: %r", exc)
        return None


def _log_event(event: Dict[str, Any]) -> None:
    """Persist the decoded event for audit/debugging — deliberately not
    wired to any proactive customer-notification behavior yet (follow-up
    work, out of scope for this scaffolding pass)."""
    from common.db._connection import _get_connection, _release_connection

    conn = None
    try:
        conn = _get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO amazon_order_events (notification_type, payload, received_at) "
            "VALUES (%s, %s, NOW())",
            (event.get("notificationType"), json.dumps(event)),
        )
        conn.commit()
    except Exception as exc:
        logger.error("[Amazon Notifications] failed to log event: %r", exc)
    finally:
        if conn:
            _release_connection(conn)


def poll_once(sqs_client) -> int:
    """Receive + process + delete one batch of SQS messages. Returns the
    number processed. Split out from the loop below so it's independently
    testable with a mocked boto3 client."""
    cfg = get_amazon_notifications_config()
    resp = sqs_client.receive_message(
        QueueUrl=cfg["sqs_queue_arn"], MaxNumberOfMessages=10, WaitTimeSeconds=5,
    )
    messages = resp.get("Messages", [])
    for msg in messages:
        event = _decode_message(msg.get("Body", ""))
        if event:
            _log_event(event)
        sqs_client.delete_message(QueueUrl=cfg["sqs_queue_arn"], ReceiptHandle=msg["ReceiptHandle"])
    return len(messages)


def run_consumer_forever() -> None:
    """Background polling loop — only does anything when notifications_enabled
    is set (see module docstring: unvalidated, off by default). Intended to
    be run inside an eventlet.spawn() greenthread, not called directly on
    the main thread."""
    cfg = get_amazon_notifications_config()
    if not cfg["enabled"]:
        logger.info("[Amazon Notifications] consumer disabled (notifications_enabled=false), not starting")
        return

    import boto3
    sqs_client = boto3.client(
        "sqs", region_name=cfg["aws_region"],
        aws_access_key_id=cfg["aws_access_key_id"],
        aws_secret_access_key=cfg["aws_secret_access_key"],
    )
    logger.info("[Amazon Notifications] consumer started")
    while True:
        try:
            poll_once(sqs_client)
        except Exception as exc:
            logger.error("[Amazon Notifications] poll failed: %r", exc, exc_info=True)
        time.sleep(cfg["poll_interval_seconds"])
