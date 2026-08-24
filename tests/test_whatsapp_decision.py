"""Tests for extensions/whatsapp/decision.py — the ambient decision engine.
Pure unit tests, no Meta account or DB needed (docs/plans/
WHATSAPP_GROUP_ASSISTANT_PLAN.md §8 Phase 0a: fixture/unit-level testing that
has zero dependency on a verified business account).
"""
from extensions.whatsapp.decision import is_mentioned, should_respond


# ------------------------------------------------------------------
# is_mentioned
# ------------------------------------------------------------------

def test_is_mentioned_via_structured_mentions_list():
    assert is_mentioned("hey can you help", mentions=["1234567890"], bot_wa_id="1234567890")


def test_is_mentioned_via_text_fallback():
    assert is_mentioned("@ProjectIQ what's the status?", mentions=None, bot_wa_id="1234567890")


def test_is_mentioned_text_fallback_case_insensitive():
    assert is_mentioned("@projectiq help", mentions=None, bot_wa_id="1234567890")


def test_not_mentioned_plain_message():
    assert not is_mentioned("just chatting about lunch", mentions=None, bot_wa_id="1234567890")


def test_not_mentioned_empty_mentions_and_no_text_match():
    assert not is_mentioned("no mention here", mentions=[], bot_wa_id="1234567890")


# ------------------------------------------------------------------
# should_respond — mention always wins
# ------------------------------------------------------------------

def test_mention_always_responds_even_when_silent():
    respond, reason = should_respond("group-mention-silent", "anything", mentioned=True, proactivity_level="silent")
    assert respond is True
    assert reason == "mentioned"


def test_mention_always_responds_off_topic():
    respond, reason = should_respond("group-mention-offtopic", "what's for lunch", mentioned=True, proactivity_level="mention_only")
    assert respond is True


# ------------------------------------------------------------------
# should_respond — proactivity dial gates ambient replies
# ------------------------------------------------------------------

def test_silent_never_responds_unmentioned():
    respond, _ = should_respond("group-silent", "there's a bug in prod", mentioned=False, proactivity_level="silent")
    assert respond is False


def test_mention_only_never_responds_unmentioned():
    respond, _ = should_respond("group-mention-only", "there's a bug in prod", mentioned=False, proactivity_level="mention_only")
    assert respond is False


def test_light_proactive_responds_in_scope():
    respond, reason = should_respond("group-light-1", "there's a bug in prod, ticket please", mentioned=False, proactivity_level="light_proactive")
    assert respond is True
    assert "in scope" in reason


def test_light_proactive_ignores_out_of_scope():
    respond, reason = should_respond("group-light-2", "what's everyone having for lunch", mentioned=False, proactivity_level="light_proactive")
    assert respond is False
    assert "scope" in reason


def test_full_proactive_responds_in_scope():
    respond, _ = should_respond("group-full-1", "the deploy just broke", mentioned=False, proactivity_level="full_proactive")
    assert respond is True


def test_unrecognized_proactivity_level_defaults_to_no_response():
    respond, reason = should_respond("group-unknown", "there's an issue", mentioned=False, proactivity_level="not_a_real_level")
    assert respond is False


# ------------------------------------------------------------------
# should_respond — cooldown gate (FR8: don't spam the group)
# ------------------------------------------------------------------

def test_cooldown_blocks_second_proactive_reply_in_same_group():
    group_id = "group-cooldown-1"
    first, _ = should_respond(group_id, "there's an outage", mentioned=False, proactivity_level="full_proactive")
    assert first is True
    second, reason = should_respond(group_id, "still broken", mentioned=False, proactivity_level="full_proactive")
    assert second is False
    assert "cooldown" in reason


def test_cooldown_does_not_block_a_different_group():
    should_respond("group-cooldown-2a", "there's an outage", mentioned=False, proactivity_level="full_proactive")
    respond, _ = should_respond("group-cooldown-2b", "there's an outage", mentioned=False, proactivity_level="full_proactive")
    assert respond is True


def test_cooldown_does_not_block_a_mention_in_same_group():
    group_id = "group-cooldown-3"
    should_respond(group_id, "there's an outage", mentioned=False, proactivity_level="full_proactive")
    respond, reason = should_respond(group_id, "still broken", mentioned=True, proactivity_level="full_proactive")
    assert respond is True
    assert reason == "mentioned"
