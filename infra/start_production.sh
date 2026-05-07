#!/bin/bash
# Start all Project IQ services on Ubuntu production server.
# Run as the 'user' account: bash infra/start_production.sh
#
# Services started:
#   1. Redis (caching + Socket.IO bus)
#   2. PostgreSQL (already managed by systemd, just verified)
#   3. Rasa Action Server (port 5055)
#   4. Rasa Core         (port 5005)
#   5. Admin API         (port 8181, via Gunicorn)
#   6. Nginx             (port 80, reverse proxy)

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$PROJECT_DIR/venv/bin"
LOG_DIR="$PROJECT_DIR/Log"
mkdir -p "$LOG_DIR"

echo "=== Project IQ Production Start ==="
echo "Project dir: $PROJECT_DIR"
echo ""

# ── 1. Redis ──────────────────────────────────────────────────────────────────
echo "[1/6] Starting Redis..."
sudo systemctl start redis-server 2>/dev/null || true
sleep 1
redis-cli ping &>/dev/null && echo "      Redis: OK" || echo "      Redis: NOT available (caching disabled)"

# ── 2. PostgreSQL ─────────────────────────────────────────────────────────────
echo "[2/6] Checking PostgreSQL..."
pg_isready -q && echo "      PostgreSQL: OK" || { echo "      PostgreSQL: NOT ready — aborting"; exit 1; }

# ── 3. Rasa Action Server ─────────────────────────────────────────────────────
echo "[3/6] Starting Rasa Action Server (port 5055)..."
cd "$PROJECT_DIR/action_server"
nohup "$VENV/rasa" run actions \
    > "$LOG_DIR/actions.log" 2>&1 &
echo $! > "$LOG_DIR/actions.pid"
echo "      PID: $(cat $LOG_DIR/actions.pid)"
sleep 3

# ── 4. Rasa Core ──────────────────────────────────────────────────────────────
echo "[4/6] Starting Rasa Core (port 5005)..."
cd "$PROJECT_DIR/core"
nohup "$VENV/rasa" run --enable-api --cors "*" \
    > "$LOG_DIR/rasa.log" 2>&1 &
echo $! > "$LOG_DIR/rasa.pid"
echo "      PID: $(cat $LOG_DIR/rasa.pid)"
sleep 5

# ── 5. Admin API (Gunicorn) ───────────────────────────────────────────────────
echo "[5/6] Starting Admin API via Gunicorn (port 8181)..."
cd "$PROJECT_DIR"
APP_PROFILE=production \
nohup "$VENV/gunicorn" \
    -c infra/gunicorn.conf.py \
    web.api.admin_api:app \
    > "$LOG_DIR/admin.log" 2>&1 &
echo $! > "$LOG_DIR/admin.pid"
echo "      PID: $(cat $LOG_DIR/admin.pid)"
sleep 3

# ── 6. Nginx ──────────────────────────────────────────────────────────────────
echo "[6/6] Reloading Nginx..."
sudo nginx -t && sudo systemctl reload nginx && echo "      Nginx: OK" || echo "      Nginx: check config"

echo ""
echo "=== All services started ==="
echo "  Admin dashboard: http://$(hostname -I | awk '{print $1}')/admin"
echo "  IT chat widget:  http://$(hostname -I | awk '{print $1}')/"
echo "  Operator panel:  http://$(hostname -I | awk '{print $1}')/operator"
echo ""
echo "Logs: $LOG_DIR/"
echo "  tail -f $LOG_DIR/admin.log"
