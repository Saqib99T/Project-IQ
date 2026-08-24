"""Sender-identity construction for WhatsApp-originated conversations.

Follows the reusable "guest channel-session identity" shape the June 2026
inbound-channels decision record called for (`ch-{channel}-{externalid}-{tenant}`)
rather than inventing a new one — see docs/plans/WHATSAPP_INTEGRATION_PLAN.md
§2.2. Two shapes:

- 1:1: one conversation per WhatsApp user, keyed off their wa_id (phone
  number, E.164 without '+'). No IAM identity exists for them — this is a
  guest session, same tier an unauthenticated widget visitor already gets.
- Group: one SHARED conversation per WhatsApp group, keyed off the group id.
  Every human in the group logs into the same conversation record (tagged
  per-message with the sending participant — see bridge.py), because the
  bot's context is the whole group's conversation, not any one person's.
"""
from typing import Optional

from extensions.whatsapp.store import get_group, upsert_participant


def individual_sender_id(wa_id: str, org_id: str) -> str:
    return f"ch-whatsapp-{wa_id}-{org_id}"


def group_sender_id(group_id: str, org_id: str) -> str:
    return f"ch-whatsapp-group-{group_id}-{org_id}"


def resolve_participant_identity(
    org_id: Optional[str], group_id: str, wa_id: str, display_name: str = None,
) -> str:
    """The identity attributed to one message inside a group conversation.

    Group membership is small and admin-curated by construction (Meta's own
    <=7-human cap + invite/approve flow — group plan §1), so unlike the 1:1
    customer-facing identity problem, mapping phone -> a real internal
    identity is expected to be a one-time admin step per participant (group
    plan FR6), not something this code solves generally. Until that mapping
    exists for a given participant, fall back to a readable
    "wa:<number>[:<name>]" tag so transcripts stay attributable rather than
    opaque, and register the sighting so the admin UI has something to map
    against later.
    """
    existing = (get_group(org_id, group_id) or {}).get("participants", {}).get(wa_id)
    if existing and existing.get("identity"):
        return existing["identity"]

    upsert_participant(org_id, group_id, wa_id, display_name=display_name)
    return f"wa:{wa_id}:{display_name}" if display_name else f"wa:{wa_id}"
