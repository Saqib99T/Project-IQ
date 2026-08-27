"""Tests for extensions/whatsapp/bridge.py's account-link-aware branching in
handle_inbound_individual — confirms a linked user gets real identity
attribution and an UNLINKED (guest) fallback still works, and that
metadata['iam_token'] is NEVER set either way (the deliberate scope limit,
docs/plans/WHATSAPP_INTEGRATION_PLAN.md 2026-08-27 note).
"""
from unittest.mock import MagicMock, patch

from extensions.whatsapp.bridge import handle_inbound_individual


def test_linked_user_no_iam_token_when_bot_org_does_not_match():
    link = {"wa_id": "923214421327", "org_id": "org-1", "iam_sub": "sub-1", "display_name": "Saqib"}
    with patch("common.db._whatsapp_links.get_confirmed_link", return_value=link), \
         patch("common.iam_service.get_kb_bot_org_id", return_value="a-DIFFERENT-org"), \
         patch("common.iam_service.get_kb_bot_token", return_value="bot-token-value") as mock_bot_token, \
         patch("extensions.whatsapp.bridge.log_conversation_start") as mock_conv_start, \
         patch("extensions.whatsapp.bridge.log_message") as mock_log_msg, \
         patch("extensions.whatsapp.bridge._call_brain", return_value=[{"text": "hi Saqib"}]) as mock_brain, \
         patch("extensions.whatsapp.bridge.whatsapp_service") as mock_service:
        handle_inbound_individual("fallback-org", "923214421327", "Someone", "hello")

    # Real org_id from the link wins over the platform-fallback org_id passed in
    mock_conv_start.assert_called_once_with(
        "iam-sub-1-whatsapp", app_id="General", user_id="sub-1", user_name="Saqib", org_id="org-1",
    )
    brain_call = mock_brain.call_args[0]
    assert brain_call[0] == "iam-sub-1-whatsapp"
    metadata = brain_call[2]
    assert metadata["iam_sub"] == "sub-1"
    assert metadata["iam_name"] == "Saqib"
    # Bot org != linked user's org -> the safety gate must refuse to forward it
    assert "iam_token" not in metadata
    mock_service.send_text.assert_called_once_with("923214421327", "hi Saqib", recipient_type="individual")


def test_linked_user_gets_iam_token_when_bot_org_matches():
    link = {"wa_id": "923214421327", "org_id": "org-1", "iam_sub": "sub-1", "display_name": "Saqib"}
    with patch("common.db._whatsapp_links.get_confirmed_link", return_value=link), \
         patch("common.iam_service.get_kb_bot_org_id", return_value="org-1"), \
         patch("common.iam_service.get_kb_bot_token", return_value="bot-token-value"), \
         patch("extensions.whatsapp.bridge.log_conversation_start"), \
         patch("extensions.whatsapp.bridge.log_message"), \
         patch("extensions.whatsapp.bridge._call_brain", return_value=[]) as mock_brain, \
         patch("extensions.whatsapp.bridge.whatsapp_service"):
        handle_inbound_individual("fallback-org", "923214421327", "Someone", "hello")

    metadata = mock_brain.call_args[0][2]
    # Bot org == linked user's org -> safe to forward, and only then
    assert metadata["iam_token"] == "bot-token-value"


def test_linked_user_no_iam_token_when_bot_not_configured():
    link = {"wa_id": "923214421327", "org_id": "org-1", "iam_sub": "sub-1", "display_name": "Saqib"}
    with patch("common.db._whatsapp_links.get_confirmed_link", return_value=link), \
         patch("common.iam_service.get_kb_bot_org_id", return_value=None), \
         patch("common.iam_service.get_kb_bot_token", return_value=None), \
         patch("extensions.whatsapp.bridge.log_conversation_start"), \
         patch("extensions.whatsapp.bridge.log_message"), \
         patch("extensions.whatsapp.bridge._call_brain", return_value=[]) as mock_brain, \
         patch("extensions.whatsapp.bridge.whatsapp_service"):
        handle_inbound_individual("fallback-org", "923214421327", "Someone", "hello")

    metadata = mock_brain.call_args[0][2]
    assert "iam_token" not in metadata


def test_unlinked_user_stays_guest():
    with patch("common.db._whatsapp_links.get_confirmed_link", return_value=None), \
         patch("extensions.whatsapp.bridge.log_conversation_start") as mock_conv_start, \
         patch("extensions.whatsapp.bridge.log_message"), \
         patch("extensions.whatsapp.bridge._call_brain", return_value=[]) as mock_brain, \
         patch("extensions.whatsapp.bridge.whatsapp_service"):
        handle_inbound_individual("org-fallback", "923214421327", "Jane", "hello")

    mock_conv_start.assert_called_once_with(
        "ch-whatsapp-923214421327-org-fallback", app_id="General", user_id=None, user_name="Jane", org_id="org-fallback",
    )
    metadata = mock_brain.call_args[0][2]
    assert "iam_sub" not in metadata
    assert "iam_token" not in metadata


def test_empty_text_is_a_noop():
    with patch("common.db._whatsapp_links.get_confirmed_link") as mock_link:
        handle_inbound_individual("org-1", "923214421327", "Jane", "")
    mock_link.assert_not_called()
