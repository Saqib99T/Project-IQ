# P3 implementation plans

Grounded plans for four P3 roadmap items (#4 Slack/Teams/WhatsApp is **on hold** —
infra/credential-gated). Each is scoped against the code that already exists, so
the work is mostly "fill the gap," not "build from scratch."

Repos: `Project-IQ-V2` (chat/handoff/admin) · `itsm-service` (tickets).

---

## 1. KB robustness & i18n

**What already exists**
- Ingestion is mostly resilient: `sentence_transformers` import and pgvector both
  have try/except fallbacks (`common/vector_search.py`, `web/api/kb_cache_manager.py`);
  itsm-sync won't wipe the cache on a transient outage (`common/kb_sync.py:57-65`).
- `kb_search_gaps` table + `common/db/_kb_gaps.py` (`log_kb_gap`/`get_kb_gaps`) +
  endpoint **`GET /admin/kb/gaps`** (`bp_kb.py:79-90`) already capture "no answer" queries.
- **English-only**: model `all-MiniLM-L6-v2`, Rasa `language: en`, no lang column/detection anywhere.

**Plan — split into two tracks**

**1a. Robustness (small, low-risk — do first)**
- Harden the last hard-fail seams: wrap the vector index rebuild + itsm-sync so a
  failure degrades to keyword/JSON (most already guarded; audit `kb_sync.py:84-90`
  and the `_mem_load_and_process` path for any unguarded `.lower()`/index access).
- Add a one-line **health signal**: surface "KB backend = pgvector | memory | keyword-only"
  + article count in `/api/status` (reuse `_pgvector_available()`), so a silent
  fallback is visible instead of mysterious bad answers.
- **Surface kb_gaps in the admin UI**: a small "KB gaps" card/page in the admin KB
  section (web/ui/src/portal/admin) hitting the existing `/admin/kb/gaps` — top
  unanswered queries (last N days) so content authors know what to write. (Endpoint
  exists; this is frontend only.)
- Effort: **S–M**, ownable now, no new deps.

**1b. i18n (larger — needs a decision)**
- Swap the embedder to a **multilingual** model (e.g. `paraphrase-multilingual-MiniLM-L12-v2`)
  so KB semantic search works across languages — one-line model change + re-embed,
  but changes the vector dim/cache (rebuild required).
- Add a `lang` column to `kb_articles` + a `lang` slot/metadata on the chat turn
  (detect from the IAM locale or a simple language-detect lib), and filter/boost KB
  by language.
- Translate bot response strings (extract the hardcoded English in `actions_kb.py`
  into a message catalog keyed by lang).
- Effort: **M–L**. Decision needed: which languages, and detection source (browser/IAM vs auto-detect).

---

## 2. Smart assignment + SLA escalation

**What already exists (a lot)**
- **itsm-service has a full automation engine**: `AutomationRule`
  (`app/models/automation.py`) with triggers `ticket_created/updated/sla_breached/pending_approval`
  and actions incl. **`assign_team`, `assign_user`, `escalate`, `set_priority`**
  (`automation_service.py:420-477`). Fires on create/update + SLA breach.
- **SLA is built**: `SLAPolicy` + business-hours model, `sla_service.calculate_due_times`,
  and a Celery-beat task `check_sla_breaches` every 5 min (`tasks_sla.py`) that sets
  `sla_breached` and **already fires the `ticket_sla_breached` automation trigger**.
- **Handoff** has `handoff_routing_rules` (intent/keyword/app → team/skill/priority),
  operator `max_concurrent` + `get_operator_current_load()`, but **assignment is manual
  claim** (`operator_claim`).

**Plan**

**2a. SLA escalation (small — mostly wiring + a default policy)**
- The breach→escalate path is **already wired**; the gap is there's no default
  escalation. Add: a seeded/default `AutomationRule` (trigger `ticket_sla_breached`,
  action `escalate` → bump priority + reassign to team lead/manager + notify), plus a
  small admin UI to manage these rules if not present. Effort: **S–M**, low risk
  (built on existing engine).

**2b. Smart ticket assignment (itsm) — add the auto-assign logic**
- Implement a `_pick_assignee(team)` strategy in `automation_service` /
  `ticket_service`: **least-loaded** (count open tickets per agent on the team) or
  round-robin. Wire it as a new automation action `auto_assign` (or enhance
  `assign_team` to also pick a user). Trigger on `ticket_created` when a category/team
  default applies. Effort: **M**.

**2c. Smart handoff assignment (chat) — optional auto-claim**
- Add `auto_assign_handoff(queue_item)`: pick the least-loaded **online** operator
  matching `target_team`/`required_skill` (reuse `get_available_operators` +
  `get_operator_current_load` + `max_concurrent`), set assigned + emit. Make it
  opt-in via a config flag (keep manual claim as fallback). Effort: **M**.

Dependencies: none external. Risk: assignment logic touches live routing — ship
behind a flag + start with SLA escalation (lowest risk).

---

## 3. Approval workflows

**What already exists**
- Statuses `pending_approval/approved/rejected` + the **change-type transitions** are
  seeded (`ticket.py`, migration `0001`), and transition validation works
  (`ticket_service.py:183-191`). Ticket type `change` exists.
- The automation trigger `ticket_pending_approval` is **defined but never fired**.
- **Missing entirely**: any Approval model, approver assignment, approval endpoint,
  authz (today *any* agent can PATCH status→approved), and approval audit.

**Plan (itsm-service)**
1. **Model**: new `TicketApproval` (ticket_id, approver_id|approver_team_id, status
   pending/approved/rejected, decided_by, decided_at, comment) + Alembic migration.
2. **Request flow**: when a `change` ticket enters `pending_approval` (via update),
   create the approval record(s) (approver from category/automation), **fire the
   `ticket_pending_approval` automation trigger**, and notify the approver (the
   email/socket/webhook infra all exist — `tasks_notifications.py`).
3. **Decision endpoint**: `POST /tickets/{id}/approval` `{decision, comment}` —
   authz: only the assigned approver (or manager/admin) may decide; on approve/reject
   it drives the status transition (reusing the validated transition path) and audits
   who/why.
4. **Guard the PATCH**: block direct `status→approved/rejected` via the generic PATCH
   (force it through the approval endpoint) — mirrors the RBAC pattern already added
   to `update_ticket`.
5. Effort: **M**. Self-contained in itsm-service; tests via the existing async suite.

---

## 4. Error-alert inbox + integration marketplace

**What already exists**
- Error alerting end-to-end: `AdminAlertHandler` (dedup/cap) → `notify_admins` →
  `notifications` table → Socket.IO `admin_live`. `notifications` has full CRUD
  (`_notifications.py`) + REST (`bp_notifications.py`: list / read / read-all). The
  `system_error` type already flows in.
- itsm-service has **outbound webhook config** (`webhooks_outbound.py`: CRUD + test +
  delivery log + retry) and an **inbound IAM webhook** (HMAC-verified). Plus an
  admin `IntegrationPage` (today only the widget-embed generator).
- **Missing**: an admin **UI** to browse/filter the alert history; a unified
  integration **registry**.

**Plan — split**

**4a. Error-alert inbox (small — frontend over existing APIs, do first)**
- Persist `system_error` notifications to a stable admin user/inbox (today they
  fan-out to operators + `admin_live`; ensure they're also stored queryable).
- Build an admin **"Alerts" page** (`web/ui/src/portal/admin`, add a sidebar link)
  over the existing notifications API: list, filter by type (`system_error`, …) +
  time, mark-read/read-all, search. Wire the existing `new_notification` Socket.IO
  event to a live badge. Effort: **S–M**, mostly UI — backend largely exists.

**4b. Integration marketplace (larger)**
- Add an `integrations` registry (name, category, icon, config schema, events) and a
  `/admin/integrations` marketplace page (list/enable/configure/test). Back it with
  the existing itsm outbound-webhook config for event delivery; migrate the
  hardcoded Airbyte/Firecrawl connectors into registry entries over time. Effort: **L**.

---

## Suggested order (bang-for-buck)
1. **Error-alert inbox (4a)** — surfaces the alerting we already ship; mostly UI.
2. **KB robustness + gaps UI (1a)** — small, removes silent-fallback mystery.
3. **SLA escalation (2a)** — wire a default rule on the existing breach→escalate path.
4. **Approval workflows (3)** — self-contained itsm feature, real product value.
5. Then the larger tracks: smart assignment (2b/2c), i18n (1b), integration marketplace (4b).
