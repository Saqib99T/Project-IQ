"""common.db._shopify — per-tenant Shopify store connection (OAuth token storage).

One connected store per tenant org (MVP assumption — see
docs/SHOPIFY_INTEGRATION_PLAN.md). access_token is encrypted at rest via
common.crypto; callers of get_connection()/get_connection_by_shop_domain()
receive it decrypted, connection_status() (used by the admin UI) never
returns it at all.
"""
from typing import Dict, Optional
from psycopg2.extras import RealDictCursor
from common.db._connection import _get_connection, _release_connection
from common.crypto import encrypt_secret, decrypt_secret


def upsert_connection(org_id: str, shop_domain: str, access_token: str, scopes: str) -> None:
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO shopify_connections (org_id, shop_domain, access_token, scopes, status, updated_at)
               VALUES (%s, %s, %s, %s, 'connected', NOW())
               ON CONFLICT (org_id) DO UPDATE SET
                   shop_domain    = EXCLUDED.shop_domain,
                   access_token   = EXCLUDED.access_token,
                   scopes         = EXCLUDED.scopes,
                   status         = 'connected',
                   uninstalled_at = NULL,
                   updated_at     = NOW()""",
            (org_id, shop_domain, encrypt_secret(access_token), scopes),
        )
        conn.commit()
    finally:
        _release_connection(conn)


def get_connection(org_id: str) -> Optional[Dict]:
    """Active connection for this tenant, with a DECRYPTED access_token — for
    server-side calls to the Shopify API only. Never expose this dict to a
    client response; use connection_status() for that."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT org_id, shop_domain, access_token, scopes, status, installed_at, updated_at "
            "FROM shopify_connections WHERE org_id = %s AND status = 'connected'",
            (org_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        row = dict(row)
        row["access_token"] = decrypt_secret(row["access_token"])
        return row
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
            "SELECT org_id, shop_domain, access_token, scopes, status "
            "FROM shopify_connections WHERE shop_domain = %s",
            (shop_domain,),
        )
        row = cur.fetchone()
        if not row:
            return None
        row = dict(row)
        row["access_token"] = decrypt_secret(row["access_token"])
        return row
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
