# SLA/SLO + On-Call/SRE — Implementation Plan (for review)

**Status: PLAN ONLY — no code until approved.** Target repo: `itsm-service`
(backend) + `Project-IQ-V2` (portal/itsm-app UI), branch `V3-improve`,
local-first. Source of truth: [07-sla-oncall-incident-requirements.md](07-sla-oncall-incident-requirements.md)
(the 2259-line PRD; the 999-line file is an earlier version — superseded).

Goals being satisfied:
1. **Define, track, manage SLAs/SLOs** → Module A (Phase A, + SLO telemetry later).
2. **SRE / PagerDuty-style on-call** ("who's on support", paging, incidents) → Module B (Phases B–D).

---

## 1. Current state — what exists vs. what the PRD wants

| Area | Exists today (itsm-service) | PRD wants |
|---|---|---|
| SLA policy | `SLAPolicy` (`sla_policies`): priority matrix, `business_hours_only`, `is_default` | Versioned `sla_definitions` + `sla_objectives` + `sla_agreements` + SLI/SLO |
| Per-ticket SLA | ticket fields `sla_policy_id`, `sla_response_due`, `sla_resolve_due`, `sla_breached`, `sla_paused_at`, `sla_paused_duration_sec` | `sla_runtime_instances` + `sla_runtime_objectives` + immutable pause/breach events + **snapshot** |
| Engine | `SLAService.calculate_due_times` / `calculate_sla_pause_resume` / `_add_working_minutes` | Multi-timer engine (response/ack/mitigate/restore/resolve/RCA/update), calendar+holiday math, DB-clock |
| Worker | `tasks_sla.check_sla_breaches` (notify + auto-escalate priority) | 1-min critical / 5-min standard cadence, warnings, snapshot-based reporting |
| Matching | Implicit (default policy) | Specificity-ordered matcher + machine-readable "why this SLA" + preview |
| On-call / SRE | **None** (no service/schedule/alert/incident/escalation models) | Entire Module B (~35 tables) — greenfield |
| Reporting | `reports_service` (ticket metrics) | SLA compliance/at-risk/breach + customer/exec reports + async export |

**Reuse:** IAM JWT + tenant RLS, Celery, Redis, Socket.IO, notifications, AI-budget
controls, `automation_service`, the existing breach worker, and the existing
ticket SLA fields (kept as a denormalized cache of the active runtime instance).

---

## 2. Foundational architecture decisions (please confirm in review)

1. **New tables, not in-place mutation of `sla_policies`.** Introduce
   `sla_definitions`/`objectives`/`agreements`/`runtime_*`. Migrate each existing
   `SLAPolicy` into an `sla_definition` (v1) with response/resolution objectives.
   Keep `sla_policies` + ticket `sla_*` fields as a **read cache** of the active
   runtime instance for backward compatibility (the bot, reports, and current UI
   keep working). Cut the breach worker over to the runtime model in Phase A.
2. **Runtime instance + snapshot is the source of truth.** On SLA apply, write
   `sla_runtime_instances` + a JSON **snapshot** (definition version, calendar,
   per-objective targets/due_at) so historical reports never change when a policy
   is edited (PRD §3.5.3, §3.12).
3. **All SLA time math uses DB time + stored calendars**, never the app clock
   (PRD §3.12). Extend `_add_working_minutes` into a calendar service backed by
   `sla_calendars` + `sla_calendar_exceptions` (holidays).
4. **Idempotent, auditable state transitions.** Every pause/resume/warn/breach is
   an append-only event row + audit entry; transitions keyed so re-runs are no-ops.
5. **Incidents are a distinct object with their own `INCID` sequence** (resolves
   open decision #3) — reusing the global ticket sequence would conflate SRE
   incidents with tickets. Linked to tickets/alerts/services via link tables.
6. **Paging MVP = in-app + email + Slack/Teams via existing notification/webhook
   rails; SMS/phone abstracted behind a provider interface** (open decisions
   #2/#7) — no telco dependency at launch; `notification_profile_steps` model
   supports adding channels later.
7. **Tenant isolation** via the existing RLS pattern on every new table; platform
   audit log for cross-tenant admin actions (PRD §8, risk: data leakage).

---

## 3. Phased delivery

Each phase is one or more self-contained increments: **itsm-service**
(models → Alembic migration → repo/service → API router → worker) → **UI**
(portal admin + operator + itsm-app) → **tests** (pytest + CI). Same pattern as
existing modules. Migrations continue from head `0022`.

### Phase A — SLA/SLO Foundation  *(goal #1; builds on existing engine)*
**Tables:** `sla_definitions`, `sla_definition_versions`, `sla_objectives`,
`sla_agreements`, `sla_agreement_consumers`, `sla_runtime_instances`,
`sla_runtime_objectives`, `sla_pause_events`, `sla_breach_events`, `sla_waivers`,
`sla_calendars`, `sla_calendar_exceptions`, `sli_definitions`, `slo_definitions`,
`slo_measurements` (16). Migration(s) `0023+`, incl. data-migrate existing policies.
**Engine:** multi-timer (response/resolution/+ack/restore/RCA stubs), calendar+holiday
math, multi-pause/resume with immutable history, snapshot writer, specificity matcher
+ match-explanation, match-preview.
**API:** §3.11.1–3.11.5 — definitions (+activate/deprecate/clone/versions), agreements
(+compliance/report), `match-preview`, `tickets/{id}/sla` + override/pause/resume/
recalculate/waive-breach, calendars (+exceptions), reports (overview/compliance/
breaches/at-risk).
**Worker:** replace breach detector with snapshot-based 1-min(critical)/5-min(standard)
scan emitting warnings + breaches + escalations.
**UI:** SLA admin (definition wizard, objectives, calendar editor, agreement builder,
rule-preview), ticket **SLA panel** with countdown + "why this SLA", SLA dashboards
(compliance/at-risk/breaches). SLO: definition + measurement view (telemetry ingestion
API; dashboards). 
**SLI/SLO note:** model + ticket-derived SLIs (first-response/resolution/MTTA/MTTR)
now; external telemetry ingestion (uptime/latency) is a thin API in A, dashboards in D
(open decision #4).
**Acceptance:** PRD §12.1.

### Phase B — On-Call Foundation  *(goal #2 core: "who's on support")*
**Tables:** `services`, `service_dependencies`, `service_assets`, `on_call_schedules`,
`on_call_schedule_layers`, `on_call_schedule_participants`, `on_call_overrides`,
`shift_swap_requests`, `notification_profiles`, `notification_profile_steps`,
`escalation_policies`, `escalation_policy_steps`. Team additions
(`default_schedule_id`, `default_escalation_policy_id`, `team_type`,
`load_balancing_strategy`).
**Engine:** schedule resolver (layers + rotations + overrides → who's on call at T),
**on-call resolution cache** (Redis), escalation-policy evaluator + `test` endpoint,
route-ticket-to-current-on-call (extends the existing least-loaded assignment).
**API:** §4.20.1 services, §4.20.2 schedules (+ `who-is-on-call`, layers, preview),
§4.20.3 overrides/swaps, §4.20.4 escalation policies (+test/audit).
**UI:** visual schedule builder, "who's on call now" board, override/swap flows,
notification-profile editor, escalation-policy builder, service catalog (basic).
**Acceptance:** PRD §12.2.

### Phase C — Alerting + Incident Core
**Tables:** `alerts`, `alert_events`, `alert_suppressions`, `alert_dedup_groups`,
`routing_rules`, `routing_decisions`, `escalation_runs`, `escalation_run_steps`,
`incidents`, `incident_services`, `incident_roles`, `incident_alerts`,
`incident_tickets`, `incident_timeline_events`, `incident_status_updates`. `INCID`
sequence. Ticket FKs (`service_id`, `sla_runtime_instance_id`, `routed_by_rule_id`,
`routing_decision_id`, `on_call_assignment_id`), `ticket_alerts`/`ticket_incidents`.
**Engine:** alert ingestion webhook + dedup/grouping, routing engine (targets/inputs/
strategies) + explanation + preview, escalation **runs** (persisted, retried,
multi-channel) → the paging path, incident lifecycle (declare→ack→mitigate→restore→
resolve→close) + roles + auto-timeline + status updates. Socket.IO incident room feed.
**API:** §4.20.5 alerts, §4.20.6 routing, §4.20.7 incidents (full).
**UI:** alert inbox (reuse P3 alert-inbox), incident console + timeline + room, routing
rule simulator, escalation run viewer.
**Acceptance:** PRD §12.3.

### Phase D — SRE Maturity
**Tables:** `runbooks`, `runbook_steps`, `incident_runbook_runs`,
`incident_runbook_step_runs`, `postmortems`, `postmortem_actions`,
`status_page_components`, `status_page_incidents`, `status_page_updates`.
**Features:** service catalog depth + dependency graph + impact analysis, runbooks/
playbooks (link KB), status pages (internal; external per open decision #1),
postmortems (+actions, KB draft), reliability dashboards, on-call health/load,
SLO telemetry dashboards.
**API:** §4.20.8 runbooks, §4.20.9 postmortems, §4.20.10 reports, services impact/
reliability.

### Phase E — AI & Optimization
SLA breach prediction, AI routing suggestion + explanation, AI incident brief, AI
postmortem draft, alert noise-reduction recommendations — all behind the existing
**AI-budget controls**, marked as suggestions, human-approval required for
status/RCA/publish (PRD §4.18, §3.9, risk: hallucination). Gold dataset capture for
routing/escalation outcomes.

---

## 4. Cross-cutting (every phase)

- **Permissions:** map PRD §3.10 / §4.19 onto IAM roles via the existing
  `_IAM_TO_TENANT_ROLE`; add SLA-admin / on-call-admin / incident-commander
  capabilities. No new auth system.
- **Audit & immutability:** append-only event tables + platform audit log;
  pause/breach/escalation/incident-timeline rows never updated in place (§8).
- **Observability:** metrics + tracing + logs per §9 (breach-detector lag,
  paging delivery, routing decisions).
- **NFR budgets:** due-calc <50ms P95, dashboards <500ms P95 via rollups/
  materialized summaries, async report export (§3.12, §10).
- **Tests:** unit (engine/calendar/matcher/resolver), API (RBAC + tenant
  isolation), worker, and a regression for the existing breach behavior so we
  don't break current SLA tickets. Runs in itsm CI.

## 5. Sequencing, dependencies, estimate

```
A (SLA) ──┐
          ├─> C (alerts/incidents need B's escalation + on-call) ──> D ──> E
B (on-call)┘
```
A and B are independent and can proceed in parallel; **C depends on B**
(escalation/on-call) and on A (incident SLAs); D depends on C; E depends on C/D.
Rough scale: A ≈ 3 increments, B ≈ 2, C ≈ 3, D ≈ 2–3, E ≈ 2 — i.e. a multi-session
program, delivered phase-by-phase with each phase shippable on its own.

## 6. Open product decisions (need your answers — PRD §14)

| # | Decision | Plan's default (changeable) |
|---|---|---|
| 1 | External status pages MVP vs Phase D | **Phase D** (internal first) |
| 2 | SMS/phone paging native vs abstracted | **Abstracted** behind provider iface |
| 3 | Incident numbering: reuse ticket vs `INCID` | **Distinct `INCID`** |
| 4 | SLO telemetry ingestion now vs later | **Model+API now, dashboards Phase D** |
| 5 | Customer penalty/credit calc in MVP | **Defer** (model field only) |
| 6 | First chat integration: Slack / Teams / both | **Reuse existing** notify rails; pick later |
| 7 | On-call mobile push at launch | **Email/Slack/Teams MVP**, push later |

## 7. Risks (PRD §13) — carried into design
Paging reliability (persisted escalation runs + retries + fallback), SLA calc
complexity (snapshots + central engine + DB-time + tests), routing misconfig
(simulator + explanations + audit + safe defaults), alert noise (dedup/suppression/
grouping), on-call burnout (load/fairness/caps), AI hallucination (human-gated),
cross-tenant leakage (RLS + JWT + audit).

---

## 8. Recommended first increment (on approval)
**Phase A, slice 1:** `sla_definitions` + `sla_objectives` + versions + calendars
(migration), data-migrate existing `SLAPolicy` → definition v1, the calendar +
multi-timer engine with snapshot, `GET/POST /sla/definitions` + `match-preview` +
`GET /tickets/{id}/sla`, and the ticket **SLA panel** (countdown + "why this SLA").
Leaves the current breach worker running until slice 2 swaps it to the runtime model.
No behavior regressions for existing SLA tickets.

---

# 9. System Integration & UX

**Design principle:** reuse the existing object graph and rails (tickets, teams,
assets, KB, notifications, Socket.IO, IAM, Celery) — every new capability hangs
off an existing object, so it lands as native ITSM rather than a parallel stack.

## 9.1 Integration map (existing subsystem → how the modules plug in)

| Existing subsystem | Integration |
|---|---|
| **Tickets** (`tickets`, `TicketEditPanel`) | New FKs `service_id`, `sla_runtime_instance_id`, `routing_decision_id`, `on_call_assignment_id`. On create → SLA **matcher** writes a runtime instance + snapshot; **routing engine** can assign to the current **on-call** person (extends today's least-loaded assignment). SLA panel replaces static `sla_response_due`/`sla_resolve_due` display. |
| **Teams** | Gain `default_schedule_id`, `default_escalation_policy_id`, `team_type`, `load_balancing_strategy`. A team owns an on-call schedule + escalation policy. |
| **Assets** | Linked to **services** via `service_assets` → blast-radius / impact analysis in incidents. |
| **KB** | Runbooks link to KB articles; postmortems spawn KB drafts; incident resolution attaches KB. |
| **Notifications** (`notification_service`) | Becomes the **paging transport** (in-app/email + Slack/Teams webhooks); new types `on_call_shift_starting`, `alert_triggered`, `incident_declared`, `sla_breach_warning`. |
| **Alert inbox** (shipped P3) | Becomes the **alert → incident** surface (alerts dedup/route, `declare-incident`). |
| **Automation** (`automation_service`) | New triggers/actions: SLA warning → notify, incident declared → run runbook, breach → escalate. |
| **IAM** (`_IAM_TO_TENANT_ROLE`) | New capabilities on existing roles: SLA admin, on-call admin, incident commander, responder — no new auth system. |
| **Virtual agent / bot** (widget) | New intents: "who's on call for X?", "declare an incident", "what's my ticket's SLA?" — extends existing handoff. |
| **Operator console** (`SessionView`) | Incident-room view + live SLA countdown on the handled ticket. |
| **Reports** (`reports_service`) | SLA compliance/at-risk + SRE MTTR/MTTA/load dashboards from snapshot data. |
| **AI budget controls** | All AI (breach prediction, incident brief, postmortem draft) runs under existing budget guardrails, human-gated. |

Reused infra unchanged: tenant RLS on every new table; Celery for breach/escalation
scans; Redis for on-call resolution cache; Socket.IO for the incident room (same
rails as chat handoff).

## 9.2 UI placement (additions per surface)

```
PORTAL (admin)                         ITSM-APP (admin hub)
├─ ITSM                                ├─ Admin → SLA          (definitions, calendars, agreements)
│   ├─ Tickets   (+ SLA panel)         ├─ Admin → Services     (catalog, dependencies)
│   ├─ Services        ← new           └─ Admin → On-Call      (schedules, escalation policies)
│   ├─ SLA             ← new
│   ├─ On-Call         ← new           OPERATOR CONSOLE
│   ├─ Incidents       ← new           ├─ Queue / My Sessions (existing)
│   └─ Status Page     ← new (Phase D) ├─ Incidents      ← new (declare/command/timeline)
├─ Organization                        └─ Session view  (+ live SLA countdown)
│   ├─ Alerts   (existing → alerts)
│   └─ Reliability     ← new dash      WIDGET / BOT
└─ Platform (super_admin)              └─ "who's on call", "declare incident",
    └─ Routing Rules (existing, extend)    SLA status answers
```

## 9.3 End-to-end flows

**A. Admin setup (one-time)**
```
SLA:     New Definition → wizard (scope, ticket types, priority matrix, objectives)
         → pick/build Calendar (business hours + holidays) → Rule Preview → Activate
On-call: New Service (owner team, tier) → New Schedule (layers/rotations + participants)
         → Preview (who's on call next 2wks) → Escalation Policy (on-call→backup→manager) → Test
```

**B. Ticket lifecycle (operator everyday)** — matcher assigns SLA, routing assigns to
current on-call; ticket detail shows SLA countdown + "why this SLA" + "why routed here";
approaching breach → warning → if unacked, escalation pages backup.

**C. Alert → incident (SRE)**
```
Monitoring webhook → Alert inbox (dedup) → [Declare Incident] → Incident console
(severity, roles, linked service + blast radius, auto-timeline, live room, runbook,
status updates) → Mitigate → Resolve → Close → (Sev1/2) Postmortem required
```

**D. SLA breach → on-call** — breach detector → SLA escalation policy → resolve team's
current on-call → page via notification profile (in-app→email→Slack) → no ack → next step.

**E. Post-incident loop** — closed → Postmortem (AI draft, human-edited) → review →
approve → publish → follow-up Actions (tracked) + optional KB draft.

**End-user/requester** sees only: SLA status on their own ticket (if agreement is
`customer_visible`) + optional status page during incidents (Phase D).

## 9.4 Phase A wireframes (SLA admin + ticket SLA panel)

> Low-fidelity, for layout/flow review — final styling follows the existing
> portal/itsm-app design system (lucide-react, Tailwind, `ReferenceDataManager`
> patterns).

**A1 — SLA Definitions list** (itsm-app Admin → SLA)
```
┌ SLA Definitions ───────────────────────────────────[ + New Definition ]┐
│ Name                          Scope        Status     Ver  Objectives   │
│ ─────────────────────────────────────────────────────────────────────  │
│ Critical Production Support   category     ● active    v3   3   [⋯]      │
│ Standard IT Support           tenant       ● active    v1   2   [⋯]      │
│ Enterprise Customer SLA       customer_org draft       v1   4   [⋯]      │
│ Change Management SLA         ticket_type  ● active    v2   2   [⋯]      │
│   [⋯] = Edit · Clone · New version · Deprecate · View versions          │
└─────────────────────────────────────────────────────────────────────────┘
```

**A2 — Definition wizard** (the core screen)
```
┌ New SLA Definition ──────────────────────────────────────────────────────┐
│  ① Scope    ② Objectives    ③ Calendar & Pause    ④ Warnings    ⑤ Review  │
│ ─────────────────────────────────────────────────────────────────────────│
│  ① SCOPE                                                                   │
│   Name        [ Critical Production Support            ]                   │
│   Applies to  Scope ▾[ category ]   Value ▾[ Production Outage ]           │
│   Ticket types ☑ incident ☑ problem ☐ service_request ☐ change            │
│                                                                            │
│  ② OBJECTIVES (priority matrix)                                            │
│   Type ▾        Priority   Target      Business-hrs   Contractual          │
│   response      critical   15 min      ☐ 24×7         ☑      [–]           │
│   resolution    critical   4 h         ☐ 24×7         ☑      [–]           │
│   update_freq   critical   30 min      ☐ 24×7         ☐      [–]           │
│   [ + Add objective ]   ↳ types: response·resolution·restore·rca·approval  │
│                                                                            │
│                                   [ Back ]   [ Save draft ]   [ Next → ]   │
└────────────────────────────────────────────────────────────────────────────┘
```

**A3 — Calendar editor** (business hours + holidays)
```
┌ Calendar: "EMEA Business Hours" ─────────────────────────────────────────┐
│ Timezone [ Europe/London ▾ ]                                              │
│ Mon ☑ 09:00–17:00   Tue ☑ 09:00–17:00   Wed ☑ 09:00–17:00                 │
│ Thu ☑ 09:00–17:00   Fri ☑ 09:00–17:00   Sat ☐ —   Sun ☐ —                 │
│ ── Holiday exceptions ───────────────────────  [ + Add exception ]        │
│   2026-12-25  Christmas        (closed)   [–]                             │
│   2026-01-01  New Year's Day   (closed)   [–]                             │
└───────────────────────────────────────────────────────────────────────────┘
```

**A4 — Match preview** (test before save / explainability)
```
┌ SLA Match Preview ───────────────────────────────────────────────────────┐
│ Paste a sample ticket:  category [ Production Outage ] priority [ critical ]│
│ customer_org [ Acme Corp ]   product [ Payments API ]      [ Evaluate ]    │
│ ───────────────────────────────────────────────────────────────────────── │
│ ✅ Matched:  Critical Production Support  (matched_by: category_default)   │
│    "Ticket category 'Production Outage' maps to this SLA."                 │
│ Due dates:  first response 12:15 · resolution 16:00                        │
│ Lost to lower priority:  Enterprise Customer SLA (customer tier mismatch)  │
└───────────────────────────────────────────────────────────────────────────┘
```

**A5 — Ticket SLA panel** (shared `TicketEditPanel` area, operator + itsm-app)
```
┌ SLA  ·  Critical Production Support ─────────────────────────────────────┐
│  ⏱ First response   due 12:15   ● 8m left      ▮▮▮▮▮▮▮▯▯▯  on track        │
│  ⏱ Resolution       due 16:00   ● 3h 41m       ▮▮▮▯▯▯▯▯▯▯  on track        │
│  ⏱ Customer update  every 30m   ⚠ 4m left      ▮▮▮▮▮▮▮▮▮▯  at risk         │
│  ↳ Selected because category = Production Outage                          │
│  ───────────────────────────────────────────────────────────────────────│
│  [ Pause ▾ ]   [ Override SLA ]   [ Recalculate ]   [ Waive breach ]      │
│  Paused 2× · total 14m (last: waiting on customer, 09:40–09:52)           │
└───────────────────────────────────────────────────────────────────────────┘
```

**A6 — SLA dashboard** (portal → ITSM → SLA, or Reliability)
```
┌ SLA Compliance ───────────────────────── [ This month ▾ ] [ Export ▾ ]───┐
│  Compliance 94.2%   At risk now 7   Breached (30d) 21   MTTR 3h 12m       │
│  ── By SLA ───────────────────────────────────────────────────────────── │
│  Critical Production Support   96%  ████████████████████░  (4 at risk)    │
│  Standard IT Support           99%  ███████████████████████ (1 at risk)   │
│  ── At-risk now (live) ─────────────────────────────────────────────────  │
│   #00231  resolution due 12:40 (6m)   #00219  response due 12:38 (4m) …   │
└───────────────────────────────────────────────────────────────────────────┘
```

These six screens + the engine/API/migration in §8 constitute the reviewable
Phase A slice-1 surface.
