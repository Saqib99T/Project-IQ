import logging
import json
import os
import sys

# Ensure we can import from the actions package
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from rasa.core.tracker_store import SQLTrackerStore
from rasa.shared.core.trackers import DialogueStateTracker
from rasa.shared.core.events import UserUttered, BotUttered, Event

# Import our custom database logger
# We use a try-except block to handle potential import issues during Rasa startup checks
try:
    from actions.conversation_db import log_message, log_conversation_start
    # Also import config to ensure connection details are available
    from actions.config_manager import _init_infisical
except ImportError:
    print("Warning: Could not import actions.conversation_db. Custom logging may fail.")
    def log_message(*args, **kwargs): pass
    def log_conversation_start(*args, **kwargs): pass

logger = logging.getLogger(__name__)

class CustomTrackerStore(SQLTrackerStore):
    """
    A custom tracker store that saves conversation history to Rasa's default SQL store
    AND logs specific events (User/Bot messages) to our custom 'messages' analytics table.
    """

    async def save(self, tracker: DialogueStateTracker) -> None:
        """Saves the current state of the tracker to the database."""

        # 1. Persist to default Rasa SQL storage (crucial for core functionality)
        await super().save(tracker)

        # 2. Extract new events to log to our custom analytics DB
        # We only want to log events that haven't been logged yet, 
        # but the save method receives the whole tracker.
        # However, for analytics, duplication checks are handled by the log_message timestamp usually,
        # or we accept that 'save' is called frequently. 
        # A better approach for 'save' which is called often:
        # Check the LAST event. If it's a message, log it.
        # But 'save' might be called after multiple events. 
        
        # NOTE: In a perfect world, we'd use an EventBroker. 
        # But overriding TrackerStore is a simpler drop-in for this specific legacy DB setup.
        
        # We will iterate over the events in the tracker. 
        # To avoid duplicates, we could check if we've already logged them, 
        # but our custom DB doesn't have a unique ID link to Rasa events easily.
        # STRATEGY: We will look at the `latest_message` for UserUttered.
        # For BotUttered, it's harder because multiple bot messages can happen in a turn.
        
        # Alternative Strategy: Just log the *latest* event if it is of interest.
        # Rasa calls save() after processing a turn.
        
        try:
            self._log_analytics(tracker)
        except Exception as e:
            logger.error(f"Failed to log analytics in CustomTrackerStore: {e}")

    def _log_analytics(self, tracker: DialogueStateTracker):
        """Custom logging logic."""
        
        # Get context variables from slots
        # Note: Slots might not be fully populated yet if this is the very first turn
        app_id = tracker.slots.get("app_id", "General") if tracker.slots else "General"
        ticket_id = tracker.slots.get("ticket_id") if tracker.slots else None
        
        # Attempt to get user info
        user_id = None
        if tracker.slots:
            user_id = tracker.slots.get("glpi_user_name") or tracker.slots.get("glpi_user_id")

        sender_id = tracker.sender_id

        # Iterate through events in reverse to find the most recent things to log
        # We need to be careful not to re-log old things.
        # This is the tricky part of TrackerStore vs EventBroker.
        # But since we are replacing a system that didn't log *at all* for some cases,
        # we will try to log the *latest* relevant events.
        
        # OPTION: Just log the latest event if it matches.
        if not tracker.events:
            return

        latest_event = tracker.events[-1]
        
        # If we have multiple events since last save (which we don't track easily here),
        # we might miss some if we only look at -1. 
        # But typically save() is called after each turn or action execution.
        
        # Let's look at the last few events and filter duplicates in the DB layer if possible?
        # No, DB layer (conversation_db) performs an INSERT.
        
        # Refined Strategy:
        # Use a "last_event_time" marker? No, state is not persistent in the class instance across requests in all deployments.
        
        # Let's inspect the events from the current turn.
        # But 'active_loop' etc can be complex.
        
        # SIMPLIFIED: Just look at the very last event. 
        # If it's BotUttered, log it.
        # If it's UserUttered, log it.
        
        # We need to handle the case where a User message triggers an Action which emits a Bot message.
        # save() is called after the User message (by the processor)
        # AND after the Action (by the processor).
        
        if isinstance(latest_event, UserUttered):
            text = latest_event.text
            intent = latest_event.intent.get("name") if latest_event.intent else None
            
            # Skip command messages if needed, e.g. /starts
            if text and not text.startswith('/'):
               log_message(
                   sender_id=sender_id,
                   message_type="user",
                   text=text,
                   intent=intent,
                   app_id=app_id,
                   user_id=user_id,
                   ticket_id=ticket_id
               )
               
        elif isinstance(latest_event, BotUttered):
            text = latest_event.text
            # Bot messages don't have intents
            
            # Avoid logging empty messages (e.g. just buttons or custom payloads without text, unless we want to log those?)
            # The original log_message handles text.
            if text:
                log_message(
                    sender_id=sender_id,
                    message_type="bot",
                    text=text,
                    intent=None,
                    app_id=app_id,
                    user_id=user_id,
                    ticket_id=ticket_id
                )
