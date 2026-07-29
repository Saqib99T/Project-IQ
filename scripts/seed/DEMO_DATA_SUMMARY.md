# Demo / Dummy Data — Module-Level Summary

Realistic, FK-valid seed data loaded into both PostgreSQL databases on **2026-07-02**.
Multi-tenant across **3 organisations**, all rows internally consistent (every
foreign key resolves; verified with orphan checks = 0).

- **Scripts:** [gen_itsm_seed.py](gen_itsm_seed.py) → emits [seed_itsm.sql](seed_itsm.sql); [seed_chatbot.sql](seed_chatbot.sql)
- **Idempotent:** itsm uses deterministic `uuid5` PKs + `ON CONFLICT (id) DO NOTHING`; Chatbot is a guarded `DO` block (no-op if `sender_id LIKE 'seed-demo-%'` already exists). Safe to re-run.
- **Markers:** itsm demo rows carry `metadata->>'seed' = 'piq-demo'`; Chatbot demo conversations use `sender_id LIKE 'seed-demo-%'`.
- **Tenants:** `Blue Team` and `PIQ-Client` (existing, IAM-linked — enriched) + `Acme Corp` (new self-contained demo org, `iam_org_id = demo-acme-org`). Blue Team & Acme also have matching Chatbot data.

> Loaded as table-owner `itsm_user` (bypasses RLS). Platform "show-all" view sees all 3 tenants; a tenant-scoped login sees only its own rows.

---

## Database 1 — `itsm_db` (ITSM service)

Per tenant ×3 unless noted. **Identical shape in each of the 3 tenants.**

| Module | Tables | Per tenant | Total (×3) | Notes |
|--------|--------|-----------:|-----------:|-------|
| **Identity & Access** | users, user_itsm_roles, departments, teams, team_members | 8 users, 8 role grants, 2 depts, 2 teams, 5 memberships | 24 users, 6 teams | 1 manager, 1 team-lead, 3 agents, 3 end-users; mapped to system roles |
| **Ticketing** | ticket_categories, ticket_tags, tickets, ticket_comments, ticket_history, ticket_tag_assignments, ticket_watchers | 4 categories, 4 tags, 10 tickets, 6 comments, 4 history, 6 tag links, 2 watchers | **30 tickets** | Mixed type (incident/request/problem/change) & status (open/in-progress/pending/approval/resolved/closed) & priority |
| **SLM / SLA** | sla_agreements, sla_targets, sla_rules, coverage_windows, sla_instances, sla_events | 3 agreements, 5 targets, 2 rules, 2 windows, 5 instances, 10 events | 9 agreements, 15 targets, 15 instances | SLA + OLA kinds; running/met/breached instances; 24×7 and business-hours windows |
| **On-Call / SRE** | severity_levels, schedules, schedule_layers, escalation_policies, escalation_steps, oncall_services, contact_methods | 3 severities, 1 schedule (+1 layer), 1 policy (+2 steps), 2 services, 5 contacts | 6 services, 3 schedules | SEV1–3; weekly rotation of 3 agents; schedule→user escalation |
| **Alerting** | alerts | 4 alerts | **12 alerts** | open / acknowledged / resolved; one linked to an incident |
| **Incidents** | incidents, incident_roles, incident_timeline, incident_status_updates, incident_retrospectives, retro_action_items | 2 incidents, 5 roles, 6 timeline, 2 updates, 1 retro, 2 action items | 6 incidents, 3 retros | 1 resolved (full PIR + IC/comms/ops/scribe) + 1 active investigating |
| **Knowledge Base** | kb_spaces, kb_categories, kb_tags, kb_articles | 1 space, 3 categories, 3 tags, 5 articles | 15 new articles | published/internal/public/agents-only mix; view & helpful counts (122 pre-existing KB rows untouched) |
| **Assets / CMDB** | asset_categories, asset_types, vendors, assets, asset_relationships | 2 categories, 3 types, 2 vendors, 6 assets, 2 relationships | **18 assets** | Laptops (assigned to users), servers, a SaaS licence; `runs_on` / `connected_to` links |
| **Reliability (SLO, Phase 9)** | sli_sources, slo_objectives, slo_measurements, slo_burn_alerts | 1 SLI source, 2 SLOs, 58 measurements, 3 burn rules | 6 SLOs, **174 measurements** | Payments SLO **meeting** (99.94% ≥ 99.9%); Web SLO **at-risk** (99.35% < 99.5%); fast + slow burn rules |

### Phase-2 seed — remaining demo-worthy entities ([seed_itsm_phase2.sql](seed_itsm_phase2.sql), generator [gen_itsm_seed2.py](gen_itsm_seed2.py))

Populated so no configured screen is empty (totals ×3 tenants): **AI SLA breach predictions** (6), **sla_metrics_daily** compliance history (21), **notifications** + preferences (18), **maintenance windows** (3), **status page config + subscriptions**, **workflows** (3), **schedule overrides** (3), **KB feedback + tag assignments + ticket→KB links**, **ticket approvals** (the pending-approval change ticket) + **escalations**, **alert routing rules** + **heartbeats**, **user→department assignments** (24), and **SLA underpinning** (OLA underpins the SLA resolution target).

### Phase-3 seed — Support Recording + RCA Governance ([seed_itsm_phase3.sql](seed_itsm_phase3.sql), generator [gen_itsm_seed3.py](gen_itsm_seed3.py))

Loaded **2026-07-29**, covering the specs/08 Phase 1+2 module (migrations `0034`-`0036`), which postdates the Phase-1/2 seed above. One recording+RCA pipeline per tenant spanning every lifecycle stage, wired onto **existing** Phase-1 tickets/incident so nothing dangles:

| RCA | Status | Source | Story |
|---|---|---|---|
| RCA‑2026‑0001 | **completed** | incident "Payments API outage" | Elevates the existing published retrospective into a governed RCA: full evidence checklist provided, both action items verified/done, AI draft accepted. Evidence includes a bridge-call recording linked directly to the RCA (no ticket — incident-only). |
| RCA‑2026‑0002 | **actions_in_progress** | ticket #90005 "Intermittent packet loss" | Approved with 2 CAPA items — one verified done, one **overdue** (not yet closed) — showing why an approved RCA still isn't complete. Recording evidence attached and summarized. |
| RCA‑2026‑0003 | **under_review** | ticket #90008 "Payroll app slow" | Submitted but blocked: 3 of 11 evidence-checklist items still missing (recording summary, asset impact, customer comms) because the linked recording has **disputed consent** + `contains_pii` sensitivity, so its AI summary was skipped. |
| RCA‑2026‑0004 | **overdue** | ticket #90002 "Office VPN down" | Required but untouched past its due date; linked recording is **inaccessible** (expired OneDrive link) with consent missing — a realistic reason nobody's started the draft. |
| RCA‑2026‑0005 | **waived** | ticket #90009 "Printer jamming" | Manager-waived with a recorded reason (isolated hardware fault); evidence checklist mixes `provided` + `waived` items. |

Also per tenant: **3 RCA policies** (major-incident, SLA-breach, repeat-incident triggers) for the policy-builder screen; **1 plain non-RCA recording** (ticket #90001) for the everyday "attach a call" flow; a **tenant recording policy** singleton; and a realistic **recording access log** (view/open/summary/restrict/download) across all 5 recordings. Orphan-FK checks = 0.

**Note on dates:** Phase-1/2 rows anchor to **2026‑07‑02**; Phase‑3 RCA due dates/history anchor to **2026‑07‑29** (load date) so "overdue"/"under review"/"in progress" read as live rather than stale — the two epochs are independent and don't need to match.

**Cross-module wiring (realistic references):**
- Tickets → requester/assignee (users), team, category, department; some tickets have SLA instances tied to a target + agreement, plus comments, history and tags.
- Incident "Payments API outage" ← source alert `al4`, affected service `Payments API`, staffed with 4 incident roles, full timeline, published retrospective + 2 action items.
- On-call service → escalation policy → steps (schedule then manager); schedule layer → 3 agent participants; agents have email/SMS contact methods.

---

## Database 2 — `Chatbot` (conversational assistant)

Added on top of existing live-ish data; tied to the **Blue Team** org (`5f75b273…`)
and **Acme** demo org, reusing existing `chat_apps` (IT/HR/Accounting/General)
and operators (ids 8, 9).

| Module | Table | Added | Notes |
|--------|-------|------:|-------|
| **Conversations** | conversations | 8 | resolved, active, and handoff states across IT/HR/Accounting/product apps |
| **Messages** | messages | 19 | user / bot / operator turns with intents (password_reset, vpn_issue, leave_balance, …) |
| **Feedback** | feedback | 4 | 3 thumbs-up + 1 thumbs-down with comment & rating |
| **Human handoff** | handoff_queue, handoff_consent_log, operator_messages | 2 + 2 + 2 | one resolved handoff (operator 9, rated 5) + one waiting in queue; consent logged |
| **Operator macros** | canned_responses | 5 | VPN, password, invoice, greeting, closing — org/app scoped |
| **Notifications** | notifications | 6 | ticket_updated, handoff_*, kb_article_published, ticket_assigned |

**Identity linkage:** Chatbot `user_id` / `notifications.user_id` use the same
demo email identities as the itsm users (e.g. `casey.brooks@blue.demo`,
`jordan.patel@acme.demo`), so a person's chat history, notifications and ITSM
tickets line up across both databases.

---

## How to reload / reset

```bash
# itsm_db (idempotent — safe to re-run)
python scripts/seed/gen_itsm_seed.py  > scripts/seed/seed_itsm.sql          # PYTHONUTF8=1 on Windows
python scripts/seed/gen_itsm_seed2.py > scripts/seed/seed_itsm_phase2.sql
python scripts/seed/gen_itsm_seed3.py > scripts/seed/seed_itsm_phase3.sql
cat scripts/seed/seed_itsm.sql        | docker exec -i itsm-service-db-1 psql -U itsm_user -d itsm_db -v ON_ERROR_STOP=1
cat scripts/seed/seed_itsm_phase2.sql | docker exec -i itsm-service-db-1 psql -U itsm_user -d itsm_db -v ON_ERROR_STOP=1
cat scripts/seed/seed_itsm_phase3.sql | docker exec -i itsm-service-db-1 psql -U itsm_user -d itsm_db -v ON_ERROR_STOP=1

# Chatbot (idempotent guard)
cat scripts/seed/seed_chatbot.sql | docker exec -i itsm-service-db-1 psql -U itsm_user -d Chatbot -v ON_ERROR_STOP=1
```

To remove: delete rows where `metadata->>'seed'='piq-demo'` (itsm) /
`sender_id LIKE 'seed-demo-%'` (Chatbot), plus the `Acme Corp` tenant
(cascades). A pre-seed snapshot also exists under `DB Backup/` (2026-07-02_1512).
