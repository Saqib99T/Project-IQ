#!/bin/bash
# PostgreSQL streaming replication setup for Project IQ.
#
# Assumes:
#   - Primary PostgreSQL is running on the same machine (localhost:5432)
#   - Replica will run on a second machine or a second PG cluster on the same machine
#   - This script is run as the 'postgres' OS user on the PRIMARY
#
# Usage:
#   On PRIMARY:   sudo -u postgres bash infra/setup_pg_replica.sh primary <replica_ip>
#   On REPLICA:   sudo -u postgres bash infra/setup_pg_replica.sh replica <primary_ip>

set -e

ROLE="${1:-}"
REMOTE_IP="${2:-}"
PG_VERSION=$(pg_config --version | grep -oP '\d+' | head -1)
PG_DATA="/etc/postgresql/$PG_VERSION/main"
PG_HBA="$PG_DATA/pg_hba.conf"
PG_CONF="$PG_DATA/postgresql.conf"

if [[ -z "$ROLE" || -z "$REMOTE_IP" ]]; then
    echo "Usage: $0 <primary|replica> <remote_ip>"
    exit 1
fi

# ── PRIMARY SETUP ─────────────────────────────────────────────────────────────
if [[ "$ROLE" == "primary" ]]; then
    echo "=== Configuring PRIMARY PostgreSQL for streaming replication ==="

    # 1. Create replication user
    echo "[1/4] Creating replication user 'replicator'..."
    psql -c "DO \$\$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'replicator') THEN
            CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'repl_strong_password_change_me';
        END IF;
    END \$\$;"

    # 2. Update postgresql.conf
    echo "[2/4] Updating postgresql.conf..."
    # wal_level must be 'replica' or 'logical' for streaming replication
    grep -q "^wal_level" "$PG_CONF" \
        && sed -i "s/^wal_level.*/wal_level = replica/" "$PG_CONF" \
        || echo "wal_level = replica" >> "$PG_CONF"

    grep -q "^max_wal_senders" "$PG_CONF" \
        && sed -i "s/^max_wal_senders.*/max_wal_senders = 3/" "$PG_CONF" \
        || echo "max_wal_senders = 3" >> "$PG_CONF"

    grep -q "^wal_keep_size" "$PG_CONF" \
        && sed -i "s/^wal_keep_size.*/wal_keep_size = 64/" "$PG_CONF" \
        || echo "wal_keep_size = 64" >> "$PG_CONF"

    # 3. Allow replica to connect for replication in pg_hba.conf
    echo "[3/4] Adding replication entry to pg_hba.conf..."
    REPL_ENTRY="host    replication     replicator      $REMOTE_IP/32          scram-sha-256"
    grep -q "$REMOTE_IP" "$PG_HBA" \
        || echo "$REPL_ENTRY" >> "$PG_HBA"

    # 4. Reload/restart PostgreSQL
    echo "[4/4] Restarting PostgreSQL..."
    systemctl restart postgresql

    echo ""
    echo "=== PRIMARY configured. Run the following on the REPLICA machine: ==="
    echo "  sudo -u postgres bash infra/setup_pg_replica.sh replica $(hostname -I | awk '{print $1}')"
fi

# ── REPLICA SETUP ─────────────────────────────────────────────────────────────
if [[ "$ROLE" == "replica" ]]; then
    echo "=== Configuring REPLICA PostgreSQL ==="
    PRIMARY_IP="$REMOTE_IP"

    # 1. Stop PostgreSQL on replica and wipe data directory
    echo "[1/4] Stopping PostgreSQL and clearing data..."
    systemctl stop postgresql
    rm -rf "$PG_DATA"/*

    # 2. Base backup from primary
    echo "[2/4] Taking base backup from primary ($PRIMARY_IP)..."
    PGPASSWORD="repl_strong_password_change_me" \
        pg_basebackup \
            -h "$PRIMARY_IP" \
            -U replicator \
            -D "$PG_DATA" \
            -P \
            -Xs \
            -R   # writes standby.signal + primary_conninfo automatically

    # 3. Ensure primary_conninfo is correct in postgresql.auto.conf
    echo "[3/4] Writing primary_conninfo..."
    cat >> "$PG_DATA/postgresql.auto.conf" <<EOF

# Streaming replication — written by setup_pg_replica.sh
primary_conninfo = 'host=$PRIMARY_IP port=5432 user=replicator password=repl_strong_password_change_me'
hot_standby = on
EOF

    # 4. Fix permissions and start
    echo "[4/4] Setting permissions and starting PostgreSQL..."
    chown -R postgres:postgres "$PG_DATA"
    chmod 700 "$PG_DATA"
    systemctl start postgresql
    sleep 3

    # Verify
    psql -c "SELECT pg_is_in_recovery();" && echo "Replica is in recovery mode (streaming from primary)."

    echo ""
    echo "=== REPLICA configured. ==="
    echo "Now set db_replica_host in app.config.prod to: $PRIMARY_IP"
    echo "(or this machine's IP if the replica is on a different host)"
fi
