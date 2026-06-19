"""
ITSM Service HTTP client — replaces ItsmService for ticket operations.

All calls require a JWT Bearer token (Keycloak RS256) forwarded from
the user's session metadata.  Never log the token value.
"""
import logging
import socket
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

# Human-readable display names for itsm status values
ITSM_STATUS_DISPLAY = {
    "open":             "Open",
    "in_progress":      "In Progress",
    "pending":          "Pending",
    "pending_approval": "Pending Approval",
    "approved":         "Approved",
    "rejected":         "Rejected",
    "resolved":         "Resolved",
    "closed":           "Closed",
    "cancelled":        "Cancelled",
}

# Map legacy ITSM status labels → itsm status values
LABEL_TO_ITSM_STATUS = {
    "New":                   "open",
    "Processing (Assigned)": "in_progress",
    "Processing (Planned)":  "in_progress",
    "Pending":               "pending",
    "Solved":                "resolved",
    "Closed":                "closed",
    "Approved":              "approved",
}

# Active (non-terminal) statuses for "open tickets" queries
ACTIVE_STATUSES = ["open", "in_progress", "pending"]

# ITSM urgency integer → itsm priority string
URGENCY_TO_PRIORITY = {
    1: "low",
    2: "low",
    3: "medium",
    4: "high",
    5: "high",
}


class ITSMService:
    """Async HTTP client for the itsm-service REST API."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        """Reuse one keep-alive session (forced IPv4) across calls, so each
        request skips TCP setup instead of dialing a fresh connection — the
        main cost when talking to the Docker-published API on Windows."""
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(
                family=socket.AF_INET,      # avoid slow IPv6 (::1) attempts to Docker ports
                limit=20,
                ttl_dns_cache=300,
                keepalive_timeout=30,
            )
            self._session = aiohttp.ClientSession(connector=connector)
        return self._session

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _headers(self, token: str, tenant_id=None) -> dict:
        h = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        # Explicit tenant context — required by itsm-service for writes when the
        # caller's token doesn't resolve a single tenant (e.g. a platform admin).
        if tenant_id:
            h["X-Tenant-ID"] = str(tenant_id)
        # Forward the correlation id (bound from the tracker upstream) so the
        # itsm-service request can be tied back to the originating chat turn.
        from common.request_context import REQUEST_ID_HEADER, get_request_id
        rid = get_request_id()
        if rid and rid != "-":
            h[REQUEST_ID_HEADER] = rid
        return h

    async def _request(
        self,
        method: str,
        path: str,
        token: str,
        json_body: dict = None,
        params=None,
        tenant_id=None,
    ) -> Optional[dict]:
        """Generic HTTP request.  Returns parsed JSON or None on error / 404."""
        url = f"{self.base_url}{path}"
        try:
            session = await self._get_session()
            timeout = aiohttp.ClientTimeout(total=15)
            kwargs = {"headers": self._headers(token, tenant_id), "timeout": timeout}
            if json_body is not None:
                kwargs["json"] = json_body
            if params is not None:
                kwargs["params"] = params
            async with session.request(method, url, **kwargs) as resp:
                if resp.status in (200, 201):
                    return await resp.json()
                if resp.status == 204:
                    return {"ok": True}
                if resp.status == 404:
                    return None
                text = await resp.text()
                logger.warning("[ITSM] %s %s → %d: %s", method, path, resp.status, text[:200])
                return None
        except Exception as exc:
            logger.error("[ITSM] %s %s failed: %r", method, path, exc, exc_info=True)
            return None

    async def _get_list(self, token: str, path: str, params=None) -> list:
        """GET a collection endpoint; returns items list (empty on error)."""
        result = await self._request("GET", path, token, params=params)
        if result is None:
            return []
        if isinstance(result, list):
            return result
        return result.get("items", [])

    # ------------------------------------------------------------------
    # Ticket CRUD
    # ------------------------------------------------------------------

    async def create_ticket(
        self,
        token: str,
        title: str,
        description: str,
        priority: str = "medium",
        ticket_type: str = "incident",
        product_slug: Optional[str] = None,
        product_name: Optional[str] = None,
    ) -> Optional[dict]:
        """Create a ticket.  Returns the full ticket dict on success.

        When product_slug is given, itsm-service upserts a Product for the tenant
        and links the ticket to it. A null slug leaves the ticket productless.
        """
        body = {
            "title": title,
            "description": description,
            "type": ticket_type,
            "priority": priority,
        }
        if product_slug:
            body["product_slug"] = product_slug
            if product_name:
                body["product_name"] = product_name
        return await self._request("POST", "/api/v1/tickets", token, json_body=body)

    async def get_ticket_by_uuid(self, token: str, ticket_uuid: str) -> Optional[dict]:
        """Fetch ticket by UUID."""
        return await self._request("GET", f"/api/v1/tickets/{ticket_uuid}", token)

    @staticmethod
    def _num_key(ref: str) -> str:
        """Reduce a ticket ref to its numeric core for forgiving matches:
        '3', '00003', '#3', 'INC-00003' all normalise to '3'."""
        digits = "".join(c for c in (ref or "") if c.isdigit()).lstrip("0")
        return digits or "0"

    async def find_ticket_by_number(
        self, token: str, ticket_number: str, limit: int = 100
    ) -> Optional[dict]:
        """Scan recent tickets for one whose ticket_number matches.

        Matching is on the numeric value, so a user typing '3' matches '00003'.
        """
        params = [("limit", str(limit))]
        items = await self._get_list(token, "/api/v1/tickets", params=params)
        target = self._num_key(ticket_number)
        for t in items:
            if self._num_key(t.get("ticket_number", "")) == target:
                return t
        return None

    async def get_ticket(self, token: str, ticket_ref: str) -> Optional[dict]:
        """Get ticket by UUID or friendly ticket_number ('INC-001234')."""
        import uuid as _uuid
        try:
            _uuid.UUID(ticket_ref)
            return await self.get_ticket_by_uuid(token, ticket_ref)
        except (ValueError, AttributeError):
            return await self.find_ticket_by_number(token, ticket_ref)

    async def list_tickets(
        self,
        token: str,
        active_only: bool = True,
        limit: int = 50,
    ) -> list:
        """List tickets for the authenticated user.

        When active_only=True, returns open/in_progress/pending tickets.
        When active_only=False, returns all tickets (all statuses).
        """
        if active_only:
            params = (
                [("status", s) for s in ACTIVE_STATUSES]
                + [("limit", str(limit))]
            )
        else:
            params = [("limit", str(limit))]
        return await self._get_list(token, "/api/v1/tickets", params=params)

    async def list_tickets_by_status(
        self,
        token: str,
        statuses: list,
        limit: int = 50,
    ) -> list:
        """List tickets filtered to the given itsm status strings."""
        params = (
            [("status", s) for s in statuses]
            + [("limit", str(limit))]
        )
        return await self._get_list(token, "/api/v1/tickets", params=params)

    async def update_ticket(
        self, token: str, ticket_uuid: str, data: dict, tenant_id=None
    ) -> Optional[dict]:
        """PATCH ticket fields (status, priority, title, etc.)."""
        return await self._request(
            "PATCH", f"/api/v1/tickets/{ticket_uuid}", token, json_body=data, tenant_id=tenant_id
        )

    async def update_ticket_status(
        self, token: str, ticket_ref: str, status: str
    ) -> bool:
        """Set status on a ticket; resolves UUID if given a ticket_number."""
        ticket = await self.get_ticket(token, ticket_ref)
        if not ticket:
            return False
        # Pass the ticket's own tenant as X-Tenant-ID so the write carries tenant
        # context even when the caller's token doesn't resolve one (platform admin).
        result = await self.update_ticket(
            token, ticket["id"], {"status": status}, tenant_id=ticket.get("tenant_id")
        )
        return result is not None

    # ------------------------------------------------------------------
    # Comments
    # ------------------------------------------------------------------

    async def add_comment(
        self, token: str, ticket_ref: str, body: str, internal: bool = False
    ) -> bool:
        """Add a comment/followup to a ticket."""
        ticket = await self.get_ticket(token, ticket_ref)
        if not ticket:
            return False
        result = await self._request(
            "POST", f"/api/v1/tickets/{ticket['id']}/comments", token,
            json_body={"body": body, "is_internal": internal},
            tenant_id=ticket.get("tenant_id"),
        )
        return result is not None

    async def get_comments(self, token: str, ticket_ref: str) -> list:
        """Return list of comment dicts for the ticket."""
        ticket = await self.get_ticket(token, ticket_ref)
        if not ticket:
            return []
        return await self._get_list(
            token, f"/api/v1/tickets/{ticket['id']}/comments"
        )

    # ------------------------------------------------------------------
    # Attachments
    # ------------------------------------------------------------------

    async def get_attachments(self, token: str, ticket_ref: str) -> list:
        """Return list of attachment dicts for the ticket."""
        ticket = await self.get_ticket(token, ticket_ref)
        if not ticket:
            return []
        return await self._get_list(
            token, f"/api/v1/tickets/{ticket['id']}/attachments"
        )

    async def upload_attachment(
        self,
        token: str,
        ticket_uuid: str,
        file_bytes: bytes,
        filename: str,
        mime_type: str = "application/octet-stream",
    ) -> Optional[dict]:
        """Upload a file to a ticket via itsm-service's presigned-PUT flow.

        1. POST /tickets/{id}/attachments -> {attachment_id, upload_url, ...}
           (itsm records the attachment row immediately at this step).
        2. PUT the raw bytes to the presigned ``upload_url`` (direct to object
           storage). The presign signs ContentType + ContentLength, so the PUT
           MUST send a matching Content-Type and exactly ``file_size`` bytes.

        Returns the presign response dict on success, else None. Runs entirely
        server-side, so object storage need not be reachable from browsers.
        """
        file_size = len(file_bytes)
        presign = await self._request(
            "POST", f"/api/v1/tickets/{ticket_uuid}/attachments", token,
            json_body={
                "filename": filename,
                "mime_type": mime_type,
                "file_size": file_size,
            },
        )
        if not presign or not presign.get("upload_url"):
            logger.warning("[ITSM] attachment presign failed for ticket %s", ticket_uuid)
            return None

        try:
            session = await self._get_session()
            timeout = aiohttp.ClientTimeout(total=60)
            # Presigned PUT: send ONLY Content-Type (must match the signed value);
            # no Authorization header — the signature carries the auth.
            async with session.put(
                presign["upload_url"],
                data=file_bytes,
                headers={"Content-Type": mime_type},
                timeout=timeout,
            ) as resp:
                if resp.status in (200, 201, 204):
                    logger.info(
                        "[ITSM] attachment '%s' (%d bytes) uploaded to ticket %s",
                        filename, file_size, ticket_uuid,
                    )
                    return presign
                body = await resp.text()
                logger.warning("[ITSM] attachment PUT -> %d: %s", resp.status, body[:200])
                return None
        except Exception as exc:
            logger.error("[ITSM] attachment PUT failed: %r", exc, exc_info=True)
            return None

    # ------------------------------------------------------------------
    # Knowledge Base
    # ------------------------------------------------------------------

    async def search_kb(
        self,
        token: str,
        query: str,
        space: Optional[str] = None,
        product: Optional[str] = None,
        limit: int = 10,
    ) -> list:
        """Hybrid (semantic + FTS) KB search.

        Returns a list of {article, score, match_type} dicts. Requires auth.
        """
        params = [("q", query), ("limit", str(limit))]
        if space:
            params.append(("space", space))
        if product:
            params.append(("product", product))
        return await self._get_list(token, "/api/v1/kb/search", params=params)

    async def suggest_kb(
        self,
        token: str,
        query: str,
        product: Optional[str] = None,
        limit: int = 5,
    ) -> list:
        """Fast inline KB suggestions (vector similarity, FTS fallback)."""
        params = [("q", query), ("limit", str(limit))]
        if product:
            params.append(("product", product))
        return await self._get_list(token, "/api/v1/kb/suggest", params=params)

    async def get_kb_article(self, token: str, article_id: str) -> Optional[dict]:
        """Fetch a single KB article by UUID (also bumps its view count)."""
        return await self._request("GET", f"/api/v1/kb/articles/{article_id}", token)

    async def list_kb_space_articles(
        self,
        token: str,
        space_slug: str,
        product: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: int = 50,
    ) -> list:
        """List published articles in a KB space (cursor-paginated; returns 'items')."""
        params = [("limit", str(limit))]
        if product:
            params.append(("product", product))
        if cursor:
            params.append(("cursor", cursor))
        return await self._get_list(
            token, f"/api/v1/kb/spaces/{space_slug}/articles", params=params
        )

    async def list_kb_spaces(self, token: str) -> list:
        """List KB spaces visible to the caller's tenant."""
        return await self._get_list(token, "/api/v1/kb/spaces")
