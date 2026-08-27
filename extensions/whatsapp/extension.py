"""WhatsApp channel extension — one business number serving two distinct
conversational shapes:

1. 1:1 customer support (docs/plans/WHATSAPP_INTEGRATION_PLAN.md) — a
   customer messages the business number directly, gets the same KB/ticket
   bot the widget offers, as a guest.
2. Group assistant (docs/plans/WHATSAPP_GROUP_ASSISTANT_PLAN.md) — the
   business number sits inside a small (<=7-human) WhatsApp group via Meta's
   2026 Groups API, replies on @-mention, and may speak proactively subject
   to a tenant-configurable dial (extensions/whatsapp/decision.py).

kind=ExtensionKind.CHANNEL (not COMMERCE/DESTINATION — see extensions/base.py)
because this is bidirectional AND conversational: inbound message -> the same
action-server/NLU brain every other channel uses -> outbound reply. Nothing
here is a second AI system.

*** UNVALIDATED as of this build. There is no live Meta Business/WABA account
(docs/plans/WHATSAPP_INTEGRATION_PLAN.md §8 Phase 0, group plan §1.1) — every
network call in extensions/whatsapp/service.py is written against Meta's
published Cloud API docs but has not been exercised against a real endpoint.
whatsapp_enabled defaults to false (common/config_manager.get_whatsapp_config)
so nothing here runs in any live deployment until real credentials land and
Phase 0's sandbox spike (plan doc §8) confirms the wire shapes, especially the
group @-mention payload (group plan §2.1 — the single biggest unconfirmed
assumption this module makes). ***

Global app credentials (access token, app secret, verify token — one WABA per
deployment) live in common/config_manager.get_whatsapp_config(), same
one-per-deployment shape as Shopify/Amazon's client credentials. Per-org
customization — which mode is on, the proactivity dial, known groups and
their participant mapping — is per-tenant state in the generic
extension_installs table (common/db/_extensions.py), read/written through
extensions/whatsapp/store.py, because unlike Shopify there's no per-tenant
OAuth handshake to hang a bespoke DB table off of.
"""
from extensions.base import ConfigField, Extension, ExtensionKind, ExtensionManifest, RunResult


class WhatsAppExtension(Extension):
    manifest = ExtensionManifest(
        id="whatsapp",
        name="WhatsApp",
        kind=ExtensionKind.CHANNEL,
        category="Channels",
        description=(
            "WhatsApp as a chat channel — 1:1 customer support and/or a small-group "
            "assistant that replies on @-mention or proactively. UNVALIDATED: no live "
            "Meta Business account yet, see docs/plans/WHATSAPP_INTEGRATION_PLAN.md."
        ),
        icon="\U0001F4AC",
        # Rendered generically by the admin extension catalog UI (no bespoke
        # frontend needed — see extensions/__init__.py's folder convention).
        # These are per-org preferences stored via extensions/whatsapp/store.py,
        # NOT the global Meta app credentials (those are deployment-level
        # config, set via common/app.config / env, same split as Shopify).
        config_schema=[
            ConfigField(
                name="mode", label="Mode", type="select", required=True,
                options=["support_1to1", "group_assistant", "both"],
                placeholder="support_1to1",
            ),
            ConfigField(
                name="proactivity_level", label="Group proactivity", type="select", required=False,
                options=["silent", "mention_only", "light_proactive", "full_proactive"],
                placeholder="mention_only",
            ),
        ],
        capabilities=["webhook_receiver", "send_messages"],
    )

    def status(self, org_id: str) -> dict:
        from extensions.whatsapp.store import get_org_settings
        from common.config_manager import get_whatsapp_config

        cfg = get_whatsapp_config()
        settings = get_org_settings(org_id)
        return {
            "status": "configured" if cfg["enabled"] else "not_configured",
            "groups_enabled": cfg["groups_enabled"],
            "mode": settings.get("mode", "support_1to1"),
            "proactivity_level": settings.get("proactivity_level", cfg["default_proactivity_level"]),
            "group_count": len(settings.get("groups") or {}),
        }

    def test(self, config: dict) -> RunResult:
        """Best-effort connectivity check — a cheap authenticated GET against
        the configured phone number, per Meta's Cloud API — PLUS re-asserting
        this app's webhook subscription on the WABA every time.

        That second part is load-bearing, not defensive boilerplate: confirmed
        live (2026-08-27) that Meta's "Connect on WhatsApp" wizard leaves the
        WABA subscribed to Meta's own internal demo app instead of yours, and
        nothing in that wizard's UI ever tells you so — the webhook verifies
        fine and silently never receives a real message. Re-running this call
        here means clicking "test" on this extension is also the fix, not
        just a diagnostic. Idempotent, safe to call every time."""
        from extensions.whatsapp.service import whatsapp_service
        from common.config_manager import get_whatsapp_config

        cfg = get_whatsapp_config()
        if not cfg["enabled"] or not cfg["access_token"] or not cfg["phone_number_id"]:
            return RunResult(status="error", detail={
                "error": "WhatsApp is not configured on this deployment (whatsapp_enabled, "
                         "access_token, phone_number_id all required)."
            })
        ok, detail = whatsapp_service.check_connectivity()
        if not ok:
            return RunResult(status="error", detail=detail)
        sub_ok, sub_detail = whatsapp_service.ensure_subscribed_to_webhooks()
        detail["webhook_subscription"] = sub_detail if sub_ok else {"error": sub_detail.get("error")}
        return RunResult(status="success" if sub_ok else "error", detail=detail)


EXTENSION = WhatsAppExtension()
