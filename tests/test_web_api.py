"""
Web API (Flask) — real-time room routing & emit helpers, the stdlib JWT
implementation, multi-tenant scope filters, role gating, password hashing and
the storage / ITSM reverse proxies.

Run:  python -m pytest tests/test_web_api.py -v
"""
import base64
import json

import flask
import pytest
from flask import g

from web.api import shared
from web.api.blueprints import bp_storage_proxy
from web.api.blueprints import bp_itsm_proxy

_app = flask.Flask(__name__)


class _FakeSio:
    def __init__(self):
        self.calls = []

    def emit(self, event, payload, room=None):
        self.calls.append({"event": event, "payload": payload, "room": room})


# ── Room naming ──────────────────────────────────────────────────────────────
def test_room_user_naming():
    assert shared._room_user("iam-7-greenloop") == "user:iam-7-greenloop"


def test_room_operator_naming():
    assert shared._room_operator(4) == "operator:4"


def test_room_admin_watch_naming():
    assert shared._room_admin_watch(354) == "admin_watch:354"


# ── Emit routing (handoff delivery) ──────────────────────────────────────────
def test_emit_to_user_targets_user_room(monkeypatch):
    fake = _FakeSio()
    monkeypatch.setattr(shared, "sio", fake)
    shared.emit_to_user("iam-7-greenloop", "handoff_assigned", {"operator_name": "Sam"})
    assert fake.calls[-1] == {"event": "handoff_assigned",
                              "payload": {"operator_name": "Sam"},
                              "room": "user:iam-7-greenloop"}


def test_emit_to_operator_targets_operator_room(monkeypatch):
    fake = _FakeSio()
    monkeypatch.setattr(shared, "sio", fake)
    shared.emit_to_operator(4, "user_message", {"text": "hi"})
    assert fake.calls[-1]["room"] == "operator:4"


def test_emit_queue_overview_counts(monkeypatch):
    cdb = pytest.importorskip("common.conversation_db")
    fake = _FakeSio()
    monkeypatch.setattr(shared, "sio", fake)
    monkeypatch.setattr(cdb, "get_queue", lambda status: [1, 2] if status == "waiting" else [3])
    shared.emit_queue_overview()
    call = fake.calls[-1]
    assert call["room"] == "queue_overview"
    assert call["payload"] == {"waiting_count": 2, "assigned_count": 1}


# ── JWT (stdlib HS256) ───────────────────────────────────────────────────────
def test_jwt_roundtrip_sets_iat():
    tok = shared.jwt_encode({"sub": "op1", "type": "operator"}, "secret")
    payload = shared.jwt_decode(tok, "secret")
    assert payload["sub"] == "op1" and payload["type"] == "operator"
    assert "iat" in payload


def test_jwt_rejects_wrong_secret():
    tok = shared.jwt_encode({"sub": "x"}, "secret-A")
    assert shared.jwt_decode(tok, "secret-B") is None


def test_jwt_rejects_tampered_payload():
    tok = shared.jwt_encode({"sub": "user"}, "secret")
    header_b, _body_b, sig_b = tok.split(".")
    forged = base64.urlsafe_b64encode(json.dumps({"sub": "admin"}).encode()).rstrip(b"=").decode()
    assert shared.jwt_decode(f"{header_b}.{forged}.{sig_b}", "secret") is None


def test_jwt_rejects_expired():
    tok = shared.jwt_encode({"sub": "x", "exp": 1}, "secret")  # 1970 → expired
    assert shared.jwt_decode(tok, "secret") is None


def test_jwt_rejects_malformed():
    assert shared.jwt_decode("only.two", "secret") is None
    assert shared.jwt_decode("not-a-token", "secret") is None


# ── caller_org_scope (multi-tenant isolation) ────────────────────────────────
def test_scope_tenant_admin_forced_to_own_org_ignoring_override():
    with _app.test_request_context(headers={"X-Org-Id": "OTHER"}):
        g.iam_user = {"is_platform_admin": False, "org_id": "MINE"}
        assert shared.caller_org_scope() == "MINE"


def test_scope_platform_admin_no_selection_is_none():
    with _app.test_request_context():
        g.iam_user = {"is_platform_admin": True, "org_id": "P"}
        assert shared.caller_org_scope() is None


def test_scope_platform_admin_override_via_header():
    with _app.test_request_context(headers={"X-Org-Id": "SELECTED"}):
        g.iam_user = {"is_platform_admin": True}
        assert shared.caller_org_scope() == "SELECTED"


def test_scope_platform_admin_override_via_query():
    with _app.test_request_context("/?org_id=QORG"):
        g.iam_user = {"is_platform_admin": True}
        assert shared.caller_org_scope() == "QORG"


def test_scope_unauthenticated_is_none():
    with _app.test_request_context():
        assert shared.caller_org_scope() is None


# ── get_org_filter (SQL scoping) ─────────────────────────────────────────────
def test_org_filter_unauthenticated_blocks_all():
    with _app.test_request_context():
        sql, _ = shared.get_org_filter()
        assert sql == "1=0"


def test_org_filter_platform_admin_sees_all():
    with _app.test_request_context():
        g.iam_user = {"is_platform_admin": True}
        sql, _ = shared.get_org_filter()
        assert sql == "1=1"


def test_org_filter_platform_admin_with_override():
    with _app.test_request_context():
        g.iam_user = {"is_platform_admin": True}
        sql, params = shared.get_org_filter("ORG-X")
        assert "org_id" in sql and params["org_id"] == "ORG-X"


def test_org_filter_client_admin_scoped_to_org():
    with _app.test_request_context():
        g.iam_user = {"is_client_admin": True, "org_id": "O"}
        sql, params = shared.get_org_filter()
        assert params["org_id"] == "O"


# ── get_operator_queue_filter ────────────────────────────────────────────────
def test_op_queue_filter_platform_operator(monkeypatch):
    monkeypatch.setattr("common.config_manager.get_platform_config", lambda: {"org_id": "PLAT"})
    with _app.test_request_context():
        g.iam_user = {"org_id": "PLAT", "product_roles": []}
        sql, params = shared.get_operator_queue_filter()
        assert "channel = 'platform'" in sql and params["support_org_id"] == "PLAT"


def test_op_queue_filter_client_operator(monkeypatch):
    monkeypatch.setattr("common.config_manager.get_platform_config", lambda: {"org_id": "PLAT"})
    with _app.test_request_context():
        g.iam_user = {"org_id": "CUST", "product_roles": []}
        sql, params = shared.get_operator_queue_filter()
        assert "channel = 'internal'" in sql and params["org_id"] == "CUST"


def test_op_queue_filter_narrows_by_product(monkeypatch):
    monkeypatch.setattr("common.config_manager.get_platform_config", lambda: {"org_id": "PLAT"})
    with _app.test_request_context():
        g.iam_user = {"org_id": "CUST", "product_roles": ["greenloop-support"]}
        sql, params = shared.get_operator_queue_filter()
        assert "product_id = ANY" in sql and params["products"] == ["greenloop-support"]


# ── require_role decorator ───────────────────────────────────────────────────
def test_require_role_allows_when_role_present():
    wrapped = shared.require_role("super_admin")(lambda: "ok")
    with _app.test_request_context():
        g.iam_user = {"realm_roles": ["super_admin"]}
        assert wrapped() == "ok"


def test_require_role_forbids_when_role_missing():
    wrapped = shared.require_role("super_admin")(lambda: "ok")
    with _app.test_request_context():
        g.iam_user = {"realm_roles": []}
        assert wrapped()[1] == 403


def test_require_role_401_when_unauthenticated():
    wrapped = shared.require_role("super_admin")(lambda: "ok")
    with _app.test_request_context():
        assert wrapped()[1] == 401


# ── Storage proxy ────────────────────────────────────────────────────────────
def test_storage_proxy_bucket():
    assert bp_storage_proxy._BUCKET == "itsm-files"


def test_storage_proxy_target_is_http_no_trailing_slash():
    target = bp_storage_proxy._minio_target()
    assert target.startswith("http://") or target.startswith("https://")
    assert not target.endswith("/")


def test_storage_proxy_drops_hop_by_hop_headers():
    assert "content-encoding" in bp_storage_proxy._DROP_RESPONSE_HEADERS


# ── ITSM same-origin proxy ───────────────────────────────────────────────────
def test_itsm_proxy_forwards_auth_and_tenant_headers():
    assert "authorization" in bp_itsm_proxy._FORWARD_REQUEST_HEADERS
    assert "x-tenant-id" in bp_itsm_proxy._FORWARD_REQUEST_HEADERS


def test_itsm_proxy_base_url_is_http():
    assert bp_itsm_proxy._itsm_base_url().startswith("http")


# ── Handoff auto-assign: least-loaded operator selection (P3 2c) ───────────────
from web.api.impl.operator import _rank_auto_assign_candidates


def test_auto_assign_picks_least_loaded():
    ops = [
        {"id": 1, "team": "Support", "current_load": 2},
        {"id": 2, "team": "Support", "current_load": 0},
        {"id": 3, "team": "Support", "current_load": 1},
    ]
    assert _rank_auto_assign_candidates(ops, "Support")["id"] == 2


def test_auto_assign_tiebreak_by_id():
    ops = [
        {"id": 5, "team": "Support", "current_load": 1},
        {"id": 2, "team": "Support", "current_load": 1},
    ]
    assert _rank_auto_assign_candidates(ops, "Support")["id"] == 2


def test_auto_assign_filters_by_team_but_keeps_teamless():
    ops = [
        {"id": 1, "team": "Billing", "current_load": 0},
        {"id": 2, "team": "Support", "current_load": 3},
        {"id": 3, "team": None,      "current_load": 1},
    ]
    # Billing op is excluded; teamless op is eligible and least-loaded of the rest.
    assert _rank_auto_assign_candidates(ops, "Support")["id"] == 3


def test_auto_assign_none_when_no_eligible():
    ops = [{"id": 1, "team": "Billing", "current_load": 0}]
    assert _rank_auto_assign_candidates(ops, "Support") is None
    assert _rank_auto_assign_candidates([], "Support") is None


def test_auto_assign_no_target_team_considers_all():
    ops = [
        {"id": 1, "team": "Billing", "current_load": 2},
        {"id": 2, "team": "Support", "current_load": 0},
    ]
    assert _rank_auto_assign_candidates(ops, None)["id"] == 2


def test_handoff_config_default_auto_assign_off():
    from common.db._config import _HANDOFF_RUNTIME_DEFAULTS
    assert _HANDOFF_RUNTIME_DEFAULTS["operators"]["auto_assign"] is False
