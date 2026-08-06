"""common.db._shopify — per-tenant Shopify store connection (OAuth token storage).

One connected store per tenant org (MVP assumption — see
docs/SHOPIFY_INTEGRATION_PLAN.md). access_token and refresh_token are
encrypted at rest via common.crypto; callers of
get_connection()/get_connection_by_shop_domain() receive them decrypted,
connection_status() (used by the admin UI) never returns either.

Shopify now REQUIRES the "expiring offline token" flow (non-expiring tokens
are rejected outright as of this app's creation) — access tokens last only
~1 hour, so every stored connection carries a refresh_token and an
access_token_expires_at that shopify_service.py checks before each call,
refreshing proactively when needed.
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
    org_id: str, shop_domain: str, access_token: str, refresh_token: str,
    expires_in: int, refresh_token_expires_in: int, scopes: str,
) -> None:
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO shopify_connections
                   (org_id, shop_domain, access_token, refresh_token,
                    access_token_expires_at, refresh_token_expires_at,
                    scopes, status, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, 'connected', NOW())
               ON CONFLICT (org_id) DO UPDATE SET
                   shop_domain              = EXCLUDED.shop_domain,
                   access_token             = EXCLUDED.access_token,
                   refresh_token            = EXCLUDED.refresh_token,
                   access_token_expires_at  = EXCLUDED.access_token_expires_at,
                   refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
                   scopes                   = EXCLUDED.scopes,
                   status                   = 'connected',
                   uninstalled_at           = NULL,
                   updated_at               = NOW()""",
            (org_id, shop_domain, encrypt_secret(access_token), encrypt_secret(refresh_token),
             _expiry(expires_in), _expiry(refresh_token_expires_in), scopes),
        )
        conn.commit()
    finally:
        _release_connection(conn)


def update_tokens(
    org_id: str, access_token: str, refresh_token: str,
    expires_in: int, refresh_token_expires_in: int,
) -> None:
    """Rotate the stored tokens after a refresh — Shopify invalidates the old
    access_token AND refresh_token on every refresh call, so both must be
    overwritten together or the connection is left unrecoverable."""
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """UPDATE shopify_connections SET
                   access_token             = %s,
                   refresh_token            = %s,
                   access_token_expires_at  = %s,
                   refresh_token_expires_at = %s,
                   updated_at               = NOW()
               WHERE org_id = %s""",
            (encrypt_secret(access_token), encrypt_secret(refresh_token),
             _expiry(expires_in), _expiry(refresh_token_expires_in), org_id),
        )
        conn.commit()
    finally:
        _release_connection(conn)


def _decrypt_row(row: Dict) -> Dict:
    row = dict(row)
    row["access_token"] = decrypt_secret(row["access_token"])
    row["refresh_token"] = decrypt_secret(row["refresh_token"]) if row.get("refresh_token") else None
    return row


def get_connection(org_id: str) -> Optional[Dict]:
    """Active connection for this tenant, with DECRYPTED tokens — for
    server-side calls to the Shopify API only. Never expose this dict to a
    client response; use connection_status() for that."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT org_id, shop_domain, access_token, refresh_token, "
            "       access_token_expires_at, refresh_token_expires_at, "
            "       scopes, status, installed_at, updated_at "
            "FROM shopify_connections WHERE org_id = %s AND status = 'connected'",
            (org_id,),
        )
        row = cur.fetchone()
        return _decrypt_row(row) if row else None
    finally:
        conn.rollback()
        _release_connection(conn)


def get_connection_by_shop_domain(shop_domain: str) -> Optional[Dict]:
    """Reverse lookup used by the webhook receiver — Shopify webhooks carry the
    shop domain (X-Shopify-Shop-Domain header), not our org_id."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT org_id, shop_domain, access_token, refresh_token, "
            "       access_token_expires_at, refresh_token_expires_at, scopes, status "
            "FROM shopify_connections WHERE shop_domain = %s",
            (shop_domain,),
        )
        row = cur.fetchone()
        return _decrypt_row(row) if row else None
    finally:
        conn.rollback()
        _release_connection(conn)


def connection_status(org_id: str) -> Optional[Dict]:
    """Status view for the admin UI — deliberately excludes access_token."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT org_id, shop_domain, scopes, status, installed_at, uninstalled_at, updated_at "
            "FROM shopify_connections WHERE org_id = %s",
            (org_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        conn.rollback()
        _release_connection(conn)


def disconnect(org_id: str) -> bool:
    """Soft delete — keeps the row (audit trail, and so a GDPR shop/redact
    webhook arriving afterward can still resolve org_id once before purge())."""
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE shopify_connections SET status = 'disconnected', uninstalled_at = NOW(), updated_at = NOW() "
            "WHERE org_id = %s AND status = 'connected'",
            (org_id,),
        )
        ok = cur.rowcount > 0
        conn.commit()
        return ok
    finally:
        _release_connection(conn)


def purge(org_id: str) -> bool:
    """Hard delete — used by the shop/redact GDPR compliance webhook handler."""
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM shopify_connections WHERE org_id = %s", (org_id,))
        ok = cur.rowcount > 0
        conn.commit()
        return ok
    finally:
        _release_connection(conn)


def log_write_action(
    org_id: str, action: str, order_gid: Optional[str], order_name: Optional[str],
    actor_iam_sub: Optional[str], actor_email: Optional[str],
    detail: Optional[Dict], success: bool, error_message: Optional[str] = None,
) -> None:
    """Dedicated audit record for a Shopify write action (refund/cancel/
    shipping_update) — who/what/when/outcome, queryable directly rather than
    parsed out of chat transcripts. Called for both success and failure so a
    denied/failed attempt is on the record too, not just completed ones.

    Best-effort: a logging failure must never break the caller's actual
    refund/cancel/update, so this swallows its own errors rather than
    propagating them.
    """
    import json
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO shopify_write_audit
                   (org_id, action, order_gid, order_name, actor_iam_sub,
                    actor_email, detail, success, error_message)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (org_id, action, order_gid, order_name, actor_iam_sub, actor_email,
             json.dumps(detail) if detail is not None else None, success, error_message),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        logger.warning("[Shopify] failed to write audit record for org %s action %s", org_id, action, exc_info=True)
    finally:
        _release_connection(conn)
