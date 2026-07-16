# IQ-ITSM — Support Recording, RCA Governance & Enforcement Requirements

## 0. Document Purpose

This PRD extends IQ-ITSM with two production-grade operational governance capabilities:

1. **Support Session Recording Module** — associate Microsoft Teams screen-sharing/session recordings, transcripts, notes, permissions, customer consent, and evidence artifacts with tickets, incidents, problems, changes, and RCA records.
2. **Root Cause Analysis (RCA) Governance Module** — mandate, track, enforce, approve, and report RCA/post-incident review workflows for incidents, SLA breaches, repeat issues, escalations, outages, customer-impacting defects, and support recordings.

The goal is to make IQ-ITSM behave like a modern service management and SRE operations platform: every important support interaction is attached to the ticket, every serious failure has an auditable RCA, and managers can see which RCAs and recordings are missing, overdue, low quality, or blocked.

This module must integrate with the existing IQ-ITSM ticketing, SLA, on-call, incident, asset, KB, IAM, notification, audit log, AI, and platform-tier architecture.

---

## 1. Competitive / Industry Patterns

### 1.1 Product Lessons

| Source pattern | Capability lesson for IQ-ITSM |
|---|---|
| Microsoft Teams recordings | Teams recordings and transcripts are stored in OneDrive/SharePoint and can be retrieved through Microsoft Graph APIs when permissioned correctly. IQ-ITSM should store metadata and controlled links, not copy video by default. |
| Rootly retrospectives | Retrospectives/post-incident reviews can be configured as optional, mandatory, or skipped by severity/team/incident type. IQ-ITSM should support RCA policy rules, not one global rule. |
| incident.io postmortem workflows | Postmortem documents can be automatically created when an incident reaches a certain status. IQ-ITSM should trigger RCA records automatically when an incident closes, an SLA breaches, or a severity threshold is met. |
| SRE / ITIL practice | RCA should be blameless, evidence-backed, action-oriented, and focused on systemic prevention, not individual fault. |

### 1.2 IQ-ITSM Differentiation

IQ-ITSM should combine:

- Ticket-linked evidence collection from Microsoft Teams.
- Mandatory RCA policy enforcement based on severity, SLA breach, customer tier, repeat incident, major incident, and manager override.
- AI-assisted transcript summarization, timeline extraction, probable cause suggestions, and action-item drafting.
- Audit-grade approval workflow with ownership, due dates, evidence completeness, action item completion, and executive dashboards.
- Strong privacy controls so customer recordings are not casually exposed to every support agent.

---

## 2. Product Principles

### 2.1 Evidence First

- A ticket should show all relevant support evidence in one place: recordings, transcript, chat notes, attachments, comments, timeline, escalation, linked incidents, linked assets, linked KB, linked RCA, and linked action items.
- The system should not rely only on free-text comments when a screen-sharing session exists.
- Evidence must preserve source, time, owner, permissions, retention policy, and access history.

### 2.2 RCA Is a Workflow, Not a Document

- RCA must have states, owners, due dates, required sections, approvals, action items, evidence checks, reminders, and dashboard visibility.
- RCA completion means the report is approved and corrective/preventive actions are tracked, not simply that a text box was filled.

### 2.3 Modern and Easy

- Support agents should be able to attach a Teams recording to a ticket in one click or paste a Teams/SharePoint/OneDrive recording URL.
- Managers should be able to define RCA rules using a policy builder.
- Dashboard should answer: “What is missing?”, “What is overdue?”, “Who owns it?”, “Which customer-impacting incidents still lack RCA?”, “Which RCAs have open corrective actions?”, and “Which tickets had a recording but no summary?”

### 2.4 Blameless and Preventive

- RCA templates and AI prompts must avoid blame language.
- Root causes should be categorized into systems/process/people/tooling/environment/third-party/data/configuration/change management gaps.
- Every RCA should produce preventive actions, owner, due date, verification criteria, and follow-up review.

---

## 3. Module A — Support Session Recording Management

## 3.1 Overview

Support agents often conduct screen-sharing sessions with customers using Microsoft Teams and record them. IQ-ITSM must allow those recordings to be linked to tickets and used as support evidence while respecting privacy, customer consent, access controls, and retention rules.

This module must support two modes:

1. **Manual association** — agent pastes or selects a Teams/SharePoint/OneDrive recording link and attaches it to a ticket.
2. **Automated ingestion** — IQ-ITSM receives Microsoft Graph/webhook metadata for recordings/transcripts and suggests matching tickets based on meeting subject, participants, time window, ticket number in title, chat context, or customer email domain.

---

## 3.2 Recording Sources

Supported source types:

| Source | Requirement |
|---|---|
| Microsoft Teams meeting recording | Primary supported source at MVP. |
| Microsoft Teams transcript | Store transcript metadata and, if allowed, transcript text or transcript file reference. |
| OneDrive/SharePoint file link | Store controlled external link and file metadata. |
| Manual file upload | Optional fallback for recordings exported by support. Must use existing secure attachment pipeline and virus scan. |
| Future: Zoom/Google Meet | Design source model as generic, but MVP can implement Teams only. |

---

## 3.3 Recording Object Model

### 3.3.1 Support Recording

A **Support Recording** is a metadata record representing a customer support session recording.

Required fields:

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `source_type` | teams, sharepoint, onedrive, manual_upload, zoom_future, google_meet_future |
| `source_recording_id` | Provider recording ID, nullable for manual link |
| `source_meeting_id` | Teams/Graph online meeting ID if available |
| `source_drive_id` | OneDrive/SharePoint drive ID if available |
| `source_item_id` | Drive item ID if available |
| `recording_url` | External URL or internal object URL |
| `transcript_url` | External transcript URL or internal object URL, nullable |
| `title` | Recording/session title |
| `description` | Optional notes |
| `started_at` | Meeting start time |
| `ended_at` | Meeting end time |
| `duration_seconds` | Recording duration |
| `organizer_user_id` | Local user mirror if matched |
| `organizer_email` | Organizer email from source |
| `customer_contact_name` | Customer contact if known |
| `customer_contact_email` | Customer contact email if known |
| `participants` | JSONB list of participants: name, email, role, internal/external |
| `consent_status` | not_required, captured_in_teams, manually_confirmed, missing, disputed |
| `sensitivity` | normal, confidential, contains_pii, contains_credentials, legal_hold |
| `access_policy` | ticket_team_only, assigned_agent_only, manager_only, customer_visible, restricted |
| `retention_policy_id` | Link to recording retention policy |
| `retention_expires_at` | When the recording should expire/delete/archive |
| `storage_mode` | external_reference, copied_to_itsm_storage, manual_upload |
| `status` | discovered, linked, needs_review, restricted, archived, deleted, inaccessible |
| `ai_summary_status` | not_requested, pending, completed, failed, skipped_no_consent |
| `ai_summary` | AI-generated session summary, nullable |
| `ai_action_items` | AI-suggested action items, nullable |
| `created_by` | User who linked/imported recording |
| `created_at` | Timestamp |
| `updated_at` | Timestamp |

### 3.3.2 Ticket Recording Link

A **Ticket Recording Link** connects one or more recordings to a ticket.

Required fields:

| Field | Description |
|---|---|
| `ticket_id` | FK tickets |
| `recording_id` | FK support_recordings |
| `link_type` | support_call, troubleshooting, training, escalation, customer_validation, rca_evidence |
| `linked_by` | User who linked it |
| `linked_at` | Timestamp |
| `is_primary` | Marks primary recording for the ticket |
| `visible_to_customer` | Whether customer portal can show it |
| `notes` | Optional link-specific note |
| `evidence_weight` | none, supporting, primary, required_for_rca |

Uniqueness:

- `UNIQUE(ticket_id, recording_id)`
- Only one `is_primary = true` per ticket unless explicitly allowed by tenant setting.

### 3.3.3 Recording Access Log

Every recording access must be logged.

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `recording_id` | FK support_recordings |
| `actor_id` | User who accessed it |
| `actor_email` | Denormalized email |
| `action` | viewed_metadata, opened_recording, downloaded, viewed_transcript, generated_summary, changed_permissions |
| `source_ip` | Request IP |
| `request_id` | Request correlation ID |
| `created_at` | Timestamp |

Retention:

- Access logs retained for at least 2 years.
- Insert-only; no update/delete by API.

---

## 3.4 Recording Linking UX

### 3.4.1 Ticket Detail Page

Add a **Recordings** tab/section to ticket detail.

Must show:

- Recording title.
- Source: Teams / OneDrive / SharePoint / manual upload.
- Meeting date and duration.
- Organizer.
- Participants.
- Consent status.
- Transcript availability.
- AI summary status.
- Access restriction badge.
- “Open recording” button.
- “Open transcript” button where allowed.
- “Generate summary” button where allowed.
- “Use as RCA evidence” toggle.
- “Restrict access” / “Request access” workflow.

### 3.4.2 Add Recording Flow

Agent can attach recording by:

1. Pasting a Teams/SharePoint/OneDrive recording URL.
2. Searching recent meetings they organized or attended.
3. Selecting from suggested unlinked recordings.
4. Uploading a recording file if tenant policy allows.

System must validate:

- Link is reachable or at least syntactically valid.
- User has permission to reference it.
- File type and source type are allowed.
- Ticket belongs to the same tenant.
- Recording does not already belong to a conflicting tenant.
- Consent policy is satisfied or flagged as missing.

### 3.4.3 Recording Suggestions

IQ-ITSM should suggest likely ticket matches for recordings based on:

- Ticket number in meeting title/body/chat.
- Meeting participants matching requester/assignee/customer contacts.
- Time window around ticket comments/status changes.
- Teams meeting organizer matching assigned agent.
- Shared customer email domain.
- Manual confidence score.

Suggested match statuses:

- `high_confidence` — ticket number found or exact participant/ticket correlation.
- `medium_confidence` — participant and time correlation.
- `low_confidence` — weak metadata match; requires manual review.

Agent must confirm before linking unless tenant enables auto-linking for exact ticket number matches.

---

## 3.5 Microsoft Teams Integration Requirements

### 3.5.1 Integration Modes

| Mode | Description | MVP? |
|---|---|---|
| Manual URL linking | Agent pastes Teams/SharePoint/OneDrive recording link. | Yes |
| User delegated search | Agent connects Microsoft account and searches their recent recordings. | Phase 1 |
| Tenant application ingestion | Admin grants Graph permissions and IQ-ITSM periodically imports recording metadata. | Phase 2 |
| Meeting-specific app/RSC | Teams app installed in the meeting can fetch recording/transcript only for that meeting. | Phase 2 |

### 3.5.2 Data to Retrieve

When permissioned, retrieve:

- Meeting ID / online meeting ID.
- Recording file ID and web URL.
- Transcript file ID and web URL.
- Organizer.
- Participants.
- Start/end time.
- Recording creation time.
- File size.
- Permissions/sharing state if available.
- Transcript text only when allowed by tenant policy and Microsoft permissions.

### 3.5.3 Storage Rule

Default behavior:

- Store **metadata and secure link**, not the binary video.
- Do not duplicate Teams recording into IQ-ITSM object storage unless tenant explicitly enables “copy recording to ITSM evidence vault.”

Rationale:

- Reduces storage cost.
- Preserves Microsoft 365 permission model.
- Avoids unnecessary copying of customer-sensitive video.

### 3.5.4 Link Expiry and Access Failure

System must detect and show:

- Recording link accessible.
- Link requires Microsoft login.
- Link expired/inaccessible.
- User lacks permission.
- Recording deleted from source.
- Transcript missing.

If inaccessible:

- Mark recording status `inaccessible`.
- Notify ticket assignee and team lead if recording is required evidence.
- Show remediation: “Ask organizer to reshare” or “Re-authorize Microsoft integration.”

---

## 3.6 Recording Consent, Privacy & Compliance

### 3.6.1 Consent Policy

Tenant admins must configure recording consent rules:

| Setting | Description |
|---|---|
| `recording_consent_required` | true/false |
| `consent_source` | teams_notice, verbal_confirmation, ticket_checkbox, contract, not_required |
| `block_link_if_missing_consent` | true/false |
| `allow_customer_visibility` | true/false |
| `redact_transcript_before_ai` | true/false |
| `allow_ai_summary` | true/false |
| `recording_retention_days` | default retention period |

### 3.6.2 Sensitive Content Flagging

Agents/managers can flag a recording as:

- Contains credentials.
- Contains customer PII.
- Contains payment/financial data.
- Contains legal/compliance discussion.
- Contains internal-only support discussion.

When flagged:

- Access restricted based on tenant policy.
- AI summarization disabled unless explicitly allowed by manager/admin.
- System warns before opening/downloading.
- Access logged as high-sensitivity event.

### 3.6.3 Transcript Redaction

Before AI summarization, transcript redaction must attempt to mask:

- Email addresses.
- Phone numbers.
- API keys / tokens.
- Password-looking strings.
- Credit card-like numbers.
- SSNs where applicable.
- IP addresses if tenant treats them as sensitive.
- Customer-defined regex patterns.

Original transcript must remain external or securely stored; AI should receive redacted content unless tenant has explicit AI/PII consent enabled.

---

## 3.7 Recording AI Features

AI features must be optional and routed through the existing central AI service wrapper, budget controls, PII masking, tenant feature flags, timeout/retry policy, and usage logging.

### 3.7.1 Session Summary

Generate a structured summary:

- Customer issue.
- Environment/context.
- What the support agent observed.
- Actions taken.
- Customer-provided evidence.
- Next steps.
- Open questions.
- Potential RCA relevance.
- Follow-up tasks.

### 3.7.2 Timeline Extraction

From transcript/meeting notes, extract timeline events:

- Customer reported symptom.
- Screen share started.
- Agent inspected configuration.
- Error reproduced.
- Workaround applied.
- Resolution verified.
- Follow-up promised.

Timeline entries can be inserted into ticket history or RCA evidence after human approval.

### 3.7.3 Action Item Extraction

AI should suggest action items with:

- Title.
- Owner suggestion.
- Due date suggestion if mentioned.
- Source timestamp.
- Confidence.
- Link to recording/transcript evidence.

Agent must confirm before creating actual tasks.

---

## 4. Module B — RCA Governance

## 4.1 Overview

The RCA Governance Module ensures serious issues are reviewed, documented, approved, and converted into preventive action. RCA records can be linked to tickets, incidents, problems, changes, assets, services, customers, SLAs, support recordings, alerts, and KB articles.

RCA should be required based on configurable policies, not manually remembered by managers.

---

## 4.2 RCA Trigger Rules

Tenant admins can create RCA requirement policies.

### 4.2.1 Default RCA Triggers

RCA must be auto-required when any of the following occurs:

| Trigger | Default behavior |
|---|---|
| Major incident declared | RCA required |
| Severity 1 / critical incident closed | RCA required |
| SLA breached for critical/high ticket | RCA required |
| Customer-impacting outage | RCA required |
| Repeat incident count exceeds threshold | RCA required |
| Incident caused by failed change | RCA required |
| Security/privacy incident flag set | RCA required |
| Manager manually requires RCA | RCA required |
| Recording marked `required_for_rca` | RCA required |
| Problem ticket created from incident | RCA required or linked to existing RCA |

### 4.2.2 Conditional RCA Policy Builder

Admin can define rules:

```
IF ticket.type = incident
AND ticket.priority IN (critical, high)
AND sla.breached = true
THEN require RCA due in 3 business days, owner = team_lead, approver = manager
```

Rule conditions:

- Ticket type.
- Priority/severity.
- SLA breach type.
- Customer tier.
- Product/service.
- Team.
- Category.
- Root cause category if known.
- Incident duration.
- Number of affected users.
- Revenue/customer impact.
- Repeat count in time window.
- Recording exists or missing.
- Security/compliance flags.
- Manual override.

Rule outputs:

- RCA required / optional / skipped.
- RCA template.
- RCA owner role.
- Approver role.
- Due date rule.
- Required evidence types.
- Required action item count.
- Escalation policy.
- Customer-facing summary required yes/no.

---

## 4.3 RCA Lifecycle

RCA status must be state-machine governed, not a free-form enum update.

```
not_required
required → draft → under_review → approved → actions_in_progress → completed
          ↘ rejected → draft
          ↘ waived
          ↘ overdue
```

### 4.3.1 State Rules

| Transition | Rule |
|---|---|
| `required → draft` | RCA owner starts report or system creates draft automatically. |
| `draft → under_review` | Required sections completed and evidence checklist passes. |
| `under_review → approved` | Approver signs off. |
| `under_review → rejected` | Approver returns with comments. |
| `approved → actions_in_progress` | At least one corrective/preventive action exists if required by policy. |
| `actions_in_progress → completed` | All required actions closed or formally accepted as risk. |
| `required/draft → waived` | Only manager/admin can waive with reason. |
| `any active → overdue` | System-computed status when due date passes; original workflow status retained in `previous_status`. |

Invalid state transitions return HTTP 409 with valid next states.

---

## 4.4 RCA Record Object Model

### 4.4.1 RCA Record

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `rca_number` | RCA-00001 per tenant |
| `title` | RCA title |
| `status` | required, draft, under_review, approved, rejected, waived, actions_in_progress, completed, overdue |
| `severity` | sev1, sev2, sev3, sev4, low |
| `owner_id` | RCA owner |
| `approver_id` | RCA approver |
| `team_id` | Owning team |
| `service_id` | Linked service, nullable |
| `product_id` | Linked product, nullable |
| `customer_org_id` | Customer org if applicable |
| `source_type` | ticket, incident, problem, change, sla_breach, manual |
| `trigger_policy_id` | RCA rule that created it |
| `due_at` | Due date/time |
| `submitted_at` | Submitted for review |
| `approved_at` | Approval time |
| `completed_at` | Completion time |
| `waived_at` | Waiver time |
| `waived_by` | User who waived |
| `waiver_reason` | Required if waived |
| `executive_summary` | Short summary |
| `customer_impact` | Description of customer impact |
| `business_impact` | Revenue/SLA/reputation impact |
| `technical_summary` | Technical facts |
| `root_cause_statement` | Final root cause statement |
| `contributing_factors` | JSONB list |
| `detection_gap` | How detection failed or worked |
| `response_gap` | How response could improve |
| `prevention_plan` | Summary of preventive plan |
| `lessons_learned` | Lessons learned |
| `customer_facing_summary` | Optional public-safe summary |
| `ai_draft_status` | not_requested, pending, completed, failed, skipped |
| `ai_confidence` | Optional confidence score |
| `created_by` | User/system |
| `created_at` | Timestamp |
| `updated_at` | Timestamp |

### 4.4.2 RCA Linked Objects

RCA can link to many evidence/source objects.

| Field | Description |
|---|---|
| `rca_id` | FK RCA |
| `entity_type` | ticket, incident, problem, change, asset, service, alert, recording, kb_article, comment, attachment, log_link, dashboard_link |
| `entity_id` | UUID or external ID |
| `link_role` | source, evidence, related, caused_by, affected, corrective_reference |
| `required` | Whether this evidence is required by policy |
| `linked_by` | User/system |
| `linked_at` | Timestamp |

### 4.4.3 RCA Evidence Checklist

Each RCA has required evidence controls.

Evidence types:

- Primary incident/ticket linked.
- Customer impact documented.
- Timeline completed.
- Support recording linked if one exists.
- Recording summary reviewed if recording linked.
- Relevant logs/alerts linked.
- Service/asset impact linked.
- SLA breach evidence linked if RCA triggered by SLA.
- Customer communication captured.
- Corrective/preventive actions created.
- Approval comments present.

Fields:

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `rca_id` | FK RCA |
| `evidence_type` | Enum |
| `required` | true/false |
| `status` | missing, provided, waived, not_applicable |
| `provided_entity_type` | Linked entity type |
| `provided_entity_id` | Linked entity ID |
| `waived_by` | User if waived |
| `waiver_reason` | Required if waived |
| `updated_at` | Timestamp |

---

## 4.5 RCA Templates

Tenant admins can define templates.

### 4.5.1 Default Templates

| Template | Use case |
|---|---|
| Standard IT Support RCA | High-priority support incidents and repeat user problems. |
| Major Incident Postmortem | Sev1/Sev2 outages and SRE incidents. |
| SLA Breach RCA | Tickets or incidents that breached response/resolve SLA. |
| Failed Change RCA | Change caused incident/outage/regression. |
| Customer Escalation RCA | Executive/customer escalation requiring business-facing summary. |
| Security/Privacy RCA | Restricted template for sensitive events. |

### 4.5.2 Required RCA Sections

Common sections:

1. Executive summary.
2. What happened.
3. Customer/business impact.
4. Detection timeline.
5. Response timeline.
6. Root cause.
7. Contributing factors.
8. What went well.
9. What went poorly.
10. Why detection did not catch it earlier.
11. Why response took the time it took.
12. Corrective actions.
13. Preventive actions.
14. Evidence links.
15. Customer-facing summary.
16. Approval record.

### 4.5.3 RCA Analysis Methods

RCA template can require one or more analysis techniques:

- 5 Whys.
- Fishbone/Ishikawa categories.
- Timeline-based analysis.
- Fault tree analysis.
- Change correlation analysis.
- Service dependency/CMDB impact analysis.
- Human/process/tooling/system contributing-factor analysis.

---

## 4.6 RCA Action Items / CAPA

RCA must support corrective and preventive actions.

### 4.6.1 RCA Action Item

| Field | Description |
|---|---|
| `id` | UUID v7 primary key |
| `tenant_id` | Tenant scope |
| `rca_id` | FK RCA |
| `title` | Action title |
| `description` | Detailed action |
| `action_type` | corrective, preventive, detection_improvement, documentation, training, automation, monitoring, process_change, customer_followup |
| `priority` | critical, high, medium, low |
| `owner_id` | User responsible |
| `team_id` | Owning team |
| `due_at` | Due date |
| `status` | open, in_progress, blocked, done, cancelled, accepted_risk, overdue |
| `verification_method` | How completion will be verified |
| `verified_by` | User who verified |
| `verified_at` | Timestamp |
| `linked_ticket_id` | Optional follow-up ticket |
| `linked_change_id` | Optional change ticket |
| `created_at` | Timestamp |
| `updated_at` | Timestamp |

### 4.6.2 Enforcement Rules

- RCA cannot move to `completed` while required action items are open unless manager accepts risk.
- High/Critical action items require verification before closure.
- Overdue RCA action items notify owner, team lead, manager, and optionally platform support depending on tenant policy.
- Repeat overdue action items appear on executive dashboard.

---

## 4.7 RCA AI Features

AI must assist but not decide final root cause without human approval.

### 4.7.1 AI RCA Draft

AI draft inputs:

- Ticket title/description.
- Ticket comments and history.
- Incident timeline.
- SLA breach data.
- Support recording transcript/summary if allowed.
- Linked alerts/log references.
- Linked assets/services.
- Linked changes/deployments.
- Previous similar RCAs.

AI output:

- Draft executive summary.
- Draft timeline.
- Probable contributing factors.
- Questions still unanswered.
- Candidate root cause categories.
- Suggested corrective/preventive actions.
- Suggested KB updates.
- Customer-facing draft summary.

Agent/manager must review and approve.

### 4.7.2 RCA Similarity Search

System should identify similar past incidents/RCAs using:

- Text embeddings.
- Category/service/asset overlap.
- Error signature similarity.
- Customer impact similarity.
- Corrective action pattern.

UX:

- RCA page shows “Similar past RCAs.”
- Agent can import lessons/action templates from prior RCA.

### 4.7.3 RCA Quality Check

AI can flag quality gaps:

- Root cause statement is too vague.
- Action items are not preventive.
- No owner assigned.
- Due dates missing.
- Customer impact missing.
- Recording exists but not summarized.
- RCA says “human error” without system/process analysis.
- No detection improvement for long detection delay.

---

## 5. Module C — RCA and Recording Dashboard

## 5.1 Overview

Managers need one dashboard to enforce:

- Which tickets/incidents require RCA.
- Which RCA records are missing, overdue, rejected, awaiting approval, or blocked.
- Which RCA action items are overdue.
- Which tickets had customer screen recordings.
- Which required recordings are missing or inaccessible.
- Which recordings are linked but not summarized/reviewed.
- Which teams repeatedly breach SLA or have repeat RCAs.

---

## 5.2 Dashboard Personas

| Persona | Dashboard needs |
|---|---|
| Support Manager | RCA compliance, overdue RCAs, missing recordings, agent/team ownership. |
| SRE / Incident Commander | Major incident postmortems, action item burn-down, service reliability trends. |
| Compliance / GRC | Evidence completeness, audit trail, approvals, retention, recording access logs. |
| Executive | Trend of major issues, SLA breach RCA compliance, repeat root causes, prevention progress. |
| Platform Support | Cross-tenant health view for tenants who opt into managed support. |

---

## 5.3 Dashboard Widgets

### 5.3.1 RCA Compliance Summary

Cards:

- RCA required this month.
- RCA completed on time.
- RCA overdue.
- RCA awaiting approval.
- RCA rejected.
- RCA waived.
- RCA action items overdue.
- Average RCA completion time.
- RCA compliance percentage.

### 5.3.2 Recording Compliance Summary

Cards:

- Tickets with recordings.
- Tickets requiring recording but missing it.
- Recordings linked but inaccessible.
- Recordings missing consent.
- Recordings not summarized.
- Recordings flagged sensitive.
- Recordings used as RCA evidence.
- Average time from meeting end to ticket association.

### 5.3.3 RCA Pipeline Kanban

Columns:

- Required.
- Draft.
- Under Review.
- Rejected.
- Approved.
- Actions In Progress.
- Completed.
- Waived.
- Overdue.

Each card shows:

- RCA number.
- Source ticket/incident.
- Severity.
- Owner.
- Due date.
- Age.
- Missing evidence count.
- Open action item count.
- Linked recording indicator.

### 5.3.4 Overdue Heatmap

Group overdue RCA items by:

- Team.
- Owner.
- Product/service.
- Customer tier.
- RCA trigger reason.
- Root cause category.

### 5.3.5 Root Cause Trends

Charts:

- Root cause category distribution.
- Contributing factor distribution.
- Repeat root causes.
- Failed change incidents.
- Monitoring/detection gaps.
- Customer-impacting vs internal-only incidents.
- SLA breach RCAs by category/team.

### 5.3.6 Action Item Burn-Down

Charts:

- Open action items by age.
- Action items by owner/team.
- Corrective vs preventive ratio.
- Overdue action item trend.
- Accepted-risk items.
- Verified vs self-closed actions.

### 5.3.7 Evidence Completeness Dashboard

Checklist metrics:

- RCA with timeline complete.
- RCA with support recording evidence when required.
- RCA with transcript/summary reviewed.
- RCA with customer impact documented.
- RCA with service/asset impact linked.
- RCA with required approvals.
- RCA with preventive actions.

---

## 5.4 Dashboard Filters

Filters:

- Date range.
- Product/service.
- Team.
- Owner.
- Customer/org.
- Severity.
- SLA breach yes/no.
- RCA status.
- Recording status.
- Consent status.
- Root cause category.
- Action item status.
- Has customer-facing summary.
- Has linked Teams recording.
- Has linked incident/ticket/problem/change.

---

## 5.5 Enforcement Alerts

Notification rules:

| Event | Notify |
|---|---|
| RCA created and assigned | Owner |
| RCA due in 24h/48h | Owner + team lead |
| RCA overdue | Owner + team lead + manager |
| RCA rejected | Owner |
| RCA approved | Owner + action item owners |
| RCA action item overdue | Owner + team lead |
| Required recording missing | Ticket assignee + team lead |
| Recording inaccessible | Recording owner + ticket assignee |
| Missing consent on linked recording | Ticket assignee + manager/GRC |
| Sensitive recording accessed | Optional compliance notification |

Escalation cadence must be configurable by tenant.

---

## 6. API Design Requirements

Base path: `/api/v1/`

## 6.1 Support Recording APIs

```
GET    /api/v1/support-recordings
POST   /api/v1/support-recordings
GET    /api/v1/support-recordings/{id}
PATCH  /api/v1/support-recordings/{id}
DELETE /api/v1/support-recordings/{id}                 ← soft delete / unlink rules apply

POST   /api/v1/support-recordings/link-from-url
POST   /api/v1/support-recordings/{id}/refresh-metadata
POST   /api/v1/support-recordings/{id}/generate-summary
GET    /api/v1/support-recordings/{id}/summary
GET    /api/v1/support-recordings/{id}/access-log
POST   /api/v1/support-recordings/{id}/request-access
POST   /api/v1/support-recordings/{id}/grant-access
POST   /api/v1/support-recordings/{id}/restrict
```

## 6.2 Ticket Recording APIs

```
GET    /api/v1/tickets/{id}/recordings
POST   /api/v1/tickets/{id}/recordings                  ← link existing recording
POST   /api/v1/tickets/{id}/recordings/from-url         ← create/link from URL
DELETE /api/v1/tickets/{id}/recordings/{recording_id}   ← unlink only
PATCH  /api/v1/tickets/{id}/recordings/{recording_id}   ← update link metadata
GET    /api/v1/tickets/{id}/recording-suggestions
POST   /api/v1/tickets/{id}/recording-suggestions/{suggestion_id}/accept
POST   /api/v1/tickets/{id}/recording-suggestions/{suggestion_id}/reject
```

## 6.3 Microsoft Integration APIs

```
GET    /api/v1/integrations/microsoft/status
POST   /api/v1/integrations/microsoft/connect
POST   /api/v1/integrations/microsoft/disconnect
GET    /api/v1/integrations/microsoft/recordings/recent
POST   /api/v1/integrations/microsoft/recordings/sync
POST   /api/v1/webhooks/microsoft/graph
```

Security:

- Microsoft webhook endpoint must validate subscription/client state.
- Graph tokens must be stored encrypted via secret manager or tenant integration credential vault.
- No Microsoft token should ever be logged.

## 6.4 RCA APIs

```
GET    /api/v1/rca
POST   /api/v1/rca
GET    /api/v1/rca/{id}
PATCH  /api/v1/rca/{id}
DELETE /api/v1/rca/{id}                      ← soft delete / manager only

POST   /api/v1/rca/{id}/submit
POST   /api/v1/rca/{id}/approve
POST   /api/v1/rca/{id}/reject
POST   /api/v1/rca/{id}/waive
POST   /api/v1/rca/{id}/reopen
POST   /api/v1/rca/{id}/generate-ai-draft
POST   /api/v1/rca/{id}/quality-check
GET    /api/v1/rca/{id}/similar
GET    /api/v1/rca/{id}/history
```

## 6.5 RCA Evidence APIs

```
GET    /api/v1/rca/{id}/evidence
POST   /api/v1/rca/{id}/evidence
DELETE /api/v1/rca/{id}/evidence/{evidence_id}
GET    /api/v1/rca/{id}/evidence-checklist
PATCH  /api/v1/rca/{id}/evidence-checklist/{check_id}
POST   /api/v1/rca/{id}/evidence-checklist/{check_id}/waive
```

## 6.6 RCA Action Item APIs

```
GET    /api/v1/rca/{id}/actions
POST   /api/v1/rca/{id}/actions
PATCH  /api/v1/rca/{id}/actions/{action_id}
POST   /api/v1/rca/{id}/actions/{action_id}/complete
POST   /api/v1/rca/{id}/actions/{action_id}/verify
POST   /api/v1/rca/{id}/actions/{action_id}/accept-risk
```

## 6.7 RCA Policy / Admin APIs

```
GET    /api/v1/tenant/rca-policies
POST   /api/v1/tenant/rca-policies
GET    /api/v1/tenant/rca-policies/{id}
PATCH  /api/v1/tenant/rca-policies/{id}
DELETE /api/v1/tenant/rca-policies/{id}
POST   /api/v1/tenant/rca-policies/{id}/test

GET    /api/v1/tenant/rca-templates
POST   /api/v1/tenant/rca-templates
PATCH  /api/v1/tenant/rca-templates/{id}
DELETE /api/v1/tenant/rca-templates/{id}

GET    /api/v1/tenant/recording-policies
PATCH  /api/v1/tenant/recording-policies
```

## 6.8 Dashboard APIs

```
GET /api/v1/dashboards/rca/summary
GET /api/v1/dashboards/rca/pipeline
GET /api/v1/dashboards/rca/overdue
GET /api/v1/dashboards/rca/root-cause-trends
GET /api/v1/dashboards/rca/action-burndown
GET /api/v1/dashboards/rca/evidence-completeness

GET /api/v1/dashboards/recordings/summary
GET /api/v1/dashboards/recordings/missing-required
GET /api/v1/dashboards/recordings/inaccessible
GET /api/v1/dashboards/recordings/consent-issues
GET /api/v1/dashboards/recordings/linked-to-rca
```

---

## 7. Permissions Matrix

| Action | end_user | agent | team_lead | manager | admin | platform_support | platform_admin |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Link recording to own ticket | Limited | ✓ | ✓ | ✓ | ✓ | Read | ✓ |
| View recording metadata | Own visible | ✓ | ✓ | ✓ | ✓ | Read | ✓ |
| Open restricted recording | — | If granted | ✓ | ✓ | ✓ | Read if granted | ✓ |
| Generate recording AI summary | — | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Change recording access policy | — | — | ✓ | ✓ | ✓ | — | ✓ |
| View recording access log | — | — | — | ✓ | ✓ | Read | ✓ |
| Create RCA manually | — | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Own/edit assigned RCA | — | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Submit RCA for approval | — | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| Approve RCA | — | — | ✓ | ✓ | ✓ | — | ✓ |
| Waive RCA | — | — | — | ✓ | ✓ | — | ✓ |
| Manage RCA policies | — | — | — | ✓ | ✓ | — | ✓ |
| View RCA dashboard | — | ✓ | ✓ | ✓ | ✓ | Read | ✓ |
| Export RCA reports | — | — | ✓ | ✓ | ✓ | Read | ✓ |

Rules:

- End users must not see internal RCA content unless explicitly published as customer-facing summary.
- Platform support remains read-only unless platform_admin grants scoped support action rights.
- Sensitive/security RCA templates can override default permissions with stricter access.

---

## 8. Notifications

Notification types to add:

| Type | Description |
|---|---|
| `recording_linked` | Recording linked to ticket. |
| `recording_required_missing` | Ticket requires recording but none linked. |
| `recording_inaccessible` | Linked recording cannot be accessed. |
| `recording_consent_missing` | Consent status missing/disputed. |
| `recording_summary_ready` | AI summary completed. |
| `rca_required` | RCA required and assigned. |
| `rca_due_soon` | RCA approaching due date. |
| `rca_overdue` | RCA overdue. |
| `rca_submitted` | RCA submitted for approval. |
| `rca_rejected` | RCA rejected with comments. |
| `rca_approved` | RCA approved. |
| `rca_action_assigned` | RCA action assigned. |
| `rca_action_overdue` | RCA action overdue. |
| `rca_completed` | RCA completed. |

Channels:

- In-app notification.
- Email.
- Optional Teams/Slack later.
- Optional executive weekly digest.

---

## 9. Reporting and Exports

Reports:

1. RCA compliance by month.
2. RCA overdue report.
3. RCA action item aging report.
4. SLA breach RCA report.
5. Major incident RCA report.
6. Root cause trend report.
7. Repeat incident/root cause report.
8. Recording association report.
9. Missing required recording report.
10. Recording access audit report.
11. Sensitive recording access report.
12. RCA evidence completeness report.
13. Customer-facing RCA summary export.
14. Executive reliability review pack.

Export formats:

- CSV.
- XLSX.
- PDF later.
- JSON API.

---

## 10. Non-Functional Requirements

### 10.1 Performance

- Ticket detail must load linked recording metadata within P95 < 300ms excluding external Microsoft API calls.
- Dashboard summary queries must return within P95 < 500ms for 1M tickets and 100K RCA records using pre-aggregations where needed.
- Recording metadata sync must run asynchronously; never block ticket page load.
- AI summary generation must run asynchronously via Celery.

### 10.2 Reliability

- If Microsoft Graph is unavailable, ticket/RCA workflows must continue.
- Recording links remain as stored external references even if metadata refresh fails.
- Failed metadata refresh creates warning log and retry task.
- RCA creation and enforcement must not depend on external Microsoft services.

### 10.3 Security

- All recording and RCA entities are tenant-scoped.
- No client-supplied tenant_id trusted.
- All recording opens/downloads logged.
- Sensitive recordings require elevated permission.
- Microsoft tokens encrypted at rest.
- AI summarization disabled by default for sensitive recordings unless policy allows.
- Transcript and recording content must never be written to application logs.

### 10.4 Auditability

- RCA history insert-only.
- Recording access log insert-only.
- RCA approval decisions insert-only.
- RCA waiver requires reason.
- RCA action accepted-risk requires reason and approver.
- Dashboard metrics must be traceable to underlying records.

### 10.5 Retention

- Recording metadata retention configurable by tenant.
- External recording retention follows Microsoft 365 policy unless copied into IQ-ITSM evidence vault.
- If copied into IQ-ITSM storage, retention policy must be enforced by scheduled task.
- RCA records retained according to compliance policy; default 3 years.
- RCA access/audit logs retained at least 2 years.

---

## 11. Data Model Additions

### 11.1 Recording Tables

```
support_recordings
├── id                         UUID v7 PK
├── tenant_id                  FK tenants
├── source_type                ENUM
├── source_recording_id         VARCHAR NULLABLE
├── source_meeting_id           VARCHAR NULLABLE
├── source_drive_id             VARCHAR NULLABLE
├── source_item_id              VARCHAR NULLABLE
├── recording_url               TEXT
├── transcript_url              TEXT NULLABLE
├── title                       VARCHAR
├── description                 TEXT NULLABLE
├── started_at                  TIMESTAMPTZ NULLABLE
├── ended_at                    TIMESTAMPTZ NULLABLE
├── duration_seconds            INT NULLABLE
├── organizer_user_id           FK users NULLABLE
├── organizer_email             VARCHAR NULLABLE
├── customer_contact_name       VARCHAR NULLABLE
├── customer_contact_email      VARCHAR NULLABLE
├── participants                JSONB
├── consent_status              ENUM
├── sensitivity                 ENUM
├── access_policy               ENUM
├── retention_policy_id         FK recording_retention_policies NULLABLE
├── retention_expires_at        TIMESTAMPTZ NULLABLE
├── storage_mode                ENUM
├── status                      ENUM
├── ai_summary_status           ENUM
├── ai_summary                  TEXT NULLABLE
├── ai_action_items             JSONB NULLABLE
├── created_by                  FK users
├── created_at                  TIMESTAMPTZ
└── updated_at                  TIMESTAMPTZ
INDEX (tenant_id, started_at DESC)
INDEX (tenant_id, organizer_email)
INDEX (tenant_id, status)
```

```
ticket_recording_links
├── ticket_id                   FK tickets
├── recording_id                FK support_recordings
├── link_type                   ENUM
├── linked_by                   FK users
├── linked_at                   TIMESTAMPTZ
├── is_primary                  BOOLEAN DEFAULT false
├── visible_to_customer         BOOLEAN DEFAULT false
├── notes                       TEXT NULLABLE
└── evidence_weight             ENUM
PK (ticket_id, recording_id)
```

```
recording_access_log
├── id              UUID v7 PK
├── tenant_id       FK tenants
├── recording_id    FK support_recordings
├── actor_id        FK users NULLABLE
├── actor_email     VARCHAR
├── action          ENUM
├── source_ip       INET
├── request_id      VARCHAR
└── created_at      TIMESTAMPTZ
INDEX (recording_id, created_at DESC)
INDEX (tenant_id, created_at DESC)
```

### 11.2 RCA Tables

```
rca_records
├── id                         UUID v7 PK
├── tenant_id                  FK tenants
├── rca_number                 VARCHAR
├── title                      VARCHAR
├── status                     ENUM
├── previous_status             ENUM NULLABLE
├── severity                   ENUM
├── owner_id                   FK users
├── approver_id                FK users NULLABLE
├── team_id                    FK teams NULLABLE
├── service_id                 UUID NULLABLE
├── product_id                 FK products NULLABLE
├── customer_org_id            VARCHAR NULLABLE
├── source_type                ENUM
├── trigger_policy_id          FK rca_policies NULLABLE
├── due_at                     TIMESTAMPTZ
├── submitted_at               TIMESTAMPTZ NULLABLE
├── approved_at                TIMESTAMPTZ NULLABLE
├── completed_at               TIMESTAMPTZ NULLABLE
├── waived_at                  TIMESTAMPTZ NULLABLE
├── waived_by                  FK users NULLABLE
├── waiver_reason              TEXT NULLABLE
├── executive_summary          TEXT NULLABLE
├── customer_impact            TEXT NULLABLE
├── business_impact            TEXT NULLABLE
├── technical_summary          TEXT NULLABLE
├── root_cause_statement       TEXT NULLABLE
├── contributing_factors       JSONB
├── detection_gap              TEXT NULLABLE
├── response_gap               TEXT NULLABLE
├── prevention_plan            TEXT NULLABLE
├── lessons_learned            TEXT NULLABLE
├── customer_facing_summary    TEXT NULLABLE
├── ai_draft_status            ENUM
├── ai_confidence              FLOAT NULLABLE
├── created_by                 FK users NULLABLE
├── created_at                 TIMESTAMPTZ
└── updated_at                 TIMESTAMPTZ
UNIQUE (tenant_id, rca_number)
INDEX (tenant_id, status, due_at)
INDEX (tenant_id, owner_id, status)
INDEX (tenant_id, severity, created_at DESC)
```

```
rca_linked_entities
├── id             UUID v7 PK
├── rca_id         FK rca_records
├── entity_type    ENUM
├── entity_id      VARCHAR
├── link_role      ENUM
├── required       BOOLEAN DEFAULT false
├── linked_by      FK users NULLABLE
└── linked_at      TIMESTAMPTZ
INDEX (rca_id)
INDEX (entity_type, entity_id)
```

```
rca_evidence_checklist
├── id                    UUID v7 PK
├── rca_id                FK rca_records
├── evidence_type         ENUM
├── required              BOOLEAN
├── status                ENUM
├── provided_entity_type  ENUM NULLABLE
├── provided_entity_id    VARCHAR NULLABLE
├── waived_by             FK users NULLABLE
├── waiver_reason         TEXT NULLABLE
└── updated_at            TIMESTAMPTZ
```

```
rca_action_items
├── id                    UUID v7 PK
├── tenant_id             FK tenants
├── rca_id                FK rca_records
├── title                 VARCHAR
├── description           TEXT
├── action_type           ENUM
├── priority              ENUM
├── owner_id              FK users
├── team_id               FK teams NULLABLE
├── due_at                TIMESTAMPTZ
├── status                ENUM
├── verification_method   TEXT NULLABLE
├── verified_by           FK users NULLABLE
├── verified_at           TIMESTAMPTZ NULLABLE
├── linked_ticket_id      FK tickets NULLABLE
├── linked_change_id      FK tickets NULLABLE
├── created_at            TIMESTAMPTZ
└── updated_at            TIMESTAMPTZ
INDEX (tenant_id, owner_id, status, due_at)
INDEX (rca_id, status)
```

```
rca_history
├── id              UUID v7 PK
├── rca_id          FK rca_records
├── actor_id        FK users NULLABLE
├── field_changed   VARCHAR
├── old_value       JSONB
├── new_value       JSONB
└── changed_at      TIMESTAMPTZ
INDEX (rca_id, changed_at)
-- Immutable insert-only table
```

```
rca_policies
├── id              UUID v7 PK
├── tenant_id       FK tenants
├── name            VARCHAR
├── description     TEXT
├── status          ENUM (draft, active, disabled, archived)
├── conditions      JSONB
├── outputs         JSONB
├── priority        INT
├── created_by      FK users
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
```

```
rca_templates
├── id              UUID v7 PK
├── tenant_id       FK tenants
├── name            VARCHAR
├── description     TEXT
├── sections        JSONB
├── required_fields JSONB
├── is_default      BOOLEAN
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
```

---

## 12. Workflow Requirements

## 12.1 Recording Association Workflow

```
Ticket exists
  → Agent starts Teams session with customer
  → Teams records meeting
  → Recording appears in OneDrive/SharePoint
  → Agent pastes recording link OR system discovers recording
  → IQ-ITSM validates metadata and consent
  → Agent links recording to ticket
  → System logs association
  → Optional AI summary generated
  → Recording can be marked as RCA evidence
```

## 12.2 RCA Auto-Creation Workflow

```
Ticket/Incident closed OR SLA breached OR manager requires RCA
  → RCA policy engine evaluates rules
  → If RCA required: create RCA record
  → Assign owner + approver + due date
  → Create evidence checklist
  → Link source ticket/incident/SLA breach
  → Link recordings if available
  → Notify owner
  → Show in RCA dashboard
```

## 12.3 RCA Approval Workflow

```
Owner completes RCA draft
  → System validates required sections + evidence checklist
  → Owner submits for review
  → Approver approves or rejects
  → If approved: action items become enforceable
  → RCA enters actions_in_progress
  → Once actions verified: RCA completed
```

## 12.4 RCA Waiver Workflow

```
RCA required
  → Manager/admin chooses waive
  → Must enter waiver reason
  → Optional customer-facing explanation
  → System records waiver in history
  → Dashboard counts RCA as waived, not completed
```

---

## 13. Acceptance Criteria

### 13.1 Recording Association

- Agent can link a Teams recording URL to a ticket.
- Recording appears on ticket detail with source, organizer, date, consent, and access status.
- Recording access is permission controlled.
- Opening a recording writes access log.
- Agent can mark recording as RCA evidence.
- Manager dashboard shows tickets with missing required recordings.
- Inaccessible recordings are detected and surfaced.

### 13.2 RCA Enforcement

- RCA policy auto-creates RCA record when critical incident closes.
- RCA policy auto-creates RCA record when SLA breach occurs if rule requires it.
- RCA owner receives notification.
- RCA cannot be submitted if required sections are missing.
- RCA cannot be approved if required evidence is missing unless waived.
- RCA cannot be completed if required action items are open unless accepted risk is recorded.
- Overdue RCA appears on dashboard and sends escalation notification.

### 13.3 Dashboard

- Dashboard shows RCA required, completed, overdue, under review, waived, and action items overdue.
- Dashboard shows tickets with recordings, required recordings missing, inaccessible recordings, and consent issues.
- Filters work by team, owner, product, customer, date, severity, SLA breach, RCA status, and recording status.
- Dashboard metrics link back to source records.

### 13.4 AI

- AI summary generation is asynchronous.
- AI never blocks ticket/RCA workflow.
- AI redacts transcript content before external API calls unless tenant explicitly allows PII.
- AI RCA draft is clearly marked as AI-generated and requires human approval.
- AI usage is recorded against tenant budget.

---

## 14. Implementation Phases

## Phase 1 — Manual Recording Links + RCA Core

- Recording metadata model.
- Manual URL linking to ticket.
- Recording access log.
- Basic recording tab on ticket detail.
- RCA record model.
- RCA manual create/edit/submit/approve/reject/waive.
- RCA linked entities.
- RCA action items.
- Basic RCA dashboard.

## Phase 2 — RCA Policy Engine + Enforcement

- RCA policy builder.
- Auto-create RCA from SLA breach, critical incident, major incident, repeat incident.
- Evidence checklist.
- Required recording rules.
- Overdue notifications/escalations.
- RCA action item verification and accepted-risk workflow.
- Enhanced dashboards.

## Phase 3 — Microsoft Teams Integration

- Microsoft integration setup.
- Recent recordings search.
- Metadata sync from Microsoft Graph.
- Recording suggestions for tickets.
- Inaccessible link detection.
- Transcript metadata linking.
- Optional transcript fetch if tenant permission allows.

## Phase 4 — AI Assistance

- Recording transcript summary.
- Action item extraction from recording/transcript.
- RCA AI draft.
- RCA quality check.
- Similar RCA search.
- Customer-facing RCA summary draft.

## Phase 5 — Compliance and Executive Reporting

- Sensitive recording access audit dashboard.
- RCA compliance export.
- Executive reliability review pack.
- Recording retention enforcement.
- Legal hold support.
- Cross-tenant platform support dashboard where allowed.

---

## 15. Open Questions

1. Should IQ-ITSM copy Teams recordings into its own evidence vault, or only store metadata/external links by default?
2. Should customer-facing users ever see recordings, or should recordings remain internal-only?
3. Which incidents require RCA by default: only Sev1/critical, or also high-priority SLA breaches?
4. Should RCA action items create normal follow-up tickets/changes automatically?
5. Should transcript text be stored in IQ-ITSM, or only AI-generated summaries and external transcript links?
6. What retention period should apply to support recordings: 90 days, 1 year, or customer-specific?
7. Does the company need legal hold for customer recordings?
8. Should RCA be called “RCA,” “Postmortem,” “Post-Incident Review,” or configurable by tenant?

---

## 16. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Recording storage | External reference by default | Avoids copying sensitive video and preserves Microsoft 365 permissions. |
| RCA enforcement | Policy-driven | Different teams/severities need different RCA requirements. |
| RCA completion | Requires approved report + action tracking | Prevents fake completion by filling a document only. |
| Evidence model | Generic linked entities | Supports tickets, incidents, recordings, logs, alerts, assets, services, KB, attachments. |
| Recording access | Always audited | Recordings may contain sensitive customer data. |
| AI | Assistive, async, human-approved | Improves speed without making unverified root-cause claims. |
| Dashboard | Compliance + operations | Managers need enforcement, not only analytics. |

---

## 17. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Teams recording permissions are complex | Start with manual URL linking, then add Graph integration in phases. |
| Sensitive customer data in recordings | Consent policy, access controls, sensitivity flags, audit logs, redaction before AI. |
| RCA becomes bureaucratic | Policy-based triggers, optional/waived states, templates by severity. |
| Managers mark RCA done without action closure | Completion requires action item verification or accepted-risk approval. |
| AI hallucinates root cause | AI output marked draft only; evidence checklist and approver required. |
| Dashboards become slow | Use indexes, pre-aggregations, materialized summaries for high-volume tenants. |
| Recording links expire or become inaccessible | Scheduled metadata refresh and inaccessible-recording alerts. |

---

## 18. Definition of Done

This module is considered production-ready when:

- Tickets can link to Microsoft Teams recording URLs.
- Recording metadata, consent, access policy, and access logs are stored.
- RCA records are created manually and automatically by policy.
- RCA has owner, approver, lifecycle, evidence checklist, action items, history, and waiver handling.
- Dashboards show RCA and recording compliance with drill-down.
- Notifications enforce missing/overdue RCA and recording requirements.
- Sensitive recordings are access-controlled and audited.
- AI summaries/drafts are optional, asynchronous, redacted, and human-approved.
- APIs are documented in OpenAPI.
- Tests cover permission checks, state transitions, policy triggers, dashboard counts, and audit logging.
