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

        # Load config and start
        self._load_config()

        # Try to load cached embeddings first (faster startup)
        self._load_embeddings_cache()

        # Start refresh thread
        self._start_refresh_thread()

    def _load_config(self):
        """Load KB configuration from config manager."""
        try:
            from actions.config_manager import get_kb_config
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

            logger.info(f"KB Config loaded: semantic_enabled={self.semantic_enabled}, model={self.semantic_model_name}")
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

        # Initial load (Always performed at startup)
        self.refresh_cache()

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

    def refresh_cache(self) -> bool:
        """Fetch KB articles from GLPI and update cache."""
        try:
            logger.info("Refreshing KB cache from GLPI...")

            # Initialize GLPI session
            from actions.config_manager import get_glpi_config
            from actions.glpi_service import GlpiService

            glpi_config = get_glpi_config()
            glpi_service = GlpiService(
                api_uri=glpi_config['api_url'],
                app_token=glpi_config['app_token'],
                user_token=glpi_config['user_token']
            )

            session_token = glpi_service.init_session()
            if not session_token:
                raise Exception("Failed to initialize GLPI session")

            try:
                # Fetch all KB items (no entity filter as per requirements)
                articles = glpi_service.get_all_knowbase_items(session_token)

                if not articles:
                    logger.warning("No KB articles returned from GLPI")
                    # Don't clear cache if GLPI returns empty - might be temporary issue
                    if not self._cache and self.fallback_to_json:
                        logger.info("Cache empty, falling back to JSON")
                        self._load_json_fallback()
                    return False

                # Transform to unified format
                transformed = self._transform_articles(articles)

                # Generate embeddings if semantic search enabled
                if self.semantic_enabled and transformed:
                    self._load_sentence_transformer()
                    self._generate_embeddings(transformed)

                # Update cache atomically
                with self._cache_lock:
                    self._cache = transformed
                    self._last_refresh = datetime.now()

                # Save embeddings cache for faster next startup
                if self.semantic_enabled and self._embeddings is not None:
                    self._save_embeddings_cache()

                logger.info(f"KB cache refreshed: {len(transformed)} articles loaded")
                return True

            finally:
                glpi_service.kill_session(session_token)

        except Exception as e:
            logger.error(f"KB cache refresh failed: {e}")

            # Fallback to JSON if cache is empty
            if self.fallback_to_json and not self._cache:
                logger.warning("Falling back to JSON KB files")
                self._load_json_fallback()

            return False

    def _transform_articles(self, glpi_articles: List[Dict]) -> List[Dict]:
        """Transform GLPI articles to unified KB format."""
        transformed = []

        for article in glpi_articles:
            try:
                # Extract keywords from content
                keywords = self._extract_keywords(
                    article.get('name', ''),
                    article.get('answer', ''),
                    article.get('question', '')
                )

                transformed_article = {
                    'id': f"glpi_{article['id']}",
                    'title': article.get('name', 'Untitled'),
                    'category': self._map_category(article.get('knowbaseitemcategories_id')),
                    'keywords': keywords,
                    'question': article.get('question', ''),
                    'content': self._html_to_markdown(article.get('answer', '')),
                    'video': None,  # GLPI may not have video field
                    'related': [],  # Could be enhanced later
                    'source': 'glpi',
                    'glpi_id': article['id'],
                    'is_faq': article.get('is_faq', 0) == 1,
                    'date_modified': article.get('date_mod', '')
                }

                transformed.append(transformed_article)
            except Exception as e:
                logger.error(f"Error transforming article {article.get('id')}: {e}")
                continue

        return transformed

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

    def _map_category(self, category_id: Optional[int]) -> str:
        """Map GLPI category ID to friendly category name."""
        # This would need to be customized based on actual GLPI categories
        # For now, return generic category
        if not category_id:
            return 'general'

        category_map = {
            1: 'account',
            2: 'network',
            3: 'hardware',
            4: 'software',
            5: 'security',
            6: 'mobile',
        }
        return category_map.get(category_id, 'general')

    def _load_json_fallback(self):
        """Load JSON KB files as fallback."""
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

        # Generate embeddings for JSON articles too
        if self.semantic_enabled and articles:
            self._load_sentence_transformer()
            self._generate_embeddings(articles)

        with self._cache_lock:
            self._cache = articles
            self._last_refresh = datetime.now()

        logger.info(f"JSON fallback loaded: {len(articles)} articles")

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
            self._last_refresh = None
        logger.info("KB cache cleared")

    def stop(self):
        """Stop refresh thread (for cleanup)."""
        self._stop_refresh.set()
        if self._refresh_thread:
            self._refresh_thread.join(timeout=5)


# Global singleton instance
kb_cache = KBCacheManager()
