"""Per-org WhatsApp settings — thin JSON-shape wrapper over the generic
extension_installs table (common/db/_extensions.py), so this extension needs
no migration of its own (matching that module's stated purpose). Global Meta
app credentials (access token, app secret, phone_number_id — one per
deployment) are NOT here; those live in common/config_manager.get_whatsapp_config().

Shape stored in extension_installs.config for (org_id, 'whatsapp'):

    {
      "mode": "support_1to1" | "group_assistant" | "both",
      "proactivity_level": "silent" | "mention_only" | "light_proactive" | "full_proactive",
      "groups": {
        "<wa_group_id>": {
          "subject": "...",
          "participants": {
            "<wa_id>": {"identity": "<internal user id or None>", "display_name": "..."}
          }
        }
      }
    }

Kept deliberately as one small JSON blob rather than new tables — the group
plan's own participant cap (<=7 humans per group, group plan §1) means this
never grows large enough to need proper relational storage, and it lets the
whole WhatsApp integration ship with zero migrations, consistent with how
extension_installs was designed to be used.
"""
from typing import Dict, Optional

from common.db._extensions import get_install, upsert_install

_EXTENSION_ID = "whatsapp"

_DEFAULT_SETTINGS = {
    "mode": "support_1to1",
    "proactivity_level": None,  # None => fall back to config_manager's default_proactivity_level
    "groups": {},
}


def get_org_settings(org_id: Optional[str]) -> Dict:
    row = get_install(org_id, _EXTENSION_ID)
    if not row:
        return dict(_DEFAULT_SETTINGS)
    settings = dict(_DEFAULT_SETTINGS)
    settings.update(row.get("config") or {})
    return settings


def _save(org_id: Optional[str], settings: Dict) -> None:
    upsert_install(org_id, _EXTENSION_ID, settings)


def set_org_settings(org_id: Optional[str], mode: str = None, proactivity_level: str = None) -> Dict:
    settings = get_org_settings(org_id)
    if mode is not None:
        settings["mode"] = mode
    if proactivity_level is not None:
        settings["proactivity_level"] = proactivity_level
    _save(org_id, settings)
    return settings


def get_group(org_id: Optional[str], group_id: str) -> Optional[Dict]:
    return get_org_settings(org_id).get("groups", {}).get(group_id)


def upsert_group(org_id: Optional[str], group_id: str, subject: str = None) -> Dict:
    settings = get_org_settings(org_id)
    group = settings["groups"].setdefault(group_id, {"subject": subject or "", "participants": {}})
    if subject:
        group["subject"] = subject
    _save(org_id, settings)
    return group


def upsert_participant(
    org_id: Optional[str], group_id: str, wa_id: str,
    display_name: str = None, identity: str = None,
) -> Dict:
    """Register/update a known group participant. `identity` is the internal
    user id an admin maps this phone number to (group plan FR6) — left None
    until that mapping step happens; the phone number itself is used as the
    fallback identity in the meantime (extensions/whatsapp/identity.py)."""
    settings = get_org_settings(org_id)
    group = settings["groups"].setdefault(group_id, {"subject": "", "participants": {}})
    participant = group["participants"].setdefault(wa_id, {"identity": None, "display_name": ""})
    if display_name:
        participant["display_name"] = display_name
    if identity:
        participant["identity"] = identity
    _save(org_id, settings)
    return participant


def resolve_proactivity_level(org_id: Optional[str]) -> str:
    from common.config_manager import get_whatsapp_config

    settings = get_org_settings(org_id)
    return settings.get("proactivity_level") or get_whatsapp_config()["default_proactivity_level"]
