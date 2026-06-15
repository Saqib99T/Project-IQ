"""
KB sync — itsm-service is the source of truth for the knowledge base; the bot
keeps a *local* synced copy so it can do fast, pre-login, no-auth semantic search
without calling GLPI or needing a live itsm bot token.

This is a backend job (not the pre-login bot): it reads itsm-service's KB directly
from its database and mirrors the published/public articles into the bot's local
`kb_articles` table, then rebuilds the bot's in-memory vector index.

itsm DB connection comes from env (ITSM_DB_*), defaulting to the dev compose values.
Secrets (password) must come from the environment — never commit a real one.
"""
import os
import logging
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger(__name__)


def _itsm_conn_params() -> dict:
    return dict(
        host=os.environ.get("ITSM_DB_HOST", "127.0.0.1"),
        port=int(os.environ.get("ITSM_DB_PORT", "5433")),
        dbname=os.environ.get("ITSM_DB_NAME", "itsm_db"),
        user=os.environ.get("ITSM_DB_USER", "itsm_app"),
        password=os.environ.get("ITSM_DB_PASSWORD", "itsm_app_pass"),
        connect_timeout=8,
    )


def _read_itsm_articles() -> list:
    """Read published/public KB articles from itsm-service's database."""
    conn = psycopg2.connect(**_itsm_conn_params())
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            """
            SELECT a.id::text AS id,
                   a.title,
                   a.body,
                   a.excerpt,
                   COALESCE(c.name, 'General') AS category
            FROM kb_articles a
            LEFT JOIN kb_categories c ON c.id = a.category_id
            WHERE a.status = 'published'
              AND a.visibility = 'public'
            ORDER BY a.title
            """
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def sync_kb_from_itsm(rebuild_index: bool = True) -> int:
    """Mirror itsm-service KB → bot's local kb_articles. Returns article count.

    Leaves the local KB untouched if itsm returns nothing (avoids wiping the cache
    on a transient itsm outage).
    """
    rows = _read_itsm_articles()
    if not rows:
        logger.warning("[KB sync] itsm returned 0 articles — leaving local KB unchanged")
        return 0

    from common.db._connection import _get_connection, _release_connection
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM kb_articles")
        for r in rows:
            content = (r.get("body") or r.get("excerpt") or "").strip()
            cur.execute(
                "INSERT INTO kb_articles (id, title, category, keywords, question, content, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW())",
                (r["id"], r["title"], r.get("category") or "General", None, None, content),
            )
        conn.commit()
        logger.info(f"[KB sync] mirrored {len(rows)} articles from itsm-service into local kb_articles")
    finally:
        _release_connection(conn)

    if rebuild_index:
        try:
            from common.vector_search import load_and_process_articles
            n = load_and_process_articles()
            logger.info(f"[KB sync] rebuilt bot vector index ({n} chunks)")
        except Exception as e:
            logger.warning(f"[KB sync] vector index rebuild failed (non-fatal): {e}")

    return len(rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print(f"Synced {sync_kb_from_itsm()} KB articles from itsm-service.")
