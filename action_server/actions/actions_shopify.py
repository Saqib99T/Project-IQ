"""
Shopify order-lookup custom action(s) — Phase 1 (read-only) of the Shopify
integration. Mirrors ActionCheckItsmStatus's shape in actions_itsm_tickets.py:
auth-gate, resolve slot(s), call the service client, format a text fallback +
a `json_message` rich payload (`order_tracking`), and clear the slot after use.

Uses the caller's IAM-verified email (get_iam_identity) rather than asking
the user to retype one — it's already authenticated, so it's a stronger
match key than a self-reported value, and it keeps this a single-turn
lookup (order_number is the only slot filled) instead of a multi-turn form.
"""
import re
from typing import Text, List, Any, Dict

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet
from rasa_sdk.executor import CollectingDispatcher

from action_server.actions._shared import (
    check_user_login, get_iam_jwt, get_iam_identity, get_org_context,
    bind_request_id, log_bot_response, logger, shopify_service,
)
from common.db._shopify import get_connection as get_shopify_connection

# Shopify's displayFulfillmentStatus values -> a simple 4-stage tracker the
# frontend renders as a stepper (ordered -> processing -> shipped -> delivered).
_FULFILLMENT_STAGE = {
    "UNFULFILLED":          "processing",
    "PARTIALLY_FULFILLED":  "processing",
    "FULFILLED":            "shipped",
    "IN_PROGRESS":          "processing",
    "ON_HOLD":              "processing",
    "SCHEDULED":            "processing",
    "DELIVERED":            "delivered",
    "REQUEST_DECLINED":     "processing",
}

_FULFILLMENT_DISPLAY = {
    "UNFULFILLED":          "Unfulfilled",
    "PARTIALLY_FULFILLED":  "Partially Fulfilled",
    "FULFILLED":            "Fulfilled",
    "IN_PROGRESS":          "In Progress",
    "ON_HOLD":              "On Hold",
    "SCHEDULED":            "Scheduled",
    "DELIVERED":            "Delivered",
    "REQUEST_DECLINED":     "Declined",
}


class ActionShopifyOrderStatus(Action):
    def name(self) -> Text:
        return "action_shopify_order_status"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        jwt = get_iam_jwt(tracker)
        if not jwt:
            if not await check_user_login(tracker, dispatcher):
                return [SlotSet("order_number", None)]
            dispatcher.utter_message(text="❌ Authentication required to check order status.")
            return [SlotSet("order_number", None)]

        order_number = tracker.get_slot("order_number")
        if not order_number:
            dispatcher.utter_message(response="utter_ask_order_number")
            return []

        org_id = get_org_context(tracker)["org_id"]
        if not org_id or not get_shopify_connection(org_id):
            dispatcher.utter_message(response="utter_shopify_not_connected")
            log_bot_response(tracker, "utter_shopify_not_connected")
            return [SlotSet("order_number", None)]

        # An explicitly-provided order_email (the retry path, after we asked
        # for it) takes priority over the caller's IAM email (the frictionless
        # first-attempt default) — lets one person place an order and a
        # different logged-in user check it later without always being asked.
        explicit_email = tracker.get_slot("order_email")
        email = explicit_email or get_iam_identity(tracker)["email"] or None

        order = await shopify_service.find_order(org_id, order_number, email)
        if not order:
            if not explicit_email:
                # First attempt failed — whether we tried the caller's IAM
                # email or had none at all — ask for the order's own email
                # instead of giving up immediately.
                return [SlotSet("order_lookup_needs_email", True)]
            error_msg = f"❌ Couldn't find an order matching **{order_number}**. Please double-check the number."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [
                SlotSet("order_number", None),
                SlotSet("order_email", None),
                SlotSet("order_lookup_needs_email", False),
            ]

        fulfillment_raw = order.get("displayFulfillmentStatus", "")
        status_display  = _FULFILLMENT_DISPLAY.get(fulfillment_raw, fulfillment_raw.title() or "Unknown")
        stage            = _FULFILLMENT_STAGE.get(fulfillment_raw, "processing")
        financial_status = (order.get("displayFinancialStatus") or "").replace("_", " ").title()
        created           = (order.get("createdAt") or "")[:10]

        money = ((order.get("totalPriceSet") or {}).get("shopMoney") or {})
        total_display = f"{money.get('amount', '')} {money.get('currencyCode', '')}".strip()

        line_items = [
            {"title": e["node"]["title"], "quantity": e["node"]["quantity"]}
            for e in (order.get("lineItems", {}).get("edges") or [])
        ]

        tracking = []
        for f in (order.get("fulfillments") or []):
            for t in (f.get("trackingInfo") or []):
                if t.get("number") or t.get("url"):
                    tracking.append({
                        "company": t.get("company") or "",
                        "number":  t.get("number") or "",
                        "url":     t.get("url") or "",
                    })

        # Text fallback (mobile / non-structured clients) — same convention as
        # ActionCheckItsmStatus's `message` string alongside its json_message.
        message = f"**Order {order.get('name', order_number)}: {status_display}**\n\n"
        if financial_status:
            message += f"**Payment:** {financial_status}\n\n"
        if total_display:
            message += f"**Total:** {total_display}\n\n"
        if line_items:
            message += "**Items:**\n\n"
            for li in line_items:
                message += f"- {li['title']} × {li['quantity']}\n"
            message += "\n"
        if tracking:
            message += "**📦 Tracking:**\n\n"
            for t in tracking:
                label = t["company"] or "Carrier"
                if t["url"]:
                    message += f"- {label}: [{t['number']}]({t['url']})\n"
                else:
                    message += f"- {label}: {t['number']}\n"
        if created:
            message += f"\n**Placed:** {created}\n"

        dispatcher.utter_message(
            text=message,
            json_message={"order_tracking": {
                "name":             order.get("name", order_number),
                "status":           status_display,
                "stage":            stage,
                "financial_status": financial_status,
                "created":          created,
                "total":            total_display,
                "line_items":       line_items,
                "tracking":         tracking,
            }},
            buttons=[
                {"title": "🔍 Check another order", "payload": "/check_order_status"},
            ]
        )
        log_bot_response(tracker, message)
        return [
            SlotSet("order_number", None),
            SlotSet("order_email", None),
            SlotSet("order_lookup_needs_email", False),
        ]


# ------------------------------------------------------------------
# Phase 2 — write actions. Each is a confirm-then-execute pair: the
# "prepare" action authenticates, looks the order up, shows exactly what
# will happen, and asks for explicit confirmation via buttons (never
# executes); only the matching "execute" action — reached via the
# corresponding rule in rules.yml, which requires an `affirm` intent
# immediately after the prepare action ran — calls into shopify_service to
# actually change anything. Unlike order lookup, these don't offer the
# ask-for-order-email fallback: if the caller's IAM email doesn't match the
# order, requesting a refund/cancellation/address-change on someone else's
# behalf is intentionally routed to "couldn't find that order" rather than
# a retry, since these are higher-risk than a read-only status check.
# ------------------------------------------------------------------

async def _authenticate_and_resolve_order(dispatcher, tracker):
    """Shared auth+lookup prologue for every Phase 2 prepare action. Returns
    (org_id, order) on success, or None (having already dispatched the
    appropriate error message) on any failure."""
    jwt = get_iam_jwt(tracker)
    if not jwt:
        if not await check_user_login(tracker, dispatcher):
            return None
        dispatcher.utter_message(text="❌ Authentication required for this action.")
        return None

    order_number = tracker.get_slot("order_number")
    if not order_number:
        dispatcher.utter_message(response="utter_ask_order_number")
        return None

    org_id = get_org_context(tracker)["org_id"]
    if not org_id or not get_shopify_connection(org_id):
        dispatcher.utter_message(response="utter_shopify_not_connected")
        return None

    email = get_iam_identity(tracker)["email"] or None
    order = await shopify_service.find_order(org_id, order_number, email)
    if not order:
        dispatcher.utter_message(
            text=f"❌ Couldn't find an order matching **{order_number}** under your account."
        )
        return None

    return org_id, order


class ActionShopifyPrepareRefund(Action):
    def name(self) -> Text:
        return "action_shopify_prepare_refund"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        resolved = await _authenticate_and_resolve_order(dispatcher, tracker)
        if not resolved:
            return [SlotSet("order_number", None)]
        org_id, order = resolved

        suggested = await shopify_service.get_suggested_refund(org_id, order["id"])
        if not suggested:
            dispatcher.utter_message(text="❌ Couldn't calculate a refund amount for this order right now.")
            return [SlotSet("order_number", None)]

        money = (suggested.get("amountSet") or {}).get("shopMoney") or {}
        try:
            refundable = float(money.get("amount") or 0)
        except (TypeError, ValueError):
            refundable = 0.0
        if refundable <= 0:
            # Zero suggestedRefund most often means the order has no captured
            # payment yet (e.g. still PENDING) — nothing to reverse, not an
            # error.
            dispatcher.utter_message(text="This order has nothing left to refund (no captured payment on it yet).")
            return [SlotSet("order_number", None)]
        amount_display = f"{money.get('amount', '')} {money.get('currencyCode', '')}".strip()

        dispatcher.utter_message(
            text=f"Refund **{amount_display}** for order **{order.get('name')}**?",
            buttons=[
                {"title": "✅ Yes, refund it", "payload": "/affirm"},
                {"title": "❌ No, cancel", "payload": "/deny"},
            ],
        )
        # order_number stays set — action_shopify_execute_refund re-resolves
        # the order fresh rather than trusting anything computed here, so a
        # stale confirmation can't apply an outdated amount.
        return []


class ActionShopifyExecuteRefund(Action):
    def name(self) -> Text:
        return "action_shopify_execute_refund"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        resolved = await _authenticate_and_resolve_order(dispatcher, tracker)
        if not resolved:
            return [SlotSet("order_number", None)]
        org_id, order = resolved

        refund = await shopify_service.refund_order(org_id, order["id"])
        if not refund:
            error_msg = "❌ The refund couldn't be processed. Please try again later or contact support."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [SlotSet("order_number", None)]

        money = (refund.get("totalRefundedSet") or {}).get("shopMoney") or {}
        amount_display = f"{money.get('amount', '')} {money.get('currencyCode', '')}".strip()
        message = f"✅ Refunded **{amount_display}** for order **{order.get('name')}**."
        dispatcher.utter_message(text=message)
        log_bot_response(tracker, message)
        return [SlotSet("order_number", None)]


class ActionShopifyPrepareCancel(Action):
    def name(self) -> Text:
        return "action_shopify_prepare_cancel"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        resolved = await _authenticate_and_resolve_order(dispatcher, tracker)
        if not resolved:
            return [SlotSet("order_number", None)]
        _org_id, order = resolved

        dispatcher.utter_message(
            text=f"Cancel order **{order.get('name')}**? This can't be undone.",
            buttons=[
                {"title": "✅ Yes, cancel it", "payload": "/affirm"},
                {"title": "❌ No, keep it", "payload": "/deny"},
            ],
        )
        return []


class ActionShopifyExecuteCancel(Action):
    def name(self) -> Text:
        return "action_shopify_execute_cancel"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        resolved = await _authenticate_and_resolve_order(dispatcher, tracker)
        if not resolved:
            return [SlotSet("order_number", None)]
        org_id, order = resolved

        job = await shopify_service.cancel_order(org_id, order["id"], reason="CUSTOMER")
        if not job:
            error_msg = "❌ The cancellation couldn't be submitted. Please try again later or contact support."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [SlotSet("order_number", None)]

        # orderCancel runs asynchronously on Shopify's side — "submitted", not
        # "cancelled", is the honest status here.
        message = f"✅ Cancellation submitted for order **{order.get('name')}**. You'll see it reflected shortly."
        dispatcher.utter_message(text=message)
        log_bot_response(tracker, message)
        return [SlotSet("order_number", None)]


def _parse_address(text: str) -> Dict[str, str]:
    """Best-effort split of a free-form "street, city, state zip, country"
    reply into Shopify's MailingAddressInput fields. Addresses vary too much
    to parse reliably in general — this is intentionally conservative and
    only sets address1/city/province/zip/country when the comma-separated
    shape is followed; the confirmation step then shows the parsed result
    back to the user so a bad parse is caught before it's ever applied,
    rather than trying to be clever here."""
    parts = [p.strip() for p in text.split(",") if p.strip()]
    result: Dict[str, str] = {}
    if len(parts) >= 1:
        result["address1"] = parts[0]
    if len(parts) >= 2:
        result["city"] = parts[1]
    if len(parts) >= 3:
        tokens = parts[2].rsplit(" ", 1)
        if len(tokens) == 2 and any(c.isdigit() for c in tokens[1]):
            result["province"], result["zip"] = tokens[0].strip(), tokens[1].strip()
        else:
            result["province"] = parts[2]
    if len(parts) >= 4:
        result["country"] = parts[3]
    return result


def _name_fallback(tracker: Tracker) -> Dict[str, str]:
    """firstName/lastName from the caller's IAM identity, used only when
    neither the parsed address text nor the order's existing shippingAddress
    has a name — Shopify's orderUpdate rejects a shippingAddress with no
    name at all (it replaces the whole address, not just the fields given),
    and a bare street/city/zip reply never includes one."""
    name = (get_iam_identity(tracker)["name"] or "").strip()
    if not name:
        return {}
    bits = name.split(None, 1)
    return {"firstName": bits[0], "lastName": bits[1] if len(bits) > 1 else bits[0]}


class ActionShopifyPrepareShippingUpdate(Action):
    def name(self) -> Text:
        return "action_shopify_prepare_shipping_update"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        resolved = await _authenticate_and_resolve_order(dispatcher, tracker)
        if not resolved:
            return [SlotSet("order_number", None), SlotSet("shipping_address_text", None)]
        _org_id, order = resolved

        raw_text = ""
        if isinstance(tracker.latest_message, dict):
            raw_text = tracker.latest_message.get("text") or ""
        address = _parse_address(raw_text)
        if not address.get("address1"):
            dispatcher.utter_message(
                text="I couldn't quite parse that address. Please provide it as: "
                     "street, city, state/province zip, country."
            )
            return [SlotSet("shipping_address_text", None)]

        preview = ", ".join(
            v for v in [address.get("address1"), address.get("city"),
                        address.get("province"), address.get("zip"), address.get("country")]
            if v
        )
        dispatcher.utter_message(
            text=f"Update the shipping address for order **{order.get('name')}** to:\n\n**{preview}**?",
            buttons=[
                {"title": "✅ Yes, update it", "payload": "/affirm"},
                {"title": "❌ No, keep current address", "payload": "/deny"},
            ],
        )
        # Store the raw text (not the parsed dict) — the execute step
        # re-parses it fresh, keeping _parse_address the single source of
        # truth instead of two copies of the same logic drifting apart.
        return [SlotSet("shipping_address_text", raw_text)]


class ActionShopifyExecuteShippingUpdate(Action):
    def name(self) -> Text:
        return "action_shopify_execute_shipping_update"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        resolved = await _authenticate_and_resolve_order(dispatcher, tracker)
        if not resolved:
            return [SlotSet("order_number", None), SlotSet("shipping_address_text", None)]
        org_id, order = resolved

        address = _parse_address(tracker.get_slot("shipping_address_text") or "")
        updated = await shopify_service.update_shipping_address(
            org_id, order["id"], address, fallback_name=_name_fallback(tracker)
        )
        if not updated:
            error_msg = "❌ The shipping address couldn't be updated. Please try again later or contact support."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [SlotSet("order_number", None), SlotSet("shipping_address_text", None)]

        message = f"✅ Shipping address updated for order **{order.get('name')}**."
        dispatcher.utter_message(text=message)
        log_bot_response(tracker, message)
        return [SlotSet("order_number", None), SlotSet("shipping_address_text", None)]
