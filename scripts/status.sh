#!/bin/bash
# Project-IQ — Status Dashboard
# Run: bash status.sh
# DB password comes from the environment (PGPASSWORD or PIQ_DATABASE_DB_PASSWORD),
# never hardcoded. Set it before running, e.g. export PGPASSWORD=... (see docs/SECURITY_SECRETS.md).
export PGPASSWORD="${PGPASSWORD:-${PIQ_DATABASE_DB_PASSWORD:-}}"

# ── Colours ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✔${RESET}  $1"; }
fail() { echo -e "  ${RED}✘${RESET}  $1"; }
warn() { echo -e "  ${YELLOW}!${RESET}  $1"; }
hdr()  { echo -e "\n${BOLD}${CYAN}$1${RESET}"; echo -e "${DIM}$(printf '─%.0s' {1..55})${RESET}"; }

# ── Header ─────────────────────────────────────────────────────────────────
clear
echo -e "${BOLD}"
echo "  ██████╗ ██████╗  ██████╗      ██╗███████╗ ██████╗ "
echo "  ██╔══██╗██╔══██╗██╔═══██╗     ██║██╔════╝██╔═══██╗"
echo "  ██████╔╝██████╔╝██║   ██║     ██║█████╗  ██║   ██║"
echo "  ██╔═══╝ ██╔══██╗██║   ██║██   ██║██╔══╝  ██║▄▄ ██║"
echo "  ██║     ██║  ██║╚██████╔╝╚█████╔╝███████╗╚██████╔╝"
echo "  ╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚════╝ ╚══════╝ ╚══▀▀═╝ "
echo -e "${RESET}${DIM}  Status Dashboard — $(date '+%Y-%m-%d %H:%M:%S')${RESET}"

# ── Systemd Services ───────────────────────────────────────────────────────
hdr "SYSTEMD SERVICES"
for svc in project-iq-rasa project-iq-actions project-iq-admin; do
    state=$(systemctl is-active "$svc" 2>/dev/null)
    mem=$(systemctl status "$svc" 2>/dev/null | grep -oP 'Memory: \K[^\n]+' | head -1)
    uptime=$(systemctl status "$svc" 2>/dev/null | grep -oP 'Active:.*?;\K[^;]+(?= ago)' | head -1 | xargs)
    label=$(echo "$svc" | sed 's/project-iq-//')
    if [ "$state" = "active" ]; then
        ok "$(printf '%-10s' "$label")  ${GREEN}active${RESET}   mem: ${mem:-n/a}   up: ${uptime:-n/a}"
    else
        fail "$(printf '%-10s' "$label")  ${RED}$state${RESET}"
    fi
done

# ── Docker Containers ─────────────────────────────────────────────────────
hdr "DOCKER CONTAINERS"
while IFS= read -r line; do
    name=$(echo "$line" | awk '{print $1}')
    status=$(echo "$line" | cut -d$'\t' -f2)
    if echo "$status" | grep -qi "^Up"; then
        ok "$(printf '%-20s' "$name")  ${GREEN}${status}${RESET}"
    else
        fail "$(printf '%-20s' "$name")  ${RED}${status}${RESET}"
    fi
done < <(docker ps -a --format "{{.Names}}\t{{.Status}}" 2>/dev/null | grep -E 'glpi|firecrawl')

# ── Port Listeners ────────────────────────────────────────────────────────
hdr "OPEN PORTS"
declare -A PORT_LABELS
PORT_LABELS[5005]="Rasa Core"
PORT_LABELS[5055]="Rasa Actions"
PORT_LABELS[8181]="Admin API"
PORT_LABELS[5432]="PostgreSQL"
PORT_LABELS[8083]="GLPI"
PORT_LABELS[3002]="Firecrawl"

for port in 5005 5055 8181 5432 8083 3002; do
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
        ok "$(printf '%-6s' ":$port")  ${GREEN}listening${RESET}   ${PORT_LABELS[$port]}"
    else
        fail "$(printf '%-6s' ":$port")  ${RED}not listening${RESET}   ${PORT_LABELS[$port]}"
    fi
done

# ── App Health Checks ─────────────────────────────────────────────────────
hdr "APP HEALTH"

# Rasa
rasa_ver=$(curl -s --max-time 4 http://localhost:5005/version 2>/dev/null | grep -oP '"version":"\K[^"]+')
if [ -n "$rasa_ver" ]; then
    ok "Rasa            v${rasa_ver}"
else
    fail "Rasa            no response"
fi

# Admin API
admin_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://localhost:8181/ 2>/dev/null)
if [ "$admin_code" = "200" ] || [ "$admin_code" = "301" ] || [ "$admin_code" = "302" ]; then
    ok "Admin API       HTTP $admin_code"
else
    fail "Admin API       HTTP ${admin_code:-timeout}"
fi

# GLPI
glpi_title=$(curl -s --max-time 4 http://localhost:8083/ 2>/dev/null | grep -oP '<title>\K[^<]+')
if echo "$glpi_title" | grep -qi "Authentication\|GLPI"; then
    ok "GLPI            ${glpi_title}"
else
    fail "GLPI            no response (title: ${glpi_title:-none})"
fi

# PostgreSQL
db_count=$(psql -h 127.0.0.1 -U postgres -d Chatbot -t -c "SELECT COUNT(*) FROM conversations;" 2>/dev/null | xargs)
if [ -n "$db_count" ]; then
    ops=$(psql -h 127.0.0.1 -U postgres -d Chatbot -t \
      -c "SELECT COUNT(*) FROM operators;" 2>/dev/null | xargs)
    ok "PostgreSQL      ${db_count} conversations, ${ops} operators"
else
    fail "PostgreSQL      cannot connect"
fi

# ── System Resources ──────────────────────────────────────────────────────
hdr "SYSTEM RESOURCES"

# CPU
cpu_idle=$(top -bn1 | grep "Cpu(s)" | awk '{print $8}' | sed 's/%id,//' | xargs)
cpu_used=$(echo "100 - ${cpu_idle:-0}" | bc 2>/dev/null || echo "n/a")
echo -e "  CPU used:      ${BOLD}${cpu_used}%${RESET}"

# Memory
mem_info=$(free -h | grep Mem)
mem_total=$(echo "$mem_info" | awk '{print $2}')
mem_used=$(echo "$mem_info"  | awk '{print $3}')
mem_free=$(echo "$mem_info"  | awk '{print $4}')
mem_pct=$(free | grep Mem | awk '{printf "%.0f", $3/$2*100}')
if   [ "$mem_pct" -gt 90 ] 2>/dev/null; then col=$RED
elif [ "$mem_pct" -gt 75 ] 2>/dev/null; then col=$YELLOW
else col=$GREEN; fi
echo -e "  RAM:           ${BOLD}${mem_used} / ${mem_total}${RESET}  (${col}${mem_pct}% used${RESET}, ${mem_free} free)"

# Swap
swap_info=$(free -h | grep Swap)
swap_used=$(echo "$swap_info" | awk '{print $3}')
swap_total=$(echo "$swap_info" | awk '{print $2}')
echo -e "  Swap:          ${BOLD}${swap_used} / ${swap_total}${RESET}"

# Disk
echo ""
df -h 2>/dev/null | awk 'NR==1 || $NF=="/" || $NF=="/home"' | \
while IFS= read -r line; do
    pct=$(echo "$line" | grep -oP '\d+(?=%)' | tail -1)
    if   [ "${pct:-0}" -gt 90 ] 2>/dev/null; then col=$RED
    elif [ "${pct:-0}" -gt 75 ] 2>/dev/null; then col=$YELLOW
    else col=$GREEN; fi
    echo -e "  ${col}${line}${RESET}"
done

# Load average
load=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
cpus=$(nproc)
echo -e "\n  Load avg:      ${BOLD}${load}${RESET}  (${cpus} CPUs)"

# ── Recent Errors ─────────────────────────────────────────────────────────
hdr "RECENT ERRORS (last 5 per service)"
for svc in project-iq-rasa project-iq-actions project-iq-admin; do
    label=$(echo "$svc" | sed 's/project-iq-//')
    errors=$(journalctl -u "$svc" -p err -n 5 --no-pager --output=short 2>/dev/null | \
             grep -v "^--" | tail -5)
    if [ -n "$errors" ]; then
        echo -e "  ${YELLOW}${label}:${RESET}"
        echo "$errors" | while IFS= read -r line; do
            echo -e "    ${DIM}${line}${RESET}"
        done
    else
        ok "${label}: no recent errors"
    fi
done

# ── Rasa Model ────────────────────────────────────────────────────────────
hdr "RASA MODEL"
latest=$(ls -t /home/user/project-iq/core/models/*.tar.gz 2>/dev/null | head -1)
if [ -n "$latest" ]; then
    size=$(du -sh "$latest" | cut -f1)
    mtime=$(stat -c '%y' "$latest" | cut -d. -f1)
    ok "Latest: $(basename $latest)  (${size}, trained ${mtime})"
    count=$(ls /home/user/project-iq/core/models/*.tar.gz 2>/dev/null | wc -l)
    echo -e "  ${DIM}Total models on disk: ${count}${RESET}"
else
    fail "No trained model found — retrain needed"
fi

# ── Footer ─────────────────────────────────────────────────────────────────
echo -e "\n${DIM}$(printf '─%.0s' {1..55})${RESET}"
echo -e "${DIM}  Run 'sudo journalctl -u project-iq-admin -f' to tail logs${RESET}"
echo -e "${DIM}  Run 'htop' for interactive process monitor${RESET}\n"
