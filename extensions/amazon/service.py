"""
Amazon Selling Partner API (SP-API) client — lives inside the extension
itself (not a core action_server/web file), same rationale as
extensions/shopify/service.py: the whole Amazon integration's business logic
stays self-contained in this folder.

Differs from Shopify's client in ways that matter (see
docs/AMAZON_INTEGRATION_PLAN.md §1-§2 for the full research):

1. Auth is plain LWA (Login with Amazon) bearer tokens — no AWS SigV4/IAM
   signing needed (dropped SP-API-wide October 2023, confirmed live against
   the sandbox during this build). Just `Authorization`-equivalent header
   `x-amz-access-token` on every call.
2. Unlike Shopify, the refresh_token does NOT rotate on each refresh — the
   same refresh_token stays valid across every access_token refresh (only
   revoked by explicit seller action), so there's nothing to persist back
   except the new access_token.
3. Orders API v0 is read-only for our purposes (getOrders/getOrder) — no
   direct cancel/refund endpoint exists. Write actions go through the
   asynchronous Feeds API, which is NOT implemented yet — blocked on the
   Solution Provider Portal's Feeds role/permission grant (Phase 0b,
   docs/AMAZON_INTEGRATION_PLAN.md §6). This service only does order lookup.

Never log access_token/refresh_token values.
"""
import logging
import socket
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import aiohttp

from common.config_manager import get_amazon_config
from common.db._amazon import get_connection, update_access_token

logger = logging.getLogger(__name__)

_REFRESH_SKEW = timedelta(minutes=5)

_SANDBOX_BASE_URL = "https://sandbox.sellingpartnerapi-na.amazon.com"
_PRODUCTION_BASE_URL = "https://sellingpartnerapi-na.amazon.com"
_LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"


class AmazonService:
    """Async SP-API client; the tenant's seller connection/tokens are
    resolved per-call from amazon_connections, so one instance serves every
    tenant (same pattern as ShopifyService)."""

    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None

    def _base_url(self) -> str:
        return _SANDBOX_BASE_URL if get_amazon_config()["environment"] == "sandbox" else _PRODUCTION_BASE_URL

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(
                family=socket.AF_INET,
                limit=20,
                ttl_dns_cache=300,
                keepalive_timeout=30,
            )
            self._session = aiohttp.ClientSession(connector=connector)
        return self._session

    async def _refresh_token(self, org_id: str, conn: dict) -> Optional[dict]:
        """Exchange the stored refresh_token for a new access_token. Unlike
        Shopify, the refresh_token itself is NOT rotated — only the new
        access_token needs persisting."""
        cfg = get_amazon_config()
        try:
            session = await self._get_session()
            timeout = aiohttp.ClientTimeout(total=10)
            async with session.post(_LWA_TOKEN_URL, data={
                "grant_type": "refresh_token",
                "refresh_token": conn["refresh_token"],
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
            }, timeout=timeout) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    logger.warning("[Amazon] token refresh for org %s -> %d: %s", org_id, resp.status, text[:200])
                    return None
                payload = await resp.json()
        except Exception as exc:
            logger.error("[Amazon] token refresh for org %s failed: %r", org_id, exc, exc_info=True)
            return None

        new_access_token = payload.get("access_token")
        if not new_access_token:
            logger.warning("[Amazon] token refresh for org %s returned no access_token", org_id)
            return None

        update_access_token(org_id, new_access_token, payload.get("expires_in"))
        conn = dict(conn)
        conn["access_token"] = new_access_token
        conn["access_token_expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=payload.get("expires_in") or 0)
        return conn

    async def _ensure_fresh_token(self, org_id: str, conn: dict) -> Optional[dict]:
        expires_at = conn.get("access_token_expires_at")
        if expires_at and expires_at - datetime.now(timezone.utc) > _REFRESH_SKEW:
            return conn
        return await self._refresh_token(org_id, conn)

    async def _get(self, org_id: str, path: str, params: Optional[Dict[str, Any]] = None) -> Optional[dict]:
        conn = get_connection(org_id)
        if not conn:
            logger.warning("[Amazon] org %s has no connected seller account", org_id)
            return None
        conn = await self._ensure_fresh_token(org_id, conn)
        if not conn:
            return None

        session = await self._get_session()
        timeout = aiohttp.ClientTimeout(total=15)
        url = f"{self._base_url()}{path}"
        try:
            async with session.get(
                url, headers={"x-amz-access-token": conn["access_token"]},
                params=params or {}, timeout=timeout,
            ) as resp:
                body = await resp.json()
                if resp.status != 200:
                    logger.warning("[Amazon] GET %s -> %d: %s", path, resp.status, str(body)[:300])
                    return None
                return body
        except Exception as exc:
            logger.error("[Amazon] GET %s failed: %r", path, exc, exc_info=True)
            return None

    async def find_order(self, org_id: str, order_number: str, email: Optional[str] = None) -> Optional[Dict]:
        """Look up one order by Amazon Order ID (format nnn-nnnnnnn-nnnnnnn).
        Amazon's getOrders doesn't support a free-text order-number search
        the way Shopify's GraphQL query DSL does — getOrder by exact
        AmazonOrderId is the reliable path, so this expects order_number to
        already be that ID (validated live against the sandbox during this
        build). Email-match filtering isn't applied here yet — buyer PII
        access (getOrderBuyerInfo) needs its own Restricted Data Token
        research pass (docs/AMAZON_INTEGRATION_PLAN.md §3, flagged
        unresearched) before an email-based lookup can be built safely."""
        conn = get_connection(org_id)
        if not conn:
            return None
        body = await self._get(org_id, f"/orders/v0/orders/{order_number}")
        if not body:
            return None
        order = body.get("payload")
        if not order:
            return None
        return {
            "order_number": order.get("AmazonOrderId"),
            "status": order.get("OrderStatus"),
            "fulfillment_channel": order.get("FulfillmentChannel"),  # 'AFN' = FBA, 'MFN' = FBM
            "total": order.get("OrderTotal", {}).get("Amount"),
            "currency": order.get("OrderTotal", {}).get("CurrencyCode"),
            "purchase_date": order.get("PurchaseDate"),
            "earliest_ship_date": order.get("EarliestShipDate"),
            "latest_delivery_date": order.get("LatestDeliveryDate"),
        }


amazon_service = AmazonService()
