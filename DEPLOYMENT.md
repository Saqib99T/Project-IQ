# Deployment Guide — Project IQ

## Production Server
- **IP:** 192.168.71.66
- **User:** user
- **Project path:** /home/user/project-iq
- **Services:** managed by systemd

## Quick Deploy (use deploy_prod.py)

```
D:\99T\Rasa\Project-IQ\venv\Scripts\python.exe deploy_prod.py
```

The script:
1. SFTPs all changed files to the server
2. Restarts `project-iq-admin` and `project-iq-actions` via systemctl
3. Runs a health check on all three ports (8181, 5005, 5055)

## Manual Deploy Steps

### 1. Add files to UPLOAD_FILES in deploy_prod.py
Edit `deploy_prod.py` and add any newly changed files to the `UPLOAD_FILES` list.

### 2. Run the deploy script
```
D:\99T\Rasa\Project-IQ\venv\Scripts\python.exe deploy_prod.py
```

### 3. If services don't restart cleanly — SSH manually
```bash
ssh user@192.168.71.66
# password: 99tech6677

sudo systemctl restart project-iq-admin
sudo systemctl restart project-iq-actions
sudo systemctl status project-iq-admin project-iq-actions
```

### 4. Check logs on server
```bash
journalctl -u project-iq-admin -f --no-pager
journalctl -u project-iq-actions -f --no-pager
```

## Service Port Map

| Port  | Service            | Check                            |
|-------|--------------------|----------------------------------|
| 8181  | Admin API          | http://SERVER:8181/              |
| 5005  | ML Platform Core   | http://SERVER:5005/version       |
| 5055  | ML Platform Actions| http://SERVER:5055/webhook       |
| 3002  | Firecrawl          | http://SERVER:3002/is-production |
| 5432  | PostgreSQL         | internal                         |
| 8083  | ITSM (GLPI)        | http://SERVER:8083/              |

## What Requires a Restart

| Change type                         | Restart needed          |
|-------------------------------------|-------------------------|
| admin/api/admin_api.py              | project-iq-admin        |
| admin/ui/public/js/*.js             | None (static files)     |
| admin/ui/public/components/*.html   | None (static files)     |
| common/*.py                         | project-iq-admin + actions |
| action_server/actions/*.py          | project-iq-actions      |
| core/domain.yml / nlu.yml / stories | Rasa retrain needed     |

## What Does NOT Need a Restart
- Static UI files (JS, HTML, CSS) — served directly, live immediately
- Config changes in app.config (if not cached at startup)

## Firecrawl Docker (if crash-looping)
```bash
ssh user@192.168.71.66
docker ps | grep firecrawl          # check status
docker logs firecrawl-api --tail 20 # check errors

# If NUQ error — run from project dir:
docker compose -f docker-compose-firecrawl.yml up -d --force-recreate firecrawl-api firecrawl-worker
```

## Mobile App (expo-app)
Mobile changes are NOT deployed to the server. Build via EAS:
```bash
cd expo-app
eas build --platform android --profile production
```

## Notes
- The server is NOT a git repo — deploy via SFTP (deploy_prod.py), not git pull
- paramiko must be installed in D:\99T\Rasa\Project-IQ\venv (not the Code venv)
- Sensitive files (app.config.local, credentials.yml) are already on server with prod values — do NOT overwrite them
- Cache files (kb_embeddings.pkl, kb_embeddings_cache.json) regenerate automatically — do NOT deploy them
