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


