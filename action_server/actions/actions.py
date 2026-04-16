# actions.py

import os
import sys

# Add project root to path for cross-package imports
project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import logging
import json
import re
import datetime
import traceback
from typing import Text, List, Any, Dict, Optional

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet, AllSlotsReset, Restarted, ActiveLoop, UserUttered, FollowupAction
from rasa_sdk.forms import FormValidationAction
from rasa_sdk.executor import CollectingDispatcher
from action_server.actions.glpi_service import GlpiService
from common import analytics_store
from common.config_manager import get_glpi_config

logger = logging.getLogger(__name__)


def get_glpi_service() -> GlpiService:
    """Get GLPI service instance with current config settings."""
    config = get_glpi_config()
    return GlpiService(
        config['api_url'],
        config['app_token'],
        config['user_token']
    )


def get_glpi_base_url() -> str:
    """Derive GLPI web base URL from config (strips /apirest.php)."""
    api_url = get_glpi_config().get('api_url', 'http://127.0.0.1:8083/apirest.php')
    return api_url.replace('/apirest.php', '').rstrip('/')


def log_bot_response(tracker: Tracker, text: str):
    """Log bot response - DISABLED (Handled by CustomTrackerStore)."""
    pass


def get_analytics_context(tracker: Tracker) -> Dict[str, str]:
    """Extract app_id, user_id, and ticket_id from tracker for analytics logging."""
    # Safely get metadata
    latest_msg = tracker.latest_message
    metadata = {}
    if isinstance(latest_msg, dict):
        metadata = latest_msg.get("metadata", {})

    # Handle cases where metadata might be a string (JSON) or None
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except:
            metadata = {}
    elif metadata is None:
        metadata = {}

    app_id = metadata.get("app_id") if isinstance(metadata, dict) else None
    app_id = app_id or tracker.get_slot("app_id") or "General"

    # Get user_id from slot (set after GLPI login)
    user_id = tracker.get_slot("glpi_user_name") or tracker.get_slot("glpi_user_id")

    # Get ticket_id from slot if available (set during ticket operations)
    # This persists across the conversation session after a ticket is created/viewed
    ticket_id = tracker.get_slot("ticket_id") or tracker.get_slot("current_ticket_id")

    # Get current intent for logging purposes
    intent = tracker.latest_message.get("intent", {}).get("name", "") if tracker.latest_message else ""

    # Debug logging
    logger.debug(f"Analytics context - app_id: {app_id}, user_id: {user_id}, ticket_id: {ticket_id}, intent: {intent}")

    return {
        "app_id": app_id,
        "user_id": user_id,
        "ticket_id": str(ticket_id) if ticket_id else None
    }


def check_user_login(tracker: Tracker, dispatcher: CollectingDispatcher) -> bool:
    """Check if user is logged in. If not, prompt them to login with a button.

    Returns:
        True if user is logged in, False otherwise
    """
    is_authenticated = tracker.get_slot("is_authenticated")
    session_token = tracker.get_slot("session_token")
    glpi_user_id = tracker.get_slot("glpi_user_id")
    glpi_user_name = tracker.get_slot("glpi_user_name")

    logger.info(f"LOGIN CHECK - is_authenticated: {is_authenticated}, session_token: {bool(session_token)}, glpi_user_id: {glpi_user_id}, glpi_user_name: {glpi_user_name}")

    if not is_authenticated:
        logger.info("LOGIN CHECK FAILED - user not authenticated")
        dispatcher.utter_message(
            text="🔐 **Login Required**\n\nTo perform ticket operations, please login with your Project IQ credentials.",
            buttons=[
                {"title": "🔑 Login Now", "payload": "/login"},
                {"title": "📚 Search KB Instead", "payload": "/ask_knowledge"}
            ]
        )
        return False

    logger.info("LOGIN CHECK PASSED")
    return True


# Legacy global reference (for backward compatibility)
glpi_service = get_glpi_service()


# --- GLPI User Login Action ---
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
                
                return [SlotSet("session_token", session_token), SlotSet("app_id", app_id)]
            else:
                logger.error("GLPI InitSession failed.")
                dispatcher.utter_message(text="❌ Authentication failed. Could not start GLPI session.")
                return [SlotSet("session_token", None)]
        except Exception as e:
            logger.error(f"Error in ActionInitGlpiSession: {e}")
            dispatcher.utter_message(text=f"Error in Init Session: {e}")
            return []


# --- 1. Custom Action: Create Ticket ---
class ActionCreateGlpiTicket(Action):
    def name(self) -> Text:
        return "action_create_glpi_ticket"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # Check if user is logged in
        if not check_user_login(tracker, dispatcher):
            return [SlotSet("ticket_id", None)]

        # 1. Check for the required session token
        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="GLPI session is not active. Please start over.")
            return [SlotSet("ticket_id", None)]

        # 2. Retrieve form slots
        ticket_title = tracker.get_slot("ticket_title") 
        ticket_content = tracker.get_slot("ticket_content") 
        issue_type = tracker.get_slot("issue_type")
        urgency = tracker.get_slot("urgency")

        # 3. Map Rasa Slots to GLPI format
        urgency_map = {"Low": 1, "Medium": 3, "High": 5}
        
        # Context-Aware Category Mapping
        app_id = tracker.get_slot("app_id")
        
        if app_id == "Accounting": # Accounting Context
            category_id_map = {
                "Hardware": 10, # Example: Accounting Hardware
                "Software": 11, # Example: Accounting Software
                "Network": 12,
                "Other": 2     # Accounting General
            }
        else: # Default (IT)
            category_id_map = {"Hardware": 4, "Software": 6, "Network": 8, "Other": 1}        # Entity Mapping
        app_id = tracker.get_slot("app_id")
        if not app_id:
             latest_msg = tracker.latest_message
             if isinstance(latest_msg, dict):
                 app_id = latest_msg.get("metadata", {}).get("app_id")

        # Entity context is already set in ActionInitGlpiSession
        # GLPI will automatically use the active entity for new tickets
        
        ticket_data = {
            "name": f"[{app_id or 'General'}] {ticket_title}", # Tag title with App ID for visibility       
            "content": ticket_content,    
            "urgency": urgency_map.get(urgency, 3),
            "itilcategories_id": category_id_map.get(issue_type, 1),
            "users_id_requester": 1, 
        }

        # Map app_id to entity_id for GLPI-Entity header
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)  # Default to IT (1)

        # 4. Use Service to Create Ticket
        new_ticket_id = await glpi_service.create_ticket(session_token, ticket_data, entity_id)
        
        if new_ticket_id:
            ticket_ref = f"GLPI-{new_ticket_id}"
            response_text = f"✅ Success! Your new ticket **{ticket_ref}** has been created in GLPI."
            dispatcher.utter_message(
                text=response_text,
                buttons=[
                    {"title": "🔍 Check its status", "payload": "/check_status"},
                    {"title": "📋 List my tickets", "payload": "/list_tickets"},
                    {"title": "🎫 Create another", "payload": "/create_ticket"},
                ]
            )
            log_bot_response(tracker, response_text)
            return [
                SlotSet("ticket_id", ticket_ref),
                SlotSet("ticket_title", None),
                SlotSet("ticket_content", None),
                SlotSet("issue_type", None),
                SlotSet("urgency", None),
            ]
        else:
            response_text = "❌ Failed to create ticket. Please check API credentials and URL."
            dispatcher.utter_message(text=response_text)
            log_bot_response(tracker, response_text)
            return []


# --- 2. Custom Action: Check Status ---
class ActionCheckGlpiStatus(Action):
    def name(self) -> Text:
        return "action_check_glpi_status"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        print(f"DEBUG: Entering action_check_glpi_status")
        logger.info("DEBUG: Entering action_check_glpi_status")

        # Check if user is logged in
        if not check_user_login(tracker, dispatcher):
            return [SlotSet("ticket_id", None)]

        # 1. Check for the required session token
        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="GLPI session is not active. Please start over.")
            return [SlotSet("ticket_id", None)]
        
        ticket_id_slot = tracker.get_slot("ticket_id")
        
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        ticket_number = ticket_id_slot.upper().replace('GLPI-', '')
        
        # Entity context is set in ActionInitGlpiSession
        # GLPI should only return tickets in the active entity
        app_id = tracker.get_slot("app_id")
        logger.info(f"ActionCheckGlpiStatus: Checking ticket {ticket_number} for app_id={app_id}")

        # Map app_id to entity_id for GLPI-Entity header
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)  # Default to IT (1)

        # 2. Use Service to Get Ticket
        ticket_data = await glpi_service.get_ticket(session_token, ticket_number, entity_id)

        if ticket_data:
            # --- Entity Access Control ---
            app_id = tracker.get_slot("app_id")
            if not app_id:
                app_id = tracker.latest_message.get("metadata", {}).get("app_id")

            entity_id_map = {
                "Root": 0,    # Root Entity (Default)
                "IT": 1,   # IT Entity
                "Accounting": 2,   # Accounting Entity
            }
            # Default to 0 (IT) if app_id is None, effectively restricting "Unknown" context to IT.
            # Or should we be more lenient? The requirement says "tickets against app-id only".
            expected_entity_id = entity_id_map.get(app_id, 0)
            
            # glpi_service.get_ticket returns raw data. entities_id is usually an integer or a dict/list if expanded.
            # Checking type just in case.
            ticket_entity = ticket_data.get("entities_id")
            
            # If ticket_entity is complex (e.g. list/dict), try to extract ID. 
            # Standard REST API usually returns int unless expand_dropdowns is set.
            # We assume int here based on typical usage, but let's be safe if it's 0 vs '0'
            try:
                ticket_entity_id = int(ticket_entity)
            except (ValueError, TypeError):
                ticket_entity_id = 0 # Fallback
                
            if ticket_entity_id != expected_entity_id:
                logger.warning(f"Access Denied: Ticket {ticket_id_slot} (Entity {ticket_entity_id}) does not belong to App Context {app_id} (Entity {expected_entity_id})")
                dispatcher.utter_message(text=f"❌ **Invalid ticket.** Ticket **{ticket_id_slot}** does not belong to the **{app_id or 'IT'}** department.")
                return [SlotSet("ticket_id", None)]
            # -----------------------------
            status_map = {
                1: "New", 2: "Processing (Assigned)", 3: "Processing (Planned)", 
                4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
            }
            
            current_status_id = ticket_data.get("status")
            current_status = status_map.get(current_status_id, "Unknown Status")
            title = ticket_data.get("name", "No Title")
            date_creation = ticket_data.get("date_creation", "N/A")
            date_mod = ticket_data.get("date_mod", "N/A")
            
            # Simple content clean up (strip HTML loosely if needed or just show snippet)
            # content = ticket_data.get("content", "")[:100] + "..."

            message = f"**Ticket Details: {ticket_id_slot}**\n\n"
            message += "| Property | Value |\n"
            message += "| :--- | :--- |\n"
            message += f"| **Status** | {current_status} |\n"
            message += f"| **Title** | {title} |\n"
            message += f"| **Created** | {date_creation} |\n"
            message += f"| **Updated** | {date_mod} |\n"

            dispatcher.utter_message(
                text=message,
                buttons=[
                    {"title": "📝 Update this ticket", "payload": "/update_ticket"},
                    {"title": "✅ Close ticket", "payload": "/verify_resolution"},
                    {"title": "📋 List all tickets", "payload": "/list_tickets"},
                ]
            )
            log_bot_response(tracker, message)
            return [SlotSet("ticket_status", current_status)]
        else:
            error_msg = "❌ Could not retrieve ticket status (Not Found or API Error)."
            dispatcher.utter_message(text=error_msg)
            log_bot_response(tracker, error_msg)
            return [SlotSet("ticket_id", None)]


# --- 3. Custom Action: Update Ticket (Status or Content) ---
class ActionUpdateGlpiTicket(Action):
    def name(self) -> Text:
        return "action_update_glpi_ticket"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # Check if user is logged in
        if not check_user_login(tracker, dispatcher):
            return []

        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="GLPI session is not active. Please start over.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        
        # 1. Ask for Ticket ID if missing
        if not ticket_id_slot:
             dispatcher.utter_message(response="utter_ask_ticket_id")
             return []
        
        ticket_number = int(ticket_id_slot.upper().replace('GLPI-', ''))
        
        # 2. Check if we have a target_status OR update_content
        target_status = tracker.get_slot("target_status")
        update_content = tracker.get_slot("update_content")

        if target_status:
            # Handle Status Update
            status_map = {
                "New": 1, "Processing (Assigned)": 2, "Processing (Planned)": 3, 
                "Pending": 4, "Solved": 5, "Closed": 6, "Approved": 10
            }
            # Allow case-insensitive matching if direct input, or exact from buttons
            # Simple fuzzy match attempt or direct map
            status_id = status_map.get(target_status)
            if not status_id:
                # Try simple lookups
                if "processing" in target_status.lower(): status_id = 2
                elif "pending" in target_status.lower(): status_id = 4
                elif "solved" in target_status.lower(): status_id = 5
                elif "closed" in target_status.lower(): status_id = 6
                else:
                    dispatcher.utter_message(text=f"I didn't recognize expectations for status '{target_status}'.")
                    return [SlotSet("target_status", None)]

            success = await glpi_service.update_ticket_status(session_token, ticket_number, status_id)
            if success:
                 dispatcher.utter_message(text=f"✅ Ticket **{ticket_id_slot}** status updated to **{target_status}**.")
                 if status_id == 6: # Closed
                     dispatcher.utter_message(response="utter_ask_satisfaction")
                 return [SlotSet("target_status", None), SlotSet("ticket_status", target_status)]
            else:
                 dispatcher.utter_message(text="❌ Failed to update ticket status.")
                 return [SlotSet("target_status", None)]

        elif update_content:
            # Handle Comment Update
            success = await glpi_service.add_ticket_followup(session_token, ticket_number, update_content)
            if success:
                dispatcher.utter_message(text=f"✅ Added comment to ticket **{ticket_id_slot}**.")
                return [SlotSet("update_content", None)]
            else:
                dispatcher.utter_message(text="❌ Failed to add comment.")
                return []
        else:
            # 3. If neither provided, Show Status and Ask
            ticket_data = await glpi_service.get_ticket(session_token, ticket_number)
            if ticket_data:
                status_map_rev = {
                    1: "New", 2: "Processing (Assigned)", 3: "Processing (Planned)", 
                    4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
                }
                curr_status = status_map_rev.get(ticket_data.get("status"), "Unknown")
                
                # Show status and buttons via utter_ask_target_status
                dispatcher.utter_message(
                    response="utter_ask_target_status", 
                    ticket_status=curr_status
                )
                # We return SlotSet("ticket_status", curr_status) so the slot is filled for the message
                return [SlotSet("ticket_status", curr_status)]
            else:
                dispatcher.utter_message(text="❌ Ticket not found.")
                return []

# --- 4. Custom Action: Verify Resolution (Show Status & Close) ---
class ActionVerifyGlpiResolution(Action):
    def name(self) -> Text:
        return "action_verify_glpi_resolution"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="GLPI session is not active.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []

        ticket_number = int(ticket_id_slot.upper().replace('GLPI-', ''))
        
        # Check if we assume 'affirm' means 'Close it'
        # But we need a way to track if we just showed the status.
        # Simplest approach logic:
        # If last intent was 'verify_resolution', show status and ask.
        # If last intent was 'affirm', close it.
        # However, custom actions don't easily persist state this way without slots.
        
        # Let's leverage the 'target_status' slot again.
        # If target_status is explicitly 'Closed', we close.
        # If not, we show status and set a button to Close.
        
        target_status = tracker.get_slot("target_status")
        
        if target_status == "Solved":
             success = await glpi_service.update_ticket_status(session_token, ticket_number, 5)
             if success:
                dispatcher.utter_message(text=f"✅ Ticket **{ticket_id_slot}** has been marked as **Solved**. Glad I could help!")
                dispatcher.utter_message(response="utter_ask_satisfaction")
                return [SlotSet("ticket_status", "Solved"), SlotSet("target_status", None)]
             else:
                dispatcher.utter_message(text="❌ Failed to solve the ticket.")
                return [SlotSet("target_status", None)]
        
        # Fetch current status
        ticket_data = await glpi_service.get_ticket(session_token, ticket_number)
        if ticket_data:
            status_map_rev = {
                1: "New", 2: "Processing (Assigned)", 3: "Processing (Planned)", 
                4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
            }
            curr_status = status_map_rev.get(ticket_data.get("status"), "Unknown")
            
            if curr_status == "Solved" or curr_status == "Closed":
                dispatcher.utter_message(text=f"Ticket **{ticket_id_slot}** is already **{curr_status}**.")
                return [SlotSet("ticket_status", curr_status)]

            # Ask to confirm closure
            dispatcher.utter_message(
                text=f"Ticket **{ticket_id_slot}** is currently **{curr_status}**. Do you want to mark it as **Solved**?",
                buttons=[
                    {"title": "Yes, Mark as Solved", "payload": '/inform_update{"target_status":"Solved"}'},
                    {"title": "No, keep it open", "payload": '/deny'} 
                ]
            )
            return [SlotSet("ticket_status", curr_status)]
        else:
            dispatcher.utter_message(text="❌ Ticket not found.")
            return []


# --- 5. Helper Action: Deactivate Form and Clear Slots ---
class ActionDeactivateForm(Action):
    def name(self) -> Text:
        return "action_deactivate_form"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        return [
            ActiveLoop(None),
            SlotSet("ticket_title", None), 
            SlotSet("ticket_content", None), 
            SlotSet("issue_type", None),
            SlotSet("urgency", None),
        ]


# --- 6. Custom Action: View Ticket Comments ---
class ActionViewTicketComments(Action):
    def name(self) -> Text:
        return "action_view_ticket_comments"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # Check if user is logged in
        if not check_user_login(tracker, dispatcher):
            return []

        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="GLPI session is not active.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        if not ticket_id_slot:
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []
        
        ticket_number = int(ticket_id_slot.upper().replace('GLPI-', ''))
        
        followups = await glpi_service.get_ticket_followups(session_token, ticket_number)
        
        if not followups:
             dispatcher.utter_message(text=f"No comments found for ticket **{ticket_id_slot}**.")
             return []
        
        # Sort by date (assuming 'date' field exists, otherwise rely on list order)
        # GLPI usually returns them in order, but let's be safe.
        followups.sort(key=lambda x: x.get('date', ''))
        
        # Limit to last 5 for readability
        recent_comments = followups[-5:]
        
        message = f"**Recent comments for {ticket_id_slot}:**\n\n"
        for comment in recent_comments:
            # Strip HTML tags if necessary, GLPI content is HTML
            import re
            clean_content = re.sub('<[^<]+?>', '', comment.get('content', ''))
            user_id = comment.get('users_id')
            date = comment.get('date')
            message += f"📅 *{date}* (User {user_id}):\n{clean_content}\n\n"
            
        dispatcher.utter_message(text=message)
        return []


# --- 7. Custom Action: List Open Tickets ---
class ActionListOpenTickets(Action):
    def name(self) -> Text:
        return "action_list_open_tickets"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # Check if user is logged in
        if not check_user_login(tracker, dispatcher):
            return []

        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="GLPI session is not active.")
            return []

        # Determine if user wants ALL tickets or just OPEN ones
        latest_msg = tracker.latest_message
        user_text = latest_msg.get("text", "").lower() if isinstance(latest_msg, dict) else str(latest_msg).lower()
        history_keywords = ['all', 'history', 'closed', 'past', 'old', 'every']
        show_history = any(word in user_text for word in history_keywords)
        
        # Entity context is already set in ActionInitGlpiSession via changeActiveEntities
        # GLPI will automatically filter tickets to the active entity
        
        # Get app_id from slot first, then fallback to message metadata
        app_id = tracker.get_slot("app_id")
        latest_msg = tracker.latest_message
        if isinstance(latest_msg, dict):
            msg_metadata = latest_msg.get("metadata", {})
            if isinstance(msg_metadata, str):
                try:
                    msg_metadata = json.loads(msg_metadata)
                except:
                    msg_metadata = {}
            elif msg_metadata is None:
                msg_metadata = {}
            if isinstance(msg_metadata, dict) and msg_metadata.get("app_id"):
                app_id = msg_metadata.get("app_id")
        
        session_token = tracker.get_slot("session_token")
        
        # Check for status_id in custom payload entities
        status_id = None
        status_name = None
        
        # Try to parse from message text if it looks like JSON payload from button
        # e.g. /list_tickets{"status_id": 1}
        # Rasa usually extracts these into entities, but let's check manually if entities are missing
        latest_message = tracker.latest_message
        entities = latest_message.get("entities", [])
        text = latest_message.get("text", "")
        
        logger.info(f"DEBUG: latest_message text: '{text}'")
        logger.info(f"DEBUG: latest_message entities: {entities}")

        # Check entities first
        for e in entities:
             if e['entity'] == 'status_id':
                 status_id = int(e['value'])
                 break
        
        # Manual Fallback: Parse JSON from text if entity missing
        # e.g. /list_tickets{"status_id": 1}
        if status_id is None and text.startswith('/list_tickets{'):
            try:
                import json
                json_str = text.replace('/list_tickets', '')
                logger.info(f"DEBUG: Manual parsing json_str: '{json_str}'")
                data = json.loads(json_str)
                if 'status_id' in data:
                    status_id = int(data['status_id'])
            except Exception as e:
                logger.error(f"Failed to parse manual status_id: {e}") 
        
        logger.info(f"DEBUG: Final status_id: {status_id}")
        # But for custom payload buttons "/intent{json}", Rasa parses entities automatically.
        # Let's also check if we can get it from metadata or just passed arguments if any
        
        # status map for display
        status_map_rev = {
            1: "New", 2: "Processing (Assigned)", 3: "Processing (Planned)", 
            4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
        }
        
        if status_id:
             status_name = status_map_rev.get(status_id, f"Status {status_id}")

        # Map app_id to entity_id for GLPI-Entity header
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)  # Default to IT (1)
        logger.info(f"ActionListOpenTickets: app_id={app_id}, entity_id={entity_id}, status_id={status_id}")

        # Re-scope GLPI entity context in case app_id changed mid-session
        try:
            await glpi_service.change_active_entities(session_token, entity_id, is_recursive=True)
        except Exception as e:
            logger.warning(f"Failed to switch GLPI entity context: {e}")

        # Call service (GLPI returns only tickets visible in current entity context)
        # If status_id is set, active_only should technically be ignored by the service if we rely on criteria,
        # but let's be explicit: if looking for Closed (6), then active_only must be False.
        
        filter_active = not show_history
        if status_id is not None:
             filter_active = False # Let status_id dictate
             
        tickets = await glpi_service.get_user_tickets(session_token, active_only=filter_active, entity_id=entity_id, status_id=status_id)
        
        if not tickets:
             target_dept = app_id if app_id else "Root"
             filter_text = f" with status **{status_name}**" if status_name else ""
             dispatcher.utter_message(text=f"You have no tickets{filter_text} in the **{target_dept}** department.")
             return []
        
        # Header
        context_title = f"Tickets ({status_name})" if status_name else ("Ticket History" if show_history else "Your Open Tickets")
        message = f"**📂 {context_title}**\n\n"
        
        # Table Header
        message += "| ID | Status | Title | Updated |\n"
        message += "| :--- | :--- | :--- | :--- |\n"

        for t in tickets[:15]: # Limit increased to 15
            tid = t.get('id')
            title = t.get('name', 'No Title')
            # Escape pipes in title to prevent breaking table
            title = title.replace('|', '-')
            
            t_status_id = t.get('status')
            date_mod = t.get('date_mod', 'N/A').split(" ")[0] # Just date, no time
            
            status_str = status_map_rev.get(t_status_id, "Unknown")
            
            # Truncate title
            title_short = (title[:25] + '..') if len(title) > 25 else title
            
            message += f"| **{tid}** | {status_str} | {title_short} | {date_mod} |\n"
            
        dispatcher.utter_message(
            text=message,
            buttons=[
                {"title": "📊 View Graph", "payload": "/show_ticket_graph"},
                {"title": "🔍 Check ticket status", "payload": "/check_status"},
                {"title": "🎫 Create new ticket", "payload": "/create_ticket"},
            ]
        )
        return []

class ActionUploadFile(Action):
    def name(self) -> Text:
        return "action_upload_file"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # Check if user is logged in
        if not check_user_login(tracker, dispatcher):
            return []

        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="GLPI session is not active cannot upload.")
            return []

        file_name = tracker.get_slot("file_name")
        file_data = tracker.get_slot("file_data")
        ticket_id = tracker.get_slot("ticket_id") # context

        if not file_name or not file_data:
            if ticket_id:
                 clean_id = ticket_id.replace("GLPI-", "") if isinstance(ticket_id, str) else ticket_id
                 dispatcher.utter_message(text=f"Please upload the file using the paperclip icon for ticket **{clean_id}**.")
            else:
                 dispatcher.utter_message(text="Please drag and drop a file or use the attachment icon to upload.")
            return []

        # Upload
        doc_id = await glpi_service.upload_document(session_token, file_name, file_data)
        
        if doc_id:
            msg = f"✅ **File Uploaded!** (Doc ID: {doc_id})\n"
            
            # Link to ticket if context exists
            if ticket_id:
                # Cleanup ID if it has prefix
                clean_id = ticket_id.replace("GLPI-", "") if isinstance(ticket_id, str) else ticket_id
                clean_id = ticket_id.replace("GLPI-", "").replace("TICKET-", "") if isinstance(ticket_id, str) else ticket_id
                
                success = await glpi_service.link_document_to_ticket(session_token, clean_id, doc_id)
                if success:
                    msg += f"🔗 Successfully attached to Ticket **TICKET-{clean_id}**."
                else:
                    msg += f"⚠️ Uploaded, but **failed to link** to Ticket TICKET-{clean_id}."
            else:
                 msg += "ℹ️ File is in GLPI documents, but **not attached** to any ticket.\nTip: Open or create a ticket first to attach files automatically."
            
            dispatcher.utter_message(text=msg)
            return [SlotSet("file_name", None), SlotSet("file_data", None)]
        dispatcher.utter_message(text="❌ Failed to upload file to GLPI.")
        return []

class ActionListAttachments(Action):
    def name(self) -> Text:
        return "action_list_attachments"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        logger.info("DEBUG: ActionListAttachments started")

        # Check if user is logged in
        if not check_user_login(tracker, dispatcher):
            return []

        session_token = tracker.get_slot("session_token")
        if not session_token:
            logger.info("DEBUG: No session token found")
            dispatcher.utter_message(text="GLPI session is not active.")
            return []

        ticket_id_slot = tracker.get_slot("ticket_id")
        logger.info(f"DEBUG: Ticket ID slot is {ticket_id_slot}")
        if not ticket_id_slot:
            logger.info("DEBUG: No ticket_id slot")
            dispatcher.utter_message(response="utter_ask_ticket_id")
            return []
        
        try:
            ticket_number = int(ticket_id_slot.upper().replace('GLPI-', '').replace('TICKET-', ''))
            logger.info(f"DEBUG: Ticket number parsed: {ticket_number}")
        except Exception as e:
            logger.error(f"DEBUG: Failed to parse ticket number: {e}")
            dispatcher.utter_message(text=f"Invalid ticket ID format: {ticket_id_slot}")
            return []
        
        # Call service
        try:
            docs = await glpi_service.get_ticket_documents(session_token, ticket_number)
            logger.info(f"DEBUG: Docs returned: {docs}")
        except Exception as e:
             logger.error(f"DEBUG: API Call Failed: {e}")
             dispatcher.utter_message(text="Failed to retrieve attachments due to an error.")
             return []
        
        if not docs:
             logger.info("DEBUG: No docs found")
             dispatcher.utter_message(text=f"No attachments found for ticket **{ticket_id_slot}**.")
             return []
        
        message = f"**📎 Attachments for {ticket_id_slot}:**\n\n"
        message += "| ID | Name | Type | Action |\n"
        message += "| :--- | :--- | :--- | :--- |\n"
        
        for d in docs:
            doc_id = d.get('id')
            name = d.get('name', 'Document')
            filename = d.get('filename', '')
            mime = d.get('mime', 'application/octet-stream')
            
            # Simple Type Display
            if "image" in mime:
                type_icon = "🖼️ Image"
            elif "pdf" in mime:
                type_icon = "📄 PDF"
            else:
                type_icon = "📁 File"
                
            
            # Use config to get base URL
            config = get_glpi_config()
            api_url = config.get('api_url', '')
            base_url = api_url.replace('/apirest.php', '')
            download_link = f"[Download]({base_url}/front/document.send.php?docid={doc_id})"
            
            message += f"| {doc_id} | {filename or name} | {type_icon} | {download_link} |\n"

        logger.info(f"DEBUG: Sending message: {message}")
        dispatcher.utter_message(text=message)
        
        # Secondary pass: Show inline images if any
        # Note: This might fail if the user isn't logged into GLPI in their browser, 
        # as the image needs auth. Safe to skip or warn? 
        # Let's try to show the first image as a preview if possible, but safely.
        
        # Actually, without a public token, inline images usually break. 
        # Better to stick to the table for stability.
        
        return []

# --- 11. Custom Action: Clear Session ---
class ActionClearSession(Action):
    def name(self) -> Text:
        return "action_clear_session"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        # We can also kill the GLPI session on the server if we want strict cleanup
        session_token = tracker.get_slot("session_token")
        if session_token:
            await glpi_service.kill_session(session_token)
            
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
class ActionGreet(Action):
    def name(self) -> Text:
        return "action_greet"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        # Simple greeting - get app_id from metadata only (slots may not be set yet)
        try:
            latest_msg = tracker.latest_message
            if latest_msg and isinstance(latest_msg, dict):
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
        except Exception:
            pass
        
        dept_name = "IT"  # Default
        if app_id:
            if str(app_id).lower() in ["accounting", "acc"]:
                dept_name = "Accounting"
            elif str(app_id).lower() == "it":
                dept_name = "IT"
            else:
                dept_name = str(app_id)
        
        message = f"Hello! I'm your **{dept_name}** support bot. How can I help you today?"
        dispatcher.utter_message(
            text=message,
            buttons=[
                {"title": "📋 List my tickets", "payload": "/list_tickets"},
                {"title": "🎫 Create a ticket", "payload": "/create_ticket"},
                {"title": "🔍 Check ticket status", "payload": "/check_status"},
            ]
        )
        
        # Set the app_id slot for future actions
        return [SlotSet("app_id", app_id)] if app_id else []


# --- 13. Custom Action: Show Chart ---
class ActionShowChart(Action):
    """Returns chart data for visualization in the frontend."""
    
    def name(self) -> Text:
        return "action_show_chart"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        # Get chart type from slot or user message
        chart_type = tracker.get_slot("chart_type")
        latest_msg = tracker.latest_message
        user_text = latest_msg.get("text", "").lower() if isinstance(latest_msg, dict) else str(latest_msg).lower()
        
        # Detect chart type from message if not in slot
        if not chart_type:
            if any(word in user_text for word in ["sales", "revenue", "prediction", "forecast"]):
                chart_type = "sales_prediction"
            elif any(word in user_text for word in ["stock", "inventory", "history"]):
                chart_type = "stock_history"
            elif any(word in user_text for word in ["ticket", "support", "stats", "statistics"]):
                chart_type = "ticket_stats"
            elif any(word in user_text for word in ["department", "distribution", "pie", "breakdown"]):
                chart_type = "department_distribution"
            else:
                chart_type = "sales_prediction"  # Default
        
        # Generate dummy chart data based on type
        chart_data = self._generate_chart_data(chart_type)
        
        # Send custom payload with chart data
        dispatcher.utter_message(
            text=chart_data.get("description", "Here's the chart you requested:"),
            json_message={"chart": chart_data["chart"]}  # json_message wraps this in "custom" automatically
        )
        
        return [SlotSet("chart_type", None)]
    
    def _generate_chart_data(self, chart_type: str) -> Dict[str, Any]:
        """Generate dummy chart data based on chart type."""
        
        if chart_type == "sales_prediction":
            return {
                "description": "📊 **Sales Prediction** - Next 6 months forecast based on historical data:",
                "chart": {
                    "type": "line",
                    "title": "Sales Prediction (2024)",
                    "subtitle": "Forecasted revenue in thousands",
                    "labels": ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
                    "datasets": [
                        {
                            "label": "Actual",
                            "data": [42000, 48000, 51000, 55000, 0, 0],
                            "color": "#8B5CF6"
                        },
                        {
                            "label": "Predicted",
                            "data": [0, 0, 0, 55000, 62000, 68000],
                            "color": "#10B981"
                        }
                    ]
                }
            }
        
        elif chart_type == "stock_history":
            return {
                "description": "📈 **Stock History** - Inventory levels over the past quarter:",
                "chart": {
                    "type": "line",
                    "title": "Inventory Levels (Q4 2024)",
                    "subtitle": "Units in stock",
                    "labels": ["Oct", "Nov", "Dec", "Jan"],
                    "datasets": [
                        {
                            "label": "Product A",
                            "data": [1200, 950, 800, 1100],
                            "color": "#6366F1"
                        },
                        {
                            "label": "Product B",
                            "data": [800, 720, 650, 900],
                            "color": "#EC4899"
                        }
                    ]
                }
            }
        
        elif chart_type == "ticket_stats":
            return {
                "description": "🎫 **Support Ticket Statistics** - Monthly breakdown:",
                "chart": {
                    "type": "bar",
                    "title": "Tickets by Status",
                    "subtitle": "Last 4 months",
                    "labels": ["Oct", "Nov", "Dec", "Jan"],
                    "datasets": [
                        {
                            "label": "Open",
                            "data": [45, 52, 38, 41],
                            "color": "#F59E0B"
                        },
                        {
                            "label": "Resolved",
                            "data": [120, 135, 142, 128],
                            "color": "#10B981"
                        }
                    ]
                }
            }
        
        elif chart_type == "department_distribution":
            return {
                "description": "🏢 **Department Distribution** - Tickets by department:",
                "chart": {
                    "type": "pie",
                    "title": "Tickets by Department",
                    "labels": ["IT", "HR", "Finance", "Operations", "Sales"],
                    "datasets": [
                        {
                            "label": "Tickets",
                            "data": [45, 12, 18, 15, 10],
                            "color": "#8B5CF6"
                        }
                    ]
                }
            }
        
        else:
            # Default fallback
            return {
                "description": "📊 Here's a sample chart:",
                "chart": {
                    "type": "bar",
                    "title": "Sample Data",
                    "labels": ["A", "B", "C", "D"],
                    "datasets": [
                        {
                            "label": "Values",
                            "data": [25, 40, 30, 35],
                            "color": "#8B5CF6"
                        }
                    ]
                }
            }


# --- 14. Custom Action: Search Knowledge Base ---
class ActionSearchKnowledgeBase(Action):
    """Searches the knowledge base for relevant articles using hybrid semantic + keyword search."""

    def name(self) -> Text:
        return "action_search_knowledge_base"

    def __init__(self):
        # Import KB cache manager (will auto-initialize and start refresh)
        from admin.api.kb_cache_manager import kb_cache
        self.kb_cache = kb_cache
        
        # Import vector search for semantic similarity
        try:
            from common.vector_search import search_single, ensure_loaded
            self.vector_search = search_single
            ensure_loaded()
            self.use_vector_search = True
            logger.info("ActionSearchKnowledgeBase initialized with VECTOR search")
        except Exception as e:
            logger.warning(f"Vector search not available: {e}. Falling back to keyword search.")
            self.vector_search = None
            self.use_vector_search = False
        
        logger.info("ActionSearchKnowledgeBase initialized with KB cache manager")

    def _normalize_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", (text or "").strip().lower())

    def _build_article_link(self, glpi_id: Any) -> Optional[str]:
        try:
            if glpi_id:
                glpi_base_url = get_glpi_base_url()
                return f"{glpi_base_url}/front/knowbaseitem.form.php?id={glpi_id}"
        except Exception as e:
            logger.error(f"Failed to create article link: {e}")
        return None

    def _title_match_ratio(self, query: str, title: str) -> float:
        query_words = [w for w in re.split(r"\W+", (query or "").lower()) if w]
        title_words = [w for w in re.split(r"\W+", (title or "").lower()) if w]
        if not query_words or not title_words:
            return 0.0
        stopwords = {
            'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are',
            'how', 'you', 'your', 'can', 'will', 'not', 'but', 'was',
            'all', 'were', 'when', 'there', 'use', 'have', 'has', 'had'
        }
        query_set = {w for w in query_words if w not in stopwords}
        title_set = {w for w in title_words if w not in stopwords}
        if not query_set or not title_set:
            return 0.0
        overlap = len(query_set.intersection(title_set))
        return overlap / max(len(query_set), 1)

    def _parse_clarify_options(self, options_json: str) -> List[Dict[str, Any]]:
        try:
            if not options_json:
                return []
            return json.loads(options_json)
        except Exception:
            return []

    def _match_clarify_option(self, user_message: str, options: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        normalized = self._normalize_text(user_message)
        if not normalized:
            return None
        for option in options:
            title = self._normalize_text(option.get("title"))
            if title and (normalized == title or title in normalized or normalized in title):
                return option
        return None

    def _build_clarify_prompt(self, options: List[Dict[str, Any]]) -> (str, List[Dict[str, Any]]):
        summary_lines = []
        buttons = []
        for idx, opt in enumerate(options[:4], start=1):
            title = opt.get("title") or "More details"
            summary = (opt.get("summary") or "").strip()
            if summary:
                summary_lines.append(f"{idx}) **{title}** — {summary}")
            else:
                summary_lines.append(f"{idx}) **{title}**")
            buttons.append({"title": title[:60], "payload": title})

        if not buttons:
            buttons.append({"title": "Show full article", "payload": "/kb_show_full_article"})

        prompt_text = "I found the right article, but I need a bit more detail. Which section should I focus on?\n\n" + "\n".join(summary_lines)
        return prompt_text, buttons

    def _respond_with_section(self, dispatcher: CollectingDispatcher, section: Dict[str, Any], article: Dict[str, Any], section_score: float) -> List[Dict[str, Any]]:
        article_title = section.get('article_title') or article.get('title') or section.get('title')
        response = f"### 📚 {article_title}\n\n"
        if section.get('title') and section.get('title') != article_title:
            response += f"**Section:** {section.get('title')}\n\n"

        content = section.get('content', 'No content available.')
        sentences = re.split(r'(?<=[.!?])\s+', content.strip())
        short_section = '\n'.join(sentences[:4]).strip()
        if len(content) > len(short_section):
            short_section = f"{short_section.rstrip()}..."
        response += short_section

        glpi_id = section.get('glpi_id') or article.get('glpi_id')
        article_link = self._build_article_link(glpi_id)
        if glpi_id:
            response += f"\n\n_Source: GLPI KB (Article #{glpi_id})_"
        else:
            response += "\n\n_Source: Local KB_"

        response += "\n\nWould you like the full article or the KB link?"

        buttons = [
            {"title": "📄 Show full article", "payload": "/kb_show_full_article"},
        ]
        if article_link:
            buttons.append({"title": "🔗 Open KB link", "url": article_link})
        buttons.extend([
            {"title": "👍 This helped!", "payload": "/feedback_positive"},
            {"title": "👎 Not helpful", "payload": "/feedback_negative"},
            {"title": "🎫 Create a ticket", "payload": "/create_ticket"},
        ])

        dispatcher.utter_message(text=response, buttons=buttons)

        return [
            SlotSet("kb_last_article_title", article_title),
            SlotSet("kb_last_article_content", article.get('content') or ''),
            SlotSet("kb_last_source", section.get('source', 'unknown')),
            SlotSet("kb_last_glpi_id", glpi_id),
            SlotSet("kb_clarify_options", None),
            SlotSet("kb_clarify_attempts", 0),
            SlotSet("kb_target_article_id", None),
        ]

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:

        # Get user's original message
        latest_msg = tracker.latest_message
        user_message = latest_msg.get("text", "") if isinstance(latest_msg, dict) else str(latest_msg)
        app_id = tracker.get_slot("app_id")

        # Handle pending clarification
        clarify_options_json = tracker.get_slot("kb_clarify_options")
        target_article_id = tracker.get_slot("kb_target_article_id")
        if clarify_options_json and target_article_id:
            options = self._parse_clarify_options(clarify_options_json)
            selected = self._match_clarify_option(user_message, options)
            if selected:
                section = self.kb_cache.get_section_by_id(selected.get("section_id"))
                article = self.kb_cache.get_article_by_id(target_article_id) or {}
                if section:
                    logger.info(f"KB clarification resolved to section: {section.get('title')}")
                    return self._respond_with_section(dispatcher, section, article, selected.get("score", 0.0))

            # If user typed free text, re-run section search within target article
            section_results = []
            if getattr(self.kb_cache, 'section_search_enabled', False):
                section_results = self.kb_cache.search_sections(user_message, target_article_id)
                logger.info(
                    f"KB clarification re-search for '{user_message[:50]}' (article {target_article_id}): {len(section_results)} sections"
                )
            if section_results:
                best_section = section_results[0]
                section = best_section['section']
                section_score = float(best_section.get('score', 0.0))
                clarify_max = float(getattr(self.kb_cache, 'section_clarify_max_score', 0.85))
                title_match = self._title_match_ratio(user_message, section.get('title', ''))
                logger.info(
                    f"KB clarification re-search top score={section_score:.2f}, title_match={title_match:.2f}"
                )
                if section_score >= clarify_max and title_match >= 0.34:
                    article = self.kb_cache.get_article_by_id(target_article_id) or {}
                    return self._respond_with_section(dispatcher, section, article, section_score)
                options = []
                for r in section_results[:4]:
                    sec = r['section']
                    content = (sec.get('content') or '').strip()
                    summary = content.split('\n')[0][:140]
                    if len(content) > 140:
                        summary = f"{summary.rstrip()}..."
                    options.append({
                        "section_id": sec.get('id'),
                        "title": sec.get('title') or sec.get('article_title') or "More details",
                        "summary": summary,
                        "score": float(r.get('score', 0.0))
                    })
                if len(options) <= 1:
                    article = self.kb_cache.get_article_by_id(target_article_id) or {}
                    return self._respond_with_section(dispatcher, section, article, section_score)
                prompt_text, buttons = self._build_clarify_prompt(options)
                dispatcher.utter_message(text=prompt_text, buttons=buttons)
                return [
                    SlotSet("kb_clarify_attempts", int(tracker.get_slot("kb_clarify_attempts") or 0)),
                    SlotSet("kb_clarify_options", json.dumps(options)),
                ]

            attempts = int(tracker.get_slot("kb_clarify_attempts") or 0) + 1
            if attempts < 2:
                prompt_text, buttons = self._build_clarify_prompt(options)
                dispatcher.utter_message(text=prompt_text, buttons=buttons)
                return [SlotSet("kb_clarify_attempts", attempts)]

            article = self.kb_cache.get_article_by_id(target_article_id) or {}
            glpi_id = article.get('glpi_id')
            article_link = self._build_article_link(glpi_id)
            response = f"### 📚 {article.get('title', 'Knowledge Base')}\n\nI couldn't pinpoint a single section."
            response += "\n\nWould you like the full article or the KB link?"
            buttons = [{"title": "📄 Show full article", "payload": "/kb_show_full_article"}]
            if article_link:
                buttons.append({"title": "🔗 Open KB link", "url": article_link})
            dispatcher.utter_message(text=response, buttons=buttons)
            return [
                SlotSet("kb_last_article_title", article.get('title', 'Knowledge Base')),
                SlotSet("kb_last_article_content", article.get('content') or ''),
                SlotSet("kb_last_source", article.get('source', 'unknown')),
                SlotSet("kb_last_glpi_id", glpi_id),
                SlotSet("kb_clarify_options", None),
                SlotSet("kb_clarify_attempts", 0),
                SlotSet("kb_target_article_id", None),
            ]


        # ===== VECTOR SEARCH (Primary - returns focused single chunk) =====
        if self.use_vector_search and self.vector_search:
            try:
                vector_result = self.vector_search(user_message)
                if vector_result and vector_result.get('similarity', 0) >= 0.35:
                    chunk_content = vector_result.get('content', '')
                    chunk_title = vector_result.get('title', 'Knowledge Base')
                    similarity = vector_result.get('similarity', 0)
                    
                    logger.info(f"VECTOR search hit: '{chunk_title[:50]}' score={similarity:.3f}")
                    
                    # Format focused response (single chunk, ~150 words)
                    response = f"### 📚 {chunk_title}\n\n{chunk_content}"
                    
                    dispatcher.utter_message(text=response)
                    return [
                        SlotSet("kb_last_article_title", chunk_title),
                        SlotSet("kb_last_article_content", chunk_content),
                        SlotSet("kb_last_source", "vector_search"),
                        SlotSet("kb_clarify_options", None),
                    ]
                else:
                    logger.info(f"Vector search score too low ({vector_result.get('similarity', 0) if vector_result else 0:.3f}), trying keyword search...")
            except Exception as e:
                logger.warning(f"Vector search failed: {e}, falling back to keyword search")
        
        # ===== KEYWORD SEARCH FALLBACK =====
        # Search knowledge base using hybrid semantic + keyword search (article first)
        results = self.kb_cache.search_articles(user_message, app_id)
        section_results = []
        if getattr(self.kb_cache, 'section_search_enabled', False) and results:
            target_article = results[0]['article']
            section_results = self.kb_cache.search_sections(user_message, target_article.get('id'))
            logger.info(f"KB section search for '{user_message[:50]}' (article {target_article.get('id')}): {len(section_results)} sections")
            if section_results:
                logger.debug(
                    "Top section scores: " + ", ".join([
                        f"{r['section'].get('title','')}: {r.get('score', 0):.2f}" for r in section_results[:3]
                    ])
                )
        else:
            logger.info("KB section search is disabled or no articles matched")

        # Log search with scores for debugging
        if results:
            logger.info(f"KB search for '{user_message[:50]}': {len(results)} results")
            for r in results[:3]:
                logger.debug(f"  - {r['article']['title']}: score={r['score']:.2f} (semantic={r.get('semantic_score', 0):.2f}, keyword={r.get('keyword_score', 0):.2f})")
        
        if results:
            best_match = results[0]
            article = best_match['article']

            if section_results:
                best_section = section_results[0]
                section = best_section['section']
                section_score = float(best_section.get('score', 0.0))
                clarify_max = float(getattr(self.kb_cache, 'section_clarify_max_score', 0.85))
                title_match = self._title_match_ratio(user_message, section.get('title', ''))
                logger.info(
                    f"KB section top score={section_score:.2f}, title_match={title_match:.2f}, clarify_max={clarify_max:.2f}"
                )

                if section_score >= clarify_max and title_match >= 0.34:
                    return self._respond_with_section(dispatcher, section, article, section_score)

                options_payload = []
                for r in section_results[:4]:
                    sec = r['section']
                    content = (sec.get('content') or '').strip()
                    summary = content.split('\n')[0][:140]
                    if len(content) > 140:
                        summary = f"{summary.rstrip()}..."
                    options_payload.append({
                        "section_id": sec.get('id'),
                        "title": sec.get('title') or sec.get('article_title') or "More details",
                        "summary": summary,
                        "score": float(r.get('score', 0.0))
                    })
                if len(options_payload) <= 1:
                    return self._respond_with_section(dispatcher, section, article, section_score)

                prompt_text, buttons = self._build_clarify_prompt(options_payload)
                dispatcher.utter_message(text=prompt_text, buttons=buttons)

                return [
                    SlotSet("kb_target_article_id", article.get('id')),
                    SlotSet("kb_last_article_title", article.get('title')),
                    SlotSet("kb_last_article_content", article.get('content') or ''),
                    SlotSet("kb_last_source", article.get('source', 'unknown')),
                    SlotSet("kb_last_glpi_id", article.get('glpi_id')),
                    SlotSet("kb_clarify_options", json.dumps(options_payload)),
                    SlotSet("kb_clarify_attempts", 0),
                ]

            glpi_id = article.get('glpi_id')
            article_link = self._build_article_link(glpi_id)
            response = f"### 📚 {article.get('title', 'Knowledge Base')}\n\nI found the right article, but I couldn't isolate a section."
            response += "\n\nWould you like the full article or the KB link?"
            buttons = [{"title": "📄 Show full article", "payload": "/kb_show_full_article"}]
            if article_link:
                buttons.append({"title": "🔗 Open KB link", "url": article_link})
            dispatcher.utter_message(text=response, buttons=buttons)
            return [
                SlotSet("kb_last_article_title", article.get('title', 'Knowledge Base')),
                SlotSet("kb_last_article_content", article.get('content') or ''),
                SlotSet("kb_last_source", article.get('source', 'unknown')),
                SlotSet("kb_last_glpi_id", glpi_id),
            ]
            
            # Format response
            response = f"### 📚 {article['title']}\n\n"
            response += article.get('content', 'No content available.')
            
            # Add video tutorial if available (support both old video_url and new video object)
            video_data = article.get('video')
            video_url = article.get('video_url') or (video_data.get('url') if video_data else None)
            video_title = video_data.get('title', f"Video: {article['title']}") if video_data else f"Video: {article['title']}"
            video_start = video_data.get('start', 0) if video_data else 0
            
            if video_url:
                # Add timestamp to URL if start is specified
                display_url = video_url
                if video_start > 0 and 'youtube.com' in video_url:
                    if '?' in video_url:
                        display_url = f"{video_url}&t={video_start}"
                    else:
                        display_url = f"{video_url}?t={video_start}"
                response += f"\n\n---\n🎬 **Video Tutorial:**\n[Watch on YouTube]({display_url})"
            
            # Add related articles if any
            if len(results) > 1:
                response += "\n\n---\n**Related Articles:**\n"
                for r in results[1:3]:
                    response += f"• {r['article']['title']}\n"

            # Add source indicator and link
            source = best_match.get('source', 'unknown')
            if source == 'glpi':
                glpi_id = article.get('glpi_id', '')
                response += f"\n\n_Source: GLPI KB{f' (Article #{glpi_id})' if glpi_id else ''}_"
                
                # Add Clickable Link to Article
                try:
                    # Construct link assuming standard GLPI structure: /front/knowbaseitem.form.php?id=ID
                    # Base URL derived from API URL in Config usually, but hardcoding for safety/speed based on known config
                    glpi_base_url = get_glpi_base_url()
                    if glpi_id:
                        article_link = f"{glpi_base_url}/front/knowbaseitem.form.php?id={glpi_id}"
                        response += f"\n🔗 **[Read Full Article]({article_link})**"
                except Exception as e:
                    logger.error(f"Failed to create article link: {e}")

            elif source == 'json':
                response += f"\n\n_Source: Local KB_"
            
            # Send text response with buttons (and video if available)
            video_payload = None
            if video_url:
                video_payload = {
                    "video": {
                        "url": video_url,
                        "title": video_title,
                        "start": video_start
                    }
                }
            
            # Build contextual suggestion buttons based on article category
            category = article.get('category', '').lower()
            suggestion_buttons = [
                {"title": "👍 This helped!", "payload": "/feedback_positive"},
                {"title": "👎 Not helpful", "payload": "/feedback_negative"},
            ]
            
            # Add category-specific suggestions
            if category in ['network', 'vpn', 'wifi']:
                suggestion_buttons.extend([
                    {"title": "🌐 Network issues ticket", "payload": '/create_ticket'},
                    {"title": "📋 Check my tickets", "payload": "/list_tickets"},
                ])
            elif category in ['account', 'password', 'security']:
                suggestion_buttons.extend([
                    {"title": "🔐 Password reset ticket", "payload": '/create_ticket'},
                    {"title": "📋 My open tickets", "payload": "/list_tickets"},
                ])
            elif category in ['hardware', 'printer', 'monitor']:
                suggestion_buttons.extend([
                    {"title": "🖥️ Hardware issue ticket", "payload": '/create_ticket'},
                    {"title": "📋 View my tickets", "payload": "/list_tickets"},
                ])
            elif category in ['software', 'application']:
                suggestion_buttons.extend([
                    {"title": "💿 Software request", "payload": '/create_ticket'},
                    {"title": "📋 My tickets", "payload": "/list_tickets"},
                ])
            else:
                suggestion_buttons.extend([
                    {"title": "🎫 Create a ticket", "payload": "/create_ticket"},
                    {"title": "📋 List my tickets", "payload": "/list_tickets"},
                ])
            
            # Always add search option
            suggestion_buttons.append({"title": "🔍 Ask another question", "payload": "/help"})
            
            # Add follow-up question
            response += "\n\n---\n**Was your issue resolved?** If not, I can help you create a support ticket."
            
            dispatcher.utter_message(
                text=response,
                buttons=suggestion_buttons,
                json_message=video_payload
            )
        else:
            # No matches found
            dispatcher.utter_message(
                text="I couldn't find a specific answer in our knowledge base for that question.\n\nWould you like to:",
                buttons=[
                    {"title": "🎫 Create a support ticket", "payload": "/create_ticket"},
                    {"title": "📋 See my tickets", "payload": "/list_tickets"},
                    {"title": "❓ Get help", "payload": "/help"}
                ]
            )
        
        return []


class ActionShowKbFullAnswer(Action):
    """Show the full KB answer from the last QA match."""

    def name(self) -> Text:
        return "action_show_kb_full_answer"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        question = tracker.get_slot("kb_last_question") or ""
        answer = tracker.get_slot("kb_last_answer") or ""
        title = tracker.get_slot("kb_last_article_title") or "Knowledge Base"
        source = tracker.get_slot("kb_last_source") or "unknown"
        glpi_id = tracker.get_slot("kb_last_glpi_id")

        if not answer:
            dispatcher.utter_message(
                text="I don't have a full answer ready yet. Please ask a KB question first."
            )
            return []

        response = f"### 📚 {title}\n\n"
        if question:
            response += f"**Q:** {question}\n\n"
        response += f"**A:** {answer}"

        if source == 'glpi':
            response += f"\n\n_Source: GLPI KB{f' (Article #{glpi_id})' if glpi_id else ''}_"
            try:
                glpi_base_url = get_glpi_base_url()
                if glpi_id:
                    article_link = f"{glpi_base_url}/front/knowbaseitem.form.php?id={glpi_id}"
                    response += f"\n🔗 **[Read Full Article]({article_link})**"
            except Exception as e:
                logger.error(f"Failed to create article link: {e}")
        elif source == 'json':
            response += f"\n\n_Source: Local KB_"

        dispatcher.utter_message(text=response)
        return []


class ActionShowKbFullArticle(Action):
    """Show the full KB article from the last KB response."""

    def name(self) -> Text:
        return "action_show_kb_full_article"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        title = tracker.get_slot("kb_last_article_title") or "Knowledge Base"
        content = tracker.get_slot("kb_last_article_content") or ""
        source = tracker.get_slot("kb_last_source") or "unknown"
        glpi_id = tracker.get_slot("kb_last_glpi_id")

        if not content:
            dispatcher.utter_message(text="I don't have a full article saved yet. Please ask a KB question first.")
            return []

        response = f"### 📚 {title}\n\n{content}"

        if source == 'glpi':
            response += f"\n\n_Source: GLPI KB{f' (Article #{glpi_id})' if glpi_id else ''}_"
            try:
                glpi_base_url = get_glpi_base_url()
                if glpi_id:
                    article_link = f"{glpi_base_url}/front/knowbaseitem.form.php?id={glpi_id}"
                    response += f"\n🔗 **[Read Full Article]({article_link})**"
            except Exception as e:
                logger.error(f"Failed to create article link: {e}")
        elif source == 'json':
            response += "\n\n_Source: Local KB_"

        dispatcher.utter_message(text=response)
        return []


class ActionSaveFeedback(Action):
    """Saves user feedback (thumbs up/down) to a log file for analytics."""
    
    def name(self) -> Text:
        return "action_save_feedback"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        import os
        from datetime import datetime
        
        # Get feedback type from intent
        latest_msg = tracker.latest_message
        intent = latest_msg.get("intent", {}).get("name", "") if isinstance(latest_msg, dict) else ""
        feedback_type = "positive" if intent == "feedback_positive" else "negative" if intent == "feedback_negative" else "unknown"
        
        # Get last bot message to understand what was rated
        last_bot_message = ""
        for event in reversed(tracker.events):
            if event.get("event") == "bot" and event.get("text"):
                last_bot_message = event.get("text", "")[:200]  # First 200 chars
                break
        
        # Get user's original query (look for last user message before the feedback)
        user_query = ""
        found_feedback = False
        for event in reversed(tracker.events):
            if event.get("event") == "user":
                if not found_feedback:
                    found_feedback = True
                    continue
                user_query = event.get("text", "")
                break
        
        # Create feedback entry
        feedback_entry = {
            "timestamp": datetime.now().isoformat(),
            "sender_id": tracker.sender_id,
            "feedback": feedback_type,
            "user_query": user_query,
            "bot_response_preview": last_bot_message,
            "app_id": tracker.get_slot("app_id")
        }
        
        # Save to file
        feedback_file = os.path.join(os.path.dirname(__file__), '..', 'data', 'feedback_log.json')
        
        try:
            # Load existing feedback
            if os.path.exists(feedback_file):
                with open(feedback_file, 'r', encoding='utf-8') as f:
                    feedback_data = json.load(f)
            else:
                feedback_data = {"feedback": []}
            
            # Add new entry
            feedback_data["feedback"].append(feedback_entry)
            
            # Save
            with open(feedback_file, 'w', encoding='utf-8') as f:
                json.dump(feedback_data, f, indent=2, ensure_ascii=False)
            
            # Save to PostgreSQL database for analytics
            ctx = get_analytics_context(tracker)
            print(f"[ANALYTICS DEBUG] Saving feedback - app_id: {ctx['app_id']}, user_id: {ctx['user_id']}, ticket_id: {ctx['ticket_id']}")
            print(f"[ANALYTICS DEBUG] Tracker slots - glpi_user_name: {tracker.get_slot('glpi_user_name')}, glpi_user_id: {tracker.get_slot('glpi_user_id')}, ticket_id: {tracker.get_slot('ticket_id')}")
            analytics_store.log_feedback(tracker.sender_id, feedback_type, app_id=ctx["app_id"], user_id=ctx["user_id"], ticket_id=ctx["ticket_id"])
            
            logger.info(f"Feedback saved: {feedback_type} from {tracker.sender_id} (app: {ctx['app_id']}, user: {ctx['user_id']}, ticket: {ctx['ticket_id']})")
            
        except Exception as e:
            logger.error(f"Error saving feedback: {e}")
        
        # Respond based on feedback type
        if feedback_type == "positive":
            dispatcher.utter_message(text="Great! I'm glad I could help! 😊 Is there anything else you need?")
        else:
            dispatcher.utter_message(
                text="I see your issue is not resolved. Would you like me to create a support ticket for you?",
                buttons=[
                    {"title": "✅ Yes, Create Ticket", "payload": "/create_ticket"},
                    {"title": "❌ No, Search Again", "payload": "/help"}
                ]
            )
        
        return []


# --- 15. Custom Action: Handle Multi-Intent ---
class ActionHandleMultiIntent(Action):
    """Handles multiple actions requested in a single user message.
    
    Parses the user's message for action keywords and responds with
    a queued execution plan, completing the first action and prompting
    for the next.
    """
    
    def name(self) -> Text:
        return "action_handle_multi_intent"
    
    def _parse_actions(self, user_text: str) -> List[Dict[str, Any]]:
        """Parse user message to identify requested actions."""
        user_text = user_text.lower()
        actions = []
        
        # Define action patterns
        action_patterns = [
            {
                "keywords": ["create", "open", "new", "make", "file", "report", "submit"],
                "action": "create_ticket",
                "name": "Create a ticket",
                "payload": "/create_ticket"
            },
            {
                "keywords": ["list", "show", "view", "see", "display", "get", "my tickets"],
                "action": "list_tickets",
                "name": "List tickets",
                "payload": "/list_tickets"
            },
            {
                "keywords": ["check", "status", "track"],
                "action": "check_status",
                "name": "Check ticket status",
                "payload": "/check_status"
            },
            {
                "keywords": ["update", "add comment", "comment", "edit", "modify"],
                "action": "update_ticket",
                "name": "Update ticket",
                "payload": "/update_ticket"
            },
        ]
        
        # Check for each action pattern
        for pattern in action_patterns:
            for keyword in pattern["keywords"]:
                if keyword in user_text:
                    # Avoid duplicates
                    if pattern["action"] not in [a["action"] for a in actions]:
                        actions.append(pattern)
                    break
        
        return actions
    
    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        latest_msg = tracker.latest_message
        user_text = latest_msg.get("text", "") if isinstance(latest_msg, dict) else str(latest_msg)
        
        # Parse the user's message for actions
        detected_actions = self._parse_actions(user_text)
        
        if len(detected_actions) == 0:
            # No actions detected, fallback
            dispatcher.utter_message(
                text="I couldn't identify specific actions in your request. What would you like to do?",
                buttons=[
                    {"title": "📋 List my tickets", "payload": "/list_tickets"},
                    {"title": "🎫 Create a ticket", "payload": "/create_ticket"},
                    {"title": "🔍 Check ticket status", "payload": "/check_status"},
                ]
            )
            return []
        
        if len(detected_actions) == 1:
            # Single action detected, just confirm
            action = detected_actions[0]
            dispatcher.utter_message(
                text=f"I'll help you **{action['name'].lower()}**.",
                buttons=[{"title": f"▶️ {action['name']}", "payload": action['payload']}]
            )
            return []
        
        # Multiple actions detected
        message = f"I detected **{len(detected_actions)} actions** in your request:\n\n"
        
        for i, action in enumerate(detected_actions, 1):
            message += f"{i}. {action['name']}\n"
        
        message += "\nI'll help you with these one at a time. Let's start with the first one:"
        
        # Create buttons for first action + option to change
        first_action = detected_actions[0]
        buttons = [
            {"title": f"▶️ Start: {first_action['name']}", "payload": first_action['payload']},
        ]
        
        # Add buttons for other actions
        for action in detected_actions[1:]:
            buttons.append({"title": f"⏭️ Skip to: {action['name']}", "payload": action['payload']})
        
        dispatcher.utter_message(text=message, buttons=buttons)
        
        return []


# --- KB-First Ticket Creation Action ---
class ActionSearchKbBeforeTicket(Action):
    """Searches KB before ticket creation using hybrid semantic + keyword search."""

    def name(self) -> Text:
        return "action_search_kb_before_ticket"

    def __init__(self):
        # Import KB cache manager
        from admin.api.kb_cache_manager import kb_cache
        self.kb_cache = kb_cache
        logger.info("ActionSearchKbBeforeTicket initialized with KB cache manager")

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        latest_msg = tracker.latest_message
        user_message = latest_msg.get("text", "") if isinstance(latest_msg, dict) else str(latest_msg)
        app_id = tracker.get_slot("app_id")
        
        # Also check if there's a description entity extracted
        description = None
        entities = latest_msg.get("entities", []) if isinstance(latest_msg, dict) else []
        for entity in entities:
            if entity.get("entity") == "description":
                description = entity.get("value")
                break
        
        # Use description if available, otherwise use full message
        search_query = description or user_message
        
        # Skip search if query is a command, empty, or generic "create ticket"
        skip_search = False
        if not search_query or search_query.startswith('/'):
            skip_search = True
        elif search_query.lower().strip() in ["create ticket", "new ticket", "open ticket", "ticket", "help", "support"]:
            skip_search = True

        logger.info(f"DEBUG: ActionSearchKbBeforeTicket query='{search_query}' skip={skip_search}")

        results = []
        if not skip_search:
            # Search knowledge base using hybrid semantic + keyword search
            results = self.kb_cache.search_articles(search_query, app_id)
        
        if results:
            # KB articles found - show them to user
            response = "📚 **Before creating a ticket, check if these solutions help:**\n\n"
            
            for i, result in enumerate(results, 1):
                article = result['article']
                title = article.get('title', 'Untitled')
                summary = article.get('content', '')[:150] + "..." if len(article.get('content', '')) > 150 else article.get('content', '')
                response += f"**{i}. {title}**\n{summary}\n\n"
            
            response += "---\n**Did any of these help solve your issue?**"
            
            dispatcher.utter_message(
                text=response,
                buttons=[
                    {"title": "✅ Yes, solved!", "payload": "/affirm"},
                    {"title": "❌ No, create ticket", "payload": "/kb_not_helpful"}
                ]
            )
            
            return [SlotSet("kb_articles_shown", True)]
        else:
            # No KB articles found - proceed directly to ticket form
            # We use FollowupAction to trigger the initialization info flow without user input
            return [
                SlotSet("kb_articles_shown", False),
                FollowupAction("action_init_glpi_session")
            ]


# --- Satisfaction Survey Action ---
class ActionSaveSatisfactionRating(Action):
    """Saves user's satisfaction rating after ticket creation."""
    
    def name(self) -> Text:
        return "action_save_satisfaction_rating"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        # Get rating from intent name (rating_1 -> 1, rating_5 -> 5)
        intent = tracker.latest_message.get("intent", {}).get("name", "")
        rating = 0
        if intent.startswith("rating_"):
            try:
                rating = int(intent.split("_")[1])
            except ValueError:
                rating = 0
        
        # Get context info
        sender_id = tracker.sender_id
        ticket_id = tracker.get_slot("ticket_id")
        user_id = tracker.get_slot("glpi_user_name") or tracker.get_slot("glpi_user_id")
        app_id = tracker.get_slot("app_id")
        
        # Log the rating
        logger.info(f"Satisfaction rating: {rating} stars from user {sender_id} for ticket {ticket_id}")
        
        # Save to feedback log
        try:
            feedback_data = {
                "sender_id": sender_id,
                "ticket_id": ticket_id,
                "user_id": user_id,
                "app_id": app_id,
                "rating": rating,
                "timestamp": datetime.datetime.now().isoformat()
            }
            analytics_store.log_feedback(sender_id, rating, f"Satisfaction rating: {rating} stars", ticket_id=ticket_id)
        except Exception as e:
            logger.error(f"Error saving satisfaction rating: {e}")
        
        # Respond based on rating
        if rating >= 4:
            dispatcher.utter_message(response="utter_thanks_positive_rating")
        else:
            dispatcher.utter_message(response="utter_ask_improvement")
        
        return []


# --- 18. Custom Action: Show Ticket Graph ---
class ActionShowTicketGraph(Action):
    """Generates a pie chart showing tickets grouped by status."""
    
    def name(self) -> Text:
        return "action_show_ticket_graph"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="❌ Please log in first to view your ticket graph.")
            return []
        
        # Get app_id for entity filtering
        app_id = tracker.get_slot("app_id")
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)
        
        # Fetch all tickets (not just active)
        tickets = glpi_service.get_user_tickets(session_token, active_only=False, entity_id=entity_id)
        
        if not tickets:
            dispatcher.utter_message(text="📊 No tickets found to generate a graph.")
            return []
        
        # Count tickets by status
        status_map = {
            1: "New", 2: "Processing", 3: "Planned", 
            4: "Pending", 5: "Solved", 6: "Closed", 10: "Approved"
        }
        status_counts = {}
        
        for t in tickets:
            status_id = t.get('status', 0)
            status_name = status_map.get(status_id, "Unknown")
            status_counts[status_name] = status_counts.get(status_name, 0) + 1
        
        # Prepare chart data
        labels = list(status_counts.keys())
        values = list(status_counts.values())
        
        # Status colors
        color_map = {
            "New": "#3B82F6",        # Blue
            "Processing": "#F59E0B", # Amber
            "Planned": "#8B5CF6",    # Purple
            "Pending": "#EF4444",    # Red
            "Solved": "#10B981",     # Green
            "Closed": "#6B7280",     # Gray
            "Approved": "#06B6D4",   # Cyan
            "Unknown": "#9CA3AF"     # Light gray
        }
        colors = [color_map.get(label, "#9CA3AF") for label in labels]
        
        chart_data = {
            "type": "pie",
            "title": f"Tickets by Status ({sum(values)} total)",
            "labels": labels,
            "datasets": [
                {
                    "data": values,
                    "backgroundColor": colors,
                    "borderColor": "#ffffff",
                    "borderWidth": 2
                }
            ]
        }
        
        # Generate summary text
        summary = f"**📊 Ticket Status Summary ({sum(values)} tickets)**\n\n"
        for label, value in zip(labels, values):
            pct = round((value / sum(values)) * 100, 1)
            summary += f"- **{label}**: {value} ({pct}%)\n"
        
        dispatcher.utter_message(
            text=summary,
            json_message={"chart": chart_data}
        )
        
        return []

class ValidateTicketForm(FormValidationAction):
    def name(self) -> Text:
        return "validate_ticket_form"

    def validate_ticket_content(
        self,
        slot_value: Any,
        dispatcher: CollectingDispatcher,
        tracker: Tracker,
        domain: Dict[Text, Any],
    ) -> Dict[Text, Any]:
        slots_to_set = {"ticket_content": slot_value}
        
        current_issue_type = tracker.get_slot("issue_type")
        if not current_issue_type and slot_value:
            text = slot_value.lower()
            if any(x in text for x in ["laptop", "printer", "screen", "monitor", "mouse", "keyboard", "pc", "computer", "device", "hardware", "machine", "webcam"]):
                slots_to_set["issue_type"] = "Hardware"
            elif any(x in text for x in ["wifi", "internet", "connection", "network", "vpn", "slow", "offline", "connect", "bandwidth"]):
                slots_to_set["issue_type"] = "Network"
            elif any(x in text for x in ["word", "excel", "outlook", "team", "app", "software", "crash", "error", "login", "password", "access", "license", "bug"]):
                slots_to_set["issue_type"] = "Software"
                
        return slots_to_set


# --- 16. Custom Action: Create Ticket From Form ---
class ActionCreateTicketFromForm(Action):
    def name(self) -> Text:
        return "action_create_ticket_from_form"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        
        session_token = tracker.get_slot("session_token")
        if not session_token:
            dispatcher.utter_message(text="GLPI session is not active. Please start over.")
            return []

        # Parse JSON payload from message text
        # Format: /submit_ticket_form{"title": "...", ...}
        message_text = tracker.latest_message.get("text", "")
        try:
            json_start = message_text.find("{")
            if json_start == -1:
                raise ValueError("No JSON data found")
            
            form_data = json.loads(message_text[json_start:])
        except Exception as e:
            logger.error(f"Failed to parse ticket form data: {e}")
            dispatcher.utter_message(text="❌ Error processing form data.")
            return []

        title = form_data.get("title")
        detail = form_data.get("detail", "")
        priority = form_data.get("priority", "Medium")
        urgency = form_data.get("urgency", "Medium")
        category = form_data.get("category", "Hardware")

        # Map Form Values to GLPI IDs
        urgency_map = {"Low": 1, "Medium": 3, "High": 5}
        
        # Context-Aware Category Mapping (Simplified for now)
        app_id = tracker.get_slot("app_id") or "General"
        
        if app_id == "Accounting":
            category_id_map = {
                "Hardware": 10, 
                "Software": 11, 
                "Network": 12,
                "Other": 2     
            }
        else: # Default (IT)
            category_id_map = {"Hardware": 4, "Software": 6, "Network": 8, "Other": 1}

        ticket_data = {
            "name": f"[{app_id}] {title}",      
            "content": detail,    
            "urgency": urgency_map.get(urgency, 3),
            "itilcategories_id": category_id_map.get(category, 1),
            "users_id_requester": 1, # Default or from user context if available
        }

        # Entity Mapping
        entity_id_map = {"Root": 0, "IT": 1, "Accounting": 2}
        entity_id = entity_id_map.get(app_id, 1)

        # Create Ticket
        new_ticket_id = await glpi_service.create_ticket(session_token, ticket_data, entity_id)
        
        if new_ticket_id:
            ticket_ref = f"TICKET-{new_ticket_id}"
            dispatcher.utter_message(
                text=f"✅ Success! Ticket **{ticket_ref}** created.",
                buttons=[
                    {"title": "🔍 View Ticket", "payload": "/check_status"},
                    {"title": "📋 List Tickets", "payload": "/list_tickets"},
                ]
            )
            return [ SlotSet("ticket_id", ticket_ref) ]
        else:
            dispatcher.utter_message(text="❌ Failed to create ticket.")
            return []


# ======================================================================
# HANDOFF ACTIONS — Phase 2
# All config values come from the DB runtime config or the config file.
# Nothing is hardcoded here.
# ======================================================================

def _get_handoff_runtime_cfg() -> dict:
    """Load handoff runtime settings from DB. Returns safe defaults on error."""
    try:
        from common.conversation_db import get_handoff_runtime_config
        return get_handoff_runtime_config()
    except Exception:
        return {
            "triggers": {"confidence_threshold": 0.40, "confidence_streak_required": 2,
                         "frustration_threshold": 0.75, "frustration_streak_required": 2,
                         "direct_handoff_intents": []},
            "queue": {"default_priority": 5, "ask_user_after_mins": 15,
                      "max_queue_depth": 50},
            "operators": {"default_max_concurrent": 3, "auto_busy_on_max_load": True},
            "gdpr": {"consent_required": True}
        }


def _call_admin_api(path: str, method: str = "GET", data: dict = None) -> Optional[dict]:
    """Call the Admin API from within the Action Server."""
    import urllib.request
    import urllib.error
    try:
        from common.config_manager import get_server_config
        cfg = get_server_config()
        port = cfg.get('admin_port', 8181)
        url = f"http://127.0.0.1:{port}{path}"
        req_data = json.dumps(data).encode() if data else None
        req = urllib.request.Request(
            url,
            data=req_data,
            headers={"Content-Type": "application/json"},
            method=method
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        logger.warning(f"Admin API call failed ({method} {path}): {e}")
        return None


def _score_frustration(text: str) -> float:
    """Return a frustration score 0.0–1.0 using a simple keyword heuristic.
    VADER is used when available; falls back to keyword matching."""
    if not text:
        return 0.0
    try:
        from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        score = SentimentIntensityAnalyzer().polarity_scores(text)
        neg = score.get('neg', 0.0)
        compound = score.get('compound', 0.0)
        return round(min(1.0, neg + max(0, -compound) * 0.5), 3)
    except ImportError:
        pass
    # Keyword fallback
    frustration_words = [
        'not working', 'broken', 'useless', 'terrible', 'awful', 'worst',
        'frustrated', 'angry', 'stupid', 'ridiculous', 'never works',
        'stop working', 'this is bad', 'waste of time', 'cant believe'
    ]
    text_lower = text.lower()
    hits = sum(1 for w in frustration_words if w in text_lower)
    return min(1.0, hits * 0.25)


class ActionTrackConfidence(Action):
    """Called after every bot turn (via FollowupAction from other actions).
    Tracks low-confidence streaks and frustration scores.
    Auto-triggers handoff when thresholds are reached.
    """

    def name(self) -> Text:
        return "action_track_confidence"

    def run(self, dispatcher: CollectingDispatcher,
            tracker: Tracker, domain: Dict[Text, Any]) -> List:

        cfg = _get_handoff_runtime_cfg()
        trigger_cfg = cfg.get('triggers', {})
        conf_threshold = trigger_cfg.get('confidence_threshold', 0.40)
        conf_streak_req = int(trigger_cfg.get('confidence_streak_required', 2))
        frust_threshold = trigger_cfg.get('frustration_threshold', 0.75)
        frust_streak_req = int(trigger_cfg.get('frustration_streak_required', 2))

        # Skip tracking if already in handoff
        handoff_state = tracker.get_slot('handoff_state') or 'bot_active'
        if handoff_state != 'bot_active':
            return []

        events = []

        # ── Confidence streak ──────────────────────────────────────────
        confidence = 0.0
        try:
            confidence = tracker.latest_message.get('intent', {}).get('confidence', 1.0)
        except Exception:
            confidence = 1.0

        current_streak = int(tracker.get_slot('low_conf_streak') or 0)
        if confidence < conf_threshold:
            new_streak = current_streak + 1
        else:
            new_streak = 0
        events.append(SlotSet('low_conf_streak', float(new_streak)))

        # ── Frustration score ──────────────────────────────────────────
        user_text = tracker.latest_message.get('text', '') or ''
        frust = _score_frustration(user_text)
        # Rolling average over last 3 turns using slot
        prev_frust = float(tracker.get_slot('frustration_score') or 0.0)
        new_frust = round((prev_frust * 0.6 + frust * 0.4), 3)
        events.append(SlotSet('frustration_score', new_frust))

        # ── Trigger check ──────────────────────────────────────────────
        if new_streak >= conf_streak_req or new_frust >= frust_threshold:
            logger.info(
                f"[Handoff] Auto-trigger: streak={new_streak}, frustration={new_frust}"
            )
            events.append(FollowupAction('action_request_handoff'))

        return events


class ActionRequestHandoff(Action):
    """Check operator availability and start the handoff flow.
    Shows GDPR consent (if required) or no-agents fallback.
    """

    def name(self) -> Text:
        return "action_request_handoff"

    def run(self, dispatcher: CollectingDispatcher,
            tracker: Tracker, domain: Dict[Text, Any]) -> List:

        handoff_state = tracker.get_slot('handoff_state') or 'bot_active'
        if handoff_state in ('queued', 'assigned'):
            dispatcher.utter_message(
                text="You are already connected with our support team."
            )
            return []

        # Prefer metadata app_id (set per-message by widget) over the slot
        metadata = tracker.latest_message.get('metadata') or {}
        app_id = (metadata.get('app_id') or tracker.get_slot('app_id') or '').strip()
        # 'General' is the default fallback — don't filter by it (show all operators)
        if app_id.lower() == 'general':
            app_id = ''
        resp = _call_admin_api(f"/internal/operators/available?app_id={app_id}")

        if resp and resp.get('online'):
            wait_mins = resp.get('wait_mins', 0)
            # Show GDPR consent — actual queueing happens after user agrees
            return [
                SlotSet('wait_estimate_mins', float(wait_mins)),
                FollowupAction('action_gdpr_consent')
            ]
        elif resp and resp.get('online_count', 0) == 0:
            dispatcher.utter_message(response='utter_no_agents_available')
        else:
            # Agents online but all busy — show wait time
            wait_mins = resp.get('wait_mins', 0) if resp else 0
            dispatcher.utter_message(
                response='utter_agents_busy_with_wait',
                queue_position=str(resp.get('queue_depth', 0) + 1 if resp else 1),
                wait_estimate_mins=str(round(wait_mins, 1))
            )
        return []


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


class ActionConfirmHandoff(Action):
    """Enqueue the conversation and inform the user of their queue position."""

    def name(self) -> Text:
        return "action_confirm_handoff"

    def run(self, dispatcher: CollectingDispatcher,
            tracker: Tracker, domain: Dict[Text, Any]) -> List:

        sender_id = tracker.sender_id
        metadata = tracker.latest_message.get('metadata') or {}
        app_id = (metadata.get('app_id') or tracker.get_slot('app_id') or 'IT').strip()
        if app_id.lower() == 'general':
            app_id = 'IT'

        # Determine trigger context
        intent = tracker.latest_message.get('intent', {}).get('name', 'unknown')
        confidence = tracker.latest_message.get('intent', {}).get('confidence', 1.0)
        low_conf_streak = int(tracker.get_slot('low_conf_streak') or 0)
        frustration_score = float(tracker.get_slot('frustration_score') or 0.0)

        if intent == 'request_human_agent':
            trigger_reason = 'user_request'
        elif low_conf_streak >= 2:
            trigger_reason = 'low_confidence'
        elif frustration_score >= 0.75:
            trigger_reason = 'frustration'
        else:
            trigger_reason = 'user_request'

        trigger_detail = {
            'intent': intent,
            'confidence': confidence,
            'low_conf_streak': low_conf_streak,
            'frustration_score': frustration_score,
            'last_message': tracker.latest_message.get('text', '')[:200]
        }

        resp = _call_admin_api(
            '/internal/queue/enqueue',
            method='POST',
            data={
                'sender_id': sender_id,
                'app_id': app_id,
                'trigger_reason': trigger_reason,
                'trigger_detail': trigger_detail,
                'consent_given': tracker.get_slot('consent_given') or False,
            }
        )

        if not resp or not resp.get('success'):
            error = resp.get('error', 'unknown') if resp else 'Admin API unreachable'
            if 'full' in error.lower():
                dispatcher.utter_message(response='utter_handoff_queue_full')
            else:
                dispatcher.utter_message(
                    text="Sorry, I was unable to connect you to an agent right now. "
                         "Please try creating a ticket instead."
                )
            return [SlotSet('handoff_state', 'bot_active')]

        queue_id = resp.get('queue_id')
        position = resp.get('position', 1)
        wait_mins = resp.get('wait_mins', 0)

        dispatcher.utter_message(
            response='utter_queued_for_operator',
            queue_position=str(position),
            wait_estimate_mins=str(round(float(wait_mins), 1))
        )

        return [
            SlotSet('handoff_state', 'queued'),
            SlotSet('queue_id', float(queue_id)),
            SlotSet('queue_position', float(position)),
            SlotSet('wait_estimate_mins', float(wait_mins)),
        ]


class ActionCancelHandoff(Action):
    """User chose to cancel and stay with the bot."""

    def name(self) -> Text:
        return "action_cancel_handoff"

    def run(self, dispatcher: CollectingDispatcher,
            tracker: Tracker, domain: Dict[Text, Any]) -> List:

        dispatcher.utter_message(response='utter_handoff_cancelled')
        return [
            SlotSet('handoff_state', 'bot_active'),
            SlotSet('consent_given', False),
            SlotSet('low_conf_streak', 0.0),
            SlotSet('frustration_score', 0.0),
            SlotSet('queue_id', None),
            SlotSet('queue_position', None),
            SlotSet('wait_estimate_mins', None),
        ]


class ActionResumeFromHandoff(Action):
    """Called when an operator returns the conversation to the bot.
    Resets handoff slots and offers next steps to the user.
    """

    def name(self) -> Text:
        return "action_resume_from_handoff"

    def run(self, dispatcher: CollectingDispatcher,
            tracker: Tracker, domain: Dict[Text, Any]) -> List:

        operator_name = tracker.get_slot('assigned_operator_name') or 'The agent'
        dispatcher.utter_message(
            response='utter_handoff_resolved_return',
            assigned_operator_name=operator_name
        )
        return [
            SlotSet('handoff_state', 'bot_active'),
            SlotSet('assigned_operator_name', None),
            SlotSet('queue_id', None),
            SlotSet('queue_position', None),
            SlotSet('wait_estimate_mins', None),
            SlotSet('consent_given', False),
            SlotSet('low_conf_streak', 0.0),
            SlotSet('frustration_score', 0.0),
        ]
