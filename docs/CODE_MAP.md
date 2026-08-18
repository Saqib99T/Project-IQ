# Project IQ — Code Map

**What this document is for:** a way to find "which part of the code does X"
without reading everything. It describes *what each part is responsible for*
and *how the parts talk to each other* — not findings or remediation history
(that's [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md)), and not how to run
or deploy the system (that's [DEPLOYMENT.md](../DEPLOYMENT.md)).

If you're looking for a specific behavior, start with "I want to change
how..." in [§7](#7-i-want-to-change-how) — it points straight at the
relevant file(s).

---

## 1. The one-paragraph version

Project IQ is a chatbot platform: a **Rasa** NLU/dialogue engine (`core/`)
decides what to say, a Python **action server** (`action_server/`) decides
what to *do* (call APIs, query the DB, run business logic), and a Flask
**Admin API** (`web/api/`) is everything else the chatbot needs that isn't
Rasa — auth, admin config, chat session plumbing, and proxying to the sibling
`itsm-service` repo for tickets/KB/assets. Three **React frontends** (widget,
portal, itsm-app) and one **Expo mobile app** consume that Admin API. An
`extensions/` framework lets third-party integrations (Shopify, Amazon,
Google Sheets, Microsoft Teams) plug into both the bot and the Admin API
without the core code knowing their specifics.

```
┌─────────────┐      ┌──────────────┐      ┌───────────────────┐
│   core/     │◄────►│ action_server│◄────►│  common/ (shared)  │
│ (Rasa NLU + │ HTTP │ (business    │      │  DB · IAM · cache  │
│  dialogue)  │      │  logic)      │      │  · vector search   │
└─────────────┘      └──────────────┘      └─────────┬──────────┘
                                                       │
┌─────────────┐      ┌──────────────┐                 │
│  web/ui/     │◄────►│  web/api/    │◄────────────────┘
│ (3 React     │ HTTP │ (Flask Admin │      ┌───────────────────┐
│  frontends)  │      │  API)        │◄────►│  extensions/       │
└─────────────┘      └──────┬───────┘      │  Shopify · Amazon · │
                             │              │  Sheets · Teams     │
┌─────────────┐             │              └───────────────────┘
│  expo-app/   │◄────────────┘
│ (mobile)     │             │
└─────────────┘             ▼
                    itsm-service (sibling repo, FastAPI)
                    tickets · assets · KB · SLA
```

---

## 2. The chatbot engine

### `core/` — Rasa NLU + dialogue management
Decides *what the bot understands* and *what it says next*. This is
declarative configuration + training data, not application code you'd step
through with a debugger.

| File/dir | Job |
|---|---|
| `domain.yml` | Every intent, entity, slot, and response the bot knows about |
| `data/nlu.yml` | Training examples per intent (what users actually type) |
| `data/stories.yml`, `data/rules.yml` | Conversation flow patterns Rasa trains on |
| `config.yml` | The NLU pipeline (DIET classifier, plus a semantic nearest-intent fallback for low-confidence classifications — see `action_server/actions/_intent_index.py`) |
| `endpoints.yml` / `endpoints.local.yml` / `endpoints.prod.yml` | Where Rasa forwards actions (→ `action_server/`) |
| `models/` | Trained model artifacts (binary, not source — see `docs/` for the release process) |

**When to look here:** the bot misunderstands or misroutes a user message,
or you're adding a new intent/entity.

### `action_server/` — what the bot *does*
Every Rasa "custom action" — the Python code that runs when the dialogue
model decides to call out (as opposed to just returning a canned response).
This is where business logic for the *conversational* surface lives.

| File | Job |
|---|---|
| `actions/actions.py` | Core dispatch + shared action base classes |
| `actions/actions_itsm_tickets.py`, `actions_itsm_auth.py` | Ticket creation/lookup, IAM-authenticated actions — proxies to itsm-service |
| `actions/actions_kb.py` | Knowledge-base search/answer actions |
| `actions/actions_handoff.py` | Bot → human operator handoff |
| `actions/actions_shopify.py`, `actions_amazon.py` | Commerce actions (order status, etc.) — thin, delegate to `extensions/shopify` and `extensions/amazon` |
| `actions/actions_session.py` | Session/slot lifecycle |
| `actions/actions_fallback.py`, `actions_feedback.py`, `actions_general.py` | Low-confidence fallback, feedback capture, small-talk |
| `actions/_intent_index.py` | Semantic nearest-intent fallback (embedding-based) used when DIET confidence is low |
| `actions/_i18n.py` | Response translation/localization |
| `actions/itsm_service.py` | Thin HTTP client actions use to call itsm-service |

**When to look here:** the bot understands the user correctly but the
*response or side effect* is wrong (wrong ticket data, KB answer, handoff
behavior, commerce reply).

---

## 3. `common/` — shared backend code

Imported by `action_server/`, `web/api/`, and `extensions/` alike. If
multiple parts of the Python backend need the same thing, it lives here.

| File | Job |
|---|---|
| `db/_connection.py` | DB connection pooling + the **legacy** inline-DDL bootstrap (`_init_database()`) for fresh installs predating Alembic |
| `db/migrations/` | **Alembic** migrations — the current way schema changes are made (see `alembic.ini` at repo root) |
| `db/_config.py`, `_handoff.py`, `_kb_gaps.py`, `_messages.py`, `_notifications.py`, `_analytics.py`, `_canned.py`, `_extensions.py`, `_amazon.py`, `_shopify.py` | Table-scoped query modules — one file per feature area's data access |
| `iam_service.py` | Keycloak JWKS validation (proxy → direct → bundled-fallback resilience) |
| `iam_api_client.py` | Calls *out* to IAM's admin APIs (not just token validation) |
| `config_manager.py` | Reads `app.config*` + `PIQ_<SECTION>_<OPTION>` env overrides |
| `crypto.py` | At-rest encryption for DB-stored secrets (e.g. `shopify_connections.access_token`) |
| `vector_search.py` | pgvector-backed KB semantic search (embeddings via `sentence-transformers`) |
| `kb_sync.py`, `firecrawl_ingester.py` | Knowledge-base content ingestion pipelines |
| `analytics_store.py` | Conversation/usage analytics persistence |
| `attachment_store.py` | File attachment handling (routes through MinIO — see `bp_storage_proxy.py`) |
| `redis_cache.py`, `ttl_cache.py` | Caching layers (Redis-backed and in-process) |
| `request_context.py` | Per-request correlation ID (`X-Request-ID`) plumbing — powers the Diagnostics **Trace** tab |
| `error_alerting.py` | Sentry integration |
| `lang_detect.py` | Language detection for i18n |
| `conversation_db.py` | Conversation/session persistence |

**When to look here:** you need to know *where a piece of data lives* or
*how auth/config/caching actually works* underneath any of the other layers.

---

## 4. `web/api/` — the Flask Admin API

Everything the chatbot platform needs that isn't Rasa: auth endpoints, admin
configuration, portal data, session/chat plumbing, and the proxy to
itsm-service. Structured as Flask **blueprints**, registered in one place.

| File | Job |
|---|---|
| `web_api.py` | App factory — creates the Flask app, wires in Socket.IO, registers all blueprints |
| `blueprints/register.py` | The single place every blueprint gets mounted — **start here** to find which URL prefix maps to which file |
| `blueprints/bp_auth.py` | Login/token endpoints |
| `blueprints/bp_chat.py` | Chat message send/receive (bot + human handoff) |
| `blueprints/bp_sessions.py` | Chat session lifecycle (one record per login/new-conversation — see product-scoped session ID design) |
| `blueprints/bp_kb.py` | Knowledge-base admin endpoints (this app's own KB, distinct from itsm-service's) |
| `blueprints/bp_notifications.py` | Outbound webhook/notification config (Teams, generic webhook) — proxies to itsm-service's `/webhooks-config` |
| `blueprints/bp_extensions.py` | This app's **own** extension install/config/test/run API — backs `extensions/` (distinct from `bp_notifications.py`'s itsm-service-backed integrations) |
| `blueprints/bp_admin_config.py` | Platform configuration (`/admin/config`) — identity, storage, email, AI settings |
| `blueprints/bp_admin_ops.py` | Admin operational actions |
| `blueprints/bp_portal_admin.py` | Admin-portal-specific data endpoints |
| `blueprints/bp_portal_operator.py` | Operator-console-specific endpoints (co-pilot, canned responses) |
| `blueprints/bp_itsm_proxy.py` | Generic authenticated proxy to itsm-service (tickets/assets/KB pass through here) |
| `blueprints/bp_studio_inspector.py` | Rasa Studio / conversation debugging tools |
| `blueprints/bp_storage_proxy.py` | MinIO presigned-URL proxy (cloud firewall blocks direct `:9000` access) |
| `blueprints/bp_ticket_attachment.py` | Ticket attachment upload/download |
| `blueprints/bp_system.py` | `/api/status` — backs the Diagnostics **Services** tab (systemd + docker health) |
| `blueprints/bp_user_api.py` | End-user-facing account endpoints |
| `blueprints/bp_analytics.py` | Analytics/reporting endpoints |
| `blueprints/bp_demo.py` | Demo/sandbox mode endpoints |
| `blueprints/bp_internal.py` | Internal/service-to-service endpoints |
| `blueprints/bp_static.py` | Serves the built frontends (`web/ui/public/*`, `dist-widget/`) |
| `impl/socketio_events.py` | Real-time Socket.IO event handlers (chat, handoff) |
| `impl/operator.py` | Operator-console business logic backing `bp_portal_operator.py` |
| `impl/observability.py` | Log aggregation + request tracing — backs the Diagnostics **Logs** and **Trace** tabs |
| `impl/admin_ops.py`, `metrics_queries.py`, `notify.py` | Supporting logic for the admin/metrics/notification blueprints |
| `log_parser.py` | Parses systemd/docker logs into the structured shape `observability.py` serves |
| `process_monitor.py` | The actual systemd/docker status checks `bp_system.py` exposes |
| `rate_limiting.py` | Per-IP rate limiter (Redis in prod, in-memory otherwise) |
| `training_manager.py` | Triggers/monitors Rasa model retraining from the admin UI |
| `studio_service.py` | Backs `bp_studio_inspector.py` |

**When to look here:** a REST endpoint the frontend calls, or platform admin
behavior, needs to change. **Rule of thumb**: `bp_*.py` = routes/validation,
`impl/*.py` = the actual logic behind the busier routes.

---

## 5. `web/ui/` — the frontends (one Vite project, four build targets)

One `src/` tree, four separate entry points/builds — each ships as its own
bundle:

| Build | Entry | Serves |
|---|---|---|
| `npm run build:widget` | `src/widget.jsx` | Embeddable chat widget (`dist-widget/itsm-chat-widget.js`) — the `<itsm-chat-widget>` web component customers embed on their own sites |
| `npm run build:portal` | `src/portal/` via `main.jsx` | The admin/operator/member portal (`public/portal/`) |
| `npm run build:itsm` | `src/itsm-app/` | The standalone ITSM ticket/asset/KB app (`public/itsm/`) |
| *(operator console is inside portal)* | `src/portal/operator/` | Human-agent handoff console, part of the portal build |

| Directory | Job |
|---|---|
| `src/widget/` | The embeddable chat widget — `components/`, `hooks/` (incl. `useIam.js` for Keycloak), `utils/` |
| `src/portal/admin/` | Admin hub pages: `Layout.jsx`, `DiagnosticsPage.jsx`, `IntegrationPage.jsx`, config pages, and `admin/itsm/` (generic reference-data admin for itsm-service entities) |
| `src/portal/operator/` | Operator co-pilot console (handoff queue, canned responses, bot-reply drafting) |
| `src/portal/member/` | End-user-facing portal pages (non-admin) |
| `src/portal/pages/` | Shared/top-level portal routes |
| `src/portal/useApi.js` | The portal's IAM-authenticated fetch wrapper (attaches Bearer token + `X-Org-Id` for admin tenant scoping) |
| `src/portal/index.css` | **The portal's design system** — `.card`, `.btn-primary`, `.btn-ghost`, `.badge`, `.input`, `.select`, built on themeable CSS custom properties (`--c-*`) so the whole UI can swap between brand themes (incl. white-label) via `[data-theme]` |
| `src/itsm-app/` | Standalone ITSM ticket/asset/KB app — `pages/`, `components/admin/` |
| `src/shared/itsm/` | TypeScript primitives shared between `portal/admin/itsm` and `itsm-app`: `useItsmApi.ts` (typed itsm-service HTTP client + hooks), `ui.tsx` (design-system components: DataTable, Drawer, Tabs, Toast, etc.), `ReferenceDataManager.tsx` (generic CRUD manager for reference-entity types), `ItsmTenantContext.tsx` |
| `tailwind.config.js` | Maps the `--c-*` CSS variables to Tailwind color utilities (`text-fg`, `border-bordc`, `bg-surface`, `text-primary`, `text-success`/`warning`/`danger`, etc.) — **use these tokens, not raw Tailwind colors**, so pages stay theme-consistent |

**When to look here:** anything a human (customer end-user, admin, or
operator) sees in a browser.

### `expo-app/` — the mobile app
A separate React Native (Expo) project, not part of the Vite build. `src/`
mirrors the same rough shape (`screens/`, `components/`, `hooks/`,
`services/`, `context/`, `utils/`). Talks to the same `web/api/` Admin API.
Every web feature/fix is expected to land here too unless physically
impossible on mobile (session-established convention).

---

## 6. `extensions/` — the plugin framework

A generalized integration framework so third-party connectors (commerce,
productivity tools, chat platforms) don't need bespoke wiring into the core
app. Each extension implements the same contract (`Extension`,
`ExtensionManifest`, `ConfigField` — defined in `extensions/base.py`) and is
managed uniformly via `bp_extensions.py`'s install/configure/test/run API.

| Directory | Job |
|---|---|
| `extensions/shopify/` | Shopify commerce integration — OAuth connect flow (has its own dedicated connect page rather than the generic config form, since OAuth needs a real redirect) |
| `extensions/amazon/` | Amazon SP-API integration — order-status bot action + SQS notifications consumer (notifications gated behind a feature flag, unvalidated against live SP-API as of writing) |
| `extensions/google_sheets/` | Google Sheets data-source extension (KB ingestion) |
| `extensions/ms_teams/` | Microsoft Teams — **note:** Teams/webhook-style notification integrations are actually managed through itsm-service's `/webhooks-config` API (see `bp_notifications.py`), not this framework; this directory holds the extension-framework-native pieces only |
| `extensions/website/` | Generic website-crawl data source |

**When to look here:** adding a new third-party integration, or fixing one
of the existing ones. `shopify-app/shopify.app.toml` (repo root) is Shopify
Partner-app config, not application code.

---

## 7. "I want to change how..."

| ...this behaves | ...look here |
|---|---|
| ...the bot responds to a message | `core/domain.yml` (what it *can* say) → `core/data/nlu.yml` (what triggers it) → `action_server/actions/*.py` (what it *does*) |
| ...a ticket gets created/updated from chat | `action_server/actions/actions_itsm_tickets.py` → `action_server/actions/itsm_service.py` → itsm-service (sibling repo) |
| ...the admin portal's diagnostics page looks/works | `web/ui/src/portal/admin/DiagnosticsPage.jsx` (frontend) + `web/api/blueprints/bp_system.py` / `impl/observability.py` (backend) |
| ...an integration (Shopify, Teams, etc.) is configured | `web/ui/src/portal/admin/IntegrationPage.jsx` (frontend) + `web/api/blueprints/bp_extensions.py` or `bp_notifications.py` (backend, depending on which of the two integration systems) + `extensions/<name>/` (the extension itself) |
| ...auth/login works | `common/iam_service.py` (token validation) + `web/api/blueprints/bp_auth.py` (login endpoints) + `web/ui/src/widget/hooks/useIam.js` / `src/portal/useApi.js` (frontend token handling) |
| ...the DB schema | New changes: `common/db/migrations/` (Alembic). Historical/legacy: `common/db/_connection.py`'s `_init_database()` (kept for pre-Alembic deployments, not used for new schema work) |
| ...KB search relevance | `common/vector_search.py` (embeddings/similarity) + `common/kb_sync.py` / `firecrawl_ingester.py` (what gets indexed) |
| ...human handoff behavior | `action_server/actions/actions_handoff.py` (bot side) + `web/api/impl/socketio_events.py` + `web/api/impl/operator.py` (operator side) + `web/ui/src/portal/operator/` (operator UI) |
| ...rate limiting / abuse protection | `web/api/rate_limiting.py` |
| ...how the mobile app behaves | `expo-app/src/` — mirror whatever the equivalent web change was |

---

## 8. Sibling repo: `itsm-service`

Lives at a separate path (`../itsm-service` relative to this repo, or
wherever it's checked out locally) — **not a subdirectory of this repo.**
FastAPI, owns tickets, assets, the ITSM knowledge base, and SLA/on-call data.
Shares the same Postgres instance as this app (different databases:
`Chatbot` here, `itsm_db` there). This repo talks to it via
`action_server/actions/itsm_service.py` (from the bot) and
`web/api/blueprints/bp_itsm_proxy.py` / `bp_notifications.py` (from the Admin
API) — never by importing its code directly, since it's a genuinely separate
service with its own deploy lifecycle.

---

## 9. Tests

`tests/` (repo root) covers the Python backend — organized by feature area,
not by directory-under-test 1:1 (e.g. `test_actions_amazon.py`,
`test_kb_tenant_isolation.py`, `test_rate_limiting.py`). Frontend tests live
alongside the code they cover under `web/ui/src/**/*.test.*` (see
`src/test/` for shared test setup). `itsm-service` has its own separate test
suite in its own repo.
