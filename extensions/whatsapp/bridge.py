"""Bridges a parsed inbound WhatsApp message into the existing action-server/
NLU brain and routes the reply back out over WhatsApp. Deliberately does NOT
go through bp_chat.py/socketio_events.py's Flask route (that pipeline is
widget-session-shaped — IAM extraction, socket rooms, handoff-queue relay,
none of which apply to a WhatsApp guest or a shared group conversation) or
loop back into it over HTTP. Instead this calls Rasa directly, the same way
bp_chat.py's own core path does, and does the same conversation
logging/gating groundwork inline — kept intentionally lean (no handoff-queue
relay, no ticket-created push notification) since those are Phase 3/4 scope
(docs/plans/WHATSAPP_GROUP_ASSISTANT_PLAN.md §8), not this pass.

Both entry points swallow their own exceptions and log rather than raise —
routes.py's webhook handler already wraps everything in a try/except for the
same reason Shopify's does (a raised exception here must not turn into a
Meta-retried webhook storm), but the intent here is stronger: one bad message
in a group must never break every other message in that group's turn.
"""
import logging
from typing import Optional

import requests

import web.api.shared as _s
from common.db._messages import log_conversation_start, log_message
from extensions.whatsapp.decision import is_mentioned, should_respond
from extensions.whatsapp.identity import (
    group_sender_id,
    individual_sender_id,
    resolve_participant_identity,
)
from extensions.whatsapp.service import whatsapp_service
from extensions.whatsapp.store import get_org_settings, resolve_proactivity_level

logger = logging.getLogger(__name__)

_RASA_TIMEOUT = 60
# Bumped from 30s after live-device testing (2026-08-27) showed a rapid
# sequence of real messages getting silently dropped mid-conversation — most
# likely Rasa's per-conversation lock (rasa.core.lock_store) serializing
# messages combined with cold-start action-server latency (KB embedding
# model load + intent-index build, observed taking 25-30s on a cold cache)
# pushing a queued message past this timeout. The cache is warm after first
# use, so this is mostly headroom, not a real fix for sustained rapid-fire
# messages — see docs/plans/WHATSAPP_INTEGRATION_PLAN.md's note on message
# queuing/backpressure as the real follow-up if this keeps happening once
# warm.


def _call_brain(sender_id: str, text: str, metadata: dict) -> list:
    """POST to Rasa exactly like bp_chat.py's core path does, minus the
    IAM/handoff-gate logic that only applies to the widget. Returns the list
    of bot response dicts (each with a 'text' key), or [] on failure."""
    try:
        resp = requests.post(
            f"{_s.RASA_URL}/webhooks/rest/webhook",
            json={"sender": sender_id, "message": text, "metadata": metadata},
            timeout=_RASA_TIMEOUT,
        )
    except requests.RequestException as exc:
        logger.error("[WhatsApp] Rasa call failed for sender %s: %r", sender_id, exc)
        return []
    if resp.status_code != 200:
        logger.warning("[WhatsApp] Rasa call for sender %s -> %d", sender_id, resp.status_code)
        return []
    return resp.json() or []


def handle_inbound_individual(org_id: str, wa_id: str, display_name: str, text: str) -> None:
    """1:1 support path (docs/plans/WHATSAPP_INTEGRATION_PLAN.md) — guest by
    default, same KB-first/guest-ticket capability an unauthenticated widget
    visitor already gets. If this wa_id has a CONFIRMED account link
    (Phase 3, common/db/_whatsapp_links.py), the conversation is instead
    attributed to that real account — its own org_id (not whatever fallback
    org the caller passed), a stable per-account sender_id matching the
    widget's iam-{sub}-{product} scheme, and the real name for
    personalization.

    Only attaches metadata['iam_token'] — and only then — when the linked
    user's own org_id matches the KB bot service-account's fixed org_id
    claim (common.iam_service.get_kb_bot_org_id()). That token is backed by
    ONE global Keycloak client with a fixed tenant; this deployment is
    multi-tenant, so forwarding it for a user in a DIFFERENT org would risk
    itsm-service resolving the wrong tenant's data (see this plan doc's
    2026-08-27 note — this is the exact gate that note said any real fix
    needed). For every org that ISN'T the one this bot represents,
    account-scoped itsm-service actions still correctly prompt to sign in —
    only the one org this bot is provisioned for gets real ticket access
    through WhatsApp today; everyone else still just gets attribution/
    personalization from the link."""
    if not text:
        return
    from common.db._whatsapp_links import get_confirmed_link
    from common.iam_service import get_kb_bot_org_id, get_kb_bot_token

    link = get_confirmed_link(wa_id)
    if link:
        sender_id = f"iam-{link['iam_sub']}-whatsapp"
        org_id = link["org_id"]
        user_id = link["iam_sub"]
        user_name = link.get("display_name") or display_name
        extra_metadata = {"iam_sub": link["iam_sub"], "iam_name": user_name}
        if get_kb_bot_org_id() == org_id:
            bot_token = get_kb_bot_token()
            if bot_token:
                extra_metadata["iam_token"] = bot_token
    else:
        sender_id = individual_sender_id(wa_id, org_id)
        user_id = None
        user_name = display_name
        extra_metadata = {}

    try:
        log_conversation_start(sender_id, app_id="General", user_id=user_id, user_name=user_name, org_id=org_id)
        log_message(sender_id, "user", text, app_id="General", user_id=user_id, org_id=org_id)

        responses = _call_brain(sender_id, text, {
            "channel": "whatsapp", "wa_id": wa_id, "org_id": org_id, **extra_metadata,
        })
        for r in responses:
            if r.get("text"):
                log_message(sender_id, "bot", r["text"], app_id="General", user_id=user_id, org_id=org_id)
                whatsapp_service.send_text(wa_id, r["text"], recipient_type="individual")
    except Exception as exc:
        logger.error("[WhatsApp] 1:1 handling failed for wa_id=%s: %r", wa_id, exc, exc_info=True)


def handle_inbound_group(
    org_id: str, group_id: str, wa_id: str, display_name: str, text: str,
    mentions: Optional[list] = None,
) -> None:
    """Group assistant path (docs/plans/WHATSAPP_GROUP_ASSISTANT_PLAN.md) —
    one SHARED conversation per group; every message is logged regardless of
    whether the bot replies (FR2 — observe everything), but a reply only
    goes out when decision.should_respond() says so."""
    if not text:
        return
    from common.config_manager import get_whatsapp_config

    settings = get_org_settings(org_id)
    if settings.get("mode") not in ("group_assistant", "both"):
        return  # this org hasn't turned group mode on

    sender_id = group_sender_id(group_id, org_id)
    participant_identity = resolve_participant_identity(org_id, group_id, wa_id, display_name)

    try:
        # FR2: log every message, mentioned or not — this conversation record
        # is the group's shared transcript, not just the bot's own turns.
        log_conversation_start(sender_id, app_id="General", org_id=org_id)
        attributed_text = f"[{display_name or wa_id}] {text}" if display_name else text
        log_message(sender_id, "user", attributed_text, app_id="General",
                    user_id=participant_identity, org_id=org_id)

        cfg = get_whatsapp_config()
        mentioned = is_mentioned(text, mentions, cfg["phone_number_id"])
        proactivity_level = resolve_proactivity_level(org_id)
        respond, reason = should_respond(group_id, text, mentioned, proactivity_level)
        logger.info("[WhatsApp] group=%s mentioned=%s decision=%s (%s)",
                    group_id, mentioned, respond, reason)
        if not respond:
            return

        responses = _call_brain(sender_id, text, {
            "channel": "whatsapp_group", "group_id": group_id, "org_id": org_id,
            "speaker_wa_id": wa_id, "speaker_identity": participant_identity,
        })
        for r in responses:
            if r.get("text"):
                log_message(sender_id, "bot", r["text"], app_id="General", org_id=org_id)
                whatsapp_service.send_text(group_id, r["text"], recipient_type="group")
    except Exception as exc:
        logger.error("[WhatsApp] group handling failed for group_id=%s: %r", group_id, exc, exc_info=True)
