"""Tests for extensions/whatsapp/routes.py — webhook verification handshake,
signature verification, and payload dispatch. Uses a minimal Flask app with
just the whatsapp blueprint registered, following tests/test_amazon_routes.py's
pattern (no live Meta account, no DB, no Rasa — see docs/plans/
WHATSAPP_INTEGRATION_PLAN.md §8 Phase 0a on why this needs none of that).
"""
import hashlib
import hmac
import json
from unittest.mock import patch

import pytest
from flask import Flask

_FAKE_CFG = {
    "enabled": True, "groups_enabled": True, "graph_api_version": "v23.0",
    "phone_number_id": "1234567890", "waba_id": "waba-1",
    "access_token": "fake-token", "app_secret": "fake-app-secret",
    "verify_token": "fake-verify-token",
    "default_proactivity_level": "mention_only", "proactive_cooldown_seconds": 600,
    "send_rate_limit": "60 per hour",
}


@pytest.fixture
def client():
    from extensions.whatsapp import routes as whatsapp_routes

    app = Flask(__name__)
    app.register_blueprint(whatsapp_routes.bp)
    with app.test_client() as c:
        yield c


def _sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


# ------------------------------------------------------------------
# GET — verification handshake
# ------------------------------------------------------------------

def test_verify_handshake_success(client):
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=_FAKE_CFG):
        resp = client.get("/webhooks/whatsapp", query_string={
            "hub.mode": "subscribe", "hub.verify_token": "fake-verify-token", "hub.challenge": "echo-me",
        })
    assert resp.status_code == 200
    assert resp.data == b"echo-me"


def test_verify_handshake_wrong_token_rejected(client):
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=_FAKE_CFG):
        resp = client.get("/webhooks/whatsapp", query_string={
            "hub.mode": "subscribe", "hub.verify_token": "wrong-token", "hub.challenge": "echo-me",
        })
    assert resp.status_code == 403


def test_verify_handshake_wrong_mode_rejected(client):
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=_FAKE_CFG):
        resp = client.get("/webhooks/whatsapp", query_string={
            "hub.mode": "unsubscribe", "hub.verify_token": "fake-verify-token", "hub.challenge": "echo-me",
        })
    assert resp.status_code == 403


# ------------------------------------------------------------------
# POST — signature verification
# ------------------------------------------------------------------

def test_webhook_rejects_missing_signature(client):
    body = json.dumps({"entry": []}).encode("utf-8")
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=_FAKE_CFG):
        resp = client.post("/webhooks/whatsapp", data=body, content_type="application/json")
    assert resp.status_code == 403


def test_webhook_rejects_bad_signature(client):
    body = json.dumps({"entry": []}).encode("utf-8")
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=_FAKE_CFG):
        resp = client.post(
            "/webhooks/whatsapp", data=body, content_type="application/json",
            headers={"X-Hub-Signature-256": "sha256=deadbeef"},
        )
    assert resp.status_code == 403


def test_webhook_accepts_valid_signature_empty_entry(client):
    body = json.dumps({"entry": []}).encode("utf-8")
    sig = _sign(body, _FAKE_CFG["app_secret"])
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("common.config_manager.get_platform_config", return_value={"org_id": "org-1"}):
        resp = client.post(
            "/webhooks/whatsapp", data=body, content_type="application/json",
            headers={"X-Hub-Signature-256": sig},
        )
    assert resp.status_code == 200
    assert resp.get_json() == {"received": True}


# ------------------------------------------------------------------
# POST — dispatch to the bridge (individual vs group)
# ------------------------------------------------------------------

def _individual_payload(text="hello", wa_id="15551234567", name="Jane"):
    return {
        "entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": wa_id, "profile": {"name": name}}],
            "messages": [{"from": wa_id, "type": "text", "text": {"body": text}}],
        }}]}]
    }


def _group_payload(text="@ProjectIQ status?", wa_id="15551234567", name="Jane", group_id="grp-123"):
    return {
        "entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": wa_id, "profile": {"name": name}}],
            "messages": [{"from": wa_id, "type": "text", "text": {"body": text}, "group_id": group_id}],
        }}]}]
    }


def test_webhook_dispatches_individual_message_to_bridge(client):
    body = json.dumps(_individual_payload()).encode("utf-8")
    sig = _sign(body, _FAKE_CFG["app_secret"])
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("common.config_manager.get_platform_config", return_value={"org_id": "org-1"}), \
         patch("extensions.whatsapp.bridge.handle_inbound_individual") as mock_individual, \
         patch("extensions.whatsapp.bridge.handle_inbound_group") as mock_group:
        resp = client.post(
            "/webhooks/whatsapp", data=body, content_type="application/json",
            headers={"X-Hub-Signature-256": sig},
        )
    assert resp.status_code == 200
    mock_individual.assert_called_once_with("org-1", "15551234567", "Jane", "hello")
    mock_group.assert_not_called()


def test_webhook_dispatches_group_message_to_bridge(client):
    body = json.dumps(_group_payload()).encode("utf-8")
    sig = _sign(body, _FAKE_CFG["app_secret"])
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("common.config_manager.get_platform_config", return_value={"org_id": "org-1"}), \
         patch("extensions.whatsapp.bridge.handle_inbound_individual") as mock_individual, \
         patch("extensions.whatsapp.bridge.handle_inbound_group") as mock_group:
        resp = client.post(
            "/webhooks/whatsapp", data=body, content_type="application/json",
            headers={"X-Hub-Signature-256": sig},
        )
    assert resp.status_code == 200
    mock_group.assert_called_once_with(
        "org-1", "grp-123", "15551234567", "Jane", "@ProjectIQ status?", mentions=[],
    )
    mock_individual.assert_not_called()


def test_webhook_ignores_group_message_when_groups_disabled(client):
    cfg = dict(_FAKE_CFG, groups_enabled=False)
    body = json.dumps(_group_payload()).encode("utf-8")
    sig = _sign(body, cfg["app_secret"])
    with patch("extensions.whatsapp.routes.get_whatsapp_config", return_value=cfg), \
         patch("common.config_manager.get_platform_config", return_value={"org_id": "org-1"}), \
         patch("extensions.whatsapp.bridge.handle_inbound_group") as mock_group:
        resp = client.post(
            "/webhooks/whatsapp", data=body, content_type="application/json",
            headers={"X-Hub-Signature-256": sig},
        )
    assert resp.status_code == 200
    mock_group.assert_not_called()
