# Deploy runbook — SLA/SLO + On-Call/Incident (V4-sla → V3-improve)

**Purpose:** the exact, proven cutover steps for the SLA (Phase 7) + On-Call/
Incident (Phase 8) work. Extends [DEPLOY_CHECKLIST_V3.md](DEPLOY_CHECKLIST_V3.md);
mechanism (rsync/restart/rollback) is [../DEPLOYMENT.md](../DEPLOYMENT.md).

**Status:** ✅ **merged + deployed LOCALLY** (2026-07-02). `V4-sla` fast-forward-
merged into `V3-improve` in both repos; full local stack verified. **NOT deployed
to prod** — this doc is the prod cutover plan. Deploy to prod only when asked.

---

## 0. What this delta contains

- **itsm-service** — 9 new migrations **0023 → 0031** and their code
  (SLA/OLA/UC + runtime + reporting/AI; on-call + alerts/escalation + incidents +
  status page/workflows + SRE analytics). All additive; the legacy
  `sla_policies` + `check_sla_breaches` worker are kept.
- **Project-IQ-V2 (frontend)** — SLA admin + ticket SLA panel, On-Call admin
  section, Incidents/Alerts console. Bundles: **`itsm` + `portal`** (widget
  unaffected).
- **New Celery beat tasks (5)** — `sla-instance-scan`, `sla-metrics-daily`,
  `sla-breach-predict`, `alert-escalation-advance`, `heartbeat-watchdog`.
- **Celery task-registration fix** — `celery_app.conf.imports` now lists all 10
  task modules (a bare app previously registered **0** tasks). Worker/beat must
  be restarted for this + the new schedule to take effect.
- **New public unauthenticated route** — `GET /api/v1/status/{slug}` (+ `/subscribe`).
  Only serves a page when a tenant publishes one; safe to expose.
- **RLS** on every new tenant table (fail-open, same predicate as migration 0014).

### Secrets / env — NONE new for this delta
SLA/on-call add **no new secrets**. SMS/voice paging is abstracted (a `Page` row
records the attempt; no provider/Twilio key needed for MVP). `IAM_WEBHOOK_SECRET`
was introduced earlier (see SECURITY_SECRETS.md) and is unrelated to this delta.

---

## 1. ⚠️ The one gotcha — migrations run as the DB **owner**, not the app role

The itsm-service compose runs the app as `itsm_app` (USAGE only). DDL
(`CREATE TABLE`, RLS, sequences) requires the owner **`itsm_user`**. Running
`alembic upgrade head` as the app role fails with **`permission denied for
schema public`**. Always override `DATABASE_URL` to the owner:

```bash
PW=$(docker exec itsm-service-db-1 printenv POSTGRES_PASSWORD)   # or the prod owner pw
docker compose exec -T -e DATABASE_URL="postgresql+asyncpg://itsm_user:${PW}@db:5432/itsm_db" \
  api alembic upgrade head
```

Migrations included (in order): `0023_slm_foundation`, `0024_sla_instances`,
`0025_sla_metrics_daily`, `0026_ai_sla_predictions`, `0027_oncall_schedules`,
`0028_alerting`, `0029_incidents`, `0030_ops`, `0031_retro`. `0029` also creates
`incident_number_seq` and seeds `incident_status_transitions` (14 rows). `0023`
data-migrates existing `sla_policies` → agreements + business hours → a Default
coverage window (non-destructive).

---

## 2. Prod cutover — step by step (proven locally)

1. **Pre-flight** — CI green (`itsm-service` 359 tests); `alembic current` on prod
   is `0022` (pre-delta); back up the prod DB.
2. **Ship itsm-service code** — `scripts/deploy.sh itsm` (dry-run) → `--apply`.
3. **Run migrations as owner** — the §1 command on the prod DB. Confirm
   `alembic current` → `0031_retro (head)`.
4. **Restart itsm workers** — `docker compose restart worker worker-beat`
   (picks up `conf.imports` + the 5 new beat entries). *(api hot-reloads; in prod
   restart it too.)*
5. **Build + ship frontends** — `cd web/ui && npm run build:itsm && npm run build:portal`,
   then `scripts/deploy.sh frontend --apply`.
6. **Restart admin** — `systemctl restart project-iq-admin` (serves the new
   bundles; the `/itsm-api` proxy needs no code change).
7. **(Optional) public status page** — if exposing `GET /status/{slug}` publicly,
   allow it at the reverse proxy/firewall. Otherwise no action.

## 3. Verification (what I checked locally — repeat on prod)

- `curl .../api/v1/health` → `{"status":"ok"}`.
- `alembic current` → `0031_retro (head)`.
- Worker registers **20** tasks incl. all 5 new beat tasks:
  ```bash
  docker compose exec -T api python -c "from app.workers.celery_app import celery_app; \
    celery_app.loader.import_default_modules(); \
    print(len([t for t in celery_app.tasks if t.startswith('app.workers')]))"   # 20
  ```
- Admin `:8181/api/status` → 200; `/itsm/itsm.html` → 200 (Incidents chunk present).
- itsm proxy: `GET /itsm-api/on-call/schedules` → **401** (route live, auth required).
- Smoke as a manager token: create an SLA agreement, declare an incident from an
  alert, confirm a page row + timeline event.

## 4. Rollback

- **Code:** `scripts/deploy.sh` backs up the remote dir; re-point / redeploy the
  previous revision. Branch: `V3-improve` FF-merged `V4-sla` (commit `4501405`
  main / `c553b93` itsm) — reset to the pre-merge commit if needed.
- **DB:** migrations have `downgrade()`; step back with
  `alembic downgrade 0022_open_direct_resolve` (as `itsm_user`). Additive +
  non-destructive, so leaving them in place is also safe (unused tables).
- **Workers:** revert `conf.imports`/beat and restart — but note the fix is a
  strict improvement (tasks were not registering before).

## 5. Out of scope for this cutover
- **Phase 9 (SLO/error-budget)** — not built.
- **AI upgrades** — LLM PIR/summary drafts + pgvector similar-incident search are
  templated/heuristic stand-ins today (no provider dependency).
- **Prod deploy itself** — do not run until explicitly asked (local-first).
