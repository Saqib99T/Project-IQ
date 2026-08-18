"""
Tests for action_server/actions/actions_kb.py's KB search actions
(KB_WIKI_CURATION_RAG_PLAN Phase 3 — itsm-service chunk search primary,
local vector_search fallback for Firecrawl/extension-only content).

Uses the shared conftest fixtures (make_tracker, dispatcher). Rasa actions'
run() is async, but this repo's suite has no pytest-asyncio installed — every
test here is a plain `def` that drives the coroutine via asyncio.run(),
matching how the rest of this test suite avoids adding that dependency.
"""
import asyncio
from unittest.mock import AsyncMock, patch


def _tracker_with_message(make_tracker, text, **kwargs):
    t = make_tracker(**kwargs)
    t.latest_message["text"] = text
    return t


def _chunk(article_title="Refund Policy", heading="Timing", content="Refunds take 5-7 business days.",
           score=0.6, article_id="art-1"):
    return {
        "article_id": article_id, "article_title": article_title,
        "heading": heading, "content": content, "score": score,
    }


# ===========================================================================
# ActionSearchKnowledgeBase
# ===========================================================================


def test_high_confidence_itsm_result_answers_directly(make_tracker, dispatcher):
    from action_server.actions.actions_kb import ActionSearchKnowledgeBase

    tracker = _tracker_with_message(make_tracker, "how long do refunds take", metadata={"iam_token": "jwt-1"})
    action = ActionSearchKnowledgeBase()

    with patch(
        "action_server.actions._shared.itsm_service.search_kb_chunks",
        new=AsyncMock(return_value=[_chunk(score=0.9)]),
    ) as mock_search:
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    mock_search.assert_called_once()
    assert mock_search.call_args.args[0] == "jwt-1"  # forwarded the user's own IAM JWT
    assert len(dispatcher.messages) == 1
    assert "Refunds take 5-7 business days." in dispatcher.messages[0]["text"]
    slots = {e["name"]: e["value"] for e in events if e.get("event") == "slot"}
    assert slots["kb_last_article_title"] == "Refund Policy"
    assert slots["kb_last_source"] == "itsm_chunk_search"
    assert slots["kb_search_missed"] is False


def test_anonymous_user_forwards_none_token(make_tracker, dispatcher):
    """No iam_token in metadata -> token=None -> itsm-service scopes to global public content."""
    from action_server.actions.actions_kb import ActionSearchKnowledgeBase

    tracker = _tracker_with_message(make_tracker, "how long do refunds take")
    action = ActionSearchKnowledgeBase()

    with patch(
        "action_server.actions._shared.itsm_service.search_kb_chunks",
        new=AsyncMock(return_value=[_chunk(score=0.9)]),
    ) as mock_search:
        asyncio.run(action.run(dispatcher, tracker, {}))

    assert mock_search.call_args.args[0] is None


def test_low_confidence_multiple_results_offers_clarify(make_tracker, dispatcher):
    from action_server.actions.actions_kb import ActionSearchKnowledgeBase

    tracker = _tracker_with_message(make_tracker, "refunds")
    action = ActionSearchKnowledgeBase()
    results = [
        _chunk(article_title="Refund Policy", heading="Timing", content="5-7 business days.", score=0.2, article_id="a1"),
        _chunk(article_title="Return Policy", heading="Eligibility", content="Items must be unused.", score=0.15, article_id="a2"),
    ]

    with patch("action_server.actions._shared.itsm_service.search_kb_chunks", new=AsyncMock(return_value=results)):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert len(dispatcher.messages) == 1
    assert dispatcher.messages[0].get("buttons")
    slot_events = {e["name"]: e["value"] for e in events if e.get("event") == "slot"}
    assert "kb_clarify_options" in slot_events
    assert slot_events["kb_clarify_options"] is not None


def test_clarify_followup_matches_option_and_answers(make_tracker, dispatcher):
    from action_server.actions.actions_kb import ActionSearchKnowledgeBase
    import json

    options = [
        {**_chunk(article_title="Refund Policy", heading="Timing", content="5-7 business days.", article_id="a1"),
         "title": "Timing", "summary": "5-7 business days."},
    ]
    tracker = _tracker_with_message(
        make_tracker, "Timing",
        slots={"kb_clarify_options": json.dumps(options), "kb_clarify_attempts": 0},
    )
    action = ActionSearchKnowledgeBase()

    with patch("action_server.actions._shared.itsm_service.search_kb_chunks", new=AsyncMock()) as mock_search:
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    mock_search.assert_not_called()  # resolved from the stored options, no new search
    assert "5-7 business days." in dispatcher.messages[0]["text"]
    slot_events = {e["name"]: e["value"] for e in events if e.get("event") == "slot"}
    assert slot_events["kb_clarify_options"] is None


def test_itsm_empty_falls_back_to_local_vector_search(make_tracker, dispatcher):
    from action_server.actions.actions_kb import ActionSearchKnowledgeBase

    tracker = _tracker_with_message(make_tracker, "how do I use the scraped-only doc", slots={"iam_org_id": "org-1"})
    action = ActionSearchKnowledgeBase()

    with (
        patch("action_server.actions._shared.itsm_service.search_kb_chunks", new=AsyncMock(return_value=[])),
        patch("common.vector_search.search_single", return_value={
            "title": "Scraped Doc", "content": "Locally scraped content.", "similarity": 0.5,
        }) as mock_local,
    ):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    mock_local.assert_called_once()
    assert mock_local.call_args.kwargs.get("org_id") == "org-1"
    assert "Locally scraped content." in dispatcher.messages[0]["text"]
    slot_events = {e["name"]: e["value"] for e in events if e.get("event") == "slot"}
    assert slot_events["kb_last_source"] == "itsm_chunk_search"  # _respond_with_chunk's fixed source label
    assert slot_events["kb_search_missed"] is False


def test_no_results_anywhere_logs_gap_and_shows_no_answer(make_tracker, dispatcher):
    from action_server.actions.actions_kb import ActionSearchKnowledgeBase

    tracker = _tracker_with_message(
        make_tracker, "completely unknown topic",
        slots={"iam_org_id": "org-1", "product_id": "greenloop"},
    )
    action = ActionSearchKnowledgeBase()

    with (
        patch("action_server.actions._shared.itsm_service.search_kb_chunks", new=AsyncMock(return_value=[])),
        patch("common.vector_search.search_single", return_value=None),
        patch("common.db._kb_gaps.log_kb_gap") as mock_gap,
    ):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    mock_gap.assert_called_once()
    assert mock_gap.call_args.kwargs.get("org_id") == "org-1"
    assert mock_gap.call_args.kwargs.get("product_id") == "greenloop"
    assert len(dispatcher.messages) == 1
    slot_events = {e["name"]: e["value"] for e in events if e.get("event") == "slot"}
    assert slot_events["kb_search_missed"] is True
    followups = [e for e in events if e.get("event") == "followup"]
    assert any(e.get("name") == "action_track_confidence" for e in followups)


# ===========================================================================
# ActionSearchKbBeforeTicket
# ===========================================================================


def test_before_ticket_shows_results_when_found(make_tracker, dispatcher):
    from action_server.actions.actions_kb import ActionSearchKbBeforeTicket

    tracker = _tracker_with_message(make_tracker, "my vpn keeps disconnecting")
    action = ActionSearchKbBeforeTicket()

    with patch(
        "action_server.actions._shared.itsm_service.search_kb_chunks",
        new=AsyncMock(return_value=[_chunk(article_title="VPN Troubleshooting", content="Restart the client.")]),
    ):
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    assert "VPN Troubleshooting" in dispatcher.messages[0]["text"]
    slot_events = {e["name"]: e["value"] for e in events if e.get("event") == "slot"}
    assert slot_events["kb_articles_shown"] is True


def test_before_ticket_skips_search_on_generic_phrase(make_tracker, dispatcher):
    from action_server.actions.actions_kb import ActionSearchKbBeforeTicket

    tracker = _tracker_with_message(make_tracker, "create ticket")
    action = ActionSearchKbBeforeTicket()

    with patch("action_server.actions._shared.itsm_service.search_kb_chunks", new=AsyncMock()) as mock_search:
        events = asyncio.run(action.run(dispatcher, tracker, {}))

    mock_search.assert_not_called()
    event_names = [e.get("event") for e in events]
    assert "followup" in event_names or any(e.get("name") == "kb_articles_shown" and e.get("value") is False for e in events)
