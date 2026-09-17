"""
Tests for action_server/actions/actions_itsm_tickets.py's
ActionPresentTicketForm (2026-09-17 fix) — the WhatsApp ticket-creation
dead end. utter_ticket_form's `custom: {ticket_form: true}` payload has no
text/buttons at the top level, so non-widget channels received nothing.
This action swaps in active_loop=ticket_form (already fully built, just
never activated) for WhatsApp, while leaving every other channel's custom
payload byte-for-byte unchanged.

Uses the shared conftest fixtures (make_tracker, dispatcher) — see
tests/test_actions_kb.py's header for why these are plain `def` tests
driving the coroutine via asyncio.run() rather than pytest-asyncio.
"""
import asyncio

from action_server.actions.actions_itsm_tickets import ActionPresentTicketForm


def test_whatsapp_channel_activates_ticket_form_loop(make_tracker, dispatcher):
    tracker = make_tracker(metadata={"channel": "whatsapp", "wa_id": "923214421327"})
    action = ActionPresentTicketForm()

    events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert len(events) == 1
    assert events[0]["event"] == "active_loop"
    assert events[0]["name"] == "ticket_form"
    assert dispatcher.messages == []  # no text here -- Rasa asks utter_ask_ticket_title itself


def test_whatsapp_group_channel_also_activates_ticket_form_loop(make_tracker, dispatcher):
    """whatsapp_group shares the same dead-end -- gate on a prefix match,
    not an exact string, so group mode isn't silently missed later."""
    tracker = make_tracker(metadata={"channel": "whatsapp_group", "group_id": "grp-1"})
    action = ActionPresentTicketForm()

    events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert len(events) == 1
    assert events[0]["event"] == "active_loop"
    assert events[0]["name"] == "ticket_form"


def test_widget_channel_gets_the_original_custom_payload_unchanged(make_tracker, dispatcher):
    """Regression guard: the web widget's rich ticket-form UI must keep
    getting exactly what utter_ticket_form always sent -- this action must
    not change widget behavior at all."""
    tracker = make_tracker(metadata={"channel": "web"})
    action = ActionPresentTicketForm()

    events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert events == []
    assert dispatcher.messages == [
        {"custom": {"ticket_form": True, "text": "Please fill out the ticket details below:"}}
    ]


def test_missing_channel_metadata_defaults_to_the_widget_payload(make_tracker, dispatcher):
    """No metadata at all (e.g. older clients, or a test harness) must
    still fall through to the original custom-payload behavior, not
    accidentally start the conversational form."""
    tracker = make_tracker(metadata=None)
    action = ActionPresentTicketForm()

    events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert events == []
    assert dispatcher.messages[0]["custom"]["ticket_form"] is True
