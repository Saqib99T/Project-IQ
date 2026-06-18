"""
Knowledge Base Cache Manager
Manages in-memory cache of GLPI KB articles with semantic search and periodic refresh
"""
import logging
import threading
import time
import os
import json
import pickle
import re
import html as html_module
from typing import Dict, List, Optional, Any
from datetime import datetime
from collections import Counter
import numpy as np
import asyncio


logger = logging.getLogger(__name__)

class KBCacheManager:
    """Singleton class managing GLPI KB cache with semantic search and auto-refresh."""

    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, '_initialized'):
            return

        self._initialized = True
        self._cache = []
        self._embeddings = None
        self._section_cache = []
        self._section_embeddings = None
        self._qa_cache = []
        self._qa_embeddings = None
        self._cache_lock = threading.Lock()
        self._last_refresh = None
        self._refresh_thread = None
        self._stop_refresh = threading.Event()
        self._model = None

        # Configuration
        self.enabled = True
        self.refresh_interval = 1800  # 30 minutes default
        self.fallback_to_json = True
        self.semantic_enabled = True
        self.semantic_model_name = 'all-MiniLM-L6-v2'
        self.semantic_weight = 0.6
        self.keyword_weight = 0.4
        self.min_score_threshold = 0.3
        self.max_results = 3
        self.section_search_enabled = False
        self.section_min_words = 60
        self.section_max_words = 220
        self.section_max_results = 5
        self.section_clarify_min_score = 0.60
        self.section_clarify_max_score = 0.85
        self.qa_search_enabled = False
        self.qa_min_score = 0.85
        self.qa_max_results = 3

        # Load config and start
        self._load_config()

        # Try to load cached embeddings first (faster startup)
        self._load_embeddings_cache()

        # Start refresh thread
        self._start_refresh_thread()

    def _load_config(self):
        """Load KB configuration from config manager."""
        try:
            from common.config_manager import get_kb_config
            kb_config = get_kb_config()

            self.enabled = kb_config.get('enabled', True)
            self.refresh_interval = kb_config.get('refresh_interval', 1800)
            self.fallback_to_json = kb_config.get('fallback_to_json', True)
            self.semantic_enabled = kb_config.get('semantic_enabled', True)
            self.semantic_model_name = kb_config.get('semantic_model', 'all-MiniLM-L6-v2')
            self.semantic_weight = kb_config.get('semantic_weight', 0.6)
            self.keyword_weight = kb_config.get('keyword_weight', 0.4)
            self.min_score_threshold = kb_config.get('min_score_threshold', 0.3)
            self.max_results = kb_config.get('max_results', 3)
            self.section_search_enabled = kb_config.get('section_search_enabled', False)
            self.section_min_words = kb_config.get('section_min_words', 60)
            self.section_max_words = kb_config.get('section_max_words', 220)
            self.section_max_results = kb_config.get('section_max_results', 3)
            self.section_clarify_min_score = kb_config.get('section_clarify_min_score', 0.60)
            self.section_clarify_max_score = kb_config.get('section_clarify_max_score', 0.85)
            self.qa_search_enabled = kb_config.get('qa_search_enabled', False)
            self.qa_min_score = kb_config.get('qa_min_score', 0.85)
            self.qa_max_results = kb_config.get('qa_max_results', 3)

            logger.info(
                f"KB Config loaded: semantic_enabled={self.semantic_enabled}, model={self.semantic_model_name}, "
                f"section_search_enabled={self.section_search_enabled}"
            )
        except Exception as e:
            logger.error(f"Error loading KB config: {e}")

    def _start_refresh_thread(self):
        """Start background thread for periodic refresh."""
        if not self.enabled:
            logger.info("GLPI KB cache disabled")
            # Load JSON fallback instead
            if self.fallback_to_json:
                logger.info("Loading JSON KB fallback")
                self._load_json_fallback()
            return

        # Initial load — in a BACKGROUND thread so importing this module never
        # blocks the caller. The initial load does sync_kb_from_itsm (itsm fetch +
        # DB mirror, ~seconds); doing it synchronously here froze the eventlet hub
        # the first time any request imported this singleton (KB page hang).
        threading.Thread(target=self.refresh_cache, daemon=True,
                         name="KB-Initial-Load").start()

        # NOTE: Periodic refresh disabled by request.
        # Cache will only refresh when manually triggered via Admin UI.
        logger.info("KB periodic background refresh is DISABLED.")
        
        # Original Thread Logic (Disabled)
        # self._refresh_thread = threading.Thread(
        #     target=self._refresh_loop,
        #     daemon=True,
        #     name="KB-Cache-Refresh"
        # )
        # self._refresh_thread.start()
        # logger.info(f"KB cache refresh thread started (interval: {self.refresh_interval}s)")

    def _refresh_loop(self):
        """Background loop for periodic cache refresh."""
        while not self._stop_refresh.is_set():
            time.sleep(self.refresh_interval)
            if not self._stop_refresh.is_set():
                self.refresh_cache()

    async def refresh_cache_async(self) -> bool:
        """Rebuild the cache from the local KB mirror (Path B — no GLPI).

        itsm-service is the source of truth; `common.kb_sync` mirrors its published
        articles into the local `kb_articles` table (a backend job — no GLPI, no live
        bot token) and rebuilds the bot's vector index. The cache and semantic search
        are derived from that local mirror.
        """
        try:
            # 1. Mirror itsm-service KB → local kb_articles (+ rebuild vector index
            #    where the embedding model is available). DB mirror runs everywhere;
            #    index rebuild is a no-op where sentence_transformers isn't installed.
            try:
                import asyncio
                from common.kb_sync import sync_kb_from_itsm
                n = await asyncio.to_thread(sync_kb_from_itsm, True)
                logger.info(f"KB mirrored from itsm-service: {n} articles")
            except Exception as e:
                logger.warning(f"KB sync from itsm-service failed (using existing local mirror): {e}")

            # 2. Load the cache from the local mirror.
            with self._cache_lock:
                self._cache = []
            self._load_from_db()
            if not self._cache and self.fallback_to_json:
                logger.info("Local KB empty — falling back to JSON")
                self._load_json_fallback()
            return bool(self._cache)

        except Exception as e:
            logger.error(f"KB cache refresh failed: {e}")

            # Fallback to JSON if cache is empty
            if self.fallback_to_json and not self._cache:
                logger.warning("Falling back to JSON KB files")
                self._load_json_fallback()

            return False

    def _apply_transformed_cache(self, transformed: List[Dict]) -> None:
        """Generate embeddings/sections/QA caches and swap the cache in atomically."""
        # Generate embeddings if semantic search enabled
        if self.semantic_enabled and transformed:
            self._load_sentence_transformer()
            self._generate_embeddings(transformed)

        # Build section cache and embeddings (optional)
        if self.section_search_enabled and transformed:
            if self._model is None:
                self._load_sentence_transformer()
            self._build_section_cache(transformed)

        # Build QA cache and embeddings (optional)
        if self.qa_search_enabled and transformed:
            if self._model is None:
                self._load_sentence_transformer()
            self._build_qa_cache(transformed)

        # Update cache atomically
        with self._cache_lock:
            self._cache = transformed
            self._last_refresh = datetime.now()
            # Keep section cache aligned with article cache
            if self.section_search_enabled:
                self._section_cache = self._section_cache or []
            if self.qa_search_enabled:
                self._qa_cache = self._qa_cache or []

        # Save embeddings cache for faster next startup
        if self.semantic_enabled and self._embeddings is not None:
            self._save_embeddings_cache()

    async def _fetch_from_itsm_service(self) -> Optional[List[Dict]]:
        """Fetch all published KB articles from itsm-service as the KB bot.

        Returns None when the bot service account isn't configured (callers
        should fall back to another source), or a (possibly empty) list of
        raw itsm-service article dicts on success.
        """
        from common.iam_service import get_kb_bot_token
        from common.config_manager import get_itsm_config
        from action_server.actions.itsm_service import ITSMService

        token = get_kb_bot_token()
        if not token:
            return None

        itsm = ITSMService(get_itsm_config()['service_url'])

        spaces = await itsm.list_kb_spaces(token)
        if not spaces:
            return []

        articles: List[Dict] = []
        seen_ids = set()
        for space in spaces:
            slug = space.get('slug')
            if not slug:
                continue
            cursor = None
            while True:
                params = [("limit", "100"), ("status", "published")]
                if cursor:
                    params.append(("cursor", cursor))
                result = await itsm._request(
                    "GET", f"/api/v1/kb/spaces/{slug}/articles", token, params=params
                )
                if not result:
                    break
                items = result.get("items", []) if isinstance(result, dict) else result
                for article in items:
                    if article.get("id") in seen_ids:
                        continue
                    seen_ids.add(article.get("id"))
                    articles.append(article)
                cursor = result.get("next_cursor") if isinstance(result, dict) else None
                if not cursor or not items:
                    break

        return articles

    def _transform_itsm_articles(self, itsm_articles: List[Dict]) -> List[Dict]:
        """Transform itsm-service KBArticleResponse dicts to the unified KB cache format."""
        transformed = []

        for article in itsm_articles:
            try:
                title = article.get('title') or 'Untitled'
                body = article.get('body') or ''
                excerpt = article.get('excerpt') or ''
                keywords = self._extract_keywords(title, body, excerpt)

                transformed.append({
                    'id': f"itsm_{article['id']}",
                    'title': title,
                    'category': 'general',
                    'keywords': keywords,
                    'question': excerpt,
                    'content': body,
                    'video': None,
                    'related': [],
                    'source': 'itsm',
                    # Not a GLPI article — no GLPI deep link applies. itsm-service
                    # doesn't expose internal metadata (e.g. a migrated glpi_id)
                    # via its public article responses.
                    'glpi_id': None,
                    'itsm_id': article.get('id'),
                    'is_faq': False,
                    'date_modified': article.get('updated_at', ''),
                })
            except Exception as e:
                logger.error(f"Error transforming itsm article {article.get('id')}: {e}")
                continue

        return transformed


    def refresh_cache(self) -> bool:
        """Synchronous wrapper for refresh_cache_async."""
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        if loop.is_running():
            logger.warning("refresh_cache called from running loop. Use refresh_cache_async instead.")
            # We can't block here. If strictly needed, we'd need to spawn a thread or return a task (but this is sync def).
            # For checking threads (STOPPED) or init, loop shouldn't be running.
            return False
        
        return loop.run_until_complete(self.refresh_cache_async())

    def _split_article_sections(self, article: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Split article content into smaller sections for targeted responses."""
        content = (article.get('content') or '').strip()
        if not content:
            return []

        # Normalize content
        content = re.sub(r'\r\n', '\n', content)
        content = re.sub(r'\n{3,}', '\n\n', content)

        sections = []

        # Split by markdown headings if present
        heading_matches = list(re.finditer(r'(?m)^(#{1,3})\s+(.+)$', content))
        if heading_matches:
            split_points = [m.start() for m in heading_matches] + [len(content)]
            for idx, start in enumerate(split_points[:-1]):
                end = split_points[idx + 1]
                block = content[start:end].strip()
                if not block:
                    continue
                lines = block.splitlines()
                heading_line = lines[0].lstrip('#').strip() if lines else article.get('title', 'Section')
                body = '\n'.join(lines[1:]).strip()
                if not body:
                    continue
                sections.extend(self._chunk_section_body(article, heading_line, body))
        else:
            # Fallback: split by paragraph blocks
            paragraphs = [p.strip() for p in re.split(r'\n\s*\n', content) if p.strip()]
            if paragraphs:
                joined = '\n\n'.join(paragraphs)
                sections.extend(self._chunk_section_body(article, article.get('title', 'Section'), joined))

        return sections

    def _chunk_section_body(self, article: Dict[str, Any], title: str, body: str) -> List[Dict[str, Any]]:
        """Chunk a section body into logical, paragraph-bounded pieces."""
        body = body.strip()
        if not body:
            return []

        max_words = max(self.section_max_words, self.section_min_words)
        min_words = max(20, self.section_min_words)

        paragraphs = [p.strip() for p in re.split(r'\n\s*\n', body) if p.strip()]
        if not paragraphs:
            paragraphs = [body]

        chunks = []
        current = []
        current_words = 0
        idx = 1

        def flush_chunk(force: bool = False):
            nonlocal idx, current, current_words
            if not current:
                return
            if not force and current_words < min_words and chunks:
                return
            chunk_text = '\n\n'.join(current).strip()
            if not chunk_text:
                return
            chunk_title = title if idx == 1 else f"{title} (Part {idx})"
            chunks.append({
                'id': f"{article.get('id', 'article')}_sec_{idx}",
                'article_id': article.get('id'),
                'article_title': article.get('title', ''),
                'title': chunk_title,
                'content': chunk_text,
                'word_count': current_words,
                'category': article.get('category'),
                'keywords': article.get('keywords', []),
                'source': article.get('source'),
                'glpi_id': article.get('glpi_id')
            })
            idx += 1
            current = []
            current_words = 0

        for paragraph in paragraphs:
            para_words = paragraph.split()
            if len(para_words) > max_words:
                sentences = re.split(r'(?<=[.!?])\s+', paragraph)
                for sentence in sentences:
                    sentence = sentence.strip()
                    if not sentence:
                        continue
                    sentence_words = sentence.split()
                    if current_words + len(sentence_words) > max_words and current_words >= min_words:
                        flush_chunk(force=True)
                    current.append(sentence)
                    current_words += len(sentence_words)
                    if current_words >= max_words:
                        flush_chunk(force=True)
                continue

            if current_words + len(para_words) > max_words and current_words >= min_words:
                flush_chunk(force=True)
            current.append(paragraph)
            current_words += len(para_words)

        flush_chunk(force=True)
        return chunks

    def _build_section_cache(self, articles: List[Dict[str, Any]]):
        """Build section cache and embeddings from articles."""
        section_cache = []
        for article in articles:
            section_cache.extend(self._split_article_sections(article))

        self._section_cache = section_cache
        self._generate_section_embeddings(section_cache)
        logger.info(f"Section cache built: {len(self._section_cache)} sections")

    def _generate_section_embeddings(self, sections: List[Dict[str, Any]]):
        """Generate embeddings for section cache."""
        if not self._model or not sections:
            self._section_embeddings = None
            return

        try:
            texts = []
            for section in sections:
                text = f"{section.get('title', '')} {section.get('content', '')} {' '.join(section.get('keywords', []))}"
                texts.append(text)

            logger.info(f"Generating embeddings for {len(texts)} sections...")
            embeddings = self._model.encode(texts, show_progress_bar=False)
            self._section_embeddings = embeddings
            logger.info(f"Section embeddings generated: shape {embeddings.shape}")
        except Exception as e:
            logger.error(f"Error generating section embeddings: {e}")
            self._section_embeddings = None

    def _semantic_search_sections(self, query: str) -> Dict[int, float]:
        """Semantic search over section embeddings."""
        if not self._model or self._section_embeddings is None:
            return {}

        try:
            query_embedding = self._model.encode([query], show_progress_bar=False)[0]
            from sklearn.metrics.pairwise import cosine_similarity
            query_emb_2d = query_embedding.reshape(1, -1)
            similarities = cosine_similarity(query_emb_2d, self._section_embeddings)[0]
            return {i: float(sim) for i, sim in enumerate(similarities)}
        except Exception as e:
            logger.error(f"Error in section semantic search: {e}")
            return {}

    def _keyword_score_section(self, query: str, section: Dict[str, Any]) -> float:
        """Keyword score for section content and title."""
        query_words = set(query.lower().split())
        if not query_words:
            return 0.0

        title_words = set((section.get('title') or '').lower().split())
        content_words = set((section.get('content') or '').lower().split())
        keywords = set([k.lower() for k in section.get('keywords', [])])

        score = 0.0
        score += len(query_words.intersection(title_words)) * 2.0
        score += len(query_words.intersection(content_words)) * 1.0
        score += len(query_words.intersection(keywords)) * 2.5
        return score

    def search_sections(self, query: str, article_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Search KB sections using hybrid semantic + keyword scoring."""
        if not query or not self._section_cache:
            return []

        results = []

        semantic_scores = {}
        if self.semantic_enabled and self._section_embeddings is not None and self._model is not None:
            semantic_scores = self._semantic_search_sections(query)

        for i, section in enumerate(self._section_cache):
            if article_id and section.get('article_id') != article_id:
                continue
            semantic_score = semantic_scores.get(i, 0.0)
            keyword_score = self._keyword_score_section(query, section)

            if self.semantic_enabled and semantic_scores:
                final_score = (semantic_score * self.semantic_weight) + (keyword_score * self.keyword_weight)
            else:
                final_score = keyword_score

            if final_score >= self.min_score_threshold:
                results.append({
                    'section': section,
                    'score': final_score,
                    'semantic_score': semantic_score,
                    'keyword_score': keyword_score,
                    'source': section.get('source', 'unknown')
                })

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:self.section_max_results]

    def get_article_by_id(self, article_id: str) -> Optional[Dict[str, Any]]:
        """Return an article by id from cache."""
        if not article_id:
            return None
        for article in self._cache:
            if article.get('id') == article_id:
                return article
        return None

    def get_section_by_id(self, section_id: str) -> Optional[Dict[str, Any]]:
        """Return a section by id from cache."""
        if not section_id:
            return None
        for section in self._section_cache:
            if section.get('id') == section_id:
                return section
        return None

    def _build_qa_cache(self, articles: List[Dict[str, Any]]):
        """Build Q&A cache and embeddings from articles."""
        qa_cache = []

        for article in articles:
            question = (article.get('question') or '').strip()
            answer = (article.get('content') or '').strip()
            title = (article.get('title') or '').strip()

            if question and answer:
                qa_cache.append({
                    'id': f"{article.get('id', 'article')}_qa_1",
                    'article_id': article.get('id'),
                    'article_title': title,
                    'question': question,
                    'answer': answer,
                    'keywords': article.get('keywords', []),
                    'category': article.get('category'),
                    'source': article.get('source'),
                    'glpi_id': article.get('glpi_id')
                })

                # Add a secondary QA using title when it differs from question
                if title and title.lower() != question.lower():
                    qa_cache.append({
                        'id': f"{article.get('id', 'article')}_qa_2",
                        'article_id': article.get('id'),
                        'article_title': title,
                        'question': title,
                        'answer': answer,
                        'keywords': article.get('keywords', []),
                        'category': article.get('category'),
                        'source': article.get('source'),
                        'glpi_id': article.get('glpi_id')
                    })
            elif title and answer:
                # Fallback: use title as question if explicit question missing
                qa_cache.append({
                    'id': f"{article.get('id', 'article')}_qa_1",
                    'article_id': article.get('id'),
                    'article_title': title,
                    'question': title,
                    'answer': answer,
                    'keywords': article.get('keywords', []),
                    'category': article.get('category'),
                    'source': article.get('source'),
                    'glpi_id': article.get('glpi_id')
                })

        self._qa_cache = qa_cache
        self._generate_qa_embeddings(qa_cache)
        logger.info(f"QA cache built: {len(self._qa_cache)} pairs")

    def _generate_qa_embeddings(self, qa_pairs: List[Dict[str, Any]]):
        """Generate embeddings for QA cache."""
        if not self._model or not qa_pairs:
            self._qa_embeddings = None
            return

        try:
            texts = []
            for qa in qa_pairs:
                text = f"{qa.get('question', '')} {qa.get('answer', '')} {' '.join(qa.get('keywords', []))}"
                texts.append(text)

            logger.info(f"Generating embeddings for {len(texts)} QA pairs...")
            embeddings = self._model.encode(texts, show_progress_bar=False)
            self._qa_embeddings = embeddings
            logger.info(f"QA embeddings generated: shape {embeddings.shape}")
        except Exception as e:
            logger.error(f"Error generating QA embeddings: {e}")
            self._qa_embeddings = None

    def _semantic_search_qa(self, query: str) -> Dict[int, float]:
        """Semantic search over QA embeddings."""
        if not self._model or self._qa_embeddings is None:
            return {}

        try:
            query_embedding = self._model.encode([query], show_progress_bar=False)[0]
            from sklearn.metrics.pairwise import cosine_similarity
            query_emb_2d = query_embedding.reshape(1, -1)
            similarities = cosine_similarity(query_emb_2d, self._qa_embeddings)[0]
            return {i: float(sim) for i, sim in enumerate(similarities)}
        except Exception as e:
            logger.error(f"Error in QA semantic search: {e}")
            return {}

    def _keyword_score_qa(self, query: str, qa: Dict[str, Any]) -> float:
        """Keyword score for QA content and question."""
        query_words = set(query.lower().split())
        if not query_words:
            return 0.0

        question_words = set((qa.get('question') or '').lower().split())
        answer_words = set((qa.get('answer') or '').lower().split())
        keywords = set([k.lower() for k in qa.get('keywords', [])])

        score = 0.0
        score += len(query_words.intersection(question_words)) * 2.5
        score += len(query_words.intersection(answer_words)) * 1.0
        score += len(query_words.intersection(keywords)) * 2.0
        return score

    def search_qa(self, query: str) -> List[Dict[str, Any]]:
        """Search KB Q&A pairs using hybrid semantic + keyword scoring."""
        if not query or not self._qa_cache:
            return []

        results = []
        semantic_scores = {}
        if self.semantic_enabled and self._qa_embeddings is not None and self._model is not None:
            semantic_scores = self._semantic_search_qa(query)

        for i, qa in enumerate(self._qa_cache):
            semantic_score = semantic_scores.get(i, 0.0)
            keyword_score = self._keyword_score_qa(query, qa)

            if self.semantic_enabled and semantic_scores:
                final_score = (semantic_score * self.semantic_weight) + (keyword_score * self.keyword_weight)
            else:
                final_score = keyword_score

            if final_score >= self.min_score_threshold:
                results.append({
                    'qa': qa,
                    'score': final_score,
                    'semantic_score': semantic_score,
                    'keyword_score': keyword_score,
                    'source': qa.get('source', 'unknown')
                })

        results.sort(key=lambda x: x['score'], reverse=True)
        return results[:self.qa_max_results]

    def _extract_keywords(self, title: str, content: str, question: str) -> List[str]:
        """Extract keywords from article text using simple NLP."""
        # Combine all text
        text = f"{title} {question} {content}".lower()

        # Remove HTML tags
        text = re.sub(r'<[^>]+>', ' ', text)

        # Extract words (alphanumeric, 3+ chars)
        words = re.findall(r'\b[a-z0-9]{3,}\b', text)

        # Common stopwords to exclude
        stopwords = {
            'the', 'and', 'for', 'with', 'this', 'that', 'from', 'are',
            'how', 'you', 'your', 'can', 'will', 'not', 'but', 'was',
            'all', 'were', 'when', 'there', 'use', 'have', 'has', 'had'
        }
        words = [w for w in words if w not in stopwords]

        # Get top 15 most common words as keywords
        word_freq = Counter(words)
        keywords = [word for word, count in word_freq.most_common(15)]

        return keywords

    def _html_to_markdown(self, html_content: str) -> str:
        """Convert HTML to Markdown (basic conversion)."""
        if not html_content:
            return ""

        content = html_content

        # Basic HTML to Markdown conversions
        content = re.sub(r'<h1>(.*?)</h1>', r'# \1\n', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<h2>(.*?)</h2>', r'## \1\n', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<h3>(.*?)</h3>', r'### \1\n', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<strong>(.*?)</strong>', r'**\1**', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<b>(.*?)</b>', r'**\1**', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<em>(.*?)</em>', r'*\1*', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<i>(.*?)</i>', r'*\1*', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<li>(.*?)</li>', r'- \1\n', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<p>(.*?)</p>', r'\1\n\n', content, flags=re.IGNORECASE | re.DOTALL)
        content = re.sub(r'<br\s*/?>', '\n', content, flags=re.IGNORECASE)
        content = re.sub(r'<[^>]+>', '', content)  # Remove remaining tags

        # Decode HTML entities
        content = html_module.unescape(content)

        # Clean up excessive whitespace
        content = re.sub(r'\n{3,}', '\n\n', content)

        return content.strip()

    def _load_from_db(self):
        """Load articles from database."""
        try:
            from common.conversation_db import get_all_kb_articles
            
            db_articles = get_all_kb_articles()
            if not db_articles:
                logger.debug("No articles found in DB.")
                return

            transformed = []
            for article in db_articles:
                # Normalize keys to match cache format
                article['source'] = 'db'
                transformed.append(article)
                
            # Add to main cache
            with self._cache_lock:
                # Merge logic: Append DB articles, avoiding duplicates by ID? 
                # For now, just extend. Or maybe filtered append.
                existing_ids = {a['id'] for a in self._cache}
                for a in transformed:
                    if a['id'] not in existing_ids:
                        self._cache.append(a)
            
            # Generate embeddings and section cache for new DB articles
            self._process_post_load(transformed)
            
            logger.info(f"Loaded {len(transformed)} articles from DB")
            
        except Exception as e:
            logger.error(f"Error loading from DB: {e}")

    def _process_post_load(self, articles: List[Dict]):
        """Helper to generate embeddings and sections for a batch of articles."""
        if not articles:
            return

        if self.semantic_enabled:
            self._load_sentence_transformer()
            # Note: This regenerates ALL embeddings if we just pass 'articles'. 
            # ideally we mix them. But _generate_embeddings helper overwrites self._embeddings.
            # So careful. For now, simpliest approach: Re-generate for everything in cache? 
            # Or just for these? _generate_embeddings overwrites self._embeddings.
            # Let's rely on the fact that refresh_cache calls this generally.
            # If we are loading from DB as a STEP in refresh, we should accumulate first.
            # If we are loading from DB as a STEP in refresh, we should accumulate first.
            pass

    def _load_json_fallback(self):
        """Load JSON KB files as fallback (and DB)."""
        kb_dir = os.path.join(
            os.path.dirname(__file__), '..', 'data', 'knowledge_base'
        )

        articles = []
        if os.path.exists(kb_dir):
            for filename in os.listdir(kb_dir):
                if filename.endswith('.json'):
                    filepath = os.path.join(kb_dir, filename)
                    try:
                        with open(filepath, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            for article in data.get('articles', []):
                                article['source'] = 'json'
                                articles.append(article)
                    except Exception as e:
                        logger.error(f"Error loading {filename}: {e}")
        
        # Also load from DB
        try:
            from common.conversation_db import get_all_kb_articles
            db_articles = get_all_kb_articles()
            for article in db_articles:
                article['source'] = 'db'
                articles.append(article)
        except Exception as e:
             logger.error(f"Error loading from DB in fallback: {e}")

        # Generate embeddings for JSON/DB articles too
        if self.semantic_enabled and articles:
            self._load_sentence_transformer()
            self._generate_embeddings(articles)

        if self.section_search_enabled and articles:
            if self._model is None:
                self._load_sentence_transformer()
            self._build_section_cache(articles)

        if self.qa_search_enabled and articles:
            if self._model is None:
                self._load_sentence_transformer()
            self._build_qa_cache(articles)

        with self._cache_lock:
            self._cache = articles
            if self.section_search_enabled:
                self._section_cache = self._section_cache or []
            if self.qa_search_enabled:
                self._qa_cache = self._qa_cache or []
            self._last_refresh = datetime.now()

        logger.info(f"Fallback (JSON+DB) loaded: {len(articles)} articles")

    def _load_sentence_transformer(self):
        """Load sentence transformer model (cached)."""
        if self._model is not None:
            return  # Already loaded

        try:
            from sentence_transformers import SentenceTransformer
            logger.info(f"Loading sentence transformer model: {self.semantic_model_name}")
            self._model = SentenceTransformer(self.semantic_model_name)
            logger.info(f"Model loaded: {self.semantic_model_name}")
        except Exception as e:
            logger.error(f"Failed to load sentence transformer: {e}")
            logger.warning("Semantic search disabled - falling back to keyword-only")
            self.semantic_enabled = False

    def _generate_embeddings(self, articles: List[Dict]):
        """Generate embeddings for all articles."""
        if not self._model or not articles:
            return

        try:
            # Create text representations for embedding
            texts = []
            for article in articles:
                # Combine title, question, and keywords for better semantic representation
                text = f"{article['title']} {article.get('question', '')} {' '.join(article.get('keywords', []))}"
                texts.append(text)

            # Generate embeddings
            logger.info(f"Generating embeddings for {len(texts)} articles...")
            embeddings = self._model.encode(texts, show_progress_bar=False)
            self._embeddings = embeddings
            logger.info(f"Embeddings generated: shape {embeddings.shape}")

        except Exception as e:
            logger.error(f"Error generating embeddings: {e}")
            self._embeddings = None

    def _save_embeddings_cache(self):
        """Save embeddings to pickle file for faster next startup."""
        try:
            cache_dir = os.path.join(os.path.dirname(__file__), '..', 'data', 'cache')
            os.makedirs(cache_dir, exist_ok=True)

            cache_file = os.path.join(cache_dir, 'kb_embeddings.pkl')

            cache_data = {
                'embeddings': self._embeddings,
                'articles': self._cache,
                'timestamp': datetime.now().isoformat(),
                'model': self.semantic_model_name
            }

            with open(cache_file, 'wb') as f:
                pickle.dump(cache_data, f)

            logger.info(f"Embeddings cache saved: {cache_file}")
        except Exception as e:
            logger.error(f"Error saving embeddings cache: {e}")

    def _load_embeddings_cache(self):
        """Load embeddings from pickle file (fast startup)."""
        try:
            cache_file = os.path.join(
                os.path.dirname(__file__), '..', 'data', 'cache', 'kb_embeddings.pkl'
            )

            if not os.path.exists(cache_file):
                return

            with open(cache_file, 'rb') as f:
                cache_data = pickle.load(f)

            # Verify model matches
            if cache_data.get('model') != self.semantic_model_name:
                logger.warning(f"Cached embeddings model mismatch: {cache_data.get('model')} vs {self.semantic_model_name}")
                return

            self._embeddings = cache_data['embeddings']
            self._cache = cache_data['articles']
            self._last_refresh = datetime.fromisoformat(cache_data['timestamp'])

            if self.section_search_enabled:
                if self._model is None:
                    self._load_sentence_transformer()
                self._build_section_cache(self._cache)

            if self.qa_search_enabled:
                if self._model is None:
                    self._load_sentence_transformer()
                self._build_qa_cache(self._cache)

            logger.info(f"Embeddings cache loaded: {len(self._cache)} articles from {self._last_refresh}")

        except Exception as e:
            logger.error(f"Error loading embeddings cache: {e}")

    def search_articles(self, query: str, app_id: str = None) -> List[Dict]:
        """
        Search knowledge base using hybrid semantic + keyword search.
        Returns list of dicts with: {article, score, semantic_score, keyword_score, source}
        """
        if not query or not self._cache:
            return []

        results = []

        # Semantic search (if enabled and embeddings available)
        semantic_scores = {}
        if self.semantic_enabled and self._embeddings is not None and self._model is not None:
            semantic_scores = self._semantic_search(query)

        # Keyword search
        keyword_scores = self._keyword_search(query)

        # Combine scores
        for i, article in enumerate(self._cache):
            semantic_score = semantic_scores.get(i, 0.0)
            keyword_score = keyword_scores.get(i, 0.0)

            # Hybrid scoring
            if self.semantic_enabled and semantic_scores:
                final_score = (semantic_score * self.semantic_weight) + (keyword_score * self.keyword_weight)
            else:
                # Fallback to keyword-only if semantic disabled
                final_score = keyword_score

            if final_score >= self.min_score_threshold:
                results.append({
                    'article': article,
                    'score': final_score,
                    'semantic_score': semantic_score,
                    'keyword_score': keyword_score,
                    'source': article.get('source', 'unknown')
                })

        # Sort by score descending
        results.sort(key=lambda x: x['score'], reverse=True)

        # Return top N results
        return results[:self.max_results]

    def _semantic_search(self, query: str) -> Dict[int, float]:
        """Perform semantic search using cosine similarity."""
        if not self._model or self._embeddings is None:
            return {}

        try:
            # Generate query embedding
            query_embedding = self._model.encode([query], show_progress_bar=False)[0]

            # Calculate cosine similarity with all article embeddings
            from sklearn.metrics.pairwise import cosine_similarity

            # Reshape for sklearn
            query_emb_2d = query_embedding.reshape(1, -1)

            # Calculate similarities
            similarities = cosine_similarity(query_emb_2d, self._embeddings)[0]

            # Return as dict: {article_index: similarity_score}
            scores = {i: float(sim) for i, sim in enumerate(similarities)}
            return scores

        except Exception as e:
            logger.error(f"Error in semantic search: {e}")
            return {}

    def _keyword_search(self, query: str) -> Dict[int, float]:
        """Perform keyword-based search with scoring."""
        query_words = set(query.lower().split())
        scores = {}

        for i, article in enumerate(self._cache):
            score = 0.0

            # Check keywords (highest weight)
            keywords = [k.lower() for k in article.get('keywords', [])]
            for word in query_words:
                for keyword in keywords:
                    if word in keyword or keyword in word:
                        score += 3.0
                        break

            # Check title (medium weight)
            title_words = set(article.get('title', '').lower().split())
            common_title = query_words.intersection(title_words)
            score += len(common_title) * 2.0

            # Check question (medium weight)
            question_words = set(article.get('question', '').lower().split())
            common_question = query_words.intersection(question_words)
            score += len(common_question) * 2.0

            # Normalize to 0-1 range (max possible ~20 for a good match)
            normalized_score = min(score / 20.0, 1.0)
            scores[i] = normalized_score

        return scores

    def get_all_articles(self) -> List[Dict]:
        """Get all cached articles."""
        with self._cache_lock:
            return self._cache.copy()

    def get_cache_info(self) -> Dict[str, Any]:
        """Get cache status information."""
        with self._cache_lock:
            # Calculate cache size in MB
            cache_size_mb = 0.0
            if self._embeddings is not None:
                cache_size_mb = self._embeddings.nbytes / (1024 * 1024)

            embedding_dim = self._embeddings.shape[1] if self._embeddings is not None else 0

            return {
                'article_count': len(self._cache),
                'last_refresh': self._last_refresh.isoformat() if self._last_refresh else None,
                'refresh_interval': self.refresh_interval,
                'enabled': self.enabled,
                'source': self._cache[0]['source'] if self._cache else None,
                'semantic_enabled': self.semantic_enabled,
                'model_name': self.semantic_model_name if self.semantic_enabled else None,
                'embedding_dimension': embedding_dim,
                'cache_size_mb': round(cache_size_mb, 2),
                'semantic_weight': self.semantic_weight,
                'keyword_weight': self.keyword_weight
            }

    def force_refresh(self) -> bool:
        """Manually trigger cache refresh."""
        return self.refresh_cache()

    def clear_cache(self):
        """Clear cache and embeddings."""
        with self._cache_lock:
            self._cache = []
            self._embeddings = None
            self._section_cache = []
            self._section_embeddings = None
            self._qa_cache = []
            self._qa_embeddings = None
            self._last_refresh = None
        logger.info("KB cache cleared")

    def stop(self):
        """Stop refresh thread (for cleanup)."""
        self._stop_refresh.set()
        if self._refresh_thread:
            self._refresh_thread.join(timeout=5)


# Global singleton instance
kb_cache = KBCacheManager()
