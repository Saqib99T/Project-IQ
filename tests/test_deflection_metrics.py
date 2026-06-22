"""Deflection analytics: the pure rate computation (no DB needed)."""
from common.db import _analytics


def test_rates_computed_from_counts():
    row = {"total_conversations": 100, "escalated": 30, "bot_resolved": 70,
           "kb_engaged": 80, "kb_deflected": 60}
    out = _analytics._deflection_from_row(row)
    assert out["deflection_rate"] == 70.0          # 70/100
    assert out["kb_deflection_rate"] == 75.0        # 60/80
    assert out["escalated"] == 30


def test_zero_total_no_division_error():
    out = _analytics._deflection_from_row({"total_conversations": 0})
    assert out["deflection_rate"] == 0.0
    assert out["kb_deflection_rate"] == 0.0
    assert out["total_conversations"] == 0


def test_none_row_safe():
    out = _analytics._deflection_from_row(None)
    assert out["total_conversations"] == 0 and out["deflection_rate"] == 0.0


def test_kb_engaged_zero_guard():
    out = _analytics._deflection_from_row(
        {"total_conversations": 10, "bot_resolved": 10, "kb_engaged": 0, "kb_deflected": 0})
    assert out["deflection_rate"] == 100.0
    assert out["kb_deflection_rate"] == 0.0


def test_action_constants_cover_handoff_and_ticket():
    assert "action_request_handoff" in _analytics._ESCALATION_ACTIONS
    assert "action_create_ticket_from_form" in _analytics._ESCALATION_ACTIONS
    assert "action_search_knowledge_base" in _analytics._KB_ACTIONS
