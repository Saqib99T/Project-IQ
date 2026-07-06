# Project-IQ — Production Deployment Runbook

**Complete, service-by-service process with exact commands.** Verified against
the live prod host on **2026-07-05**. Supersedes the delta-only
[DEPLOY_V4_SLA_ONCALL.md](DEPLOY_V4_SLA_ONCALL.md) for full cutovers.

> **Golden rules:** back up first · migrations run as the DB **owner** · prod
> uses **`docker-compose` v1** (hyphen), not `docker compose` · deploy is
> **rsync/tar** (prod is not a git checkout) · deploy **only when explicitly
> asked** (local-first).

---

## 0. Prod facts (verified)

| Thing | Value |
|---|---|
| Host | `192.168.71.66` (internal) == `198.233.100.77` (public), same box (`projectiq`) |
| Access | **VPN-only** (OpenVPN). Public IP is firewalled; SSH as `user@192.168.71.66` |
| Deploy user | `user` (has `sudo` for systemctl) |
| itsm-service | `~/itsm-service`, **docker-compose v1** (1.29.2), containers `itsm-service_<svc>_1` |
| project-iq (chatbot/admin/rasa/actions) | `~/project-iq`, run as **systemd services** |
| Databases | **both** `itsm_db` and `Chatbot` live in container **`itsm-service_db_1`** (pgvector pg16, superuser `itsm_user`) |
| Deploy tool | `scripts/deploy.sh` (rsync/tar, backs up remote, excludes secrets) |
| Backups dir | `~/backups` (DB dumps) · `~/piq-deploy-backups` (deploy tarballs) |

### Service inventory & how each runs

| Service | Runs as | Restart command (on prod) | Serves |
|---|---|---|---|
| itsm API | `itsm-service_api_1` (compose) — **bind-mounts `./app`, `--reload`** | `docker-compose restart api` | `:8000` REST API |
| itsm worker | `itsm-service_worker_1` (compose) — **baked image** | `docker-compose up -d --build worker` | Celery tasks |
| itsm worker-beat | `itsm-service_worker-beat_1` (compose) — **baked image** | `docker-compose up -d --build worker-beat` | Celery beat schedule |
| itsm db / redis / minio | compose | `docker-compose up -d` | Postgres / cache / object store |
| Admin API + itsm/portal/widget UI | `project-iq-admin.service` (systemd, Flask :8181) | `sudo systemctl restart project-iq-admin` | serves `web/ui/public/*` bundles + `/itsm-api` proxy |
| Rasa Core (bot NLU) | `project-iq-rasa.service` | `sudo systemctl restart project-iq-rasa` | bot inference |
| Action Server | `project-iq-actions.service` | `sudo systemctl restart project-iq-actions` | bot custom actions |

> **api hot-reloads** its bind-mounted `./app`, so shipping code + `restart api`
> is enough. **worker/worker-beat are baked** — new task files (e.g.
> `tasks_slo.py`) require **`--build`**.

---

## 1. Prerequisites (local machine)

```bash
# 1. Connect the OpenVPN tunnel, then confirm prod is reachable:
ping -c 2 192.168.71.66          # 0% loss
ssh user@192.168.71.66 'hostname'   # -> projectiq

# 2. Be on the release branch in BOTH repos, everything committed:
cd /d/99T/Code/Project-IQ-V2 && git branch --show-current   # V3-improve
cd /d/99T/Code/itsm-service   && git branch --show-current   # V3-improve

# 3. deploy.sh must target the INTERNAL IP (public is firewalled):
export DEPLOY_HOST=192.168.71.66
```

Everything below runs from `d:/99T/Code/Project-IQ-V2` unless noted.
Define a shell alias for prod:

```bash
export MSYS_NO_PATHCONV=1     # (Git Bash on Windows) stop path mangling in ssh
SSH="ssh user@192.168.71.66"
```

---

## 2. Pre-flight — BACK UP FIRST (never skip)

```bash
STAMP=$(date +%Y%m%d_%H%M)

# 2a. itsm_db (custom format, compressed) — as owner itsm_user
$SSH "docker exec itsm-service_db_1 pg_dump -U itsm_user -Fc -d itsm_db \
      > ~/backups/itsm_db_predeploy_${STAMP}.dump"

# 2b. Chatbot (same container)
$SSH "docker exec itsm-service_db_1 pg_dump -U itsm_user -Fc -d Chatbot \
      > ~/backups/Chatbot_predeploy_${STAMP}.dump"

# 2c. cluster roles
$SSH "docker exec itsm-service_db_1 pg_dumpall -U itsm_user --globals-only \
      > ~/backups/globals_predeploy_${STAMP}.sql"

# 2d. verify dumps are readable + record starting versions
$SSH "ls -la ~/backups/*_predeploy_${STAMP}.* ; \
      docker exec -i itsm-service_db_1 pg_restore -l < ~/backups/itsm_db_predeploy_${STAMP}.dump | grep -c TABLE"
$SSH "cd ~/itsm-service && docker-compose exec -T api alembic current"   # expect 0018_user_iam_roles_sync (head)
```

> **Prod is currently at `0018`.** This cutover applies **15 migrations,
> `0019 → 0033`** (P3 batch 0019–0022 + SLA/On-Call/Incident 0023–0031 + RLS
> guard 0032 + SLO 0033). All additive/non-destructive.

---

## 3. Deploy itsm-service (backend)

```bash
# 3a. SHIP code (rsync/tar with remote backup; NO auto-restart — we drive it).
#     Ships git-tracked files from the working tree; withholds .env/app.config/override.
DEPLOY_HOST=192.168.71.66 scripts/deploy.sh itsm --apply --no-restart

# 3b. REBUILD worker+beat (baked images; new task modules) and (re)create the stack.
#     api bind-mounts ./app so it just needs a restart; --build is harmless for it.
$SSH "cd ~/itsm-service && docker-compose build worker worker-beat && docker-compose up -d"
$SSH "cd ~/itsm-service && docker-compose restart api"

# 3c. RUN MIGRATIONS as the owner itsm_user (app role itsm_app lacks DDL rights).
$SSH "cd ~/itsm-service && PW=\$(docker exec itsm-service_db_1 printenv POSTGRES_PASSWORD) && \
      docker-compose exec -T -e DATABASE_URL=\"postgresql+asyncpg://itsm_user:\${PW}@db:5432/itsm_db\" \
      api alembic upgrade head"

# 3d. CONFIRM head + worker tasks
$SSH "cd ~/itsm-service && docker-compose exec -T api alembic current"          # -> 0033_slo (head)
$SSH "cd ~/itsm-service && docker-compose exec -T worker python -c \
     \"from app.workers.celery_app import celery_app; import app.workers.tasks_slo; \
       print('slo beat:', [k for k in celery_app.conf.beat_schedule if 'slo' in k])\""
```

---

## 4. Deploy frontends (itsm-app + portal + widget)

The **admin service** serves the built bundles from `web/ui/public/`. Build
locally, ship, restart admin. (Phase 9 changed **itsm** only; build portal/widget
too if their source changed.)

```bash
# 4a. BUILD locally
cd web/ui
npm ci            # if deps changed; else skip
npm run build:itsm
npm run build:portal      # only if portal changed
npm run build:widget      # only if widget changed
cd ../..

# 4b. SHIP built assets + restart admin (deploy.sh handles backup + health-check + rollback)
DEPLOY_HOST=192.168.71.66 scripts/deploy.sh frontend --apply
#   (frontend restart = `sudo systemctl restart project-iq-admin`)
```

---

## 5. Deploy project-iq backend (chatbot / rasa / actions) — only if changed

Skip if the release is itsm-only. If `common/`, `action_server/`, or bot config
changed:

```bash
# 5a. SHIP the main repo (backend python + configs), withholding server-owned secrets
DEPLOY_HOST=192.168.71.66 scripts/deploy.sh main --apply
#   (main restart = admin + rasa-core; run actions restart explicitly if needed)
$SSH "sudo systemctl restart project-iq-actions"
```

> A model retrain/APK is a separate flow — see the model-release process; not part
> of a code cutover.

---

## 6. (Optional) Demo data — Acme tenant ONLY

**Prod-safe rule:** never inject dummy data into real customer tenants. Only the
self-contained **`Acme Corp`** demo org is portable (it creates its own tenant
with deterministic IDs). The Blue/PIQ enrichment + Chatbot demo rows hard-code
**local** IDs and must **not** run on prod.

```bash
# Generate Acme-only SQL locally, copy up, apply as owner (RLS bypassed for owner).
cd /d/99T/Code/Project-IQ-V2
PYTHONUTF8=1 python scripts/seed/gen_itsm_seed.py  acme > /tmp/seed_acme_p1.sql
PYTHONUTF8=1 python scripts/seed/gen_itsm_seed2.py acme > /tmp/seed_acme_p2.sql
scp /tmp/seed_acme_p1.sql /tmp/seed_acme_p2.sql user@192.168.71.66:/tmp/
$SSH "docker exec -i itsm-service_db_1 psql -U itsm_user -d itsm_db -v ON_ERROR_STOP=1 < /tmp/seed_acme_p1.sql"
$SSH "docker exec -i itsm-service_db_1 psql -U itsm_user -d itsm_db -v ON_ERROR_STOP=1 < /tmp/seed_acme_p2.sql"
```

> The generators accept a comma-separated tenant-slug filter as `argv[1]`
> (`acme`); with no arg they emit all three (local only). Idempotent
> (`ON CONFLICT DO NOTHING`).

---

## 7. Verification (run after every cutover)

```bash
# itsm API up + migration head
$SSH "curl -s http://127.0.0.1:8000/api/v1/health"                       # {"status":"ok",...}
$SSH "cd ~/itsm-service && docker-compose exec -T api alembic current"    # 0033_slo (head)

# new routes live (401 = up + auth-gated, NOT 404)
$SSH "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/api/v1/slo/objectives"      # 401
$SSH "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/api/v1/on-call/schedules"   # 401

# workers healthy + SLO beat registered
$SSH "cd ~/itsm-service && docker-compose ps | grep -E 'worker|beat'"
$SSH "cd ~/itsm-service && docker-compose logs --tail=20 worker-beat | grep -iE 'slo|beat'"

# admin + bundles
$SSH "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8181/api/status"      # 200
$SSH "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8181/itsm/itsm.html"  # 200
$SSH "systemctl is-active project-iq-admin project-iq-rasa project-iq-actions"

# smoke (as a manager token): open SLA/On-Call/Reliability admin, declare an
# incident from an alert, confirm the Reliability error-budget board renders.
```

---

## 8. Rollback (per service)

| What broke | Rollback |
|---|---|
| **itsm code** | `scripts/deploy.sh` saved a tarball in `~/piq-deploy-backups`; extract it back over `~/itsm-service` and `docker-compose up -d --build`. |
| **frontend** | same — restore the `frontend-<stamp>.tgz` and `sudo systemctl restart project-iq-admin`. |
| **DB migrations** | additive/non-destructive, so leaving them is safe. To step back: `docker-compose exec -T -e DATABASE_URL="...itsm_user..." api alembic downgrade 0018_user_iam_roles_sync`. Worst case, restore the pre-deploy dump: `docker exec -i itsm-service_db_1 pg_restore -U itsm_user -d itsm_db --clean --if-exists < ~/backups/itsm_db_predeploy_<stamp>.dump`. |
| **workers** | revert `celery_app.conf.imports`/beat and `docker-compose up -d --build worker worker-beat` (but the registration is a strict improvement). |
| **demo seed** | delete Acme: `DELETE FROM tenants WHERE slug='acme-corp';` (cascades to all Acme rows). |

---

## 9. Gotchas (learned the hard way)

- **`docker compose` v2 is NOT installed on prod** — always `docker-compose` (v1). deploy.sh's default restart uses v2, so we pass `--no-restart` and restart manually (§3b).
- **Migrations as `itsm_app` fail** with `permission denied for schema public` — must be `itsm_user` (§3c).
- **worker has no bind-mount** — new task files need `--build`, not just `restart`.
- **`docker-compose.override.yml` is server-owned** (adds `restart: unless-stopped`); deploy.sh withholds it — do not overwrite.
- **No new secrets** for the SLA/On-Call/SLO delta.
- **Public IP is firewalled** — `DEPLOY_HOST=192.168.71.66` (VPN) for every deploy.sh call.
- **Windows Git Bash** mangles remote paths — `export MSYS_NO_PATHCONV=1` before ssh with absolute remote paths.
