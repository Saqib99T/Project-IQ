"""
Shopify GraphQL Admin API client — lives inside the extension itself (not a
core action_server/web file) so extensions/shopify/ is self-contained: the
whole Shopify integration's business logic is here, not spread across the
app and merely referenced from this folder.

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
import uuid as _uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import aiohttp

from common.config_manager import get_shopify_config
from common.db._shopify import get_connection, update_tokens
# Reused as-is: a plain fixed-window counter with no Flask dependency in
# either symbol, despite living under web/api (established cross-import
# pattern in this codebase — e.g. ActionSearchKbBeforeTicket imports
# web.api.kb_cache_manager). Avoids a second copy of the same counter logic
# for a limiter that, unlike the Flask one, must be keyed by org_id rather
# than client IP (these calls never pass through a Flask request at all —
# they're the action server calling Shopify directly).
from web.api.rate_limiting import MemoryStore, _parse_limit

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
        self._write_limiter = MemoryStore()

    def _check_write_rate_limit(self, org_id: str) -> bool:
        """True if this org may perform another write action (refund/cancel/
        address-update) right now. Read-only lookups don't go through this —
        Shopify's own cost-based throttle already governs those."""
        max_n, window = _parse_limit(get_shopify_config()["write_rate_limit"])
        allowed, retry_after = self._write_limiter.hit(f"shopify_write:{org_id}", max_n, window)
        if not allowed:
            logger.warning(
                "[Shopify] org %s hit the write-action rate limit (retry in %ss)",
                org_id, retry_after,
            )
        return allowed

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

        Returns the parsed `data` object if Shopify returned one, even
        alongside GraphQL-level `errors` — GraphQL's response shape is
        explicitly partial-success-capable (e.g. one field in the selection
        set can error out — a Protected Customer Data field the app isn't
        approved for — while the rest of the query, including a mutation's
        own success/userErrors, resolves fine). Discarding `data` on ANY
        error would misreport a successful write as a total failure just
        because an unrelated field in the response couldn't be read back.
        Only returns None when there's no `data` at all: no active
        connection (or refresh_token expired/revoked — reconnect required),
        the HTTP request itself failed, or the shop is rate-limited (429).
        Errors are always logged either way so a real problem isn't silent.
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
                data = payload.get("data")
                return data if data is not None else None
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

    # ------------------------------------------------------------------
    # Write actions (Phase 2) — each is confirm-then-execute at the Rasa
    # layer; this client only executes, it doesn't gate on confirmation.
    # ------------------------------------------------------------------

    async def get_suggested_refund(self, org_id: str, order_gid: str) -> Optional[dict]:
        """Shopify's own calculated 'refund everything remaining' shape for
        this order — feed this straight into refund_order() rather than
        computing line-item/shipping amounts ourselves, to avoid under- or
        over-refunding. Returns None if the order can't be found/queried.

        suggestedRefund's arguments all default to computing NOTHING (empty
        refundLineItems, $0 amountSet) unless told what to suggest for —
        confirmed live: calling it with zero arguments on a $949.95 paid
        order returned a $0 suggestion despite refundableQuantity being
        non-zero. `suggestFullRefund: true` is what actually asks it to
        compute a full-order suggestion; it defaults to false.
        """
        gql = """
        query SuggestedRefund($orderId: ID!) {
          order(id: $orderId) {
            suggestedRefund(suggestFullRefund: true) {
              amountSet { shopMoney { amount currencyCode } }
              refundLineItems {
                lineItem { id title }
                quantity
                restockType
              }
              shipping {
                amountSet { shopMoney { amount currencyCode } }
              }
              suggestedTransactions {
                parentTransaction { id }
                amountSet { shopMoney { amount currencyCode } }
                kind
                gateway
              }
            }
          }
        }
        """
        data = await self._graphql(org_id, gql, {"orderId": order_gid})
        if not data:
            return None
        return (data.get("order") or {}).get("suggestedRefund")

    async def refund_order(
        self, org_id: str, order_gid: str, note: Optional[str] = None
    ) -> Optional[dict]:
        """Issue a full refund for the order using Shopify's own
        suggested-refund calculation (queried fresh here, not trusted from an
        earlier turn's confirmation step, so the amount can't go stale
        between "confirm" and "execute"). Returns the created Refund dict, or
        None if the order can't be found or Shopify rejects the refund.

        refundCreate has required idempotency (as of API 2026-04) via the
        @idempotent directive — a fresh UUID per call, generated here rather
        than threaded through from the caller, since each call to this
        method represents exactly one refund attempt.
        """
        if not self._check_write_rate_limit(org_id):
            return None

        suggested = await self.get_suggested_refund(org_id, order_gid)
        if not suggested:
            return None

        # Always NO_RESTOCK, regardless of what suggestedRefund recommends
        # (usually CANCEL) — a restock TYPE that actually restocks requires a
        # locationId we have no sensible way to choose from a chat flow, and
        # confirmed live: omitting it fails with "You need to set a location
        # to restock items". Inventory restocking is a merchant inventory
        # decision, not something a support-bot refund should decide for
        # them — they can restock manually in Shopify admin if wanted.
        refund_line_items = [
            {
                "lineItemId": rli["lineItem"]["id"],
                "quantity": rli["quantity"],
                "restockType": "NO_RESTOCK",
            }
            for rli in (suggested.get("refundLineItems") or [])
        ]
        # OrderTransactionInput requires orderId + gateway on EACH transaction,
        # not just parentId/amount/kind — confirmed live via
        # "Expected value to not be null" on both when they were omitted.
        # gateway must match the ORIGINAL transaction's own gateway (e.g.
        # "manual", "bogus") — suggestedTransactions carries it precisely so
        # we don't need a second lookup.
        transactions = [
            {
                "parentId": st["parentTransaction"]["id"],
                "orderId": order_gid,
                "gateway": st.get("gateway"),
                "amount": (st.get("amountSet") or {}).get("shopMoney", {}).get("amount"),
                # suggestedTransactions reports kind="SUGGESTED_REFUND", a
                # preview-only marker — confirmed live it's rejected by the
                # mutation ("Kind suggested_refund is not a valid
                # transaction"). The real OrderTransactionKind for an actual
                # refund is REFUND.
                "kind": "REFUND",
            }
            for st in (suggested.get("suggestedTransactions") or [])
            if st.get("parentTransaction") and st.get("gateway")
            and (st.get("amountSet") or {}).get("shopMoney", {}).get("amount")
        ]

        refund_input: Dict[str, Any] = {
            "orderId": order_gid,
            "refundLineItems": refund_line_items,
            "transactions": transactions,
            "notify": True,
        }
        if note:
            refund_input["note"] = note
        shipping_amount = ((suggested.get("shipping") or {}).get("amountSet") or {}).get("shopMoney", {}).get("amount")
        if shipping_amount and float(shipping_amount) > 0:
            refund_input["shipping"] = {"fullRefund": True}

        gql = """
        mutation RefundOrder($input: RefundInput!, $idempotencyKey: String!) {
          refundCreate(input: $input) @idempotent(key: $idempotencyKey) {
            refund {
              id
              totalRefundedSet { shopMoney { amount currencyCode } }
            }
            userErrors { field message }
          }
        }
        """
        data = await self._graphql(org_id, gql, {
            "input": refund_input,
            "idempotencyKey": str(_uuid.uuid4()),
        })
        if not data:
            return None
        payload = data.get("refundCreate") or {}
        if payload.get("userErrors"):
            logger.warning("[Shopify] refundCreate userErrors for org %s: %s", org_id, payload["userErrors"])
            return None
        return payload.get("refund")

    async def cancel_order(
        self, org_id: str, order_gid: str, reason: str = "CUSTOMER",
        restock: bool = True, notify_customer: bool = True,
    ) -> Optional[dict]:
        """Cancel the order. orderCancel runs ASYNCHRONOUSLY on Shopify's
        side (returns a Job, not an immediate final state) — callers should
        tell the user the cancellation was *submitted*, not that it's
        definitely complete.

        reason must be one of Shopify's OrderCancelReason enum values:
        CUSTOMER, FRAUD, INVENTORY, DECLINED, STAFF_ERROR, OTHER.
        """
        if not self._check_write_rate_limit(org_id):
            return None

        gql = """
        mutation CancelOrder($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!, $notifyCustomer: Boolean) {
          orderCancel(orderId: $orderId, reason: $reason, restock: $restock, notifyCustomer: $notifyCustomer) {
            job { id done }
            orderCancelUserErrors { field message code }
          }
        }
        """
        data = await self._graphql(org_id, gql, {
            "orderId": order_gid,
            "reason": reason,
            "restock": restock,
            "notifyCustomer": notify_customer,
        })
        if not data:
            return None
        payload = data.get("orderCancel") or {}
        if payload.get("orderCancelUserErrors"):
            logger.warning("[Shopify] orderCancel userErrors for org %s: %s", org_id, payload["orderCancelUserErrors"])
            return None
        return payload.get("job")

    async def _get_current_shipping_address(self, org_id: str, order_gid: str) -> Optional[Dict[str, str]]:
        """Reads the full MailingAddressInput field set. Address, Name, and
        Phone are all approved under Protected Customer Data as of this
        writing — if that ever changes, _graphql()'s partial-success
        handling means a field that stops being approved would just come
        back null/errored for that one field rather than failing the whole
        call."""
        gql = """
        query CurrentShippingAddress($orderId: ID!) {
          order(id: $orderId) {
            shippingAddress { address1 address2 city province zip country firstName lastName phone }
          }
        }
        """
        data = await self._graphql(org_id, gql, {"orderId": order_gid})
        if not data:
            return None
        return (data.get("order") or {}).get("shippingAddress") or {}

    async def update_shipping_address(
        self, org_id: str, order_gid: str, address: Dict[str, str],
        fallback_name: Dict[str, str] = None,
    ) -> Optional[dict]:
        """Update the order's shipping address. `address` keys map onto
        Shopify's MailingAddressInput (address1, address2, city, province,
        zip, country, firstName, lastName, phone) — pass only the fields you
        have.

        Shopify treats shippingAddress as a FULL REPLACE on orderUpdate, not
        a per-field patch — submitting only address1/city/etc without a name
        fails with "Enter a last name" even though the merchant never asked
        to change the name. So this fetches the order's CURRENT shipping
        address first and merges the caller's fields on top of it, rather
        than requiring the caller to always supply every field.

        `fallback_name` (firstName/lastName) is applied ONLY if neither the
        order's current address nor `address` itself has a name — e.g. a
        test/edge-case order with no shipping address on file at all. It's
        never used to overwrite a name that's already there.
        """
        if not self._check_write_rate_limit(org_id):
            return None

        current = await self._get_current_shipping_address(org_id, order_gid) or {}
        merged = {**current, **{k: v for k, v in address.items() if v}}
        if fallback_name and not merged.get("firstName") and not merged.get("lastName"):
            merged = {**fallback_name, **merged}
        # Shopify's MailingAddressInput doesn't accept an `id`/`__typename`
        # echoed back from the query — only send known writable fields.
        merged = {k: v for k, v in merged.items()
                  if k in ("address1", "address2", "city", "province", "zip",
                           "country", "firstName", "lastName", "phone") and v}

        # Reads the full address back so the caller gets Shopify's own
        # authoritative/normalized values (e.g. "IL"/"US" submitted become
        # "Illinois"/"United States" in what Shopify actually stored) rather
        # than just echoing back what we sent. Falls back to `merged` if the
        # read-back ever comes back empty (e.g. a field's approval is
        # revoked, or this runs under a different app registration that
        # hasn't been granted the same Protected Customer Data fields) — the
        # write itself doesn't depend on being able to read the result.
        gql = """
        mutation UpdateShippingAddress($input: OrderInput!) {
          orderUpdate(input: $input) {
            order {
              id
              shippingAddress { address1 address2 city province zip country firstName lastName phone }
            }
            userErrors { field message }
          }
        }
        """
        data = await self._graphql(org_id, gql, {
            "input": {"id": order_gid, "shippingAddress": merged},
        })
        if not data:
            return None
        payload = data.get("orderUpdate") or {}
        if payload.get("userErrors"):
            logger.warning("[Shopify] orderUpdate userErrors for org %s: %s", org_id, payload["userErrors"])
            return None
        return (payload.get("order") or {}).get("shippingAddress") or merged


# Module-level singleton — mirrors action_server/actions/_shared.py's
# `itsm_service = get_itsm_service()` pattern.
shopify_service = ShopifyService()
