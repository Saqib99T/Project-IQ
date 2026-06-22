#!/usr/bin/env bash
#
# Project IQ — safe, parametrized deploy.
#
# Replaces the old scripts/deploy_fixes.py (hardcoded stale IP, static file list,
# no backup/health-check/rollback). Runs from a dev box (Git Bash on Windows or
# any POSIX shell) and pushes code to the server over SSH.
#
# What it does, per component:
#   1. Package the component's code into a tarball, EXCLUDING secrets, server-only
#      config, build artifacts, models, venvs and node_modules (see EXCLUDES).
#   2. scp the tarball to the server.
#   3. Back up the current remote dir to a timestamped tarball (for rollback).
#   4. Extract the new code OVER the remote dir (overlay — never --delete, so the
#      server's own app.config/.env/models/venv are preserved).
#   5. Restart the component's services.
#   6. Health-check. If it fails, roll back from the backup and restart.
#
# SAFE BY DEFAULT: runs as a DRY RUN unless you pass --apply. Dry run prints every
# action (and the exact file list) without touching the server.
#
# Secrets: this script NEVER ships common/app.config*, .env, credentials, or
# keystores. Runtime secrets must already be set on the server as PIQ_* env vars
# (see docs/SECURITY_SECRETS.md).
#
# Usage:
#   scripts/deploy.sh <main|frontend|itsm|all> [--apply] [--no-restart] [--no-rollback]
#
# Common env overrides:
#   DEPLOY_HOST (default 198.233.100.77)   DEPLOY_USER (default user)
#   DEPLOY_SSH_KEY (path to private key, optional)
#   MAIN_REMOTE_DIR (default /home/user/project-iq)
#   ITSM_LOCAL_DIR  (default ../itsm-service)
#   ITSM_REMOTE_DIR (default /home/user/itsm-service)
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Config (all overridable via environment)
# ---------------------------------------------------------------------------
DEPLOY_HOST="${DEPLOY_HOST:-198.233.100.77}"
DEPLOY_USER="${DEPLOY_USER:-user}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-}"
MAIN_REMOTE_DIR="${MAIN_REMOTE_DIR:-/home/user/project-iq}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ITSM_LOCAL_DIR="${ITSM_LOCAL_DIR:-$REPO_ROOT/../itsm-service}"
ITSM_REMOTE_DIR="${ITSM_REMOTE_DIR:-/home/user/itsm-service}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-/home/$DEPLOY_USER/piq-deploy-backups}"

# Health endpoints (checked locally on the box via curl, so 127.0.0.1)
ADMIN_HEALTH_URL="${ADMIN_HEALTH_URL:-http://127.0.0.1:8181/api/status}"
ITSM_HEALTH_URL="${ITSM_HEALTH_URL:-http://127.0.0.1:8000/api/v1/health}"

# We ship ONLY git-tracked files (from the working tree, so uncommitted edits to
# tracked files are included). Anything untracked — secrets (.env, app.config is
# excluded below too), caches, models, node_modules, venvs, IDE/build junk — is
# never packaged by construction, so it can't leak. The only tracked paths we
# must still withhold are the config files that the server maintains itself.
# Withheld = (a) server-owned config/secrets, (b) tracked-but-non-deployable junk
# (runtime logs, IDE/agent dirs, DB backups) that got committed historically.
EXCLUDE_RE='^(common/app\.config($|\.)|.*\.env$|.*\.(err|out)$|\.(vs|claude|agent|sixth)/|backups/|_?nul$|(.*/)?docker-compose\.override\.yml$)'

APPLY=0; DO_RESTART=1; DO_ROLLBACK=1; COMPONENT=""

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    main|frontend|itsm|all) COMPONENT="$arg" ;;
    --apply)       APPLY=1 ;;
    --no-restart)  DO_RESTART=0 ;;
    --no-rollback) DO_ROLLBACK=0 ;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "ERROR: unknown arg '$arg'"; exit 2 ;;
  esac
done
[ -n "$COMPONENT" ] || { echo "ERROR: pick a component: main | frontend | itsm | all"; exit 2; }

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
[ -n "$DEPLOY_SSH_KEY" ] && SSH_OPTS+=(-i "$DEPLOY_SSH_KEY")
SSH=(ssh "${SSH_OPTS[@]}" "$DEPLOY_USER@$DEPLOY_HOST")
# Local timestamp label for this run (dry-run must never touch the server).
STAMP="$(date +%Y%m%d_%H%M%S)"

say()  { echo "[deploy] $*"; }
run()  { if [ "$APPLY" -eq 1 ]; then "$@"; else echo "  DRY-RUN> $*"; fi; }
rrun() { if [ "$APPLY" -eq 1 ]; then "${SSH[@]}" "$1"; else echo "  DRY-RUN(remote)> $1"; fi; }

# ---------------------------------------------------------------------------
# Core: deploy one (local_dir -> remote_dir) with backup + restart + health
# ---------------------------------------------------------------------------
deploy_unit() {
  local name="$1" local_dir="$2" remote_dir="$3" restart_cmd="$4" health_url="$5"
  local pkg_mode="${6:-git}" dirs_csv="${7:-}"
  say "=== component: $name ==="
  [ -d "$local_dir" ] || { echo "ERROR: local dir not found: $local_dir"; exit 1; }

  local tarball="/tmp/piq-deploy-$name-$STAMP.tgz"
  local list_file; list_file="$(mktemp)"

  if [ "$pkg_mode" = "git" ]; then
    # Ship git-tracked files (working-tree state) minus server-owned/junk paths.
    git -C "$local_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
      || { echo "ERROR: $local_dir is not a git repo (git mode ships tracked files)"; exit 1; }
    git -C "$local_dir" ls-files -z | tr '\0' '\n' | grep -vE "$EXCLUDE_RE" > "$list_file"
    say "packaging $(wc -l < "$list_file" | tr -d ' ') git-tracked files from $local_dir"
    echo "  top-level entries that WILL ship:"
    awk -F/ 'NF{print $1}' "$list_file" | sort -u | sed 's/^/    /'
    echo "  withheld (server-owned/secret/junk): $(git -C "$local_dir" ls-files | grep -cE "$EXCLUDE_RE") tracked path(s)"
  else
    # Ship explicit BUILT dirs (build outputs are untracked by design, e.g. web/ui/dist).
    : > "$list_file"
    IFS=',' read -ra _dirs <<< "$dirs_csv"
    for d in "${_dirs[@]}"; do
      if [ -e "$local_dir/$d" ]; then echo "$d" >> "$list_file"; else say "  note: '$d' not present (skipped) — build it first?"; fi
    done
    [ -s "$list_file" ] || { echo "ERROR: none of [$dirs_csv] exist in $local_dir — run the build first (e.g. cd web/ui && npm run build)"; rm -f "$list_file"; exit 1; }
    say "packaging built dirs from $local_dir:"
    sed 's/^/    /' "$list_file"
  fi

  if [ "$APPLY" -eq 1 ]; then
    tar czf "$tarball" -C "$local_dir" -T "$list_file"
    say "  package size: $(du -h "$tarball" | cut -f1)"
  else
    echo "  DRY-RUN> would tar the above from $local_dir and scp to $DEPLOY_USER@$DEPLOY_HOST:/tmp/"
  fi
  rm -f "$list_file"

  say "remote backup of $remote_dir -> $REMOTE_BACKUP_DIR/$name-$STAMP.tgz"
  rrun "mkdir -p '$REMOTE_BACKUP_DIR' && if [ -d '$remote_dir' ]; then tar czf '$REMOTE_BACKUP_DIR/$name-$STAMP.tgz' -C '$remote_dir' . ; fi"

  say "upload + overlay-extract into $remote_dir (server-only files preserved)"
  if [ "$APPLY" -eq 1 ]; then
    scp "${SSH_OPTS[@]}" "$tarball" "$DEPLOY_USER@$DEPLOY_HOST:$tarball"
    "${SSH[@]}" "mkdir -p '$remote_dir' && tar xzf '$tarball' -C '$remote_dir' && rm -f '$tarball'"
    rm -f "$tarball"
  else
    echo "  DRY-RUN> scp $tarball -> :$tarball ; tar xzf into $remote_dir"
  fi

  if [ "$DO_RESTART" -eq 1 ]; then
    say "restart: $restart_cmd"
    rrun "$restart_cmd"
  else
    say "restart skipped (--no-restart)"
  fi

  # Health check (give the service a moment to come up)
  say "health check: $health_url"
  if [ "$APPLY" -eq 1 ]; then
    local ok=0 code=""
    for _ in 1 2 3 4 5 6; do
      code="$("${SSH[@]}" "curl -s -o /dev/null -w '%{http_code}' --max-time 5 '$health_url'" 2>/dev/null || echo 000)"
      [ "$code" = "200" ] && { ok=1; break; }
      sleep 3
    done
    if [ "$ok" -eq 1 ]; then
      say "  health OK (HTTP 200)"
    else
      say "  HEALTH FAILED (last HTTP $code)"
      if [ "$DO_ROLLBACK" -eq 1 ]; then
        say "  ROLLING BACK from $REMOTE_BACKUP_DIR/$name-$STAMP.tgz"
        "${SSH[@]}" "if [ -f '$REMOTE_BACKUP_DIR/$name-$STAMP.tgz' ]; then rm -rf '$remote_dir'/* && tar xzf '$REMOTE_BACKUP_DIR/$name-$STAMP.tgz' -C '$remote_dir'; fi"
        rrun "$restart_cmd"
        say "  rolled back; investigate before retrying."
      else
        say "  rollback disabled (--no-rollback); remote left as-is."
      fi
      exit 1
    fi
  else
    echo "  DRY-RUN> would poll $health_url for HTTP 200, rollback on failure"
  fi
  say "=== $name done ==="
}

# Restart commands (overridable). 'main' restarts the admin API + rasa-core
# instances + the action server. Adjust to your unit names if they differ.
MAIN_RESTART="${MAIN_RESTART:-sudo systemctl restart project-iq-admin; sudo systemctl restart 'rasa-core@*' 2>/dev/null || true}"
ITSM_RESTART="${ITSM_RESTART:-cd '$ITSM_REMOTE_DIR' && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d}"

case "$COMPONENT" in
  main)
    deploy_unit "main" "$REPO_ROOT" "$MAIN_REMOTE_DIR" "$MAIN_RESTART" "$ADMIN_HEALTH_URL"
    ;;
  frontend)
    # Ship the BUILT front-end assets Flask serves (build first: cd web/ui && npm run build).
    # These dirs are untracked build outputs, so this uses dirs-mode, not git.
    deploy_unit "frontend" "$REPO_ROOT/web/ui" "$MAIN_REMOTE_DIR/web/ui" \
      "sudo systemctl restart project-iq-admin" "$ADMIN_HEALTH_URL" \
      "dirs" "dist,dist-widget,public"
    ;;
  itsm)
    deploy_unit "itsm" "$ITSM_LOCAL_DIR" "$ITSM_REMOTE_DIR" "$ITSM_RESTART" "$ITSM_HEALTH_URL"
    ;;
  all)
    deploy_unit "itsm" "$ITSM_LOCAL_DIR" "$ITSM_REMOTE_DIR" "$ITSM_RESTART" "$ITSM_HEALTH_URL"
    deploy_unit "main" "$REPO_ROOT" "$MAIN_REMOTE_DIR" "$MAIN_RESTART" "$ADMIN_HEALTH_URL"
    ;;
esac

say "ALL DONE.${APPLY:+}"
[ "$APPLY" -eq 1 ] || say "This was a DRY RUN. Re-run with --apply to deploy for real."
