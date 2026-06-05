# ITSM Service — Detailed Implementation Plan

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| API Framework | FastAPI (Python 3.12) | Async, auto-OpenAPI, type-safe, high throughput |
| ORM | SQLAlchemy 2.0 (async) + Alembic | Production-grade, async sessions, migrations |
| Database | PostgreSQL 16 + pgvector (`itsm_db`) | Separate DB on shared Project-IQ server — isolated schema, credentials, pool |
| Cache / Queue Broker | Redis 7 | Sessions, rate limiting, Celery broker |
| Task Queue | Celery 5 | Async jobs: SLA checks, notifications, AI tasks |
| Auth | python-jose + httpx | JWT RS256 validation, IAM JWKS fetch |
| File Storage | S3-compatible (MinIO local / AWS S3 prod) | Presigned URLs, scalable |
| Real-time | Socket.IO (python-socketio) | Matches existing Project-IQ infra |
| LLM | Anthropic Claude API (`claude-sonnet-4-6`) | Classification, generation, virtual agent |
| Embeddings | OpenAI `text-embedding-3-small` (1536-dim) | Semantic search, duplicate detection |
| Monitoring | Prometheus + OpenTelemetry | Metrics, traces, AI cost tracking |
| Containerisation | Docker + Docker Compose | Dev parity, K8s-ready |

---

## Project Structure

```
itsm-service/
├── app/
│   ├── main.py                         # FastAPI app factory
│   ├── config.py                       # Pydantic-settings (env vars)
│   ├── database.py                     # Async SQLAlchemy engine + session factory
│   ├── redis_client.py                 # Redis connection + helpers
│   │
│   ├── auth/
│   │   ├── jwks.py                     # JWKS fetch + cache + RS256 verify
│   │   ├── dependencies.py             # Depends: current_user, require_role(...)
│   │   └── iam_client.py               # Async IAM API client (user/org sync)
│   │
│   ├── models/                         # SQLAlchemy ORM models
│   │   ├── base.py                     # Base, TimestampMixin, TenantMixin
│   │   ├── identity.py                 # Tenant, Product, Department, User, Role, Team
│   │   ├── ticket.py                   # Ticket, Comment, Tag, Attachment, History...
│   │   ├── asset.py                    # Asset, AssetType, Vendor, Maintenance...
│   │   ├── kb.py                       # KBSpace, KBCategory, KBArticle...
│   │   ├── notification.py             # Notification, NotificationPreference
│   │   ├── system_logs.py              # SystemLog (WARNING/ERROR/CRITICAL only)
│   │   ├── ai_usage.py                 # AIUsageDaily
│   │   └── virtual_agent.py            # VirtualAgentSession
│   │
│   ├── schemas/                        # Pydantic v2 request/response models
│   │   ├── common.py                   # Pagination, ErrorResponse
│   │   ├── identity.py
│   │   ├── ticket.py
│   │   ├── asset.py
│   │   └── kb.py
│   │
│   ├── api/
│   │   └── v1/
│   │       ├── router.py               # Mounts all sub-routers
│   │       ├── tickets.py
│   │       ├── assets.py
│   │       ├── kb.py
│   │       ├── admin.py                # Tenant settings, users, teams, roles, SLA, business-hours, ai-budget
│   │       ├── notifications.py        # User inbox: list, mark-read, preferences
│   │       ├── platform.py             # Platform-tier: tenants, analytics, audit-log, users
│   │       ├── virtual_agent.py        # Virtual agent: message, stream (SSE), session
│   │       ├── webhooks.py             # IAM webhook receiver
│   │       └── health.py
│   │
│   ├── services/                       # Business logic (no DB calls, only via repos)
│   │   ├── ticket_service.py
│   │   ├── asset_service.py
│   │   ├── kb_service.py
│   │   ├── notification_service.py
│   │   ├── storage_service.py          # S3 presigned URLs
│   │   └── ai/
│   │       ├── ai_service.py           # Central wrapper: token budget, retry, timeout, PII guard
│   │       ├── classifier.py           # Ticket auto-classification via Claude
│   │       ├── embedder.py             # Text → vector via embedding API
│   │       ├── duplicate_detector.py   # pgvector similarity search
│   │       ├── reply_suggester.py      # Agent response draft via Claude
│   │       ├── kb_drafter.py           # KB article generation from resolved ticket
│   │       ├── maintenance_predictor.py # Asset risk scoring via Claude
│   │       └── virtual_agent.py        # RAG chatbot (KB retrieval + Claude generation)
│   │
│   ├── repositories/                   # DB query layer
│   │   ├── base.py                     # Generic CRUD mixin
│   │   ├── ticket_repo.py
│   │   ├── asset_repo.py
│   │   └── kb_repo.py
│   │
│   └── workers/
│       ├── celery_app.py
│       ├── tasks_sla.py                # SLA breach detection (every 5min)
│       ├── tasks_notifications.py      # Email / WebSocket dispatch
│       ├── tasks_iam_sync.py           # User + org sync (every 15min)
│       ├── tasks_ai_ticket.py          # Classification + duplicate detection on ticket create
│       ├── tasks_ai_kb.py              # KB article drafting on ticket close + embedding refresh (nightly)
│       └── tasks_ai_assets.py          # Predictive maintenance scoring (nightly)
│
├── migrations/                         # Alembic
│   ├── env.py
│   └── versions/
│
├── tests/
│   ├── conftest.py                     # pytest fixtures (test DB, auth mocks)
│   ├── test_tickets.py
│   ├── test_assets.py
│   └── test_kb.py
│
├── docker/
│   ├── Dockerfile
│   ├── Dockerfile.worker
│   └── docker-compose.yml
│
├── pyproject.toml
├── alembic.ini
└── .env.example
```

---

## AI Agent Effort — Key Concepts

> All timelines below are expressed in **AI agent units**, not human developer time.
>
> | Unit | Definition | Human equivalent |
> |---|---|---|
> | **Session** | One focused Claude Code invocation. Produces 300–2,000 lines of working, tested code. | 1–2 developer days |
> | **Agent-Hour (ah)** | Normalized effort. Accounts for complexity, iteration, and test writing. | 8–12 human hours |
> | **Parallel track** | Two or more agents running simultaneously on independent modules. | N developers in parallel |
>
> **Baseline comparison**: A human team (3 senior engineers) would need ~17 weeks (~680 human-hours) for the same scope.
> AI agent total: **~43 agent-hours across 24 sessions ≈ 16× faster**.
> With 4 parallel agents after Phase 0: **wall-clock reduces to ~12 agent-hours**.

---

## Phase Plan (AI Agent Sessions)

### Phase 0 — Foundation
**3 sessions · 4.5 ah · Must complete before all other phases (serial)**

#### Session S0.1 — 1.5 ah: Project Scaffold + Infrastructure
> *Prompt scope: "Scaffold the full itsm-service project: pyproject.toml with all deps, .env.example, Dockerfile, docker-compose.yml (PostgreSQL 16 + pgvector extension, Redis 7, MinIO, API container with hot reload, Celery worker container). Write main.py (FastAPI app factory, CORS, global exception handlers, /api/v1 router mount). Write config.py (pydantic-settings typed config for DB, Redis, IAM, S3, AI keys). Write database.py (async SQLAlchemy engine, session factory, get_db dependency). Write redis_client.py (async Redis, get_redis dependency)."*

- [ ] `pyproject.toml`: FastAPI, SQLAlchemy, asyncpg, alembic, redis, celery, anthropic, openai, pgvector, python-jose, httpx, aiosmtplib, jinja2, jsonschema, prometheus-fastapi-instrumentator
- [ ] `main.py`: app factory, CORS, 400/401/403/404/422/500 exception handlers, versioned router
- [ ] `config.py`: all env vars typed and validated
- [ ] `database.py`: async engine, session factory, `get_db`
- [ ] `redis_client.py`: async Redis pool, `get_redis`
- [ ] `docker-compose.yml`: db (pgvector image), redis, minio, api, worker, worker-beat
- [ ] `docker/Dockerfile` + `docker/Dockerfile.worker`

#### Session S0.2 — 2 ah: Auth + Identity Models + Migration
> *Prompt scope: "Implement IAM JWT auth (OIDC Resource Server only — no login form, no password storage). auth/jwks.py: fetch IAM JWKS on startup, cache RS256 public keys, verify JWT. auth/dependencies.py: get_current_user (Silent Auth — JWT from Bearer header only), require_role() factory. auth/iam_client.py: async httpx IAM client. Use UUID v7 (python-uuid7 lib) for all PKs — never sequential integers. models/base.py: Base, TimestampMixin, TenantScopedMixin with uuid7 default. models/identity.py: all identity models. Seed ticket_status_transitions table in migration with all valid state paths per ticket type. Initial Alembic migration: identity tables + tenant_sequences + ticket_status_transitions seed + CREATE EXTENSION vector."*

- [ ] `auth/jwks.py`: JWKS fetch, in-memory cache, RS256 verify — no password handling
- [ ] `auth/dependencies.py`: `get_current_user` (JWT Bearer only), `require_role(...)` factory
- [ ] `auth/iam_client.py`: user + org sync client
- [ ] `models/base.py`: `Base`, `TimestampMixin`, `TenantScopedMixin` — UUID v7 as PK default
- [ ] `models/identity.py`: all 9 identity models
- [ ] `migrations/versions/0001_initial.py`: identity tables + `CREATE EXTENSION IF NOT EXISTS vector` + `ticket_status_transitions` seed data

#### Session S0.3 — 1.5 ah: IAM Webhook + Platform Middleware + Health + Logging + AI SDK Bootstrap
> *Prompt scope: "Write POST /api/v1/webhooks/iam (HMAC-SHA256 verify, handle org_provisioned → create tenant + seed defaults, product.unsubscribed → suspend tenant). Write platform middleware in auth/dependencies.py: if jwt.org_id == settings.PLATFORM_ORG_ID → resolve platform role (admin/support), require X-Tenant-ID header for non-platform endpoints (missing → 403), write platform_audit_log row (actor, tenant, method, endpoint, ip, request_id) on every cross-tenant request. require_platform_admin() and require_platform_support() dependency factories. Create system_logs SQLAlchemy model and migration (WARNING/ERROR/CRITICAL only — not INFO/DEBUG; dual-write handler that appends to this table alongside stdout). GET /health + GET /ready. tests/conftest.py: JWT factory for both platform users AND tenant users. ai_service.py skeleton."*

- [ ] `api/v1/webhooks.py`: IAM webhook with HMAC + provisioning + suspension
- [ ] `auth/dependencies.py`: platform user detection, `require_platform_admin()`, `require_platform_support()`, audit log write on every cross-tenant request
- [ ] `models/system_logs.py`: `SystemLog` model (WARNING/ERROR/CRITICAL, tenant_id nullable)
- [ ] `migrations/versions/0001b_system_logs.py`: system_logs table + indexes
- [ ] Custom Python log handler: `SystemLogHandler` — writes WARNING+ to DB, INFO/DEBUG stdout only
- [ ] `api/v1/health.py`: `/health` + `/ready`
- [ ] `tests/conftest.py`: JWT mock factory for platform_admin, platform_support, tenant_admin, agent, end_user
- [ ] `app/services/ai/ai_service.py`: clients, budget check, retry wrapper, PII masking stub

**Deliverable**: `docker-compose up` → starts clean, JWT auth resolves local user, tenant auto-provisioned via webhook, pgvector extension live, AI SDK wired.

---

### Phase 1 — Ticketing Core
**3 sessions · 5.5 ah · Can start after Phase 0**

#### Session S1.1 — 2 ah: Ticket Models + State Machine + Idempotency + CRUD
> *Prompt scope: "Write all ticket SQLAlchemy models using UUID v7 PKs. Include TicketStatusTransitions model (seeded). tickets table must include: idempotency_key (UNIQUE per tenant), sla_paused_at TIMESTAMPTZ, sla_paused_duration_sec INT. Alembic migration. Write ticket_repo.py: async CRUD, cursor-paginated list with FTS. Write ticket_service.py: create_ticket (check idempotency_key in Redis before insert — return cached 201 if duplicate; generate INC/REQ number via advisory lock), update_ticket (validate transition against ticket_status_transitions table — raise 409 if invalid; record history per field change), assign_ticket. Write api/v1/tickets.py: GET/POST /tickets (read Idempotency-Key header, pass to service), GET/PATCH/DELETE /tickets/{id}."*

- [ ] `models/ticket.py`: all ticket models + enums + UUID v7 PKs
- [ ] `models/ticket.py`: `ticket_status_transitions` model (seeded from migration)
- [ ] `migrations/versions/0002_tickets.py`: includes state machine seed rows for all types
- [ ] `repositories/ticket_repo.py`: CRUD + paginated filter/sort/FTS
- [ ] `services/ticket_service.py`: create (idempotency), update (state machine 409), assign
- [ ] `api/v1/tickets.py`: core CRUD + `Idempotency-Key` header handling

#### Session S1.2 — 1.5 ah: Comments, Attachments, Tags, Watchers
> *Prompt scope: "Add to ticketing: threaded comments (POST/GET with internal/public flag, PATCH with 5-min edit window, soft DELETE). storage_service.py generating S3 presigned upload + download URLs (boto3 async via aioboto3). POST /tickets/{id}/attachments returning presigned URL + persisting metadata. POST/DELETE /tickets/{id}/tags. POST/DELETE /tickets/{id}/watchers (auto-watcher on create/assign). GET /tickets/{id}/history."*

- [ ] `services/storage_service.py`: presigned upload/download URLs
- [ ] Comment endpoints: threaded, edit window, soft delete
- [ ] Attachment, tag, watcher endpoints
- [ ] History endpoint

#### Session S1.3 — 2.5 ah: SLA Engine + Notifications Inbox + Escalation + Bulk
> *Prompt scope: "Write sla_service.py: calculate sla_response_due and sla_resolve_due at ticket creation (business hours aware using tenant timezone + working_hours from business_hours_config table). CRITICAL: SLA pause implementation — on status→pending: set sla_paused_at=NOW(). On status→in_progress: compute elapsed_pause = NOW()-sla_paused_at, add to sla_paused_duration_sec, recalculate sla_response_due and sla_resolve_due by adding elapsed_pause, clear sla_paused_at. All time comparisons use DB server NOW(), never Python datetime. Write tasks_sla.py Celery beat (every 5min): WHERE sla_paused_at IS NULL AND (sla_response_due < NOW() OR sla_resolve_due < NOW()). Add Notifications + NotificationPreferences SQLAlchemy models + migration. Write notification_service.py: write to notifications table first, then dispatch Socket.IO push + email async (Celery). Write GET /api/v1/notifications, PATCH /api/v1/notifications/mark-read, GET/PATCH /api/v1/notifications/preferences. PATCH /tenant/business-hours. Jinja2 email templates. POST /tickets/{id}/escalate. POST /tickets/bulk."*

- [ ] `services/sla_service.py`: SLA calculation + pause/resume, business hours using `business_hours_config`
- [ ] `workers/tasks_sla.py`: Celery beat breach detection (excludes paused tickets)
- [ ] `models/notification.py`: `Notification` + `NotificationPreference` models
- [ ] `migrations/versions/0002b_notifications.py`
- [ ] `services/notification_service.py`: write to DB inbox first, then Socket.IO + email async
- [ ] `api/v1/notifications.py`: list, mark-read, preferences endpoints
- [ ] Jinja2 email templates (7 types: created, assigned, resolved, comment, SLA breach, KB published, mention)
- [ ] `api/v1/admin.py` addition: `GET/PATCH /tenant/business-hours`
- [ ] Escalation + bulk operation endpoints

**Deliverable**: Full ticket lifecycle open→closed, SLA tracked and breached alerts firing, email + in-app notifications live.

---

### Phase 1-AI — Ticket Intelligence
**2 sessions · 3.5 ah · Parallel with Phase 1 from S1.2 onwards**

#### Session S1-AI.1 — 2.5 ah: Embeddings + Duplicate Detection + Classification + AI Budget Tracking
> *Prompt scope: "Write embedder.py: async wrapper for OpenAI text-embedding-3-small, batch support, Redis cache (1h TTL per text hash). Alembic migration: add description_embedding VECTOR(1536) to tickets + HNSW index. Add ai_usage_daily SQLAlchemy model + migration. In ai_service.py: before every AI call, check per-tenant monthly budget from Redis counter (key: ai_budget:{tenant_id}:{month}); if 80% crossed → enqueue budget_warning notification; if 100% crossed → raise AIBudgetExhaustedError (HTTP 429, error code AI_BUDGET_EXHAUSTED — do NOT fail ticket creation, only skip AI enrichment). After every AI call: INCR Redis counter by token_count; Celery beat task (nightly): flush Redis counters to ai_usage_daily rows. Write tasks_ai_ticket.py: Celery task chain triggered on ticket create — (1) embed description → store, (2) duplicate_detector.py: pgvector cosine similarity search against same-tenant open tickets, store top candidates with score > 0.85 in ai_duplicate_candidates, (3) classifier.py: send title+description to Claude claude-sonnet-4-6 with structured output prompt, parse suggested category/priority/team/confidence, store in ai_ticket_classifications. Add ai_duplicate_candidates and ai_ticket_classifications SQLAlchemy models + migration. Wire GET /tenant/ai-budget and GET /tenant/ai-budget/history."*

- [ ] `services/ai/embedder.py`: OpenAI embeddings, Redis cache
- [ ] `services/ai/duplicate_detector.py`: pgvector cosine ANN search
- [ ] `services/ai/classifier.py`: Claude structured classification
- [ ] `models/ticket.py` additions: `ai_ticket_classifications`, `ai_duplicate_candidates`
- [ ] `models/ai_usage.py`: `AIUsageDaily` model
- [ ] `migrations/versions/0003_ticket_embeddings_ai.py`: embeddings + AI usage table
- [ ] `workers/tasks_ai_ticket.py`: Celery task chain
- [ ] `workers/tasks_ai_budget.py`: nightly Redis → `ai_usage_daily` flush
- [ ] `api/v1/admin.py` additions: `GET/PATCH /tenant/ai-budget`, `GET /tenant/ai-budget/history`

#### Session S1-AI.2 — 1.5 ah: Reply Suggestions + HITL Gold Dataset + AI Endpoints + Tests
> *Prompt scope: "Write reply_suggester.py: Claude draft reply from ticket context, stored in ai_response_suggestions. Wire all AI ticket endpoints. CRITICAL: POST /tickets/{id}/ai-classification/accept must store accepted_fields=['priority','category'] AND actual_priority/actual_category/actual_team as ground truth — this is the HITL gold dataset. POST reject must store actual values set by agent after rejection. Add GET /api/v1/ai/classification-dataset?format=jsonl (admin only): exports all records WHERE accepted IS NOT NULL as JSONL for fine-tuning. Tests: assert gold dataset record created on accept, actual values stored on reject, JSONL export correct schema."*

- [ ] `services/ai/reply_suggester.py`
- [ ] `models/ticket.py` additions: `ai_response_suggestions` + `actual_*` columns on `ai_ticket_classifications`
- [ ] All AI ticket endpoints including `/ai/classification-dataset` export
- [ ] `tests/test_ai_tickets.py`: HITL dataset assertions, mocked Claude + embedding

**Deliverable**: On ticket create, AI async chain runs — classification suggestion shown to agent, duplicates surfaced, reply draft available on demand.

---

### Phase 2 — Asset Management
**3 sessions · 4.5 ah · Parallel with Phase 1-AI**

#### Session S2.1 — 2 ah: Asset Models + CRUD + Types + Vendors
> *Prompt scope: "Write all asset SQLAlchemy models (Asset, AssetType, AssetCategory, AssetHistory, AssetMaintenance, AssetAttachment, Vendor + enums for status, condition, action, maintenance type). Alembic migration. Write asset_repo.py: CRUD + cursor-paginated list filtering by status/condition/type/category/department/vendor/purchase date range/warranty expiry + search on name/asset_tag/serial_number/model. Write asset_service.py: create_asset (generate AST-00001 via tenant_sequences), update_asset (record history on every field change). Write api/v1/assets.py: full CRUD, GET/POST /asset-types (with custom_fields_schema JSON Schema validation via jsonschema lib), GET/POST/PATCH/DELETE /vendors."*

- [ ] `models/asset.py`: all asset models + enums
- [ ] `migrations/versions/0004_assets.py`
- [ ] `repositories/asset_repo.py`
- [ ] `services/asset_service.py`: create, update with history
- [ ] `api/v1/assets.py`: CRUD + asset-types + vendors

#### Session S2.2 — 1.5 ah: Assignment + Maintenance + CMDB Relationships + Attachments
> *Prompt scope: "Add to asset management: assign/unassign with history. Status state machine (disposed is terminal; enforce via asset_status_transitions table seeded in S2.1 migration — same pattern as ticket_status_transitions; invalid transition → HTTP 409 INVALID_STATE_TRANSITION). POST/GET/PATCH /assets/{id}/maintenance with auto status change. CMDB relationships: POST /assets/{id}/relationships (source_asset_id, target_asset_id, relationship_type from enum). DELETE /assets/{id}/relationships/{id}. GET /assets/{id}/relationships (both directions). GET /assets/{id}/impact-analysis: traverse asset_relationships graph via recursive CTE (up to 3 hops), return affected assets + any open tickets linked to those assets — this powers 'Switch C going down affects INC-00045 and INC-00046'. Attachments endpoint. GET /assets/{id}/history."*

- [ ] Assign/unassign with 1:1 constraint + history
- [ ] Status state machine via `asset_status_transitions` seed — HTTP 409 on invalid transition
- [ ] `migrations/versions/0004b_asset_status_transitions.py`: seed all valid asset status paths
- [ ] Maintenance CRUD + auto status transitions
- [ ] CMDB relationships + impact analysis (recursive CTE, 3 hops)
- [ ] Attachments + history endpoints

#### Session S2.3 — 1 ah: Ticket Linking + Search + AI Predictive Maintenance
> *Prompt scope: "Add asset-ticket bidirectional linking (POST/DELETE /tickets/{id}/assets, GET /assets/{id}/tickets). Asset full-text + field search. Then: write maintenance_predictor.py — for each asset send type/age/purchase date/last maintenance date/condition/manufacturer to Claude, receive structured JSON {risk_score: float, reason: string}, store in ai_maintenance_predictions. Write tasks_ai_assets.py Celery beat (nightly 2am): iterate active assets in batches of 50, run predictor, fire in-app notification if risk_score > 0.7. Add GET /assets/{id}/ai-maintenance-prediction and POST /assets/{id}/ai-maintenance-prediction/acknowledge endpoints. Tests: mock Claude, assert prediction stored, notification queued on threshold breach."*

- [ ] Asset-ticket linking endpoints
- [ ] Asset search across name/tag/serial/model
- [ ] `services/ai/maintenance_predictor.py`
- [ ] `models/asset.py` addition: `ai_maintenance_predictions`
- [ ] `workers/tasks_ai_assets.py`: nightly beat
- [ ] AI maintenance endpoints + tests

**Deliverable**: Full asset lifecycle, assignment trail, maintenance log, nightly AI risk predictions alerting managers.

---

### Phase 3 — Knowledge Base
**2 sessions · 3.5 ah · Parallel with Phase 2**

#### Session S3.1 — 2 ah: KB Models + CRUD + FTS + Versioning
> *Prompt scope: "Write all KB SQLAlchemy models (KBSpace, KBCategory self-ref tree, KBArticle with TSVECTOR search_vector column + GIN index, KBArticleVersion, KBTag, KBArticleTagAssignment, KBArticleFeedback, KBArticleAttachment, TicketKbLink). Alembic migration. SQLAlchemy event listener to update search_vector on article insert/update. Write kb_repo.py: CRUD + FTS search via to_tsquery. Write api/v1/kb.py: GET/POST /kb/spaces, GET /kb/spaces/{slug} (no auth for public spaces), GET/POST/PATCH/DELETE /kb/articles, GET /kb/search. Article publish workflow: POST /kb/articles/{id}/publish creates KBArticleVersion snapshot. GET /kb/articles/{id}/versions + restore. POST /kb/articles/{id}/feedback."*

- [ ] `models/kb.py`: all KB models
- [ ] `migrations/versions/0005_kb.py`: tables + GIN index on search_vector
- [ ] SQLAlchemy event → update search_vector
- [ ] `repositories/kb_repo.py`: CRUD + FTS
- [ ] `api/v1/kb.py`: all endpoints including publish/version/restore/feedback

#### Session S3.2 — 1.5 ah: Semantic Search + KB Auto-Draft + Suggest
> *Prompt scope: "Add AI to KB: Alembic migration adding embedding VECTOR(1536) to kb_articles + HNSW index. Write tasks_ai_kb.py nightly beat: for articles modified in past 24h, generate embeddings via embedder.py and update kb_articles.embedding. Upgrade GET /kb/search to hybrid: compute FTS rank via ts_rank + pgvector cosine similarity, final_score = 0.4*fts + 0.6*semantic. Write kb_drafter.py: given resolved ticket, prompt Claude to write a KB article draft, store in ai_kb_article_drafts. Wire event: on ticket status → resolved/closed + tenant flag auto_draft_kb_on_close=true, enqueue kb draft task. GET /api/v1/ai/kb-drafts, POST .../accept (creates kb_articles record in draft status), POST .../reject. GET /api/v1/kb/suggest?q=...&limit=5 using pgvector only (< 300ms, no FTS). POST/DELETE /tickets/{id}/kb-links. Tests: hybrid ranking order, draft creation mocked."*

- [ ] `migrations/versions/0006_kb_embeddings.py`
- [ ] `workers/tasks_ai_kb.py`: nightly embedding refresh
- [ ] Hybrid search in `kb_repo.py`
- [ ] `services/ai/kb_drafter.py`
- [ ] `models/kb.py` addition: `ai_kb_article_drafts`
- [ ] KB draft + suggest + ticket-KB link endpoints + tests

**Deliverable**: Full KB with hybrid semantic search, auto-drafted articles from resolved tickets, inline suggest during ticket creation.

---

### Phase 4 — Admin, Hardening & Observability
**2 sessions · 4 ah · After Phase 1 complete**

#### Session S4.1 — 2 ah: Tenant Admin API + Platform API + IAM Sync
> *Prompt scope: "Write api/v1/admin.py (tenant-scoped): settings, departments, teams, SLA policies, roles, users, dashboard stats. Write api/v1/platform.py (platform-tier, require_platform_admin/support): GET /platform/tenants (list all with status, ticket count, last activity), GET /platform/tenants/{id} (detail + stats), PATCH /platform/tenants/{id}, POST /platform/tenants/{id}/suspend, POST /platform/tenants/{id}/unsuspend, DELETE /platform/tenants/{id} (platform_admin only, requires confirm=true query param), GET /platform/analytics (cross-tenant KPIs: total tenants, active, tickets today by tenant, SLA breach rates, AI token usage), GET /platform/audit-log (paginated, filter by tenant/actor/date), GET /platform/users?email=... (find user across all tenants). Write tasks_iam_sync.py Celery beat (every 15min)."*

- [ ] `api/v1/admin.py`: all tenant admin endpoints
- [ ] `api/v1/platform.py`: all platform endpoints, guarded by `require_platform_admin/support`
- [ ] `workers/tasks_iam_sync.py`: periodic user sync
- [ ] Dashboard stats + cross-tenant analytics aggregation queries

#### Session S4.2 — 2 ah: Middleware + Observability + Security + Tests
> *Prompt scope: "Add production hardening: Redis sliding-window rate limiter middleware (1000 req/min/user, 10000 req/min/tenant, 429 + Retry-After). Structured JSON logging middleware (request_id, tenant_id, user_id, method, path, status, latency_ms). OpenTelemetry setup: instrument FastAPI + SQLAlchemy + httpx + Redis. CRITICAL: propagate tenant_id as OTel baggage attribute on every span so Jaeger/Grafana Tempo traces can be filtered per tenant to isolate one customer's slow query. Wire prometheus-fastapi-instrumentator /metrics. Add GitHub Actions CI pipeline: lint (ruff), type-check (mypy), pytest, Trivy vulnerability scan on Docker image, Syft SBOM generation (CycloneDX JSON) — fail build on CRITICAL CVEs. Full pytest suite: unit + integration tests."*

- [ ] Rate limiting middleware (Redis sliding window)
- [ ] Structured JSON logging middleware
- [ ] OpenTelemetry with `tenant_id` baggage on every span
- [ ] Prometheus `/metrics`
- [ ] `.github/workflows/ci.yml`: lint → typecheck → test → Trivy scan → Syft SBOM
- [ ] `tests/test_tickets.py`, `tests/test_assets.py`, `tests/test_kb.py`, `tests/test_admin.py`
- [ ] OpenAPI polished (examples, summaries, tags)

**Deliverable**: Production-grade, observable service. All admin ops via API. Rate limited. Full test coverage.

---

### Phase 4B — Virtual Agent (RAG Chatbot)
**2 sessions · 3.5 ah · Parallel with Phase 4**

#### Session S4B.1 — 2 ah: RAG Engine + Intent Detection + Session Management
> *Prompt scope: "Write virtual_agent.py: (1) embed user message via embedder.py, (2) pgvector top-k=5 search over kb_articles for current tenant's spaces, (3) build Claude prompt: system role as ITSM virtual agent + retrieved KB articles as context + last 10 messages from conversation history. Claude detects intent: answer/create_ticket/check_status/escalate. Intent handlers — answer: return Claude's grounded response; create_ticket: multi-turn structured data collection → ticket_service.create_ticket(); check_status: query user's last 10 tickets return status summary; escalate: create ticket + notify on-call team via notification_service. Add VirtualAgentSession SQLAlchemy model + migration (tracks status: active/ended/escalated/timed_out, channel, escalated_to_ticket_id). Store conversation history in Redis list (24h TTL) keyed by session_id; on session end, persist messages to virtual_agent_messages. POST /api/v1/virtual-agent/message, GET /api/v1/virtual-agent/session/{id}."*

- [ ] `services/ai/virtual_agent.py`: RAG + intent detection + handlers
- [ ] `models/virtual_agent.py`: `VirtualAgentSession` model
- [ ] `migrations/versions/0007_virtual_agent_sessions.py`
- [ ] Redis session management (history list, 24h TTL)
- [ ] Virtual agent API endpoints

#### Session S4B.2 — 1.5 ah: SSE Streaming + Socket.IO + Config + PII + Tests
> *Prompt scope: "Add SSE streaming endpoint: GET /api/v1/virtual-agent/stream?session_id=...&text=... using FastAPI StreamingResponse with media_type='text/event-stream'. Stream Claude tokens as 'data: {token}\n\n' SSE format; send 'data: [DONE]\n\n' on finish. Also wire Socket.IO: emit('agent_token') per chunk, emit('agent_done') on finish — both paths share the same virtual_agent generator. Remove any login_form references — JWT passed in socket handshake auth metadata only. Add per-tenant config. PII guard (regex emails/phones/credit cards → [REDACTED] before LLM). Tests: assert SSE response streams correctly, Socket.IO emits in order, PII masked, no plain-text password or credential ever logged."*

- [ ] SSE streaming endpoint (`StreamingResponse`, `text/event-stream`)
- [ ] Socket.IO streaming (reuses same async generator)
- [ ] No `login_form` — JWT from socket handshake only
- [ ] Tenant virtual agent config support
- [ ] PII masking in `ai_service.py`
- [ ] `tests/test_virtual_agent.py`: SSE stream, all intent paths, PII masking

**Deliverable**: Users can chat in natural language — get KB-grounded answers, raise tickets, check status. Streams in real-time via Socket.IO.

---

### Phase 5 — Frontend
**5 sessions · 10.5 ah · Fully parallel after Phase 0**

#### Session S5.1 — 2 ah: Scaffold + Auth + Layout
> *React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui. IAM OAuth2 PKCE flow. API client with JWT interceptor + auto-refresh. App shell: sidebar nav, notification bell, auth guard HOC.*

#### Session S5.2 — 2.5 ah: Ticket UI (List + Detail + Create)
> *Ticket list with filters/sort/search (FTS), kanban board view. Ticket detail: comments (threaded, internal badge), attachments, watchers, history timeline. AI banner: classification suggestion (Accept/Reject per field), duplicate warning chips. Create form with live KB suggest panel.*

#### Session S5.3 — 2 ah: Asset UI
> *Asset list with filter/sort/search. Asset detail: info, assignment history, maintenance timeline, linked tickets. Create/edit with dynamic custom field form (rendered from asset_type.custom_fields_schema). AI risk badge on asset card.*

#### Session S5.4 — 2 ah: KB UI
> *KB space browser, category tree nav, article reader (Markdown rendered, feedback thumbs). Article editor: Markdown + live preview, publish/archive workflow, version history diff view. Hybrid search results page.*

#### Session S5.5 — 2 ah: Notifications + AI Surfaces + Virtual Agent Widget
> *Socket.IO client — real-time notification bell + toast pop-ups. AI reply suggestion in comment editor ("AI Draft" button). Virtual agent chat widget (bottom-right corner, streaming tokens, ticket creation flow). Admin settings page: AI feature toggles, KB draft review queue.*

**Deliverable**: Full web UI with all AI features surfaced. Real-time. Mobile screens via Expo (existing infra adapted).

---

---

---

---

### Phase 6 — Post-MVP Features
**Roadmap — not included in ~43 ah estimate above**

#### Phase 6A — Enhanced Automation (2–3 ah)
- **Auto-assignment rules**: category → team mapping, round-robin within team
- **Saved filters**: per-user saved search filters for ticket/asset lists
- **Bulk export**: CSV/Excel export for tickets and assets
- **Recurring maintenance schedules**: `asset_maintenance` cron flag

#### Phase 6B — Webhooks & Integrations (2 ah)
- **Outbound webhooks**: tenant-configurable per-event webhooks; HMAC-SHA256 signed payloads; retry with exponential backoff on delivery failure
- **Email-to-ticket ingest**: SMTP/IMAP poller → auto-create tickets from inbound email
- **Slack / MS Teams notifications**: per-tenant channel config; critical tickets pinged to ops channel

#### Phase 6C — Reporting & Analytics (2–3 ah)
- **Ticket reports**: volume by category/team, resolution time distributions, SLA compliance %, agent performance
- **Asset reports**: asset value by category, warranty expiry calendar, cost-of-maintenance trending
- **AI analytics dashboard**: token usage by feature, classification accuracy, KB suggestion click-through, duplicate detection precision
- **Scheduled reports**: weekly email digest, configurable by tenant admin

#### Phase 6D — GDPR & Compliance (2 ah)
- `GET /api/v1/tenant/users/{id}/export` — full data export (tickets, comments, history) as JSON/ZIP
- `POST /api/v1/tenant/users/{id}/anonymise` — replace PII fields with `[REDACTED]` in tickets/comments; irreversible
- `DELETE /api/v1/platform/tenants/{id}` — full tenant hard-delete with async Celery task (already in plan); confirm via `?confirm=TENANT_NAME` body param to prevent accidental deletion
- Tenant data retention policy: configurable per-tenant `data_retention_days`; expired soft-deleted records purged by nightly Celery task

---

## AI-Specific Environment Variables

```env
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-6
CLAUDE_MAX_TOKENS=2048
CLAUDE_TIMEOUT_SECONDS=30

# OpenAI (Embeddings)
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# AI Cost Controls
AI_DEFAULT_MONTHLY_TOKEN_BUDGET=5000000   # 5M tokens per tenant per month
AI_MAINTENANCE_BATCH_SIZE=50              # assets per nightly prediction batch
AI_DUPLICATE_THRESHOLD=0.85              # cosine similarity threshold

# Feature Flags (can be overridden per tenant in DB)
AI_AUTO_CLASSIFY=true
AI_DUPLICATE_DETECTION=true
AI_REPLY_SUGGESTIONS=true
AI_KB_DRAFT_ON_CLOSE=false
AI_MAINTENANCE_PREDICTION=true
AI_VIRTUAL_AGENT=true
```

---

## Environment Variables

```env
# App
APP_ENV=development
SECRET_KEY=<random-32-bytes>
ALLOWED_ORIGINS=http://localhost:3000

# Database
# Dev:  points to local Docker container (itsm_db on its own postgres container)
# Prod: points to shared Project-IQ PostgreSQL server — separate itsm_db database
#       e.g. postgresql+asyncpg://itsm_user:xxx@shared-pg-host:5432/itsm_db
DATABASE_URL=postgresql+asyncpg://itsm_user:itsm_pass@localhost:5432/itsm_db
DB_POOL_SIZE=20
DB_MAX_OVERFLOW=10
DB_POOL_TIMEOUT=30
DB_STATEMENT_TIMEOUT_SECONDS=30    # SET LOCAL statement_timeout on every session

# Redis
REDIS_URL=redis://localhost:6379/0

# IAM
IAM_BASE_URL=https://api.dev.iam.99technologies.com
IAM_CLIENT_ID=<itsm-app-client-id>
IAM_CLIENT_SECRET=<itsm-app-client-secret>
IAM_JWKS_URL=https://api.dev.iam.99technologies.com/.well-known/jwks.json
IAM_WEBHOOK_SECRET=<hmac-secret>
PLATFORM_ORG_ID=org_99technologies_...  # 99T IAM org id — users from this org bypass product check

# Storage (S3-compatible)
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_BUCKET=itsm-files
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
STORAGE_PRESIGN_EXPIRY_SECONDS=3600

# Email
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASS=<password>
EMAIL_FROM_NAME=ITSM Support

# Celery
CELERY_BROKER_URL=redis://localhost:6379/1
CELERY_RESULT_BACKEND=redis://localhost:6379/2
```

---

## Docker Compose (dev)

> **Dev vs Prod database note**:
> - **Local dev**: Docker Compose spins up its own dedicated PostgreSQL container with `itsm_db`. Fully self-contained, no dependency on Project-IQ running locally.
> - **Production/Staging**: `DATABASE_URL` points to the shared Project-IQ PostgreSQL server. The `db` container below is **not deployed** — just swap the env var.

```yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    env_file: .env
    depends_on: [db, redis]
    volumes: ["./app:/app/app"]   # hot reload

  worker:
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
    env_file: .env
    depends_on: [db, redis]

  worker-beat:
    build:
      context: .
      dockerfile: docker/Dockerfile.worker
    command: celery -A app.workers.celery_app beat --loglevel=info
    env_file: .env
    depends_on: [redis]

  db:
    # DEV ONLY — not deployed in prod (uses shared Project-IQ PG server instead)
    image: pgvector/pgvector:pg16   # official pgvector image — includes extension
    environment:
      POSTGRES_USER: itsm_user
      POSTGRES_PASSWORD: itsm_pass
      POSTGRES_DB: itsm_db
    volumes: ["pg_data:/var/lib/postgresql/data"]
    ports: ["5433:5432"]            # 5433 to avoid clash with Project-IQ on 5432

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio_data:/data"]

volumes:
  pg_data:
  minio_data:
```

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Multi-tenancy model | Row-level (tenant_id) + RLS | Simpler ops vs schema-per-tenant; RLS as safety net |
| Async framework | FastAPI + asyncpg | Matches Python ecosystem, high concurrency, auto-docs |
| Ticket number gen | tenant_sequences table with advisory lock | No UUID gaps, human-readable, per-prefix counters |
| File uploads | Presigned S3 URLs | Client uploads directly; API never proxies binary data |
| Search | Hybrid FTS + pgvector | Keyword precision + semantic recall; no extra infra |
| Real-time | Socket.IO | Consistent with existing Project-IQ architecture |
| KB versioning | Snapshot on publish | Simple, auditable; avoids diff complexity |
| IAM sync | Pull on login + periodic job | Not fully event-driven; acceptable eventual consistency |
| LLM | Claude (`claude-sonnet-4-6`) | Anthropic API, proven in Project-IQ, strong reasoning |
| Embeddings | OpenAI `text-embedding-3-small` | 1536-dim, cost-efficient, industry standard |
| AI execution | Celery async tasks only | LLM latency never blocks API responses |
| AI guardrail | Per-tenant token budget in Redis | Prevents runaway cost; per-tenant fairness |
| Virtual agent | RAG (pgvector + Claude) | Grounded in tenant KB; no hallucinated answers |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| IAM downtime blocks logins | Cache validated JWT claims in Redis (5-min TTL); stale-JWT grace period |
| RLS bypass via raw query | All DB access through SQLAlchemy ORM; no raw SQL strings in app code |
| SLA clock drift | Use DB server `NOW()` everywhere; no application-side time in SLA calcs |
| Large attachment uploads blocking | Presigned URLs offload to storage; API only stores metadata |
| Celery task backlog | Separate queues: `high` (notifications), `low` (sync, reports); scale workers independently |

---

## Milestones Summary (AI Agent Time)

| Milestone | Sessions | Agent-Hours | Parallel? | Output |
|---|:---:|:---:|:---:|---|
| M0: Foundation | 3 | 5 ah | Serial (blocks all) | Auth, tenant provisioning, pgvector, AI SDK, system_logs |
| M1: Ticketing | 3 | 6 ah | After M0 | Full ticket lifecycle, SLA, notifications inbox |
| M1-AI: Ticket Intelligence | 2 | 4 ah | Parallel with M1 | Classification, duplicates, reply suggestions, AI budget |
| M2: Assets | 3 | 4.5 ah | Parallel with M1-AI | Full asset lifecycle + ticket linking |
| M2-AI: Maintenance Prediction | — | — | Included in M2.S2.3 | Nightly risk scoring, alerts |
| M3: KB | 2 | 3.5 ah | Parallel with M2 | KB spaces, versioning, FTS, ticket links |
| M3-AI: Semantic KB + Auto-Draft | — | — | Included in M3.S3.2 | Hybrid search, KB drafts from tickets |
| M4: Admin + Hardening | 2 | 4 ah | After M1 | Production-grade, observable, fully tested |
| M4-AI: Virtual Agent | 2 | 3.5 ah | Parallel with M4 | RAG chatbot, ticket creation via chat |
| M5: Frontend | 5 | 10.5 ah | Parallel after M0 | Web UI, all AI features surfaced |
| **TOTAL** | **24** | **~46 ah** | | **Full production ITSM service** |

### Sequential critical path (single agent):
```
M0 (4.5 ah) → M1 (5.5 ah) → M1-AI (3.5 ah) → M2 (4.5 ah) → M3 (3.5 ah) → M4 (4 ah) → M4-AI (3.5 ah) → M5 (10.5 ah)
Total: ~39.5 agent-hours end-to-end
```

### Parallel path (4 agents, after M0):
```
Agent 1: M1 → M4 → M4-AI
Agent 2: M1-AI → M2
Agent 3: M3 → M3-AI
Agent 4: M5 (frontend, full parallel)
Wall-clock: M0 (4.5 ah) + longest parallel track (~13 ah) ≈ ~17.5 ah total
```

**Human team equivalent**: 3 senior engineers × 17 weeks = ~680 human-hours.
**AI agent speedup**: ~16× (serial) → ~40× (4 parallel agents).
