"""
IAM ↔ GLPI user mapping.

Provides get_or_provision_glpi_user() which:
  1. Looks up the cached iam_sub → glpi_user_id mapping in our DB.
  2. If not found, creates the GLPI user via service account and caches the mapping.

Schema (created on first call if missing):
    CREATE TABLE IF NOT EXISTS iam_glpi_users (
        iam_sub        TEXT PRIMARY KEY,
        glpi_user_id   INTEGER NOT NULL,
        email          TEXT,
        display_name   TEXT,
        provisioned_at TIMESTAMPTZ DEFAULT NOW()
    );
"""
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _ensure_table(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS iam_glpi_users (
            iam_sub        TEXT PRIMARY KEY,
            glpi_user_id   INTEGER NOT NULL,
            email          TEXT,
            display_name   TEXT,
            provisioned_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    conn.commit()


def get_glpi_user_id(iam_sub: str) -> Optional[int]:
    """Return the cached GLPI user ID for this IAM sub, or None."""
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        _ensure_table(conn)
        cur = conn.cursor()
        cur.execute("SELECT glpi_user_id FROM iam_glpi_users WHERE iam_sub = %s", (iam_sub,))
        row = cur.fetchone()
        return row[0] if row else None
    except Exception as e:
        logger.error(f"[IAM-GLPI] get_glpi_user_id error: {e}")
        return None
    finally:
        if conn:
            _release_connection(conn)


def _store_mapping(iam_sub: str, glpi_user_id: int, email: str, display_name: str):
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO iam_glpi_users (iam_sub, glpi_user_id, email, display_name)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (iam_sub) DO UPDATE
              SET glpi_user_id = EXCLUDED.glpi_user_id,
                  email        = EXCLUDED.email,
                  display_name = EXCLUDED.display_name
        """, (iam_sub, glpi_user_id, email, display_name))
        conn.commit()
    except Exception as e:
        logger.error(f"[IAM-GLPI] _store_mapping error: {e}")
    finally:
        if conn:
            _release_connection(conn)


def _provision_glpi_user(name: str, email: str, given_name: str, family_name: str) -> Optional[int]:
    """Create a GLPI user via service account. Returns new glpi_user_id or None."""
    import asyncio
    try:
        from action_server.actions.glpi_service import GlpiService
        from common.config_manager import get_glpi_config
        cfg = get_glpi_config()
        glpi = GlpiService(cfg['api_url'], cfg['app_token'], cfg['user_token'])

        async def _create():
            session = await glpi.init_session()
            if not session:
                return None
            try:
                import aiohttp
                url = f"{cfg['api_url']}/User"
                headers = {
                    "Content-Type":    "application/json",
                    "App-Token":       cfg['app_token'],
                    "Session-Token":   session,
                }
                payload = {
                    "input": {
                        "name":     email or name,
                        "firstname": given_name or name,
                        "realname":  family_name,
                        "email":     email,
                        "_useremails": [{"email": email}] if email else [],
                    }
                }
                async with aiohttp.ClientSession() as http:
                    async with http.post(url, json=payload, headers=headers) as resp:
                        if resp.status in (200, 201):
                            data = await resp.json()
                            return data.get("id")
                        body = await resp.text()
                        logger.warning(f"[IAM-GLPI] GLPI user create failed {resp.status}: {body}")
                        return None
            finally:
                await glpi.kill_session(session)

        return asyncio.run(_create())
    except Exception as e:
        logger.error(f"[IAM-GLPI] _provision_glpi_user error: {e}")
        return None


def get_iam_sub_by_glpi_user_id(glpi_user_id: int) -> Optional[str]:
    """Reverse lookup: GLPI user ID → IAM sub. Returns None if not found."""
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            "SELECT iam_sub FROM iam_glpi_users WHERE glpi_user_id = %s",
            (glpi_user_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None
    except Exception as e:
        logger.error(f"[IAM-GLPI] get_iam_sub_by_glpi_user_id error: {e}")
        return None
    finally:
        if conn:
            _release_connection(conn)


def store_ticket_sender(glpi_ticket_id: int, sender_id: str, app_id: str = None) -> None:
    """Record which sender_id created a GLPI ticket so webhook events can notify them."""
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            """
            INSERT INTO ticket_senders (glpi_ticket_id, sender_id, app_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (glpi_ticket_id) DO NOTHING
            """,
            (glpi_ticket_id, sender_id, app_id),
        )
        conn.commit()
    except Exception as e:
        logger.error(f"[IAM-GLPI] store_ticket_sender error: {e}")
    finally:
        if conn:
            _release_connection(conn)


def get_sender_by_ticket_id(glpi_ticket_id: int) -> Optional[str]:
    """Return sender_id for a ticket. Checks our table first (fast path)."""
    from common.conversation_db import _get_connection, _release_connection
    conn = None
    try:
        conn = _get_connection()
        cur  = conn.cursor()
        cur.execute(
            "SELECT sender_id FROM ticket_senders WHERE glpi_ticket_id = %s",
            (glpi_ticket_id,),
        )
        row = cur.fetchone()
        return row[0] if row else None
    except Exception as e:
        logger.error(f"[IAM-GLPI] get_sender_by_ticket_id error: {e}")
        return None
    finally:
        if conn:
            _release_connection(conn)


def get_or_provision_glpi_user(iam_sub: str, name: str, email: str,
                                given_name: str = "", family_name: str = "") -> Optional[int]:
    """
    Return the GLPI user ID for this IAM user.
    Creates the GLPI user and caches the mapping if this is the first call.
    Returns None if provisioning fails (ticket will fall back to service account).
    """
    # Fast path — cached mapping
    glpi_id = get_glpi_user_id(iam_sub)
    if glpi_id:
        return glpi_id

    if not email and not name:
        logger.warning(f"[IAM-GLPI] Cannot provision GLPI user for {iam_sub}: no email or name")
        return None

    logger.info(f"[IAM-GLPI] Provisioning GLPI user for {iam_sub} ({email})")
    glpi_id = _provision_glpi_user(name, email, given_name, family_name)
    if glpi_id:
        _store_mapping(iam_sub, glpi_id, email, name)
        logger.info(f"[IAM-GLPI] Provisioned GLPI user {glpi_id} for IAM sub {iam_sub}")
    else:
        logger.warning(f"[IAM-GLPI] Failed to provision GLPI user for {iam_sub} — tickets will use service account")

    return glpi_id
