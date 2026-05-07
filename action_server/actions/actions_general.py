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
    _get_handoff_runtime_cfg, _score_frustration,
)


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

        is_authenticated = tracker.get_slot("is_authenticated")

        if is_authenticated:
            message = f"Hello! I'm your **{dept_name}** support bot. How can I help you today?"
            buttons = [
                {"title": "📋 List my tickets", "payload": "/list_tickets"},
                {"title": "🎫 Create a ticket", "payload": "/create_ticket"},
                {"title": "🔍 Check ticket status", "payload": "/check_status"},
            ]
        else:
            message = f"Hello! I'm your **{dept_name}** support bot.\n\n🔐 **Login** to create or manage tickets, or search the Knowledge Base as a guest."
            buttons = [
                {"title": "🔑 Login", "payload": "/login"},
                {"title": "📚 Search Knowledge Base", "payload": "/ask_knowledge"},
            ]

        dispatcher.utter_message(text=message, buttons=buttons)

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


