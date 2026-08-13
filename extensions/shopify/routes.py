"""
Shopify integration blueprint — per-tenant OAuth connect/callback, an inbound
webhook receiver (order events + the three GDPR compliance topics mandatory
for any multi-merchant app), and connection status/disconnect for the
portal/admin UI. Lives inside the extension itself (not a core web/api file)
so extensions/shopify/ is self-contained.

OAuth state handling mirrors bp_auth.py's PKCE-style in-process `_pkce_store`:
`/admin/shopify/connect` is an IAM-authenticated JSON endpoint that mints a
state tied to the caller's org_id and returns a Shopify authorize URL; the
frontend navigates the browser there directly (Shopify's consent screen
requires a real top-level redirect, not XHR) — so no unauthenticated endpoint
ever accepts a raw tenant/org id.
"""
import base64
import hashlib
import hmac
import logging
import time
import uuid
import urllib.parse as _up

import requests
from flask import Blueprint, request, jsonify, redirect

from common.config_manager import get_shopify_config
from common.db._shopify import (
    upsert_connection,
    connection_status,
    disconnect,
    purge,
    get_connection_by_shop_domain,
)
import web.api.shared as _s

logger = logging.getLogger(__name__)

bp = Blueprint('shopify', __name__)

# In-process OAuth state store: state -> {org_id, shop_domain, created_at}.
# Mirrors bp_auth.py's _pkce_store — short-lived (consumed on callback), no
# TTL sweep needed since an unclaimed state is bounded by how long Shopify's
# own consent page stays open.
_oauth_state_store: dict = {}


def _cfg() -> dict:
    return get_shopify_config()


# ------------------------------------------------------------------
# Connect / Callback
# ------------------------------------------------------------------

@bp.route('/admin/shopify/connect', methods=['POST'])
@_s.require_iam_token
def shopify_connect():
    """Mint an OAuth state for the caller's org and return the Shopify
    authorize URL for the frontend to navigate the browser to."""
    cfg = _cfg()
    if not cfg['enabled'] or not cfg['client_id']:
        return jsonify({'error': 'Shopify integration is not configured on this deployment'}), 503

    data = request.get_json(silent=True) or {}
    shop_domain = (data.get('shop_domain') or '').strip().lower()
    if not shop_domain.endswith('.myshopify.com'):
        return jsonify({'error': "shop_domain must look like 'your-store.myshopify.com'"}), 400

    # caller_org_scope() (not raw g.org_id) so a platform/super admin acting on
    # behalf of a tenant via the X-Org-Id header (the tenant-picker pattern
    # IntegrationPage.jsx already uses) connects THAT tenant's store, not
    # their own platform org.
    org_id = _s.caller_org_scope()
    if not org_id:
        return jsonify({'error': 'Select a tenant before connecting a Shopify store'}), 400

    state = str(uuid.uuid4())
    _oauth_state_store[state] = {'org_id': org_id, 'shop_domain': shop_domain, 'created_at': time.time()}

    params = _up.urlencode({
        'client_id':    cfg['client_id'],
        'scope':        cfg['scopes'],
        'redirect_uri': cfg['redirect_uri'],
        'state':        state,
    })
    return jsonify({'authorize_url': f"https://{shop_domain}/admin/oauth/authorize?{params}"})


def _verify_shopify_hmac(args: dict, secret: str) -> bool:
    """Verify the HMAC Shopify signs onto OAuth callback query params — sort
    the remaining params, join as a query string, HMAC-SHA256 with the app's
    client_secret, compare hex digest (constant-time). Per Shopify's OAuth
    docs (distinct from the webhook HMAC scheme below, which is base64 over
    the raw request body)."""
    provided = args.get('hmac', '')
    if not provided:
        return False
    pairs = sorted((k, v) for k, v in args.items() if k not in ('hmac', 'signature'))
    message = '&'.join(f"{k}={v}" for k, v in pairs)
    digest = hmac.new(secret.encode('utf-8'), message.encode('utf-8'), hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, provided)


@bp.route('/admin/shopify/callback')
def shopify_callback():
    """Shopify redirects here after merchant consent. Verify the HMAC and the
    state we minted, exchange the code for an EXPIRING offline access token
    (Shopify rejects non-expiring tokens outright — see
    docs/SHOPIFY_INTEGRATION_PLAN.md), and persist the connection.

    Webhook subscriptions (incl. the mandatory GDPR topics) are NOT
    registered here — Shopify's recommended mechanism is declaring them in
    shopify-app/shopify.app.toml's [[webhooks.subscriptions]] /
    [webhooks.privacy_compliance] and pushing via `shopify app deploy`, which
    Shopify then applies automatically to every shop that installs the app.
    The old runtime REST-registration approach this replaced also silently
    stopped working once expiring tokens became mandatory."""
    cfg = _cfg()
    args = request.args.to_dict()
    state = args.get('state')
    entry = _oauth_state_store.pop(state, None) if state else None
    if not entry:
        return redirect('/portal/admin/shopify?shopify_error=invalid_state')

    if not _verify_shopify_hmac(args, cfg['client_secret']):
        logger.warning("[Shopify] OAuth callback HMAC verification failed (state=%s)", state)
        return redirect('/portal/admin/shopify?shopify_error=invalid_signature')

    code = args.get('code')
    shop_domain = args.get('shop') or entry['shop_domain']
    if not code:
        return redirect('/portal/admin/shopify?shopify_error=missing_code')

    try:
        token_resp = requests.post(
            f"https://{shop_domain}/admin/oauth/access_token",
            json={
                'client_id': cfg['client_id'],
                'client_secret': cfg['client_secret'],
                'code': code,
                'expiring': 1,  # required — see docstring above
            },
            timeout=10,
        ).json()
    except Exception as e:
        logger.error("[Shopify] token exchange failed for shop %s: %r", shop_domain, e)
        return redirect('/portal/admin/shopify?shopify_error=token_exchange_failed')

    access_token = token_resp.get('access_token')
    if not access_token:
        return redirect(f"/portal/admin/shopify?shopify_error={token_resp.get('error', 'token_failed')}")

    org_id = entry['org_id']
    upsert_connection(
        org_id, shop_domain, access_token,
        token_resp.get('refresh_token'),
        token_resp.get('expires_in'),
        token_resp.get('refresh_token_expires_in'),
        token_resp.get('scope', ''),
    )
    logger.info("[Shopify] org %s connected shop %s (expires_in=%s)",
                org_id, shop_domain, token_resp.get('expires_in'))

    return redirect('/portal/admin/shopify?connected=1')


# ------------------------------------------------------------------
# Status / Disconnect (portal/admin UI)
# ------------------------------------------------------------------

@bp.route('/admin/shopify/connection', methods=['GET'])
@_s.require_iam_token
def shopify_connection_status():
    org_id = _s.caller_org_scope()
    if not org_id:
        return jsonify({'connection': None})
    return jsonify({'connection': connection_status(org_id)})


@bp.route('/admin/shopify/connection', methods=['DELETE'])
@_s.require_iam_token
def shopify_disconnect():
    org_id = _s.caller_org_scope()
    if not org_id:
        return jsonify({'error': 'Select a tenant before disconnecting a Shopify store'}), 400
    ok = disconnect(org_id)
    logger.info("[Shopify] org %s disconnected shop (ok=%s)", org_id, ok)
    return jsonify({'success': ok})


# ------------------------------------------------------------------
# Inbound webhooks (order events + mandatory GDPR compliance topics)
# ------------------------------------------------------------------

def _verify_webhook_hmac(raw_body: bytes, provided_b64: str, secret: str) -> bool:
    """Shopify webhook HMAC: base64(HMAC-SHA256(raw_body, client_secret)),
    header X-Shopify-Hmac-Sha256. Computed over the exact raw bytes — read
    BEFORE any JSON parsing, same shape as itsm-service's IAM webhook
    receiver (app/api/v1/webhooks.py)."""
    if not provided_b64:
        return False
    digest = hmac.new(secret.encode('utf-8'), raw_body, hashlib.sha256).digest()
    return hmac.compare_digest(base64.b64encode(digest).decode('utf-8'), provided_b64)


@bp.route('/webhooks/shopify', methods=['POST'])
def shopify_webhook():
    """Single endpoint for every subscribed topic, dispatched by the
    X-Shopify-Topic header. Response contract mirrors itsm-service's IAM
    webhook receiver: 200 = success/idempotent/ignored (no retry), 401 = bad
    signature (no retry), 500 = transient error (Shopify retries w/ backoff)."""
    raw_body = request.get_data()
    provided = request.headers.get('X-Shopify-Hmac-Sha256', '')
    cfg = _cfg()
    if not _verify_webhook_hmac(raw_body, provided, cfg['client_secret']):
        logger.warning("[Shopify] webhook HMAC verification failed")
        return jsonify({'error': 'invalid signature'}), 401

    topic = request.headers.get('X-Shopify-Topic', '')
    shop_domain = request.headers.get('X-Shopify-Shop-Domain', '')
    payload = request.get_json(silent=True) or {}

    try:
        if topic == 'shop/redact':
            # Mandatory GDPR topic: merchant uninstalled 48h+ ago — purge
            # everything we hold for their shop.
            target_shop = payload.get('shop_domain') or shop_domain
            conn = get_connection_by_shop_domain(target_shop) if target_shop else None
            if conn:
                purge(conn['org_id'])
            logger.info("[Shopify] shop/redact processed for %s", target_shop)
        elif topic in ('customers/redact', 'customers/data_request'):
            # Mandatory GDPR topics. Project IQ doesn't persist Shopify
            # customer data locally — order lookups are live GraphQL calls,
            # not a cache — so there's nothing to erase/export. The endpoint
            # must still exist and return 200 for Shopify's app approval.
            logger.info("[Shopify] %s received for shop %s (no local customer data held)", topic, shop_domain)
        elif topic in ('orders/create', 'orders/updated', 'orders/cancelled'):
            # MVP: no local order cache — acknowledge so Shopify doesn't
            # retry/disable the subscription. Wire into a cache/notification
            # path if a later phase needs push-driven order state instead of
            # look-up-on-demand.
            logger.info("[Shopify] %s for shop %s, order %s", topic, shop_domain, payload.get('name'))
        else:
            logger.info("[Shopify] unhandled webhook topic: %s", topic)
        return jsonify({'received': True}), 200
    except Exception as e:
        logger.error("[Shopify] webhook processing failed for topic %s: %r", topic, e, exc_info=True)
        return jsonify({'error': 'processing failed'}), 500
