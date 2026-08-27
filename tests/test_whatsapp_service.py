"""Tests for extensions/whatsapp/service.py's ensure_subscribed_to_webhooks()
— the fix for the WABA/webhook-subscription gotcha confirmed live 2026-08-27
(docs/plans/WHATSAPP_INTEGRATION_PLAN.md). Mocked requests, no live account.
"""
from unittest.mock import MagicMock, patch

_FAKE_CFG = {
    "enabled": True, "groups_enabled": False, "graph_api_version": "v23.0",
    "phone_number_id": "123", "waba_id": "waba-1", "access_token": "fake-token",
    "app_secret": "s", "verify_token": "t",
    "default_proactivity_level": "mention_only", "proactive_cooldown_seconds": 600,
    "send_rate_limit": "60 per hour",
}


def test_ensure_subscribed_posts_to_correct_url_and_returns_success():
    from extensions.whatsapp.service import WhatsAppService

    mock_resp = MagicMock(status_code=200, content=b'{"success":true}')
    mock_resp.json.return_value = {"success": True}

    with patch("extensions.whatsapp.service.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("extensions.whatsapp.service.requests.post", return_value=mock_resp) as mock_post:
        ok, detail = WhatsAppService().ensure_subscribed_to_webhooks()

    assert ok is True
    assert detail == {"success": True}
    called_url = mock_post.call_args[0][0]
    assert called_url.endswith("waba-1/subscribed_apps")
    assert mock_post.call_args[1]["headers"]["Authorization"] == "Bearer fake-token"


def test_ensure_subscribed_returns_error_on_non_200():
    from extensions.whatsapp.service import WhatsAppService

    mock_resp = MagicMock(status_code=401, text='{"error":"bad token"}')

    with patch("extensions.whatsapp.service.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("extensions.whatsapp.service.requests.post", return_value=mock_resp):
        ok, detail = WhatsAppService().ensure_subscribed_to_webhooks()

    assert ok is False
    assert "401" in detail["error"]


def test_ensure_subscribed_returns_error_on_request_exception():
    import requests
    from extensions.whatsapp.service import WhatsAppService

    with patch("extensions.whatsapp.service.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("extensions.whatsapp.service.requests.post", side_effect=requests.RequestException("boom")):
        ok, detail = WhatsAppService().ensure_subscribed_to_webhooks()

    assert ok is False
    assert "boom" in detail["error"]
