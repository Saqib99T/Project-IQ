"""Tests for extensions/whatsapp/bridge.py's account-link-aware branching in
handle_inbound_individual — confirms a linked user gets real identity
attribution, that metadata['iam_token'] comes from real per-user token
exchange (not a shared/fixed-org bot token — see docs/plans/
WHATSAPP_INTEGRATION_PLAN.md's 2026-08-27 notes for why that approach was
tried and rejected), and that an unlinked user still gets guest treatment.
"""
from unittest.mock import patch

from extensions.whatsapp.bridge import handle_inbound_individual


def test_linked_user_gets_exchanged_token_when_exchange_succeeds():
    link = {"wa_id": "923214421327", "org_id": "org-1", "iam_sub": "sub-1", "display_name": "Saqib"}
    with patch("common.db._whatsapp_links.get_confirmed_link", return_value=link), \
         patch("common.iam_service.exchange_token_for_user", return_value="exchanged-jwt") as mock_exchange, \
         patch("extensions.whatsapp.bridge.log_conversation_start") as mock_conv_start, \
         patch("extensions.whatsapp.bridge.log_message"), \
         patch("extensions.whatsapp.bridge._call_brain", return_value=[{"text": "hi Saqib"}]) as mock_brain, \
         patch("extensions.whatsapp.bridge.whatsapp_service") as mock_service:
        handle_inbound_individual("fallback-org", "923214421327", "Someone", "hello")

    # Real org_id from the link wins over the platform-fallback org_id passed in
    mock_conv_start.assert_called_once_with(
        "iam-sub-1-whatsapp", app_id="General", user_id="sub-1", user_name="Saqib", org_id="org-1",
    )
    mock_exchange.assert_called_once_with("sub-1")
    brain_call = mock_brain.call_args[0]
    assert brain_call[0] == "iam-sub-1-whatsapp"
    metadata = brain_call[2]
    assert metadata["iam_sub"] == "sub-1"
    assert metadata["iam_name"] == "Saqib"
    assert metadata["iam_token"] == "exchanged-jwt"
    mock_service.send_text.assert_called_once_with("923214421327", "hi Saqib", recipient_type="individual")


def test_linked_user_falls_back_to_internal_assertion_when_exchange_unavailable():
    """Token exchange not yet enabled in Keycloak -> chain to the internal
    assertion, the mechanism that doesn't need Keycloak access at all."""
    link = {"wa_id": "923214421327", "org_id": "org-1", "iam_sub": "sub-1", "display_name": "Saqib"}
    with patch("common.db._whatsapp_links.get_confirmed_link", return_value=link), \
         patch("common.iam_service.exchange_token_for_user", return_value=None) as mock_exchange, \
         patch("common.iam_service.mint_internal_assertion", return_value="internal-jwt") as mock_internal, \
         patch("extensions.whatsapp.bridge.log_conversation_start"), \
         patch("extensions.whatsapp.bridge.log_message"), \
         patch("extensions.whatsapp.bridge._call_brain", return_value=[]) as mock_brain, \
         patch("extensions.whatsapp.bridge.whatsapp_service"):
        handle_inbound_individual("fallback-org", "923214421327", "Someone", "hello")

    mock_exchange.assert_called_once_with("sub-1")
    mock_internal.assert_called_once_with("sub-1", "org-1")
    metadata = mock_brain.call_args[0][2]
    assert metadata["iam_token"] == "internal-jwt"


def test_linked_user_no_iam_token_when_both_mechanisms_unavailable():
    """Neither Keycloak exchange nor the internal assertion secret is
    configured -> degrade exactly like an unlinked guest for account-scoped
    actions, never silently grant access that isn't actually backed."""
    link = {"wa_id": "923214421327", "org_id": "org-1", "iam_sub": "sub-1", "display_name": "Saqib"}
    with patch("common.db._whatsapp_links.get_confirmed_link", return_value=link), \
         patch("common.iam_service.exchange_token_for_user", return_value=None), \
         patch("common.iam_service.mint_internal_assertion", return_value=None), \
         patch("extensions.whatsapp.bridge.log_conversation_start"), \
         patch("extensions.whatsapp.bridge.log_message"), \
         patch("extensions.whatsapp.bridge._call_brain", return_value=[]) as mock_brain, \
         patch("extensions.whatsapp.bridge.whatsapp_service"):
        handle_inbound_individual("fallback-org", "923214421327", "Someone", "hello")

    metadata = mock_brain.call_args[0][2]
    assert metadata["iam_sub"] == "sub-1"  # attribution/personalization still works
    assert "iam_token" not in metadata      # but no forwardable access


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


def test_response_with_buttons_routes_to_send_buttons_not_send_text():
    """2026-09-01 fix: a Rasa response carrying buttons (disambiguation,
    login/KB fallback) must go out as a native WhatsApp interactive message,
    not get silently reduced to dead-end plain text."""
    buttons = [{"title": "🔍 Check ticket status", "payload": "/check_status"}]
    with patch("common.db._whatsapp_links.get_confirmed_link", return_value=None), \
         patch("extensions.whatsapp.bridge.log_conversation_start"), \
         patch("extensions.whatsapp.bridge.log_message"), \
         patch("extensions.whatsapp.bridge._call_brain",
               return_value=[{"text": "Did you mean:", "buttons": buttons}]), \
         patch("extensions.whatsapp.bridge.whatsapp_service") as mock_service:
        handle_inbound_individual("org-1", "923214421327", "Jane", "chk 1170")

    mock_service.send_buttons.assert_called_once_with(
        "923214421327", "Did you mean:", buttons, recipient_type="individual",
    )
    mock_service.send_text.assert_not_called()
