"""common.db._extensions — per-tenant install/config storage for the
extension framework (extensions/), generalizing the one-table-per-integration
pattern (see common/db/_shopify.py) so a new extension never needs its own
migration just to have somewhere to keep its config.

`secrets` is stored as a single Fernet-encrypted JSON blob (common/crypto.py)
— callers get it back decrypted as a dict; it is never included in any
response shape meant for the admin UI (see `installs_for_org` vs the raw
row helpers).
"""
import json
import logging
from typing import Dict, List, Optional

from psycopg2.extras import RealDictCursor

from common.crypto import decrypt_secret, encrypt_secret
from common.db._connection import _get_connection, _release_connection

logger = logging.getLogger(__name__)


def upsert_install(
    org_id: Optional[str], extension_id: str, config: Dict,
    secrets: Optional[Dict] = None, external_id: Optional[str] = None,
) -> None:
    conn = _get_connection()
    try:
        cur = conn.cursor()
        secrets_blob = encrypt_secret(json.dumps(secrets)) if secrets else None
        cur.execute(
            """INSERT INTO extension_installs
                   (org_id, extension_id, external_id, config, secrets, status, updated_at)
               VALUES (%s, %s, %s, %s, %s, 'installed', NOW())
               ON CONFLICT (COALESCE(org_id, ''), extension_id) DO UPDATE SET
                   external_id = COALESCE(EXCLUDED.external_id, extension_installs.external_id),
                   config      = EXCLUDED.config,
                   secrets     = COALESCE(EXCLUDED.secrets, extension_installs.secrets),
                   status      = 'installed',
                   updated_at  = NOW()""",
            (org_id, extension_id, external_id, json.dumps(config or {}), secrets_blob),
        )
        conn.commit()
    finally:
        _release_connection(conn)


def _decrypt_row(row: Dict) -> Dict:
    row = dict(row)
    if row.get("secrets"):
        try:
            row["secrets"] = json.loads(decrypt_secret(row["secrets"]))
        except Exception:
            logger.warning("[Extensions] failed to decrypt secrets for install id=%s", row.get("id"))
            row["secrets"] = {}
    else:
        row["secrets"] = {}
    return row


def get_install(org_id: Optional[str], extension_id: str) -> Optional[Dict]:
    """Full row INCLUDING decrypted secrets — server-side use only (e.g.
    building the config dict passed into an extension's run()). Never return
    this directly from an API response."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT * FROM extension_installs WHERE COALESCE(org_id, '') = COALESCE(%s, '') AND extension_id = %s",
            (org_id, extension_id),
        )
        row = cur.fetchone()
        return _decrypt_row(row) if row else None
    finally:
        conn.rollback()
        _release_connection(conn)


def list_installs(org_id: Optional[str]) -> List[Dict]:
    """Status view for the admin UI — deliberately excludes secrets."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT id, org_id, extension_id, external_id, config, status, "
            "       last_run_at, last_run_result, installed_at, updated_at "
            "FROM extension_installs WHERE COALESCE(org_id, '') = COALESCE(%s, '')",
            (org_id,),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.rollback()
        _release_connection(conn)


def record_run(org_id: Optional[str], extension_id: str, result: Dict) -> None:
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE extension_installs SET last_run_at = NOW(), last_run_result = %s, updated_at = NOW() "
            "WHERE COALESCE(org_id, '') = COALESCE(%s, '') AND extension_id = %s",
            (json.dumps(result), org_id, extension_id),
        )
        conn.commit()
    finally:
        _release_connection(conn)


def remove_install(org_id: Optional[str], extension_id: str) -> bool:
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM extension_installs WHERE COALESCE(org_id, '') = COALESCE(%s, '') AND extension_id = %s",
            (org_id, extension_id),
        )
        ok = cur.rowcount > 0
        conn.commit()
        return ok
    finally:
        _release_connection(conn)
