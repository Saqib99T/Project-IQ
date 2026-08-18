import os, sys, logging, json, re, datetime, traceback
from typing import Text, List, Any, Dict, Optional

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet, AllSlotsReset, Restarted, ActiveLoop, UserUttered, FollowupAction
from rasa_sdk.forms import FormValidationAction
from rasa_sdk.executor import CollectingDispatcher
from common import analytics_store
from action_server.actions._shared import (
    log_bot_response, get_analytics_context, get_effective_session_token,
    check_user_login, logger, bind_request_id, get_iam_jwt, itsm_service,
)


class ActionSearchKnowledgeBase(Action):
    """Searches the knowledge base via itsm-service's chunked search endpoint
    (KB_WIKI_CURATION_RAG_PLAN Phase 3) — replaces the local vector_search.py/
    kb_cache_manager.py mechanisms. Logged-in users get their tenant + global
    content (via their own IAM JWT); anonymous users get global public content
    only, scoped server-side by itsm-service — no separate auth needed here.
    """

    _MATCH_THRESHOLD = 0.35

    def name(self) -> Text:
        return "action_search_knowledge_base"

    def _normalize_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", (text or "").strip().lower())

    def _build_article_link(self, article_id: Any) -> Optional[str]:
        # ITSM KB content is shown inline; no external deep link is exposed to the bot.
        return None

    def _chunk_to_option(self, chunk: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize an itsm-service chunk-search result into the {title, summary,
        score, ...} shape _build_clarify_prompt/_match_clarify_option expect,
        keeping the original fields (article_id, article_title, heading, content)
        for _respond_with_chunk."""
        content = (chunk.get('content') or '').strip()
        summary = content.split('\n')[0][:140]
        if len(content) > len(summary):
            summary = f"{summary.rstrip()}..."
        title = chunk.get('heading') or chunk.get('article_title') or 'More details'
        return {**chunk, "title": title, "summary": summary}

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

    def _respond_with_chunk(self, dispatcher: CollectingDispatcher, chunk: Dict[str, Any]) -> List[Dict[str, Any]]:
        article_title = chunk.get('article_title') or 'Knowledge Base'
        heading = chunk.get('heading')
        response = f"### KB: {article_title}\n\n"
        if heading and heading != article_title:
            response += f"Section: {heading}\n\n"
        response += (chunk.get('content') or 'No content available.')
        response += "\n\nSource: ITSM Knowledge Base"
        response += "\n\nWas this helpful?"

        buttons = [
            {"title": "This helped!", "payload": "/feedback_positive"},
            {"title": "Not helpful", "payload": "/feedback_negative"},
            {"title": "Create a ticket", "payload": "/create_ticket"},
        ]
        dispatcher.utter_message(text=response, buttons=buttons)

        return [
            SlotSet("kb_last_article_title", article_title),
            SlotSet("kb_last_article_content", chunk.get('content') or ''),
            SlotSet("kb_last_source", "itsm_chunk_search"),
            SlotSet("kb_last_itsm_id", chunk.get('article_id')),
            SlotSet("kb_clarify_options", None),
            SlotSet("kb_clarify_attempts", 0),
            SlotSet("kb_search_missed", False),
        ]

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        latest_msg = tracker.latest_message
        user_message = latest_msg.get("text", "") if isinstance(latest_msg, dict) else str(latest_msg)
        token = get_iam_jwt(tracker)  # None -> itsm-service scopes to global public content
        org_id = tracker.get_slot("iam_org_id")  # used only by the local vector_search fallback below

        # Handle pending clarification - match free text against the stored
        # candidate list (title/heading substring match), same as before.
        clarify_options_json = tracker.get_slot("kb_clarify_options")
        if clarify_options_json:
            options = self._parse_clarify_options(clarify_options_json)
            selected = self._match_clarify_option(user_message, options)
            if selected:
                logger.info(f"KB clarification resolved to: {selected.get('title')}")
                return self._respond_with_chunk(dispatcher, selected)

            attempts = int(tracker.get_slot("kb_clarify_attempts") or 0) + 1
            if attempts < 2 and options:
                prompt_text, buttons = self._build_clarify_prompt(options)
                dispatcher.utter_message(text=prompt_text, buttons=buttons)
                return [SlotSet("kb_clarify_attempts", attempts)]

            # Could not disambiguate - answer with the original best guess rather
            # than dead-ending the conversation.
            if options:
                return self._respond_with_chunk(dispatcher, options[0])
            return [SlotSet("kb_clarify_options", None), SlotSet("kb_clarify_attempts", 0)]

        # Fresh search via itsm-service's chunked index (KB_WIKI_CURATION_RAG_PLAN Phase 3)
        try:
            results = await itsm_service.search_kb_chunks(token, user_message, limit=5)
        except Exception as e:
            logger.warning(f"KB chunk search failed: {e}")
            results = []

        if results:
            logger.info(f"KB chunk search for '{user_message[:50]}': {len(results)} results")
            options = [self._chunk_to_option(r) for r in results]
            top = options[0]
            top_score = float(top.get('score', 0.0))

            if top_score >= self._MATCH_THRESHOLD:
                logger.info(f"KB chunk search hit: '{top['title'][:50]}' score={top_score:.3f}")
                return self._respond_with_chunk(dispatcher, top)

            if len(options) > 1:
                # Low confidence - offer the top candidates rather than giving up
                prompt_text, buttons = self._build_clarify_prompt(options[:4])
                dispatcher.utter_message(text=prompt_text, buttons=buttons)
                return [
                    SlotSet("kb_clarify_options", json.dumps(options[:4])),
                    SlotSet("kb_clarify_attempts", 0),
                ]

            # Only one weak candidate - still better than a bare "no answer"
            return self._respond_with_chunk(dispatcher, top)

        # itsm-service found nothing - fall back to the local index for content
        # that only exists locally (Firecrawl scrapes, source extensions like
        # Google Sheets/Website/MS Teams write directly into the local
        # kb_articles table and never reach itsm-service - see
        # extensions/_kb_adapter.py, common/firecrawl_ingester.py).
        try:
            from common.vector_search import search_single
            local_result = search_single(user_message, org_id=org_id)
            if local_result and local_result.get('similarity', 0) >= self._MATCH_THRESHOLD:
                logger.info(f"Local vector_search fallback hit: '{local_result.get('title','')[:50]}' score={local_result.get('similarity', 0):.3f}")
                return self._respond_with_chunk(dispatcher, {
                    "article_title": local_result.get('title', 'Knowledge Base'),
                    "heading": None,
                    "content": local_result.get('content', ''),
                    "article_id": None,
                })
        except Exception as e:
            logger.warning(f"Local vector_search fallback failed: {e}")

        # No matches found - log as knowledge gap
        try:
            from common.db._kb_gaps import log_kb_gap
            meta      = tracker.latest_message.get('metadata', {}) if isinstance(tracker.latest_message, dict) else {}
            _app_id   = tracker.get_slot('app_id') or meta.get('app_id')
            _sender   = tracker.sender_id
            log_kb_gap(
                query=user_message, app_id=_app_id, sender_id=_sender,
                org_id=org_id, product_id=tracker.get_slot('product_id'),
            )
        except Exception:
            pass

        from action_server.actions._i18n import t, resolve_lang, lang_events
        _lang = resolve_lang(tracker)
        dispatcher.utter_message(
            text=t("kb_no_answer", _lang),
            buttons=[
                {"title": t("btn_create_ticket", _lang), "payload": "/create_ticket"},
                {"title": t("btn_my_tickets", _lang), "payload": "/list_tickets"},
                {"title": t("btn_get_help", _lang), "payload": "/help"}
            ]
        )
        # Feed the miss into the same low-confidence signal that drives handoff
        # escalation (KB_WIKI_CURATION_RAG_PLAN Phase 4) - unifies NLU-confidence
        # and KB-retrieval-confidence into one streak instead of two disjoint ones.
        return lang_events(tracker, _lang) + [
            SlotSet("kb_search_missed", True),
            FollowupAction("action_track_confidence"),
        ]


class ActionShowKbFullAnswer(Action):
    """Show the full KB answer from the last QA match."""

    def name(self) -> Text:
        return "action_show_kb_full_answer"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        question = tracker.get_slot("kb_last_question") or ""
        answer = tracker.get_slot("kb_last_answer") or ""
        title = tracker.get_slot("kb_last_article_title") or "Knowledge Base"
        source = tracker.get_slot("kb_last_source") or "unknown"
        itsm_id = tracker.get_slot("kb_last_itsm_id")

        if not answer:
            dispatcher.utter_message(
                text="I don't have a full answer ready yet. Please ask a KB question first."
            )
            return []

        response = f"### 📚 {title}\n\n"
        if question:
            response += f"**Q:** {question}\n\n"
        response += f"**A:** {answer}"

        if source not in ('json',):
            response += "\n\n_Source: ITSM Knowledge Base_"
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
        bind_request_id(tracker)
        title = tracker.get_slot("kb_last_article_title") or "Knowledge Base"
        content = tracker.get_slot("kb_last_article_content") or ""
        source = tracker.get_slot("kb_last_source") or "unknown"
        itsm_id = tracker.get_slot("kb_last_itsm_id")

        if not content:
            dispatcher.utter_message(text="I don't have a full article saved yet. Please ask a KB question first.")
            return []

        response = f"### 📚 {title}\n\n{content}"

        if source not in ('json',):
            response += "\n\n_Source: ITSM Knowledge Base_"
        elif source == 'json':
            response += "\n\n_Source: Local KB_"

        dispatcher.utter_message(text=response)
        return []


class ActionSearchKbBeforeTicket(Action):
    """Searches KB before ticket creation using hybrid semantic + keyword search."""

    def name(self) -> Text:
        return "action_search_kb_before_ticket"

    async def run(
        self, dispatcher: CollectingDispatcher, tracker: Tracker, domain: Dict[Text, Any]
    ) -> List[Dict[Text, Any]]:
        bind_request_id(tracker)
        latest_msg = tracker.latest_message
        user_message = latest_msg.get("text", "") if isinstance(latest_msg, dict) else str(latest_msg)
        token = get_iam_jwt(tracker)

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
            # Search knowledge base via itsm-service's chunked index (KB_WIKI_CURATION_RAG_PLAN Phase 3)
            try:
                results = await itsm_service.search_kb_chunks(token, search_query, limit=3)
            except Exception as e:
                logger.warning(f"KB chunk search failed: {e}")
                results = []
        
        if results:
            # KB articles found - show them to user
            response = "📚 **Before creating a ticket, check if these solutions help:**\n\n"
            
            for i, chunk in enumerate(results, 1):
                title = chunk.get('article_title', 'Untitled')
                content = chunk.get('content', '')
                summary = content[:150] + "..." if len(content) > 150 else content
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
                FollowupAction("action_init_itsm_session")
            ]


# --- Satisfaction Survey Action ---


