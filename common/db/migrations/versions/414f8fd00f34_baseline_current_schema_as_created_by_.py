"""baseline: current schema as created by common/db/_connection.py

This is a byte-for-byte port of the DDL that ``common/db/_connection.py``'s
``_init_database()`` has run at import time since the schema was first
introduced — nothing here is new. Existing databases that already went
through that bootstrap should be marked as up to date without re-running it:

    alembic stamp 414f8fd00f34

A genuinely fresh database should instead run it for real:

    alembic upgrade head

Two differences from the legacy runner, both fixes rather than schema
changes:

1. Each "best-effort" statement (the ``ADD COLUMN IF NOT EXISTS`` /
   ``CREATE INDEX IF NOT EXISTS`` groups) now runs in its own SAVEPOINT.
   The legacy code ran all of them on one shared connection with a bare
   ``except Exception: pass`` and no rollback — so on a truly fresh database,
   the very first statement that touches a table this migration doesn't
   create (``kb_articles`` / ``kb_chunks`` — see note below) poisoned the
   whole transaction, and *every* statement after it silently failed too,
   including the unrelated ones. Verified locally: running the legacy
   ``_init_database()`` against an empty database creates zero tables.
   SAVEPOINTs isolate each statement so one expected failure doesn't take
   down the rest.
2. Failures are logged (``op.execute`` failures at INFO), not swallowed
   silently, so a genuine typo doesn't go unnoticed forever.

Known gap, carried over as-is rather than guessed at here: ``kb_articles``
and ``kb_chunks`` are never CREATEd by this codebase — ``kb_chunks`` is
created separately by ``scripts/setup_pgvector.py``, and ``kb_articles``
has no creation statement anywhere in the current repo (likely created
manually against production at some point). The two ``ALTER TABLE
kb_articles / kb_chunks ADD COLUMN org_id`` statements below only succeed
if those tables already exist — same as today. Confirm the real production
``kb_articles`` schema before writing a migration that creates it; inventing
one here risked being wrong in a way nobody would notice until it mattered.

Revision ID: 414f8fd00f34
Revises:
Create Date: 2026-08-18 16:39:15.056824

"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

logger = logging.getLogger("alembic.baseline")

# revision identifiers, used by Alembic.
revision: str = '414f8fd00f34'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ── Tables this migration fully owns — must succeed, no swallowing ─────────
_CREATE_TABLES = [
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

# ── Best-effort: additive columns/tables/indexes layered on over time ──────
# Same statements as common/db/_connection.py's `migrations` list, verbatim.
_MIGRATIONS = [
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
    "ALTER TABLE operators ADD COLUMN IF NOT EXISTS iam_sub TEXT UNIQUE",
    "CREATE INDEX IF NOT EXISTS idx_operators_iam_sub ON operators(iam_sub)",
    "ALTER TABLE operators ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE",
    "ALTER TABLE operators ADD COLUMN IF NOT EXISTS email VARCHAR(255)",
    """CREATE TABLE IF NOT EXISTS kb_search_gaps (
        id          SERIAL PRIMARY KEY,
        query       TEXT NOT NULL,
        app_id      TEXT,
        sender_id   TEXT,
        searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_kb_gaps_time ON kb_search_gaps(searched_at DESC)",
    "ALTER TABLE kb_search_gaps ADD COLUMN IF NOT EXISTS org_id TEXT",
    "ALTER TABLE kb_search_gaps ADD COLUMN IF NOT EXISTS product_id TEXT",
    "ALTER TABLE kb_search_gaps ADD COLUMN IF NOT EXISTS curation_article_id TEXT",
    """CREATE TABLE IF NOT EXISTS ticket_senders (
        glpi_ticket_id INTEGER PRIMARY KEY,
        sender_id      TEXT NOT NULL,
        app_id         TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
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
    """CREATE TABLE IF NOT EXISTS push_tokens (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        platform TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, token)
    )""",
    """CREATE TABLE IF NOT EXISTS operator_products (
        operator_id  INT  NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
        product_id   TEXT NOT NULL,
        PRIMARY KEY (operator_id, product_id)
    )""",
    """CREATE TABLE IF NOT EXISTS org_product_access (
        org_id      TEXT NOT NULL,
        product_id  TEXT NOT NULL,
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, product_id)
    )""",
    "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS org_id     TEXT",
    "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS product_id TEXT",
    "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS channel    TEXT NOT NULL DEFAULT 'internal'",
    "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS user_org_id    TEXT",
    "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS support_org_id TEXT",
    "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS product_id     TEXT",
    "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS channel        TEXT NOT NULL DEFAULT 'internal'",
    "ALTER TABLE ticket_senders ADD COLUMN IF NOT EXISTS org_id           TEXT",
    "ALTER TABLE ticket_senders ADD COLUMN IF NOT EXISTS product_id       TEXT",
    "ALTER TABLE ticket_senders ADD COLUMN IF NOT EXISTS requester_org_id TEXT",
    "ALTER TABLE ticket_senders ADD COLUMN IF NOT EXISTS channel          TEXT NOT NULL DEFAULT 'internal'",
    "ALTER TABLE operators ADD COLUMN IF NOT EXISTS org_id  TEXT",
    "ALTER TABLE operators ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'internal'",
    # Only succeed if kb_articles/kb_chunks already exist — see module docstring.
    "ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS org_id TEXT",
    "ALTER TABLE kb_chunks   ADD COLUMN IF NOT EXISTS org_id TEXT",
    """CREATE TABLE IF NOT EXISTS canned_responses (
        id SERIAL PRIMARY KEY,
        org_id TEXT,
        app_id TEXT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        shortcut TEXT,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_canned_org ON canned_responses(org_id, title)",
    """CREATE TABLE IF NOT EXISTS shopify_connections (
        org_id                    TEXT PRIMARY KEY,
        shop_domain               TEXT NOT NULL UNIQUE,
        access_token              TEXT NOT NULL,
        refresh_token             TEXT,
        access_token_expires_at   TIMESTAMPTZ,
        refresh_token_expires_at  TIMESTAMPTZ,
        scopes                    TEXT,
        status                    TEXT NOT NULL DEFAULT 'connected',
        installed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        uninstalled_at            TIMESTAMPTZ,
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    "ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS refresh_token TEXT",
    "ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ",
    "ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS refresh_token_expires_at TIMESTAMPTZ",
    """CREATE TABLE IF NOT EXISTS shopify_write_audit (
        id             SERIAL PRIMARY KEY,
        org_id         TEXT NOT NULL,
        action         TEXT NOT NULL,
        order_gid      TEXT,
        order_name     TEXT,
        actor_iam_sub  TEXT,
        actor_email    TEXT,
        detail         JSONB,
        success        BOOLEAN NOT NULL,
        error_message  TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_shopify_audit_org_time ON shopify_write_audit(org_id, created_at DESC)",
    """CREATE TABLE IF NOT EXISTS amazon_connections (
        org_id                    TEXT PRIMARY KEY,
        seller_id                 TEXT,
        marketplace_ids           TEXT,
        access_token              TEXT NOT NULL,
        refresh_token             TEXT NOT NULL,
        access_token_expires_at   TIMESTAMPTZ,
        status                    TEXT NOT NULL DEFAULT 'connected',
        installed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        uninstalled_at            TIMESTAMPTZ,
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS amazon_order_events (
        id                SERIAL PRIMARY KEY,
        notification_type TEXT,
        payload           JSONB,
        received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    "CREATE INDEX IF NOT EXISTS idx_amazon_order_events_time ON amazon_order_events(received_at DESC)",
    """CREATE TABLE IF NOT EXISTS extension_installs (
        id               SERIAL PRIMARY KEY,
        org_id           TEXT,
        extension_id     TEXT NOT NULL,
        external_id      TEXT,
        config           JSONB NOT NULL DEFAULT '{}'::jsonb,
        secrets          TEXT,
        status           TEXT NOT NULL DEFAULT 'installed',
        last_run_at      TIMESTAMPTZ,
        last_run_result  JSONB,
        installed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )""",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_ext_installs_org_ext ON extension_installs (COALESCE(org_id, ''), extension_id)",
    "CREATE INDEX IF NOT EXISTS idx_ext_installs_org ON extension_installs(org_id)",
]

_INDEXES = [
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


def _best_effort(connection, stmt: str) -> None:
    """Run one statement in its own SAVEPOINT so a statement that can't
    succeed yet (e.g. kb_articles not existing) doesn't poison every
    statement queued after it."""
    try:
        with connection.begin_nested():
            connection.execute(sa.text(stmt))
    except Exception as exc:
        logger.info("baseline: statement skipped (%s): %s", exc.__class__.__name__, stmt.split(chr(10))[0][:80])


def upgrade() -> None:
    connection = op.get_bind()

    for stmt in _CREATE_TABLES:
        connection.execute(sa.text(stmt))

    for stmt in _MIGRATIONS:
        _best_effort(connection, stmt)

    for stmt in _INDEXES:
        _best_effort(connection, stmt)

    # Seed default apps (only if chat_apps is empty — matches legacy behavior).
    count = connection.execute(sa.text("SELECT COUNT(*) FROM chat_apps")).scalar()
    if count == 0:
        connection.execute(
            sa.text("INSERT INTO chat_apps (app_id, name, description) VALUES (:app_id, :name, :description)"),
            [
                {"app_id": "IT", "name": "IT Support", "description": "Technical support"},
                {"app_id": "Accounting", "name": "Accounting Support", "description": "Finance"},
                {"app_id": "HR", "name": "Human Resources", "description": "HR support"},
                {"app_id": "General", "name": "General Support", "description": "General inquiries"},
            ],
        )


def downgrade() -> None:
    raise NotImplementedError(
        "This is the schema baseline — there is no 'before' state to downgrade to. "
        "If you need to tear down a throwaway/test database, drop it directly."
    )
