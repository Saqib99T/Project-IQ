"""Conversation trace: parsing log lines into a per-request timeline.

Tests the pure parser (web/api/impl/observability._extract_trace_entries) and
the request_id validation regex — no IO needed.
"""
from web.api.impl import observability as obs


SAMPLE = [
    "2026-06-22 19:04:28,101 [req=abc123] INFO web.api.blueprints.bp_chat: forwarding to rasa",
    "2026-06-22 19:04:28,250 [req=abc123] INFO action_server.actions.actions_kb: KB search hit",
    "2026-06-22 19:04:28,400 [req=other] INFO web.api: unrelated request",
    "2026-06-22 19:04:28,500 [req=abc123] ERROR web.api.impl.observability: boom",
    "a line with no req tag at all",
]


def test_extracts_only_matching_request():
    entries = obs._extract_trace_entries(SAMPLE, "abc123", "admin")
    assert len(entries) == 3                      # the 'other' + untagged lines excluded
    assert {e["level"] for e in entries} == {"INFO", "ERROR"}
    assert all(e["source"] == "admin" for e in entries)


def test_parses_timestamp_level_logger_message():
    e = obs._extract_trace_entries(SAMPLE, "abc123", "rasa")[0]
    assert e["timestamp"] == "2026-06-22 19:04:28,101"
    assert e["level"] == "INFO"
    assert e["logger"] == "web.api.blueprints.bp_chat"
    assert e["message"] == "forwarding to rasa"


def test_error_level_detected():
    errs = [e for e in obs._extract_trace_entries(SAMPLE, "abc123", "x") if e["level"] == "ERROR"]
    assert len(errs) == 1 and errs[0]["message"] == "boom"


def test_no_match_returns_empty():
    assert obs._extract_trace_entries(SAMPLE, "doesnotexist", "x") == []


def test_request_id_validation_regex():
    assert obs._REQUEST_ID_RE.match("abc-123_DEF.45")
    assert not obs._REQUEST_ID_RE.match("../etc/passwd")
    assert not obs._REQUEST_ID_RE.match("a b")
    assert not obs._REQUEST_ID_RE.match("")
