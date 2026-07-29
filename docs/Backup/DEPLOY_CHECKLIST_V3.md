# V3-improve → production deploy checklist

> **Status: CHECKLIST ONLY (compiled 2026-06-24). No deployment performed.**
> This enumerates everything the `V3-improve` branch adds on top of the current
> prod baseline (`main`), with a local **verify** step for each item, so the
> actual cutover is mechanical. The *mechanism* (rsync, restart, rollback) lives
> in [DEPLOYMENT.md](../DEPLOYMENT.md) — this file is the *what*, not the *how*.
> Run the cutover only when the user explicitly asks (local-first policy).

Server: `198.233.100.77` (Ubuntu) — `/home/user/project-iq` + `/home/user/itsm-service`.
The box is **not** a git repo and keeps its own secrets; deploys never overwrite
its `app.config`.

---

## 0. Pre-flight (local, before any push)

- [ ] **On `V3-improve`, working tree clean.** `git status` clean; `git log main..V3-improve` is the full delta (≈ the feature set below).
- [ ] **Test suites green.**
  - Main repo: `pytest tests/` (Web API / Action Server / Common-IAM / NLU). Verify: previously 120 local.
  - itsm-service: full suite via its docker-compose.test path. Verify: previously 292 passing.
- [ ] **Frontends build clean** (see §4) — `npm run build:widget`, `build:portal`, `build:itsm`.
- [ ] **Secrets present on server** — every `PIQ_*` var + itsm `IAM_WEBHOOK_SECRET` set in the server env *before* deploy (see §5 and [SECURITY_SECRETS.md](SECURITY_SECRETS.md)).

---

## 1. itsm-service DB migrations  ⚠️ blocking

Prod baseline is behind by **three** migrations (head is now `0021`). These must
be applied **before/with** the itsm code, in order:

| Rev | What it adds | Why prod needs it |
|-----|--------------|-------------------|
| `0019_ticket_approvals` | approval-workflow tables | P3 approvals feature |
| `0020_webhook_format` | `format`/`integration_key` on webhook endpoints | integration marketplace (4b) + org_admin self-serve |
| `0021_product_source` | `Product.source` (`iam`\|`manual`) | products = IAM + manual (Q1) |

- [ ] **Verify head locally:** `migrations/versions/` ends at `0021_product_source`.
- [ ] **Apply on server:** `cd /home/user/itsm-service && docker compose exec api alembic upgrade head`
- [ ] **Confirm:** `docker compose exec api alembic current` → `0021`.
- [ ] **RLS note:** `0014/0015` (row-level security) are already in prod baseline — no action, just don't skip-version.

> Memory note: `0019` was previously applied to **DEV/TEST DB only**; prod has had
> none of `0019–0021`. Do not assume any are present — check `alembic current` first.

---

## 2. itsm-service code

New/changed this round (all under `app/`):
- IAM lifecycle **webhook receiver** `app/api/v1/webhooks.py` (+ `IAM_WEBHOOK_SECRET` config) — see §5 + the [IAM lifecycle runbook](IAM_LIFECYCLE_WEBHOOK.md).
- **Role mapping fix** `app/auth/dependencies.py` (client `Operator`→`agent`, `Bot`→`service_account`; case-insensitive; realm+client).
- **Products** `app/api/v1/admin.py` + `app/models/identity.py` (source column + CRUD, delete blocks `source='iam'`).
- Least-loaded **auto-assign** (2b) + SLA auto-escalation + webhooks-config (4b).

- [ ] **Verify present locally:** `app/api/v1/webhooks.py`, `app/api/v1/integrations.py`, `app/api/v1/webhooks_outbound.py` exist; `tests/test_role_mapping.py` + `tests/test_webhooks_iam.py` pass.
- [ ] **Deploy:** `scripts/deploy.sh itsm` (dry-run) → `--apply`. itsm hot-reloads `./app`; `docker compose up -d api` if not.
- [ ] **Health:** `curl 127.0.0.1:8000/api/v1/health`.

---

## 3. Main repo — bot / actions / admin (Flask)

Feature set on `V3-improve` (commits `main..V3-improve`):
- Chat session = one record per session/conversation (senderId epoch).
- Canned responses / operator co-pilot; deflection + trace-viewer analytics.
- Handoff: least-loaded operator auto-assign (2c), socket relay fix, storage proxy.
- **Operator console consolidation:** `bp_operator` + `/opt/` retired → IAM-only via `/portal/api`.
- Rate limiting (per-IP), logging migration (no `print()`), multilingual bot localization (1b).

- [ ] **Verify present locally:** `register.py` no longer imports `bp_operator`; `bp_static.py` `/opt` → 301 `/portal/`; `bp_portal_api.py` present.
- [ ] **Deploy:** `scripts/deploy.sh main` (dry-run) → `--apply`.
- [ ] **Restart:** `project-iq-admin` + action server (deploy.sh does this).
- [ ] **Health:** `curl 127.0.0.1:8181/api/status`, `:5055/health`.

---

## 4. Frontend bundles (rebuild → deploy)

Three separate Vite bundles; **rebuild all three** (this round touched widget,
portal, and itsm-app):

- [ ] `cd web/ui && npm run build:widget` → `public/widget*`
- [ ] `npm run build:portal` → `public/portal/` (✅ rebuilt 2026-06-24 — incl. org_admin integrations marketplace)
- [ ] `npm run build:itsm` → `public/itsm*`
- [ ] **Deploy:** `scripts/deploy.sh frontend --apply` (ships built `public/` — static, no restart needed; restart admin only if it caches).
- [ ] **Smoke (post-deploy):** portal loads; an **org_admin** sees **Integrations** in the sidebar and can list/create their own webhook endpoint; widget loads + connects socket.

---

## 5. Environment / secrets (must precede deploy)

- [ ] **`IAM_WEBHOOK_SECRET`** (itsm-service) — **NEW** this round. Generate a strong value, set in itsm-service env; configure the *same* secret on the Keycloak event side (see [IAM_LIFECYCLE_WEBHOOK.md](IAM_LIFECYCLE_WEBHOOK.md)). Without it the lifecycle receiver returns 401.
- [ ] **`PIQ_*` secrets** present (`systemctl show project-iq-admin -p Environment`). Tracked config is blank — missing vars break IAM/DB/operator.
- [ ] **Rotation** of the historically-exposed secrets is a *separate*, outstanding task — see [SECURITY_SECRETS.md](SECURITY_SECRETS.md). Not a deploy blocker, but schedule it.

---

## 6. Rasa NLU/Core model

This round retrained NLU (tiers 1–4, round 2, story-conflict fixes, multilingual
embedder `paraphrase-multilingual-MiniLM-L12-v2`).

- [ ] **Model is not in git.** Publish the trained tarball to the private-repo
      Release (`scripts/publish_release.sh`) and fetch on the server via
      `get_model.py` (needs `gh`) — see [DEVELOPMENT.md](DEVELOPMENT.md).
- [ ] **Verify locally:** a fresh `core/models/*.tar.gz` exists from the latest train.
- [ ] **Restart** `rasa-core@*` after the model lands.

---

## 7. Multilingual KB re-embed (itsm-side)

1b switched the KB embedder to the multilingual model.

- [ ] **KB lives in the itsm-service DB**, not the Chatbot DB — re-embed is an
      itsm/KB-side op (do **not** touch Chatbot `kb_articles`, it's a stale mirror).
- [ ] Run the itsm-service KB re-embed/backfill so existing articles get
      multilingual vectors (same 384-dim space — no schema change).

---

## 8. Post-deploy verification

- [ ] All five health endpoints green (§DEPLOYMENT.md port map).
- [ ] **org_admin** integrations self-serve works end-to-end (create + receive a test webhook).
- [ ] Chat: login starts a fresh session record; handoff routes to an operator; canned responses load.
- [ ] itsm: create a ticket → auto-assigns to least-loaded agent; products list shows IAM + manual entries.
- [ ] IAM lifecycle: send a signed test `user.deactivated` to `/webhooks/iam` → user marked inactive (after §IAM runbook is configured).
- [ ] **Rollback ready:** deploy.sh backed up the remote dir; `--no-rollback` was NOT used.

---

## Out of scope (explicitly NOT in this cutover)
- **GLPI decommission** — on hold (load-bearing); see `GLPI_DECOMMISSION_PLAN.md`.
- **Inbound channels** (Slack/Teams/WhatsApp) — deferred.
- **Live secret rotation** — separate maintenance window.
- **Mobile app** — not server-deployed; ship via EAS separately.
