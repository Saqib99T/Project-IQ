"""common.db._amazon — per-tenant Amazon SP-API seller connection (OAuth token storage).

One connected seller per tenant org (MVP assumption, mirrors
common/db/_shopify.py). access_token and refresh_token are encrypted at rest
via common.crypto; callers of get_connection() receive them decrypted,
connection_status() (used by the admin UI) never returns either.

Unlike Shopify, Amazon's LWA refresh_token does not expire on its own (only
on explicit seller revocation) — so there's no refresh_token_expires_at to
track, just access_token_expires_at (~1 hour) for the proactive-refresh check
in extensions/amazon/service.py.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional
from psycopg2.extras import RealDictCursor
from common.db._connection import _get_connection, _release_connection
from common.crypto import encrypt_secret, decrypt_secret

logger = logging.getLogger(__name__)


def _expiry(seconds: Optional[int]) -> Optional[datetime]:
    return datetime.now(timezone.utc) + timedelta(seconds=seconds) if seconds else None


def upsert_connection(
    org_id: str, seller_id: Optional[str], marketplace_ids: str,
    access_token: str, refresh_token: str, expires_in: Optional[int],
) -> None:
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO amazon_connections
                   (org_id, seller_id, marketplace_ids, access_token, refresh_token,
                    access_token_expires_at, status, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, 'connected', NOW())
               ON CONFLICT (org_id) DO UPDATE SET
                   seller_id                = COALESCE(EXCLUDED.seller_id, amazon_connections.seller_id),
                   marketplace_ids          = EXCLUDED.marketplace_ids,
                   access_token             = EXCLUDED.access_token,
                   refresh_token            = EXCLUDED.refresh_token,
                   access_token_expires_at  = EXCLUDED.access_token_expires_at,
                   status                   = 'connected',
                   uninstalled_at           = NULL,
                   updated_at               = NOW()""",
            (org_id, seller_id, marketplace_ids, encrypt_secret(access_token),
             encrypt_secret(refresh_token), _expiry(expires_in)),
        )
        conn.commit()
    finally:
        _release_connection(conn)


def update_access_token(org_id: str, access_token: str, expires_in: Optional[int]) -> None:
    """Refresh only the access_token — Amazon's refresh_token stays valid
    across refreshes (unlike Shopify's, which rotates both together)."""
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE amazon_connections SET
                   access_token            = %s,
                   access_token_expires_at = %s,
                   updated_at              = NOW()
               WHERE org_id = %s""",
            (encrypt_secret(access_token), _expiry(expires_in), org_id),
        )
        conn.commit()
    finally:
        _release_connection(conn)


def _decrypt_row(row: Dict) -> Dict:
    row = dict(row)
    row["access_token"] = decrypt_secret(row["access_token"])
    row["refresh_token"] = decrypt_secret(row["refresh_token"])
    return row


def get_connection(org_id: str) -> Optional[Dict]:
    """Active connection for this tenant, with DECRYPTED tokens — for
    server-side calls to the SP-API only. Never expose this dict to a client
    response; use connection_status() for that."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT org_id, seller_id, marketplace_ids, access_token, refresh_token, "
            "       access_token_expires_at, status, installed_at, updated_at "
            "FROM amazon_connections WHERE org_id = %s AND status = 'connected'",
            (org_id,),
        )
        row = cur.fetchone()
        return _decrypt_row(row) if row else None
    finally:
        conn.rollback()
        _release_connection(conn)


def connection_status(org_id: str) -> Optional[Dict]:
    """Status view for the admin UI — deliberately excludes both tokens."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT org_id, seller_id, marketplace_ids, status, installed_at, uninstalled_at, updated_at "
            "FROM amazon_connections WHERE org_id = %s",
            (org_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.rollback()
        _release_connection(conn)


def disconnect(org_id: str) -> bool:
    """Soft delete — keeps the row (audit trail)."""
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE amazon_connections SET status = 'disconnected', uninstalled_at = NOW(), updated_at = NOW() "
            "WHERE org_id = %s AND status = 'connected'",
            (org_id,),
        )
        ok = cur.rowcount > 0
        conn.commit()
        return ok
    finally:
        _release_connection(conn)
