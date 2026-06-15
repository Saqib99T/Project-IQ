# Auto-generated shared helpers — do not import directly, use domain files.
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
from action_server.actions.itsm_service import ITSMService
from common import analytics_store
from common.config_manager import get_itsm_config

logger = logging.getLogger(__name__)


def get_itsm_service() -> ITSMService:
    """Get ITSM service client with URL from config."""
    config = get_itsm_config()
    return ITSMService(config['service_url'])


def get_iam_jwt(tracker) -> Optional[str]:
    """Extract the Keycloak access token forwarded by the frontend.

    Returns None when the user is unauthenticated or the frontend did not
    include the token in message metadata.  Never logs the token value.
    """
    meta = {}
    if isinstance(tracker.latest_message, dict):
        meta = tracker.latest_message.get("metadata", {}) or {}
    if isinstance(meta, str):
        try:
            import json as _json
            meta = _json.loads(meta)
        except Exception:
            meta = {}
    return meta.get("iam_token") or tracker.get_slot("iam_token")


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

    # Get user_id from slot (set after ITSM login)
    user_id = tracker.get_slot("itsm_user_name") or tracker.get_slot("itsm_user_id")

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


def get_effective_session_token(tracker) -> Optional[str]:
    """Get session token from slot, message metadata, or service-account fallback."""
    token = tracker.get_slot("session_token")
    if not token:
        token = tracker.latest_message.get("metadata", {}).get("session_token")
    if not token:
        token = getattr(tracker, '_fallback_session_token', None)
    return token


def get_iam_identity(tracker) -> dict:
    """
    Return IAM identity from slots or message metadata.
    Returns dict with keys: sub, name, email (empty strings if guest).
    """
    meta = {}
    if isinstance(tracker.latest_message, dict):
        meta = tracker.latest_message.get("metadata", {}) or {}
    return {
        "sub":   tracker.get_slot("iam_sub")   or meta.get("iam_sub",   ""),
        "name":  tracker.get_slot("iam_name")  or meta.get("iam_name",  ""),
        "email": tracker.get_slot("iam_email") or meta.get("iam_email", ""),
    }


def get_org_context(tracker) -> dict:
    """
    Return org context from slots or message metadata.
    Keys: org_id, org_name, support_org_id, channel, product_id
    """
    meta = {}
    if isinstance(tracker.latest_message, dict):
        meta = tracker.latest_message.get("metadata", {}) or {}
    if isinstance(meta, str):
        try:
            import json as _json
            meta = _json.loads(meta)
        except Exception:
            meta = {}
    return {
        "org_id":         tracker.get_slot("iam_org_id")     or meta.get("iam_org_id",     ""),
        "org_name":       tracker.get_slot("iam_org_name")   or meta.get("iam_org_name",   ""),
        "support_org_id": tracker.get_slot("support_org_id") or meta.get("support_org_id", ""),
        "channel":        tracker.get_slot("channel")        or meta.get("channel",        "internal"),
        "product_id":     tracker.get_slot("product_id")     or meta.get("product_id",     ""),
    }


def is_iam_authenticated(tracker) -> bool:
    """Return True if an IAM sub is present (user authenticated via Keycloak)."""
    identity = get_iam_identity(tracker)
    return bool(identity["sub"])


def require_iam_auth(dispatcher: CollectingDispatcher) -> bool:
    """
    Emit a login-required message and return False.
    Call this when is_iam_authenticated() returns False.
    """
    dispatcher.utter_message(
        text="🔐 **Sign in required**\n\nPlease sign in to use this feature.",
        buttons=[{"title": "🔑 Sign In", "payload": "/trigger_login"}]
    )
    return False


async def check_user_login(tracker: Tracker, dispatcher: CollectingDispatcher) -> bool:
    """Check if user is logged in. Returns True if authenticated.

    Accepts IAM (Keycloak) authentication OR legacy ITSM session token.
    Draft senders (operator AI-draft requests) bypass auth entirely.
    """
    # ── IAM fast path ────────────────────────────────────────────────────────
    iam = get_iam_identity(tracker)
    if iam["sub"]:
        logger.info(f"LOGIN CHECK PASSED (IAM sub={iam['sub'][:8]}...)")
        return True

    is_authenticated = tracker.get_slot("is_authenticated")

    # Explicit logout — is_authenticated=False is definitive, never accept any token
    if is_authenticated is False:
        dispatcher.utter_message(
            text="🔐 **Sign in required**\n\nPlease sign in to use this feature.",
            buttons=[
                {"title": "🔑 Sign In", "payload": "/trigger_login"},
                {"title": "📚 Search KB Instead", "payload": "/ask_knowledge"}
            ]
        )
        return False

    slot_token = tracker.get_slot("session_token")
    meta_token = tracker.latest_message.get("metadata", {}).get("session_token")
    session_token = slot_token or meta_token

    logger.info(f"LOGIN CHECK: is_auth={is_authenticated} slot_token={'set' if slot_token else 'None'} meta_token={'set' if meta_token else 'None'}")

    # Fast path: slot says authenticated and we have a token — skip live verify
    if is_authenticated and session_token:
        logger.info("LOGIN CHECK PASSED (slot)")
        return True

    # Authentication is via IAM SSO — no ITSM verification. Treat the user as
    # signed in when any IAM/session signal is present (IAM JWT, an existing
    # session token, a prior-login cookie, an itsm user id, or the frontend's
    # is_authenticated flag — which survives page-refresh / Rasa restart).
    meta = tracker.latest_message.get("metadata", {}) or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}
    meta_is_authenticated = meta.get("is_authenticated") is True
    has_prior_token = bool(meta_token or slot_token)
    has_iam = bool(get_iam_jwt(tracker))
    itsm_user_id = tracker.get_slot("itsm_user_id") or tracker.get_slot("itsm_user_name")
    if (is_authenticated or session_token or itsm_user_id
            or meta_is_authenticated or has_prior_token or has_iam):
        logger.info("LOGIN CHECK PASSED (IAM/session signal)")
        return True

    logger.info("LOGIN CHECK FAILED")
    dispatcher.utter_message(
        text="🔐 **Sign in required**\n\nPlease sign in to use this feature.",
        buttons=[
            {"title": "🔑 Sign In", "payload": "/trigger_login"},
            {"title": "📚 Search KB Instead", "payload": "/ask_knowledge"}
        ]
    )
    return False


# Module-level singletons
itsm_service = get_itsm_service()


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
            "queue": {"default_priority": 5, "ask_user_after_mins": 15, "max_queue_depth": 50},
            "operators": {"default_max_concurrent": 3, "auto_busy_on_max_load": True},
            "gdpr": {"consent_required": True}
        }


def _score_frustration(text: str) -> float:
    """Frustration score 0.0–1.0 using VADER when available, keyword fallback otherwise."""
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
    frustration_words = [
        'not working', 'broken', 'useless', 'terrible', 'awful', 'worst',
        'frustrated', 'angry', 'stupid', 'ridiculous', 'never works',
        'stop working', 'this is bad', 'waste of time', 'cant believe'
    ]
    hits = sum(1 for w in frustration_words if w.lower() in text.lower())
    return min(1.0, hits * 0.25)


def _call_admin_api(path: str, method: str = "GET", data: dict = None) -> Optional[dict]:
    """Call the Admin API (port 8181) from within the Action Server."""
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


# --- ITSM User Login Action ---
