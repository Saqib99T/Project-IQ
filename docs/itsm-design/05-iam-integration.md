# IAM ↔ ITSM Integration Design

## What IAM Has

```
IAM
├── 99Technologies Org  ← the PLATFORM org (special — owns all products)
│   ├── Users
│   │   └── Roles: admin | operator
│   └── (no product subscription needed — they built it)
│
├── Customer Organization  ← a company / tenant account
│   ├── Users
│   │   └── Roles: admin | operator | user | bot
│   └── Subscribed Products
│       └── e.g. "ITSM", "Project-IQ", "BillingX"
│
└── Authentication        ← issues JWT tokens (RS256) for ALL orgs
```

---

## Three-Tier Access Model

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1 — PLATFORM (99Technologies org)                 │
│  platform_admin  → full access to ALL tenants           │
│  platform_support → read-only access to ALL tenants     │
├─────────────────────────────────────────────────────────┤
│  TIER 2 — TENANT ADMIN (customer org, role: admin)      │
│  admin      → full access to THEIR tenant only          │
│  manager    → manage tickets/assets/KB in their tenant  │
├─────────────────────────────────────────────────────────┤
│  TIER 3 — TENANT USER (customer org, operator/user/bot) │
│  agent / end_user / service_account                     │
│  → scoped to their tenant only, role-based access       │
└─────────────────────────────────────────────────────────┘
```

---

## Mapping: IAM → ITSM

```
IAM                               ITSM
──────────────────────────────────────────────────────────────────
99Technologies org
  Role: admin              →     platform_admin    (all tenants, full)
  Role: operator           →     platform_support  (all tenants, read-only + support ops)

Customer org
  Role: admin              →     itsm_role: admin         (their tenant only)
  Role: operator           →     itsm_role: agent         (promotable to team_lead/manager)
  Role: user               →     itsm_role: end_user
  Role: bot                →     itsm_role: service_account

Product: "ITSM" subscribed →     Tenant provisioned / active
Product: "ITSM" removed    →     Tenant suspended (data kept 90 days)
Authentication / JWT        →     Bearer token on every ITSM API call
```

---

## How ITSM Detects Platform Users

ITSM has one env var: `PLATFORM_ORG_ID=org_99technologies_...`

On every request, after JWT validation:

```python
if jwt.org_id == settings.PLATFORM_ORG_ID:
    # Platform user — no tenant context yet
    # Must supply X-Tenant-ID header to operate on a specific tenant
    # Without it: can only hit /api/v1/platform/* endpoints
    user.tier = "platform"
    user.platform_role = map_iam_role_to_platform(jwt.roles)
else:
    # Regular tenant user
    user.tier = "tenant"
    user.tenant_id = resolve_tenant(jwt.org_id)
```

---

## JWT Structure (what ITSM receives)

**Platform user JWT** (99Technologies org):
```json
{
  "sub":      "usr_99t_admin_01...",
  "org_id":   "org_99technologies",    ← matches PLATFORM_ORG_ID env var
  "roles":    ["admin"],               ← admin → platform_admin
  "products": [],                      ← 99T doesn't "subscribe" — they own it
  "email":    "saqib@99technologies.com",
  "iss":      "https://api.dev.iam.99technologies.com",
  "aud":      "itsm",
  "exp":      1748000000
}
```

**Customer tenant user JWT**:
```json
{
  "sub":      "usr_01j4k...",
  "org_id":   "org_acme_01j2m...",     ← resolves to ITSM tenant
  "roles":    ["operator"],            ← operator → agent
  "products": ["itsm", "project-iq"], ← must contain "itsm"
  "email":    "ali@acme.com",
  "iss":      "https://api.dev.iam.99technologies.com",
  "aud":      "itsm",
  "exp":      1748000000
}
```

ITSM validates for ALL users:
- Signature (RS256 via IAM JWKS)
- `exp` not expired
- `iss` matches IAM base URL
- `aud` = `"itsm"`

Then branches:
- **Platform user** (`org_id == PLATFORM_ORG_ID`): skip product check, set `user.tier = platform`
- **Tenant user**: check `products` contains `"itsm"` → else 403

---

## Integration Flows

### Flow 0 — Platform Admin Accesses a Tenant

```
99T Admin (Saqib)
    │
    │  1. Logged into IAM as 99Technologies org user
    │     JWT has org_id = "org_99technologies"
    │
    ▼
ITSM API
    │
    ├─ 2. Validates JWT → detects platform user (org_id = PLATFORM_ORG_ID)
    ├─ 3. Reads X-Tenant-ID: org_acme_01j2m  header
    │       missing → can only access /api/v1/platform/* (list tenants, stats)
    │       present → override tenant context for this request
    ├─ 4. Bypasses tenant RLS for the specified tenant
    ├─ 5. Writes to platform_audit_log:
    │       WHO: usr_99t_admin_01
    │       TENANT: org_acme_01j2m
    │       ACTION: GET /api/v1/tickets
    │       AT: 2026-05-29T10:00:00Z
    └─ 6. Returns data as if the platform admin were a tenant admin of that org
```

Platform user sees the tenant exactly as that tenant's admin would.
Every single cross-tenant access is audit-logged — no exceptions.

---

### Flow 1 — First Login (Silent Auth)

```
Browser / Mobile App
    │
    │  1. User already logged into IAM portal
    │     IAM issues JWT silently (PKCE / session cookie exchange)
    │
    ▼
ITSM Frontend
    │
    │  2. Attaches JWT as  Authorization: Bearer <token>
    │     on every API call
    │
    ▼
ITSM API  (auth/dependencies.py → get_current_user)
    │
    ├─ 3. Validate JWT against IAM JWKS (cached)
    ├─ 4. Check products contains "itsm" → else 403
    ├─ 5. Lookup tenant by org_id
    │       not found → return 403 "Tenant not provisioned"
    ├─ 6. Lookup user by sub (idpSub)
    │       not found → auto-provision user mirror from JWT claims
    └─ 7. Map IAM role → ITSM role, inject into request context
```

No login form. No password. No credential ever touches ITSM.

---

### Flow 2 — Tenant Provisioning (Org subscribes to ITSM)

```
IAM Admin Portal
    │
    │  1. Org admin subscribes to "ITSM" product
    │
    ▼
IAM
    │
    │  2. Fires webhook POST to ITSM:
    │     {
    │       "event":   "product.subscribed",
    │       "product": "itsm",
    │       "org_id":  "org_01j2m...",
    │       "org_name": "Acme Corp"
    │     }
    │     (HMAC-SHA256 signed with shared secret)
    │
    ▼
ITSM  (POST /api/v1/webhooks/iam)
    │
    ├─ 3. Verify HMAC signature
    ├─ 4. Create tenants record  (iam_org_id = org_id)
    ├─ 5. Seed defaults:
    │       • SLA policies (critical/high/medium/low)
    │       • ITSM roles   (admin/agent/team_lead/manager/end_user/service_account)
    │       • KB space     (default tenant-wide space)
    │       • Ticket categories (General, IT Support, HR, Facilities)
    └─ 6. Respond 200 OK to IAM
```

---

### Flow 3 — Tenant Suspension (Org unsubscribes or is suspended in IAM)

```
IAM fires:
  { "event": "product.unsubscribed" | "organization.suspended", "org_id": "..." }

ITSM:
  → sets tenant.is_active = false
  → all API calls for that tenant return 403 "Subscription inactive"
  → data is retained (not deleted) for 90 days
  → if re-subscribed within 90 days: tenant.is_active = true, full access restored
```

---

### Flow 4 — User Sync (Background)

```
Celery beat task — every 15 minutes:

  1. Call IAM GET /v1/user?organizationId=<org_id>  (for each active tenant)
  2. For each IAM user:
       • If not in ITSM users → insert (auto-provision)
       • If name/email/avatar changed → update
       • If IAM user.isActive = false → set itsm user.is_active = false
                                      → revoke any active sessions (delete from Redis)
  3. If IAM user deleted → soft-deactivate in ITSM (never hard delete — audit trail)
```

---

### Flow 5 — Bot / Virtual Agent Authentication

```
IAM has a bot user for the ITSM virtual agent:
  roles: ["bot"]
  idpSub: "bot_itsm_va_01..."

The action server (Rasa / virtual agent backend) holds a long-lived JWT
for this bot account. It uses it to:
  • POST /api/v1/tickets          (create tickets on behalf of end users)
  • GET  /api/v1/kb/suggest       (retrieve KB articles for RAG)
  • GET  /api/v1/tickets?requester_id=<user>  (check ticket status for a user)

ITSM role mapping:  bot  →  service_account
Permissions:
  ✓ Create tickets (on behalf of a requester_id passed in body)
  ✓ Read KB articles (all published)
  ✓ Read tickets for a specific requester
  ✗ Cannot assign, close, or manage tickets
  ✗ Cannot access internal notes
  ✗ Cannot access admin endpoints
```

---

### Flow 6 — Role Promotion (ITSM-specific roles)

IAM gives you a coarse role (`admin`, `operator`, `user`, `bot`).
ITSM adds **fine-grained promotion** on top:

```
IAM role      →  Default ITSM role    →  Can be promoted to
──────────────────────────────────────────────────────────
admin         →  admin                →  (already highest)
operator      →  agent                →  team_lead, manager
user          →  end_user             →  (no promotion by default)
bot           →  service_account      →  (fixed)
```

Promotion is done by an ITSM admin via `PATCH /api/v1/tenant/users/{id}/roles`.
It's stored in `user_itsm_roles` — IAM is not modified.
If the IAM role changes (e.g. operator → admin), the ITSM role is updated on next JWT validation.

---

## Summary Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                          IAM                                │
│                                                             │
│  Organization ──────────────────────────► Tenant (ITSM)    │
│       │                                     provisioned     │
│       │  subscribe/unsubscribe webhook       on subscribe   │
│       │                                                     │
│  User (admin/operator/user/bot) ────────► User mirror       │
│       │                                     auto-created    │
│       │  JWT (RS256)                         on first login  │
│       │                                                     │
│  Authentication ────────────────────────► Bearer token      │
│                                             validates on     │
│                                             every request   │
└─────────────────────────────────────────────────────────────┘

                    Single source of truth: IAM
                    ITSM owns: roles promotion,
                               tickets, assets, KB
```

---

---

## Platform-Level API Endpoints

These endpoints are accessible **only** to platform users (99T org). No `X-Tenant-ID` needed — they operate across all tenants.

```
GET    /api/v1/platform/tenants                   ← list all tenants + status
GET    /api/v1/platform/tenants/{id}              ← tenant detail + stats
PATCH  /api/v1/platform/tenants/{id}              ← update settings (e.g. increase limits)
POST   /api/v1/platform/tenants/{id}/suspend      ← manual suspension (billing/abuse)
POST   /api/v1/platform/tenants/{id}/unsuspend
DELETE /api/v1/platform/tenants/{id}              ← hard delete (GDPR, platform_admin only)

GET    /api/v1/platform/analytics                 ← cross-tenant KPIs
  {
    total_tenants, active_tenants,
    total_tickets_today, tickets_by_tenant[],
    sla_breach_rate_by_tenant[],
    ai_tokens_used_by_tenant[]
  }

GET    /api/v1/platform/audit-log                 ← all cross-tenant access log
  ?tenant_id=...&actor=...&from=...&to=...

GET    /api/v1/platform/users                     ← search users across all tenants
  ?email=...                                      ← support: "find which tenant this user is in"
```

When a platform user supplies `X-Tenant-ID` header, **all existing tenant endpoints work normally** — tickets, assets, KB, admin. They see that tenant's data as if they were that tenant's admin.

---

## Platform Roles — Permissions

| Action | platform_admin | platform_support |
|---|:---:|:---:|
| List / view all tenants | ✓ | ✓ |
| View cross-tenant analytics | ✓ | ✓ |
| View audit log | ✓ | ✓ |
| Search users across tenants | ✓ | ✓ |
| Access any tenant's data (with X-Tenant-ID) | ✓ read+write | ✓ read-only |
| Suspend / unsuspend tenant | ✓ | — |
| Modify tenant settings | ✓ | — |
| Delete tenant | ✓ | — |
| Impersonate a tenant user | — | — (never — use audit log instead) |

`platform_support` is **read-only** across all tenants — for debugging/support tickets without the risk of accidental data mutation.

---

## New ER Entities for Platform Tier

```
platform_audit_log
├── id              UUID v7 PK
├── actor_id        VARCHAR        ← IAM idpSub of the platform user
├── actor_email     VARCHAR        ← denormalized for readability (IAM user may be deleted)
├── platform_role   ENUM (platform_admin, platform_support)
├── tenant_id       FK tenants     ← which tenant was accessed
├── http_method     VARCHAR        ← GET / POST / PATCH etc.
├── endpoint        VARCHAR        ← /api/v1/tickets
├── request_id      VARCHAR        ← links to structured log
├── ip_address      VARCHAR
└── accessed_at     TIMESTAMPTZ
INDEX (tenant_id, accessed_at)
INDEX (actor_id, accessed_at)
-- Immutable: INSERT only, no UPDATE/DELETE ever
-- Retained: minimum 2 years (compliance)
```

---

## Summary Diagram

```
┌───────────────────────────────────────────────────────────────┐
│  IAM                                                          │
│                                                               │
│  ┌─────────────────────┐    ┌───────────────────────────┐    │
│  │  99Technologies Org │    │  Customer Org (Acme Corp) │    │
│  │  admin  → platform  │    │  admin     → tenant admin │    │
│  │  operator → support │    │  operator  → agent        │    │
│  └────────┬────────────┘    │  user      → end_user     │    │
│           │  JWT            │  bot       → svc account  │    │
│           │  org_id =       └──────────┬────────────────┘    │
│           │  PLATFORM_ORG_ID           │  JWT                │
└───────────┼────────────────────────────┼─────────────────────┘
            │                            │
            ▼                            ▼
┌───────────────────────────────────────────────────────────────┐
│  ITSM                                                         │
│                                                               │
│  platform user?                   tenant user?                │
│  ├── /api/v1/platform/*           └── normal tenant access    │
│  │   (all tenants)                    (own tenant only)       │
│  └── + X-Tenant-ID header                                     │
│       → access specific tenant                                │
│       → every access logged in platform_audit_log             │
└───────────────────────────────────────────────────────────────┘
```

---

## What ITSM Never Does

| Action | Who does it |
|---|---|
| Store passwords | IAM only |
| Issue tokens | IAM only |
| Manage org billing | IAM only |
| Create/delete IAM users | IAM only |
| Manage product subscriptions | IAM only |

ITSM only **reads** identity from IAM via JWT claims and the sync job.
It **never writes back** to IAM (except the one-time Application registration of its roles).
