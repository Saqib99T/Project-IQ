"""Low-confidence NLU fallback that uses semantic embeddings to recover intent.

Instead of a dead-end "could you rephrase?", when Rasa's NLU confidence is low
we embed the user's message and find the nearest training example (see
_intent_index). Then, safely:
  - KB-answerable match  -> re-run KB search on the ORIGINAL message (keeps the
    query) so the user gets an answer.
  - Actionable match     -> offer a single "Did you mean ...?" button whose
    payload routes through existing rules (no silent misrouting).
  - Weak / unmapped match -> the standard helpful default (Login / Search KB).

Everything is wrapped so any failure degrades to utter_default — it can never
break the conversation.
"""
import os
import sys
from typing import Text, List, Any, Dict

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from rasa_sdk import Action, Tracker
from rasa_sdk.events import FollowupAction
from rasa_sdk.executor import CollectingDispatcher

from action_server.actions._shared import logger, bind_request_id

# Minimum cosine similarity to trust the nearest-example match. Real messages
# score ~0.65-0.92 in testing; gibberish ~0.58 — 0.62 separates them.
_SUGGEST_THRESHOLD = 0.62

# Matches that are best answered by the knowledge base (re-run KB search on the
# original text rather than re-sending a bare intent that would lose the query).
_KB_ANSWERABLE = {"ask_knowledge", "create_ticket", "kb_not_helpful"}

# Actionable intents safe to suggest as a one-tap button (payload -> existing
# rules). Excludes social/structural intents (affirm, deny, inform, ratings, …).
_ACTIONABLE_LABELS = {
    "check_status": "🔍 Check ticket status",
    "list_tickets": "📋 See my tickets",
    "update_ticket": "✏️ Update a ticket",
    "view_comments": "💬 View ticket comments",
    "list_attachments": "📎 View attachments",
    "upload_file": "📎 Upload a file",
    "request_human_agent": "🧑‍💼 Talk to a human",
    "login": "🔑 Login",
}


class ActionEmbeddingFallback(Action):
    """Semantic 'did you mean' recovery on low NLU confidence."""

    def name(self) -> Text:
        return "action_embedding_fallback"

    def run(self, dispatcher: CollectingDispatcher, tracker: Tracker,
            domain: Dict[Text, Any]) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        try:
            text = (tracker.latest_message or {}).get("text") or ""
            from action_server.actions._intent_index import nearest_intent
            match = nearest_intent(text)

            if match:
                intent, score, example = match
                logger.info("embedding_fallback: '%s' -> %s (%.2f, e.g. '%s')",
                            text, intent, score, example)
                if score >= _SUGGEST_THRESHOLD:
                    if intent in _KB_ANSWERABLE:
                        dispatcher.utter_message(
                            text="Let me check our knowledge base for that…")
                        return [FollowupAction("action_search_knowledge_base")]
                    if intent in _ACTIONABLE_LABELS:
                        label = _ACTIONABLE_LABELS[intent]
                        dispatcher.utter_message(
                            text="I'm not totally sure I got that. Did you mean:",
                            buttons=[{"title": label, "payload": f"/{intent}"}],
                        )
                        return []

            # Weak or unmapped match → standard helpful default.
            self._utter_default(dispatcher, tracker)
            from action_server.actions._i18n import lang_events
            return lang_events(tracker)
        except Exception as e:  # never break the conversation on fallback
            logger.warning("embedding_fallback error: %s", e)
            try:
                self._utter_default(dispatcher, tracker)
            except Exception:
                pass
            return []

    @staticmethod
    def _utter_default(dispatcher: CollectingDispatcher, tracker: Tracker = None) -> None:
        from action_server.actions._i18n import t, resolve_lang
        lang = resolve_lang(tracker) if tracker else "en"
        dispatcher.utter_message(
            text=t("fallback_default", lang),
            buttons=[
                {"title": t("btn_search_kb", lang), "payload": "/ask_knowledge"},
                {"title": t("btn_login", lang), "payload": "/login"},
            ],
        )
