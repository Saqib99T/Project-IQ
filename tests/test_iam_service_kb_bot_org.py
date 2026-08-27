"""Tests for common/iam_service.py's get_kb_bot_org_id() — the safety-gate
helper extensions/whatsapp/bridge.py uses to decide whether it's safe to
forward the KB bot's service-account token for a given WhatsApp-linked user
(docs/plans/WHATSAPP_INTEGRATION_PLAN.md 2026-08-27 note). No live IAM/
Keycloak needed — decodes an unverified JWT we construct ourselves.
"""
from unittest.mock import patch

import jwt

from common.iam_service import get_kb_bot_org_id


def _fake_token(org_id):
    return jwt.encode({"org_id": org_id, "sub": "bot-service-account"}, "irrelevant-secret", algorithm="HS256")


def test_returns_org_id_from_token_claim():
    with patch("common.iam_service.get_kb_bot_token", return_value=_fake_token("org-1")):
        assert get_kb_bot_org_id() == "org-1"


def test_returns_none_when_bot_not_configured():
    with patch("common.iam_service.get_kb_bot_token", return_value=None):
        assert get_kb_bot_org_id() is None


def test_returns_none_on_undecodable_token():
    with patch("common.iam_service.get_kb_bot_token", return_value="not-a-real-jwt"):
        assert get_kb_bot_org_id() is None
