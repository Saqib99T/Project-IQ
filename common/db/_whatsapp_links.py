"""common.db._whatsapp_links — WhatsApp number -> IAM account linking.

Proves which account owns a given WhatsApp number via an OTP the linking
user (already authenticated in the portal) receives on that number and
types back into the portal — see web/api/blueprints/bp_whatsapp_link.py.
Deliberately NOT a source of itsm-service API access on its own; see
docs/plans/WHATSAPP_INTEGRATION_PLAN.md's 2026-08-27 note for why (this is a
multi-tenant deployment with no safe per-org service-account token to
forward yet). This only establishes identity for Project IQ's own
attribution/personalization — extensions/whatsapp/bridge.py uses a confirmed
link to log the real iam_sub/name against a WhatsApp conversation and to
personalize replies, nothing more.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from psycopg2.extras import RealDictCursor

from common.db._connection import _get_connection, _release_connection

logger = logging.getLogger(__name__)

# How long a verification code stays valid — generous enough for someone to
# switch from the portal tab to WhatsApp and back, tight enough that a code
# sitting unused isn't a long-lived guessable secret.
_CODE_TTL_MINUTES = 10


def initiate_link(org_id: str, iam_sub: str, wa_id: str, code: str, display_name: str = None) -> bool:
    """Start (or restart) linking `wa_id` to `iam_sub`. Refuses if `wa_id` is
    already CONFIRMED-linked to a *different* account — re-linking your own
    number, or claiming a still-pending/unclaimed one, is fine; silently
    stealing someone else's confirmed number is not. Returns False on that
    refusal, True otherwise (row upserted, status reset to 'pending')."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute("SELECT iam_sub, status FROM whatsapp_links WHERE wa_id = %s", (wa_id,))
        existing = cur.fetchone()
        if existing and existing["status"] == "confirmed" and existing["iam_sub"] != iam_sub:
            logger.warning(
                "[WhatsApp Link] org %s / iam_sub %s tried to link wa_id %s, already confirmed to a different account",
                org_id, iam_sub, wa_id,
            )
            return False

        expires_at = datetime.now(timezone.utc) + timedelta(minutes=_CODE_TTL_MINUTES)
        cur.execute(
            """INSERT INTO whatsapp_links
                   (wa_id, org_id, iam_sub, display_name, status, verification_code, code_expires_at, updated_at)
               VALUES (%s, %s, %s, %s, 'pending', %s, %s, NOW())
               ON CONFLICT (wa_id) DO UPDATE SET
                   org_id             = EXCLUDED.org_id,
                   iam_sub            = EXCLUDED.iam_sub,
                   display_name       = COALESCE(EXCLUDED.display_name, whatsapp_links.display_name),
                   status             = 'pending',
                   verification_code  = EXCLUDED.verification_code,
                   code_expires_at    = EXCLUDED.code_expires_at,
                   confirmed_at       = NULL,
                   updated_at         = NOW()""",
            (wa_id, org_id, iam_sub, display_name, code, expires_at),
        )
        conn.commit()
        return True
    finally:
        _release_connection(conn)


def confirm_link(iam_sub: str, wa_id: str, code: str) -> bool:
    """Complete a pending link if `code` matches and hasn't expired, and the
    row actually belongs to `iam_sub` (guards against confirming a link
    someone else initiated for this number in the meantime)."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT iam_sub, verification_code, code_expires_at FROM whatsapp_links "
            "WHERE wa_id = %s AND status = 'pending'",
            (wa_id,),
        )
        row = cur.fetchone()
        if not row or row["iam_sub"] != iam_sub:
            return False
        if not row["verification_code"] or row["verification_code"] != code:
            return False
        expires_at = row["code_expires_at"]
        if expires_at and expires_at < datetime.now(timezone.utc):
            return False

        cur.execute(
            """UPDATE whatsapp_links
               SET status = 'confirmed', confirmed_at = NOW(),
                   verification_code = NULL, code_expires_at = NULL, updated_at = NOW()
               WHERE wa_id = %s""",
            (wa_id,),
        )
        conn.commit()
        return True
    finally:
        _release_connection(conn)


def get_confirmed_link(wa_id: str) -> Optional[Dict]:
    """The one lookup extensions/whatsapp/bridge.py needs on every inbound
    message. Returns None for no link, a pending (unconfirmed) link, or any
    DB error — bridge.py treats all three as "guest", never raises."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT wa_id, org_id, iam_sub, display_name, confirmed_at FROM whatsapp_links "
            "WHERE wa_id = %s AND status = 'confirmed'",
            (wa_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    except Exception as e:
        logger.warning("[WhatsApp Link] get_confirmed_link(%s) failed: %s", wa_id, e)
        return None
    finally:
        _release_connection(conn)


def get_link_status_for_user(iam_sub: str) -> Optional[Dict]:
    """For the portal's My Profile panel — this user's own current link (any
    status), so the UI can show 'linked to +92...' vs 'pending, enter code'
    vs no link at all."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "SELECT wa_id, status, confirmed_at FROM whatsapp_links "
            "WHERE iam_sub = %s ORDER BY updated_at DESC LIMIT 1",
            (iam_sub,),
        )
        row = cur.fetchone()
        return dict(row) if row else None
    finally:
        _release_connection(conn)


def unlink(iam_sub: str) -> bool:
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM whatsapp_links WHERE iam_sub = %s", (iam_sub,))
        ok = cur.rowcount > 0
        conn.commit()
        return ok
    finally:
        _release_connection(conn)
