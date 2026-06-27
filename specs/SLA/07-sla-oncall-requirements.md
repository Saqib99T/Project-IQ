# IQ-ITSM — SLA Management & On-Call / Incident Response
## Detailed Requirements (PRD)

> Companion to `02-requirements.md`. This document specifies two new modules:
> **Module A — SLA Management** (full SLA lifecycle: definitions, agreements, tracking, reporting)
> **Module B — On-Call & Incident Response** (PagerDuty/Rootly/incident.io-class SRE module)
>
> Both modules reuse the existing identity, ticketing, notification, AI, and platform-tier
> foundations. All conventions from `02-requirements.md` and `06-engineering-standards.md`
> apply unchanged: UUID v7 PKs, OIDC Resource Server auth, RLS multi-tenancy, immutable audit
> logs, Pydantic v2 strict validation, async Celery for all non-blocking work, structured JSON
> logging, OpenTelemetry with `tenant_id` baggage, and per-tenant feature flags.

---

## 0. Competitive Landscape & Design North Star

Before the requirements, the positioning that shapes every decision below.

| Tool | What it does best | What we borrow | What we improve on |
|---|---|---|---|
| **PagerDuty** | Mature alerting, escalation policies, event orchestration, huge integration catalogue | Escalation-policy model, notification-rule engine, event de-duplication | Bundled (not a separate $$ product); AI triage native; no per-feature upsell |
| **Opsgenie** (Atlassian, sunsetting into JSM) | Flexible schedules, routing rules, heartbeats | Rotation/override schedule model, alert routing rules | Survivable roadmap; not locked to Jira |
| **incident.io** | Slack-native incident lifecycle, beautiful timeline, retrospectives, Catalog | Incident lifecycle states, role assignment (IC/Comms/Ops), auto-generated timeline, retro workflow | Channel-agnostic (Slack + Teams + in-app); KB auto-draft from our existing engine |
| **Rootly** | Workflow automation, Slack-first, status pages, SLO tracking, AI editor | Workflow automation triggers, status-page concept, SLO/error-budget tracking | Tied into our CMDB impact-analysis graph for blast-radius |
| **FireHydrant** | Runbooks/playbooks, service catalog, severity matrix, maintenance windows | Runbook engine, severity matrix, maintenance windows | Unified with asset CMDB; no separate catalog to maintain |
| **Xurrent** (formerly 4me) | True multi-tenant SLA/OLA/UC chains, service hierarchy | OLA + Underpinning Contract chaining, SLM coverage windows | AI-native; modern API-first; faster to value |

**Design North Star — three principles:**

1. **One graph, not two products.** SLA, on-call, incidents, tickets, assets and KB share one data
   model. An incident knows which assets are affected (via the existing `asset_relationships` CMDB
   graph), which SLAs are at risk, who is on call, and which KB runbook applies — without
   integration glue.

2. **Smart by default, manual when needed.** AI proposes severity, assigns responders, drafts the
   incident summary and the post-incident review, and predicts SLA breach before it happens.
   A human can always override; every override is a training signal (same HITL gold-dataset
   pattern as ticket classification).

3. **Fast, opinionated, channel-agnostic.** Declaring an incident is one action. Routing a page is
   sub-second. Status updates fan out to Slack, Teams, in-app, email, SMS and a public status page
   from a single write.

---

# MODULE A — SLA MANAGEMENT

## A.1 Concept Model & Terminology

The existing `sla_policies` table is a flat response/resolution timer. This module promotes SLA into
a first-class **Service Level Management (SLM)** capability with the industry-standard three-tier
agreement chain:

| Term | Definition | Party |
|---|---|---|
| **SLA** (Service Level Agreement) | Commitment to the customer/requester | Provider → Customer |
| **OLA** (Operational Level Agreement) | Internal commitment between teams that supports the SLA | Team → Team |
| **UC** (Underpinning Contract) | Commitment from an external vendor that supports the SLA | Vendor → Provider |

An SLA is **underpinned** by one or more OLAs and UCs. If a UC (e.g. a cloud vendor's repair time)
is breached, the system can attribute the parent SLA breach to the vendor — critical for MSP and
enterprise reporting.

**Other core concepts:**
- **SLA Target** — a single measurable clock within an agreement (e.g. "respond within 15 min",
  "resolve within 4 h"). One agreement has many targets, scoped by priority/type/category.
- **Coverage Window (Service Hours)** — when the clock runs (extends the existing
  `business_hours_config`; supports multiple named calendars, e.g. "24×7", "Follow-the-Sun EMEA").
- **SLA Event** — an immutable record of every clock state change (started, paused, resumed,
  breached, met, cancelled) for auditability and reporting.
- **Pause/Stop Condition** — declarative rules for when a clock pauses (e.g. status = `pending`,
  waiting on customer, waiting on vendor).

---

## A.2 Functional Requirements

### A.2.1 SLA Definitions (Agreements & Targets)
- Tenant admins define named **SLA agreements** with one or more **targets**.
- A target specifies: metric type (`first_response`, `next_response`, `periodic_update`,
  `resolution`, `time_to_acknowledge`, `time_to_mitigate`), the duration, the priority/type/category
  scope it applies to, and the coverage window it uses.
- Support for **multiple response targets**: first-response *and* recurring "every-N-hours update"
  targets (matches enterprise SLAs that mandate periodic communication, a gap in Freshservice).
- **OLA and UC definitions** authored the same way, linked to a parent SLA target as underpinning
  commitments, with the responsible team (OLA) or vendor (UC) attached.
- Versioning: editing an active agreement creates a new version; in-flight tickets keep the version
  attached at assignment time (no retroactive breach). Mirrors KB article versioning.

### A.2.2 SLA Assignment & Matching
- A ticket/incident is matched to an SLA at creation via a **priority-ordered rule set**
  (first match wins): conditions on `type`, `priority`, `category`, `product`, `department`,
  `tag`, `requester` VIP flag, affected-asset criticality (pulled from CMDB).
- Manual override allowed by agents with permission; override is logged to `ticket_history`.
- If no rule matches → tenant default SLA (or none, configurable).
- AI assist: when no rule matches confidently, the classifier suggests the closest SLA with a
  confidence score (reuses `ai_ticket_classifications` pattern).

### A.2.3 SLA Tracking Engine (extends existing pause/resume)
The existing single-pause model in `02-requirements.md §3.7` is generalised:

- Each active target maintains its own clock with independent due time.
- **Coverage-window aware**: elapsed time only accrues during the target's service-hours calendar
  (nights/weekends/holidays excluded unless the window is 24×7). All math in DB server time —
  never application clock (unchanged rule).
- **Multiple, named pause conditions** rather than the single `pending` status: a target can be
  configured to pause on any subset of (`waiting_on_customer`, `waiting_on_vendor`,
  `pending_approval`, `scheduled`). Each pause writes an `sla_event` with the reason.
- **Stop conditions**: a `first_response` target stops permanently on the first public agent reply;
  a `resolution` target stops on `resolved`. Stop ≠ pause (cannot resume).
- **Breach attribution**: when a target breaches, the engine inspects underpinning OLAs/UCs that
  were also breached and records the attributed party (internal team or vendor).
- **Pre-breach warnings** at configurable thresholds (default 50 % / 75 % / 90 % of budget consumed)
  → notification to assignee + team lead, and (Module B) optional auto-page.

### A.2.4 SLA Breach Prediction (AI)
- A Celery beat task scores every open, SLA-bound ticket every 5 min for **breach risk** using:
  remaining budget, current queue depth, assignee load, historical resolution time for that
  category/priority, and number of reassignments.
- Tickets predicted to breach before due (risk > 0.7) are flagged in the UI and can trigger a
  workflow (reassign, escalate, page). This is the SLA-specific realisation of the
  "SLA breach prediction" insight already listed in `02-requirements.md §7A.10`.
- Stored in `ai_sla_predictions`; HITL feedback (did it actually breach?) feeds the gold dataset.

### A.2.5 SLA Reporting & Analytics
The reporting surface enterprises and MSPs evaluate on. All reports are tenant-scoped, exportable
(CSV/Excel/PDF), and schedulable (weekly digest email, reusing notification infra).

| Report | Description |
|---|---|
| **SLA compliance %** | Met vs breached, by agreement / priority / team / category / time period |
| **Breach detail log** | Every breach with attributed party (team/vendor via OLA/UC chain), elapsed vs budget, pause history |
| **Time-in-status / cycle-time** | Average and percentile time per status; bottleneck identification |
| **First-response & resolution percentiles** | P50/P90/P95/P99 — not just averages (averages hide tail pain) |
| **OLA/UC performance** | Internal team and vendor performance against underpinning commitments |
| **At-risk live board** | Real-time view of tickets approaching breach, sorted by time-to-breach |
| **Trend & forecast** | Compliance trend over time; AI volume forecast by category (ties to §7A.10) |
| **Per-tenant SLA scorecard** (platform tier) | Cross-tenant SLA health for 99T platform admins / MSP resellers |

- Metrics are pre-aggregated nightly into a rollup table (`sla_metrics_daily`) for fast dashboards;
  live boards query the operational tables directly with the 30 s statement timeout.

### A.2.6 Coverage Windows / Service Hours
- Generalises `business_hours_config` from one-per-tenant to **many named calendars** per tenant.
- Each calendar: timezone, work days, work window(s) (supports split shifts), holiday list, and a
  `247` boolean for round-the-clock targets.
- A "Follow-the-Sun" composite calendar can union multiple regional calendars (used by global SLAs
  and by Module B's follow-the-sun on-call).
- Backward-compatible: existing single `business_hours_config` row becomes the tenant's "Default"
  calendar on migration.

---

## A.3 SLA Permissions Matrix

| Action | end_user | agent | team_lead | manager | admin |
|---|:---:|:---:|:---:|:---:|:---:|
| View SLA status on a ticket | ✓ (own) | ✓ | ✓ | ✓ | ✓ |
| View SLA reports / dashboards | — | ✓ (own team) | ✓ (team) | ✓ | ✓ |
| Override SLA on a ticket | — | — | ✓ | ✓ | ✓ |
| Create / edit SLA agreements & targets | — | — | — | ✓ | ✓ |
| Create / edit OLAs & UCs | — | — | — | ✓ | ✓ |
| Manage coverage windows / calendars | — | — | — | ✓ | ✓ |
| Manage SLA matching rules | — | — | — | ✓ | ✓ |
| Schedule / export reports | — | — | ✓ | ✓ | ✓ |

---

## A.4 SLA API Endpoints

```
# Agreements & targets
GET    /api/v1/sla/agreements
POST   /api/v1/sla/agreements
GET    /api/v1/sla/agreements/{id}
PATCH  /api/v1/sla/agreements/{id}                 ← creates new version
DELETE /api/v1/sla/agreements/{id}                 ← soft delete; in-flight tickets unaffected
GET    /api/v1/sla/agreements/{id}/versions
POST   /api/v1/sla/agreements/{id}/targets
PATCH  /api/v1/sla/targets/{id}
DELETE /api/v1/sla/targets/{id}

# OLA / UC underpinning chain
POST   /api/v1/sla/targets/{id}/underpinning       { kind: "ola"|"uc", team_id|vendor_id, duration }
GET    /api/v1/sla/targets/{id}/underpinning
DELETE /api/v1/sla/underpinning/{id}

# Matching rules
GET    /api/v1/sla/rules
POST   /api/v1/sla/rules                            ← priority-ordered
PATCH  /api/v1/sla/rules/{id}
PATCH  /api/v1/sla/rules/reorder                    { ordered_ids: [...] }

# Coverage windows
GET    /api/v1/sla/coverage-windows
POST   /api/v1/sla/coverage-windows
PATCH  /api/v1/sla/coverage-windows/{id}

# Per-ticket SLA state
GET    /api/v1/tickets/{id}/sla                     ← all targets, clocks, % consumed, predicted breach
POST   /api/v1/tickets/{id}/sla/override            { agreement_id, reason }
GET    /api/v1/tickets/{id}/sla/events              ← immutable clock event log

# Reporting
GET    /api/v1/sla/reports/compliance               ?group_by=team|priority|category&from=&to=
GET    /api/v1/sla/reports/breaches                 ?attributed_to=team|vendor
GET    /api/v1/sla/reports/cycle-time
GET    /api/v1/sla/reports/at-risk                  ← live board
GET    /api/v1/sla/reports/ola-uc-performance
POST   /api/v1/sla/reports/schedule                 { report, cadence, recipients[] }
GET    /api/v1/sla/reports/export                   ?report=...&format=csv|xlsx|pdf
```

---

# MODULE B — ON-CALL & INCIDENT RESPONSE

> The SRE-focused module. Think **PagerDuty (paging/escalation) + incident.io (incident lifecycle)
> + Rootly (workflow automation & status pages)** delivered as one bundled capability, wired into
> the existing CMDB, KB, SLA and notification engines.

## B.1 Concept Model

```
Service ──owns──► Escalation Policy ──references──► Schedule(s) ──rotate──► On-Call User
   │                                                                            │
   │                                                                            ▼
Alert (from monitor/webhook/manual) ──dedupe──► routed to current on-call ──► Page (notification)
   │                                                                            │
   └── may be promoted to ──► Incident ──► Roles (IC/Comms/Ops) ──► Timeline ──► Retrospective (PIR)
```

| Entity | Purpose |
|---|---|
| **Service** | A monitored thing (maps to an asset or asset-group via CMDB). Owns an escalation policy and a severity matrix. |
| **Schedule** | A rotation that resolves to exactly one (or layered) on-call user at any instant. |
| **Escalation Policy** | Ordered rules: page level-1 on-call, wait N min, escalate to level-2, then manager. |
| **Alert** | A single notification-worthy signal (manual or ingested). De-duplicated and grouped. |
| **Incident** | A declared, coordinated response with severity, roles, timeline and lifecycle. |
| **Page** | An individual notification attempt to a responder across one or more contact methods. |
| **Retrospective (PIR)** | Post-incident review with timeline, contributing factors, action items. |

---

## B.2 On-Call Scheduling

Modelled on Opsgenie/PagerDuty rotations but simpler to author.

### B.2.1 Schedule Definition
- **Rotation types**: daily, weekly, custom-length (e.g. 4-day), and **follow-the-sun** (chains
  regional schedules using the coverage-window calendars from Module A).
- **Layers**: a schedule can stack layers (e.g. primary + secondary on-call) — the highest-priority
  covered layer wins; gaps fall through to the next layer.
- **Handoff time & timezone** per rotation (e.g. "Mondays 09:00 Asia/Karachi").
- **Restrictions**: a rotation can be limited to certain hours/days (e.g. on-call only covers
  nights; business hours handled by the queue).
- **Participants**: ordered list of users; rotation advances through them.

### B.2.2 Overrides & Coverage
- One-off **overrides** ("cover me Friday 14:00–18:00") without editing the base rotation.
- **Swap requests**: a responder requests a swap; target accepts → override created; both notified.
- **Gap detection**: the system flags any time window with no on-call coverage and warns the
  schedule manager (a frequent real-world outage cause).
- **Who's on call now / next** resolved in < 50 ms via a cached materialised lookup; recomputed on
  schedule edit and at each handoff.

### B.2.3 Fairness & Health (smart layer)
- **Load balancing insight**: dashboard of pages-per-responder, after-hours page count, and
  longest-consecutive-on-call — surfaces burnout risk (a differentiator vs PagerDuty's bolt-on).
- AI suggestion: when building a rotation, propose an equitable distribution given historical
  alert volume per time slot.

---

## B.3 Alerting, Routing & Escalation

### B.3.1 Alert Ingestion
- **Sources**: manual creation, inbound webhook (generic JSON + presets for Datadog, Prometheus
  Alertmanager, Grafana, New Relic, Sentry, CloudWatch, Pingdom/healthchecks), and email-to-alert.
- **Routing rules** (priority-ordered, like SLA rules): map an inbound alert to a Service +
  severity based on payload fields (host, tags, monitor name, severity).
- **De-duplication & grouping**: a `dedup_key` (from source or computed) collapses repeated alerts
  into one open alert with an occurrence counter — prevents alert storms. Configurable grouping
  window.
- **Heartbeats**: a Service can register a heartbeat; missing the expected ping within the interval
  auto-raises an alert (monitors the monitor).

### B.3.2 Escalation Policies
- Ordered steps, each: *target* (a schedule's current on-call, a specific user, or a team) and a
  *timeout* after which it escalates to the next step.
- **Acknowledge / resolve** from any channel (push, SMS reply, Slack/Teams button, in-app, email
  link). Ack stops escalation; no-ack within timeout escalates automatically.
- **Round-robin / notify-all** options within a step.
- **Re-escalation & re-notification** cadence for un-acknowledged alerts.
- Final step → notify manager / fall back to a backstop schedule (never page into the void).

### B.3.3 Notification Channels & Rules
- Per-user **contact methods**: push (mobile app), SMS, voice call, email, Slack DM, Teams DM.
- Per-user **notification rules**: ordered, time-delayed (e.g. "push immediately, SMS after 1 min,
  call after 3 min if still unacked"), with **high-urgency override** that bypasses Do-Not-Disturb
  for critical pages.
- **Quiet hours / DND** respected for low-urgency alerts only.
- Delivery is async (Celery, dedicated `paging` queue, highest priority) with provider retries and
  delivery-status tracking; SMS/voice via a pluggable provider (Twilio-compatible) abstraction so
  the provider can be swapped per deployment/region.

### B.3.4 Performance Requirement
- **Time-to-first-page P95 < 5 s** from alert acceptance to first notification dispatched.
- On-call resolution (who to page) must not depend on a synchronous external call.

---

## B.4 Incident Response Lifecycle

The incident.io/Rootly-class coordination layer. An incident is a specialised, higher-order object
that may originate from an alert, a ticket, or a manual declaration.

### B.4.1 Severity Matrix
- Tenant-defined severities (default SEV1–SEV4 + SEV5/maintenance), each with: name, description,
  example, default SLA targets, whether it auto-pages, and required roles.
- Optional **2-axis matrix** (impact × urgency → severity) à la FireHydrant, so severity is derived
  consistently rather than guessed.

### B.4.2 Declaration & Roles
- **One-action declare**: from an alert ("promote to incident"), a ticket ("escalate to incident"),
  or cold ("Declare incident"). Pre-fills severity (AI-suggested), affected services, and a
  generated incident channel.
- **Roles** assigned per incident: Incident Commander (IC), Communications Lead, Operations/Tech
  Lead, Scribe — configurable per tenant. Role holders get role-specific checklists.
- **Auto-staffing**: on declare, the current on-call for each affected service is pulled in, and an
  IC is suggested from the IC on-call schedule.

### B.4.3 Lifecycle States
```
declared → investigating → identified → monitoring → resolved → postmortem → closed
                                                   ↘ cancelled (false alarm)
```
- State machine enforced via the same seeded-transition-table pattern as tickets
  (`incident_status_transitions`); invalid jumps → HTTP 409 with valid next states.
- **Mitigated vs Resolved** distinction (mitigated = impact stopped; resolved = root cause fixed) —
  tracked as separate timestamps for accurate MTTM/MTTR.

### B.4.4 Timeline (auto-generated)
- Every state change, role assignment, page, ack, status update, comment, attached asset, and
  linked ticket is appended to an **immutable incident timeline** (INSERT-only, like
  `ticket_history`).
- Manual annotations and "pin to timeline" for key moments.
- The timeline is the raw material for the auto-drafted retrospective.

### B.4.5 Communications & Status Page
- **Status updates**: a single composed update fans out to subscribed channels — incident Slack/
  Teams channel, in-app, email to stakeholders/watchers, and an optional **public status page**.
- **Public status page** (Rootly/Statuspage-style): per-tenant, optionally on a custom domain
  (ties into the existing white-label add-on), lists Services and their current state, shows active
  incidents and maintenance windows, and lets external users subscribe to updates.
- **Maintenance windows**: scheduled, suppress alerts for the covered Services during the window,
  and publish to the status page (FireHydrant pattern).
- **Stakeholder updates** templated per severity (exec-friendly summary vs engineer detail).

### B.4.6 Blast-Radius via CMDB (signature differentiator)
- On declaration, the incident's affected Service(s) are run through the existing
  `asset_relationships` graph (recursive CTE, the same impact-analysis engine in
  `02-requirements.md §4.1B`) to surface downstream affected assets and **all open tickets linked
  to those assets** — instantly answering "what and who else is affected?".
- Result is attached to the incident and the timeline, and used to auto-suggest additional
  stakeholders to notify.

### B.4.7 Runbooks / Playbooks
- Per-Service or per-severity **runbooks** authored in the KB (reuse `kb_articles`; a runbook is a
  KB article tagged `runbook` and linked to a Service).
- On declare, matching runbooks are surfaced to the IC; checklist steps can be tracked to
  completion inside the incident.

---

## B.5 AI Capabilities (Module B)

Reuses the central `ai_service.py` wrapper (budget, retry, timeout, PII masking). All async; all
overridable; all logged to the HITL gold dataset.

| Capability | Trigger | Output |
|---|---|---|
| **Severity suggestion** | On declare / on alert promote | Suggested SEV from title + affected services + matrix; confidence shown |
| **Incident summary drafting** | On declare and on demand | One-paragraph "what's happening" for stakeholders, regenerated as timeline grows |
| **Real-time status-update drafting** | On request during incident | Channel-appropriate update (exec vs eng) from recent timeline events |
| **Auto-retrospective / PIR draft** | On `resolved` | Drafts timeline narrative, contributing factors, impact, and proposed action items into `ai_pir_drafts` (mirrors `ai_kb_article_drafts`) for human review |
| **Responder suggestion** | On declare | Suggests responders by past involvement with the affected service + current load |
| **Similar past incidents** | On declare | pgvector search over historical incident embeddings → "this resembles INC-2024-018" with its resolution |
| **Runbook suggestion** | On declare | Semantic match of KB runbooks to the incident description |

PIR action items can be pushed to tickets (one click → creates `service_request`/`problem` tickets
assigned to owners), closing the loop back into the core ITSM workflow.

---

## B.6 Workflow Automation Engine (Rootly/incident.io-class)

A declarative **trigger → condition → action** engine so tenants automate response without code.

- **Triggers**: alert created, incident declared, severity changed, state changed, SLA threshold
  crossed, on-call handoff, status-update posted.
- **Conditions**: any field match (severity, service, tags, time-of-day, affected-asset criticality).
- **Actions**: page a schedule, create the incident channel, post a status update, invite a role,
  create linked tickets, open a Zoom/Meet bridge (pluggable), apply a runbook, set a timer/reminder,
  call an outbound webhook.
- Versioned, testable in a dry-run mode, and every execution is logged (auditable).

---

## B.7 On-Call / Incident Permissions Matrix

Introduces SRE-specific roles layered on the existing role model (mapped from IAM the same way;
`responder` and `incident_commander` are promotable from `agent`).

| Action | end_user | responder | incident_commander | team_lead | manager | admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| View public status page | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Acknowledge / resolve a page | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Declare an incident | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Assign incident roles | — | — | ✓ | ✓ | ✓ | ✓ |
| Post status update | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| Edit / publish status page | — | — | ✓ | ✓ | ✓ | ✓ |
| Manage schedules & overrides | — | request swap | — | ✓ | ✓ | ✓ |
| Manage escalation policies | — | — | — | ✓ | ✓ | ✓ |
| Manage services & severity matrix | — | — | — | — | ✓ | ✓ |
| Manage alert routing rules | — | — | — | ✓ | ✓ | ✓ |
| Manage workflow automations | — | — | — | — | ✓ | ✓ |
| Close / cancel incident | — | — | ✓ | ✓ | ✓ | ✓ |
| Edit retrospective | — | ✓ (contrib) | ✓ | ✓ | ✓ | ✓ |

---

## B.8 On-Call / Incident API Endpoints

```
# Services & severity
GET    /api/v1/oncall/services
POST   /api/v1/oncall/services                      { name, asset_id?, escalation_policy_id }
PATCH  /api/v1/oncall/services/{id}
GET    /api/v1/oncall/severities
POST   /api/v1/oncall/severities                     ← severity matrix

# Schedules
GET    /api/v1/oncall/schedules
POST   /api/v1/oncall/schedules
PATCH  /api/v1/oncall/schedules/{id}
GET    /api/v1/oncall/schedules/{id}/oncall          ← who is on call now / at a timestamp
GET    /api/v1/oncall/schedules/{id}/gaps            ← coverage gap detection
POST   /api/v1/oncall/schedules/{id}/overrides
POST   /api/v1/oncall/schedules/{id}/swap-request
POST   /api/v1/oncall/swap-requests/{id}/accept
GET    /api/v1/oncall/who-is-oncall                  ← across all schedules for the tenant

# Escalation policies
GET    /api/v1/oncall/escalation-policies
POST   /api/v1/oncall/escalation-policies
PATCH  /api/v1/oncall/escalation-policies/{id}

# Notification rules & contact methods (per user)
GET    /api/v1/oncall/me/contact-methods
POST   /api/v1/oncall/me/contact-methods             { type: push|sms|voice|email|slack|teams }
GET    /api/v1/oncall/me/notification-rules
PUT    /api/v1/oncall/me/notification-rules          ← ordered, time-delayed steps

# Alerts
GET    /api/v1/oncall/alerts
POST   /api/v1/oncall/alerts                          ← manual; Idempotency-Key + dedup_key honoured
POST   /api/v1/webhooks/alerts/{source}               ← Datadog/Prometheus/Grafana/Sentry/generic (HMAC)
POST   /api/v1/oncall/alerts/{id}/acknowledge
POST   /api/v1/oncall/alerts/{id}/resolve
POST   /api/v1/oncall/alerts/{id}/escalate            ← manual bump
POST   /api/v1/oncall/alerts/{id}/promote             ← promote to incident
GET    /api/v1/oncall/heartbeats
POST   /api/v1/oncall/heartbeats                      ← register; ping URL returned
POST   /api/v1/oncall/routing-rules                   ← priority-ordered alert→service mapping

# Incidents
GET    /api/v1/incidents
POST   /api/v1/incidents                              ← declare (severity AI-suggested)
GET    /api/v1/incidents/{id}
PATCH  /api/v1/incidents/{id}                         ← state machine; 409 on invalid transition
POST   /api/v1/incidents/{id}/roles                   { role: ic|comms|ops|scribe, user_id }
POST   /api/v1/incidents/{id}/status-updates          ← fans out to channels + status page
GET    /api/v1/incidents/{id}/timeline                ← immutable
POST   /api/v1/incidents/{id}/timeline/annotate
GET    /api/v1/incidents/{id}/blast-radius            ← CMDB recursive traversal: assets + open tickets
GET    /api/v1/incidents/{id}/runbooks                ← matched KB runbooks
POST   /api/v1/incidents/{id}/resolve
POST   /api/v1/incidents/{id}/cancel

# Retrospective (PIR)
GET    /api/v1/incidents/{id}/retro
POST   /api/v1/incidents/{id}/retro/ai-draft          ← AI-generated draft (pending_review)
PATCH  /api/v1/incidents/{id}/retro
POST   /api/v1/incidents/{id}/retro/action-items      ← push action item → creates linked ticket

# Status page (some routes public / unauthenticated)
GET    /api/v1/status-page                            ← public; tenant resolved by domain/slug
POST   /api/v1/status-page/subscribe                  ← public; email/SMS subscription
GET    /api/v1/oncall/status-page/config
PATCH  /api/v1/oncall/status-page/config
POST   /api/v1/oncall/maintenance-windows             ← schedule; suppresses alerts + publishes

# Workflow automation
GET    /api/v1/oncall/workflows
POST   /api/v1/oncall/workflows                       ← trigger/condition/action
POST   /api/v1/oncall/workflows/{id}/dry-run
GET    /api/v1/oncall/workflows/{id}/runs             ← execution log

# Analytics
GET    /api/v1/oncall/analytics/mttr                  ← MTTA/MTTM/MTTR by severity/service
GET    /api/v1/oncall/analytics/responder-load        ← fairness/burnout dashboard
GET    /api/v1/oncall/analytics/alert-volume          ← noise analysis, top noisy services
```

---

## B.9 Non-Functional Requirements (Module B specific)

- **Paging latency**: alert→first notification P95 < 5 s; on-call resolution < 50 ms (cached).
- **Dedicated Celery queue** `paging` with the highest priority and its own worker pool — paging is
  never starved by AI/report backlog.
- **Reliability of paging path**: if Redis is down, on-call resolution falls back to a DB query
  (slower but correct); if the SMS/voice provider is down, fail over to the next provider and next
  contact method, and always record delivery status. Paging must degrade, never silently drop.
- **Idempotent ingestion**: webhook alerts use `dedup_key`; replays within the grouping window
  increment the occurrence count rather than creating duplicates.
- **Status-page read path** is cacheable/CDN-friendly and served even under heavy incident load
  (it's what customers refresh during an outage).
- **Audit**: all paging, acks, escalations, role changes and status updates are immutable timeline/
  audit records; cross-tenant platform access still flows through `platform_audit_log`.
- **Time correctness**: all schedule/rotation/SLA math uses DB server time and stored IANA
  timezones; DST transitions handled by storing wall-clock + tz, never fixed UTC offsets.

---

# SHARED — ER MODEL ADDITIONS

> New tables follow every existing convention (UUID v7 PK, `tenant_id` FK + RLS, `created_at`/
> `updated_at`, soft-delete where a user-facing resource, immutable INSERT-only for event/timeline
> tables). Only new/changed entities shown.

## SLA Module Tables

```
sla_agreements            (replaces flat sla_policies as the parent; old table kept for back-compat
├── id            UUID v7 PK                          mapping during migration)
├── tenant_id     FK tenants
├── name          VARCHAR
├── kind          ENUM (sla, ola, uc)
├── description   TEXT
├── owner_team_id FK teams NULLABLE        ← for OLA
├── vendor_id     FK vendors NULLABLE       ← for UC (reuses asset module vendors)
├── version       INT DEFAULT 1
├── is_active     BOOLEAN
├── created_at / updated_at / deleted_at

sla_targets
├── id                  UUID v7 PK
├── tenant_id           FK tenants
├── agreement_id        FK sla_agreements
├── metric              ENUM (first_response, next_response, periodic_update,
│                             time_to_acknowledge, time_to_mitigate, resolution)
├── duration_minutes    INT
├── coverage_window_id  FK coverage_windows
├── applies_priority    ENUM NULLABLE       ← scope filters; NULL = any
├── applies_type        ENUM NULLABLE
├── applies_category_id FK ticket_categories NULLABLE
├── pause_conditions    TEXT[]              ← e.g. {waiting_on_customer, waiting_on_vendor}
├── warn_thresholds_pct INT[] DEFAULT {50,75,90}
├── created_at / updated_at

sla_underpinning         (links a customer SLA target to supporting OLA/UC targets)
├── id              UUID v7 PK
├── parent_target_id FK sla_targets        ← the SLA target
├── support_target_id FK sla_targets       ← an OLA or UC target
└── PK is surrogate; UNIQUE (parent_target_id, support_target_id)

sla_rules                (priority-ordered matcher)
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── position      INT                       ← first match wins
├── conditions    JSONB                     ← {type, priority, category_id, product_id, tag,
│                                              vip, asset_criticality}
├── agreement_id  FK sla_agreements
├── is_active     BOOLEAN

coverage_windows         (generalises business_hours_config — many per tenant)
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── name          VARCHAR                   ← "Default", "24x7", "Follow-the-Sun EMEA"
├── timezone      VARCHAR
├── is_247        BOOLEAN DEFAULT false
├── work_days     INT[]
├── windows       JSONB                     ← [{start, end}] supports split shifts
├── holidays      DATE[]
├── compose_of    UUID[] NULLABLE           ← union of other coverage_windows (follow-the-sun)

sla_instances            (a target attached to a specific ticket at assignment time)
├── id                  UUID v7 PK
├── tenant_id           FK tenants
├── ticket_id           FK tickets
├── target_id           FK sla_targets
├── agreement_version   INT                 ← frozen version for no-retroactive-breach
├── due_at              TIMESTAMPTZ
├── paused_at           TIMESTAMPTZ NULLABLE
├── paused_duration_sec INT DEFAULT 0
├── pause_reason        VARCHAR NULLABLE
├── status              ENUM (running, paused, met, breached, stopped, cancelled)
├── breached_at         TIMESTAMPTZ NULLABLE
├── attributed_party    JSONB NULLABLE      ← {kind: team|vendor, id} from underpinning breach
├── created_at / updated_at
INDEX (tenant_id, status, due_at)           ← powers at-risk live board + breach beat task

sla_events               (IMMUTABLE — INSERT only)
├── id            UUID v7 PK
├── instance_id   FK sla_instances
├── event         ENUM (started, paused, resumed, warned, breached, met, stopped, cancelled)
├── reason        VARCHAR NULLABLE
├── at            TIMESTAMPTZ                ← DB NOW()
INDEX (instance_id, at)

sla_metrics_daily        (nightly rollup for fast dashboards)
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── date          DATE
├── dimension     JSONB                     ← {team_id|priority|category_id}
├── met_count / breached_count / total_count  INT
├── p50_resolve_min / p90 / p95 / p99        INT
UNIQUE (tenant_id, date, dimension)

ai_sla_predictions       (mirrors ai_ticket_classifications HITL pattern)
├── id            UUID v7 PK
├── ticket_id     FK tickets
├── instance_id   FK sla_instances
├── breach_risk   FLOAT                      ← 0–1
├── reason        TEXT
├── model_version VARCHAR
├── actual_breached BOOLEAN NULLABLE         ← ground truth for fine-tuning
├── created_at
```

## On-Call / Incident Module Tables

```
oncall_services
├── id                  UUID v7 PK
├── tenant_id           FK tenants
├── name                VARCHAR
├── asset_id            FK assets NULLABLE   ← link to CMDB for blast-radius
├── escalation_policy_id FK escalation_policies NULLABLE
├── current_state       ENUM (operational, degraded, partial_outage, major_outage, maintenance)
├── is_active           BOOLEAN
├── created_at / updated_at

severity_levels
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── name          VARCHAR                    ← SEV1..SEV5
├── rank          INT                        ← 1 = most severe
├── auto_page     BOOLEAN
├── required_roles TEXT[]                    ← {ic, comms, ops}
├── default_agreement_id FK sla_agreements NULLABLE
├── impact_urgency_map JSONB NULLABLE        ← optional 2-axis matrix

schedules
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── name          VARCHAR
├── timezone      VARCHAR
├── rotation_type ENUM (daily, weekly, custom, follow_the_sun)
├── rotation_length_hours INT NULLABLE
├── handoff_time  TIME
├── restrictions  JSONB NULLABLE             ← time/day limits
├── is_active     BOOLEAN

schedule_layers
├── id            UUID v7 PK
├── schedule_id   FK schedules
├── layer_rank    INT                        ← 1 = primary, 2 = secondary
├── participants  UUID[]                     ← ordered user ids

schedule_overrides
├── id            UUID v7 PK
├── schedule_id   FK schedules
├── user_id       FK users
├── start_at / end_at  TIMESTAMPTZ
├── origin        ENUM (manual, swap)
├── created_by    FK users

oncall_cache             (materialised "who's on call now/next" — fast path)
├── schedule_id   FK schedules
├── layer_rank    INT
├── user_id       FK users
├── from_at / to_at  TIMESTAMPTZ
PK (schedule_id, layer_rank, from_at)
INDEX (schedule_id, from_at, to_at)

escalation_policies
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── name          VARCHAR
├── repeat_count  INT DEFAULT 0              ← re-run policy N times if unacked

escalation_steps
├── id                UUID v7 PK
├── policy_id         FK escalation_policies
├── position          INT
├── target_type       ENUM (schedule, user, team)
├── target_id         UUID
├── timeout_minutes   INT
├── notify_strategy   ENUM (current_oncall, round_robin, notify_all)

contact_methods
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── user_id       FK users
├── type          ENUM (push, sms, voice, email, slack, teams)
├── value         VARCHAR                    ← phone/handle; verified flag
├── is_verified   BOOLEAN

notification_rules
├── id            UUID v7 PK
├── user_id       FK users
├── urgency       ENUM (high, low)
├── position      INT
├── delay_minutes INT                        ← 0 = immediate
├── contact_method_id FK contact_methods

alerts
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── service_id    FK oncall_services NULLABLE
├── source        VARCHAR                    ← datadog|prometheus|manual|...
├── dedup_key     VARCHAR
├── title         VARCHAR
├── payload       JSONB
├── severity_id   FK severity_levels NULLABLE
├── status        ENUM (open, acknowledged, resolved)
├── occurrence_count INT DEFAULT 1
├── incident_id   FK incidents NULLABLE      ← set if promoted
├── created_at / updated_at
UNIQUE (tenant_id, dedup_key, status) WHERE status = 'open'   ← de-dup guard
INDEX (tenant_id, status, created_at DESC)

pages                    (individual notification attempts — IMMUTABLE)
├── id            UUID v7 PK
├── alert_id      FK alerts NULLABLE
├── incident_id   FK incidents NULLABLE
├── user_id       FK users
├── contact_method_id FK contact_methods
├── status        ENUM (queued, sent, delivered, failed, acknowledged)
├── escalation_step_id FK escalation_steps NULLABLE
├── sent_at / acknowledged_at  TIMESTAMPTZ
INDEX (user_id, sent_at DESC)

heartbeats
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── service_id    FK oncall_services
├── name          VARCHAR
├── interval_sec  INT
├── last_ping_at  TIMESTAMPTZ NULLABLE
├── ping_token    VARCHAR UNIQUE

alert_routing_rules
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── position      INT
├── conditions    JSONB
├── service_id    FK oncall_services
├── severity_id   FK severity_levels NULLABLE

incidents
├── id                  UUID v7 PK
├── tenant_id           FK tenants
├── incident_number     VARCHAR              ← INC-2026-0001 (own sequence prefix)
├── title               VARCHAR
├── description         TEXT
├── severity_id         FK severity_levels
├── status              ENUM (declared, investigating, identified, monitoring,
│                             resolved, postmortem, closed, cancelled)
├── declared_by         FK users
├── declared_at         TIMESTAMPTZ
├── mitigated_at        TIMESTAMPTZ NULLABLE  ← for MTTM
├── resolved_at         TIMESTAMPTZ NULLABLE  ← for MTTR
├── affected_service_ids UUID[]
├── source_alert_id     FK alerts NULLABLE
├── source_ticket_id    FK tickets NULLABLE
├── chat_channel        VARCHAR NULLABLE      ← slack/teams channel id
├── description_embedding VECTOR(1536) NULLABLE  ← similar-incident search
├── created_at / updated_at
INDEX (tenant_id, status, declared_at DESC)
INDEX USING hnsw (description_embedding vector_cosine_ops)

incident_status_transitions   (seeded, immutable — same pattern as ticket_status_transitions)
├── from_status   ENUM
├── to_status     ENUM
└── PK (from_status, to_status)

incident_roles
├── id            UUID v7 PK
├── incident_id   FK incidents
├── role          ENUM (ic, comms, ops, scribe)
├── user_id       FK users
├── assigned_at   TIMESTAMPTZ
UNIQUE (incident_id, role)            ← one holder per role at a time

incident_timeline        (IMMUTABLE — INSERT only)
├── id            UUID v7 PK
├── incident_id   FK incidents
├── actor_id      FK users NULLABLE     ← NULL = system
├── event_type    VARCHAR              ← state_change, role_assigned, page, ack, status_update,
│                                         comment, asset_linked, annotation, pinned
├── data          JSONB
├── pinned        BOOLEAN DEFAULT false
├── at            TIMESTAMPTZ           ← DB NOW()
INDEX (incident_id, at)

incident_status_updates
├── id            UUID v7 PK
├── incident_id   FK incidents
├── author_id     FK users
├── body          TEXT
├── audience      ENUM (internal, stakeholder, public)
├── channels      TEXT[]               ← {slack, teams, in_app, email, status_page}
├── created_at

status_page_config
├── id            UUID v7 PK
├── tenant_id     FK tenants UNIQUE
├── slug          VARCHAR UNIQUE
├── custom_domain VARCHAR NULLABLE     ← ties to white-label add-on
├── is_public     BOOLEAN
├── branding      JSONB

status_page_subscriptions
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── channel       ENUM (email, sms)
├── value         VARCHAR
├── service_ids   UUID[] NULLABLE      ← subscribe to specific services or all
├── created_at

maintenance_windows
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── title         VARCHAR
├── service_ids   UUID[]
├── start_at / end_at  TIMESTAMPTZ
├── suppress_alerts BOOLEAN DEFAULT true
├── created_by    FK users

workflows                (automation engine)
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── name          VARCHAR
├── trigger       VARCHAR              ← alert_created, incident_declared, severity_changed, ...
├── conditions    JSONB
├── actions       JSONB                ← ordered action list
├── is_active     BOOLEAN
├── version       INT

workflow_runs            (execution log — IMMUTABLE)
├── id            UUID v7 PK
├── workflow_id   FK workflows
├── incident_id   FK incidents NULLABLE
├── alert_id      FK alerts NULLABLE
├── status        ENUM (success, partial, failed, dry_run)
├── result        JSONB
├── at            TIMESTAMPTZ

incident_retrospectives
├── id                  UUID v7 PK
├── incident_id         FK incidents UNIQUE
├── summary             TEXT
├── contributing_factors TEXT
├── impact              TEXT
├── status              ENUM (draft, in_review, published)
├── published_at        TIMESTAMPTZ NULLABLE

retro_action_items
├── id            UUID v7 PK
├── retro_id      FK incident_retrospectives
├── description   TEXT
├── owner_id      FK users NULLABLE
├── ticket_id     FK tickets NULLABLE   ← populated when pushed to a ticket
├── status        ENUM (open, in_progress, done)

ai_pir_drafts            (mirrors ai_kb_article_drafts)
├── id            UUID v7 PK
├── tenant_id     FK tenants
├── incident_id   FK incidents
├── summary / contributing_factors / impact / action_items  (TEXT / JSONB)
├── status        ENUM (pending_review, accepted, rejected)
├── model_version VARCHAR
├── created_at
```

**New `tenant_sequences` prefixes**: `INC` is reused conceptually but incidents use their own
year-scoped prefix to avoid collision with incident-type tickets — recommend `IR` (Incident
Response) e.g. `IR-2026-0001`, or namespace by table. Final prefix is a tenant-config decision.

---

# IMPLEMENTATION PLAN ADDITIONS (AI Agent Sessions)

> Extends `03-plan.md`. Same units (Session / Agent-Hour). These slot in after Phase 1 (ticketing)
> and Phase 2 (assets/CMDB) exist, since both modules depend on tickets, and Module B's
> blast-radius depends on the CMDB graph. Module A's SLA engine supersedes the simple pause/resume
> built in S1.3 — build the simple version first, then generalise here.

## Phase 7 — SLA Management
**3 sessions · 6 ah · After Phase 1 (ticketing) + coverage windows**

### S7.1 — 2 ah: Agreements, Targets, OLA/UC, Coverage Windows, Matching Rules
- Models + migration for `sla_agreements`, `sla_targets`, `sla_underpinning`, `sla_rules`,
  `coverage_windows`; migrate existing `business_hours_config` → Default coverage window and
  `sla_policies` → `sla_agreements`.
- `sla_service.py` (v2): agreement/target CRUD with versioning; priority-ordered rule matcher;
  reorder endpoint.
- All `/api/v1/sla/agreements`, `/targets`, `/underpinning`, `/rules`, `/coverage-windows` endpoints.

### S7.2 — 2 ah: Tracking Engine, Instances, Events, Multi-Pause, Breach Attribution
- `sla_instances` + `sla_events` models + migration.
- Generalise the clock: per-target instances, coverage-window-aware elapsed-time (DB time only),
  multi-condition pause/resume writing `sla_events`, stop vs pause semantics, breach attribution via
  underpinning chain.
- `tasks_sla.py` (v2) Celery beat (5 min): warn-threshold notifications + breach detection over
  `sla_instances` (skip paused). `/tickets/{id}/sla`, `/sla/override`, `/sla/events`.

### S7.3 — 2 ah: Reporting, Rollups, Breach Prediction (AI), Scheduled Exports
- `sla_metrics_daily` rollup + nightly Celery flush; `ai_sla_predictions` model.
- Reporting endpoints (compliance, breaches, cycle-time, at-risk live board, OLA/UC performance).
- AI breach-risk scorer (reuses `ai_service.py`) + HITL ground-truth capture.
- CSV/Excel/PDF export + scheduled report digests via notification infra.
- Tests: pause/resume math across DST + coverage windows, breach attribution, version freezing.

**Deliverable**: Full SLM — SLA/OLA/UC chains, coverage windows, predictive breach alerts, exec-grade reporting.

## Phase 8 — On-Call & Incident Response
**5 sessions · 11 ah · After Phase 2 (CMDB) + Phase 7 (SLA targets for severities)**

### S8.1 — 2 ah: Services, Schedules, Layers, Overrides, On-Call Resolution Cache
- Models/migrations for `oncall_services`, `severity_levels`, `schedules`, `schedule_layers`,
  `schedule_overrides`, `oncall_cache`.
- Rotation resolver (who's on call now/at-T) with materialised cache + recompute on edit/handoff;
  gap detection; swap requests/overrides. Schedule + who-is-oncall endpoints.

### S8.2 — 2.5 ah: Alerts, Dedup, Routing, Escalation, Notification Rules, Paging Path
- Models for `alerts`, `pages`, `escalation_policies`/`steps`, `contact_methods`,
  `notification_rules`, `heartbeats`, `alert_routing_rules`.
- Inbound webhook receivers (generic + Datadog/Prometheus/Grafana/Sentry presets, HMAC) with
  dedup_key collapsing; routing-rule matcher.
- Escalation engine + per-user time-delayed notification rules; **dedicated `paging` Celery queue**;
  pluggable SMS/voice (Twilio-compatible) abstraction; delivery-status tracking; ack/resolve from
  any channel. Heartbeat watchdog beat task.

### S8.3 — 2.5 ah: Incident Lifecycle, Roles, Timeline, Blast-Radius, Status Updates
- Models for `incidents` (+ seeded `incident_status_transitions`), `incident_roles`,
  `incident_timeline`, `incident_status_updates`; incident sequence prefix.
- One-action declare (from alert/ticket/cold), auto-staffing from on-call, state machine (409),
  mitigated-vs-resolved timestamps, auto-generated immutable timeline.
- Blast-radius endpoint reusing the CMDB recursive-CTE impact engine; status-update fan-out to
  in-app/email/Slack/Teams; runbook matching against KB.

### S8.4 — 2 ah: Status Page, Maintenance Windows, Workflow Automation Engine
- Public status page (unauthenticated read path, CDN-friendly), subscriptions, per-tenant config +
  custom domain; maintenance windows that suppress alerts + publish.
- Declarative workflow engine (trigger/condition/action), dry-run, execution log.

### S8.5 — 2 ah: Incident AI + Analytics + Tests
- AI: severity suggestion, summary + status-update drafting, similar-incident pgvector search,
  responder suggestion, auto-PIR draft (`ai_pir_drafts`); retro + action-item-to-ticket push.
- Analytics: MTTA/MTTM/MTTR, responder-load/burnout, alert-volume/noise.
- Tests: paging latency + failover, dedup, escalation timeout, state machine, blast-radius, PII
  masking on AI paths, status-page public access isolation.

**Deliverable**: SRE-grade on-call + incident response — schedules, sub-5s paging, escalation,
incident coordination with auto-timeline, CMDB blast-radius, status page, workflow automation, and
AI from triage to retrospective.

---

# BUSINESS / PACKAGING NOTES (ties to 04-bd.md)

- **On-call + incident response is a major competitive wedge.** ServiceNow charges separately for
  ITOM/Incident; PagerDuty and incident.io are entirely separate purchases. Bundling SRE-grade
  incident response into the **Pro** tier (and SLA/OLA/UC into **Growth+**) is a strong "one platform"
  message and directly attacks the "buy ITSM + buy PagerDuty + buy a status page" status quo.
- **Suggested tier mapping** (extends §5 pricing): SLA basics in Starter; full SLM (OLA/UC,
  coverage windows, reporting) in Growth; on-call, incidents, status page, workflows in Pro;
  unlimited workflows, custom AI model, multi-region paging providers in Enterprise.
- **Add-on candidates**: extra SMS/voice paging volume (metered), additional public status pages /
  custom domains, advanced incident analytics.
- **New competitive-matrix rows** to add in §8: On-call scheduling, Escalation/paging,
  Incident lifecycle + retro, Public status page, Blast-radius via CMDB — all "✓ native" where the
  named competitors are "separate product $" or "✗".
