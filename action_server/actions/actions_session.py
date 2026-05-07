import os, sys, logging, json, re, datetime, traceback
from typing import Text, List, Any, Dict, Optional

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet, AllSlotsReset, Restarted, ActiveLoop, UserUttered, FollowupAction
from rasa_sdk.forms import FormValidationAction
from rasa_sdk.executor import CollectingDispatcher
from action_server.actions.glpi_service import GlpiService
from common import analytics_store
from common.config_manager import get_glpi_config
from action_server.actions._shared import (
    get_glpi_service, get_glpi_base_url, log_bot_response,
    get_analytics_context, get_effective_session_token,
    check_user_login, glpi_service, logger,
    _get_handoff_runtime_cfg,
)


class ActionClearSession(Action):
    def name(self) -> Text:
        return "action_clear_session"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        # Kill both user session and service session on cleanup
        session_token = tracker.get_slot("session_token")
        if session_token:
            await glpi_service.kill_session(session_token)
        svc_token = tracker.get_slot("svc_session_token")
        if svc_token:
            await glpi_service.kill_session(svc_token)
            
        dispatcher.utter_message(response="utter_cleared")
        
        return [AllSlotsReset(), Restarted()]

# --- 12. Custom Action: Extract Context (App ID) ---


class ActionExtractContext(Action):
    def name(self) -> Text:
        return "action_extract_context"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        # Check metadata from the latest message
        metadata = tracker.latest_message.get("metadata", {})
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except:
                metadata = {}
        elif metadata is None:
            metadata = {}

        app_id = metadata.get("app_id") if isinstance(metadata, dict) else None
        
        if app_id:
            logger.info(f"Context Extracted: app_id={app_id}")
            return [SlotSet("app_id", app_id)]
        
        return []


# --- 8. Custom Action: Dynamic Greeting ---


class ActionGdprConsent(Action):
    """Show the GDPR consent dialog before transferring user data to an operator."""

    def name(self) -> Text:
        return "action_gdpr_consent"

    def run(self, dispatcher: CollectingDispatcher,
            tracker: Tracker, domain: Dict[Text, Any]) -> List:

        cfg = _get_handoff_runtime_cfg()
        if not cfg.get('gdpr', {}).get('consent_required', True):
            # Consent not required — skip straight to confirm
            return [FollowupAction('action_confirm_handoff')]

        dispatcher.utter_message(response='utter_gdpr_consent_request')
        return []


class ActionConfirmGdprConsent(Action):
    """User agreed to GDPR — record consent and proceed to queue."""

    def name(self) -> Text:
        return "action_confirm_gdpr_consent"

    def run(self, dispatcher: CollectingDispatcher,
            tracker: Tracker, domain: Dict[Text, Any]) -> List:

        return [
            SlotSet('consent_given', True),
            FollowupAction('action_confirm_handoff')
        ]


class ActionDenyGdprConsent(Action):
    """User refused GDPR consent — reset handoff state and return to normal."""

    def name(self) -> Text:
        return "action_deny_gdpr_consent"

    def run(self, dispatcher: CollectingDispatcher,
            tracker: Tracker, domain: Dict[Text, Any]) -> List:

        dispatcher.utter_message(response='utter_handoff_cancelled')
        return [
            SlotSet('consent_given', False),
            SlotSet('handoff_state', 'bot_active'),
            SlotSet('low_conf_streak', 0.0),
            SlotSet('frustration_score', 0.0),
            SlotSet('queue_id', None),
            SlotSet('queue_position', None),
            SlotSet('wait_estimate_mins', None),
        ]


