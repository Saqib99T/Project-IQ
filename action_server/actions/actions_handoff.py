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
    _call_admin_api, _get_handoff_runtime_cfg,
)


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
            # Inline GDPR consent here instead of FollowupAction — avoids TEDPolicy
            # predicting an extra action after the followup and producing a double response.
            cfg = _get_handoff_runtime_cfg()
            if not cfg.get('gdpr', {}).get('consent_required', True):
                return [
                    SlotSet('wait_estimate_mins', float(wait_mins)),
                    FollowupAction('action_confirm_handoff')
                ]
            dispatcher.utter_message(response='utter_gdpr_consent_request')
            return [SlotSet('wait_estimate_mins', float(wait_mins))]
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


