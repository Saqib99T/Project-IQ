"""Shared persistence step for SOURCE extensions that feed the knowledge
base. A source extension's `run()` is only responsible for fetching and
parsing records from its platform; saving them, rebuilding the search
embeddings once per run (not once per article), and logging the run for the
admin UI's data-sources list all happen here — kept out of each extension so
pull logic (talking to a specific platform's API) never mixes with what
happens to the result.
"""
import hashlib
import logging

logger = logging.getLogger(__name__)


def make_article_id(source_type: str, record_id: str) -> str:
    """Deterministic id so re-running a pull updates existing articles
    (add_kb_article is an upsert) instead of duplicating them."""
    return hashlib.md5(f"{source_type}:{record_id}".encode()).hexdigest()


def save_articles(source_type: str, articles: list, source_config: dict) -> int:
    from common.conversation_db import add_kb_article

    saved = 0
    for article in articles:
        ok = add_kb_article(
            article_id=article["id"],
            title=article["title"],
            content=article["content"],
            category=article.get("category"),
            keywords=article.get("keywords") or [],
        )
        if ok:
            saved += 1

    if saved:
        _rebuild_embeddings()
        _log_run(source_type, source_config, saved)
    return saved


def _rebuild_embeddings():
    try:
        from common.vector_search import load_and_process_articles
        load_and_process_articles()
    except Exception:
        logger.warning("[Extensions] could not rebuild embeddings after a pull", exc_info=True)


def _log_run(source_type: str, source_config: dict, articles_count: int):
    try:
        from common.firecrawl_ingester import log_data_source
        safe_config = {
            k: ("***" if any(s in k.lower() for s in ("token", "password", "key", "secret", "credentials")) else v)
            for k, v in (source_config or {}).items()
        }
        log_data_source(f"extension_{source_type}", safe_config, articles_count)
    except Exception:
        logger.warning("[Extensions] could not log run for %s", source_type, exc_info=True)
