# Deployment Guide — Project IQ

## Production Server
- **IP:** 198.233.100.77 (Ubuntu)
- **User:** `user` — use **key-based SSH** (no passwords in this repo; see `docs/SECURITY_SECRETS.md`)
- **Project path:** `/home/user/project-iq`
- **itsm-service:** `/home/user/itsm-service` (docker-compose)
- **Services:** systemd (`project-iq-admin`, `rasa-core@<port>`) + the action server; itsm-service via docker-compose

> The server is **not** a git repo. It keeps its own hand-maintained
> `common/app.config` and secrets; deploys never overwrite them.

## Deploy with `scripts/deploy.sh`

Safe, parametrized, **dry-run by default**. It ships only git-tracked code
(never secrets, `app.config*`, models, caches, or build junk), backs up the
remote dir first, restarts services, health-checks, and **rolls back on
failure**.

```bash
# Preview exactly what would happen (no changes):
scripts/deploy.sh main
scripts/deploy.sh itsm
scripts/deploy.sh frontend         # build first: cd web/ui && npm run build

# Do it for real:
scripts/deploy.sh main --apply
scripts/deploy.sh all  --apply     # itsm + main
```

Components: `main` (rasa + actions + admin code), `itsm` (the microservice),
`frontend` (built `web/ui/dist*` + `public`), `all`.
Flags: `--apply` (off = dry run), `--no-restart`, `--no-rollback`, `-h`.

Override defaults via env, e.g.:
```bash
DEPLOY_HOST=198.233.100.77 DEPLOY_USER=user DEPLOY_SSH_KEY=~/.ssh/piq \
  MAIN_REMOTE_DIR=/home/user/project-iq scripts/deploy.sh main --apply
```

### Prerequisite — secrets must be on the server
Tracked config files no longer carry secrets. Before (or alongside) a deploy,
ensure the `PIQ_*` env vars are set on the server (systemd `Environment=` /
service env). See `docs/SECURITY_SECRETS.md` for the full list and the
rotation checklist.

## Manual restart / logs (if needed)
```bash
ssh user@198.233.100.77
sudo systemctl restart project-iq-admin
sudo systemctl restart 'rasa-core@*'
journalctl -u project-iq-admin -f --no-pager
# itsm-service:
cd /home/user/itsm-service && docker compose logs -f api
```

## Service Port Map

| Port | Service              | Health check                         |
|------|----------------------|--------------------------------------|
| 8181 | Admin API (Flask)    | `http://127.0.0.1:8181/api/status`   |
| 5005 | Rasa Core            | `http://127.0.0.1:5005/status`       |
| 5055 | Rasa Actions         | `http://127.0.0.1:5055/health`       |
| 8000 | itsm-service (FastAPI)| `http://127.0.0.1:8000/api/v1/health`|
| 5432 | PostgreSQL           | internal                             |

## What requires a restart

| Change                              | Restart                          |
|-------------------------------------|----------------------------------|
| `web/api/**`, `common/**`           | `project-iq-admin` (+ actions)   |
| `action_server/actions/**`          | the action server                |
| `core/domain.yml` / `nlu.yml` / stories | Rasa **retrain**, then restart core |
| `web/ui/**` (after `npm run build`) | none (static) — or restart admin |
| itsm-service `app/**`               | hot-reloads; else `docker compose up -d` |

## Mobile app (expo-app)
Not server-deployed. Build via EAS / the local build script:
```bash
cd expo-app && eas build --platform android --profile production
```

## Notes
- Cache files (`kb_embeddings_cache.json`, `web/data/cache/`) regenerate at
  runtime — never deploy them (the script already withholds them).
- Rasa model tarballs are not in git — see `docs/DEVELOPMENT.md`.
