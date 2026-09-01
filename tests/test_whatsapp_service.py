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


# ------------------------------------------------------------------
# send_buttons() — 2026-09-01 fix. Rasa's dispatcher buttons were being
# dropped on the way out (send_text() only ever sent `body`), leaving
# disambiguation/login/KB prompts as dead-end plain text over WhatsApp.
# ------------------------------------------------------------------

def test_send_buttons_with_no_buttons_falls_back_to_plain_text():
    from extensions.whatsapp.service import WhatsAppService

    mock_resp = MagicMock(status_code=200, content=b'{}')
    mock_resp.json.return_value = {}
    with patch("extensions.whatsapp.service.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("extensions.whatsapp.service.requests.post", return_value=mock_resp) as mock_post:
        ok = WhatsAppService().send_buttons("923214421327", "hi", [])

    assert ok is True
    sent = mock_post.call_args[1]["json"]
    assert sent["type"] == "text"


def test_send_buttons_up_to_three_sends_native_reply_buttons():
    from extensions.whatsapp.service import WhatsAppService

    mock_resp = MagicMock(status_code=200, content=b'{}')
    mock_resp.json.return_value = {}
    buttons = [
        {"title": "🔍 Check ticket status", "payload": "/check_status"},
        {"title": "🔑 Login", "payload": "/login"},
    ]
    with patch("extensions.whatsapp.service.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("extensions.whatsapp.service.requests.post", return_value=mock_resp) as mock_post:
        ok = WhatsAppService().send_buttons("923214421327", "Did you mean:", buttons)

    assert ok is True
    sent = mock_post.call_args[1]["json"]
    assert sent["type"] == "interactive"
    assert sent["interactive"]["type"] == "button"
    assert sent["interactive"]["body"]["text"] == "Did you mean:"
    wa_buttons = sent["interactive"]["action"]["buttons"]
    assert len(wa_buttons) == 2
    assert wa_buttons[0]["reply"]["id"] == "/check_status"
    # Meta's 20-char title cap -- emoji-prefixed labels get truncated, not rejected.
    assert len(wa_buttons[0]["reply"]["title"]) <= 20
    assert wa_buttons[1]["reply"]["id"] == "/login"


def test_fit_title_regression_no_mid_word_mangling():
    """2026-09-01 regression, caught live on prod: a naive title[:20] turned
    '🔍 Check ticket status' (21 chars) into 'Check ticket statu' --
    truncation must land on a word boundary with a visible ellipsis, never
    mid-word."""
    from extensions.whatsapp.service import WhatsAppService

    fitted = WhatsAppService._fit_title("🔍 Check ticket status", 20)
    assert len(fitted) <= 20
    assert not fitted.endswith("statu")
    assert fitted.endswith("…")


def test_fit_title_leaves_short_titles_untouched():
    from extensions.whatsapp.service import WhatsAppService

    assert WhatsAppService._fit_title("🔑 Login", 20) == "🔑 Login"


def test_send_buttons_over_three_falls_back_to_list_message():
    from extensions.whatsapp.service import WhatsAppService

    mock_resp = MagicMock(status_code=200, content=b'{}')
    mock_resp.json.return_value = {}
    buttons = [{"title": f"Option {i}", "payload": f"/opt{i}"} for i in range(5)]
    with patch("extensions.whatsapp.service.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("extensions.whatsapp.service.requests.post", return_value=mock_resp) as mock_post:
        ok = WhatsAppService().send_buttons("923214421327", "Pick one:", buttons)

    assert ok is True
    sent = mock_post.call_args[1]["json"]
    assert sent["interactive"]["type"] == "list"
    rows = sent["interactive"]["action"]["sections"][0]["rows"]
    assert len(rows) == 5
    assert rows[0]["id"] == "/opt0"


def test_send_buttons_empty_body_gets_a_default_prompt():
    from extensions.whatsapp.service import WhatsAppService

    mock_resp = MagicMock(status_code=200, content=b'{}')
    mock_resp.json.return_value = {}
    buttons = [{"title": "🔑 Login", "payload": "/login"}]
    with patch("extensions.whatsapp.service.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("extensions.whatsapp.service.requests.post", return_value=mock_resp) as mock_post:
        WhatsAppService().send_buttons("923214421327", "", buttons)

    sent = mock_post.call_args[1]["json"]
    assert sent["interactive"]["body"]["text"]  # non-empty -- Meta rejects a blank body


def test_send_buttons_respects_the_send_rate_limit():
    from extensions.whatsapp.service import WhatsAppService

    svc = WhatsAppService()
    with patch.object(svc, "_check_send_rate_limit", return_value=False), \
         patch("extensions.whatsapp.service.get_whatsapp_config", return_value=_FAKE_CFG), \
         patch("extensions.whatsapp.service.requests.post") as mock_post:
        ok = svc.send_buttons("923214421327", "hi", [{"title": "Login", "payload": "/login"}])

    assert ok is False
    mock_post.assert_not_called()
