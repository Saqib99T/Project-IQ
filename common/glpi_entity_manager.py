"""
GLPI Entity Manager — maps IAM org_id to GLPI entities_id.

On the first ticket from a new org, creates a GLPI entity under the
99-Technologies parent entity and caches the mapping in glpi_org_entities.
Subsequent lookups hit the DB cache — no GLPI API call needed.

Usage:
    from common.glpi_entity_manager import get_entity_id, get_category_id

    entity_id   = await get_entity_id(org_id, org_name, glpi_session)
    category_id = get_category_id("accountwise-support")
"""
import asyncio
import logging
import threading

logger = logging.getLogger(__name__)

_lock = threading.Lock()


# ── Category lookup (config-only, no DB needed) ───────────────────────────────

def get_category_id(product_id: str) -> int:
    """Return the GLPI ITIL category id for a product_id key.
    Falls back to 0 (uncategorised) if not configured yet."""
    try:
        from common.config_manager import get_glpi_categories
        cats = get_glpi_categories()
        return cats.get(product_id.lower(), 0)
    except Exception as e:
        logger.warning(f"[EntityMgr] get_category_id({product_id}): {e}")
        return 0


# ── Entity lookup / creation ──────────────────────────────────────────────────

def _get_platform_entity_id() -> int:
    try:
        from common.config_manager import get_platform_config
        return int(get_platform_config().get("glpi_entity_id", 0))
    except Exception:
        return 0


def _db_get_entity(org_id: str):
    """Return (entity_id, org_name) from cache or None."""
    try:
        from common.db._connection import _get_connection, _release_connection
        conn = _get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT glpi_entity_id, org_name FROM glpi_org_entities WHERE org_id = %s",
                (org_id,),
            )
            row = cur.fetchone()
            return (row[0], row[1]) if row else None
        finally:
            _release_connection(conn)
    except Exception as e:
        logger.warning(f"[EntityMgr] DB get error: {e}")
        return None


def _db_save_entity(org_id: str, org_name: str, entity_id: int):
    try:
        from common.db._connection import _get_connection, _release_connection
        conn = _get_connection()
        try:
            cur = conn.cursor()
            cur.execute(
                """INSERT INTO glpi_org_entities (org_id, org_name, glpi_entity_id)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (org_id) DO UPDATE
                   SET org_name = EXCLUDED.org_name,
                       glpi_entity_id = EXCLUDED.glpi_entity_id""",
                (org_id, org_name, entity_id),
            )
            conn.commit()
        finally:
            _release_connection(conn)
    except Exception as e:
        logger.error(f"[EntityMgr] DB save error: {e}")


async def _glpi_create_entity(org_name: str, parent_entity_id: int, glpi_session: str) -> int:
    """Create a GLPI entity and return its id."""
    try:
        from action_server.actions.glpi_service import GlpiService
        from common.config_manager import get_glpi_config
        cfg  = get_glpi_config()
        glpi = GlpiService(cfg["api_url"], cfg["app_token"], cfg["user_token"])

        result = await glpi._request(
            "POST",
            "Entity",
            glpi_session,
            json={
                "input": {
                    "name":        org_name,
                    "entities_id": parent_entity_id,
                }
            },
        )
        entity_id = result.get("id") if isinstance(result, dict) else None
        if entity_id:
            logger.info(f"[EntityMgr] Created GLPI entity '{org_name}' → id={entity_id}")
            return int(entity_id)
        raise ValueError(f"Unexpected GLPI response: {result}")
    except Exception as e:
        logger.error(f"[EntityMgr] GLPI create entity '{org_name}': {e}")
        return 0


async def get_entity_id(org_id: str, org_name: str, glpi_session: str = None) -> int:
    """
    Return the GLPI entities_id for an org, creating it if needed.
    Thread-safe: only one creation per org_id at a time.

    glpi_session is only needed on first call for a new org.
    If not provided and entity doesn't exist, returns platform entity as fallback.
    """
    # 1. Fast path — DB cache
    cached = _db_get_entity(org_id)
    if cached:
        return cached[0]

    # 2. Platform entity fallback when GLPI session not available
    platform_id = _get_platform_entity_id()
    if not glpi_session:
        logger.warning(f"[EntityMgr] No session for new org '{org_id}' — using platform entity")
        return platform_id

    # 3. Serialize creation per org_id
    with _lock:
        # Re-check after acquiring lock
        cached = _db_get_entity(org_id)
        if cached:
            return cached[0]

        entity_id = await _glpi_create_entity(org_name or org_id, platform_id, glpi_session)
        if entity_id:
            _db_save_entity(org_id, org_name or org_id, entity_id)
            return entity_id

    return platform_id


def get_entity_id_sync(org_id: str, org_name: str = "", glpi_session: str = None) -> int:
    """Synchronous wrapper for use outside async contexts."""
    cached = _db_get_entity(org_id)
    if cached:
        return cached[0]
    if glpi_session:
        try:
            return asyncio.run(get_entity_id(org_id, org_name, glpi_session))
        except Exception as e:
            logger.error(f"[EntityMgr] sync wrapper error: {e}")
    return _get_platform_entity_id()
