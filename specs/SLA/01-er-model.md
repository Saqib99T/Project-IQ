# ITSM Service — Entity Relationship Model

## Engineering Standards Applied

| Decision | Standard | Rationale |
|---|---|---|
| **UUID v7 for all PKs** | Sortable, time-prefixed UUIDs (RFC 9562) | Prevents ID enumeration attacks; maintains index locality vs UUID v4 random scatter |
| **No passwords in ITSM** | Pure OIDC Resource Server | ITSM validates JWTs from IAM — never stores or handles credentials |
| **State machine for tickets** | Explicit transition table | Invalid state jumps rejected at DB + service layer, not just enum check |
| **Idempotency keys** | RFC 7231 / Stripe pattern | Client sends `Idempotency-Key` header; duplicate POSTs return cached response |
| **SLA paused_at tracking** | PENDING status pauses clock | Prevents unfair breaches when waiting on user/3rd party |
| **Asset relationship graph** | Many-to-many with type | Enables CMDB impact analysis: "Switch C down → affects these tickets" |
| **HITL gold dataset** | Accept/Reject classifications stored | Used to fine-tune cheaper model, replacing Claude for simple classification |
| **OpenTelemetry + tenant_id** | Distributed tracing with tenant context | Filter traces per tenant to isolate performance regressions |
| **SBOM + Trivy in CI/CD** | Supply chain security | ITSM holds employee PII + infrastructure secrets — high-value target |

---

## IAM Integration Mapping

| IAM Concept | ITSM Concept | Notes |
|---|---|---|
| Organization | Tenant | Top-level isolation boundary |
| User (idpSub) | User (local mirror) | Synced on login via JWT claim — no password ever stored |
| Facility | Department | Optional link via `iam_facility_id` |
| Application Role | ITSM Role | ITSM registers as IAM Application |
| Application Feature | Module flags | KB, Assets enabled per tenant |

---

## Entity Groups

### 1. Identity & Access

```
tenants
├── id              UUID PK
├── iam_org_id      VARCHAR UNIQUE  ← IAM Organization.id
├── name            VARCHAR
├── slug            VARCHAR UNIQUE  ← URL routing
├── is_active       BOOLEAN
├── settings        JSONB           ← per-tenant config (timezone, locale, branding)
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

products
├── id              UUID PK
├── tenant_id       FK tenants
├── name            VARCHAR
├── slug            VARCHAR
├── description     TEXT
├── is_active       BOOLEAN
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
UNIQUE (tenant_id, slug)

departments
├── id              UUID PK
├── tenant_id       FK tenants
├── iam_facility_id VARCHAR NULLABLE ← IAM Facility.id
├── name            VARCHAR
├── description     TEXT
├── parent_id       FK departments SELF NULLABLE  ← hierarchy
├── is_active       BOOLEAN
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

users  (local mirror of IAM User)
├── id              UUID PK
├── iam_user_id     VARCHAR UNIQUE  ← IAM User.idpSub
├── tenant_id       FK tenants
├── email           VARCHAR
├── first_name      VARCHAR
├── last_name       VARCHAR
├── avatar_url      VARCHAR NULLABLE
├── is_active       BOOLEAN
├── metadata        JSONB
├── last_seen_at    TIMESTAMPTZ
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

user_department_assignments
├── user_id         FK users
├── department_id   FK departments
├── is_primary      BOOLEAN DEFAULT false
└── assigned_at     TIMESTAMPTZ
PK (user_id, department_id)

itsm_roles
├── id              UUID PK
├── tenant_id       FK tenants NULLABLE  ← NULL = system-wide default role
├── name            VARCHAR  (end_user, agent, team_lead, manager, admin)
├── permissions     JSONB    ← granular permission flags
├── is_system       BOOLEAN  ← system defaults cannot be deleted
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

user_itsm_roles
├── user_id         FK users
├── role_id         FK itsm_roles
├── tenant_id       FK tenants  ← denormalized for query performance
├── assigned_at     TIMESTAMPTZ
└── assigned_by     FK users NULLABLE
PK (user_id, role_id)

teams
├── id              UUID PK
├── tenant_id       FK tenants
├── name            VARCHAR
├── description     TEXT
├── lead_id         FK users NULLABLE
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

team_members
├── team_id         FK teams
├── user_id         FK users
└── joined_at       TIMESTAMPTZ
PK (team_id, user_id)
```

---

### 2. Ticketing System

```
business_hours_config  (per-tenant working hours for SLA calculations)
├── id              UUID v7 PK
├── tenant_id       FK tenants UNIQUE  ← one config per tenant
├── timezone        VARCHAR            ← e.g. "Asia/Karachi", "Europe/London"
├── work_days       INT[]              ← e.g. [1,2,3,4,5] = Mon–Fri (ISO weekday)
├── work_start_time TIME               ← e.g. 09:00
├── work_end_time   TIME               ← e.g. 18:00
├── holidays        DATE[]             ← explicit non-working dates (local public holidays)
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
-- SLA engine reads this at ticket creation; all time math done in DB server timezone

sla_policies
├── id                      UUID v7 PK
├── tenant_id               FK tenants
├── name                    VARCHAR
├── response_time_minutes   INT
├── resolution_time_minutes INT
├── business_hours_only     BOOLEAN DEFAULT true  ← uses business_hours_config if true
├── created_at              TIMESTAMPTZ
└── updated_at              TIMESTAMPTZ

ticket_categories
├── id                    UUID v7 PK
├── tenant_id             FK tenants
├── product_id            FK products NULLABLE
├── name                  VARCHAR
├── description           TEXT
├── parent_id             FK ticket_categories SELF NULLABLE
├── default_sla_policy_id FK sla_policies NULLABLE  ← auto-applied on ticket create
├── default_team_id       FK teams NULLABLE          ← auto-assign team on ticket create
├── is_active             BOOLEAN
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ

ticket_status_transitions  (state machine definition — seeded, immutable)
├── from_status     ENUM
├── to_status       ENUM
├── ticket_type     ENUM NULLABLE  ← NULL = applies to all types
└── PK (from_status, to_status, ticket_type)
-- Seed rows for change type include: open→pending_approval, pending_approval→approved,
--   pending_approval→rejected, approved→in_progress, rejected→cancelled
-- All other types use: open→in_progress, in_progress→pending, pending→in_progress,
--   in_progress→resolved, resolved→closed, any→cancelled

tickets
├── id                      UUID v7 PK  ← sortable, prevents ID enumeration
├── idempotency_key         VARCHAR NULLABLE
│                           -- DB: UNIQUE (tenant_id, idempotency_key) — permanent dedup guard
│                           -- Redis: 24h TTL cache for fast lookup; DB is the truth after cache miss
├── ticket_number           VARCHAR     ← INC-00001, REQ-00001 per tenant
├── tenant_id               FK tenants
├── product_id              FK products NULLABLE
├── department_id           FK departments NULLABLE
├── type                    ENUM (incident, service_request, problem, change)
├── status                  ENUM (open, in_progress, pending, pending_approval, approved,
│                                  rejected, resolved, closed, cancelled)
│                           -- pending_approval / approved / rejected used by change type only
├── priority                ENUM (critical, high, medium, low)
├── title                   VARCHAR
├── description             TEXT
├── requester_id            FK users
├── assignee_id             FK users NULLABLE
├── team_id                 FK teams NULLABLE
├── category_id             FK ticket_categories NULLABLE
├── sla_policy_id           FK sla_policies NULLABLE
├── sla_response_due        TIMESTAMPTZ NULLABLE
├── sla_resolve_due         TIMESTAMPTZ NULLABLE
├── sla_breached            BOOLEAN DEFAULT false
├── sla_paused_at           TIMESTAMPTZ NULLABLE  ← set when status→pending; clock stops here
├── sla_paused_duration_sec INT DEFAULT 0          ← accumulated pause time; added back to due times on resume
├── parent_ticket_id        FK tickets SELF NULLABLE  ← sub-tickets
├── due_date                TIMESTAMPTZ NULLABLE
├── resolved_at             TIMESTAMPTZ NULLABLE
├── closed_at               TIMESTAMPTZ NULLABLE
├── description_embedding   VECTOR(1536) NULLABLE  ← for duplicate detection
├── metadata                JSONB
├── created_at              TIMESTAMPTZ
└── updated_at              TIMESTAMPTZ
INDEX (tenant_id, status, priority)
INDEX (tenant_id, assignee_id)
INDEX (tenant_id, requester_id)
UNIQUE (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
INDEX USING hnsw (description_embedding vector_cosine_ops)

ticket_comments
├── id                  UUID PK
├── ticket_id           FK tickets
├── author_id           FK users
├── body                TEXT
├── is_internal         BOOLEAN DEFAULT false  ← private agent note vs public
├── parent_comment_id   FK ticket_comments SELF NULLABLE
├── created_at          TIMESTAMPTZ
├── updated_at          TIMESTAMPTZ
└── deleted_at          TIMESTAMPTZ NULLABLE

ticket_attachments
├── id              UUID PK
├── ticket_id       FK tickets
├── comment_id      FK ticket_comments NULLABLE
├── uploaded_by     FK users
├── filename        VARCHAR
├── storage_url     VARCHAR
├── file_size       BIGINT
├── mime_type       VARCHAR
└── created_at      TIMESTAMPTZ

ticket_tags
├── id          UUID PK
├── tenant_id   FK tenants
├── name        VARCHAR
└── color       VARCHAR  ← hex color

ticket_tag_assignments
├── ticket_id   FK tickets
├── tag_id      FK ticket_tags
└── assigned_at TIMESTAMPTZ
PK (ticket_id, tag_id)

ticket_watchers
├── ticket_id   FK tickets
├── user_id     FK users
└── added_at    TIMESTAMPTZ
PK (ticket_id, user_id)

ticket_history  (IMMUTABLE — INSERT only, no UPDATE or DELETE, ever)
├── id              UUID v7 PK
├── ticket_id       FK tickets
├── actor_id        FK users NULLABLE  ← NULL = system action (e.g. SLA breach auto-flag)
├── field_changed   VARCHAR            ← e.g. "status", "assignee_id", "priority"
├── old_value       JSONB
├── new_value       JSONB
└── changed_at      TIMESTAMPTZ        ← DB server NOW(), never application time
INDEX (ticket_id, changed_at)
-- Enforced via: REVOKE UPDATE, DELETE ON ticket_history FROM itsm_user;
-- PG trigger raises exception on any attempt to update or delete a row

ticket_escalations
├── id              UUID v7 PK
├── ticket_id       FK tickets
├── escalated_by    FK users
├── escalated_to    FK users NULLABLE
├── reason          TEXT
└── escalated_at    TIMESTAMPTZ
```

---

### 3. Asset Management

```
asset_categories
├── id              UUID PK
├── tenant_id       FK tenants
├── name            VARCHAR
├── description     TEXT
├── parent_id       FK asset_categories SELF NULLABLE
├── icon            VARCHAR NULLABLE  ← icon name / URL
└── is_active       BOOLEAN

asset_types
├── id                      UUID PK
├── tenant_id               FK tenants
├── category_id             FK asset_categories
├── name                    VARCHAR
├── custom_fields_schema    JSONB  ← JSON Schema defining dynamic form fields
├── created_at              TIMESTAMPTZ
└── updated_at              TIMESTAMPTZ

vendors
├── id              UUID PK
├── tenant_id       FK tenants
├── name            VARCHAR
├── contact_email   VARCHAR NULLABLE
├── contact_phone   VARCHAR NULLABLE
├── website         VARCHAR NULLABLE
├── address         JSONB NULLABLE
├── is_active       BOOLEAN
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

assets
├── id                      UUID PK
├── asset_tag               VARCHAR      ← AST-0001, unique per tenant
├── tenant_id               FK tenants
├── product_id              FK products NULLABLE
├── department_id           FK departments NULLABLE
├── type_id                 FK asset_types
├── name                    VARCHAR
├── description             TEXT NULLABLE
├── status                  ENUM (in_stock, in_use, in_maintenance, retired, disposed, lost)
├── condition               ENUM (new, good, fair, poor)
├── serial_number           VARCHAR NULLABLE
├── model_number            VARCHAR NULLABLE
├── manufacturer            VARCHAR NULLABLE
├── vendor_id               FK vendors NULLABLE
├── purchase_date           DATE NULLABLE
├── purchase_cost           DECIMAL(12,2) NULLABLE
├── warranty_expiry_date    DATE NULLABLE
├── assigned_to             FK users NULLABLE
├── assigned_at             TIMESTAMPTZ NULLABLE
├── location                VARCHAR NULLABLE    ← free-text physical location
├── location_dept_id        FK departments NULLABLE
├── custom_fields           JSONB     ← matches asset_types.custom_fields_schema
├── metadata                JSONB
├── created_at              TIMESTAMPTZ
├── updated_at              TIMESTAMPTZ
└── deleted_at              TIMESTAMPTZ NULLABLE  ← soft delete
INDEX (tenant_id, status)
INDEX (tenant_id, assigned_to)
INDEX (tenant_id, type_id)

asset_relationships  (CMDB relationship graph — enables impact analysis)
├── id                  UUID v7 PK
├── tenant_id           FK tenants
├── source_asset_id     FK assets
├── target_asset_id     FK assets
├── relationship_type   ENUM (runs_on, connected_to, depends_on, hosts, part_of, backs_up)
├── description         VARCHAR NULLABLE
├── created_by          FK users
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
UNIQUE (source_asset_id, target_asset_id, relationship_type)
INDEX (tenant_id, source_asset_id)
INDEX (tenant_id, target_asset_id)
-- Used by AI impact analysis: "Asset X is down → traverse graph → list affected assets → match open tickets"

asset_history
├── id              UUID v7 PK
├── asset_id        FK assets
├── actor_id        FK users
├── action          ENUM (created, updated, assigned, unassigned, status_changed, disposed, maintenance_scheduled, relationship_added, relationship_removed)
├── field_changed   VARCHAR NULLABLE
├── old_value       JSONB NULLABLE
├── new_value       JSONB NULLABLE
├── notes           TEXT NULLABLE
└── changed_at      TIMESTAMPTZ

asset_maintenance
├── id              UUID PK
├── asset_id        FK assets
├── type            ENUM (scheduled, reactive, preventive)
├── status          ENUM (scheduled, in_progress, completed, cancelled)
├── title           VARCHAR
├── description     TEXT NULLABLE
├── scheduled_date  DATE
├── completed_date  DATE NULLABLE
├── cost            DECIMAL(12,2) NULLABLE
├── performed_by    FK users NULLABLE
├── vendor_id       FK vendors NULLABLE
├── notes           TEXT NULLABLE
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

asset_attachments
├── id              UUID PK
├── asset_id        FK assets
├── uploaded_by     FK users
├── filename        VARCHAR
├── storage_url     VARCHAR
├── file_size       BIGINT
├── mime_type       VARCHAR
├── label           VARCHAR NULLABLE  ← invoice, photo, manual, warranty
└── created_at      TIMESTAMPTZ

asset_ticket_links
├── asset_id        FK assets
├── ticket_id       FK tickets
├── linked_by       FK users
└── linked_at       TIMESTAMPTZ
PK (asset_id, ticket_id)
```

---

### 4. Knowledge Base

> **Isolation rule**: `tenant_id` is NEVER NULL on any KB entity.
> "Global" public documentation (e.g. a vendor's public knowledge base) lives in a
> dedicated system tenant (`is_system = true`) — never mixed with tenant rows.
> This prevents cross-tenant leakage of internal procedures through shared KB spaces.

```
kb_spaces
├── id              UUID v7 PK
├── tenant_id       FK tenants NOT NULL  ← MANDATORY — no global/shared spaces in tenant schema
├── product_id      FK products NULLABLE  ← NULL = tenant-wide; NOT NULL = product-scoped
├── name            VARCHAR
├── description     TEXT NULLABLE
├── slug            VARCHAR
├── scope           ENUM (tenant_wide, product_specific)  ← explicit, not inferred from product_id nullability
├── is_public       BOOLEAN DEFAULT false  ← accessible without login (honoured only if scope=product_specific)
├── is_active       BOOLEAN
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
UNIQUE (tenant_id, slug)
-- RLS policy: USING (tenant_id = current_setting('app.tenant_id')::uuid) — no exceptions

kb_categories
├── id              UUID PK
├── space_id        FK kb_spaces
├── name            VARCHAR
├── description     TEXT NULLABLE
├── parent_id       FK kb_categories SELF NULLABLE
├── display_order   INT DEFAULT 0
├── is_active       BOOLEAN
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

kb_articles
├── id                  UUID PK
├── tenant_id           FK tenants
├── space_id            FK kb_spaces
├── category_id         FK kb_categories NULLABLE
├── title               VARCHAR
├── slug                VARCHAR
├── body                TEXT   ← Markdown
├── excerpt             TEXT NULLABLE
├── status              ENUM (draft, under_review, published, archived)
├── visibility          ENUM (public, internal, agents_only)
├── author_id           FK users
├── last_edited_by      FK users NULLABLE
├── version             INT DEFAULT 1
├── view_count          INT DEFAULT 0
├── helpful_count       INT DEFAULT 0
├── not_helpful_count   INT DEFAULT 0
├── published_at        TIMESTAMPTZ NULLABLE
├── search_vector       TSVECTOR         ← PostgreSQL full-text search
├── embedding           VECTOR(1536) NULLABLE  ← text-embedding-3-small; hybrid search = 0.4×FTS + 0.6×cosine
├── metadata            JSONB
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
UNIQUE (space_id, slug)
INDEX GIN (search_vector)
INDEX USING hnsw (embedding vector_cosine_ops)

kb_article_versions
├── id              UUID PK
├── article_id      FK kb_articles
├── version_number  INT
├── title           VARCHAR
├── body            TEXT
├── changed_by      FK users
├── change_summary  VARCHAR NULLABLE
└── created_at      TIMESTAMPTZ

kb_tags
├── id          UUID PK
├── tenant_id   FK tenants
├── name        VARCHAR
UNIQUE (tenant_id, name)

kb_article_tag_assignments
├── article_id  FK kb_articles
└── tag_id      FK kb_tags
PK (article_id, tag_id)

kb_article_feedback
├── id          UUID PK
├── article_id  FK kb_articles
├── user_id     FK users NULLABLE  ← nullable for anonymous
├── is_helpful  BOOLEAN
├── comment     TEXT NULLABLE
└── created_at  TIMESTAMPTZ

kb_article_attachments
├── id              UUID PK
├── article_id      FK kb_articles
├── uploaded_by     FK users
├── filename        VARCHAR
├── storage_url     VARCHAR
├── file_size       BIGINT
├── mime_type       VARCHAR
└── created_at      TIMESTAMPTZ

ticket_kb_links
├── ticket_id       FK tickets
├── article_id      FK kb_articles
├── linked_by       FK users NULLABLE
├── is_suggested    BOOLEAN DEFAULT false  ← AI-suggested vs manually linked
└── linked_at       TIMESTAMPTZ
PK (ticket_id, article_id)
```

---

## Relationship Summary

```
Tenant
 ├── Products (1:N)
 ├── Departments (1:N, self-referencing tree)
 ├── Users (1:N)
 │    ├── Departments (M:N via user_department_assignments)
 │    └── ITSM Roles (M:N via user_itsm_roles)
 ├── Teams (1:N)
 │    └── Users (M:N via team_members)
 ├── SLA Policies (1:N)
 ├── Ticket Categories (1:N, self-referencing tree)
 ├── Tickets (1:N)
 │    ├── Comments (1:N, threaded)
 │    ├── Attachments (1:N)
 │    ├── Tags (M:N)
 │    ├── Watchers (M:N)
 │    ├── History (1:N audit log)
 │    ├── Escalations (1:N)
 │    ├── Assets (M:N via asset_ticket_links)
 │    └── KB Articles (M:N via ticket_kb_links)
 ├── Asset Categories (1:N, tree)
 ├── Asset Types (1:N)
 ├── Vendors (1:N)
 ├── Assets (1:N)
 │    ├── Maintenance Records (1:N)
 │    ├── Attachments (1:N)
 │    └── History (1:N audit log)
 ├── KB Spaces (1:N)
 │    ├── Categories (1:N, tree)
 │    └── Articles (1:N)
 │         ├── Versions (1:N)
 │         ├── Tags (M:N)
 │         ├── Feedback (1:N)
 │         └── Attachments (1:N)
 ├── Notifications (1:N per User)
 │    └── NotificationPreferences (1:N per User)
 ├── VirtualAgentSessions (1:N)
 └── System / Supporting
      ├── system_logs           (global, tenant_id nullable)
      ├── ai_usage_daily        (per-tenant daily aggregation)
      ├── asset_status_transitions  (seeded, immutable)
      └── tenant_sequences      (per-tenant counters)
```

---

## 6. Platform Tier (99Technologies)

```
platform_audit_log
├── id              UUID v7 PK
├── actor_id        VARCHAR        ← IAM idpSub of the 99T platform user
├── actor_email     VARCHAR        ← denormalized (user may leave 99T)
├── platform_role   ENUM (platform_admin, platform_support)
├── tenant_id       FK tenants     ← which customer tenant was accessed
├── http_method     VARCHAR
├── endpoint        VARCHAR
├── request_id      VARCHAR        ← correlates to structured log line
├── ip_address      INET
└── accessed_at     TIMESTAMPTZ
INDEX (tenant_id, accessed_at)
INDEX (actor_id, accessed_at)
-- INSERT only. No UPDATE. No DELETE. Retained 2 years minimum.
```

No `platform_users` table exists in ITSM — platform users are identified purely by
`jwt.org_id == PLATFORM_ORG_ID` at runtime. They are never persisted locally.

---

## 7. Supporting Entities

### 7.1 Asset State Machine

```
asset_status_transitions  (seeded, immutable — mirrors ticket_status_transitions pattern)
├── from_status     ENUM (in_stock, in_use, in_maintenance, retired, disposed, lost)
├── to_status       ENUM (in_stock, in_use, in_maintenance, retired, disposed, lost)
└── PK (from_status, to_status)
-- Seed rows:
--   in_stock    → in_use
--   in_use      → in_maintenance
--   in_maintenance → in_use
--   in_maintenance → in_stock          ← repaired and returned to stock
--   in_use      → retired
--   in_use      → lost
--   retired     → disposed
--   in_stock    → disposed
-- Invalid transitions (e.g. disposed→in_use) return HTTP 409 INVALID_STATE_TRANSITION
```

### 7.2 Notifications (User Inbox)

```
notifications
├── id              UUID v7 PK
├── tenant_id       FK tenants
├── user_id         FK users
├── type            ENUM (ticket_assigned, ticket_updated, ticket_commented,
│                         ticket_sla_warning, ticket_sla_breached,
│                         asset_maintenance_due, kb_article_published,
│                         mention, system)
├── title           VARCHAR
├── body            TEXT NULLABLE
├── entity_type     VARCHAR NULLABLE   ← "ticket" | "asset" | "kb_article"
├── entity_id       UUID NULLABLE      ← the related resource's PK
├── is_read         BOOLEAN DEFAULT false
├── read_at         TIMESTAMPTZ NULLABLE
└── created_at      TIMESTAMPTZ
INDEX (user_id, is_read, created_at DESC)   ← powers "unread count" badge query
INDEX (tenant_id, created_at DESC)
-- Written by Celery tasks and SLA breach detector, never inline in request path
-- Batch-read: GET /api/v1/notifications?unread=true&limit=50
-- Mark read: PATCH /api/v1/notifications/mark-read  { ids: [...] }

notification_preferences
├── user_id         FK users
├── tenant_id       FK tenants
├── type            ENUM (same values as notifications.type)
├── email_enabled   BOOLEAN DEFAULT true
├── in_app_enabled  BOOLEAN DEFAULT true
└── PK (user_id, type)
-- If absent → default enabled for all types
```

### 7.3 System Logs (DB copy of ERROR/WARNING/CRITICAL)

```
system_logs
├── id              UUID v7 PK
├── tenant_id       FK tenants NULLABLE  ← NULL for platform-level events
├── request_id      VARCHAR NULLABLE     ← correlates to structured JSON log
├── level           ENUM (warning, error, critical)
├── event           VARCHAR              ← e.g. "ai_budget_exhausted", "db_connection_lost"
├── message         TEXT
├── exception_type  VARCHAR NULLABLE
├── stack_trace     TEXT NULLABLE        ← only for unhandled (critical) — NEVER in HTTP response
├── metadata        JSONB
└── created_at      TIMESTAMPTZ
INDEX (tenant_id, level, created_at DESC)
INDEX (level, created_at DESC)           ← platform-wide health dashboard
-- Rule: INFO/DEBUG → stdout/Loki ONLY. WARNING/ERROR/CRITICAL → stdout/Loki AND this table.
-- Retention: kept 1 year in DB (same as log aggregation policy for WARNING+)
-- Enables: quick tenant error search in admin UI without needing Loki access
```

### 7.4 AI Usage Tracking

```
ai_usage_daily
├── id              UUID v7 PK
├── tenant_id       FK tenants
├── date            DATE
├── ai_feature      ENUM (ticket_classification, kb_suggest, duplicate_detection,
│                         response_suggestion, maintenance_prediction, virtual_agent)
├── model           VARCHAR              ← e.g. "claude-sonnet-4-6", "text-embedding-3-small"
├── input_tokens    BIGINT DEFAULT 0
├── output_tokens   BIGINT DEFAULT 0
├── call_count      INT DEFAULT 0
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
UNIQUE (tenant_id, date, ai_feature, model)
INDEX (tenant_id, date DESC)
-- Aggregated daily by Celery beat task from Redis counters
-- Redis: per-tenant monthly budget counter (fast check before every AI call)
-- DB: historical record for billing, analytics, tenant admin dashboard
-- Budget alert: when Redis counter crosses 80% of monthly_token_budget → notify tenant admin
```

### 7.5 Virtual Agent Sessions

```
virtual_agent_sessions
├── id                      UUID v7 PK
├── tenant_id               FK tenants
├── user_id                 FK users NULLABLE   ← NULL for anonymous/unauthenticated sessions
├── session_token           VARCHAR UNIQUE      ← short-lived token for anonymous users
├── status                  ENUM (active, ended, escalated, timed_out)
├── channel                 ENUM (web_widget, mobile_app, api)
├── escalated_to_ticket_id  FK tickets NULLABLE ← populated if user asks for human agent
├── escalated_at            TIMESTAMPTZ NULLABLE
├── ended_at                TIMESTAMPTZ NULLABLE
├── message_count           INT DEFAULT 0
├── metadata                JSONB               ← browser/device info, referring page
├── created_at              TIMESTAMPTZ
└── updated_at              TIMESTAMPTZ
INDEX (tenant_id, status, created_at DESC)
INDEX (user_id, created_at DESC) WHERE user_id IS NOT NULL
-- Messages stored externally (Redis stream) during session; persisted to a separate
-- virtual_agent_messages table on session end (for HITL analysis, not shown here)
```

---

## Database Decision

| Environment | Server | Database | Credentials |
|---|---|---|---|
| **Local dev** | Docker container (port 5433) | `itsm_db` | `itsm_user / itsm_pass` |
| **Staging / Prod** | Shared Project-IQ PostgreSQL server | `itsm_db` (separate from `project_iq_db`) | `itsm_user` (no access to `project_iq_db`) |

Switching from dev to prod is a single `DATABASE_URL` env var change. When load demands it, point `DATABASE_URL` at a dedicated server — zero code change.

---

## Multi-Tenancy Enforcement

Every tenant-scoped table carries `tenant_id` (FK → tenants). Row-level isolation is enforced at two layers:

1. **Application layer**: every query filtered by `tenant_id` extracted from the validated JWT.
2. **Database layer** (PostgreSQL RLS): `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` with policy `USING (tenant_id = current_setting('app.tenant_id')::uuid)`.

Global admin operations bypass RLS via a superuser connection string, never exposed to the API.

---

## Sequence Generators (per tenant)

Ticket numbers and asset tags use per-tenant sequences stored in a helper table:

```
tenant_sequences
├── tenant_id   FK tenants
├── prefix      VARCHAR  ← INC, REQ, PRB, CHG, AST
├── last_value  BIGINT DEFAULT 0
└── PK (tenant_id, prefix)
```

Format: `{PREFIX}-{LPAD(last_value+1, 5, '0')}` → `INC-00001`

---

## 5. AI Entities

```
ai_ticket_classifications
├── id                      UUID v7 PK
├── ticket_id               FK tickets UNIQUE  ← one record per ticket
├── suggested_category      FK ticket_categories NULLABLE
├── suggested_priority      ENUM NULLABLE
├── suggested_assignee      FK users NULLABLE
├── suggested_team          FK teams NULLABLE
├── confidence              FLOAT              ← 0.0–1.0 model confidence
├── model_version           VARCHAR
├── accepted                BOOLEAN NULLABLE   ← NULL=pending, true/false=agent decision
├── accepted_fields         JSONB NULLABLE     ← which specific fields were accepted e.g. ["priority","category"]
├── accepted_by             FK users NULLABLE
├── actual_category         FK ticket_categories NULLABLE  ← what agent ultimately set (ground truth)
├── actual_priority         ENUM NULLABLE                  ← ground truth for fine-tuning
├── actual_team             FK teams NULLABLE              ← ground truth for fine-tuning
├── created_at              TIMESTAMPTZ
└── updated_at              TIMESTAMPTZ
-- accepted + actual_* columns form the HITL Gold Dataset for fine-tuning a smaller model
-- Export: SELECT * FROM ai_ticket_classifications WHERE accepted IS NOT NULL → training data

ai_duplicate_candidates
├── id                  UUID PK
├── ticket_id           FK tickets         ← the new ticket
├── candidate_id        FK tickets         ← the potential duplicate
├── similarity_score    FLOAT              ← cosine similarity (0–1)
├── model_version       VARCHAR
├── dismissed           BOOLEAN DEFAULT false
├── dismissed_by        FK users NULLABLE
└── created_at          TIMESTAMPTZ
INDEX (ticket_id, similarity_score DESC)

ai_response_suggestions
├── id              UUID PK
├── ticket_id       FK tickets
├── comment_id      FK ticket_comments NULLABLE  ← if generated for a specific comment context
├── body            TEXT                         ← suggested reply text
├── model_version   VARCHAR
├── used            BOOLEAN DEFAULT false
├── used_by         FK users NULLABLE
└── created_at      TIMESTAMPTZ

ai_kb_article_drafts
├── id              UUID PK
├── tenant_id       FK tenants
├── space_id        FK kb_spaces NULLABLE
├── source_ticket   FK tickets NULLABLE    ← generated from a resolved ticket
├── title           VARCHAR
├── body            TEXT
├── status          ENUM (pending_review, accepted, rejected)
├── reviewed_by     FK users NULLABLE
├── article_id      FK kb_articles NULLABLE  ← populated on acceptance
├── model_version   VARCHAR
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

ai_maintenance_predictions
├── id                  UUID PK
├── asset_id            FK assets
├── predicted_due_date  DATE
├── risk_score          FLOAT              ← 0–1, higher = more urgent
├── reason              TEXT               ← model's explanation
├── model_version       VARCHAR
├── acknowledged        BOOLEAN DEFAULT false
├── acknowledged_by     FK users NULLABLE
└── created_at          TIMESTAMPTZ
INDEX (asset_id, risk_score DESC)
```

**AI config per tenant** (stored in `tenants.settings` JSONB, no separate table):
```jsonc
{
  "ai": {
    "enabled": true,
    "auto_classify_tickets": true,
    "auto_suggest_kb": true,
    "duplicate_detection_threshold": 0.85,
    "auto_draft_kb_on_close": false,
    "virtual_agent_enabled": true,
    "maintenance_prediction_enabled": true,
    "model": "claude-sonnet-4-6"
  }
}
```
