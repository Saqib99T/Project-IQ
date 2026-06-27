# IQ-ITSM — SLA, On-Call & SRE Incident Requirements

## 0. Document Purpose

This PRD extends the existing IQ-ITSM requirements with two production-grade modules:

1. **SLA Management Module** — service level definitions, agreements, objectives, policy assignment, breach tracking, pause/resume logic, reporting, analytics, escalation, contractual evidence, and AI-assisted risk detection.
2. **On-Call & SRE Incident Management Module** — PagerDuty/Rootly/incident.io/FireHydrant-style on-call scheduling, alert routing, incident command, escalations, service ownership, incident timelines, status communication, post-incident review, and SRE-focused analytics.

The goal is not to clone legacy ITSM workflows. The goal is to build a modern, smart, easy-to-use reliability operations layer that can compete with ServiceNow for depth while matching the adoption speed of modern SRE tools.

---

## 1. Competitive Research Summary

### 1.1 Competitor Patterns

| Competitor | Relevant capability pattern | Product lesson for IQ-ITSM |
|---|---|---|
| **Rootly** | Incident management platform covering incidents, on-call schedules, alerts, workflows, retrospectives, and status pages. | Treat incident response as a full lifecycle: alert → triage → incident room → automation → retrospective → learning. |
| **incident.io** | All-in-one incident management with on-call scheduling, real-time response, status pages, catalog-driven routing, and Slack/Teams-first workflows. | Build chat-native workflows, strong service ownership, and fast setup through a catalog/rules model. |
| **FireHydrant** | Reliability platform with alerting, on-call, service catalog, runbooks, retrospectives, status pages, AI insights, and analytics. | Bundle on-call, runbooks, services, and post-incident learning instead of treating paging as a standalone feature. |
| **Xurrent** | ITSM/ESM/ITOM platform with SLA management, service offerings, AI, automation, and multi-tenant service management. | SLAs must link to service offerings, customers, support hours, effort classes, reporting, and operational workflows. |
| **PagerDuty / Opsgenie pattern** | Escalation policies, schedules, rotations, notification rules, alert deduplication, incident routing, and response analytics. | Provide reliable paging primitives but integrate them deeply with tickets, SLAs, services, assets, and KB. |

### 1.2 IQ-ITSM Differentiation

IQ-ITSM should combine:

- ServiceNow-style SLA governance and service portfolio management.
- PagerDuty-style on-call scheduling and escalation reliability.
- Rootly/incident.io-style incident collaboration and automated response workflows.
- FireHydrant-style service catalog, runbooks, retrospectives, and reliability learning.
- Xurrent-style multi-tenant service management, AI assistance, and fast implementation.
- Native integration with the existing IQ-ITSM ticketing, asset, KB, IAM, notifications, AI budget, and platform tier architecture.

---

## 2. Product Principles

### 2.1 Modern

- Configurable without requiring professional services.
- ChatOps-first, but not ChatOps-only.
- Strong default workflows for IT support, SRE, DevOps, MSP, and enterprise service teams.
- API-first and automation-first.
- Real-time dashboards, timelines, and collaboration surfaces.

### 2.2 Smart

- AI explains SLA risk, breach drivers, incident summaries, runbook suggestions, responder recommendations, and postmortem drafts.
- Routing should use service ownership, team schedules, ticket context, alert labels, priority, customer tier, and past incident patterns.
- The system should learn from manual overrides, accepted AI suggestions, escalation success, and post-incident actions.

### 2.3 Easy

- Default SLA templates for common ITSM use cases.
- Wizard-based SLA agreement builder.
- Visual on-call schedule builder.
- Routing rule preview before save.
- One-click incident declaration from ticket, alert, chat message, or virtual agent.
- Clear “why was this routed here?” explanation on every routed ticket or incident.

---

## 3. Module A — SLA Management Requirements

## 3.1 Overview

The SLA module manages commitments between the service provider and service consumers. It must support internal operational SLAs, customer-facing contractual SLAs, operational level agreements (OLAs), underpinning contracts (UCs), service-level objectives (SLOs), service-level indicators (SLIs), business hours, holidays, escalation rules, breach analytics, customer reports, and audit-ready evidence.

The existing ticketing SLA fields must remain compatible:

- `sla_policy_id`
- `sla_response_due`
- `sla_resolve_due`
- `sla_breached`
- `sla_paused_at`
- `sla_paused_duration_sec`

This module extends that model into full SLA governance.

---

## 3.2 SLA Object Model

### 3.2.1 SLA Definitions

An **SLA Definition** is a reusable template that defines target behavior.

Required fields:

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `name` | Human-readable name, e.g. “Priority-Based IT Support SLA” |
| `description` | Admin-facing explanation |
| `status` | draft, active, deprecated, archived |
| `scope_type` | tenant, product, service, category, customer_org, department, team |
| `applies_to_ticket_types` | incident, service_request, problem, change |
| `priority_matrix` | response/restore/resolution targets per priority |
| `business_hours_policy_id` | Calendar used for SLA math |
| `pause_rules` | Conditions that pause timers |
| `breach_warning_rules` | Warning thresholds before breach |
| `escalation_policy_id` | Optional escalation behavior |
| `reporting_visibility` | internal_only, customer_visible, executive_visible |
| `version` | Incremented on meaningful changes |
| `effective_from` | Start date/time |
| `effective_until` | Optional end date/time |
| `created_by` | User |
| `created_at` | Timestamp |
| `updated_at` | Timestamp |

### 3.2.2 SLA Agreements

An **SLA Agreement** is a binding instance between the tenant/provider and a consumer.

Examples:

- Acme IT → HR department support agreement.
- MSP → Client A managed infrastructure agreement.
- SaaS company → Enterprise customer support agreement.
- Internal SRE → Product team production incident response agreement.

Required fields:

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `sla_definition_id` | Linked SLA template |
| `agreement_number` | Human-readable SLA-00001 |
| `consumer_type` | tenant, department, product, customer_org, user_group |
| `consumer_id` | Nullable polymorphic reference |
| `provider_team_id` | Team responsible for delivery |
| `support_tier` | standard, premium, enterprise, msp_custom |
| `contract_reference` | Optional external contract ID |
| `status` | draft, active, suspended, expired, terminated |
| `effective_from` | Start timestamp |
| `effective_until` | End timestamp |
| `renewal_policy` | manual, auto_renew, fixed_end |
| `penalty_policy` | Optional credit/penalty rules |
| `customer_visible` | Whether requester/customer can see metrics |
| `created_by` | User |
| `created_at` | Timestamp |
| `updated_at` | Timestamp |

### 3.2.3 SLA Objectives

Each SLA may contain multiple objectives.

Objective examples:

- First response within 15 minutes.
- Resolution within 4 hours.
- Restore service within 1 hour.
- Update customer every 30 minutes while priority = critical.
- Provide RCA within 3 business days for Sev1 incident.
- Change approval within 2 business days.

Objective fields:

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `sla_definition_id` | Parent SLA definition |
| `name` | “First Response”, “Resolution”, “RCA Delivery” |
| `objective_type` | response, resolution, restore, update_frequency, rca_delivery, approval, custom |
| `target_duration_minutes` | Target time |
| `measurement_start_event` | ticket_created, status_in_progress, incident_declared, alert_triggered, custom_event |
| `measurement_stop_event` | first_public_agent_reply, resolved, restored, rca_published, approved, custom_event |
| `business_hours_only` | Boolean |
| `weight` | Used in composite compliance score |
| `is_contractual` | Whether breach can appear in contractual reporting |
| `enabled` | Boolean |

### 3.2.4 SLIs and SLOs

For SRE use cases, SLA should support SLI/SLO modeling.

| Object | Purpose |
|---|---|
| SLI | The metric being measured, e.g. availability, latency, error rate, ticket first response time. |
| SLO | Internal reliability target, e.g. “99.9% API availability over rolling 30 days.” |
| SLA | External or internal agreement, often with contractual meaning. |

Supported SLI types:

- Ticket first response time.
- Ticket resolution time.
- Incident acknowledgement time.
- Incident mitigation time.
- Incident resolution time.
- Uptime / availability from monitoring integration.
- API latency percentile.
- Error rate.
- Change failure rate.
- MTTA, MTTR, MTTD.
- Custom metric via API ingestion.

---

## 3.3 SLA Policy Matching

### 3.3.1 Matching Order

When a ticket or incident is created, the system must select the most specific applicable SLA.

Recommended matching priority:

1. Manually selected SLA override.
2. Customer/org-specific SLA agreement.
3. Product/service-specific SLA agreement.
4. Category-specific SLA policy.
5. Team-specific OLA.
6. Tenant default SLA.
7. System default fallback.

### 3.3.2 Match Explanation

Every assigned SLA must store a machine-readable explanation:

```json
{
  "matched_by": "category_default",
  "matched_rule_id": "uuid",
  "reason": "Ticket category 'Production Outage' maps to SLA 'Critical Production Support'",
  "evaluated_rules": [
    { "rule_id": "uuid", "matched": false, "reason": "customer tier did not match" },
    { "rule_id": "uuid", "matched": true, "reason": "category matched" }
  ]
}
```

The UI must show: **“SLA: Critical Production Support — selected because category = Production Outage.”**

### 3.3.3 Rule Preview

Before saving SLA routing rules, admins must be able to test:

- Given this ticket payload, which SLA applies?
- Which due dates would be calculated?
- Which warnings/escalations would be scheduled?
- Which policy lost due to lower priority?

---

## 3.4 Business Hours and Calendars

### 3.4.1 Business Hours Policy

The existing `business_hours_config` should be extended into reusable calendar policies.

Fields:

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `name` | “24x7”, “US Business Hours”, “Follow the Sun” |
| `timezone` | IANA timezone |
| `work_days` | ISO weekdays |
| `work_start_time` | Local time |
| `work_end_time` | Local time |
| `holidays` | Explicit dates |
| `holiday_calendar_source` | manual, country, imported_ics, api |
| `exception_windows` | Special closures or extended support windows |
| `is_default` | Boolean |

### 3.4.2 Calendar Types

Must support:

- 24x7 calendar.
- Fixed business hours.
- Holiday-aware business hours.
- Customer-specific calendars.
- Follow-the-sun support windows.
- Temporary calendar exceptions.
- Maintenance windows that suppress SLA counting for affected services.

### 3.4.3 SLA Time Calculation Rules

- All SLA comparisons use DB server `NOW()`.
- All displayed times are rendered in user timezone and tenant timezone.
- SLA duration calculations must respect the selected business calendar.
- Paused time must not count against SLA.
- Retroactive changes to SLA definitions must not mutate already-created tickets unless explicitly recalculated by an admin action.
- SLA snapshots must be stored per ticket/incident to preserve audit history.

---

## 3.5 SLA Timers

### 3.5.1 Timer Types

| Timer | Starts | Stops | Notes |
|---|---|---|---|
| First response | Ticket created or in_progress | First public agent response | Internal notes do not stop first response. |
| Acknowledgement | Alert or incident created | On-call responder acknowledges | Used for SRE incidents and alerts. |
| Assignment | Ticket created | Team or user assigned | Optional operational metric. |
| Mitigation | Incident declared | Impact mitigated | Does not require full root cause. |
| Restoration | Incident declared | Service restored | SRE-specific. |
| Resolution | Ticket or incident created/in_progress | Resolved | Common ITSM SLA. |
| Closure | Resolved | Closed | Ensures requester confirmation. |
| RCA delivery | Sev1/Sev2 incident resolved | Postmortem/RCA published | SRE/enterprise SLA. |
| Customer update | Incident active | Update posted within interval | Repeating objective. |

### 3.5.2 Pause and Resume

Default pause triggers:

- Ticket status becomes `pending`.
- Ticket waiting reason = customer.
- Ticket waiting reason = third_party.
- Change is awaiting external approval.
- Incident is in scheduled maintenance window.
- Admin-applied SLA hold with reason.

Default resume triggers:

- Customer replies.
- Third-party dependency cleared.
- Status moves from `pending` to `in_progress`.
- Manual resume by authorized role.
- Maintenance window ends.

Pause/resume must write immutable history:

- Who/what paused.
- Pause reason.
- Timestamp.
- Resume reason.
- Elapsed paused duration.
- Due date before/after recalculation.

### 3.5.3 SLA Snapshot

When an SLA is applied to a ticket or incident, store a snapshot:

```json
{
  "sla_definition_id": "uuid",
  "sla_definition_version": 3,
  "agreement_id": "uuid",
  "calendar_id": "uuid",
  "objectives": [
    {
      "objective_type": "response",
      "target_duration_minutes": 15,
      "business_hours_only": false,
      "due_at": "2026-06-25T13:15:00Z"
    }
  ]
}
```

This prevents historical reports from changing when admins edit active SLA policies.

---

## 3.6 SLA Status Model

Each SLA objective instance should have a status.

| Status | Meaning |
|---|---|
| not_started | Timer has not begun. |
| running | Timer is active. |
| paused | Timer is paused. |
| warning | Warning threshold crossed but not breached. |
| breached | Due time passed without stop event. |
| met | Objective completed within target. |
| missed | Objective completed after target. |
| waived | Authorized user waived the breach with reason. |
| cancelled | Parent ticket/incident cancelled before objective applied. |

---

## 3.7 SLA Warnings, Breaches, and Escalations

### 3.7.1 Warning Thresholds

Admins can configure warnings as:

- Percentage elapsed, e.g. 50%, 75%, 90%.
- Fixed time before due, e.g. 15 minutes before breach.
- Criticality-specific thresholds.
- Customer-tier-specific thresholds.

### 3.7.2 Breach Actions

Supported actions:

- Notify assignee.
- Notify team lead.
- Notify manager.
- Page current on-call responder.
- Re-route to backup team.
- Increase priority.
- Create escalation record.
- Add watcher group.
- Post to Slack/Teams channel.
- Trigger webhook.
- Create problem ticket if repeated breach pattern detected.
- Add breach to customer-facing monthly report.

### 3.7.3 Escalation Policy Link

SLA breach escalation should reuse the On-Call module escalation engine where appropriate.

Example:

```text
If critical incident response SLA reaches 75% elapsed:
  notify primary responder
If 90% elapsed:
  page secondary on-call
If breached:
  page incident commander + notify manager + open Sev1 incident room
```

---

## 3.8 SLA Reporting and Analytics

### 3.8.1 Operational Dashboards

Required widgets:

- Open tickets by SLA state.
- Tickets at risk of breach.
- Breached tickets by priority/team/category/customer.
- Average response time vs target.
- Average resolution time vs target.
- SLA compliance trend over time.
- Breaches by root cause.
- Breaches caused by assignment delay.
- Breaches caused by waiting on third party.
- Breaches by business hours calendar.
- On-call acknowledgement SLA performance.
- Incident mitigation SLA performance.

### 3.8.2 Customer-Facing Reports

For MSP and enterprise use cases:

- Monthly SLA compliance report.
- Per-agreement compliance percentage.
- Breach list with explanations.
- Credits/penalty calculation if configured.
- Ticket volume by priority.
- Average response/resolution by priority.
- Excluded/paused time summary.
- Waived breaches and waiver reasons.
- Export to PDF, CSV, and API.

### 3.8.3 Executive Reports

- SLA compliance by customer tier.
- SLA compliance by product/service.
- SLA exposure: tickets currently near breach.
- Cost of breaches.
- Capacity recommendations.
- Teams with chronic SLA pressure.
- AI-suggested remediation actions.

---

## 3.9 SLA AI Capabilities

### 3.9.1 Breach Prediction

AI should predict breach risk for running tickets/incidents using:

- Priority.
- Category.
- Team queue size.
- Assignee load.
- Historical resolution time for similar tickets.
- Business hours remaining.
- On-call schedule availability.
- Customer tier.
- Similar incidents.
- Comment sentiment and waiting-state patterns.

Output:

```json
{
  "risk_score": 0.82,
  "risk_level": "high",
  "reason": "Only 38 minutes remain; assigned team has 12 open high-priority tickets and no primary responder acknowledged yet.",
  "recommended_actions": [
    "Page current on-call responder",
    "Escalate to team lead",
    "Send customer update now"
  ]
}
```

### 3.9.2 Breach Explanation

For every breach, AI can generate a plain-English explanation:

- What objective breached.
- When it started.
- When it should have stopped.
- What delays occurred.
- Whether paused time was applied.
- Recommended process improvement.

### 3.9.3 SLA Policy Recommendations

AI can recommend:

- Which categories need different SLA targets.
- Teams that are under-staffed for current commitments.
- SLA policies with unrealistic targets.
- Customers or products driving breach risk.
- Candidates for automation or KB deflection.

All AI suggestions must be reviewable by tenant admins and must not automatically alter contractual SLA agreements.

---

## 3.10 SLA Permissions

| Action | end_user | agent | team_lead | manager | admin | platform_admin | platform_support |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| View own ticket SLA state | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| View all SLA dashboards | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Manage SLA definitions | — | — | — | ✓ | ✓ | ✓ | — |
| Manage SLA agreements | — | — | — | ✓ | ✓ | ✓ | — |
| Apply manual SLA override | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Waive SLA breach | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Export customer SLA reports | — | — | — | ✓ | ✓ | ✓ | ✓ |
| Configure breach penalties | — | — | — | — | ✓ | ✓ | — |
| Recalculate SLA for ticket | — | — | ✓ | ✓ | ✓ | ✓ | — |

---

## 3.11 SLA API Requirements

### 3.11.1 SLA Definitions

```http
GET    /api/v1/sla/definitions
POST   /api/v1/sla/definitions
GET    /api/v1/sla/definitions/{id}
PATCH  /api/v1/sla/definitions/{id}
POST   /api/v1/sla/definitions/{id}/activate
POST   /api/v1/sla/definitions/{id}/deprecate
POST   /api/v1/sla/definitions/{id}/clone
GET    /api/v1/sla/definitions/{id}/versions
```

### 3.11.2 SLA Agreements

```http
GET    /api/v1/sla/agreements
POST   /api/v1/sla/agreements
GET    /api/v1/sla/agreements/{id}
PATCH  /api/v1/sla/agreements/{id}
POST   /api/v1/sla/agreements/{id}/activate
POST   /api/v1/sla/agreements/{id}/suspend
POST   /api/v1/sla/agreements/{id}/terminate
GET    /api/v1/sla/agreements/{id}/compliance
GET    /api/v1/sla/agreements/{id}/report?from=...&to=...
```

### 3.11.3 SLA Matching and Runtime

```http
POST   /api/v1/sla/match-preview
GET    /api/v1/tickets/{id}/sla
POST   /api/v1/tickets/{id}/sla/override
POST   /api/v1/tickets/{id}/sla/pause
POST   /api/v1/tickets/{id}/sla/resume
POST   /api/v1/tickets/{id}/sla/recalculate
POST   /api/v1/tickets/{id}/sla/waive-breach
GET    /api/v1/incidents/{id}/sla
```

### 3.11.4 Calendars

```http
GET    /api/v1/sla/calendars
POST   /api/v1/sla/calendars
GET    /api/v1/sla/calendars/{id}
PATCH  /api/v1/sla/calendars/{id}
DELETE /api/v1/sla/calendars/{id}
POST   /api/v1/sla/calendars/{id}/exceptions
DELETE /api/v1/sla/calendars/{id}/exceptions/{exception_id}
```

### 3.11.5 Reports

```http
GET    /api/v1/sla/reports/overview
GET    /api/v1/sla/reports/compliance
GET    /api/v1/sla/reports/breaches
GET    /api/v1/sla/reports/at-risk
GET    /api/v1/sla/reports/customer/{agreement_id}
POST   /api/v1/sla/reports/scheduled
GET    /api/v1/sla/reports/export?format=csv|xlsx|pdf
```

---

## 3.12 SLA Non-Functional Requirements

- SLA due date calculation must complete under 50ms P95 for standard policies.
- SLA breach detector must run every 1 minute for critical objectives and every 5 minutes for standard objectives.
- SLA dashboards must load under 500ms P95 for tenants with up to 1M tickets using materialized summaries or rollups.
- SLA state transitions must be idempotent.
- Every SLA status change must be auditable.
- SLA reports must be reproducible historically using stored SLA snapshots.
- No SLA calculation may depend on application server clock.
- SLA policy updates must be versioned.
- SLA report export jobs must run asynchronously for large date ranges.

---

# 4. Module B — On-Call & SRE Incident Management Requirements

## 4.1 Overview

The On-Call & SRE Incident module provides production-grade alert routing, schedules, escalation policies, responder assignment, incident coordination, status communication, service ownership, runbooks, post-incident reviews, and reliability analytics.

It must support both ITSM-style ticket workflows and SRE-style incident workflows.

Primary use cases:

- Route new tickets to the current support person.
- Page the correct on-call responder for urgent incidents.
- Create and manage support rotations.
- Define escalation policies and fallback responders.
- Declare incidents from tickets, alerts, chat, or virtual agent.
- Track acknowledgement, mitigation, restoration, resolution, and RCA SLAs.
- Coordinate incidents in chat and web UI.
- Generate timelines, summaries, and retrospectives.
- Improve service reliability over time.

---

## 4.2 Core Concepts

| Concept | Meaning |
|---|---|
| Service | A product, app, infrastructure component, or business capability with owners and dependencies. |
| Support Team | Group responsible for tickets, services, or incidents. |
| On-Call Schedule | Rotation calendar defining who is primary/secondary responder at any time. |
| Escalation Policy | Ordered steps for notifying responders until acknowledgement. |
| Alert | Signal from monitoring, webhook, email, API, or manual trigger. |
| Incident | Coordinated response object for a service-impacting event. |
| Incident Role | Commander, tech lead, communications lead, scribe, responder, observer. |
| Runbook | Structured response steps linked to service, alert, or incident type. |
| Status Page Update | Internal or external communication about incident impact. |
| Post-Incident Review | Learning document with timeline, causes, actions, and owners. |

---

## 4.3 Service Catalog

### 4.3.1 Purpose

A service catalog powers routing, ownership, impact analysis, runbooks, escalation, status pages, and reliability analytics.

### 4.3.2 Service Fields

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `name` | Service name |
| `slug` | Unique per tenant |
| `description` | Service description |
| `service_type` | application, api, database, network, infrastructure, business_service, vendor_service |
| `tier` | tier_0, tier_1, tier_2, tier_3 |
| `lifecycle_status` | active, deprecated, retired |
| `owner_team_id` | Primary owning team |
| `default_on_call_schedule_id` | Schedule used for service alerts |
| `default_escalation_policy_id` | Escalation policy |
| `default_sla_definition_id` | SLA/SLO defaults |
| `status_page_component_id` | Optional linked component |
| `repository_url` | Optional code repo |
| `dashboard_url` | Optional monitoring dashboard |
| `runbook_url` | Optional external runbook |
| `metadata` | JSONB |

### 4.3.3 Service Dependencies

Services can depend on other services and assets.

Relationship types:

- depends_on
- hosts
- runs_on
- calls_api
- reads_from
- writes_to
- uses_vendor
- backs_up
- supports_business_service

Impact analysis must traverse:

- Service-to-service relationships.
- Service-to-asset relationships from CMDB.
- Open incidents linked to affected services.
- Open tickets linked to affected services or assets.

---

## 4.4 Support Teams

### 4.4.1 Team Enhancements

The existing `teams` model must be extended or associated with SRE fields:

| Field | Description |
|---|---|
| `timezone` | Default team timezone |
| `team_type` | support, sre, devops, platform, security, network, facilities |
| `default_schedule_id` | Schedule for ticket routing |
| `default_escalation_policy_id` | Escalation policy |
| `manager_id` | Optional manager |
| `slack_channel` | Optional channel |
| `teams_channel` | Optional channel |
| `working_hours_calendar_id` | Optional calendar |
| `load_balancing_strategy` | current_on_call, round_robin, least_loaded, skill_based, manual |
| `skills` | JSONB list of capabilities |

### 4.4.2 Team Membership

Team member fields:

| Field | Description |
|---|---|
| `role_in_team` | member, lead, manager, shadow, contractor |
| `can_be_on_call` | Boolean |
| `notification_profile_id` | User notification rules |
| `skills` | JSONB |
| `max_active_assignments` | Optional workload cap |
| `joined_at` | Timestamp |
| `left_at` | Nullable timestamp |

---

## 4.5 On-Call Scheduling

### 4.5.1 Schedule Types

Must support:

- Fixed weekly rotation.
- Daily rotation.
- Custom rotation length.
- Follow-the-sun rotations.
- Primary and secondary rotations.
- Shadow rotations for trainees.
- Temporary overrides.
- Holiday overrides.
- Maintenance coverage.
- Split shifts.
- Multiple timezones.
- Escalation fallback schedules.

### 4.5.2 Schedule Fields

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `team_id` | Owning team |
| `name` | “Payments Primary On-Call” |
| `description` | Optional |
| `timezone` | Schedule timezone |
| `coverage_type` | 24x7, business_hours, custom_windows |
| `rotation_strategy` | weekly, daily, custom, follow_the_sun |
| `handoff_time` | Local handoff time |
| `starts_at` | Start timestamp |
| `ends_at` | Optional end timestamp |
| `is_active` | Boolean |
| `created_by` | User |

### 4.5.3 Schedule Layers

Schedules must support layers, similar to mature on-call tools.

Example:

- Layer 1: Primary responder, weekly rotation.
- Layer 2: Secondary responder, weekly rotation offset by one person.
- Layer 3: Manager escalation, business-hours only.

Layer fields:

| Field | Description |
|---|---|
| `schedule_id` | Parent schedule |
| `name` | Layer name |
| `priority` | Layer order |
| `participants` | Ordered users |
| `rotation_length_minutes` | Rotation duration |
| `coverage_windows` | JSONB schedule windows |
| `handoff_time` | Local handoff time |
| `start_offset` | Optional offset for secondary rotations |

### 4.5.4 Overrides

Override requirements:

- Add one-time override.
- Add recurring override.
- Swap shifts between users.
- Request coverage from another user.
- Approve/deny coverage request.
- Enforce minimum notice policy if configured.
- Notify affected users.
- Preserve immutable audit trail.

Override fields:

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `schedule_id` | Schedule |
| `layer_id` | Optional layer |
| `original_user_id` | User being replaced |
| `override_user_id` | User covering |
| `starts_at` | Start timestamp |
| `ends_at` | End timestamp |
| `reason` | Text |
| `status` | requested, approved, denied, active, expired, cancelled |
| `approved_by` | Nullable user |

### 4.5.5 Schedule Preview

Admins and team leads must be able to preview:

- Who is on call now.
- Who is on call at a future time.
- Coverage gaps.
- Users with too many shifts.
- Holiday conflicts.
- Timezone conversions.
- Escalation path for a hypothetical alert.

---

## 4.6 Notification Profiles

### 4.6.1 User Notification Rules

Each responder must define notification preferences:

- Email.
- SMS.
- Phone call.
- Push notification.
- Slack DM.
- Microsoft Teams DM.
- Web push.
- In-app notification.
- Webhook to personal automation.

Rules can vary by:

- Urgency.
- Time of day.
- Schedule state.
- Device availability.
- Incident severity.
- Alert source.

### 4.6.2 Escalating Contact Methods

Example profile:

```text
Critical alert:
  immediately: push + Slack DM
  after 2 minutes no ack: SMS
  after 5 minutes no ack: phone call
  after 8 minutes no ack: escalate to secondary
```

### 4.6.3 Quiet Hours

Quiet hours apply only when user is not on call, unless explicitly configured to block non-critical alerts.

Critical incidents may override quiet hours when the user is on call.

---

## 4.7 Alert Ingestion

### 4.7.1 Alert Sources

Must support alert creation from:

- API.
- Webhook.
- Email.
- Monitoring tools: Datadog, New Relic, Grafana, Prometheus Alertmanager, CloudWatch, Azure Monitor, GCP Monitoring.
- GitHub/GitLab deployment events.
- Slack/Teams slash command.
- Manual UI trigger.
- Virtual agent escalation.
- Ticket priority upgrade.

### 4.7.2 Alert Fields

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `source` | datadog, prometheus, manual, api, email, etc. |
| `source_alert_id` | External ID |
| `dedup_key` | Used for grouping/deduplication |
| `title` | Alert title |
| `description` | Alert description |
| `severity` | sev1, sev2, sev3, sev4, sev5 |
| `status` | triggered, acknowledged, suppressed, resolved, linked_to_incident |
| `service_id` | Optional matched service |
| `team_id` | Routed team |
| `assignee_id` | Current responder |
| `escalation_policy_id` | Policy used |
| `payload` | Raw sanitized alert payload |
| `first_triggered_at` | Timestamp |
| `last_triggered_at` | Timestamp |
| `acknowledged_at` | Nullable timestamp |
| `resolved_at` | Nullable timestamp |

### 4.7.3 Deduplication and Grouping

Alert deduplication must support:

- Exact dedup key.
- Service + alert name.
- Fingerprint of labels.
- Time-window grouping.
- AI-assisted grouping suggestion.
- Manual merge/split.

### 4.7.4 Alert Suppression

Suppression rules:

- Maintenance window suppression.
- Known noisy alert suppression.
- Dependency-based suppression, e.g. suppress downstream alerts if upstream service is already incident owner.
- Rate-based suppression.
- Alert source disabled.
- Low-priority alerts outside business hours route to ticket, not page.

---

## 4.8 Routing Engine

### 4.8.1 Routing Targets

Tickets, alerts, and incidents may route to:

- Team.
- Current primary on-call responder.
- Secondary on-call responder.
- Specific user.
- Service owner team.
- Escalation policy.
- Queue.
- Vendor contact.
- Virtual agent / automation workflow.

### 4.8.2 Routing Inputs

The routing engine must evaluate:

- Ticket type.
- Priority/severity.
- Category.
- Service.
- Product.
- Customer tier.
- Business hours.
- On-call schedule.
- Team availability.
- User workload.
- Skills/tags.
- Service ownership.
- Alert labels.
- Incident severity.
- SLA at-risk status.
- Historical routing outcomes.

### 4.8.3 Routing Strategies

Supported strategies:

| Strategy | Behavior |
|---|---|
| current_on_call | Assign to current primary on-call user. |
| escalation_policy | Notify and escalate until acknowledged. |
| round_robin | Evenly distribute among eligible team members. |
| least_loaded | Assign to eligible user with lowest active workload. |
| skill_based | Match required skills from category/service. |
| service_owner | Route to owner team from service catalog. |
| follow_the_sun | Route to team currently inside support hours. |
| ai_recommendation | Suggest best route with explanation; optional auto-apply. |
| manual_review | Leave unassigned but recommend route. |

### 4.8.4 Routing Explanation

Every automated routing decision must store:

```json
{
  "strategy": "current_on_call",
  "selected_team_id": "uuid",
  "selected_user_id": "uuid",
  "reason": "Payments API maps to Payments SRE team; Ali is primary on-call until 2026-06-25T22:00:00Z.",
  "fallbacks": [
    { "type": "secondary_on_call", "user_id": "uuid" },
    { "type": "manager", "user_id": "uuid" }
  ]
}
```

The UI must show: **“Assigned to Ali because he is current primary on-call for Payments SRE.”**

### 4.8.5 Route Preview and Simulation

Admins must be able to test a routing rule using sample payloads:

- New critical incident for Service A.
- New low-priority ticket for Category B.
- Alert arrives during holiday.
- Primary on-call user is unavailable.
- Current on-call schedule has gap.

The preview must show selected route, notification sequence, SLA deadlines, and escalation path.

---

## 4.9 Escalation Policies

### 4.9.1 Escalation Policy Fields

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `name` | “Payments Sev1 Escalation” |
| `description` | Optional |
| `team_id` | Owning team |
| `repeat_count` | Number of times to repeat policy |
| `repeat_delay_minutes` | Delay before repeating |
| `timeout_minutes` | Overall timeout |
| `on_timeout_action` | escalate_to_manager, create_major_incident, notify_admin, no_action |
| `is_active` | Boolean |

### 4.9.2 Escalation Steps

Step target types:

- User.
- Team.
- Schedule primary.
- Schedule secondary.
- Manager of team.
- Service owner.
- Vendor contact.
- Webhook.
- Slack/Teams channel.

Step fields:

| Field | Description |
|---|---|
| `policy_id` | Parent policy |
| `step_order` | Numeric order |
| `target_type` | user, schedule, team, manager, vendor, webhook |
| `target_id` | Target reference |
| `delay_minutes` | Delay before step starts |
| `ack_timeout_minutes` | Time to wait for acknowledgement |
| `notification_urgency` | low, normal, high, critical |
| `stop_on_ack` | Boolean |

### 4.9.3 Acknowledgement

A responder can acknowledge through:

- Web UI.
- Mobile push action.
- Email action link.
- Slack/Teams action button.
- API.
- Phone keypad response if telephony is integrated.

Acknowledgement must record:

- User.
- Timestamp.
- Channel.
- Alert/incident/ticket ID.
- Escalation step.
- Time-to-ack.

### 4.9.4 Escalation Failure

If nobody acknowledges:

- Mark alert/escalation as `unacknowledged_timeout`.
- Notify team manager and tenant admin.
- Create system log warning.
- Optionally create or upgrade incident severity.
- Include failure in on-call reliability reports.

---

## 4.10 Ticket Routing to Current Support Person

### 4.10.1 Ticket Assignment Modes

Ticket assignment can be configured per team/category/service:

- Assign to current on-call primary.
- Assign to current on-call secondary if primary has too much load.
- Assign to team queue only, page primary for critical priority.
- Assign via round-robin during business hours and on-call after hours.
- Assign to virtual triage queue for AI classification first.
- Assign to MSP client-dedicated queue.

### 4.10.2 SLA Interaction

When a ticket routes to current support person:

- Assignment SLA starts on ticket creation.
- Acknowledgement SLA starts once assigned/page sent.
- Response SLA stops only on public response or configured event.
- If on-call responder does not acknowledge, escalation policy continues.
- If responder changes due to escalation, ticket history records reassignment reason.

### 4.10.3 Workload Controls

Do not blindly assign all tickets to current on-call if it overloads one person.

Configurable controls:

- Maximum active critical tickets per responder.
- Maximum total open tickets per responder.
- Respect vacation/unavailability.
- Respect schedule override.
- Least-loaded backup routing.
- Escalate to team queue if no valid responder.

---

## 4.11 Incident Management

### 4.11.1 Incident Lifecycle

```text
detected → triaged → declared → investigating → identified → monitoring → resolved → closed
                     ↘ cancelled
```

### 4.11.2 Incident Severity

| Severity | Meaning | Default behavior |
|---|---|---|
| Sev1 | Critical production outage or major customer/business impact | Page immediately, create incident room, executive comms, RCA required. |
| Sev2 | Significant degradation or partial outage | Page service owner/on-call, status updates required. |
| Sev3 | Limited impact, workaround exists | Route to team, optional incident room. |
| Sev4 | Minor issue | Ticket workflow, no urgent page by default. |
| Sev5 | Informational / low impact | Track as ticket or alert only. |

Severity must be tenant-configurable.

### 4.11.3 Incident Declaration Sources

An incident can be declared from:

- Alert.
- Ticket.
- Service page.
- Asset impact analysis.
- Slack/Teams command.
- Virtual agent escalation.
- Monitoring integration.
- Manual web UI.
- API.

### 4.11.4 Incident Fields

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `incident_number` | INCID-00001 or SEV1-00001 |
| `title` | Incident title |
| `summary` | Current summary |
| `severity` | sev1-sev5 |
| `status` | lifecycle status |
| `service_id` | Primary affected service |
| `affected_service_ids` | Additional services |
| `commander_id` | Incident commander |
| `tech_lead_id` | Technical lead |
| `comms_lead_id` | Communications lead |
| `scribe_id` | Timeline owner |
| `created_from_type` | alert, ticket, manual, chat, api |
| `created_from_id` | Source object ID |
| `customer_impact` | Text |
| `internal_impact` | Text |
| `started_at` | When impact began |
| `detected_at` | When detected |
| `declared_at` | When declared |
| `acknowledged_at` | First ack |
| `mitigated_at` | Impact mitigated |
| `resolved_at` | Fully resolved |
| `closed_at` | Closed |
| `sla_snapshot` | JSONB |
| `metadata` | JSONB |

### 4.11.5 Incident Roles

Default roles:

- Incident Commander.
- Technical Lead.
- Communications Lead.
- Scribe.
- Customer Liaison.
- Subject Matter Expert.
- Observer.

Role assignment can be manual, schedule-based, service-owner-based, or AI-suggested.

### 4.11.6 Incident Room

For Sev1/Sev2, the system should automatically create or link collaboration rooms:

- Slack channel.
- Microsoft Teams channel.
- Internal web incident room.
- Bridge call link.
- Google Meet / Zoom / Teams meeting link.

Incident room should include:

- Incident summary.
- Current severity/status.
- Roles.
- Affected services.
- Open tasks.
- Timeline.
- Linked alerts/tickets/assets/KB/runbooks.
- Status updates.
- AI-generated brief.

---

## 4.12 Incident Timeline

### 4.12.1 Timeline Events

Timeline must automatically capture:

- Alert triggered.
- Alert acknowledged.
- Incident declared.
- Severity changed.
- Status changed.
- Role assigned.
- Runbook step completed.
- Status page update posted.
- Ticket linked.
- Asset linked.
- Service linked.
- Customer update sent.
- Slack/Teams important message pinned.
- Mitigation applied.
- Resolution reached.
- Postmortem created.

Manual timeline entries must also be supported.

### 4.12.2 Timeline Quality

The timeline should be good enough to generate postmortems with minimal human cleanup.

AI can propose missing timeline entries based on chat summaries and event streams, but must mark them as AI-suggested until accepted.

---

## 4.13 Runbooks and Workflows

### 4.13.1 Runbook Types

- Manual checklist.
- Automated workflow.
- Hybrid workflow.
- Service-specific runbook.
- Severity-specific runbook.
- Alert-specific runbook.
- Change rollback runbook.

### 4.13.2 Runbook Step Types

- Markdown instruction.
- Confirmation checkbox.
- Execute webhook.
- Call internal API.
- Create ticket/task.
- Page team.
- Post status update.
- Query monitoring dashboard.
- Attach evidence.
- Approval gate.

### 4.13.3 Workflow Automation

Automation triggers:

- Alert created.
- Incident declared.
- Severity changes.
- Incident enters `identified`.
- Incident resolved.
- SLA at-risk.
- Escalation timeout.
- Postmortem action overdue.

Automation actions:

- Notify.
- Assign role.
- Create channel.
- Create bridge call.
- Link runbook.
- Create status page incident.
- Update ticket.
- Create follow-up tasks.
- Call webhook.
- Generate summary.

---

## 4.14 Status Pages and Communications

### 4.14.1 Internal Status

Internal status updates must support:

- Employee-facing service status.
- Internal-only incident notes.
- Stakeholder update subscriptions.
- Executive digest for Sev1/Sev2.

### 4.14.2 External Status

External status page requirements:

- Public status page per tenant or product.
- Private/customer-specific status pages.
- Components linked to services.
- Incident update templates.
- Subscriber notifications.
- Scheduled maintenance announcements.
- Post-incident summary.
- Status page history.

### 4.14.3 Update Cadence SLA

For incidents, communication cadence can be an SLA objective.

Example:

```text
Sev1 incidents require customer-visible updates every 30 minutes until monitoring or resolved.
```

The system must warn when the next update is due.

---

## 4.15 Post-Incident Reviews / Retrospectives

### 4.15.1 Postmortem Requirement Rules

Postmortem required when:

- Severity is Sev1 or Sev2.
- Incident duration exceeds threshold.
- SLA breach occurred.
- Customer impact is above threshold.
- Manual flag by incident commander.
- Repeated incident pattern detected.

### 4.15.2 Postmortem Fields

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `incident_id` | Parent incident |
| `status` | draft, in_review, approved, published, archived |
| `summary` | What happened |
| `impact` | Customer/business impact |
| `root_cause` | Root cause |
| `trigger` | Triggering condition |
| `detection` | How it was detected |
| `resolution` | How it was resolved |
| `what_went_well` | Text/list |
| `what_went_wrong` | Text/list |
| `where_we_got_lucky` | Text/list |
| `timeline_snapshot` | JSONB |
| `action_items` | Linked tasks |
| `approved_by` | User |
| `published_at` | Timestamp |

### 4.15.3 AI Postmortem Draft

AI can draft:

- Summary.
- Timeline.
- Impact.
- Contributing factors.
- Customer-facing RCA.
- Follow-up actions.
- Suggested KB article.
- Suggested runbook updates.

Human approval is required before publication.

---

## 4.16 Follow-Up Actions

Incident follow-ups are tasks linked to owners and due dates.

Required capabilities:

- Create follow-up action from postmortem.
- Assign owner.
- Set due date.
- Link to ticket/problem/change.
- Track completion.
- Escalate overdue actions.
- Show reliability debt dashboard.
- Prevent incident closure until required actions created, if configured.

---

## 4.17 SRE Metrics and Analytics

### 4.17.1 Core Metrics

- MTTD — mean time to detect.
- MTTA — mean time to acknowledge.
- MTTM — mean time to mitigate.
- MTTR — mean time to resolve/recover.
- MTBF — mean time between failures.
- Incident count by severity.
- Incidents by service/team/customer.
- Alert volume and noise ratio.
- Alert deduplication rate.
- Escalation success rate.
- On-call load per user.
- Sleep disruption / after-hours pages.
- SLA/SLO compliance.
- Change failure rate.
- Repeat incident rate.
- Postmortem action completion rate.

### 4.17.2 Reliability Dashboards

Required dashboards:

- Current active incidents.
- On-call now.
- Incidents by severity and service.
- MTTR trend.
- Services with highest incident burden.
- Alert noise leaderboard.
- Teams with most after-hours pages.
- SLA/SLO risk dashboard.
- Postmortem actions overdue.
- Customer-impacting incidents.
- AI-generated reliability insights.

### 4.17.3 On-Call Health

Track fairness and burnout signals:

- Pages per responder.
- Pages outside business hours.
- Consecutive night pages.
- Weekend coverage load.
- Average ack time by user/team.
- Missed acknowledgements.
- Override frequency.
- Schedule gaps.
- Suggested rotation rebalancing.

---

## 4.18 AI Capabilities for On-Call and Incidents

### 4.18.1 AI Triage

On alert/ticket/incident creation, AI can suggest:

- Severity.
- Affected service.
- Owner team.
- Best responder.
- Related open incidents.
- Similar historical incidents.
- Recommended runbook.
- Likely root cause candidates.

### 4.18.2 AI Incident Brief

Generate a live brief:

```text
Current situation:
Payments API error rate rose to 18% starting 14:03 UTC. The incident affects checkout and subscription renewals. Primary suspected cause is database connection pool saturation after deployment 2026.06.25.3. Payments SRE is engaged; rollback is in progress.
```

### 4.18.3 AI Routing Explanation

For a routed ticket/alert:

- Explain why this team/user was selected.
- Explain why other rules did not match.
- Identify missing ownership metadata.

### 4.18.4 AI Noise Reduction

AI can recommend:

- Alert rules to tune.
- Alerts that frequently auto-resolve.
- Alerts with low incident correlation.
- Service dependency suppressions.
- Deduplication key improvements.

### 4.18.5 AI Follow-Up Suggestions

After incident resolution, AI can suggest:

- KB articles to create/update.
- Runbook steps to add.
- Monitoring gaps.
- SLA/SLO target changes.
- Automation opportunities.
- Asset/service ownership gaps.

---

## 4.19 On-Call & Incident Permissions

| Action | end_user | agent | team_lead | manager | admin | platform_admin | platform_support |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| View service status | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Declare incident | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Acknowledge alert | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Manage own notification profile | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Create schedule override request | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Approve schedule override | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Manage team schedules | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Manage escalation policies | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Manage service catalog | — | — | ✓ | ✓ | ✓ | ✓ | — |
| Publish status page update | — | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Publish postmortem | — | — | ✓ | ✓ | ✓ | ✓ | — |
| View all incident analytics | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Configure integrations | — | — | — | ✓ | ✓ | ✓ | — |

---

## 4.20 On-Call & Incident API Requirements

### 4.20.1 Services

```http
GET    /api/v1/services
POST   /api/v1/services
GET    /api/v1/services/{id}
PATCH  /api/v1/services/{id}
DELETE /api/v1/services/{id}
GET    /api/v1/services/{id}/dependencies
POST   /api/v1/services/{id}/dependencies
DELETE /api/v1/services/{id}/dependencies/{dependency_id}
GET    /api/v1/services/{id}/impact-analysis
GET    /api/v1/services/{id}/reliability
```

### 4.20.2 On-Call Schedules

```http
GET    /api/v1/on-call/schedules
POST   /api/v1/on-call/schedules
GET    /api/v1/on-call/schedules/{id}
PATCH  /api/v1/on-call/schedules/{id}
DELETE /api/v1/on-call/schedules/{id}
GET    /api/v1/on-call/schedules/{id}/preview?from=...&to=...
GET    /api/v1/on-call/who-is-on-call?team_id=...&service_id=...&at=...
POST   /api/v1/on-call/schedules/{id}/layers
PATCH  /api/v1/on-call/schedules/{id}/layers/{layer_id}
DELETE /api/v1/on-call/schedules/{id}/layers/{layer_id}
```

### 4.20.3 Overrides

```http
GET    /api/v1/on-call/overrides
POST   /api/v1/on-call/overrides
PATCH  /api/v1/on-call/overrides/{id}
POST   /api/v1/on-call/overrides/{id}/approve
POST   /api/v1/on-call/overrides/{id}/deny
POST   /api/v1/on-call/overrides/{id}/cancel
POST   /api/v1/on-call/shift-swap-requests
POST   /api/v1/on-call/shift-swap-requests/{id}/accept
POST   /api/v1/on-call/shift-swap-requests/{id}/decline
```

### 4.20.4 Escalation Policies

```http
GET    /api/v1/on-call/escalation-policies
POST   /api/v1/on-call/escalation-policies
GET    /api/v1/on-call/escalation-policies/{id}
PATCH  /api/v1/on-call/escalation-policies/{id}
DELETE /api/v1/on-call/escalation-policies/{id}
POST   /api/v1/on-call/escalation-policies/{id}/test
GET    /api/v1/on-call/escalation-policies/{id}/audit-log
```

### 4.20.5 Alerts

```http
GET    /api/v1/alerts
POST   /api/v1/alerts
GET    /api/v1/alerts/{id}
PATCH  /api/v1/alerts/{id}
POST   /api/v1/alerts/{id}/acknowledge
POST   /api/v1/alerts/{id}/resolve
POST   /api/v1/alerts/{id}/suppress
POST   /api/v1/alerts/{id}/escalate
POST   /api/v1/alerts/{id}/declare-incident
POST   /api/v1/alerts/bulk
```

### 4.20.6 Routing Rules

```http
GET    /api/v1/routing/rules
POST   /api/v1/routing/rules
GET    /api/v1/routing/rules/{id}
PATCH  /api/v1/routing/rules/{id}
DELETE /api/v1/routing/rules/{id}
POST   /api/v1/routing/preview
GET    /api/v1/routing/decisions/{id}
```

### 4.20.7 Incidents

```http
GET    /api/v1/incidents
POST   /api/v1/incidents
GET    /api/v1/incidents/{id}
PATCH  /api/v1/incidents/{id}
POST   /api/v1/incidents/{id}/declare
POST   /api/v1/incidents/{id}/acknowledge
POST   /api/v1/incidents/{id}/change-severity
POST   /api/v1/incidents/{id}/assign-role
POST   /api/v1/incidents/{id}/link-ticket
POST   /api/v1/incidents/{id}/link-alert
POST   /api/v1/incidents/{id}/link-service
POST   /api/v1/incidents/{id}/status-updates
GET    /api/v1/incidents/{id}/timeline
POST   /api/v1/incidents/{id}/timeline
POST   /api/v1/incidents/{id}/mitigate
POST   /api/v1/incidents/{id}/resolve
POST   /api/v1/incidents/{id}/close
```

### 4.20.8 Runbooks

```http
GET    /api/v1/runbooks
POST   /api/v1/runbooks
GET    /api/v1/runbooks/{id}
PATCH  /api/v1/runbooks/{id}
DELETE /api/v1/runbooks/{id}
POST   /api/v1/incidents/{id}/runbooks/{runbook_id}/start
POST   /api/v1/incidents/{id}/runbook-steps/{step_id}/complete
POST   /api/v1/incidents/{id}/runbook-steps/{step_id}/skip
```

### 4.20.9 Postmortems

```http
GET    /api/v1/postmortems
POST   /api/v1/incidents/{id}/postmortem
GET    /api/v1/postmortems/{id}
PATCH  /api/v1/postmortems/{id}
POST   /api/v1/postmortems/{id}/generate-ai-draft
POST   /api/v1/postmortems/{id}/submit-for-review
POST   /api/v1/postmortems/{id}/approve
POST   /api/v1/postmortems/{id}/publish
GET    /api/v1/postmortems/{id}/actions
POST   /api/v1/postmortems/{id}/actions
PATCH  /api/v1/postmortem-actions/{id}
```

### 4.20.10 Reports

```http
GET    /api/v1/on-call/reports/load
GET    /api/v1/on-call/reports/acknowledgement
GET    /api/v1/on-call/reports/escalation-failures
GET    /api/v1/incidents/reports/overview
GET    /api/v1/incidents/reports/mttr
GET    /api/v1/incidents/reports/by-service
GET    /api/v1/incidents/reports/postmortem-actions
GET    /api/v1/services/reports/reliability
```

---

# 5. Data Model Additions

## 5.1 SLA Tables

```text
sla_definitions
sla_definition_versions
sla_objectives
sla_agreements
sla_agreement_consumers
sla_runtime_instances
sla_runtime_objectives
sla_pause_events
sla_breach_events
sla_waivers
sla_calendars
sla_calendar_exceptions
sla_report_jobs
sla_scheduled_reports
sli_definitions
slo_definitions
slo_measurements
```

## 5.2 On-Call and Incident Tables

```text
services
service_dependencies
service_assets
on_call_schedules
on_call_schedule_layers
on_call_schedule_participants
on_call_overrides
shift_swap_requests
notification_profiles
notification_profile_steps
escalation_policies
escalation_policy_steps
escalation_runs
escalation_run_steps
alerts
alert_events
alert_suppressions
alert_dedup_groups
routing_rules
routing_decisions
incidents
incident_services
incident_roles
incident_alerts
incident_tickets
incident_timeline_events
incident_status_updates
incident_runbook_runs
incident_runbook_step_runs
runbooks
runbook_steps
postmortems
postmortem_actions
status_page_components
status_page_incidents
status_page_updates
```

## 5.3 Existing Model Integration

### Tickets

Add or connect:

- `service_id` nullable FK.
- `sla_runtime_instance_id` nullable FK.
- `routed_by_rule_id` nullable FK.
- `routing_decision_id` nullable FK.
- `on_call_assignment_id` nullable FK.
- Link table `ticket_alerts`.
- Link table `ticket_incidents`.

### Teams

Add or connect:

- `default_schedule_id`.
- `default_escalation_policy_id`.
- `team_type`.
- `load_balancing_strategy`.

### Assets

Add or connect:

- `service_assets` mapping.
- Impact analysis across service dependency graph.

### KB

Add or connect:

- Runbooks can link to KB articles.
- Postmortem can create KB draft.
- Incident resolution can link KB article.

### Notifications

Extend notification types:

- `on_call_shift_starting`
- `on_call_override_requested`
- `alert_triggered`
- `alert_ack_required`
- `escalation_step_started`
- `incident_declared`
- `incident_role_assigned`
- `incident_status_update_due`
- `postmortem_action_assigned`
- `sla_at_risk`
- `sla_breached`

---

# 6. Key Workflows

## 6.1 Ticket Routed to Current Support Person

```text
1. User creates critical incident ticket.
2. Ticket category maps to service = Payments API.
3. Service owner team = Payments SRE.
4. Routing rule selects current primary on-call from Payments Primary Schedule.
5. Ticket assigned to current primary responder.
6. Acknowledgement SLA starts.
7. Notification profile pages responder.
8. If no ack in 5 minutes, escalation policy pages secondary.
9. SLA/routing history records every decision.
10. Manager dashboard shows ticket as acknowledged, at-risk, or breached.
```

## 6.2 Alert Creates Incident

```text
1. Datadog sends webhook alert with service label payments-api.
2. Alert dedup key groups related alerts.
3. Routing engine maps alert to Payments SRE escalation policy.
4. Primary on-call is paged.
5. Responder acknowledges.
6. Alert severity and impact trigger auto incident declaration.
7. Incident room is created.
8. Runbook is attached.
9. Status page draft is created for communications lead approval.
10. SLA objectives track ack, mitigation, restoration, and update cadence.
```

## 6.3 SLA Breach Escalates to On-Call

```text
1. High-priority ticket reaches 90% of response SLA.
2. SLA engine emits at-risk event.
3. Assigned agent is notified.
4. At breach, escalation policy triggers.
5. Current team on-call is paged.
6. Team lead is added as watcher.
7. Breach event appears in SLA reports.
8. AI generates breach explanation and recommended process fix.
```

## 6.4 Post-Incident Learning Loop

```text
1. Sev1 incident is resolved.
2. Postmortem is required by policy.
3. AI drafts postmortem from timeline, chat highlights, alerts, and status updates.
4. Incident commander edits and submits for review.
5. Manager approves and publishes internal RCA.
6. Follow-up actions are assigned.
7. KB draft and runbook updates are suggested.
8. Reliability dashboard tracks action completion and repeat incidents.
```

---

# 7. Frontend UX Requirements

## 7.1 SLA UX

Required screens:

- SLA dashboard.
- SLA definition list.
- SLA definition wizard.
- SLA agreement list/detail.
- SLA calendar builder.
- SLA rule preview/simulator.
- Ticket SLA panel.
- Incident SLA panel.
- SLA breach detail page.
- Customer SLA report viewer.
- Scheduled report configuration.

Ticket detail SLA panel must show:

- Applied SLA name.
- Match reason.
- First response due.
- Resolution due.
- Remaining time.
- Pause status.
- Breach risk.
- Warning/escalation timeline.
- Manual actions: pause, resume, override, waive, recalculate.

## 7.2 On-Call UX

Required screens:

- On-call “who is on call now” view.
- Schedule calendar view.
- Schedule builder.
- Schedule layer editor.
- Override/swap workflow.
- Escalation policy builder.
- Notification profile editor.
- Routing rule builder.
- Routing simulator.
- Alert inbox.
- Incident command center.
- Incident timeline.
- Runbook execution view.
- Status update composer.
- Postmortem editor.
- Reliability dashboards.

## 7.3 Ease-of-Use Requirements

- Admins can create a basic support rotation in under 5 minutes.
- Admins can create a basic SLA policy in under 5 minutes.
- On-call page should answer “who owns this right now?” in one click.
- Every automated assignment must have an explanation.
- Every high-risk SLA must have a recommended next action.
- Schedule gaps must be visually obvious.
- Incident declaration must be possible from ticket detail, alert detail, service detail, or chat command.

---

# 8. Security, Audit, and Compliance

## 8.1 Security

- All endpoints require JWT except public status pages and public KB/status APIs.
- Tenant context comes from JWT or platform `X-Tenant-ID`, never client body.
- All IDs are UUID v7.
- RBAC enforced at service layer.
- Platform access audited through `platform_audit_log`.
- Alert payloads sanitized before storage.
- Secrets in webhook payloads must be masked.
- Notification integrations must never log tokens.
- Phone/SMS providers must be abstracted behind notification service.

## 8.2 Audit Events

Audit these events:

- SLA definition created/updated/activated/deprecated.
- SLA agreement created/activated/suspended/terminated.
- SLA override/waiver/recalculation.
- SLA breach and warning.
- Schedule created/updated/deleted.
- Schedule override created/approved/denied.
- Escalation policy changed.
- Alert acknowledged/resolved/suppressed.
- Incident declared/changed/resolved/closed.
- Status page update published.
- Postmortem approved/published.
- Routing rule changed.
- Notification profile changed.

## 8.3 Immutable Records

The following must be append-only:

- SLA runtime events.
- SLA breach events.
- Routing decisions.
- Escalation runs.
- Alert events.
- Incident timeline events.
- Platform audit log.
- Postmortem publication snapshots.

---

# 9. Observability Requirements

## 9.1 Metrics

Expose Prometheus metrics:

- `sla_objectives_running_total`
- `sla_objectives_breached_total`
- `sla_objectives_at_risk_total`
- `sla_calculation_duration_ms`
- `routing_decisions_total`
- `routing_decision_duration_ms`
- `alerts_ingested_total`
- `alerts_deduplicated_total`
- `escalations_started_total`
- `escalations_acknowledged_total`
- `escalations_timed_out_total`
- `incidents_declared_total`
- `incident_mttr_seconds`
- `on_call_pages_total`
- `notification_delivery_failures_total`

## 9.2 Tracing

OpenTelemetry spans must include:

- `tenant_id`
- `service_id`
- `team_id`
- `sla_definition_id`
- `escalation_policy_id`
- `routing_rule_id`
- `incident_id`

## 9.3 Logs

Structured logs for:

- SLA calculation.
- SLA breach detection.
- Routing decision.
- Alert ingestion.
- Deduplication.
- Escalation step.
- Notification delivery.
- Incident state change.
- AI recommendation.

WARNING+ events dual-write to `system_logs` following existing engineering standards.

---

# 10. Non-Functional Requirements

## 10.1 Performance

- Who-is-on-call lookup: P95 < 100ms.
- Routing decision: P95 < 150ms.
- SLA due date calculation: P95 < 50ms for common calendars.
- Alert ingestion API: P95 < 200ms after authentication and persistence.
- Incident detail page: P95 < 500ms for active incidents with up to 1,000 timeline events.
- Schedule preview for 90 days: P95 < 500ms.
- SLA dashboard: P95 < 500ms using rollups/materialized summaries.

## 10.2 Scalability

- Support 10,000 active on-call schedules across platform.
- Support 1M alerts/day per large tenant with deduplication and async processing.
- Support 100K incidents/year per tenant.
- Support 1M SLA runtime objectives per tenant.
- Notification delivery workers scale independently.
- Alert ingestion workers scale independently.
- SLA breach detector shards by tenant.

## 10.3 Reliability

- Paging and escalation must be highly reliable.
- Notification dispatch must persist before send.
- Delivery retries with exponential backoff.
- Failed notification attempts visible in escalation run detail.
- Alert ingestion must be idempotent via source + source_alert_id or dedup_key.
- Escalation runs must survive worker restarts.
- Schedule calculation must be deterministic.

## 10.4 Graceful Degradation

| Dependency failure | Behavior |
|---|---|
| Redis down | Fall back to DB for idempotency and active escalation state where possible; log warning. |
| Email provider down | Continue in-app/push/SMS, retry email later. |
| SMS provider down | Use fallback provider if configured, else escalate through other channels. |
| Slack/Teams down | Continue web/mobile/email paging. |
| AI provider down | Core routing/SLA/incident workflows continue without AI suggestions. |
| Monitoring webhook spike | Queue and deduplicate; shed low-priority duplicate alerts if configured. |

---

# 11. Implementation Phases

## Phase A — SLA Foundation

- SLA definitions.
- SLA objectives.
- SLA runtime instances.
- SLA snapshots.
- Calendar policies.
- Ticket SLA panel.
- Breach detector.
- Warnings and notifications.
- Basic reports.

## Phase B — On-Call Foundation

- Support team enhancements.
- On-call schedules.
- Schedule layers.
- Overrides.
- Who-is-on-call API.
- Notification profiles.
- Escalation policies.
- Ticket routing to current on-call.

## Phase C — Alerting and Incident Core

- Alert ingestion API/webhooks.
- Deduplication.
- Routing engine.
- Incident model.
- Incident lifecycle.
- Incident timeline.
- Ticket/alert/incident linking.
- Incident room integrations.

## Phase D — SRE Maturity

- Service catalog.
- Service dependencies.
- Runbooks.
- Status pages.
- Postmortems.
- Follow-up actions.
- Reliability dashboards.

## Phase E — AI and Optimization

- SLA breach prediction.
- AI routing suggestions.
- AI incident brief.
- AI postmortem draft.
- Alert noise reduction recommendations.
- Reliability improvement suggestions.
- Gold dataset for routing decisions and escalation outcomes.

---

# 12. Acceptance Criteria

## 12.1 SLA Module

- Admin can create SLA definition with response and resolution objectives.
- Admin can attach SLA to product/service/category/customer agreement.
- Ticket creation applies correct SLA automatically and stores match explanation.
- Ticket status `pending` pauses SLA and status resume recalculates due dates correctly.
- SLA warnings trigger before breach.
- SLA breach creates event, notification, and report entry.
- Admin can waive breach with reason and audit trail.
- SLA reports show compliance by team, customer, category, and priority.
- Historical SLA reports remain stable after SLA definition changes.

## 12.2 On-Call Module

- Admin can create team schedule with primary and secondary layers.
- User can request schedule override and team lead can approve.
- System can answer who is on call for a team/service at a given time.
- Critical ticket can route to current on-call responder.
- Responder acknowledgement stops acknowledgement timer.
- If responder does not ack, escalation proceeds to next step.
- Routing decision stores explanation.
- On-call reports show load, ack time, missed pages, and after-hours pages.

## 12.3 Incident Module

- Alert can be ingested via API/webhook.
- Alert deduplication groups repeated alerts.
- Alert can declare incident.
- Incident can assign roles, services, tickets, alerts, and timeline events.
- Incident status update cadence can be tracked as SLA objective.
- Incident can be resolved and closed.
- Sev1 incident requires postmortem by policy.
- AI can draft postmortem but cannot publish without approval.

---

# 13. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Paging reliability failures | High | Persist escalation runs, multi-channel notifications, retries, delivery visibility, provider fallback. |
| SLA calculation complexity | High | Snapshot policies, central SLA engine, deterministic DB-time calculations, extensive test suite. |
| Routing misconfiguration | Medium | Rule simulator, routing explanations, safe defaults, audit log, rollback. |
| Alert noise overload | High | Deduplication, suppression, dependency-aware grouping, AI noise recommendations. |
| On-call burnout | Medium | Load reports, fairness metrics, max assignment caps, schedule gap detection. |
| AI hallucination in incidents | Medium | Mark suggestions clearly, require human approval for status/RCA/postmortem publication. |
| Cross-tenant data leakage | High | Tenant-scoped tables, RLS, JWT tenant context, platform audit log, strict API scoping. |

---

# 14. Open Product Decisions

1. Should external status pages be included in MVP or Phase D?
2. Should SMS/phone paging be native at launch or abstracted until provider selection?
3. Should incident objects reuse ticket number format or have a distinct `INCID` sequence?
4. Should SLO telemetry ingestion be built now or after core ticket/incident SLAs are stable?
5. Should customer-facing SLA penalty/credit calculation be included in MVP?
6. Which chat integration ships first: Slack, Microsoft Teams, or both?
7. Should on-call mobile push be available at launch, or should email/SMS/Slack cover MVP?

---

# 15. Source Notes

Competitive features referenced while preparing this PRD:

- Rootly public documentation and product pages: incident management, on-call schedules, alerts, status pages, workflows, retrospectives.
- incident.io public product pages: on-call, incident response, status pages, service/catalog-driven workflows.
- FireHydrant public product pages: on-call, alerting, service catalog, runbooks, retrospectives, status pages, AI insights, analytics.
- Xurrent public product/help pages: SLA management, service offerings, service management, multi-tenant ITSM/ITOM/ESM patterns.

This PRD is designed to fit the existing IQ-ITSM architecture: FastAPI, PostgreSQL, Redis, Celery, Socket.IO, IAM JWT, UUID v7, row-level tenancy, system logs, AI budget controls, ticketing, assets, KB, and virtual agent.
