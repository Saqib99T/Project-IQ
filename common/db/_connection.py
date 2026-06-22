"""
common.db._connection — connection pool, schema init, and read-replica routing.
"""
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
from datetime import datetime
from typing import Dict, List, Optional, Any
import json

logger = logging.getLogger(__name__)
# ── Connection pool ───────────────────────────────────────────────────────────

_connection_pool = None


def _get_db_config() -> dict:
    try:
        from common.config_manager import get_db_config
        return get_db_config()
    except ImportError:
        try:
            from actions.config_manager import get_db_config
            return get_db_config()
        except ImportError:
            return {'host': 'localhost', 'port': 5432, 'database': 'Chatbot',
                    'user': 'postgres', 'password': '12345'}


def _get_pool():
    global _connection_pool
    if _connection_pool is None:
        _connection_pool = pool.ThreadedConnectionPool(minconn=1, maxconn=50, **_get_db_config())
    return _connection_pool


def _get_connection():
    return _get_pool().getconn()


def _release_connection(conn):
    _get_pool().putconn(conn)


def _get_read_connection():
    """Returns (conn, is_replica). No replica configured — uses write pool."""
    return _get_connection(), False


def _release_read_connection(conn, is_replica):
    _release_connection(conn)


# ── Schema init ───────────────────────────────────────────────────────────────

def _init_database():
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        ddl = [
            '''CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY, sender_id TEXT UNIQUE NOT NULL,
                app_id TEXT DEFAULT 'General', started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP, resolved INTEGER DEFAULT 0)''',
            '''CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY, conversation_id INTEGER NOT NULL, sender TEXT NOT NULL,
                text TEXT, intent TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id))''',
            '''CREATE TABLE IF NOT EXISTS feedback (
                id SERIAL PRIMARY KEY, conversation_id INTEGER NOT NULL, type TEXT NOT NULL,
                rating INTEGER, comments TEXT, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id))''',
            '''CREATE TABLE IF NOT EXISTS actions (
                id SERIAL PRIMARY KEY, conversation_id INTEGER NOT NULL, action_name TEXT NOT NULL,
                success INTEGER DEFAULT 1, timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id))''',
            '''CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS themes (
                id SERIAL PRIMARY KEY, name TEXT NOT NULL, settings TEXT,
                is_default INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS chat_apps (
                id SERIAL PRIMARY KEY, app_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
                description TEXT, is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS kb_data_sources (
                id SERIAL PRIMARY KEY, source_type VARCHAR(50), source_config TEXT,
                last_sync TIMESTAMP, articles_count INT DEFAULT 0,
                status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS operators (
                id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL,
                display_name VARCHAR(200) NOT NULL, password_hash VARCHAR(255) NOT NULL,
                email VARCHAR(255), team VARCHAR(100), app_ids TEXT[] NOT NULL DEFAULT '{}',
                shift_schedule JSONB, status VARCHAR(20) NOT NULL DEFAULT 'offline',
                max_concurrent INT NOT NULL DEFAULT 3, is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS handoff_queue (
                id SERIAL PRIMARY KEY, conversation_id INT NOT NULL REFERENCES conversations(id),
                sender_id VARCHAR(255) NOT NULL, app_id VARCHAR(50), priority INT NOT NULL DEFAULT 5,
                trigger_reason VARCHAR(50), trigger_detail JSONB, target_team VARCHAR(100),
                required_skill VARCHAR(100), status VARCHAR(30) NOT NULL DEFAULT 'waiting',
                queue_position INT, operator_id INT REFERENCES operators(id), context_package JSONB,
                queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, assigned_at TIMESTAMP,
                resolved_at TIMESTAMP, abandoned_at TIMESTAMP, wait_time_secs INT,
                handle_time_secs INT, return_to_bot BOOLEAN NOT NULL DEFAULT TRUE,
                closing_note TEXT, agent_rating SMALLINT CHECK (agent_rating BETWEEN 1 AND 5),
                agent_rating_note TEXT, timeout_asked_at TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS operator_messages (
                id SERIAL PRIMARY KEY, conversation_id INT NOT NULL REFERENCES conversations(id),
                queue_id INT REFERENCES handoff_queue(id),
                operator_id INT NOT NULL REFERENCES operators(id),
                message_text TEXT NOT NULL, sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                delivered_at TIMESTAMP, read_at TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS handoff_consent_log (
                id SERIAL PRIMARY KEY, sender_id VARCHAR(255) NOT NULL,
                conversation_id INT REFERENCES conversations(id), consented BOOLEAN NOT NULL,
                consented_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ip_hash VARCHAR(64),
                consent_version VARCHAR(10) NOT NULL DEFAULT '1.0')''',
            '''CREATE TABLE IF NOT EXISTS handoff_routing_rules (
                id SERIAL PRIMARY KEY, rule_name VARCHAR(200) NOT NULL,
                match_type VARCHAR(30) NOT NULL, match_value VARCHAR(255) NOT NULL,
                target_team VARCHAR(100), required_skill VARCHAR(100),
                priority_boost INT NOT NULL DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE,
                sort_order INT NOT NULL DEFAULT 99,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS handoff_state_log (
                id SERIAL PRIMARY KEY, conversation_id INT REFERENCES conversations(id),
                from_state VARCHAR(30), to_state VARCHAR(30), triggered_by VARCHAR(50),
                triggered_by_id VARCHAR(100), note TEXT,
                changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)''',
            '''CREATE TABLE IF NOT EXISTS admin_watch_log (
                id SERIAL PRIMARY KEY, admin_username VARCHAR(100),
                conversation_id INT REFERENCES conversations(id),
                started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, ended_at TIMESTAMP)''',
        ]
        for stmt in ddl:
            cursor.execute(stmt)

        # Safe migrations (ADD COLUMN IF NOT EXISTS)
        migrations = [
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_name TEXT",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ticket_id TEXT",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_state VARCHAR(30) NOT NULL DEFAULT 'bot_active'",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_operator_id INT REFERENCES operators(id)",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_count INT NOT NULL DEFAULT 0",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS low_conf_streak INT NOT NULL DEFAULT 0",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS frustration_score FLOAT NOT NULL DEFAULT 0.0",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS consent_given BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS client_metadata JSONB",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS app_id TEXT DEFAULT 'General'",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS ticket_id TEXT",
            "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS app_id TEXT DEFAULT 'General'",
            "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS ticket_id TEXT",
            "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS rating INTEGER",
            "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS comments TEXT",
            "ALTER TABLE actions ADD COLUMN IF NOT EXISTS app_id TEXT DEFAULT 'General'",
            "ALTER TABLE actions ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE actions ADD COLUMN IF NOT EXISTS ticket_id TEXT",
            # IAM migration
            "ALTER TABLE operators ADD COLUMN IF NOT EXISTS iam_sub TEXT UNIQUE",
            "CREATE INDEX IF NOT EXISTS idx_operators_iam_sub ON operators(iam_sub)",
            "ALTER TABLE operators ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE operators ADD COLUMN IF NOT EXISTS email VARCHAR(255)",
            # KB search gaps — queries that returned no / low-confidence results
            """CREATE TABLE IF NOT EXISTS kb_search_gaps (
                id          SERIAL PRIMARY KEY,
                query       TEXT NOT NULL,
                app_id      TEXT,
                sender_id   TEXT,
                searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_kb_gaps_time ON kb_search_gaps(searched_at DESC)",
            # Ticket → sender_id mapping (populated when ticket created through our app)
            """CREATE TABLE IF NOT EXISTS ticket_senders (
                glpi_ticket_id INTEGER PRIMARY KEY,
                sender_id      TEXT NOT NULL,
                app_id         TEXT,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            # Notifications
            """CREATE TABLE IF NOT EXISTS notifications (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id TEXT NOT NULL,
                app_id TEXT,
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                body TEXT,
                payload JSONB,
                read BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )""",
            "CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read, created_at DESC)",
            # Push tokens for mobile
            """CREATE TABLE IF NOT EXISTS push_tokens (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                token TEXT NOT NULL,
                platform TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(user_id, token)
            )""",

            # ── Multi-tenant tables ───────────────────────────────────────────
            # Which products each operator is assigned to handle (empty = all)
            """CREATE TABLE IF NOT EXISTS operator_products (
                operator_id  INT  NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
                product_id   TEXT NOT NULL,
                PRIMARY KEY (operator_id, product_id)
            )""",

            # Org entitlement cache — synced from IAM on login
            """CREATE TABLE IF NOT EXISTS org_product_access (
                org_id      TEXT NOT NULL,
                product_id  TEXT NOT NULL,
                active      BOOLEAN NOT NULL DEFAULT TRUE,
                synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (org_id, product_id)
            )""",

            # ── Multi-tenant column additions ─────────────────────────────────
            # conversations
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS org_id     TEXT",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS product_id TEXT",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel    TEXT NOT NULL DEFAULT 'internal'",

            # handoff_queue — org scoping + channel routing
            "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS user_org_id    TEXT",
            "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS support_org_id TEXT",
            "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS product_id     TEXT",
            "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS channel        TEXT NOT NULL DEFAULT 'internal'",

            # ticket_senders — full context for GLPI webhook reverse lookup
            "ALTER TABLE ticket_senders ADD COLUMN IF NOT EXISTS org_id           TEXT",
            "ALTER TABLE ticket_senders ADD COLUMN IF NOT EXISTS product_id       TEXT",
            "ALTER TABLE ticket_senders ADD COLUMN IF NOT EXISTS requester_org_id TEXT",
            "ALTER TABLE ticket_senders ADD COLUMN IF NOT EXISTS channel          TEXT NOT NULL DEFAULT 'internal'",

            # operators — org membership + channel scope
            "ALTER TABLE operators ADD COLUMN IF NOT EXISTS org_id  TEXT",
            "ALTER TABLE operators ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'internal'",
        ]
        for stmt in migrations:
            try: cursor.execute(stmt)
            except Exception: pass

        # Indexes
        indexes = [
            "CREATE INDEX IF NOT EXISTS idx_conv_sender     ON conversations(sender_id)",
            "CREATE INDEX IF NOT EXISTS idx_conv_app        ON conversations(app_id)",
            "CREATE INDEX IF NOT EXISTS idx_conv_user       ON conversations(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_conv_ticket     ON conversations(ticket_id)",
            "CREATE INDEX IF NOT EXISTS idx_conv_last_act   ON conversations(last_activity DESC)",
            "CREATE INDEX IF NOT EXISTS idx_conv_started    ON conversations(started_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_conv_handoff    ON conversations(handoff_state)",
            "CREATE INDEX IF NOT EXISTS idx_msg_conv        ON messages(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_msg_intent      ON messages(intent)",
            "CREATE INDEX IF NOT EXISTS idx_msg_app         ON messages(app_id)",
            "CREATE INDEX IF NOT EXISTS idx_msg_ticket      ON messages(ticket_id)",
            "CREATE INDEX IF NOT EXISTS idx_actions_ts      ON actions(timestamp DESC)",
            "CREATE INDEX IF NOT EXISTS idx_actions_cv_nm   ON actions(conversation_id, action_name)",
            "CREATE INDEX IF NOT EXISTS idx_feedback_conv   ON feedback(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_hq_conversation ON handoff_queue(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_hq_status       ON handoff_queue(status)",
            "CREATE INDEX IF NOT EXISTS idx_hq_operator     ON handoff_queue(operator_id)",
            "CREATE INDEX IF NOT EXISTS idx_hq_app_status   ON handoff_queue(app_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_hq_queued_at    ON handoff_queue(queued_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_om_conversation ON operator_messages(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_om_operator     ON operator_messages(operator_id)",
            "CREATE INDEX IF NOT EXISTS idx_hsl_conv        ON handoff_state_log(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_operators_status    ON operators(status)",
            # Multi-tenant indexes
            "CREATE INDEX IF NOT EXISTS idx_conv_org         ON conversations(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_conv_channel     ON conversations(channel)",
            "CREATE INDEX IF NOT EXISTS idx_hq_user_org      ON handoff_queue(user_org_id)",
            "CREATE INDEX IF NOT EXISTS idx_hq_support_org   ON handoff_queue(support_org_id)",
            "CREATE INDEX IF NOT EXISTS idx_hq_channel       ON handoff_queue(channel)",
            "CREATE INDEX IF NOT EXISTS idx_hq_product       ON handoff_queue(product_id)",
            "CREATE INDEX IF NOT EXISTS idx_ts_org           ON ticket_senders(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_ops_org          ON operators(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_org_product      ON org_product_access(org_id)",
        ]
        for stmt in indexes:
            try: cursor.execute(stmt)
            except Exception: pass

        # Seed default apps
        cursor.execute('SELECT COUNT(*) FROM chat_apps')
        if cursor.fetchone()[0] == 0:
            for app in [('IT','IT Support','Technical support'),('Accounting','Accounting Support','Finance'),
                        ('HR','Human Resources','HR support'),('General','General Support','General inquiries')]:
                cursor.execute('INSERT INTO chat_apps (app_id,name,description) VALUES (%s,%s,%s)', app)

        conn.commit()
    finally:
        _release_connection(conn)


try:
    _init_database()
except Exception as e:
    logger.warning("Could not initialize database: %s", e)
