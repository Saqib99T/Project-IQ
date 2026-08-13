"""Extension contract — the one shape every plugin implements, regardless of
what it does (pull knowledge-base content, push outbound notifications, or
drive a commerce provider's order actions).

Kept deliberately small: a manifest (id, kind, config_schema — data the admin
UI renders generically, no per-extension frontend code) plus a handful of
optional methods. An extension only overrides what its kind needs; the base
class methods exist so the registry/blueprint can call them uniformly without
`hasattr` checks scattered everywhere.
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class ExtensionKind(str, Enum):
    SOURCE = "source"          # pulls external data IN (knowledge base, etc.)
    DESTINATION = "destination"  # pushes Project IQ events OUT (webhook, chat channel)
    COMMERCE = "commerce"      # bidirectional, transactional (order lookup/refund/cancel)


@dataclass
class ConfigField:
    """One field in a `config_schema` — rendered generically by the admin UI,
    no bespoke form per extension."""
    name: str
    label: str
    type: str = "text"         # text | password | url | number | select
    required: bool = True
    placeholder: str = ""
    options: Optional[list] = None
    secret: bool = False       # True => stored encrypted, never echoed back to the API


@dataclass
class ExtensionManifest:
    id: str                    # stable key — used as the DB/config identifier
    name: str
    kind: ExtensionKind
    description: str
    icon: str = "\U0001F9E9"   # puzzle piece
    category: str = "General"
    config_schema: list = field(default_factory=list)
    capabilities: list = field(default_factory=list)
    manage_url: Optional[str] = None  # set when connect/manage flows through a
                                       # dedicated route instead of the generic
                                       # install/run endpoints (e.g. OAuth)


@dataclass
class RunResult:
    status: str                 # "success" | "error"
    detail: dict = field(default_factory=dict)


class Extension:
    """Base class every extension subclasses. `manifest` is required;
    override `test`/`run`/`push` depending on the manifest's kind."""

    manifest: ExtensionManifest

    def test(self, config: dict) -> RunResult:
        """Best-effort connectivity check. Extensions that can't cheaply
        verify a connection may leave this as a no-op success."""
        return RunResult(status="success", detail={"note": "no connectivity check implemented"})

    def run(self, config: dict, streams: Optional[list] = None) -> RunResult:
        """SOURCE extensions: pull external data. Not applicable to
        DESTINATION/COMMERCE extensions."""
        raise NotImplementedError(f"{self.manifest.id} does not implement run()")

    def push(self, config: dict, event: dict) -> RunResult:
        """DESTINATION extensions: deliver one outbound event."""
        raise NotImplementedError(f"{self.manifest.id} does not implement push()")
