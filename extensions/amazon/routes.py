"""
Amazon integration blueprint — per-tenant LWA OAuth connect/callback and
connection status/disconnect for the portal/admin UI. Lives inside the
extension itself (not a core web/api file), mirroring
extensions/shopify/routes.py.

OAuth state handling mirrors bp_auth.py's PKCE-style in-process
`_oauth_state_store` (same pattern as Shopify's routes.py — see that file's
docstring for the full rationale): `/admin/amazon/connect` is an
IAM-authenticated JSON endpoint that mints a state tied to the caller's
org_id and returns Amazon's seller-consent authorize URL; the frontend
navigates the browser there directly.

No inbound webhook receiver yet — Amazon's equivalent (the Notifications API)
delivers via AWS SQS, not an HTTP endpoint, and isn't built yet (Phase 4,
docs/AMAZON_INTEGRATION_PLAN.md §6).
"""
import logging
import time
import uuid
import urllib.parse as _up

import requests
from flask import Blueprint, request, jsonify, redirect

from common.config_manager import get_amazon_config
from common.db._amazon import upsert_connection, connection_status, disconnect
import web.api.shared as _s

logger = logging.getLogger(__name__)

bp = Blueprint('amazon', __name__)

_oauth_state_store: dict = {}
_OAUTH_STATE_TTL_SECONDS = 600  # 10 min — a little slack over spapi_oauth_code's own 5-min expiry


def _cfg() -> dict:
    return get_amazon_config()


# ------------------------------------------------------------------
# Connect / Callback
# ------------------------------------------------------------------

@bp.route('/admin/amazon/connect', methods=['POST'])
@_s.require_iam_token
def amazon_connect():
    """Mint an OAuth state for the caller's org and return Amazon's
    seller-consent authorize URL for the frontend to navigate the browser
    to. `version=beta` is required while the app is Draft/Sandbox — drop it
    once the Public Developer application (docs/AMAZON_INTEGRATION_PLAN.md
    Phase 1) is approved and the app is live."""
    cfg = _cfg()
    if not cfg['enabled'] or not cfg['app_id']:
        return jsonify({'error': 'Amazon integration is not configured on this deployment'}), 503

    org_id = _s.caller_org_scope()
    if not org_id:
        return jsonify({'error': 'Select a tenant before connecting an Amazon seller account'}), 400

    state = str(uuid.uuid4())
    _oauth_state_store[state] = {'org_id': org_id, 'created_at': time.time()}

    params = {'application_id': cfg['app_id'], 'state': state}
    if cfg['environment'] == 'sandbox':
        params['version'] = 'beta'
    authorize_url = f"https://sellercentral.amazon.com/apps/authorize/consent?{_up.urlencode(params)}"
    return jsonify({'authorize_url': authorize_url})


@bp.route('/admin/amazon/callback')
def amazon_callback():
    """Amazon redirects here after seller consent with state,
    spapi_oauth_code, and selling_partner_id query params. The
    spapi_oauth_code expires after 5 minutes — exchange it for tokens
    immediately."""
    cfg = _cfg()
    args = request.args.to_dict()
    state = args.get('state')
    entry = _oauth_state_store.pop(state, None) if state else None
    if not entry:
        return redirect('/portal/admin/amazon?amazon_error=invalid_state')
    if time.time() - entry['created_at'] > _OAUTH_STATE_TTL_SECONDS:
        logger.warning("[Amazon] OAuth callback with expired state for org %s", entry.get('org_id'))
        return redirect('/portal/admin/amazon?amazon_error=invalid_state')

    code = args.get('spapi_oauth_code')
    seller_id = args.get('selling_partner_id')
    if not code:
        return redirect('/portal/admin/amazon?amazon_error=missing_code')

    try:
        token_resp = requests.post(
            "https://api.amazon.com/auth/o2/token",
            data={
                'grant_type': 'authorization_code',
                'code': code,
                'client_id': cfg['client_id'],
                'client_secret': cfg['client_secret'],
            },
            timeout=10,
        ).json()
    except Exception as e:
        logger.error("[Amazon] token exchange failed for seller %s: %r", seller_id, e)
        return redirect('/portal/admin/amazon?amazon_error=token_exchange_failed')

    access_token = token_resp.get('access_token')
    refresh_token = token_resp.get('refresh_token')
    if not access_token or not refresh_token:
        return redirect(f"/portal/admin/amazon?amazon_error={token_resp.get('error', 'token_failed')}")

    org_id = entry['org_id']
    upsert_connection(
        org_id, seller_id, cfg['marketplace_ids'],
        access_token, refresh_token, token_resp.get('expires_in'),
    )
    logger.info("[Amazon] org %s connected seller %s", org_id, seller_id)

    return redirect('/portal/admin/amazon?connected=1')


# ------------------------------------------------------------------
# Status / Disconnect (portal/admin UI)
# ------------------------------------------------------------------

@bp.route('/admin/amazon/connection', methods=['GET'])
@_s.require_iam_token
def amazon_connection_status():
    org_id = _s.caller_org_scope()
    if not org_id:
        return jsonify({'connection': None})
    return jsonify({'connection': connection_status(org_id)})


@bp.route('/admin/amazon/connection', methods=['DELETE'])
@_s.require_iam_token
def amazon_disconnect():
    org_id = _s.caller_org_scope()
    if not org_id:
        return jsonify({'error': 'Select a tenant before disconnecting an Amazon seller account'}), 400
    ok = disconnect(org_id)
    logger.info("[Amazon] org %s disconnected seller (ok=%s)", org_id, ok)
    return jsonify({'success': ok})
