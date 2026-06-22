"""Semantic NLU fallback: parsing + ActionEmbeddingFallback routing/safety.

nearest_intent is mocked so these run fast with no embedding model loaded.
"""
import pytest

from action_server.actions import _intent_index
from action_server.actions.actions_fallback import ActionEmbeddingFallback


# ── NLU parsing ───────────────────────────────────────────────────────────────
def test_parse_nlu_returns_pairs_without_entity_markup():
    pairs = _intent_index._parse_nlu()
    assert len(pairs) > 100                       # the real nlu.yml has thousands
    assert all(isinstance(t, str) and isinstance(i, str) and t for t, i in pairs)
    # entity markup [val](entity) / [val]{syn} must be stripped to plain text
    assert not any("](" in t or "]{" in t for t, _ in pairs)


# ── Action behaviour ─────────────────────────────────────────────────────────
class _Tracker:
    def __init__(self, text):
        self.latest_message = {"text": text, "metadata": {}}
        self.sender_id = "iam-test-user"


def _run(monkeypatch, dispatcher, text, match):
    """Run the action with nearest_intent() forced to `match` (or raising if None)."""
    if isinstance(match, Exception):
        def fake(_):
            raise match
    else:
        def fake(_):
            return match
    monkeypatch.setattr("action_server.actions._intent_index.nearest_intent", fake)
    return ActionEmbeddingFallback().run(dispatcher, _Tracker(text), {})


def test_kb_answerable_match_triggers_kb_search(monkeypatch, dispatcher):
    events = _run(monkeypatch, dispatcher, "vpn keeps dropping", ("ask_knowledge", 0.81, "vpn issues"))
    assert len(events) == 1
    assert events[0]["name"] == "action_search_knowledge_base"   # FollowupAction
    assert dispatcher.messages                                   # told the user it's searching


def test_actionable_match_offers_did_you_mean_button(monkeypatch, dispatcher):
    events = _run(monkeypatch, dispatcher, "where's my ticket", ("check_status", 0.78, "status of ticket"))
    assert events == []
    buttons = dispatcher.messages[-1].get("buttons", [])
    assert any(b["payload"] == "/check_status" for b in buttons)


def test_low_confidence_uses_default(monkeypatch, dispatcher):
    events = _run(monkeypatch, dispatcher, "qwerty zxcv", ("ask_knowledge", 0.30, "x"))
    assert events == []
    payloads = {b["payload"] for b in dispatcher.messages[-1].get("buttons", [])}
    assert "/ask_knowledge" in payloads and "/login" in payloads   # the helpful default


def test_no_match_uses_default(monkeypatch, dispatcher):
    events = _run(monkeypatch, dispatcher, "", None)
    assert events == []
    assert dispatcher.messages   # still responded


def test_error_degrades_to_default_without_raising(monkeypatch, dispatcher):
    events = _run(monkeypatch, dispatcher, "anything", RuntimeError("boom"))
    assert events == []
    assert dispatcher.messages   # never crashes the conversation


def test_unmapped_intent_uses_default(monkeypatch, dispatcher):
    # An intent that is neither KB-answerable nor in the actionable map → default.
    events = _run(monkeypatch, dispatcher, "ok sure", ("affirm", 0.90, "yes"))
    assert events == []
    assert dispatcher.messages
