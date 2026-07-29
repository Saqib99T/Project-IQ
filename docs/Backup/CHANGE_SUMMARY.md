# Project IQ — Change Summary

A consolidated summary of platform changes, grouped by initiative. Covers both
repositories: **Project-IQ-V2** (bot, widget, mobile, operator/admin portal) and
**itsm-service** (FastAPI ITSM microservice).

Scale: ~62 commits in the main repo (≈14.8k insertions / 6.8k deletions across
142 files) and ~12 commits in itsm-service (which was first committed during this
period — 175 files). Most work is on branch `V3-improve`; the SLA/On-Call planning
is on `V4-sla`. Nothing deployed to production (local-first).

---

## 1. itsm-service stood up & integrated

The **FastAPI ITSM microservice** became a tracked repository and was wired into
the platform:

- Tickets, assets, knowledge base, products, webhooks, automation.
- IAM-JWT authentication with **row-level tenant isolation (RLS)**.
- Postgres + pgvector, Redis, Celery workers, MinIO storage.
- Alembic migration history; full test suite.

## 2. Smart routing, SLA, approvals & integrations (P3 batch)

- **Least-loaded ticket auto-assignment** (itsm-service) and **least-loaded
  operator auto-assignment** for chat handoff (portal).
- **Default SLA-breach escalation** worker (auto-escalates priority + notifies).
- **Ticket approval workflow** (pending_approval → approved/rejected).
- **Knowledge base:** health + knowledge-gaps card; **multilingual KB + bot
  localization** (multilingual embedder, retrieval intents).
- **Admin alert inbox.**
- **Integration marketplace:** backbone (Teams + outbound-webhook catalog) +
  portal UI.

## 3. Identity / IAM consolidation

- **Products entity** (itsm-service): IAM-synced **and** manual, with a guard that
  blocks deletion of IAM-sourced products; products admin UI + bot product picker
  now read the ITSM catalogue.
- **IAM lifecycle webhook** handles user events (deactivate / reactivate /
  role-sync) for immediate propagation to the ITSM user mirror.
- **Operators retired to an IAM-keyed projection:** removed the operator-JWT, the
  legacy `/opt/` console, and dead local-password code. Operators now derive
  entirely from the IAM token via `/portal/api`.
- **Role-mapping fix:** `operator`/`bot`/`admin` are Keycloak **client** roles, not
  realm roles — previously operators defaulted to `end_user` in itsm-service.
- **org_admin self-serve** integrations marketplace (was super_admin-only).
- Canonical IAM role model documented as a cross-repo contract.

## 4. Chat / session lifecycle & operator UX

- **Per-session history records:** each login and each "new conversation" is its
  own record. Fixed the server dropping the per-session epoch from `sender_id`,
  which had collapsed every session into one conversation (operators saw the
  user's entire history instead of the current session).
- **History lookups key off the stable IAM sub** (widget history and operator
  Interaction History were empty when matching by display name); button-only
  sessions are no longer dropped from history.
- **External-logout detection:** the widget and the mobile app now flip to
  logged-out when the IAM session ends elsewhere (was stuck showing logged-in).
- **Operator transcript** renders as a two-sided chat (customer left, bot +
  operator right).
- **Ticket workflow:** direct `open → resolved/closed` permitted; the status
  dropdown now offers only valid next-statuses (no more invalid-transition 409s).

## 5. Security & infrastructure hardening

- **Secrets removed from tracked config** → loaded from runtime environment
  (`PIQ_*`); committed SSH/DB credentials scrubbed; safe parametrized `deploy.sh`
  with dry-run, backup and rollback.
- **Server-side rate limiting** (per-IP, dependency-free).
- **Logging:** migrated `print()` to module loggers across the codebase, with a
  lint guard to block new `print()` calls.
- **CI:** Dependabot + weekly vulnerability audit.
- **Write RBAC** enforced on ticket mutations (itsm-service).
- Deflection analytics, a conversation **trace viewer**, and **canned
  responses / macros** for operators.
- Model/APK release tooling; large build artifacts and runtime caches removed
  from version control.

## 6. NLU improvements

- Pipeline tuning + retrieval intents; broader out-of-scope handling; story
  de-duplication and conflict cleanup; semantic embedding fallback on
  low-confidence; expanded chitchat/FAQ coverage.

## 7. SLA/SLO + On-Call/SRE (planning only)

- Authoritative PRD plus a phased **implementation plan**: current-state gap
  analysis, ER/migration/API breakdown, system-integration map, UI flows, and
  Phase A wireframes. **No code yet** — pending approval. Lives on `V4-sla`.

---

## Branch & deployment state

- Items 1–6 are on **`V3-improve`** (both repos).
- Item 7 is on **`V4-sla`** (branched from `V3-improve`).
- Nothing has been deployed to production; all work is verified locally.
