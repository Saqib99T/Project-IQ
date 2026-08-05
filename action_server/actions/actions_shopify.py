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

        email = get_iam_identity(tracker)["email"] or None

        order = await shopify_service.find_order(org_id, order_number, email)
        if not order:
            error_msg = f"❌ Couldn't find an order matching **{order_number}**. Please double-check the number."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [SlotSet("order_number", None)]

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
        return [SlotSet("order_number", None)]
