"""WhatsApp Cloud API client — sync (`requests`), not the aiohttp pattern
Shopify/Amazon's service.py use, because the call site is different: those
are invoked with `await` from action_server (already an async context via
Rasa's SDK), while every WhatsApp send is triggered synchronously from inside
this extension's own Flask webhook route (routes.py) — matching
extensions/shopify/routes.py's own webhook handler, which is plain sync Flask
too. Spinning up an event loop inside that route for send calls would add
complexity with no benefit here.

*** UNVALIDATED as of this build — no live Meta Business/WABA account exists
(docs/plans/WHATSAPP_INTEGRATION_PLAN.md §8 Phase 0). Every method below is
written against Meta's published Cloud API / Groups API docs (see both plan
docs' §10/Sources) but has not been exercised against a real endpoint. Do not
flip common/app.config's whatsapp_enabled to true — or trust a non-error
return from any of these — without first confirming request/response shapes
in the Phase 0 sandbox spike. Mirrors the caution already applied to
extensions/amazon/notifications.py's SQS scaffolding. ***

Never log access_token/app_secret values.
"""
import logging
from typing import Any, Dict, List, Optional

import requests

from common.config_manager import get_whatsapp_config
from web.api.rate_limiting import MemoryStore, _parse_limit

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT = 15


class WhatsAppService:
    """One instance serves every tenant — the business number/token are
    deployment-global (get_whatsapp_config()), not per-org, for this first
    build (see that function's docstring for why)."""

    def __init__(self):
        self._send_limiter = MemoryStore()

    def _base_url(self) -> str:
        cfg = get_whatsapp_config()
        return f"https://graph.facebook.com/{cfg['graph_api_version']}"

    def _headers(self) -> Dict[str, str]:
        cfg = get_whatsapp_config()
        return {
            "Authorization": f"Bearer {cfg['access_token']}",
            "Content-Type": "application/json",
        }

    def _check_send_rate_limit(self, key: str) -> bool:
        """Every send is billed per-message (group plan §4) — cap the blast
        radius of a bug in the decision engine or a retry storm the same way
        Shopify caps write actions."""
        max_n, window = _parse_limit(get_whatsapp_config()["send_rate_limit"])
        allowed, retry_after = self._send_limiter.hit(f"whatsapp_send:{key}", max_n, window)
        if not allowed:
            logger.warning("[WhatsApp] send rate limit hit for %s (retry in %ss)", key, retry_after)
        return allowed

    def _post(self, path: str, json_body: Dict[str, Any]) -> Optional[dict]:
        cfg = get_whatsapp_config()
        if not cfg["enabled"] or not cfg["access_token"]:
            logger.warning("[WhatsApp] send attempted while whatsapp_enabled=false — dropped")
            return None
        url = f"{self._base_url()}/{path}"
        try:
            resp = requests.post(url, headers=self._headers(), json=json_body, timeout=_REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            logger.error("[WhatsApp] POST %s failed: %r", path, exc)
            return None
        if not (200 <= resp.status_code < 300):
            logger.warning("[WhatsApp] POST %s -> %d: %s", path, resp.status_code, resp.text[:300])
            return None
        return resp.json() if resp.content else {}

    def _delete(self, path: str) -> bool:
        cfg = get_whatsapp_config()
        if not cfg["enabled"] or not cfg["access_token"]:
            return False
        url = f"{self._base_url()}/{path}"
        try:
            resp = requests.delete(url, headers=self._headers(), timeout=_REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            logger.error("[WhatsApp] DELETE %s failed: %r", path, exc)
            return False
        return 200 <= resp.status_code < 300

    def check_connectivity(self) -> tuple:
        """Cheap GET against the configured phone number, for extension.py's
        test(). Returns (ok, detail)."""
        cfg = get_whatsapp_config()
        url = f"{self._base_url()}/{cfg['phone_number_id']}"
        try:
            resp = requests.get(url, headers=self._headers(), timeout=_REQUEST_TIMEOUT)
        except requests.RequestException as exc:
            return False, {"error": str(exc)}
        if resp.status_code == 200:
            return True, {"phone_number_id": cfg["phone_number_id"]}
        return False, {"error": f"HTTP {resp.status_code}: {resp.text[:200]}"}

    # ------------------------------------------------------------------
    # Sending
    # ------------------------------------------------------------------

    def send_text(self, to: str, body: str, recipient_type: str = "individual") -> bool:
        """Send a free-form text message. `to` is a wa_id for
        recipient_type='individual' or a group id for 'group'
        (docs/plans/WHATSAPP_GROUP_ASSISTANT_PLAN.md §1 — same
        `POST /messages` endpoint, `recipient_type` is what switches it).

        Does NOT implement the 24-hour-window / template-message branch yet
        (docs/plans/WHATSAPP_INTEGRATION_PLAN.md §2.3, Phase 2 there) — every
        call here assumes a free-form reply is currently allowed. Wire the
        within/outside-window check in before this carries real traffic.
        """
        if not self._check_send_rate_limit(to):
            return False
        cfg = get_whatsapp_config()
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": recipient_type,
            "to": to,
            "type": "text",
            "text": {"body": body},
        }
        result = self._post(f"{cfg['phone_number_id']}/messages", payload)
        return result is not None

    # ------------------------------------------------------------------
    # Group management (docs/plans/WHATSAPP_GROUP_ASSISTANT_PLAN.md §1/§5) —
    # no bulk-add exists on Meta's side; this mirrors that one-at-a-time
    # shape rather than pretending otherwise.
    # ------------------------------------------------------------------

    def create_group(self, subject: str) -> Optional[str]:
        cfg = get_whatsapp_config()
        if not cfg["groups_enabled"]:
            logger.warning("[WhatsApp] create_group called while groups_enabled=false (requires an approved OBA)")
            return None
        result = self._post(f"{cfg['phone_number_id']}/groups", {"subject": subject})
        return (result or {}).get("id")

    def generate_invite_link(self, group_id: str) -> Optional[str]:
        cfg = get_whatsapp_config()
        result = self._post(f"{group_id}/invite_link", {})
        return (result or {}).get("invite_link")

    def list_join_requests(self, group_id: str) -> List[dict]:
        """NOT IMPLEMENTED — Meta's docs describe approving a join request
        (`POST /<GROUP_ID>/join_requests`) but the group plan's research
        (§2.1) never turned up a confirmed GET/list shape for pending
        requests. Confirm the read side against a real sandbox group in
        Phase 0b before implementing this; returns empty until then rather
        than guessing at an endpoint shape."""
        logger.warning("[WhatsApp] list_join_requests(%s) called — no confirmed API for this yet, see docstring", group_id)
        return []

    def approve_join_request(self, group_id: str, wa_id: str) -> bool:
        result = self._post(f"{group_id}/join_requests", {"wa_id": wa_id, "action": "approve"})
        return result is not None

    def remove_participant(self, group_id: str, wa_id: str) -> bool:
        return self._delete(f"{group_id}/participants?wa_id={wa_id}")


# Module-level singleton — mirrors shopify_service/amazon_service.
whatsapp_service = WhatsAppService()
