# Project-IQ — Production Operations Reference

**Server:** 198.233.100.77 (Ubuntu 22.04)
**SSH:** `ssh user@198.233.100.77` (password: `99tech6677`)
**Project root:** `/home/user/project-iq`

---

## Service Map

| Service | Type | Code / Data Path | Port |
|---------|------|-----------------|------|
| Rasa Core | systemd | `/home/user/project-iq/core/` | 5005 |
| Rasa Action Server | systemd | `/home/user/project-iq/action_server/` | 5055 |
| Admin API + Web UI | systemd | `/home/user/project-iq/admin/api/` | 8181 |
| PostgreSQL 14 | system | `/etc/postgresql/14/` | 5432 |
| GLPI 11 | Docker | container `glpi`, compose at `/home/user/docker-compose-glpi.yml` | 8083 |
| GLPI Database | Docker | container `glpi-db` (MySQL 8.0) | — internal only |
| Firecrawl | Docker | compose at `/home/user/docker-compose-firecrawl.yml` | 3002 |
| Python venv | — | `/home/user/project-iq/venv/` | — |

---

## Web Endpoints

| URL | What it is |
|-----|-----------|
| `http://198.233.100.77:8181/it.html` | Chat widget demo page |
| `http://198.233.100.77:8181/admin.html` | Admin panel |
| `http://198.233.100.77:8181/operator.html` | Operator live-chat console |
| `http://198.233.100.77:8083/` | GLPI web interface (login) |
| `http://198.233.100.77:8083/apirest.php` | GLPI REST API |
| `http://198.233.100.77:5005/webhooks/rest/webhook` | Rasa chat endpoint (internal) |
| `http://198.233.100.77:5005/version` | Rasa version check |

---

## 1. Systemd Services (Rasa + Admin)

### Check status
```bash
# One-liner: active / inactive / failed
systemctl is-active project-iq-rasa project-iq-actions project-iq-admin

# Detailed status (shows memory, PID, last log lines)
sudo systemctl status project-iq-rasa
sudo systemctl status project-iq-actions
sudo systemctl status project-iq-admin
```

### Start / Stop / Restart
```bash
# Individual
sudo systemctl start   project-iq-rasa
sudo systemctl stop    project-iq-rasa
sudo systemctl restart project-iq-rasa

sudo systemctl start   project-iq-actions
sudo systemctl stop    project-iq-actions
sudo systemctl restart project-iq-actions

sudo systemctl start   project-iq-admin
sudo systemctl stop    project-iq-admin
sudo systemctl restart project-iq-admin

# All three at once
sudo systemctl restart project-iq-rasa project-iq-actions project-iq-admin

# Full restart in correct order (Rasa first, then actions, then admin)
sudo systemctl restart project-iq-rasa && sleep 5 && \
  sudo systemctl restart project-iq-actions && \
  sudo systemctl restart project-iq-admin
```

### Live logs
```bash
# Follow a service in real time (Ctrl+C to stop)
sudo journalctl -u project-iq-rasa    -f
sudo journalctl -u project-iq-actions -f
sudo journalctl -u project-iq-admin   -f

# All three together (colour-coded by unit)
sudo journalctl -u project-iq-rasa -u project-iq-actions -u project-iq-admin -f

# Last N lines (no follow)
sudo journalctl -u project-iq-admin -n 100 --no-pager

# Since a specific time
sudo journalctl -u project-iq-admin --since "2026-04-15 10:00"

# Errors only
sudo journalctl -u project-iq-admin -p err --no-pager
```

### Systemd unit file locations
```bash
/etc/systemd/system/project-iq-rasa.service
/etc/systemd/system/project-iq-actions.service
/etc/systemd/system/project-iq-admin.service

# After editing a unit file:
sudo systemctl daemon-reload && sudo systemctl restart project-iq-admin
```

---

## 2. PostgreSQL

**Connection details (external / pgAdmin):**
- Host: `198.233.100.77` | Port: `5432`
- User: `postgres` | Password: `99tech6677` | Database: `Chatbot`

```bash
# Connect from server shell
PGPASSWORD=99tech6677 psql -h 127.0.0.1 -U postgres -d Chatbot

# Inside psql — useful commands
\dt                          -- list all tables
\d conversations             -- describe a table
\q                           -- quit

# Useful queries
SELECT COUNT(*) FROM conversations;
SELECT COUNT(*) FROM messages;
SELECT username, app_ids, team, last_seen FROM operators;
SELECT sender_id, handoff_state, created_at
  FROM conversations ORDER BY created_at DESC LIMIT 20;

# Service control
sudo systemctl status postgresql
sudo systemctl restart postgresql
sudo systemctl reload postgresql    -- reload pg_hba without full restart

# Active connections
PGPASSWORD=99tech6677 psql -h 127.0.0.1 -U postgres -d Chatbot \
  -c "SELECT count(*) FROM pg_stat_activity;"

# Backup
PGPASSWORD=99tech6677 pg_dump -h 127.0.0.1 -U postgres -F p \
  -f /home/user/backups/chatbot_$(date +%Y%m%d).sql Chatbot

# Restore
PGPASSWORD=99tech6677 psql -h 127.0.0.1 -U postgres -d Chatbot \
  -f /home/user/backups/chatbot_YYYYMMDD.sql
```

**Config files:**
```
/etc/postgresql/14/main/postgresql.conf   — listen_addresses, max_connections
/etc/postgresql/14/main/pg_hba.conf       — auth rules (who can connect)
```

---

## 3. Docker — GLPI

```bash
# Status
docker ps                                  -- running containers
docker ps -a                               -- all (including stopped)

# GLPI container
docker logs glpi --tail 50 -f             -- live GLPI logs
docker restart glpi
docker exec -it glpi bash                 -- shell inside GLPI container

# GLPI DB container (MySQL 8.0)
docker logs glpi-db --tail 30
docker exec -it glpi-db mysql -u glpi -pglpi_pw glpidb   -- MySQL shell

# Start / stop entire GLPI stack
cd /home/user
docker-compose -f docker-compose-glpi.yml up -d     -- start
docker-compose -f docker-compose-glpi.yml down      -- stop
docker-compose -f docker-compose-glpi.yml restart   -- restart both

# Backup GLPI database
docker exec glpi-db mysqldump --no-tablespaces -u root -pglpi_root_pw glpidb \
  > ~/glpi_backup_$(date +%Y%m%d).sql

# Restore GLPI database from backup
tail -n +3 ~/glpi_backup_YYYYMMDD.sql | \
  docker exec -i glpi-db mysql -u glpi -pglpi_pw glpidb

# GLPI key file (encryption) — inside container
docker exec glpi cat /var/www/html/glpi/config/glpicrypt.key
docker exec glpi cat /var/www/html/glpi/config/config_db.php
```

**Compose file:** `/home/user/docker-compose-glpi.yml`
**GLPI data volume:** `user_glpi-data` → `/var/www/html` inside container
**DB data volume:** `user_glpi-db-data` → `/var/lib/mysql` inside container

---

## 4. Docker — Firecrawl

```bash
# Start / stop
cd /home/user
docker-compose -f docker-compose-firecrawl.yml up -d
docker-compose -f docker-compose-firecrawl.yml down

# Logs
docker-compose -f docker-compose-firecrawl.yml logs --tail 50 -f

# Test
curl http://localhost:3002/v1/scrape -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

---

## 5. Resource Monitoring

```bash
# CPU + memory — interactive live view
htop

# Quick snapshot (top 10 processes by CPU)
ps aux --sort=-%cpu | head -12

# Memory
free -h

# Disk usage
df -h
du -sh /home/user/project-iq/core/models/   -- Rasa model sizes

# Per-service memory (from systemd)
sudo systemctl status project-iq-rasa        -- shows memory in status line
sudo systemctl status project-iq-admin

# Network ports listening
ss -tlnp

# Check all ports at once
ss -tlnp | grep -E '5005|5055|8181|5432|8083|3002'
```

---

## 6. Config Files

| File | Purpose |
|------|---------|
| `/home/user/project-iq/common/app.config.prod` | All prod settings: GLPI tokens, DB password, SMTP, JWT secret |
| `/home/user/project-iq/core/endpoints.yml` | Rasa tracker store DB URL + action server URL |
| `/home/user/project-iq/core/config.yml` | Rasa NLU/dialogue pipeline |
| `/etc/systemd/system/project-iq-*.service` | Systemd unit files |
| `/etc/postgresql/14/main/pg_hba.conf` | PostgreSQL auth rules |
| `/etc/postgresql/14/main/postgresql.conf` | PostgreSQL settings (listen_addresses etc.) |
| `/home/user/docker-compose-glpi.yml` | GLPI + MySQL 8.0 Docker stack |
| `/home/user/docker-compose-firecrawl.yml` | Firecrawl Docker stack |

**After editing a config:**
```bash
# app.config.prod or any app config → restart affected service
sudo systemctl restart project-iq-admin

# Systemd unit file changed → reload daemon first
sudo systemctl daemon-reload && sudo systemctl restart project-iq-admin

# PostgreSQL pg_hba.conf → reload (no restart needed)
sudo systemctl reload postgresql

# PostgreSQL postgresql.conf → full restart needed
sudo systemctl restart postgresql
```

---

## 7. Rasa Model

```bash
# Retrain (takes 5–15 min, run from core directory)
cd /home/user/project-iq/core
APP_PROFILE=prod ../venv/bin/rasa train

# List trained models
ls -lht /home/user/project-iq/core/models/

# After training — restart Rasa to load new model
sudo systemctl restart project-iq-rasa

# Quick Rasa health check
curl http://localhost:5005/version
```

---

## 8. Widget & Admin UI Rebuild

```bash
cd /home/user/project-iq/admin/ui

# Rebuild chat widget (ALWAYS use this — never NODE_ENV=development)
npm run build:widget

# Rebuild admin panel UI
npm run build

# No service restart needed — static files served directly from dist-widget/
```

---

## 9. Full System Restart (after server reboot)

All services are `WantedBy=multi-user.target` and auto-start on boot. To bring everything up manually:

```bash
# 1. PostgreSQL
sudo systemctl start postgresql

# 2. Docker stacks
cd /home/user
docker-compose -f docker-compose-glpi.yml up -d
docker-compose -f docker-compose-firecrawl.yml up -d

# 3. App services (in order)
sudo systemctl start project-iq-rasa
sleep 5
sudo systemctl start project-iq-actions
sudo systemctl start project-iq-admin

# Verify everything is up
systemctl is-active project-iq-rasa project-iq-actions project-iq-admin
docker ps
PGPASSWORD=99tech6677 psql -h 127.0.0.1 -U postgres -d Chatbot -c "SELECT 1;"
curl http://localhost:5005/version
```

---

## 10. Quick Health Check (one-shot)

Paste this entire block to get a full snapshot:

```bash
echo "=== Services ===" && \
systemctl is-active project-iq-rasa project-iq-actions project-iq-admin && \
echo "=== Docker ===" && \
docker ps --format "{{.Names}}\t{{.Status}}" && \
echo "=== Ports ===" && \
ss -tlnp | grep -E '5005|5055|8181|5432|8083|3002' && \
echo "=== Disk ===" && \
df -h / && \
echo "=== Memory ===" && \
free -h && \
echo "=== Rasa ===" && \
curl -s http://localhost:5005/version && \
echo "=== DB ===" && \
PGPASSWORD=99tech6677 psql -h 127.0.0.1 -U postgres -d Chatbot \
  -c "SELECT COUNT(*) as conversations FROM conversations;" 2>&1
```

---

## 11. Common Troubleshooting

| Symptom | What to check |
|---------|--------------|
| `http://198.233.100.77:8181` not loading | `systemctl is-active project-iq-admin` → if failed: `sudo journalctl -u project-iq-admin -n 50` |
| Chat returns no response | `curl http://localhost:5005/version` — if dead: `sudo journalctl -u project-iq-rasa -n 50` |
| Operator login fails | GLPI up? `curl -s http://localhost:8083/apirest.php \| head -5` — if setup page: re-run wizard |
| DB errors in admin log | `sudo systemctl status postgresql` — if stopped: `sudo systemctl start postgresql` |
| GLPI shows setup page | `docker exec glpi ls /var/www/html/glpi/config/config_db.php` — if missing: re-run setup wizard |
| Port blocked externally | Check provider firewall — open TCP port in security group |
| Rasa model not found | `ls /home/user/project-iq/core/models/` — if empty: `cd core && APP_PROFILE=prod ../venv/bin/rasa train` |
| High memory / OOM | `htop` — Rasa uses ~1–2 GB; if server has <4 GB RAM it may OOM |
