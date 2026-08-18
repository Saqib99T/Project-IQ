"""KB search gap logging and reporting."""
import logging
logger = logging.getLogger(__name__)


def log_kb_gap(query: str, app_id: str = None, sender_id: str = None,
                org_id: str = None, product_id: str = None) -> None:
    """org_id/product_id (KB_WIKI_CURATION_RAG_PLAN Phase 5) let itsm-service's
    gap-clustering job scope drafts to the right tenant without a cross-repo
    join — denormalized at write time, same convention as kb_articles.org_id."""
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            "INSERT INTO kb_search_gaps (query, app_id, sender_id, org_id, product_id) "
            "VALUES (%s, %s, %s, %s, %s)",
            (query[:500], app_id, sender_id, org_id, product_id),
        )
        conn.commit()
    except Exception as e:
        logger.debug(f"[KB Gaps] log error: {e}")
    finally:
        if conn:
            _release_connection(conn)


def get_kb_gaps(days: int = 7, limit: int = 20, app_id: str = None):
    from common.conversation_db import _get_connection, _release_connection
    from psycopg2.extras import RealDictCursor
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor(cursor_factory=RealDictCursor)
        if app_id:
            cur.execute(
                """
                SELECT query, COUNT(*) AS count, MAX(searched_at) AS last_seen
                FROM kb_search_gaps
                WHERE searched_at > NOW() - INTERVAL '%s days'
                  AND app_id = %s
                GROUP BY query ORDER BY count DESC LIMIT %s
                """,
                (days, app_id, limit),
            )
        else:
            cur.execute(
                """
                SELECT query, COUNT(*) AS count, MAX(searched_at) AS last_seen
                FROM kb_search_gaps
                WHERE searched_at > NOW() - INTERVAL '%s days'
                GROUP BY query ORDER BY count DESC LIMIT %s
                """,
                (days, limit),
            )
        rows = cur.fetchall()
        return [
            {'query': r['query'], 'count': r['count'],
             'last_seen': r['last_seen'].isoformat() if r['last_seen'] else None}
            for r in rows
        ]
    except Exception as e:
        logger.error(f"[KB Gaps] get error: {e}")
        return []
    finally:
        if conn:
            _release_connection(conn)
