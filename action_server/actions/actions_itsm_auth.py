"""
Auth/session actions.

Login is handled by IAM SSO at the app/widget layer and ITSM calls use the
per-request IAM JWT, so the bot no longer performs credential login or a session
bootstrap. These actions are kept (referenced by stories/rules) but are now thin,
ITSM/IAM-aware no-ops — no ITSM.
"""
import logging
from typing import Text, List, Any, Dict

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet
from rasa_sdk.executor import CollectingDispatcher

from common import analytics_store
from action_server.actions._shared import get_analytics_context, logger


class ActionItsmLogin(Action):
    """Login is via IAM SSO (the app/widget handles it). If a login intent is
    reached, guide the user instead of collecting credentials."""

    def name(self) -> Text:
        return "action_itsm_login"

    async def run(self, dispatcher: CollectingDispatcher, tracker: Tracker,
                  domain: Dict[Text, Any]) -> List[Dict[Text, Any]]:
        if tracker.get_slot("is_authenticated"):
            dispatcher.utter_message(text="✅ You're already signed in. How can I help?")
        else:
            dispatcher.utter_message(text="🔐 Please use the **Sign in** button to log in securely.")
        return [SlotSet("itsm_username", None), SlotSet("itsm_password", None)]


class ActionInitItsmSession(Action):
    """Formerly initialised a ITSM session. ITSM authenticates each request with
    the IAM JWT, so there's no session to bootstrap — this just records analytics
    and resolves app_id from slot/metadata."""

    def name(self) -> Text:
        return "action_init_itsm_session"

    async def run(self, dispatcher: CollectingDispatcher, tracker: Tracker,
                  domain: Dict[Text, Any]) -> List[Dict[Text, Any]]:
        try:
            app_id = tracker.get_slot("app_id")
            if not app_id:
                latest = tracker.latest_message
                if isinstance(latest, dict):
                    md = latest.get("metadata") or {}
                    if isinstance(md, dict):
                        app_id = md.get("app_id")

            sender_id = tracker.sender_id
            user_id = tracker.get_slot("itsm_user_name") or tracker.get_slot("itsm_user_id")
            analytics_store.log_conversation_start(sender_id, app_id or "General", user_id=user_id)

            latest = tracker.latest_message
            intent = latest.get("intent", {}).get("name", "unknown") if isinstance(latest, dict) else "unknown"
            user_text = latest.get("text", "") if isinstance(latest, dict) else str(latest)
            ctx = get_analytics_context(tracker)
            analytics_store.log_message(sender_id, "user", user_text, intent,
                                        app_id=ctx["app_id"], user_id=ctx["user_id"],
                                        ticket_id=ctx["ticket_id"])
            return [SlotSet("app_id", app_id)]
        except Exception as e:
            logger.error(f"Error in action_init_itsm_session: {e}")
            return []
