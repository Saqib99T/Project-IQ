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


class ActionSearchKnowledgeBase(Action):
    """Searches the knowledge base for relevant articles using hybrid semantic + keyword search."""

    def name(self) -> Text:
        return "action_search_knowledge_base"

    def __init__(self):
        # Import KB cache manager (will auto-initialize and start refresh)
        from web.api.kb_cache_manager import kb_cache
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
            response += f"\n\n_Source: ITSM KB (Article #{glpi_id})_"
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
                response += f"\n\n_Source: ITSM KB{f' (Article #{glpi_id})' if glpi_id else ''}_"
                
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
            # No matches found — log as knowledge gap
            try:
                from common.db._kb_gaps import log_kb_gap
                meta      = tracker.latest_message.get('metadata', {}) if isinstance(tracker.latest_message, dict) else {}
                _app_id   = tracker.get_slot('app_id') or meta.get('app_id')
                _sender   = tracker.sender_id
                log_kb_gap(query=user_message, app_id=_app_id, sender_id=_sender)
            except Exception:
                pass

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
            response += f"\n\n_Source: ITSM KB{f' (Article #{glpi_id})' if glpi_id else ''}_"
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
            response += f"\n\n_Source: ITSM KB{f' (Article #{glpi_id})' if glpi_id else ''}_"
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


class ActionSearchKbBeforeTicket(Action):
    """Searches KB before ticket creation using hybrid semantic + keyword search."""

    def name(self) -> Text:
        return "action_search_kb_before_ticket"

    def __init__(self):
        # Import KB cache manager
        from web.api.kb_cache_manager import kb_cache
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


