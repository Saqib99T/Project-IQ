"""
Amazon order-lookup custom action — read-only, mirrors
ActionShopifyOrderStatus's shape (actions_shopify.py) but kept as a fully
separate intent/action pair rather than unifying with check_order_status, so
the existing Shopify rules/training data are untouched (see
docs/AMAZON_INTEGRATION_PLAN.md — provider-unified routing is separate,
future scope).

No email-retry step like Shopify's: extensions/amazon/service.py's
find_order() doesn't verify email today (deliberately deferred pending
Restricted Data Token research — Amazon's buyer-PII access model differs
from Shopify's), so building an "ask for email to retry" UX here would
falsely imply verification happens when it doesn't.

Refund/cancel are not built — Feeds API access is blocked pending Solution
Provider Portal identity verification (docs/AMAZON_INTEGRATION_PLAN.md §6).
"""
from typing import Text, List, Any, Dict

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet
from rasa_sdk.executor import CollectingDispatcher

from action_server.actions._shared import (
    check_user_login, get_iam_jwt, get_org_context,
    bind_request_id, log_bot_response, logger,
)
from common.db._amazon import get_connection as get_amazon_connection
from extensions.amazon.service import amazon_service


class ActionAmazonOrderStatus(Action):
    def name(self) -> Text:
        return "action_amazon_order_status"

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
        if not org_id or not get_amazon_connection(org_id):
            dispatcher.utter_message(response="utter_amazon_not_connected")
            log_bot_response(tracker, "utter_amazon_not_connected")
            return [SlotSet("order_number", None)]

        order = await amazon_service.find_order(org_id, order_number)
        if not order:
            error_msg = f"❌ Couldn't find an order matching **{order_number}**. Please double-check the number."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [SlotSet("order_number", None)]

        status_display = (order.get("status") or "Unknown").replace("_", " ").title()
        total_display = f"{order.get('total', '')} {order.get('currency', '')}".strip()
        created = (order.get("purchase_date") or "")[:10]
        latest_delivery = (order.get("latest_delivery_date") or "")[:10]
        channel = order.get("fulfillment_channel")
        fulfilled_by = "Amazon" if channel == "AFN" else "Seller" if channel == "MFN" else None

        message = f"**Order {order.get('order_number', order_number)}: {status_display}**\n\n"
        if total_display.strip():
            message += f"**Total:** {total_display}\n\n"
        if fulfilled_by:
            message += f"**Fulfilled by:** {fulfilled_by}\n\n"
        if latest_delivery:
            message += f"**Estimated delivery:** {latest_delivery}\n\n"
        if created:
            message += f"**Placed:** {created}\n"

        dispatcher.utter_message(
            text=message,
            json_message={"order_tracking": {
                "name":             order.get("order_number", order_number),
                "status":           status_display,
                "total":            total_display,
                "created":          created,
                "line_items":       [],
                "tracking":         [],
            }},
        )
        log_bot_response(tracker, message)
        return [SlotSet("order_number", None)]
