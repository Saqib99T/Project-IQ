"""
Shopify GraphQL Admin API client.

Mirrors itsm_service.py's shape (one shared aiohttp session, a generic
request wrapper, domain methods) but differs in two ways that matter:

1. Shopify's Admin API is GraphQL over a single per-shop endpoint, not REST
   resource paths — every call is a POST to
   https://{shop_domain}/admin/api/{version}/graphql.json.
2. Auth is a per-TENANT offline access token (looked up from
   shopify_connections via org_id), not a forwarded user JWT — there is no
   "user" on Shopify's side, only the shop the tenant connected.

Never log the access_token value.
"""
import logging
import socket
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import aiohttp

from common.config_manager import get_shopify_config
from common.db._shopify import get_connection, update_tokens

logger = logging.getLogger(__name__)

# Refresh this far ahead of actual expiry to absorb request latency + clock
# skew between this process and Shopify's servers — access tokens only live
# ~1 hour, so cutting it close risks a mid-call 401 under load.
_REFRESH_SKEW = timedelta(minutes=5)


class ShopifyService:
    """Async GraphQL Admin API client; the tenant's shop/token is resolved
    per-call from shopify_connections, so one instance serves every tenant."""

    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None
        self._api_version = get_shopify_config()["api_version"]

    async def _get_session(self) -> aiohttp.ClientSession:
        """Reuse one keep-alive session across calls — same rationale as
        ITSMService._get_session (skip TCP setup per request)."""
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
        """Exchange the stored refresh_token for a new access_token (and a
        ROTATED refresh_token — Shopify invalidates the old one on every
        refresh, so both must be persisted together or the connection becomes
        unrecoverable). Returns the updated connection dict, or None if the
        refresh itself failed (refresh_token expired/revoked — the tenant
        must reconnect)."""
        if not conn.get("refresh_token"):
            logger.warning("[Shopify] org %s has no refresh_token — must reconnect", org_id)
            return None
        cfg = get_shopify_config()
        url = f"https://{conn['shop_domain']}/admin/oauth/access_token"
        try:
            session = await self._get_session()
            timeout = aiohttp.ClientTimeout(total=10)
            async with session.post(url, json={
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "grant_type": "refresh_token",
                "refresh_token": conn["refresh_token"],
            }, timeout=timeout) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    logger.warning("[Shopify] token refresh for org %s -> %d: %s", org_id, resp.status, text[:200])
                    return None
                payload = await resp.json()
        except Exception as exc:
            logger.error("[Shopify] token refresh for org %s failed: %r", org_id, exc, exc_info=True)
            return None

        new_access_token = payload.get("access_token")
        if not new_access_token:
            logger.warning("[Shopify] token refresh for org %s returned no access_token", org_id)
            return None

        update_tokens(
            org_id, new_access_token, payload.get("refresh_token"),
            payload.get("expires_in"), payload.get("refresh_token_expires_in"),
        )
        conn = dict(conn)
        conn["access_token"] = new_access_token
        conn["access_token_expires_at"] = datetime.now(timezone.utc) + timedelta(seconds=payload.get("expires_in") or 0)
        return conn

    async def _ensure_fresh_token(self, org_id: str, conn: dict) -> Optional[dict]:
        """Return `conn`, refreshed first if its access token is expired or
        expiring within _REFRESH_SKEW. Connections created before the
        expiring-token migration have no access_token_expires_at at all —
        treated as needing a refresh immediately (they can't be used as-is,
        since Shopify rejects the non-expiring tokens they hold)."""
        expires_at = conn.get("access_token_expires_at")
        if expires_at and expires_at - datetime.now(timezone.utc) > _REFRESH_SKEW:
            return conn
        return await self._refresh_token(org_id, conn)

    async def _graphql(
        self, org_id: str, query: str, variables: Optional[dict] = None
    ) -> Optional[Dict[str, Any]]:
        """POST a GraphQL query/mutation to the tenant's connected shop.

        Returns the parsed `data` object on success; None if the tenant has no
        active connection (or its refresh_token has expired/been revoked and
        reconnecting is required), the request fails, Shopify returns
        GraphQL-level errors, or the shop is rate-limited (429) — callers
        treat all of these as "couldn't complete right now" rather than
        raise, same convention as ITSMService._request.
        """
        conn = get_connection(org_id)
        if not conn:
            logger.warning("[Shopify] org %s has no active Shopify connection", org_id)
            return None

        conn = await self._ensure_fresh_token(org_id, conn)
        if not conn:
            logger.warning("[Shopify] org %s's Shopify connection could not be refreshed — reconnect required", org_id)
            return None

        url = f"https://{conn['shop_domain']}/admin/api/{self._api_version}/graphql.json"
        headers = {
            "X-Shopify-Access-Token": conn["access_token"],
            "Content-Type": "application/json",
        }
        body = {"query": query, "variables": variables or {}}
        try:
            session = await self._get_session()
            timeout = aiohttp.ClientTimeout(total=15)
            async with session.post(url, json=body, headers=headers, timeout=timeout) as resp:
                if resp.status == 429:
                    logger.warning("[Shopify] rate-limited (429) for org %s", org_id)
                    return None
                if resp.status != 200:
                    text = await resp.text()
                    logger.warning("[Shopify] %s -> %d: %s", url, resp.status, text[:200])
                    return None
                payload = await resp.json()
                # Surface the cost-based throttle budget so future call sites
                # can back off proactively instead of waiting for a 429 — see
                # docs/SHOPIFY_INTEGRATION_PLAN.md's note on cost-based rate
                # limiting. Logged only for now; no throttling logic yet.
                cost = (payload.get("extensions") or {}).get("cost")
                if cost:
                    throttle = cost.get("throttleStatus", {})
                    logger.debug(
                        "[Shopify] query cost=%s budget=%s/%s org=%s",
                        cost.get("actualQueryCost"),
                        throttle.get("currentlyAvailable"),
                        throttle.get("maximumAvailable"),
                        org_id,
                    )
                if payload.get("errors"):
                    logger.warning("[Shopify] GraphQL errors for org %s: %s", org_id, payload["errors"])
                    return None
                return payload.get("data")
        except Exception as exc:
            logger.error("[Shopify] request to %s failed: %r", url, exc, exc_info=True)
            return None

    # ------------------------------------------------------------------
    # Orders
    # ------------------------------------------------------------------

    async def find_order(
        self, org_id: str, order_number: str, email: Optional[str] = None
    ) -> Optional[dict]:
        """Look up one order by its Shopify order name (e.g. '1001' or
        '#1001'), then verify the caller's email against the order's own
        email HERE rather than folding it into the Shopify search query.

        Baking `email:X` into the search string makes it an all-or-nothing
        AND filter: a null order email (e.g. some dev-store test orders,
        possibly some real guest-checkout edge cases) or any formatting
        mismatch silently returns zero results, indistinguishable from "no
        such order" — which is both hard to debug and, if this method is
        ever reused for something other than a strict security gate, too
        blunt. Comparing in Python lets us reason about (and log) the two
        failure modes separately, at the cost of one extra round trip.

        Returns None if no order matches the number, OR the order exists but
        its email doesn't match `email` (when `email` is given) — both cases
        deliberately produce the same "not found" outcome to the caller so a
        wrong email never confirms an order's existence.
        """
        name = order_number if order_number.startswith("#") else f"#{order_number}"

        gql = """
        query FindOrder($searchQuery: String!) {
          orders(first: 1, query: $searchQuery) {
            edges {
              node {
                id
                name
                email
                customer { email }
                displayFulfillmentStatus
                displayFinancialStatus
                createdAt
                totalPriceSet { shopMoney { amount currencyCode } }
                fulfillments(first: 5) {
                  trackingInfo { company number url }
                  status
                }
                lineItems(first: 10) {
                  edges { node { title quantity } }
                }
              }
            }
          }
        }
        """
        data = await self._graphql(org_id, gql, {"searchQuery": f"name:{name}"})
        if not data:
            return None
        edges = (data.get("orders") or {}).get("edges") or []
        if not edges:
            return None
        order = edges[0]["node"]

        if email:
            # Prefer the linked Customer's email — it's the durable identity
            # link. Order.email is only the checkout-time contact address and
            # can be null (e.g. a customer assigned to the order after the
            # fact, rather than entered at checkout).
            customer_email = ((order.get("customer") or {}).get("email") or "").strip().lower()
            order_email = customer_email or (order.get("email") or "").strip().lower()
            if order_email != email.strip().lower():
                logger.info(
                    "[Shopify] org %s: order %s found but caller email doesn't match order/customer email — treating as not found",
                    org_id, name,
                )
                return None

        return order


# Module-level singleton — mirrors action_server/actions/_shared.py's
# `itsm_service = get_itsm_service()` pattern.
shopify_service = ShopifyService()
