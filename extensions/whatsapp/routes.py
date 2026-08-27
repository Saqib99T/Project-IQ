"""WhatsApp Cloud API webhook receiver — verification handshake + inbound
message dispatch. Lives inside the extension itself, mirroring
extensions/shopify/routes.py.

*** UNVALIDATED as of this build (docs/plans/WHATSAPP_INTEGRATION_PLAN.md §8
Phase 0). The payload parsing below follows Meta's published webhook
structure (an entry[].changes[].value envelope carrying `messages`/`contacts`
for content and `metadata` for the receiving phone number), but the
group-specific fields — how a group id is surfaced on an inbound message, and
the @-mention payload shape — are NOT confirmed (group plan §2.1). Confirm
both against a real sandbox payload in Phase 0b before trusting
`_extract_group_id()`/`_extract_mentions()` below with live traffic. ***

Response contract mirrors Shopify's webhook receiver: 200 = processed/ignored
(no retry), 403 = failed verification (no retry), 500 = transient error
(Meta retries with backoff).
"""
import hashlib
import hmac
import logging
import secrets

from flask import Blueprint, request, jsonify, Response, g

from common.config_manager import get_whatsapp_config
from common.db._whatsapp_links import confirm_link, get_link_status_for_user, initiate_link, unlink
from web.api.rate_limiting import MemoryStore
import web.api.shared as _s

logger = logging.getLogger(__name__)

bp = Blueprint('whatsapp', __name__)


def _cfg() -> dict:
    return get_whatsapp_config()


def _verify_signature(raw_body: bytes, provided: str, app_secret: str) -> bool:
    """X-Hub-Signature-256: 'sha256=' + HMAC-SHA256(raw_body, app_secret) hex
    digest — Meta's standard webhook signing scheme, same shape as Shopify's
    HMAC check (base64 there, hex here) computed over the exact raw bytes,
    read before any JSON parsing."""
    if not provided or not provided.startswith("sha256="):
        return False
    digest = hmac.new(app_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, provided[len("sha256="):])


@bp.route('/webhooks/whatsapp', methods=['GET'])
def whatsapp_verify():
    """Meta's one-time webhook verification handshake: echo back
    hub.challenge if hub.verify_token matches what's configured."""
    cfg = _cfg()
    mode = request.args.get('hub.mode')
    token = request.args.get('hub.verify_token')
    challenge = request.args.get('hub.challenge', '')
    if mode == 'subscribe' and token and cfg['verify_token'] and hmac.compare_digest(token, cfg['verify_token']):
        return Response(challenge, status=200, mimetype='text/plain')
    logger.warning("[WhatsApp] webhook verification failed (mode=%s)", mode)
    return jsonify({'error': 'verification failed'}), 403


def _extract_mentions(message: dict) -> list:
    """Best-effort structured-mention extraction — UNCONFIRMED shape, see
    module docstring. Returns [] rather than guessing at a field name that
    might not exist; extensions/whatsapp/decision.py's is_mentioned() falls
    back to a text substring match regardless."""
    context = message.get('context') or {}
    return context.get('mentions') or []


def _extract_group_id(value: dict, message: dict) -> str:
    """Best-effort group-id extraction — UNCONFIRMED shape, see module
    docstring. Tries the couple of plausible locations a group id could
    surface (top-level on the message, or in `value` metadata) and returns
    '' (treated as a 1:1 message) if none match, rather than guessing wrong
    and misrouting a real 1:1 customer message into the group pipeline."""
    return message.get('group_id') or value.get('group_id') or ''


@bp.route('/webhooks/whatsapp', methods=['POST'])
def whatsapp_webhook():
    cfg = _cfg()
    raw_body = request.get_data()
    provided = request.headers.get('X-Hub-Signature-256', '')
    if not cfg['app_secret'] or not _verify_signature(raw_body, provided, cfg['app_secret']):
        # Diagnostic detail is metadata only (presence/length/prefix) — never
        # the app_secret or signature value itself — safe to log at WARNING.
        logger.warning(
            "[WhatsApp] webhook signature verification failed "
            "(signature_header_present=%s, signature_prefix_ok=%s, app_secret_configured=%s, body_len=%d)",
            bool(provided), provided.startswith('sha256=') if provided else None,
            bool(cfg['app_secret']), len(raw_body),
        )
        return jsonify({'error': 'invalid signature'}), 403

    payload = request.get_json(silent=True) or {}
    try:
        from extensions.whatsapp.bridge import handle_inbound_individual, handle_inbound_group
        from common.config_manager import get_platform_config

        # No IAM/tenant context exists on a WhatsApp webhook — this build
        # attributes every inbound WhatsApp message to the platform/support
        # org (same fallback bp_chat.py uses for the widget's unauthenticated
        # "platform" context). Multi-tenant WhatsApp numbers are explicitly
        # out of scope for this pass (group plan §7's "one Cloud API business
        # per group" note already flags this as a later constraint, not a
        # Phase 1 one).
        org_id = get_platform_config().get('org_id', '')

        for entry in payload.get('entry', []):
            for change in entry.get('changes', []):
                value = change.get('value', {})
                for message in value.get('messages', []):
                    if message.get('type') != 'text':
                        continue  # media/interactive/etc not handled yet
                    text = (message.get('text') or {}).get('body', '')
                    wa_id = message.get('from', '')
                    contact = next(
                        (c for c in value.get('contacts', []) if c.get('wa_id') == wa_id), {}
                    )
                    display_name = (contact.get('profile') or {}).get('name', '')
                    group_id = _extract_group_id(value, message)

                    if group_id:
                        if not cfg['groups_enabled']:
                            logger.info("[WhatsApp] group message received but groups_enabled=false — ignored")
                            continue
                        handle_inbound_group(
                            org_id, group_id, wa_id, display_name, text,
                            mentions=_extract_mentions(message),
                        )
                    else:
                        handle_inbound_individual(org_id, wa_id, display_name, text)
        return jsonify({'received': True}), 200
    except Exception as e:
        logger.error("[WhatsApp] webhook processing failed: %r", e, exc_info=True)
        return jsonify({'error': 'processing failed'}), 500


# ------------------------------------------------------------------
# Account linking (docs/plans/WHATSAPP_INTEGRATION_PLAN.md Phase 3) — portal
# endpoints for an already-authenticated user to prove they own a WhatsApp
# number. Deliberately does NOT grant itsm-service API access on its own
# (see that plan doc's 2026-08-27 note) — this only establishes identity for
# Project IQ's own attribution/personalization.
# ------------------------------------------------------------------

# Separate from whatsapp_service's own send_rate_limit (which still applies
# to the actual OTP send) — this caps how often ONE account can trigger a
# fresh code, independent of how many different accounts might be sending
# at once. 5 per hour is generous for a real "I mistyped, resend" case,
# tight enough to stop someone hammering a number they don't own with OTP
# texts as a harassment vector.
_link_initiate_limiter = MemoryStore()


@bp.route('/portal/whatsapp/link/initiate', methods=['POST'])
@_s.require_iam_token
def whatsapp_link_initiate():
    org_id = _s.caller_org_scope()
    iam_sub = g.iam_user['sub']
    if not org_id:
        return jsonify({'error': 'Select a tenant before linking a WhatsApp number'}), 400

    data = request.get_json(silent=True) or {}
    wa_id = (data.get('wa_id') or '').strip().lstrip('+').replace(' ', '').replace('-', '')
    if not wa_id.isdigit() or len(wa_id) < 8:
        return jsonify({'error': 'wa_id must be a phone number in E.164 digits, e.g. 923214421327'}), 400

    allowed, retry_after = _link_initiate_limiter.hit(f"whatsapp_link_initiate:{iam_sub}", 5, 3600)
    if not allowed:
        return jsonify({'error': f'Too many attempts — try again in {retry_after}s'}), 429

    code = f"{secrets.randbelow(1_000_000):06d}"
    display_name = g.iam_user.get('name')
    ok = initiate_link(org_id, iam_sub, wa_id, code, display_name=display_name)
    if not ok:
        return jsonify({'error': 'This WhatsApp number is already linked to a different account'}), 409

    from extensions.whatsapp.service import whatsapp_service
    sent = whatsapp_service.send_text(
        wa_id, f"Your Project IQ verification code is {code}. It expires in 10 minutes.",
        recipient_type="individual",
    )
    if not sent:
        logger.warning("[WhatsApp Link] org %s / iam_sub %s: OTP send failed for wa_id %s", org_id, iam_sub, wa_id)
        return jsonify({'error': 'Could not send the verification code — check the number and try again'}), 502
    return jsonify({'sent': True})


@bp.route('/portal/whatsapp/link/confirm', methods=['POST'])
@_s.require_iam_token
def whatsapp_link_confirm():
    iam_sub = g.iam_user['sub']
    data = request.get_json(silent=True) or {}
    wa_id = (data.get('wa_id') or '').strip().lstrip('+').replace(' ', '').replace('-', '')
    code = (data.get('code') or '').strip()
    if not wa_id or not code:
        return jsonify({'error': 'wa_id and code are both required'}), 400

    ok = confirm_link(iam_sub, wa_id, code)
    if not ok:
        return jsonify({'error': 'Invalid or expired code'}), 400
    return jsonify({'confirmed': True})


@bp.route('/portal/whatsapp/link/status', methods=['GET'])
@_s.require_iam_token
def whatsapp_link_status():
    iam_sub = g.iam_user['sub']
    status = get_link_status_for_user(iam_sub)
    return jsonify({'link': status})


@bp.route('/portal/whatsapp/link', methods=['DELETE'])
@_s.require_iam_token
def whatsapp_link_remove():
    iam_sub = g.iam_user['sub']
    ok = unlink(iam_sub)
    return jsonify({'success': ok})
