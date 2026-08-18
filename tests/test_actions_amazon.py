"""
Tests for action_server/actions/actions_amazon.py's ActionAmazonOrderStatus
(docs/AMAZON_INTEGRATION_PLAN.md buildable-slice: bot wiring for read-only
Amazon order status, kept as a separate intent/action from the Shopify flow).

Uses the shared conftest fixtures (make_tracker, dispatcher). Rasa actions'
run() is async, but this repo's suite has no pytest-asyncio installed — every
test here is a plain `def` that drives the coroutine via asyncio.run(),
matching tests/test_actions_kb.py's convention.
"""
import asyncio
from unittest.mock import AsyncMock, patch


def _tracker_with_message(make_tracker, text, **kwargs):
    t = make_tracker(**kwargs)
    t.latest_message["text"] = text
    return t


def _order(order_number="123-4567890-1234567", status="Shipped", total="49.99",
           currency="USD", purchase_date="2026-08-01T00:00:00Z",
           latest_delivery_date="2026-08-10T00:00:00Z", fulfillment_channel="AFN"):
    return {
        "order_number": order_number, "status": status, "total": total,
        "currency": currency, "purchase_date": purchase_date,
        "latest_delivery_date": latest_delivery_date,
        "fulfillment_channel": fulfillment_channel,
    }


def _slots(order_number="123-4567890-1234567"):
    return {"iam_org_id": "org-1", "order_number": order_number}


def test_unauthenticated_and_login_prompt_fails_resets_slot(make_tracker, dispatcher):
    from action_server.actions.actions_amazon import ActionAmazonOrderStatus

    tracker = _tracker_with_message(make_tracker, "where is my amazon order", slots=_slots())
    action = ActionAmazonOrderStatus()

    with patch("action_server.actions.actions_amazon.check_user_login", new=AsyncMock(return_value=False)):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert not dispatcher.messages
    assert [e for e in events if e.get("event") == "slot"] == [{"event": "slot", "timestamp": None, "name": "order_number", "value": None}]


def test_unauthenticated_but_login_check_passes_still_requires_iam_token(make_tracker, dispatcher):
    """check_user_login() can pass for legacy ITSM sessions, but this action needs
    a real IAM JWT to call amazon_service — mirrors actions_amazon.py's own logic."""
    from action_server.actions.actions_amazon import ActionAmazonOrderStatus

    tracker = _tracker_with_message(make_tracker, "where is my amazon order", slots=_slots())
    action = ActionAmazonOrderStatus()

    with patch("action_server.actions.actions_amazon.check_user_login", new=AsyncMock(return_value=True)):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert "Authentication required" in dispatcher.messages[0]["text"]
    assert [e for e in events if e.get("event") == "slot"] == [{"event": "slot", "timestamp": None, "name": "order_number", "value": None}]


def test_missing_order_number_asks_for_it(make_tracker, dispatcher):
    from action_server.actions.actions_amazon import ActionAmazonOrderStatus

    tracker = _tracker_with_message(
        make_tracker, "where is my amazon order",
        metadata={"iam_token": "jwt-1"}, slots={"iam_org_id": "org-1"},
    )
    action = ActionAmazonOrderStatus()

    events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert dispatcher.messages[0]["response"] == "utter_ask_order_number"
    assert events == []


def test_no_amazon_connection_for_org(make_tracker, dispatcher):
    from action_server.actions.actions_amazon import ActionAmazonOrderStatus

    tracker = _tracker_with_message(
        make_tracker, "where is my amazon order",
        metadata={"iam_token": "jwt-1"}, slots=_slots(),
    )
    action = ActionAmazonOrderStatus()

    with patch("action_server.actions.actions_amazon.get_amazon_connection", return_value=None):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert dispatcher.messages[0]["response"] == "utter_amazon_not_connected"
    assert [e for e in events if e.get("event") == "slot"] == [{"event": "slot", "timestamp": None, "name": "order_number", "value": None}]


def test_order_not_found(make_tracker, dispatcher):
    from action_server.actions.actions_amazon import ActionAmazonOrderStatus

    tracker = _tracker_with_message(
        make_tracker, "where is my amazon order",
        metadata={"iam_token": "jwt-1"}, slots=_slots(order_number="999-9999999-9999999"),
    )
    action = ActionAmazonOrderStatus()

    with patch("action_server.actions.actions_amazon.get_amazon_connection", return_value={"seller_id": "S1"}), \
         patch("action_server.actions.actions_amazon.amazon_service.find_order", new=AsyncMock(return_value=None)):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert "Couldn't find an order" in dispatcher.messages[0]["text"]
    assert "999-9999999-9999999" in dispatcher.messages[0]["text"]
    assert [e for e in events if e.get("event") == "slot"] == [{"event": "slot", "timestamp": None, "name": "order_number", "value": None}]


def test_order_found_reports_status_and_resets_slot(make_tracker, dispatcher):
    from action_server.actions.actions_amazon import ActionAmazonOrderStatus

    tracker = _tracker_with_message(
        make_tracker, "where is my amazon order",
        metadata={"iam_token": "jwt-1"}, slots=_slots(),
    )
    action = ActionAmazonOrderStatus()

    with patch("action_server.actions.actions_amazon.get_amazon_connection", return_value={"seller_id": "S1"}), \
         patch("action_server.actions.actions_amazon.amazon_service.find_order",
               new=AsyncMock(return_value=_order())):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    msg = dispatcher.messages[0]
    assert "123-4567890-1234567" in msg["text"]
    assert "Shipped" in msg["text"]
    assert "49.99 USD" in msg["text"]
    assert "Fulfilled by:** Amazon" in msg["text"]
    assert msg["json_message"]["order_tracking"]["name"] == "123-4567890-1234567"
    assert msg["json_message"]["order_tracking"]["status"] == "Shipped"
    assert [e for e in events if e.get("event") == "slot"] == [{"event": "slot", "timestamp": None, "name": "order_number", "value": None}]
