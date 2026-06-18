"""
Action Server (NLU custom actions) — the shared identity, authorization,
analytics, session, login-flow, frustration-scoring and runtime-config helpers
that gate every ticket and handoff action.

Run:  python -m pytest tests/test_action_server.py -v
"""
import asyncio
from action_server.actions import _shared


# ── IAM identity ─────────────────────────────────────────────────────────────
def test_identity_read_from_metadata(make_tracker):
    t = make_tracker(metadata={"iam_sub": "u1", "iam_name": "Alice", "iam_email": "a@x.com"})
    ident = _shared.get_iam_identity(t)
    assert ident == {"sub": "u1", "name": "Alice", "email": "a@x.com"}


def test_identity_slot_takes_priority_over_metadata(make_tracker):
    t = make_tracker(slots={"iam_sub": "slot-sub"}, metadata={"iam_sub": "meta-sub"})
    assert _shared.get_iam_identity(t)["sub"] == "slot-sub"


def test_identity_guest_is_blank(make_tracker):
    assert _shared.get_iam_identity(make_tracker())["sub"] == ""


def test_guest_not_authenticated(make_tracker):
    assert _shared.is_iam_authenticated(make_tracker()) is False


def test_signed_in_user_authenticated(make_tracker):
    assert _shared.is_iam_authenticated(make_tracker(metadata={"iam_sub": "u1"})) is True


# ── IAM JWT forwarding ───────────────────────────────────────────────────────
def test_iam_jwt_from_metadata(make_tracker):
    assert _shared.get_iam_jwt(make_tracker(metadata={"iam_token": "jwt-abc"})) == "jwt-abc"


def test_iam_jwt_from_slot(make_tracker):
    assert _shared.get_iam_jwt(make_tracker(slots={"iam_token": "jwt-slot"})) == "jwt-slot"


def test_iam_jwt_absent_is_none(make_tracker):
    assert _shared.get_iam_jwt(make_tracker()) is None


def test_iam_jwt_parses_string_metadata(make_tracker):
    t = make_tracker()
    t.latest_message["metadata"] = '{"iam_token": "jwt-str"}'
    assert _shared.get_iam_jwt(t) == "jwt-str"


# ── Sign-in gate (regression: must emit EXACTLY one message) ─────────────────
def test_require_iam_auth_single_message_and_button(dispatcher):
    result = _shared.require_iam_auth(dispatcher)
    assert result is False
    assert len(dispatcher.messages) == 1
    msg = dispatcher.messages[0]
    assert "sign in" in msg["text"].lower()
    assert any(b["payload"] == "/trigger_login" for b in msg.get("buttons", []))


# ── Org / tenant context ─────────────────────────────────────────────────────
def test_org_context_defaults(make_tracker):
    ctx = _shared.get_org_context(make_tracker())
    assert ctx["channel"] == "internal"
    assert ctx["org_id"] == "" and ctx["product_id"] == ""


def test_org_context_from_metadata(make_tracker):
    t = make_tracker(metadata={"iam_org_id": "org-1", "product_id": "greenloop", "channel": "platform"})
    ctx = _shared.get_org_context(t)
    assert ctx["org_id"] == "org-1" and ctx["product_id"] == "greenloop" and ctx["channel"] == "platform"


def test_org_context_slot_priority(make_tracker):
    t = make_tracker(slots={"product_id": "slot-prod"}, metadata={"product_id": "meta-prod"})
    assert _shared.get_org_context(t)["product_id"] == "slot-prod"


# ── Session token resolution ─────────────────────────────────────────────────
def test_session_token_from_slot(make_tracker):
    assert _shared.get_effective_session_token(make_tracker(slots={"session_token": "tok-slot"})) == "tok-slot"


def test_session_token_from_metadata(make_tracker):
    assert _shared.get_effective_session_token(make_tracker(metadata={"session_token": "tok-meta"})) == "tok-meta"


def test_session_token_fallback_attr(make_tracker):
    t = make_tracker()
    t._fallback_session_token = "fallback-tok"
    assert _shared.get_effective_session_token(t) == "fallback-tok"


def test_session_token_absent_is_none(make_tracker):
    assert _shared.get_effective_session_token(make_tracker()) is None


# ── Analytics context ────────────────────────────────────────────────────────
def test_analytics_defaults(make_tracker):
    ctx = _shared.get_analytics_context(make_tracker())
    assert ctx["app_id"] == "General"
    assert ctx["user_id"] is None
    assert ctx["ticket_id"] is None


def test_analytics_app_id_from_metadata(make_tracker):
    assert _shared.get_analytics_context(make_tracker(metadata={"app_id": "greenloop"}))["app_id"] == "greenloop"


def test_analytics_app_id_from_slot(make_tracker):
    assert _shared.get_analytics_context(make_tracker(slots={"app_id": "acc"}))["app_id"] == "acc"


def test_analytics_user_id_from_itsm_slot(make_tracker):
    assert _shared.get_analytics_context(make_tracker(slots={"itsm_user_name": "alice"}))["user_id"] == "alice"


def test_analytics_ticket_id_stringified(make_tracker):
    assert _shared.get_analytics_context(make_tracker(slots={"ticket_id": 123}))["ticket_id"] == "123"


def test_analytics_handles_string_metadata(make_tracker):
    t = make_tracker()
    t.latest_message["metadata"] = '{"app_id": "from-json"}'
    assert _shared.get_analytics_context(t)["app_id"] == "from-json"


# ── Login flow (async) ───────────────────────────────────────────────────────
def _login(t, d):
    return asyncio.run(_shared.check_user_login(t, d))


def test_login_passes_with_iam_sub(make_tracker, dispatcher):
    assert _login(make_tracker(metadata={"iam_sub": "u1"}), dispatcher) is True


def test_login_explicit_logout_fails(make_tracker, dispatcher):
    assert _login(make_tracker(slots={"is_authenticated": False}), dispatcher) is False
    assert dispatcher.messages  # a sign-in message was emitted


def test_login_passes_with_slot_token(make_tracker, dispatcher):
    t = make_tracker(slots={"is_authenticated": True, "session_token": "tok"})
    assert _login(t, dispatcher) is True


def test_login_passes_with_meta_is_authenticated(make_tracker, dispatcher):
    assert _login(make_tracker(metadata={"is_authenticated": True}), dispatcher) is True


def test_login_passes_with_iam_token(make_tracker, dispatcher):
    assert _login(make_tracker(metadata={"iam_token": "jwt"}), dispatcher) is True


def test_login_passes_with_itsm_user_id(make_tracker, dispatcher):
    assert _login(make_tracker(slots={"itsm_user_id": "42"}), dispatcher) is True


def test_login_fails_for_pure_guest(make_tracker, dispatcher):
    assert _login(make_tracker(), dispatcher) is False
    assert dispatcher.messages


# ── Frustration scoring ──────────────────────────────────────────────────────
def test_frustration_empty_is_zero():
    assert _shared._score_frustration("") == 0.0


def test_frustration_in_range():
    s = _shared._score_frustration("the printer is broken and this is terrible")
    assert 0.0 <= s <= 1.0


def test_frustration_strongly_negative_is_positive():
    s = _shared._score_frustration("this is terrible, broken, useless and a waste of time")
    assert s > 0.0


def test_frustration_neutral_is_low():
    assert _shared._score_frustration("please help me reset my password") <= 0.3


# ── Runtime config ───────────────────────────────────────────────────────────
def test_handoff_runtime_cfg_falls_back_on_error(monkeypatch):
    import common.conversation_db as cdb
    monkeypatch.setattr(cdb, "get_handoff_runtime_config", lambda: (_ for _ in ()).throw(RuntimeError("no db")))
    cfg = _shared._get_handoff_runtime_cfg()
    assert {"triggers", "queue", "operators", "gdpr"} <= set(cfg)
    assert cfg["gdpr"]["consent_required"] is True


def test_handoff_runtime_cfg_passthrough(monkeypatch):
    import common.conversation_db as cdb
    monkeypatch.setattr(cdb, "get_handoff_runtime_config", lambda: {"queue": {"default_priority": 9}})
    assert _shared._get_handoff_runtime_cfg()["queue"]["default_priority"] == 9


# ── ITSM client wiring ───────────────────────────────────────────────────────
def test_get_itsm_service_returns_client():
    svc = _shared.get_itsm_service()
    assert svc is not None
