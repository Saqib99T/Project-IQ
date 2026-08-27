"""Tests for common/iam_service.py's exchange_token_for_user() — RFC 8693
Standard Token Exchange, the scalable replacement for per-org bot tokens
(docs/plans/WHATSAPP_INTEGRATION_PLAN.md 2026-08-27 notes). Mocked HTTP,
no live Keycloak.
"""
from unittest.mock import MagicMock, patch

from common.iam_service import exchange_token_for_user, _exchange_tok_cache


def _fake_iam_cfg():
    return {
        'keycloak_url': 'https://id.example.com', 'realm': 'test-realm',
        'backend_client_id': 'backend-client', 'backend_client_secret': 'backend-secret',
    }


def setup_function():
    _exchange_tok_cache.clear()


def test_successful_exchange_returns_token_and_posts_correct_grant():
    mock_resp = MagicMock(status_code=200)
    mock_resp.json.return_value = {"access_token": "exchanged-jwt", "expires_in": 300}
    with patch("common.iam_service._get_iam_cfg", return_value=_fake_iam_cfg()), \
         patch("requests.post", return_value=mock_resp) as mock_post:
        token = exchange_token_for_user("user-sub-1")
    assert token == "exchanged-jwt"
    called_kwargs = mock_post.call_args[1]
    assert called_kwargs["data"]["grant_type"] == "urn:ietf:params:oauth:grant-type:token-exchange"
    assert called_kwargs["data"]["requested_subject"] == "user-sub-1"
    assert called_kwargs["data"]["client_id"] == "backend-client"


def test_exchange_not_enabled_returns_none():
    mock_resp = MagicMock(status_code=400, text='{"error":"unsupported_grant_type"}')
    with patch("common.iam_service._get_iam_cfg", return_value=_fake_iam_cfg()), \
         patch("requests.post", return_value=mock_resp):
        token = exchange_token_for_user("user-sub-1")
    assert token is None


def test_exchange_request_exception_returns_none():
    with patch("common.iam_service._get_iam_cfg", return_value=_fake_iam_cfg()), \
         patch("requests.post", side_effect=Exception("network down")):
        token = exchange_token_for_user("user-sub-1")
    assert token is None


def test_exchange_caches_briefly_per_user():
    mock_resp = MagicMock(status_code=200)
    mock_resp.json.return_value = {"access_token": "exchanged-jwt", "expires_in": 300}
    with patch("common.iam_service._get_iam_cfg", return_value=_fake_iam_cfg()), \
         patch("requests.post", return_value=mock_resp) as mock_post:
        first = exchange_token_for_user("user-sub-1")
        second = exchange_token_for_user("user-sub-1")
    assert first == second == "exchanged-jwt"
    mock_post.assert_called_once()  # second call served from cache, no new HTTP request


def test_exchange_different_users_not_cross_cached():
    mock_resp = MagicMock(status_code=200)
    mock_resp.json.return_value = {"access_token": "tok-A", "expires_in": 300}
    with patch("common.iam_service._get_iam_cfg", return_value=_fake_iam_cfg()), \
         patch("requests.post", return_value=mock_resp):
        exchange_token_for_user("user-A")

    mock_resp2 = MagicMock(status_code=200)
    mock_resp2.json.return_value = {"access_token": "tok-B", "expires_in": 300}
    with patch("common.iam_service._get_iam_cfg", return_value=_fake_iam_cfg()), \
         patch("requests.post", return_value=mock_resp2) as mock_post2:
        token_b = exchange_token_for_user("user-B")
    assert token_b == "tok-B"
    mock_post2.assert_called_once()
