"""common.db._canned — operator canned responses / macros (saved replies).

A $0 co-pilot feature (no LLM): agents save reusable replies and insert them in
the handoff console. Org-scoped (org_id NULL = shared across tenants).
"""
from typing import Dict, List, Optional
from psycopg2.extras import RealDictCursor
from common.db._connection import _get_connection, _release_connection

_MAX_TITLE = 120
_MAX_BODY = 4000


def clean_canned_input(data: Dict) -> Dict:
    """Validate + normalize a create/update payload. Pure; raises ValueError."""
    title = (data.get("title") or "").strip()
    body = (data.get("body") or "").strip()
    if not title or not body:
        raise ValueError("title and body are required")
    if len(title) > _MAX_TITLE:
        raise ValueError(f"title exceeds {_MAX_TITLE} chars")
    if len(body) > _MAX_BODY:
        raise ValueError(f"body exceeds {_MAX_BODY} chars")
    shortcut = (data.get("shortcut") or "").strip().lstrip("/")[:40] or None
    app_id = (data.get("app_id") or "").strip() or None
    return {"title": title, "body": body, "shortcut": shortcut, "app_id": app_id}


def list_canned_responses(org_id: Optional[str] = None, app_id: Optional[str] = None) -> List[Dict]:
    """Shared (org_id IS NULL) + the caller-org's responses, optionally product-filtered."""
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        where = ["(org_id IS NULL OR org_id = %s)"]
        params: List = [org_id]
        if app_id and app_id != "all":
            where.append("(app_id IS NULL OR app_id = %s)")
            params.append(app_id)
        cur.execute(
            "SELECT id, org_id, app_id, title, body, shortcut, created_by, created_at, updated_at "
            f"FROM canned_responses WHERE {' AND '.join(where)} ORDER BY title",
            tuple(params),
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.rollback()
        _release_connection(conn)


def create_canned_response(org_id: Optional[str], data: Dict, created_by: str = None) -> Dict:
    c = clean_canned_input(data)
    conn = _get_connection()
    try:
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(
            "INSERT INTO canned_responses (org_id, app_id, title, body, shortcut, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (org_id, c["app_id"], c["title"], c["body"], c["shortcut"], created_by),
        )
        new_id = cur.fetchone()["id"]
        conn.commit()
        return {"id": new_id, "org_id": org_id, "created_by": created_by, **c}
    finally:
        _release_connection(conn)


# Scope writes to the caller's org; shared (NULL) rows only when caller org is
# also NULL (platform) — so one tenant can't edit/delete another's macros.
_SCOPE = "(org_id = %s OR (org_id IS NULL AND %s IS NULL))"


def update_canned_response(resp_id: int, org_id: Optional[str], data: Dict) -> bool:
    c = clean_canned_input(data)
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE canned_responses SET title=%s, body=%s, shortcut=%s, app_id=%s, updated_at=NOW() "
            f"WHERE id=%s AND {_SCOPE}",
            (c["title"], c["body"], c["shortcut"], c["app_id"], resp_id, org_id, org_id),
        )
        ok = cur.rowcount > 0
        conn.commit()
        return ok
    finally:
        _release_connection(conn)


def delete_canned_response(resp_id: int, org_id: Optional[str]) -> bool:
    conn = _get_connection()
    try:
        cur = conn.cursor()
        cur.execute(f"DELETE FROM canned_responses WHERE id=%s AND {_SCOPE}", (resp_id, org_id, org_id))
        ok = cur.rowcount > 0
        conn.commit()
        return ok
    finally:
        _release_connection(conn)
