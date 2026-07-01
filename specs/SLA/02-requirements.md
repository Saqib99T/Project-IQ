# ITSM Service — Detailed Requirements

## 1. Non-Functional Requirements

### 1.1 Performance
- API response time P95 < 200ms for read operations, < 500ms for writes
- Support 500 concurrent users per tenant, 10,000 concurrent across all tenants
- Ticket list and search results returned within 300ms for datasets up to 1M tickets
- KB full-text search < 150ms

### 1.2 Scalability
- Horizontal scaling: stateless API pods behind a load balancer
- **Database**: same PostgreSQL server as Project-IQ, separate `itsm_db` database — isolated schema, isolated credentials, isolated connection pool. Migration path to dedicated server is just a `DATABASE_URL` change.
- Database connection pooling via PgBouncer (per-database pool, not shared with Project-IQ)
- Redis for session state, rate limiting, and hot-path caching
- Celery workers scaled independently for async jobs

### 1.3 Multi-Tenancy
- Strict tenant data isolation — no cross-tenant data leakage at any layer
- Row-Level Security (RLS) in PostgreSQL as a defence-in-depth layer
- Per-tenant feature flags (KB module, Asset module independently togglable)
- Per-tenant branding: logo, primary color, portal name

### 1.4 Security
- All endpoints require a valid JWT issued by `api.dev.iam.99technologies.com`
- JWT claims provide: `sub` (IAM user ID), `org_id` (tenant), `roles` (ITSM roles)
- **ITSM never stores or handles passwords** — pure OIDC Resource Server; credentials are IAM's responsibility
- **All primary keys are UUID v7** (time-sortable) — prevents ID enumeration attacks; sequential integers are never exposed in any API response
- RBAC enforced at service layer; no data returned for unauthorised resource access
- Rate limiting: 1,000 req/min per user, 10,000 req/min per tenant
- File uploads: max 25MB, allowed MIME types allowlist, virus scanning hook
- Audit log immutable — inserts only, no updates or deletes
- HTTPS only; HTTP → HTTPS redirect
- **SBOM generated on every build** (Syft or CycloneDX); vulnerability scanning via Trivy in CI/CD pipeline — ITSM is a high-value target (employee PII, infrastructure secrets)

### 1.4B Data Integrity & Cascade Policy
- **Soft delete only**: tickets, assets, and KB articles are never hard-deleted via the API — `deleted_at` is set; data is recoverable
- **Tenant delete** (platform_admin only): triggers async Celery task that deletes all tenant data in dependency order; completes within 24h; irreversible
- **FK cascade rules**: deleting a ticket → cascade-deletes comments, attachments, history, AI records, watchers, tags, KB links; deleting an asset → cascade-deletes maintenance records, attachments, history, ticket links
- **DB query timeout**: every SQLAlchemy query has a 30s statement timeout (`SET LOCAL statement_timeout = '30s'`) — prevents runaway queries from holding connections

### 1.5 Reliability
- Target 99.9% uptime (excluding planned maintenance)
- Graceful degradation: if Redis is down, fallback to DB; if IAM is down, cached JWT still valid for 5min
- Health check endpoints: `/health` (liveness) and `/ready` (readiness with DB + Redis ping)

### 1.6 Observability
- Structured JSON logs (request ID, tenant ID, user ID, latency, status)
- Prometheus metrics endpoint `/metrics`
- **OpenTelemetry distributed tracing** — every span must carry `tenant_id` as a baggage attribute so traces can be filtered per tenant to isolate slow queries from one customer degrading the whole cluster
- Sentry integration for error tracking (DSN configured per environment)

---

## 2. IAM Integration Requirements

### 2.0 Three-Tier Identity Model
- **Platform tier** (99Technologies org): identified by `jwt.org_id == PLATFORM_ORG_ID` (env var). No product subscription check. Two platform roles: `platform_admin` (full cross-tenant) and `platform_support` (read-only cross-tenant).
- **Tenant admin tier** (customer org, IAM role `admin`/`operator`): scoped strictly to their own tenant.
- **Tenant user tier** (IAM role `user`/`bot`): role-based access within their tenant.

Platform users must supply `X-Tenant-ID` header to operate on tenant data. Without it, only `/api/v1/platform/*` endpoints are accessible. Every cross-tenant access is written to `platform_audit_log` (immutable, 2-year retention).

### 2.1 Authentication — Silent Auth (OIDC Resource Server)
- ITSM is a **pure OIDC Resource Server** — it validates JWTs but never issues them
- Every API request must present `Authorization: Bearer <JWT>` (RS256, issued by IAM)
- The UI performs a **Silent Auth flow**: on page load, the frontend exchanges its IAM session for a JWT and passes it to all ITSM API calls — no login form exists in ITSM
- For the Rasa/chatbot action server: the JWT is passed in request metadata or `tracker.latest_message` — actions call `action_extract_context` to validate the JWT and set identity; **no `login_form` or password slots exist**
- Service fetches IAM JWKS endpoint on startup and caches RS256 public keys (refresh every 6h)
- JWT validation: signature, expiry (`exp`), issuer (`iss`), audience (`aud`)
- On valid JWT: extract `idpSub`, `organizationId`, resolve local `user.id` and `tenant.id`

### 2.2 User Sync
- On first login (JWT with unknown `idpSub`): auto-provision local user mirror
- Background job polls IAM `/v1/user` every 15 minutes to sync: name, email, avatar, active status
- Deactivated IAM users have active sessions revoked within 15 minutes

### 2.3 Tenant Provisioning
- When a new IAM Organization is granted access to the ITSM application:
  - Webhook from IAM triggers tenant provisioning
  - Creates `tenant`, default `sla_policies`, default `itsm_roles`, default `kb_spaces`
- IAM `/v1/organization/{id}/suspend` → sets `tenant.is_active = false` (blocks all API access)

### 2.4 Role Mapping
- ITSM registers its roles in IAM under its Application (`clientId`)
- IAM roles in JWT claims map to local `itsm_roles` on first use
- System roles (hardcoded): `end_user`, `agent`, `team_lead`, `manager`, `admin`
- Custom roles: tenant admins can create tenant-scoped roles with specific permissions

### 2.5 Department Sync
- IAM Facilities can be imported as Departments (one-way sync, `iam_facility_id` tracked)
- ITSM can also manage departments independently without IAM linkage

---

## 3. Ticketing System Requirements

### 3.1 Ticket Types
| Type | Prefix | Description |
|---|---|---|
| Incident | INC | Unplanned service disruption or degradation |
| Service Request | REQ | Standard request for a product or service |
| Problem | PRB | Root cause investigation of one or more incidents |
| Change | CHG | Planned change to infrastructure or service |

### 3.2 Ticket Lifecycle

**Incident / Service Request:**
```
open → in_progress → pending (awaiting user/3rd party) → resolved → closed
                                                        ↘ cancelled
```

**Problem:**
```
open → in_progress → resolved → closed
```

**Change:**
```
open → pending_approval → approved → in_progress → resolved → closed
                       ↘ rejected → cancelled
```

### 3.3 State Machine (not a plain enum update)
- Status transitions are governed by a **seeded `ticket_status_transitions` table** — not by application-level if/else
- Any PATCH that attempts an invalid transition (e.g. `closed → in_progress`) returns **HTTP 409 Conflict** with the valid next states listed
- Transition table is ticket-type-aware: `change` type has `pending_approval` state; `incident` does not
- State machine enforced at **both** service layer (fast fail) and DB constraint (safety net via CHECK or trigger)

### 3.4 Idempotency
- `POST /api/v1/tickets` accepts an optional `Idempotency-Key` header (UUID, client-generated)
- If a request with the same key arrives within 24h: return the original `201` response from Redis cache — **no duplicate ticket created**
- Idempotency key stored as a unique index `(tenant_id, idempotency_key)` in the tickets table
- After 24h the key expires from Redis; a new ticket would be created if re-submitted
- Same pattern applied to: `POST /assets`, `POST /kb/articles`, `POST /virtual-agent/message`

### 3.5 Priorities
- **Critical**: Production down, all users affected. SLA: respond 15min, resolve 4h
- **High**: Major feature broken, many users affected. SLA: respond 30min, resolve 8h
- **Medium**: Partial degradation. SLA: respond 2h, resolve 24h
- **Low**: Minor issue or request. SLA: respond 8h, resolve 72h

SLA clocks respect configurable **business hours** per tenant (timezone + working hours window).

### 3.6 Assignment & Routing
- Manual assignment: agent selects assignee or team from the ticket view
- Auto-assignment rule (Phase 2): based on category → team mapping
- Round-robin within a team (Phase 2)
- On assignment change: notify previous and new assignee

### 3.7 SLA Management
- Each ticket gets an SLA policy (from category default or manually overridden)
- SLA timer starts when ticket moves to `in_progress`
- **SLA clock pauses when status → `pending`**: `sla_paused_at` is set; accumulated `sla_paused_duration_sec` is incremented when status leaves `pending`
- Due times are recalculated on resume: `new_due = original_due + paused_duration_sec`
- This prevents agents being penalised for time spent waiting on the user or a third party
- **Business hours only**: SLA time only counts during configured working hours; nights/weekends are excluded from elapsed time calculation
- Breach detection: background job runs every 5 minutes comparing `NOW()` (DB server time — never app clock) against `sla_response_due`/`sla_resolve_due`
- Breach notifications: email + in-app to assignee and team lead

### 3.8B Comments & Notes
- Public comments: visible to requester and agents
- Internal notes: visible to agents only (clearly marked)
- Comment editing: within 5 minutes of creation by author only
- Soft delete: deleted comments replaced with "[deleted]" placeholder
- Mention support: `@username` sends notification

### 3.8C Attachments
- Up to 10 attachments per ticket, 25MB per file
- Supported types: images (jpg, png, gif, webp), documents (pdf, docx, xlsx), archives (zip)
- Stored in configurable object storage (S3-compatible)
- Direct upload: presigned URL returned by API; file uploaded directly by client

### 3.8D Search & Filtering
- Full-text search across title and description (PostgreSQL FTS)
- Filters: status, priority, type, assignee, team, category, product, department, date range, tags
- Saved filters per user (Phase 2)
- Bulk operations: assign, close, tag, change priority (for agents)

### 3.8E Watchers & Notifications
- Requester is auto-watcher. Assignee is auto-watcher on assignment.
- Any user can add themselves as watcher
- Notification events: ticket created, status changed, comment added, assignment changed, SLA breached
- Channels: in-app (real-time via WebSocket), email

### 3.8F Escalation
- Manual escalation: agent escalates to manager or specific user with reason
- Auto-escalation (Phase 2): rule-based on SLA breach + priority

### 3.8G Ticket Relations
- Sub-ticket: ticket linked as child of another (parent_ticket_id)
- Asset link: one or more assets linked to a ticket
- KB article link: one or more KB articles linked to a ticket

### 3.9 Permissions Matrix

| Action | end_user | agent | team_lead | manager | admin |
|---|:---:|:---:|:---:|:---:|:---:|
| Create ticket | ✓ | ✓ | ✓ | ✓ | ✓ |
| View own tickets | ✓ | ✓ | ✓ | ✓ | ✓ |
| View all tickets | — | ✓ | ✓ | ✓ | ✓ |
| Assign ticket | — | ✓ | ✓ | ✓ | ✓ |
| Add internal note | — | ✓ | ✓ | ✓ | ✓ |
| Close ticket | — | ✓ | ✓ | ✓ | ✓ |
| Delete ticket | — | — | — | ✓ | ✓ |
| Manage SLA policies | — | — | — | ✓ | ✓ |
| Manage categories | — | — | ✓ | ✓ | ✓ |
| Bulk operations | — | ✓ | ✓ | ✓ | ✓ |

---

## 4. Asset Management Requirements

### 4.1 Asset Lifecycle
```
in_stock    → in_use
in_use      → in_maintenance → in_use
                             → in_stock  (repaired, returned to pool)
in_use      → retired → disposed
in_stock    → disposed
in_use      → lost
```
Asset status transitions are also governed by a seeded `asset_status_transitions` table — the same state machine pattern as tickets. Invalid transitions return **HTTP 409 Conflict** with valid next states listed. `disposed` is a terminal state.

### 4.1B CMDB — Asset Relationships
- Assets can be linked to other assets via typed relationships in `asset_relationships`
- Relationship types: `runs_on`, `connected_to`, `depends_on`, `hosts`, `part_of`, `backs_up`
- Relationships are **directional but queryable in both directions** (source → target and target → source)
- Example graph: `App Server` → `runs_on` → `VM Host` → `connected_to` → `Core Switch`
- **Impact Analysis**: when an asset changes status to `in_maintenance`/`lost`, the system traverses the relationship graph (BFS/DFS up to 3 hops) and surfaces a list of potentially affected assets and any open tickets linked to those assets
- Impact analysis result shown to the agent as: *"Putting Switch C into maintenance may affect 3 assets and 2 open tickets"*
- AI enhancement (Phase 2): Claude uses the impact graph to pre-populate incident descriptions and suggest affected teams

### 4.2 Asset Types & Custom Fields
- Tenant admins define Asset Types with custom field schemas (JSON Schema)
- Examples:
  - **Laptop**: cpu, ram_gb, storage_gb, os, mac_address
  - **Software License**: license_key, seats, expiry_date, license_type
  - **Network Device**: ip_address, mac_address, firmware_version, rack_location
  - **Vehicle**: plate_number, make, model, year, fuel_type
- Custom fields rendered as dynamic form in UI

### 4.3 Asset Assignment
- Asset assigned to a user (and optionally department)
- Assignment creates history record
- One asset assigned to one user at a time (1:1 active assignment)
- Historical assignment trail preserved in `asset_history`

### 4.4 Maintenance
- Scheduled maintenance: planned dates, recurring (Phase 2)
- Reactive maintenance: logged after the fact
- Maintenance changes asset status to `in_maintenance` automatically
- On completion: status reverts to `in_use` or `in_stock`
- Cost tracking per maintenance event

### 4.5 Search & Filtering
- Search by name, asset tag, serial number, model, manufacturer
- Filters: status, condition, type, category, department, assigned user, vendor, purchase date range, warranty expiry
- Export to CSV/Excel (Phase 2)

### 4.6 Reporting (Phase 2)
- Assets by category/type/department
- Assets by status distribution
- Assets expiring warranty within 30/60/90 days
- Total asset value by category

### 4.7 Permissions Matrix

| Action | end_user | agent | team_lead | manager | admin |
|---|:---:|:---:|:---:|:---:|:---:|
| View own assigned assets | ✓ | ✓ | ✓ | ✓ | ✓ |
| View all assets | — | ✓ | ✓ | ✓ | ✓ |
| Create / Edit asset | — | — | ✓ | ✓ | ✓ |
| Assign asset | — | — | ✓ | ✓ | ✓ |
| Log maintenance | — | ✓ | ✓ | ✓ | ✓ |
| Delete / Dispose asset | — | — | — | ✓ | ✓ |
| Manage vendors | — | — | — | ✓ | ✓ |
| Manage asset types | — | — | — | — | ✓ |

---

## 5. Knowledge Base Requirements

### 5.1 Spaces
- Each tenant can have multiple KB Spaces
- Spaces scoped to a Product (product-level KB) or to the whole Tenant (tenant-wide)
- Each Space has a `is_public` flag — public spaces accessible without authentication
- Default space created on tenant provisioning

### 5.2 Article Lifecycle
```
draft → under_review → published → archived
      ↘ (rejected) → draft
```

### 5.3 Visibility Levels
- **public**: accessible without login (honoured if space is also public)
- **internal**: logged-in users of the tenant
- **agents_only**: only users with agent/manager/admin role

### 5.4 Authoring
- Markdown body with live preview in the editor
- Rich embeds: code blocks with syntax highlighting, tables, images
- Version history: every save to `published` creates a snapshot in `kb_article_versions`
- Restore to previous version by admins

### 5.5 Search
- Full-text search with PostgreSQL `TSVECTOR` (title + body weighted)
- Search scope: within a space, within a product, or across the tenant
- Public spaces searchable by unauthenticated users via public API

### 5.6 Feedback
- Thumbs up / thumbs down on published articles
- Optional comment on feedback
- Anonymous feedback allowed on public articles
- Article quality score = `helpful_count / (helpful_count + not_helpful_count)`

### 5.7 Integration with Ticketing
- When creating a ticket, KB search is surfaced inline (suggest relevant articles)
- Agents can link articles to a ticket resolution
- Article view count increments when accessed from a ticket link

### 5.8 Permissions Matrix

| Action | end_user | agent | team_lead | manager | admin |
|---|:---:|:---:|:---:|:---:|:---:|
| Read published articles | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read agents_only articles | — | ✓ | ✓ | ✓ | ✓ |
| Create / Edit draft | — | ✓ | ✓ | ✓ | ✓ |
| Submit for review | — | ✓ | ✓ | ✓ | ✓ |
| Publish / Archive | — | — | ✓ | ✓ | ✓ |
| Delete article | — | — | — | ✓ | ✓ |
| Manage spaces | — | — | — | — | ✓ |
| Manage categories | — | — | ✓ | ✓ | ✓ |

---

## 6. API Design Requirements

### 6.1 Conventions
- Base path: `/api/v1/`
- JSON request and response bodies
- HTTP status codes: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable Entity, 429 Too Many Requests, 500 Internal Server Error
- Pagination: cursor-based for large lists (tickets, assets, articles); page-based for small lists
- Sorting: `?sort=created_at:desc,priority:asc`
- Field selection: `?fields=id,title,status` (Phase 2)

### 6.2 Tenant Context
- Tenant resolved from JWT `organizationId` claim — never from URL path or query param
- Super-admin cross-tenant operations require a separate `X-Tenant-ID` header with super-admin JWT

### 6.3 Key Endpoints (not exhaustive)

**Tickets**
```
GET    /api/v1/tickets
POST   /api/v1/tickets
GET    /api/v1/tickets/{id}
PATCH  /api/v1/tickets/{id}
DELETE /api/v1/tickets/{id}
POST   /api/v1/tickets/{id}/comments
GET    /api/v1/tickets/{id}/comments
PATCH  /api/v1/tickets/{id}/comments/{comment_id}
POST   /api/v1/tickets/{id}/watchers
DELETE /api/v1/tickets/{id}/watchers/{user_id}
POST   /api/v1/tickets/{id}/attachments (presigned URL flow)
POST   /api/v1/tickets/{id}/tags
DELETE /api/v1/tickets/{id}/tags/{tag_id}
GET    /api/v1/tickets/{id}/history
POST   /api/v1/tickets/{id}/escalate
POST   /api/v1/tickets/bulk (bulk operations)
```

**Assets**
```
GET    /api/v1/assets
POST   /api/v1/assets
GET    /api/v1/assets/{id}
PATCH  /api/v1/assets/{id}
DELETE /api/v1/assets/{id}
POST   /api/v1/assets/{id}/assign
DELETE /api/v1/assets/{id}/assign
POST   /api/v1/assets/{id}/maintenance
GET    /api/v1/assets/{id}/maintenance
PATCH  /api/v1/assets/{id}/maintenance/{m_id}
GET    /api/v1/assets/{id}/history
POST   /api/v1/assets/{id}/attachments
GET    /api/v1/assets/{id}/impact-analysis   ← CMDB: BFS graph traversal, returns affected assets + open tickets
POST   /api/v1/assets/{id}/relationships
DELETE /api/v1/assets/{id}/relationships/{rel_id}
GET    /api/v1/asset-types
POST   /api/v1/asset-types
GET    /api/v1/vendors
POST   /api/v1/vendors
```

**Knowledge Base**
```
GET    /api/v1/kb/spaces
POST   /api/v1/kb/spaces
GET    /api/v1/kb/spaces/{slug}
GET    /api/v1/kb/spaces/{slug}/articles
POST   /api/v1/kb/articles
GET    /api/v1/kb/articles/{id}
PATCH  /api/v1/kb/articles/{id}
DELETE /api/v1/kb/articles/{id}
POST   /api/v1/kb/articles/{id}/publish
POST   /api/v1/kb/articles/{id}/archive
GET    /api/v1/kb/articles/{id}/versions
POST   /api/v1/kb/articles/{id}/feedback
GET    /api/v1/kb/search?q=...&space=...
```

**Tenant / Admin**
```
GET    /api/v1/tenant/settings
PATCH  /api/v1/tenant/settings
GET    /api/v1/tenant/users
PATCH  /api/v1/tenant/users/{id}/roles
GET    /api/v1/tenant/teams
POST   /api/v1/tenant/teams
PATCH  /api/v1/tenant/teams/{id}
GET    /api/v1/tenant/roles
POST   /api/v1/tenant/sla-policies
PATCH  /api/v1/tenant/sla-policies/{id}
GET    /api/v1/tenant/departments
POST   /api/v1/tenant/departments
GET    /api/v1/tenant/business-hours          ← read business_hours_config
PATCH  /api/v1/tenant/business-hours          ← update timezone, work_days, work_start_time, holidays
GET    /api/v1/tenant/ai-budget               ← current token usage + limit
PATCH  /api/v1/tenant/ai-budget               ← platform_admin only: update monthly_token_limit
GET    /api/v1/tenant/ai-budget/history       ← daily breakdown by feature + model
GET    /api/v1/tenant/audit-log               ← platform access log for this tenant (platform_admin only)
```

**Notifications**
```
GET    /api/v1/notifications                  ← paginated; ?unread=true&limit=50
PATCH  /api/v1/notifications/mark-read        { "ids": ["uuid1", "uuid2"] | "all": true }
DELETE /api/v1/notifications/{id}
GET    /api/v1/notifications/preferences
PATCH  /api/v1/notifications/preferences      { "ticket_sla_breach": { "email": false, "in_app": true } }
```

**Platform (99Technologies admin only)**
```
GET    /api/v1/platform/tenants
GET    /api/v1/platform/tenants/{id}
PATCH  /api/v1/platform/tenants/{id}
POST   /api/v1/platform/tenants/{id}/suspend
POST   /api/v1/platform/tenants/{id}/unsuspend
DELETE /api/v1/platform/tenants/{id}          ← GDPR hard delete, async, irreversible
GET    /api/v1/platform/analytics
GET    /api/v1/platform/audit-log             ← all cross-tenant platform access log
GET    /api/v1/platform/users?email=...       ← find which tenant a user belongs to
```

---

## 7. Notification Requirements

### 7.1 In-App (WebSocket)
- Real-time push over Socket.IO (consistent with existing Project-IQ architecture)
- Notification bell count + dropdown list
- Notification types: ticket_assigned, ticket_updated, comment_added, sla_breach, mention, asset_assigned

### 7.2 Email
- Transactional email via configurable SMTP or SendGrid
- Templates: ticket created, assigned, resolved, comment received, SLA breach warning, KB article published
- Tenant-customisable sender name and reply-to

### 7.3 Webhook (Phase 2)
- Tenant-configurable webhooks for ticket events
- Signed payloads (HMAC-SHA256)

---

## 7A. AI Module Requirements

### 7A.1 Model Provider
- Primary LLM: **Claude (Anthropic API)** — `claude-sonnet-4-6` for generation tasks
- Embeddings: `text-embedding-3-small` (OpenAI) or equivalent, 1536 dimensions, stored in PostgreSQL via `pgvector`
- All AI calls are async (Celery tasks); they never block API request/response
- Per-tenant AI feature flags: each AI capability can be individually toggled on/off by tenant admin
- All AI-generated content is flagged in the UI; agents always have final say

---

### 7A.2 Ticket Auto-Classification

**Trigger**: immediately after ticket creation (Celery task enqueued)

**What it does**:
- Sends ticket title + description to Claude
- Returns: suggested `category`, `priority`, `assignee_team` with confidence scores
- Persisted in `ai_ticket_classifications`

**Agent UX**:
- On ticket view, a banner shows AI suggestions with "Accept / Reject" per field
- Accepting auto-fills the field; confidence < 0.6 suggestions are hidden by default
- Agents can always override; every acceptance/rejection is tracked

**HITL Gold Dataset**:
- Every agent decision (accept/reject + what they actually set) is stored in `ai_ticket_classifications.accepted_fields`, `actual_priority`, `actual_category`, `actual_team`
- This forms a **labelled training dataset**: input = ticket title+description, label = what the expert agent set
- Exported periodically for fine-tuning a smaller, cheaper open-source model (e.g. Llama 3 8B) to replace Claude for simple classification — reducing AI cost by 80%+ at scale
- Export endpoint (admin only): `GET /api/v1/ai/classification-dataset?format=jsonl`

**API**:
```
GET  /api/v1/tickets/{id}/ai-classification
POST /api/v1/tickets/{id}/ai-classification/accept  { "fields": ["priority", "category"] }
POST /api/v1/tickets/{id}/ai-classification/reject
GET  /api/v1/ai/classification-dataset?format=jsonl  (admin, for fine-tuning export)
```

---

### 7A.3 Semantic Duplicate Detection

**Trigger**: on ticket creation (same Celery task as classification)

**What it does**:
- Embeds ticket description via embedding model
- Stores embedding in `tickets.description_embedding`
- Runs `pgvector` cosine similarity search against open/recent tickets of the same tenant
- Returns candidates with similarity > configurable threshold (default 0.85)
- Persisted in `ai_duplicate_candidates`

**Agent UX**:
- Ticket creation response includes `ai_duplicates` list (top 3)
- UI surfaces: "This may be a duplicate of INC-00045 (91% similar)" with a link
- Agent can dismiss or merge (merge = close current, link to original, Phase 2)

**API**:
```
GET  /api/v1/tickets/{id}/ai-duplicates
POST /api/v1/tickets/{id}/ai-duplicates/{candidate_id}/dismiss
```

---

### 7A.4 KB Article Suggestion (Ticket Context)

**Trigger**: on ticket creation and on every ticket update (re-rank)

**What it does**:
- Embeds ticket description, runs pgvector similarity search over `kb_articles.embedding`
- Top 5 semantically relevant articles returned (already partially covered by `ticket_kb_links.is_suggested`)
- Agents and end users see suggested articles before they write a comment

**Inline suggestion during ticket creation**:
- `GET /api/v1/kb/suggest?q=<title+description>&limit=5` — called client-side as user types
- Responses returned < 300ms (embedding is pre-computed; search is pgvector ANN)

---

### 7A.5 Agent Response Suggestions

**Trigger**: agent opens a ticket; optionally re-triggered per new incoming customer comment

**What it does**:
- Sends full ticket context (title, description, comment history, linked KB articles) to Claude
- Returns: a professional draft reply addressing the user's issue
- Stored in `ai_response_suggestions`

**Agent UX**:
- "AI Draft" button in comment editor — inserts suggestion into text field for editing
- Agent edits and sends; original suggestion is not logged to customer
- `used` flag set to `true` when agent submits a comment within 60s of viewing the suggestion

**API**:
```
POST /api/v1/tickets/{id}/ai-suggest-reply
GET  /api/v1/tickets/{id}/ai-suggest-reply/latest
```

---

### 7A.6 Auto-Generate KB Article from Resolved Ticket

**Trigger**: when a ticket status changes to `resolved` or `closed` (configurable per tenant)

**What it does**:
- Sends ticket title, description, and resolution comments to Claude
- Prompts: "Write a KB article that would help a user solve this problem independently"
- Draft stored in `ai_kb_article_drafts` with `status = pending_review`

**Agent UX**:
- Manager/team_lead sees notification: "AI drafted a KB article from INC-00123 — review it"
- Review screen: diff view of AI draft, edit in place, accept → auto-creates `kb_articles` in draft state
- Reject → dismisses the draft

**API**:
```
GET  /api/v1/ai/kb-drafts                     (list pending drafts for tenant)
GET  /api/v1/ai/kb-drafts/{id}
POST /api/v1/ai/kb-drafts/{id}/accept         (creates kb_articles record)
POST /api/v1/ai/kb-drafts/{id}/reject
```

---

### 7A.7 Semantic KB Search

**Behavior**:
- `GET /api/v1/kb/search?q=...` uses a hybrid approach:
  1. PostgreSQL FTS (`tsvector`) for keyword precision
  2. `pgvector` cosine similarity for semantic relevance
  3. Results re-ranked: `final_score = 0.4 * fts_rank + 0.6 * semantic_similarity`
- Embeddings re-generated nightly for articles modified in the past 24h (Celery beat task)
- Public spaces: semantic search available without auth

---

### 7A.8 Predictive Asset Maintenance

**Trigger**: nightly Celery beat task, scans all active assets

**What it does**:
- For each asset: sends type, age, maintenance history, condition, manufacturer to Claude
- Returns: risk score (0–1) and natural-language reason ("Last serviced 18 months ago; warranty expiry in 30 days")
- Stored in `ai_maintenance_predictions`; new record replaces old one per asset

**Alert threshold**: risk_score > 0.7 → creates in-app notification for asset manager

**API**:
```
GET  /api/v1/assets/{id}/ai-maintenance-prediction
POST /api/v1/assets/{id}/ai-maintenance-prediction/acknowledge
```

---

### 7A.9 Virtual Agent (Chatbot)

**Scope**: end-user-facing chat interface (new tickets, KB queries, ticket status checks)

**Capabilities**:
- Answer questions using KB (RAG: retrieve relevant articles via pgvector, generate answer via Claude)
- Create a ticket on behalf of the user via conversation
- Check status of user's existing tickets: "What's the status of my request?"
- Collect structured info before ticket creation (title, description, category, priority suggestion)
- Graceful handoff to human agent: "I'll connect you with a support agent" → creates ticket + notifies team

**Streaming (SSE)**:
- Claude's response is **streamed token-by-token** via **Server-Sent Events (SSE)** on the HTTP endpoint
- Socket.IO also supported for clients already connected (emit `agent_token` per chunk, `agent_done` on finish)
- Users see a "typing" animation — dramatically better UX than waiting 5s for a full block
- SSE endpoint: `GET /api/v1/virtual-agent/stream?session_id=...&text=...` (EventSource-compatible)
- Streaming is default; non-streaming JSON response available via `POST /api/v1/virtual-agent/message` for programmatic clients

**Integration**:
- Connects to existing Project-IQ chat infrastructure (Socket.IO, Rasa-style action server pattern)
- **No `login_form` in Rasa** — JWT passed in socket metadata; `action_extract_context` validates it
- Tenant-configurable: greeting message, escalation rules, knowledge space scope
- Conversation history stored in Redis (24h TTL) + optionally persisted to DB

**API**:
```
GET  /api/v1/virtual-agent/stream?session_id=...&text=...  ← SSE streaming
POST /api/v1/virtual-agent/message    { "session_id": "...", "text": "..." }  ← non-streaming
GET  /api/v1/virtual-agent/session/{id}
```

---

### 7A.10 AI Analytics & Insights (Phase 2)

| Insight | Description |
|---|---|
| SLA breach prediction | Flags in-progress tickets likely to breach before due date (based on current queue, assignee load) |
| Workload forecasting | Predicts ticket volume for next 7 days by category (based on historical pattern) |
| Knowledge gap detection | Identifies ticket categories with high volume but low KB coverage |
| Agent performance coaching | Flags tickets where AI response score was significantly better than actual response |
| Sentiment trending | Tracks sentiment score across requester comments per product/department |

---

### 7A.11 AI Guardrails & Cost Controls

- All LLM calls routed through a central `ai_service.py` wrapper with:
  - Per-tenant monthly token budget tracked in Redis (fast counter check before every call); aggregated daily to `ai_usage_daily` table by Celery beat
  - Budget thresholds: **80%** → notify tenant admin (in-app + email); **100%** → `AIBudgetExhaustedError` raised → **HTTP 429** with `error.code = "AI_BUDGET_EXHAUSTED"` and `Retry-After` set to first day of next month
  - Budget exhaustion is **non-blocking for ticket creation**: if classification/enrichment task hits budget limit, it skips silently (task completes with `WARNING` log); ticket exists without AI enrichment
  - Request timeout: 30s for generation, 5s for classification; exceeded → `ExternalServiceError` → Celery retry
  - Retry with exponential backoff (max 3 retries: 15s, 60s, 240s) on rate limit / 5xx from AI provider
  - Prompt injection defence: user content always in separate `user` turn, never interpolated into system prompt
- No PII sent to external APIs without tenant consent flag (`ai.pii_consent = true`)
- Fallback: if AI service unavailable, ticket creation succeeds without AI enrichment (graceful degradation)

**Budget management API** (tenant admin):
```
GET   /api/v1/tenant/ai-budget           ← current usage, limit, % consumed
PATCH /api/v1/tenant/ai-budget           { "monthly_token_limit": 5000000 }  (platform_admin only)
GET   /api/v1/tenant/ai-budget/history   ← daily usage breakdown by feature + model
```

---

## 8. Data Retention & Compliance
- Soft-delete tickets and assets (not hard-deleted) — `deleted_at` timestamp
- Audit logs retained for 2 years (configurable per tenant)
- GDPR: user data export and anonymisation endpoints (Phase 3)
- Backup: daily `pg_dump itsm_db` to object storage, 30-day retention — separate from `project_iq_db` backup, restoring one never affects the other
