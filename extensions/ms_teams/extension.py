"""Microsoft Teams destination extension — native, posts directly to a Teams
incoming-webhook URL (no third-party notification service involved).

Distinct from itsm-service's existing "Microsoft Teams" outbound-webhook
catalog entry (merged into the unified catalog as id `microsoft_teams` by
bp_extensions.py's itsm-service fetch): that one delivers itsm-service's own
ticket/asset domain events. This extension is for events that originate in
*this* app instead — chat handoff queue alerts, bot/KB notifications — so a
tenant can point either or both at their own Teams channel without the two
systems needing to share an event bus.
"""
import logging

import requests

from extensions.base import ConfigField, Extension, ExtensionKind, ExtensionManifest, RunResult

logger = logging.getLogger(__name__)


def _message_card(event: dict) -> dict:
    """Teams incoming-webhook connectors accept the legacy MessageCard
    schema — simple and sufficient for text + key/value facts, no need for
    the newer (and considerably more verbose) Adaptive Card format here."""
    facts = [{"name": k, "value": str(v)} for k, v in (event.get("facts") or {}).items()]
    return {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "summary": event.get("title", "Project IQ notification"),
        "title": event.get("title", "Project IQ notification"),
        "text": event.get("text", ""),
        "sections": [{"facts": facts}] if facts else [],
    }


class MsTeamsExtension(Extension):
    manifest = ExtensionManifest(
        id="ms_teams",
        name="Microsoft Teams (bot & handoff alerts)",
        kind=ExtensionKind.DESTINATION,
        category="Notifications",
        description="Post Project IQ's own events (handoff queue, KB gaps, bot alerts) to a Teams channel via an incoming-webhook URL",
        icon="\U0001F4AC",
        config_schema=[
            ConfigField(name="url", label="Teams incoming webhook URL", type="url",
                        placeholder="https://<org>.webhook.office.com/webhookb2/..."),
        ],
        capabilities=["outbound_webhook"],
    )

    def test(self, config: dict) -> RunResult:
        return self.push(config, {
            "title": "Project IQ — test notification",
            "text": "This channel is now connected to Project IQ.",
        })

    def push(self, config: dict, event: dict) -> RunResult:
        try:
            resp = requests.post(config["url"], json=_message_card(event), timeout=10)
        except requests.RequestException as e:
            return RunResult(status="error", detail={"error": str(e)})
        if 200 <= resp.status_code < 300:
            return RunResult(status="success", detail={})
        return RunResult(status="error", detail={"error": f"Teams webhook returned HTTP {resp.status_code}: {resp.text[:200]}"})


EXTENSION = MsTeamsExtension()
