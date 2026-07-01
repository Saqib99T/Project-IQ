# SLA/SLO + On-Call/SRE — Implementation Plan (for review)

**Status: PLAN ONLY — no code until approved.** Target repo: `itsm-service`
(backend) + `Project-IQ-V2` (portal/itsm-app UI), branch `V4-sla`, local-first.

**Authoritative spec: [`07-sla-oncall-requirements.md`](07-sla-oncall-requirements.md)**
(the engineering PRD with the concrete ER model + Phase 7/8 session plan). The
longer `07-sla-oncall-incident-requirements.md` is **set aside** for this plan —
its broader ideas (SLI/SLO objects, status pages MVP, etc.) are noted only where
they fill a gap.

Goals:
1. **Define, track, manage SLAs** (incl. OLA/UC chains + breach prediction) → **Phase 7**.
2. **SRE / PagerDuty-style on-call** (who's on call, paging, incidents) → **Phase 8**.
3. **True SLI/SLO/error-budget reliability tracking** (telemetry-fed, burn-rate alerts) → **Phase 9 (optional)** — see §11.

> **On "SLO":** the `07-*.md` spec centres **SLA/OLA/UC** ticket clocks + AI
> breach prediction; it does **not** define an SLO/error-budget object. So the
> *ticket-SLA* "SLO/SLA tracking" = SLA **targets** + the `sla_metrics_daily`
> rollup + `ai_sla_predictions` (Phase 7). **True SLI/SLO/error-budget** (e.g.
> "99.9% availability over rolling 28d" with an error budget + burn-rate alerts)
> is a distinct *reliability* layer — no ITSM helpdesk ships it natively (§10) —
> and is now specced as the **optional Phase 9** module (§11), fed by telemetry
> and attached to Module B's `oncall_services`, NOT the ticket-SLA engine.

---

## 1. Current state — what exists vs. this spec

| Area | Exists today (itsm-service) | This spec wants |
|---|---|---|
| SLA policy | `SLAPolicy` (`sla_policies`): flat response/resolution + `business_hours_only` + `is_default` | `sla_agreements` (kind = **sla/ola/uc**) + `sla_targets` (per-metric) + `sla_underpinning` chain |
| Per-ticket SLA | ticket fields `sla_policy_id`, `sla_response_due`, `sla_resolve_due`, `sla_breached`, `sla_paused_at`, `sla_paused_duration_sec` (single pause) | `sla_instances` (one per target, frozen version) + immutable `sla_events`; **multi-condition** pause; stop≠pause |
| Engine | `SLAService` (`calculate_due_times`, `calculate_sla_pause_resume`, `_add_working_minutes`) | coverage-window-aware clock, multi-pause, **breach attribution** via OLA/UC |
| Calendars | `SLAPolicy.business_hours_only` boolean | `coverage_windows` — many named calendars/tenant (timezone, split shifts, holidays, 24×7, follow-the-sun union) |
| Matching | implicit (default policy) | `sla_rules` — priority-ordered, first-match-wins, JSONB conditions + manual override |
| Worker | `tasks_sla.check_sla_breaches` (notify + escalate priority) | `tasks_sla` v2 (5-min beat over `sla_instances`, warn thresholds 50/75/90%, breach) + nightly `sla_metrics_daily` flush |
| Reporting | `reports_service` (ticket metrics) | compliance / breaches (attributed) / cycle-time / **at-risk live board** / OLA-UC perf + CSV/XLSX/PDF + scheduled digests |
| AI | (none for SLA) | `ai_sla_predictions` breach-risk scorer + HITL ground truth |
| On-call / SRE | **none** | entire Module B (Phase 8) — greenfield |

**Reuse:** IAM JWT + RLS, Celery, Redis, notifications, AI-budget controls, the
existing breach worker, the CMDB/asset graph (for blast-radius + asset criticality
in matching), and ticket `sla_*` fields (kept as a denormalized cache of the
active `sla_instance`). Migration head is currently **`0022`**.

---

## 2. Foundational decisions (please confirm in review)

1. **`sla_agreements` (with `kind`) supersedes `sla_policies`; don't mutate the old table in place.** Migrate each existing `SLAPolicy` → an `sla_agreement(kind=sla)` + `sla_targets` (response→`first_response`, resolution→`resolution`). Keep `sla_policies` + ticket `sla_*` fields as a read cache. Cut the worker over to `sla_instances` in S7.2.
2. **`sla_instances` + frozen `agreement_version` = source of truth.** On assignment, snapshot the version so editing an agreement never causes retroactive breach (spec A.2.1). Reports reproduce from instances/events.
3. **All clock math in DB time, coverage-window aware** (spec A.2.3) — generalise `_add_working_minutes` into a coverage-window service backed by `coverage_windows`; migrate the implicit business-hours into a "Default" window.
4. **Immutable, attributable events.** Every start/pause/resume/warn/breach/met/stop is an append-only `sla_events` row; breach inspects the OLA/UC `sla_underpinning` chain and records `attributed_party` (team or vendor).
5. **Incidents get their own year-scoped sequence** (`IR-2026-0001`, per spec §901) — distinct from incident-type tickets.
6. **Paging = pluggable Twilio-compatible abstraction** behind `contact_methods`/`notification_rules`, on a dedicated `paging` Celery queue (spec S8.2). In-app/email/Slack/Teams first; SMS/voice as a metered add-on.
7. **Vendors for UC:** reuse the asset module's vendor entity if present; otherwise add a minimal `vendors` ref in S7.1 (flagged — needs confirming against the asset schema).
8. **Tenant isolation** via existing RLS on every new table; immutable INSERT-only for `sla_events`, `pages`, `incident_timeline`, `workflow_runs`.

---

## 3. Phased delivery (this spec's Phase 7 + Phase 8)

Each session = itsm-service (models → Alembic migration → repo/service → API →
worker) → UI (portal/itsm-app) → tests. Migrations continue from `0023`.

### PHASE 7 — SLA Management  *(goal #1; 3 sessions)*

**S7.1 — Agreements, Targets, OLA/UC, Coverage Windows, Matching Rules**
- Tables: `sla_agreements`, `sla_targets`, `sla_underpinning`, `sla_rules`, `coverage_windows` (migration `0023`); data-migrate `sla_policies`→agreements, business-hours→Default window.
- `sla_service.py` v2: agreement/target CRUD **with versioning**; priority-ordered rule matcher + `/rules/reorder`.
- API: `/api/v1/sla/agreements` (+`/versions`, `/targets`), `/sla/targets/{id}/underpinning`, `/sla/rules` (+reorder), `/sla/coverage-windows`.

**S7.2 — Tracking Engine, Instances, Events, Multi-Pause, Breach Attribution**
- Tables: `sla_instances`, `sla_events` (migration `0024`).
- Generalise the clock: per-target instances, coverage-window-aware elapsed (DB time), multi-condition pause/resume → `sla_events`, stop vs pause, breach attribution via underpinning chain.
- `tasks_sla.py` v2: 5-min beat over `sla_instances` (skip paused) → warn 50/75/90% + breach. Replaces the current detector.
- API: `GET /tickets/{id}/sla`, `POST /tickets/{id}/sla/override`, `GET /tickets/{id}/sla/events`.

**S7.3 — Reporting, Rollups, Breach Prediction (AI), Scheduled Exports**
- Tables: `sla_metrics_daily` (nightly rollup), `ai_sla_predictions` (migration `0025`).
- Reports: compliance, breaches (attributed), cycle-time (P50/P90/P95/P99), **at-risk live board**, OLA/UC performance.
- AI breach-risk scorer (reuses `ai_service.py` + AI budget) + HITL ground truth.
- CSV/XLSX/PDF export (async) + scheduled digests via notification infra.
- Tests: pause/resume across DST + coverage windows, breach attribution, version freezing.

**Deliverable:** full SLM — SLA/OLA/UC chains, coverage windows, predictive breach alerts, exec-grade reporting.

### PHASE 8 — On-Call & Incident Response  *(goal #2; 5 sessions)*

- **S8.1** Services, severity levels, schedules, layers, overrides, `oncall_cache` (who's-on-call resolver + materialised cache + gap detection + swaps). Migrations `0026+`.
- **S8.2** Alerts + dedup, inbound webhooks (generic + Datadog/Prometheus/Grafana/Sentry, HMAC), `alert_routing_rules`, escalation policies/steps, `contact_methods`, `notification_rules`, `pages`, `heartbeats` — escalation engine + dedicated `paging` queue + Twilio-compatible SMS/voice + delivery tracking + ack from any channel.
- **S8.3** Incidents (+ seeded `incident_status_transitions`, `IR` sequence), roles (IC/Comms/Ops/Scribe), immutable `incident_timeline`, `incident_status_updates`; one-action declare (alert/ticket/cold) + auto-staffing from on-call; **blast-radius** via the CMDB recursive-CTE; status fan-out; runbook match vs KB.
- **S8.4** Public status page (unauth read path) + subscriptions + per-tenant config/custom domain; maintenance windows (suppress alerts); declarative **workflow** engine (trigger/condition/action) + dry-run + `workflow_runs`.
- **S8.5** Incident AI (severity suggest, summary/status drafts, similar-incident pgvector search, responder suggest, auto-PIR `ai_pir_drafts`) + retros/action-items→tickets; analytics (MTTA/MTTM/MTTR, responder load/burnout, alert noise); tests (paging latency+failover, dedup, escalation timeout, state machine, blast-radius, status-page isolation).

**Deliverable:** SRE-grade on-call + incident response with auto-timeline, CMDB blast-radius, status page, workflow automation, and AI triage→retrospective.

---

## 4. Cross-cutting (every session)
- **Permissions:** spec A.3 matrix mapped onto IAM roles via `_IAM_TO_TENANT_ROLE` (agent/team_lead/manager/admin). No new auth.
- **Audit/immutability:** INSERT-only event/timeline tables + platform audit log.
- **Observability:** OTel with `tenant_id` baggage; metrics for breach-detector lag, paging latency, escalation timeouts.
- **NFR budgets:** DB-time math, 30s statement timeout on live boards, nightly rollups for dashboards, async export, sub-5s paging.
- **Tests:** unit (clock/coverage/matcher/resolver/attribution), API (RBAC + tenant isolation), worker, and a regression for the current SLA behavior so existing tickets don't break. itsm CI.

## 5. Sequencing & dependencies
```
existing tickets + CMDB ──> Phase 7 (SLA) ──┐
                                            ├─> Phase 8 (on-call/incident; severities link SLA targets,
                                            │   blast-radius needs CMDB, incidents reuse SLA engine)
                                            ┘
```
Phase 7 is independent and first (goal #1). Phase 8 depends on Phase 7 (severity→SLA
target) and the CMDB graph. Scale per spec: Phase 7 = 3 sessions / 6 ah; Phase 8 =
5 sessions / 11 ah — delivered session-by-session, each shippable.

## 6. Recommended first increment (on approval)
**S7.1:** `sla_agreements`/`targets`/`underpinning`/`rules`/`coverage_windows`
(migration `0023`), data-migrate existing `SLAPolicy`→agreement + business-hours→
Default window, `sla_service` v2 CRUD+versioning+rule matcher, and the agreements/
targets/rules/coverage-windows API. No runtime behavior change yet (the current
breach worker keeps running until S7.2 swaps it to `sla_instances`).

## 7. Open decisions (need your answers)

| # | Decision | Recommended default |
|---|---|---|
| 1 | **Add true SLO/error-budget tracking?** (this spec omits it) | **No for now** — treat SLA targets + `sla_metrics_daily` as the SLO surface; add an `slo_objectives`/error-budget table later if needed |
| 2 | Incident sequence prefix | **`IR-YYYY-NNNN`** (spec's recommendation, avoids ticket-type `INC` collision) |
| 3 | UC vendors | **Reuse asset-module vendors** if the table exists; else minimal `vendors` in S7.1 |
| 4 | SMS/voice paging at launch | **Abstracted (Twilio-compatible), metered add-on** — in-app/email/Slack/Teams cover MVP |
| 5 | Public status page | **Phase 8 / S8.4** (not earlier) |
| 6 | First chat integration | **Reuse existing notify rails**; Slack/Teams adapter later |

## 8. Risks (carried into design)
SLA calc complexity → version freezing + DB-time + extensive tests; breach
attribution correctness → underpinning-chain unit tests; paging reliability →
persisted `pages` + retries + failover + dedicated queue; alert noise → dedup_key +
suppression + maintenance windows; AI hallucination → HITL, human-gated PIR/status;
cross-tenant leakage → RLS + JWT + audit.

---

# 9. System Integration & UX

**Design principle (spec North Star "one graph, not two products"):** every new
capability hangs off an existing object — tickets, teams, assets/CMDB, KB,
notifications, IAM, Celery — so it lands as native ITSM.

## 9.1 Integration map

| Existing subsystem | Integration |
|---|---|
| **Tickets** (`tickets`, `TicketEditPanel`) | `sla_rules` matcher attaches `sla_instances` on create (frozen version); SLA panel shows all target clocks + % consumed + predicted breach. Manual override → `ticket_history`. |
| **Teams** | OLA agreements own a team (`owner_team_id`); on-call schedules + escalation policies attach to teams. |
| **Assets / CMDB** | `sla_rules` can match on **asset criticality**; `oncall_services.asset_id` + the recursive-CTE impact engine drive incident **blast-radius**. |
| **Vendors** (asset module) | UC agreements reference a vendor; UC breach → `attributed_party = {kind:vendor}`. |
| **KB** | Runbooks match KB articles; auto-PIR can draft a KB article (`ai_kb_article_drafts` pattern). |
| **Notifications** | Warn-threshold + breach alerts; paging fan-out (in-app/email/Slack/Teams/SMS/voice); status-update + status-page broadcast. |
| **Automation** (`automation_service`) | Workflow triggers: SLA warn/breach, alert_created, incident_declared, severity_changed. |
| **IAM** | Spec A.3 / B.7 permission matrices → existing roles. |
| **Bot / operator** | "who's on call for X?", "declare incident", "ticket SLA?"; operator session view gets live SLA countdown + incident room. |
| **Reports** (`reports_service`) | SLA compliance/at-risk/OLA-UC + MTTA/MTTM/MTTR + on-call load. |
| **AI budget** | Breach prediction, incident AI, PIR drafts — all budget-gated, HITL. |

## 9.2 UI placement
```
PORTAL (admin)                         ITSM-APP (admin hub)
├─ ITSM                                ├─ Admin → SLA        (agreements, targets, OLA/UC, rules)
│   ├─ Tickets   (+ SLA panel)         ├─ Admin → Coverage   (named calendars)
│   ├─ SLA             ← new           ├─ Admin → Services    (on-call services)
│   ├─ On-Call         ← new           └─ Admin → On-Call     (schedules, escalation)
│   ├─ Incidents       ← new
│   └─ Status Page     ← new (S8.4)    OPERATOR CONSOLE
├─ Organization                        ├─ Queue / My Sessions (existing)
│   ├─ Alerts  (existing → alerts)     ├─ Incidents      ← new
│   └─ SLA / Reliability  ← dashboards └─ Session view  (+ live SLA countdown)
└─ Platform (super_admin)
    └─ Routing Rules (existing, extend) WIDGET / BOT: who's-on-call · declare incident · SLA status
```

## 9.3 End-to-end flows
- **A. SLA setup:** New Agreement (kind=sla) → add Targets (metric, duration, scope, coverage window) → link OLA/UC underpinning → matching Rules (priority-ordered, preview) → activate.
- **B. Ticket lifecycle:** create → rule matcher attaches instances → SLA panel shows per-target countdowns + "why this SLA"; 50/75/90% warnings → at risk → (Module B) optional auto-page.
- **C. Breach attribution:** target breaches → engine inspects underpinning OLA/UC → records attributed team/vendor → surfaces in breach report.
- **D. Alert→incident (Phase 8):** webhook → dedup → route → page on-call (escalation) → declare incident → roles + auto-timeline + blast-radius + status updates → mitigate → resolve → PIR.

## 9.4 Phase 7 wireframes (SLA admin + ticket SLA panel)

**A1 — SLA Agreements** (itsm-app Admin → SLA)
```
┌ SLA / OLA / UC ──────────────────────────────[ + New Agreement ]┐
│ Name                        Kind  Targets  Underpins   Ver  Active│
│ Critical Production SLA      sla    3        OLA×2 UC×1  v3   ●     │
│ Infra Team OLA               ola    2        —          v1   ●     │
│ CloudVendor Repair UC        uc     1        —          v1   ●     │
│  [⋯] Edit · New version · Targets · Underpinning · Deactivate      │
└────────────────────────────────────────────────────────────────────┘
```
**A2 — Target editor** (within an agreement)
```
┌ Targets — Critical Production SLA ───────────────────────────────────┐
│ Metric ▾          Duration  Scope (prio/type/cat)   Coverage   Warn   │
│ first_response    15 min    critical / incident     24×7       50/75/90│
│ periodic_update   30 min    critical                24×7       —       │
│ resolution        4 h       critical / incident     24×7       50/75/90│
│ [ + Add target ]   Pause on: ☑ waiting_on_customer ☑ waiting_on_vendor │
│ Underpinned by:  Infra Team OLA (resolution 3h) · CloudVendor UC (1h)  │
└────────────────────────────────────────────────────────────────────────┘
```
**A3 — Coverage window**
```
┌ Coverage Window: "Follow-the-Sun EMEA" ──────────────────────────────┐
│ Timezone Europe/London   ☐ 24×7                                       │
│ Work days  M T W T F     Window(s) 09:00–17:00  [ + split shift ]     │
│ Holidays  2026-12-25, 2026-01-01   [ + ]                              │
│ Compose of: [ EMEA ] + [ APAC ] + [ AMER ]   ← union (follow-the-sun) │
└────────────────────────────────────────────────────────────────────────┘
```
**A4 — Ticket SLA panel** (shared `TicketEditPanel`)
```
┌ SLA · Critical Production SLA (v3) ──────────────────────────────────┐
│ ⏱ First response  due 12:15  ● 8m   ▮▮▮▮▮▮▮▯▯▯   75% — warned         │
│ ⏱ Periodic update every 30m  ⚠ 4m   ▮▮▮▮▮▮▮▮▮▯   at risk              │
│ ⏱ Resolution      due 16:00  ● 3h41 ▮▮▮▯▯▯▯▯▯▯   on track             │
│ 🔮 Predicted breach risk: 0.81 (high) — queue depth + reassignments   │
│ ↳ Matched by rule #2 (category = Production Outage)                    │
│ [ Pause ▾ ] [ Override SLA ] [ View event log ]                       │
└────────────────────────────────────────────────────────────────────────┘
```
**A5 — At-risk live board + compliance** (portal → ITSM → SLA)
```
┌ SLA Compliance ───────────────────[ This month ▾ ][ Export ▾ ][Schedule]┐
│ Compliance 94.2%  At risk 7  Breached(30d) 21  P90 resolve 3h12m        │
│ Breaches attributed:  Infra OLA 6 · CloudVendor UC 3 · within-team 12    │
│ At-risk now: #00231 resolution 6m · #00219 first_response 4m …          │
└──────────────────────────────────────────────────────────────────────────┘
```

These five screens + S7.1–S7.3 backend constitute the reviewable Phase 7 surface.

---

# 10. Industry reference — how JSM / Zoho / PagerDuty do SLI/SLO/SLA

A light scan (not exhaustive) to validate our model against the market.

| Tool | "SLA" means | Calendars | Start/Pause/Stop | Scoping | Escalation | SLI/SLO / error-budget |
|---|---|---|---|---|---|---|
| **Jira Service Mgmt** | Ticket-time **goals** (a *stopwatch between two points* — e.g. time-to-first-response, time-to-resolution) | 24/7, 9–5, custom **with split shifts/lunch** | **Configurable** start/pause/stop conditions (JQL) | per priority/request-type (JQL) | breach indicators + reports + automation | **Not native.** Reliability/SLO lives in **Compass scorecards** / **Opsgenie (Operations)** — separate |
| **Zoho Desk** | Response + resolution time targets | business / calendar hours | response stops on first reply; resolution on resolved | priority / channel / **customer type** | **multi-level** escalation at **time offsets** ("30 min before breach"), reassign/notify | **Not native** |
| **PagerDuty** | Response SLAs (ack/resolve) + the platform's own **Notification-Delivery SLA** (5 min / 99.9%) | — (event-driven) | incident lifecycle timestamps (MTTA/MTTM/MTTR) | per service / urgency | escalation policies (the core paging primitive) | Defines **SLI→SLO→SLA** clearly; **error-budget SLOs come from monitoring** (Datadog/Wavefront/Nobl9), not PD itself; PD adds **scorecards / service standards** |

### The essential pattern (what everyone agrees on)
1. **In ITSM, "SLA" is a ticket-time stopwatch** — response/resolution (and other) clocks, business-hours calendars, explicit **start/pause/stop**, priority/customer scoping, **pre-breach warnings + multi-level escalation**, and breach reporting. JSM and Zoho both stop here.
2. **SLI/SLO/error-budget is a *reliability* concept, not a helpdesk one.** PagerDuty articulates the hierarchy (SLI = the measured metric → SLO = internal target → SLA = external promise, deliberately looser, with penalties), but the actual **error-budget tracking is fed by telemetry** and lives in monitoring/scorecard tools — not the ticketing SLA engine.

### What we adopt / how our plan compares
- **Phase 7 already matches the JSM/Zoho ticket-SLA model** — `sla_targets` (metrics), `coverage_windows` (split shifts + holidays), `pause_conditions`, `warn_thresholds`, `sla_rules` (priority/customer/VIP), escalation. We're at parity, **plus** OLA/UC chains + breach attribution (Xurrent-grade, beyond JSM/Zoho) + AI breach prediction.
- **Two small enhancements to reach JSM/Zoho parity exactly** (fold into S7.1/S7.2):
  - **Configurable start & stop events per target** (JSM's "stopwatch between any two points"), not only the fixed `metric` enum — e.g. start on `created` *or* `in_progress`, stop on a chosen event.
  - **Escalation triggers by absolute time-offset as well as %** (Zoho's "30 min before breach"), in addition to the 50/75/90% thresholds.
- **Adopt PagerDuty's SLI→SLO→SLA vocabulary** explicitly in our UI/docs so the three tiers aren't conflated.

### Refines Open Decision #1 (SLO/error-budget)
The market confirms this is the right call: **no ITSM helpdesk ships error-budget SLOs** — it's a reliability/SRE feature. So treating "SLO" as *SLA targets + `sla_metrics_daily`* is consistent with JSM/Zoho. **True SLI/SLO/error-budget** (SLI from a monitor/metric → SLO target + window → error budget → burn-rate alerts) is only worth building if we want to compete on the **PagerDuty/Datadog reliability axis** — and if so it belongs at the **service level fed by telemetry** (a `slo_objectives` + `sli_sources` + `slo_measurements` module alongside Module B's `oncall_services`), **not** inside the ticket-SLA engine. Recommendation stays: **defer; add as an optional reliability module** once on-call/incident (Phase 8) exists, since it shares the `services` graph.

Sources: [JSM SLA conditions](https://support.atlassian.com/jira-service-management-cloud/docs/set-up-sla-conditions/) · [JSM SLA calendars](https://support.atlassian.com/jira-service-management-cloud/docs/set-up-sla-calendars/) · [Zoho Desk SLAs & escalations](https://www.zoho.com/desk/escalations.html) · [PagerDuty SLA vs SLO vs SLI](https://www.pagerduty.com/resources/digital-operations/learn/what-is-slo-sla-sli/) · [Atlassian SLA vs SLO vs SLI](https://www.atlassian.com/incident-management/kpis/sla-vs-slo-vs-sli)

---

# 11. Phase 9 — SLI / SLO / Error-Budget (optional reliability module)

**Distinct from the ticket-SLA engine (Phase 7).** This is the SRE/reliability
layer — telemetry-fed service objectives with error budgets and burn-rate
alerts, in the Datadog/Nobl9/PagerDuty mould. It **attaches to Module B's
`oncall_services`** and **reuses Module B's alert/escalation/paging rails**, so it
depends on Phase 8. No ITSM helpdesk ships this natively (§10) — it's a
differentiator, hence **optional**.

## 11.1 The model (worked example)

Pick a service + one user-facing metric — e.g. **Payments API**:

- **SLI** (measurement) = `good ÷ valid` events. *good* = 2xx/3xx **and** latency < 300 ms.
- **SLO** (internal target) = `99.9% over rolling 28 days`.
- **Error budget** = `100% − SLO = 0.1%` of events allowed to fail.
- **Burn rate** = `observed error ratio ÷ allowed error ratio`. `1.0` = on pace to
  spend the whole window's budget exactly at window end; `14.4` = whole 28-day
  budget gone in 2 days.

```
Window 28d · traffic 10,000,000 · SLO 99.9%
Error budget = 10,000 failures allowed
Failed so far = 6,500  → 65% consumed · 35% (3,500) remaining · SLI 99.935% (meeting)
```

- **Multi-window multi-burn-rate alerts** (Google-SRE standard; avoids noisy/laggy):
  - **Fast burn** — 2% of budget in 1 h (~burn 14.4) → **page on-call** (Module B).
  - **Slow burn** — 10% in 6 h (~burn 6) → **open a ticket**, no page.
- **Error-budget policy** — when budget is exhausted, surface a **change-freeze**
  banner (redirect to reliability until it recovers).
- **SLA** sits *on top*, deliberately looser (customer 99.5% + credit; SLO 99.9%
  so you react before the contract breaks).

## 11.2 Data model (4 tables, migration `00NN`)

```
sli_sources        ← where the metric comes from
├── id, tenant_id
├── name
├── type            ENUM (prometheus, datadog, http_uptime_check, log_query,
│                         internal_metric, push_api)
├── good_query / valid_query   TEXT      ← or event-match config (JSONB)
├── connection      JSONB (endpoint, auth ref — secret via env, never stored raw)
├── is_active

slo_objectives
├── id, tenant_id
├── service_id      FK oncall_services            ← the service it measures
├── sli_source_id   FK sli_sources
├── objective_type  ENUM (availability, latency, error_rate, freshness, custom)
├── target_pct      NUMERIC(6,3)                  ← e.g. 99.900
├── window          ENUM (rolling_7d, rolling_28d, rolling_30d, calendar_month, quarter)
├── is_active
├── created_at / updated_at

slo_measurements   (IMMUTABLE, time-bucketed — the raw material)
├── id
├── slo_id          FK slo_objectives
├── bucket_start    TIMESTAMPTZ                   ← per-minute or per-5-min
├── good_count / total_count   BIGINT
UNIQUE (slo_id, bucket_start)
INDEX  (slo_id, bucket_start DESC)                ← powers window rollups + burn-rate

slo_burn_alerts
├── id, tenant_id
├── slo_id          FK slo_objectives
├── kind            ENUM (fast_burn, slow_burn)
├── long_window / short_window / burn_threshold   ← rule config
├── state           ENUM (ok, firing)
├── last_fired_at / linked_alert_id (FK alerts)   ← ties to Module B
```

> Budget consumed/remaining, current SLI, and burn rate are **derived** from
> `slo_measurements` over the objective's `window` — not stored (except an
> optional cache). This keeps them reproducible and always consistent.

## 11.3 Ingestion (support both)
- **Pull** — a Celery-beat adapter per `sli_source.type` runs a query
  (Prometheus/Datadog API, an HTTP uptime probe, or a query over **our own**
  data) → writes a `slo_measurements` bucket.
- **Push** — `POST /api/v1/slo/{id}/measurements` (HMAC-signed, like the IAM
  webhook) for external systems to send good/total counts.
- **Free-win internal SLIs** — computable from data we already own: ticket-SLA
  compliance %, incident MTTR, or an uptime SLI from existing health checks — so
  it demos with no external monitor.

## 11.4 Compute + alert (Celery beat ~5 min)
For each active SLO: roll up measurements over the window → compliance %, budget
consumed/remaining, burn rate over 1 h / 6 h → evaluate `slo_burn_alerts` →
**fire through Module B** (fast → page on-call; slow → ticket). Idempotent;
statement-timeout-bounded; rollups cached for dashboards.

## 11.5 API
```
GET/POST/PATCH/DELETE /api/v1/slo/objectives            (+ /{id})
GET    /api/v1/slo/objectives/{id}/status               ← SLI %, budget, burn rate, ETA-to-exhaustion
GET    /api/v1/slo/objectives/{id}/history?from&to
POST   /api/v1/slo/{id}/measurements                    ← push ingest (HMAC)
GET/POST/PATCH/DELETE /api/v1/slo/sources               (SLI sources)
GET    /api/v1/services/{id}/slo                         ← all SLOs for a service
GET    /api/v1/slo/reports/error-budget                  ← budgets across services
```

## 11.6 UI (portal → ITSM → Reliability, per service)
- **Error-budget gauge** (remaining %), target vs actual SLI, **burn-rate chart**
  with **time-to-exhaustion**, budget-policy banner ("budget < 20% — change
  freeze"). SLO editor (service, SLI source, target, window). Burn-alert rules.

## 11.7 Delivery
- **Depends on Phase 8** (services graph + alert/paging). Sits after it.
- **MVP slice (~1 session):** one `availability` SLO on one service, an
  **internal SLI** (or simple HTTP uptime check) → measurements → budget gauge +
  one fast-burn alert wired to Module B paging. Proves the loop end-to-end.
- **Full (~2 sessions):** Prometheus/Datadog pull adapters + push API, latency/
  error-rate objectives, multi-window burn alerts, error-budget report + policy
  banner, tests (window math across DST, burn-rate thresholds, budget exhaustion).

## 11.8 Boundaries
- **Not** in the ticket-SLA engine (Phase 7) — different concept, different
  tables, telemetry-fed. A ticket SLA measures *support timeliness*; an SLO
  measures *service reliability*.
- Secrets for monitor connections go through the existing env-override pattern.
- Burn alerts **reuse** Module B — no new paging stack.
