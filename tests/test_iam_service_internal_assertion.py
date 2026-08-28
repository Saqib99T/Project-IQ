"""Tests for common/iam_service.py's mint_internal_assertion() — the
Keycloak-independent fallback used when token-exchange access isn't
available (docs/plans/WHATSAPP_INTEGRATION_PLAN.md 2026-08-27 note). No
Keycloak/network involved at all — pure local HS256 signing.
"""
from unittest.mock import patch

import jwt

from common.iam_service import mint_internal_assertion


def _cfg(secret=""):
    return {"internal_assertion_secret": secret}


def test_returns_none_when_secret_not_configured():
    with patch("common.config_manager.get_whatsapp_config", return_value=_cfg("")):
        assert mint_internal_assertion("sub-1", "org-1") is None


def test_mints_a_valid_token_with_expected_claims():
    with patch("common.config_manager.get_whatsapp_config", return_value=_cfg("shared-secret")):
        token = mint_internal_assertion("sub-1", "org-1")
    assert token is not None
    claims = jwt.decode(token, "shared-secret", algorithms=["HS256"], audience="itsm-service")
    assert claims["sub"] == "sub-1"
    assert claims["org_id"] == "org-1"
    assert claims["iss"] == "project-iq-whatsapp"
    assert claims["aud"] == "itsm-service"
    assert claims["exp"] > claims["iat"]


def test_token_is_unusable_with_wrong_secret():
    with patch("common.config_manager.get_whatsapp_config", return_value=_cfg("shared-secret")):
        token = mint_internal_assertion("sub-1", "org-1")
    try:
        jwt.decode(token, "wrong-secret", algorithms=["HS256"], audience="itsm-service")
        assert False, "should have raised on signature mismatch"
    except jwt.InvalidSignatureError:
        pass
