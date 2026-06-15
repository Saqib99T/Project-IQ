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
)


class ActionGlpiLogin(Action):
    """Authenticates user with GLPI using username and password."""
    
    def name(self) -> Text:
        return "action_glpi_login"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        print("DEBUG: ActionGlpiLogin.run() CALLED")
        try:
            # Get credentials from slots and strip whitespace
            username = (tracker.get_slot("glpi_username") or "").strip()
            password = (tracker.get_slot("glpi_password") or "").strip()
            
            # Debug logging (masked password)
            masked_pw = "*" * len(password) if password else "None"
            print(f"DEBUG: Credentials received - User: '{username}', Password: '{masked_pw}'")
            
            if not username or not password:
                dispatcher.utter_message(
                    text="❌ Please provide both username and password.",
                    json_message={"login_error": True, "error": "Missing credentials"}
                )
                return [SlotSet("is_authenticated", False)]
            
            # Attempt login with GLPI
            service = get_glpi_service()
            print(f"DEBUG: Connecting to GLPI at: {service.api_uri}")
            
            result = await service.login_with_credentials(username, password)
            
            if result["success"]:
                # Block admin and operator accounts from using the chatbot
                profile_id   = result.get("profile_id")
                profile_name = (result.get("profile_name") or "").strip()
                _admin_ids   = [4]
                _admin_names = ["Super-Admin"]

                if profile_id in _admin_ids or profile_name in _admin_names:
                    await service.kill_session(result["session_token"])
                    dispatcher.utter_message(
                        text="⛔ Admin accounts are not permitted to use the chatbot.\n"
                             "Please use the **Admin Panel** at `/admin`.",
                        json_message={"login_error": True, "error": "admin_account"}
                    )
                    return [SlotSet("is_authenticated", False),
                            SlotSet("glpi_username", None), SlotSet("glpi_password", None)]

                # Block registered operator accounts
                try:
                    from common.conversation_db import get_operator_by_username
                    if get_operator_by_username(username):
                        await service.kill_session(result["session_token"])
                        dispatcher.utter_message(
                            text="⛔ Support staff accounts cannot log in here.\n"
                                 "Please use the **Operator Console** at `/opt`.",
                            json_message={"login_error": True, "error": "operator_account"}
                        )
                        return [SlotSet("is_authenticated", False),
                                SlotSet("glpi_username", None), SlotSet("glpi_password", None)]
                except Exception:
                    pass  # DB unavailable — allow login (fail open for users)

                # Login successful
                user_display = result.get("user_firstname") or result.get("user_name") or username
                
                # Log conversation start for analytics with user info
                sender_id = tracker.sender_id
                app_id = tracker.get_slot("app_id") or "General"
                user_id = result.get("user_name") or result.get("user_id")
                analytics_store.log_conversation_start(sender_id, app_id, user_id=user_id)
                
                # Send welcome text with buttons
                dispatcher.utter_message(
                    text=f"""👋 **Welcome, {user_display}!** You are now logged in.

I'm here to help you with your IT needs. Here's what I can do:

🎫 **Create a Ticket** - Report issues or request assistance
📋 **View My Tickets** - See all your open and closed tickets
🔍 **Check Ticket Status** - Get updates on a specific ticket
📚 **Search Knowledge Base** - Find solutions before creating a ticket

How can I assist you today?""",
                    buttons=[
                        {"title": "🎫 Create Ticket", "payload": "/create_ticket"},
                        {"title": "📋 View My Tickets", "payload": "/list_tickets"},
                        {"title": "🔍 Check Status", "payload": "/check_status"}
                    ]
                )
                
                # Send login status as separate custom payload
                dispatcher.utter_message(
                    json_message={
                        "login_success": True,
                        "user_name": result.get("user_name"),
                        "user_firstname": result.get("user_firstname"),
                        "session_token": result.get("session_token")
                    }
                )
                
                logger.info(f"GLPI login successful for user: {username}")
                
                return [
                    SlotSet("is_authenticated", True),
                    SlotSet("session_token", result["session_token"]),
                    SlotSet("glpi_user_id", result.get("user_id")),
                    SlotSet("glpi_user_name", result.get("user_name")),
                    SlotSet("glpi_password", None)  # Clear password from slot
                ]
            else:
                # Login failed
                error_msg = result.get("error", "Invalid credentials")
                logger.error(f"Login failed for user {username}: {error_msg}")
                
                dispatcher.utter_message(
                    text=f"❌ Login failed for user '{username}'. {error_msg}",
                    json_message={"login_error": True, "error": error_msg}
                )
                
                logger.warning(f"GLPI login failed for user: {username} - {error_msg}")
                
                return [
                    SlotSet("is_authenticated", False),
                    SlotSet("glpi_username", None), # Clear username so form asks again
                    SlotSet("glpi_password", None)  # Clear password
                ]
                
        except Exception as e:
            logger.error(f"Error in ActionGlpiLogin: {e}")
            dispatcher.utter_message(
                text=f"❌ An error occurred during login. Please try again.",
                json_message={"login_error": True, "error": str(e)}
            )
            return [SlotSet("is_authenticated", False)]


# --- 0. Custom Action: Initialize GLPI Session ---


class ActionInitGlpiSession(Action):
    def name(self) -> Text:
        return "action_init_glpi_session"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        try:
            print(f"DEBUG: Entering action_init_glpi_session")
            logger.info("DEBUG: Entering action_init_glpi_session")
            logger.info(f"DEBUG: Slots: {tracker.slots}")
            session_token = await glpi_service.init_session()
            
            if session_token:
                logger.info("GLPI session initialized successfully.")
                
                # --- Set Entity Context (GLPI-side filtering) ---
                app_id = tracker.get_slot("app_id")
                if not app_id:
                    latest_msg = tracker.latest_message
                    metadata = {}
                    if isinstance(latest_msg, dict):
                        metadata = latest_msg.get("metadata", {})
                    
                    if isinstance(metadata, str):
                        try:
                            metadata = json.loads(metadata)
                        except:
                            metadata = {}
                    elif metadata is None:
                        metadata = {}
                    
                    if isinstance(metadata, dict):
                        app_id = metadata.get("app_id")
                
                entity_id_map = {
                    "Root": 0,
                    "IT": 1,
                    "Accounting": 2,
                }
                target_entity_id = entity_id_map.get(app_id, 0)  # Default to Root
                
                # Call changeActiveEntities to scope all subsequent calls
                entity_switched = await glpi_service.change_active_entities(
                    session_token, target_entity_id, is_recursive=True
                )
                if entity_switched:
                    logger.info(f"GLPI entity context set to: {app_id} (ID: {target_entity_id})")
                else:
                    logger.warning(f"Failed to set GLPI entity context to {app_id}")
                # ------------------------------------------------
                
                # Log conversation start for analytics with user info
                sender_id = tracker.sender_id
                user_id = tracker.get_slot("glpi_user_name") or tracker.get_slot("glpi_user_id")
                analytics_store.log_conversation_start(sender_id, app_id or "General", user_id=user_id)
                
                # Log the user's initial intent with analytics context
                intent = "unknown"
                latest_msg = tracker.latest_message
                if isinstance(latest_msg, dict):
                    intent = latest_msg.get("intent", {}).get("name", "unknown")
                
                user_text = tracker.latest_message.get("text", "") if isinstance(latest_msg, dict) else str(latest_msg)
                ctx = get_analytics_context(tracker)
                analytics_store.log_message(sender_id, "user", user_text, intent, app_id=ctx["app_id"], user_id=ctx["user_id"], ticket_id=ctx["ticket_id"])
                
                return [SlotSet("svc_session_token", session_token), SlotSet("app_id", app_id)]
            else:
                logger.error("GLPI InitSession failed.")
                dispatcher.utter_message(text="❌ Authentication failed. Could not start session.")
                return [SlotSet("svc_session_token", None)]
        except Exception as e:
            logger.error(f"Error in ActionInitGlpiSession: {e}")
            dispatcher.utter_message(text=f"Error in Init Session: {e}")
            return []


# --- 1. Custom Action: Create Ticket ---


