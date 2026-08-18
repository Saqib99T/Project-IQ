"""
Tests for ActionTrackConfidence (action_server/actions/actions_general.py),
KB_WIKI_CURATION_RAG_PLAN Phase 4 — unifying a KB-search miss into the same
low_conf_streak that drives handoff escalation, alongside NLU confidence.

Uses the shared conftest fixtures (make_tracker, dispatcher).
"""
from action_server.actions.actions_general import ActionTrackConfidence


def _slot_events(events):
    return {e["name"]: e["value"] for e in events if e.get("event") == "slot"}


def test_kb_miss_increments_streak_even_with_high_nlu_confidence(make_tracker, dispatcher):
    """FakeTracker's default latest_message has no 'intent' key, so confidence
    defaults to 1.0 (high) — the streak should still bump from a KB miss alone."""
    tracker = make_tracker(slots={"kb_search_missed": True, "low_conf_streak": 0})
    action = ActionTrackConfidence()

    events = action.run(dispatcher, tracker, {})

    slots = _slot_events(events)
    assert slots["low_conf_streak"] == 1.0


def test_kb_search_missed_is_consumed_after_one_run(make_tracker, dispatcher):
    tracker = make_tracker(slots={"kb_search_missed": True, "low_conf_streak": 0})
    action = ActionTrackConfidence()

    events = action.run(dispatcher, tracker, {})

    slots = _slot_events(events)
    assert slots["kb_search_missed"] is False


def test_no_miss_and_high_confidence_resets_streak(make_tracker, dispatcher):
    tracker = make_tracker(slots={"kb_search_missed": False, "low_conf_streak": 3})
    action = ActionTrackConfidence()

    events = action.run(dispatcher, tracker, {})

    slots = _slot_events(events)
    assert slots["low_conf_streak"] == 0.0


def test_streak_reaching_threshold_triggers_handoff_followup(make_tracker, dispatcher):
    tracker = make_tracker(slots={"kb_search_missed": True, "low_conf_streak": 1})
    action = ActionTrackConfidence()

    events = action.run(dispatcher, tracker, {})

    followups = [e for e in events if e.get("event") == "followup"]
    assert any(e.get("name") == "action_request_handoff" for e in followups)


def test_skips_tracking_when_already_in_handoff(make_tracker, dispatcher):
    tracker = make_tracker(slots={"kb_search_missed": True, "low_conf_streak": 0, "handoff_state": "with_operator"})
    action = ActionTrackConfidence()

    events = action.run(dispatcher, tracker, {})

    assert events == []
