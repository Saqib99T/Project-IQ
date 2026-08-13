# Data Integration Framework — Strategy & Architecture Plan

Status: **planning only — no implementation**
Scope: **independent of** `docs/AMAZON_INTEGRATION_PLAN.md` — that plan is about *one commerce provider's* API mechanics. This plan is about the *shared plumbing* every integration (commerce, KB source, outbound notification, future CRM/ERP/ticketing connector) should be built on, so the next ten integrations are additions, not each a bespoke rebuild.

---

## 0. Executive Summary

The trigger: browsing Airbyte's connector catalog (600+ sources/destinations, uniform config-driven install) raised the question of whether Project IQ should have something similar — a plugin-style framework where adding a new data source or destination is a matter of writing one self-contained connector, not touching five different subsystems.

The finding that should set expectations up front: **the codebase already has four separate, independently-evolved integration mechanisms**, none of which is a general plugin framework, and none of which is aware of the others (§1). Building "a data integration framework" doesn't start from zero — it starts from consolidating four ad hoc patterns behind one contract, then making *new* integrations cheap. That reframes the work from "build a plugin system" to "extract the plugin system that's implicitly already been written four times, then make it explicit."

This plan defines: a common connector contract (§2), a generalized multi-tenant connection/config data model (§3), a discovery/registry mechanism so new connectors don't require editing central files (§4), a narrow host SDK so connector code isn't tightly coupled to internals like `conversation_db` or `vector_search` (§5), the admin-UI consolidation this enables (§6), and a phased, non-breaking migration path for the four existing systems (§7).

---

## 1. Current State: Four Integration Patterns That Don't Know About Each Other

| # | System | Where | Kind | Coupling problem |
|---|---|---|---|---|
| 1 | **Commerce providers** (Shopify live, Amazon planned) | `action_server/actions/shopify_service.py`, `web/api/blueprints/bp_shopify.py`, `shopify_connections` table | Bidirectional (read + write), per-tenant OAuth | Each provider gets its own DB table, its own blueprint, its own admin page (`ShopifyPage.jsx`), its own hardcoded `get_shopify_config()`/`get_amazon_config()` functions in `config_manager.py`. Rasa actions import `shopify_service` directly by name. |
| 2 | **KB data sources** (was PyAirbyte-based; now native) | was `common/airbyte_connector.py`, since removed | Inbound only, scheduled/manual pull | `SUPPORTED_SOURCES` was a hardcoded dict of 8 sources; `sync_source()` directly imported and called `conversation_db.add_kb_article`, `vector_search.load_and_process_articles`, and `firecrawl_ingester.log_data_source` — a new source type required editing this one file's dict *and* usually a bespoke `_transform_x()` function. **Decided against reusing this file at all** — the framework does not depend on the third-party PyAirbyte library in any form; each source extension implements its own pull logic natively (see §2/§7). |
| 3 | **KB web crawling** | `common/firecrawl_ingester.py` | Inbound only | A second, parallel ingestion pipeline into the same KB tables, unrelated code path from #2, even though conceptually it's also "pull external data into the KB." |
| 4 | **Outbound webhook/notification integrations** | Catalog lives in **itsm-service** (`GET /integrations/catalog`, `kind: 'outbound_webhook'`), consumed by `web/ui/src/portal/admin/IntegrationPage.jsx` | Outbound (event → webhook/Teams) | Closest thing to a real plugin pattern already — catalog-driven, `config_schema`-rendered UI, generic `ConfigModal`/`StatusBadge` — but it lives in a **different repo/service** than the other three, and only covers outbound webhook delivery, not pulling data in. |

Observations that shape the design:

- **#4's catalog + `config_schema` pattern is worth keeping and generalizing** — it's the one part of the current codebase that already looks like a plugin registry (schema-driven config, no hardcoded form per integration). The gap is that it only describes outbound webhooks and only exists in itsm-service.
- **#2 is the most tightly coupled** — a connector's business logic (talk to the source) and the KB ingestion side-effects (save article, re-embed, log) are the same function body. That's the concrete "should not be tightly coupled" problem the user flagged.
- **#1 already has a half-solution documented** — `AMAZON_INTEGRATION_PLAN.md` §4 independently proposes a `CommerceProvider` interface + generalized `commerce_connections` table for exactly the same reason (don't hardcode one table/blueprint per provider). This plan generalizes that idea past commerce, so commerce becomes one connector *kind* under the same umbrella instead of its own parallel system.
- **Every one of the four already does per-integration credential handling differently**: Fernet-encrypted DB columns (`common/crypto.py`, used by #1), config-file `_env_secret()` overrides (used for all four's *app-level* credentials in `config_manager.py`), and itsm-service's own storage for #4. A framework should have exactly one answer to "where do a connector's secrets live," not contribute a fifth.

---

## 2. The Connector Contract

A **connector** is a self-contained Python package implementing one interface, regardless of kind. Modeled on Airbyte's source/destination split, but simplified for a single-codebase deployment rather than Airbyte's containerized-per-connector isolation model (§8 discusses whether that isolation is worth adopting).

```python
class ConnectorKind(str, Enum):
    SOURCE = "source"              # pulls external data IN (KB docs, tickets, orders — read)
    DESTINATION = "destination"    # pushes Project IQ data OUT (webhook, Teams, Slack)
    COMMERCE = "commerce"          # bidirectional, transactional (Shopify/Amazon shape — §2.1)

class ConnectorManifest:
    id: str                    # "confluence", "shopify", "ms-teams" — stable, used as DB/config key
    name: str                  # display name
    kind: ConnectorKind
    icon: str
    description: str
    config_schema: list[ConfigField]   # generalizes IntegrationPage.jsx's existing config_schema shape
    capabilities: list[str]    # e.g. ["oauth", "webhook_receiver", "scheduled_sync", "write_actions"]

class Connector(Protocol):
    manifest: ConnectorManifest

    def test_connection(self, config: dict) -> ConnectionTestResult: ...

    # SOURCE kind
    def list_streams(self, config: dict) -> list[str]: ...
    def pull(self, config: dict, streams: list[str], ctx: HostContext) -> SyncResult: ...

    # DESTINATION kind
    def push(self, config: dict, event: OutboundEvent, ctx: HostContext) -> None: ...

    # COMMERCE kind (mirrors AMAZON_INTEGRATION_PLAN.md §4.2's CommerceProvider)
    def find_order(self, config: dict, order_number: str, email: str) -> Order | None: ...
    def refund_order(self, config: dict, order_ref: str, ...) -> RefundResult: ...
    # etc. — commerce methods are the one kind-specific extension to the base contract,
    # since "order lookup" has no equivalent in source/destination connectors.
```

Key decisions embedded in this shape:

- **`pull()`/`push()` never import app internals directly** — they receive a `HostContext` (§5) and call back through it. This is the direct fix for #2's coupling problem: a Confluence connector doesn't know what `add_kb_article` is; it returns/yields records and the host decides what to do with them.
- **`config_schema` is the single source of truth for both the admin UI form and server-side validation** — one connector generalizes IntegrationPage.jsx's already-working pattern (§1, system #4) instead of inventing a second schema format.
- **Commerce is a connector kind, not a separate system** — `ShopifyService`/`AmazonService` become connectors whose `manifest.kind == COMMERCE`; the Amazon plan's `CommerceProvider` interface (§4.2 of that doc) becomes this contract's commerce-specific method set. Building Amazon against *this* contract instead of a standalone one avoids a fifth pattern arriving before the fourth is even cleaned up.

---

## 3. Data Model

One generalized connection table replaces `shopify_connections` (and the would-be `amazon_connections`) *and* becomes where KB-source and outbound-webhook config lives too — the same shape already independently proposed in `AMAZON_INTEGRATION_PLAN.md` §4.1, widened from "commerce" to "any connector kind":

```
integration_connections
    org_id              TEXT NOT NULL         -- tenant scope; NULL/platform-level row for
                                               -- deployment-wide connectors (e.g. a single
                                               -- Confluence source shared across tenants)
    connector_id        TEXT NOT NULL         -- manifest.id, e.g. 'shopify', 'confluence'
    external_id         TEXT                  -- shop_domain / space_key / webhook target — connector-defined
    config              JSONB NOT NULL        -- non-secret config (validated against config_schema)
    secrets             JSONB                 -- Fernet-encrypted blob (common/crypto.py, same pattern as today)
    status              TEXT NOT NULL DEFAULT 'connected'   -- connected | error | disabled
    last_sync_at        TIMESTAMPTZ
    last_sync_result    JSONB                 -- {status, records, error} — surfaced in admin UI
    installed_at, updated_at   TIMESTAMPTZ
    PRIMARY KEY (org_id, connector_id, external_id)
```

- **Secrets stay in one encrypted JSONB blob per connection**, not scattered per-field columns — `encrypt_secret()`/`decrypt_secret()` (`common/crypto.py`) already does the right thing for Shopify's token; this just stops requiring a schema migration every time a new connector needs a new secret field.
- **`config` is validated against the connector's own `config_schema`** at write time (admin API), not trusted blindly — closes the gap where #2's `sync_source()` today only checks `required_config` key *presence*, not shape.
- Migration of `shopify_connections` → `integration_connections` is additive/optional (same call the Amazon plan flags in its §4.1/§8 — decide once there's a second real connector, not before).

---

## 4. Discovery & Registry (the actual "plugin" part)

The concrete fix for "not tightly coupled": adding extension #N should never require editing `register.py`, `config_manager.py`, or any central dict (`SUPPORTED_SOURCES` in the old, now-deleted `airbyte_connector.py`).

**This section is the historical design sketch — `extensions/__init__.py`'s own module docstring is the authoritative, current version of this convention; keep changes to the convention there, not here, so there's one source of truth.** As actually implemented:

```
extensions/
    __init__.py            # registry: discovers everything below, incl. route blueprints
    base.py                 # Extension / ExtensionManifest / ExtensionKind / ConfigField
    _kb_adapter.py           # shared save-to-KB step for SOURCE extensions
    website/
        extension.py         # EXTENSION = ... , kind=SOURCE
    google_sheets/
        extension.py
    ms_teams/
        extension.py         # kind=DESTINATION
    shopify/
        extension.py         # kind=COMMERCE — manifest + Extension subclass only
        service.py            # the GraphQL client — the extension's OWN business
                              # logic, not imported from action_server/ or web/api/
        routes.py             # OAuth connect/callback/webhook Blueprint (`bp`) —
                              # the extension's OWN HTTP surface, auto-registered
```

The rule this enforces, learned the hard way on Shopify's first pass: an extension's business logic and any HTTP routes it needs must live **inside its own folder**, not be imported/wrapped from a "core" file elsewhere (`action_server/actions/*`, `web/api/blueprints/*`). The folder should be portable — copy it into another project with `extensions/base.py` and it works — not a thin facade pointing back at logic that still lives outside `extensions/`.

- **Discovery**: at startup, the registry walks `extensions/*/extension.py` for a module-level `EXTENSION` instance, and separately (optionally) `extensions/*/routes.py` for a module-level `bp` Flask Blueprint. No central "list of extensions" file to keep in sync — the directory *is* the list, for both the extension itself and any routes it owns.
- **One generic blueprint for the common case**: `bp_extensions.py` exposes `GET /admin/extensions/catalog`, `POST .../install`, `POST .../test`, `POST .../run`, `POST .../push`, `GET .../status`, `DELETE ...` — covers every extension that doesn't need its own fixed-URL endpoint (an OAuth callback, an inbound webhook receiver). For the ones that do (Shopify), `routes.py` + the registry's auto-discovery covers it — `register_blueprints()` in `web/api/blueprints/register.py` calls `extensions.list_route_blueprints()` and registers whatever it finds, so a new extension with its own routes.py needs zero edits to `register.py`.
- **One generic admin page**: `IntegrationPage.jsx`'s catalog-driven `ConfigModal`/`StatusBadge` pattern (§1) covers install/test/run for the common case; Shopify (and anything else needing a real OAuth redirect) uses `manifest.manage_url` to link out to its own dedicated page instead.

---

## 5. Host SDK (decoupling connector code from app internals)

This is what actually prevents tight coupling, not just directory layout. A connector's `pull()`/`push()` never `import common.conversation_db` or `import common.vector_search` directly — it receives a narrow context object:

```python
class HostContext:
    def emit_records(self, records: Iterable[NormalizedRecord]) -> None: ...
        # host decides: KB article? ticket? — connector doesn't know or care
    def get_secret(self, key: str) -> str: ...
    def log(self, level: str, message: str, **fields) -> None: ...
    def org_id(self) -> str: ...
```

- A **source→KB adapter** (one small module, not per-connector) is what turns `NormalizedRecord` into `add_kb_article()` calls + triggers `vector_search` re-embedding — today that logic is duplicated inline inside `airbyte_connector.py`'s `sync_source()` and, separately, inside `firecrawl_ingester.py`. Under this design both become "a SOURCE connector whose records flow through the same KB adapter," collapsing systems #2 and #3 from §1 into one ingestion path with two connectors feeding it, rather than two ingestion pipelines.
- **Destination connectors** receive `OutboundEvent` objects from wherever Project IQ emits domain events (ticket updated, SLA breached, etc.) and are responsible only for delivery — this is the generalization of itsm-service's outbound-webhook catalog (#4), pulled into the same contract so a future Slack or PagerDuty destination is written the same way a Confluence source is.
- Secrets access goes through `ctx.get_secret()` (decrypts from `integration_connections.secrets` on demand) so connector code never handles raw Fernet keys or touches `common/crypto.py` directly.

---

## 6. What This Enables in the Admin UI

Once §4-§5 exist, `IntegrationPage.jsx` becomes the **one** place admins manage every connector — commerce, KB source, outbound notification — each rendered from `manifest.config_schema` through the `ConfigModal` component that already exists and already works for outbound webhooks today. `ShopifyPage.jsx` and any bespoke KB-source connect UI go away, not because they're wrong, but because they're the pattern this plan is trying to stop repeating. Status (`connected`/`error`/`last_sync_at`) is read directly off `integration_connections`, giving a single "what's connected to this tenant" view that doesn't exist today (currently you'd have to check the Shopify page, the KB sources page, and itsm-service's integration page separately to answer that).

---

## 7. Phased Roadmap (non-breaking — nothing existing breaks mid-migration)

| Phase | Scope | Notes |
|---|---|---|
| **0 — Contract + registry, no behavior change** | Define `Connector`/`ConnectorManifest`/`HostContext` (§2, §5), build the `integrations/` discovery mechanism (§4), create `integration_connections` table (§3) | Ships alongside the existing four systems untouched — pure addition, zero migration risk. |
| **1 — First real connector proves the contract** ✅ done, then removed | Confluence was built natively (direct REST calls, no third-party connector runtime) to prove the contract, then removed along with the other unimplemented catalog entries — zero real usage evidence in `kb_data_sources` for any of the original 8-source catalog (§7 below). The pattern it proved carried forward into `google_sheets`. | Contract validated; kept no dead weight once it had served that purpose. |
| **2 — Generic catalog blueprint + admin UI** ✅ done (backend) | `bp_extensions.py` (catalog/install/test/run/push/status/delete), merges itsm-service's outbound webhook catalog read-only | Backend surface is live; `IntegrationPage.jsx` still needs its kind filter widened to read from it — no admin UI wired up yet. |
| **3 — Google Sheets + Microsoft Teams, natively implemented** ✅ done | `extensions/google_sheets/extension.py` (public CSV-export, no OAuth) and `extensions/ms_teams/extension.py` (DESTINATION, own event channel distinct from itsm-service's) | Chosen over Jira/Zendesk/Freshdesk/Slack/Notion, which were evaluated and explicitly deprioritized (no real usage evidence for any of the original 8-source catalog — see `kb_data_sources` table, 100% of historical ingestion was Firecrawl web-crawl). Those 6 placeholder entries (plus GitHub, never picked) were removed from `extensions/` entirely rather than left as unused stubs. |
| **4 — Shopify as a COMMERCE connector** | Wrap existing, already-verified `shopify_service.py` logic behind the `Connector` contract's commerce methods; migrate `shopify_connections` → `integration_connections` | Business logic doesn't change — only how it's registered/configured. This is also the point where `AMAZON_INTEGRATION_PLAN.md` should target *this* contract instead of a standalone `CommerceProvider` interface, so Amazon lands as connector #2 of this kind rather than a second bespoke system. |
| **5 — Outbound destinations join natively** | Either pull itsm-service's webhook catalog logic into a project-iq `DESTINATION` connector, or keep it in itsm-service but have project-iq's catalog endpoint federate it in (§8 decision) | Lowest urgency — itsm-service's existing system already works; this is about having one *view*, not necessarily one *process*. |

Each phase ships independently; nothing requires Amazon, and nothing requires touching Shopify before Phase 4 if a KB-source win is wanted first.

---

## 8. Decisions Needed From You

1. **Where should the unified catalog endpoint live** — project-iq (this repo) owning it and itsm-service's webhook catalog federating in, or the reverse? Affects Phase 5 and which repo owns `bp_integrations.py`.
2. **Process isolation for third-party/community connectors** — this plan assumes connectors run **in-process** (simple, fast, matches current scale). Airbyte runs each connector in its own container for isolation/language-independence. Worth adopting that only if you anticipate connectors written by people outside this team, or ones with heavy/conflicting dependencies (PyAirbyte's Java-backed connectors already hint at this — `common/airbyte_connector.py` shells out to JVM-based connector images today). Recommend deferring this until Phase 3+ actually hits a dependency conflict, rather than building for it now.
3. ~~Which KB source to port first in Phase 1~~ — resolved: Confluence proved the pattern, then was removed for lack of usage evidence; `google_sheets` is the current native KB-source extension (§7).
4. **Scheduling for SOURCE connectors' `pull()`** — cron-style periodic sync needs a background job runner, which is the same infra gap flagged in `docs/KB_WIKI_CURATION_RAG_PLAN.md` §4.10 and `AMAZON_INTEGRATION_PLAN.md` §2/§6 (SQS Notifications consumer). All three plans independently need "a place background jobs run" — worth deciding once, not three times.

---

## 9. References

- `extensions/google_sheets/extension.py` — current native SOURCE extension (public CSV export, no OAuth); `extensions/confluence/` served as the pattern's proof-of-concept and was removed once it had (removed along with it: `common/airbyte_connector.py`, the former PyAirbyte-based KB source integration this whole framework replaced — system #2, §1)
- `common/firecrawl_ingester.py` — current web-crawl KB ingestion (system #3, §1)
- `web/api/blueprints/bp_shopify.py`, `action_server/actions/shopify_service.py` — current commerce integration (system #1, §1)
- `web/ui/src/portal/admin/IntegrationPage.jsx` — existing catalog-driven UI pattern this plan generalizes (system #4, §1)
- `docs/AMAZON_INTEGRATION_PLAN.md` §4 — independently-proposed `CommerceProvider` interface + `commerce_connections` table; this plan's §2.1/§3 generalize that idea past commerce
- `docs/KB_WIKI_CURATION_RAG_PLAN.md` §4.10 — background-worker infra gap, relevant to §8 decision 4
