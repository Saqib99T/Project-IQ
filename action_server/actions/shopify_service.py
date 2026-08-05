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
from typing import Any, Dict, Optional

import aiohttp

from common.config_manager import get_shopify_config
from common.db._shopify import get_connection

logger = logging.getLogger(__name__)


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

    async def _graphql(
        self, org_id: str, query: str, variables: Optional[dict] = None
    ) -> Optional[Dict[str, Any]]:
        """POST a GraphQL query/mutation to the tenant's connected shop.

        Returns the parsed `data` object on success; None if the tenant has no
        active connection, the request fails, Shopify returns GraphQL-level
        errors, or the shop is rate-limited (429) — callers treat all of these
        as "couldn't complete right now" rather than raise, same convention as
        ITSMService._request.
        """
        conn = get_connection(org_id)
        if not conn:
            logger.warning("[Shopify] org %s has no active Shopify connection", org_id)
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
        '#1001') and, when given, the customer's email — the same two fields
        order_lookup_form collects. Mirrors how ITSMService.get_ticket()
        resolves a user-typed ref to a real record."""
        name = order_number if order_number.startswith("#") else f"#{order_number}"
        search_terms = [f"name:{name}"]
        if email:
            search_terms.append(f"email:{email}")
        search_query = " ".join(search_terms)

        gql = """
        query FindOrder($searchQuery: String!) {
          orders(first: 1, query: $searchQuery) {
            edges {
              node {
                id
                name
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
        data = await self._graphql(org_id, gql, {"searchQuery": search_query})
        if not data:
            return None
        edges = (data.get("orders") or {}).get("edges") or []
        return edges[0]["node"] if edges else None


# Module-level singleton — mirrors action_server/actions/_shared.py's
# `itsm_service = get_itsm_service()` pattern.
shopify_service = ShopifyService()
