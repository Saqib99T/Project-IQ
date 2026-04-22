"""
Conversation Database Module
PostgreSQL database for persistent conversation storage and analytics.
"""

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
from datetime import datetime
from typing import Dict, List, Optional, Any
import json


def _get_db_config():
    """Get database configuration from app.config file."""
    try:
        from actions.config_manager import get_db_config
        return get_db_config()
    except ImportError:
        # Fallback if config_manager not available
        return {
            'host': 'localhost',
            'port': 5432,
            'database': 'Chatbot',
            'user': 'postgres',
            'password': '12345'
        }


# Connection pool
_connection_pool = None


def _get_pool():
    """Get or create connection pool."""
    global _connection_pool
    if _connection_pool is None:
        db_config = _get_db_config()
        _connection_pool = pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=50,
            **db_config
        )
    return _connection_pool


def _get_connection():
    """Get connection from pool."""
    return _get_pool().getconn()


def _release_connection(conn):
    """Return connection to pool."""
    _get_pool().putconn(conn)


def _init_database():
    """Initialize database schema."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        
        # Conversations table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                sender_id TEXT UNIQUE NOT NULL,
                app_id TEXT DEFAULT 'General',
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved INTEGER DEFAULT 0
            )
        ''')
        
        # Messages table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                sender TEXT NOT NULL,
                text TEXT,
                intent TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        ''')
        
        # Feedback table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS feedback (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                rating INTEGER,
                comments TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        ''')
        
        # Actions table for tracking action executions
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS actions (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                action_name TEXT NOT NULL,
                success INTEGER DEFAULT 1,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        ''')
        
        # Admin configuration table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Themes table for chatbot styling
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS themes (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                settings TEXT,
                is_default INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create indexes for faster queries
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_conv_sender ON conversations(sender_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_msg_intent ON messages(intent)')
        
        # [Performance] Indexes for Dashboard Sorting
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_conv_last_activity ON conversations(last_activity DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_conv_started_at ON conversations(started_at DESC)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_actions_timestamp ON actions(timestamp DESC)')
        
        # Add app_id, user_id, ticket_id columns to existing tables (for migrations)
        # MUST run before the optimization indexes below which depend on these columns
        alter_statements = [
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_name TEXT",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ticket_id TEXT",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS app_id TEXT DEFAULT 'General'",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS ticket_id TEXT",
            "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS app_id TEXT DEFAULT 'General'",
            "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE feedback ADD COLUMN IF NOT EXISTS ticket_id TEXT",
            "ALTER TABLE actions ADD COLUMN IF NOT EXISTS app_id TEXT DEFAULT 'General'",
            "ALTER TABLE actions ADD COLUMN IF NOT EXISTS user_id TEXT",
            "ALTER TABLE actions ADD COLUMN IF NOT EXISTS ticket_id TEXT",
        ]
        
        for stmt in alter_statements:
            try:
                cursor.execute(stmt)
            except Exception:
                pass  # Column might already exist

        # Add rating and comments columns to feedback table
        try:
            cursor.execute('ALTER TABLE feedback ADD COLUMN IF NOT EXISTS rating INTEGER')
            cursor.execute('ALTER TABLE feedback ADD COLUMN IF NOT EXISTS comments TEXT')
        except Exception:
            pass

        # [Performance] Optimization Indexes — must come after ADD COLUMN migrations above
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_conv_ticket ON conversations(ticket_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_actions_conv_name ON actions(conversation_id, action_name)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_feedback_conv ON feedback(conversation_id)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_msg_ticket ON messages(ticket_id)')

        # Add index on app_id for filtering
        try:
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_conv_app ON conversations(app_id)')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_msg_app ON messages(app_id)')
        except Exception:
            pass
        
        # ChatApps table - stores app definitions
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_apps (
                id SERIAL PRIMARY KEY,
                app_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Seed default apps if table is empty
        cursor.execute('SELECT COUNT(*) FROM chat_apps')
        if cursor.fetchone()[0] == 0:
            default_apps = [
                ('IT', 'IT Support', 'Technical support and IT helpdesk'),
                ('Accounting', 'Accounting Support', 'Finance and accounting inquiries'),
                ('HR', 'Human Resources', 'HR and employee support'),
                ('General', 'General Support', 'General inquiries and support')
            ]
            for app in default_apps:
                cursor.execute(
                    'INSERT INTO chat_apps (app_id, name, description) VALUES (%s, %s, %s)',
                    app
                )
        
        # KB Data Sources table - tracks Firecrawl URL ingestions and Airbyte connector syncs
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS kb_data_sources (
                id SERIAL PRIMARY KEY,
                source_type VARCHAR(50),
                source_config TEXT,
                last_sync TIMESTAMP,
                articles_count INT DEFAULT 0,
                status VARCHAR(20) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # ── HANDOFF PHASE 1 MIGRATIONS ─────────────────────────────────────────
        # All statements use IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so they are
        # safe to run on an existing database without risk of data loss.

        # 1. Operators table — human support agents
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS operators (
                id               SERIAL PRIMARY KEY,
                username         VARCHAR(100) UNIQUE NOT NULL,
                display_name     VARCHAR(200) NOT NULL,
                password_hash    VARCHAR(255) NOT NULL,
                email            VARCHAR(255),
                team             VARCHAR(100),
                app_ids          TEXT[]        NOT NULL DEFAULT '{}',
                shift_schedule   JSONB,
                status           VARCHAR(20)   NOT NULL DEFAULT 'offline',
                max_concurrent   INT           NOT NULL DEFAULT 3,
                is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
                created_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen        TIMESTAMP
            )
        ''')

        # 2. Handoff queue
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS handoff_queue (
                id                SERIAL PRIMARY KEY,
                conversation_id   INT          NOT NULL REFERENCES conversations(id),
                sender_id         VARCHAR(255) NOT NULL,
                app_id            VARCHAR(50),
                priority          INT          NOT NULL DEFAULT 5,
                trigger_reason    VARCHAR(50),
                trigger_detail    JSONB,
                target_team       VARCHAR(100),
                required_skill    VARCHAR(100),
                status            VARCHAR(30)  NOT NULL DEFAULT 'waiting',
                queue_position    INT,
                operator_id       INT          REFERENCES operators(id),
                context_package   JSONB,
                queued_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                assigned_at       TIMESTAMP,
                resolved_at       TIMESTAMP,
                abandoned_at      TIMESTAMP,
                wait_time_secs    INT,
                handle_time_secs  INT,
                return_to_bot     BOOLEAN      NOT NULL DEFAULT TRUE,
                closing_note      TEXT,
                agent_rating      SMALLINT     CHECK (agent_rating BETWEEN 1 AND 5),
                agent_rating_note TEXT
            )
        ''')

        # 3. Operator messages (messages sent by human operators to users)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS operator_messages (
                id               SERIAL PRIMARY KEY,
                conversation_id  INT       NOT NULL REFERENCES conversations(id),
                queue_id         INT       REFERENCES handoff_queue(id),
                operator_id      INT       NOT NULL REFERENCES operators(id),
                message_text     TEXT      NOT NULL,
                sent_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                delivered_at     TIMESTAMP,
                read_at          TIMESTAMP
            )
        ''')

        # 4. GDPR consent audit log
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS handoff_consent_log (
                id               SERIAL PRIMARY KEY,
                sender_id        VARCHAR(255) NOT NULL,
                conversation_id  INT          REFERENCES conversations(id),
                consented        BOOLEAN      NOT NULL,
                consented_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ip_hash          VARCHAR(64),
                consent_version  VARCHAR(10)  NOT NULL DEFAULT '1.0'
            )
        ''')

        # 5. Routing rules — managed via admin UI
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS handoff_routing_rules (
                id              SERIAL PRIMARY KEY,
                rule_name       VARCHAR(200) NOT NULL,
                match_type      VARCHAR(30)  NOT NULL,
                match_value     VARCHAR(255) NOT NULL,
                target_team     VARCHAR(100),
                required_skill  VARCHAR(100),
                priority_boost  INT          NOT NULL DEFAULT 0,
                is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
                sort_order      INT          NOT NULL DEFAULT 99,
                created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 6. Handoff state transition audit log
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS handoff_state_log (
                id               SERIAL PRIMARY KEY,
                conversation_id  INT          REFERENCES conversations(id),
                from_state       VARCHAR(30),
                to_state         VARCHAR(30),
                triggered_by     VARCHAR(50),
                triggered_by_id  VARCHAR(100),
                note             TEXT,
                changed_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        # 7. Admin watch log — audit trail of admin monitoring sessions
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS admin_watch_log (
                id               SERIAL PRIMARY KEY,
                admin_username   VARCHAR(100),
                conversation_id  INT          REFERENCES conversations(id),
                started_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                ended_at         TIMESTAMP
            )
        ''')

        # 8. New columns on conversations (all safe — default values provided)
        handoff_conversation_columns = [
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_state        VARCHAR(30)  NOT NULL DEFAULT 'bot_active'",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_operator_id INT          REFERENCES operators(id)",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_count        INT          NOT NULL DEFAULT 0",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS low_conf_streak      INT          NOT NULL DEFAULT 0",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS frustration_score    FLOAT        NOT NULL DEFAULT 0.0",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS consent_given        BOOLEAN      NOT NULL DEFAULT FALSE",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS client_metadata      JSONB",
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ended_at             TIMESTAMP",
        ]
        for stmt in handoff_conversation_columns:
            try:
                cursor.execute(stmt)
            except Exception:
                pass  # Column already exists — safe to ignore

        # Phase 3 additions — new columns on handoff_queue
        handoff_queue_p3_columns = [
            "ALTER TABLE handoff_queue ADD COLUMN IF NOT EXISTS timeout_asked_at TIMESTAMP",
        ]
        for stmt in handoff_queue_p3_columns:
            try:
                cursor.execute(stmt)
            except Exception:
                pass  # Safe to ignore

        # 9. Indexes for handoff tables
        handoff_indexes = [
            "CREATE INDEX IF NOT EXISTS idx_hq_conversation  ON handoff_queue(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_hq_status        ON handoff_queue(status)",
            "CREATE INDEX IF NOT EXISTS idx_hq_operator      ON handoff_queue(operator_id)",
            "CREATE INDEX IF NOT EXISTS idx_hq_app_status    ON handoff_queue(app_id, status)",
            "CREATE INDEX IF NOT EXISTS idx_hq_queued_at     ON handoff_queue(queued_at DESC)",
            "CREATE INDEX IF NOT EXISTS idx_om_conversation  ON operator_messages(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_om_operator      ON operator_messages(operator_id)",
            "CREATE INDEX IF NOT EXISTS idx_hsl_conversation ON handoff_state_log(conversation_id)",
            "CREATE INDEX IF NOT EXISTS idx_conv_handoff     ON conversations(handoff_state)",
            "CREATE INDEX IF NOT EXISTS idx_operators_status ON operators(status)",
        ]
        for stmt in handoff_indexes:
            try:
                cursor.execute(stmt)
            except Exception:
                pass  # Index already exists — safe to ignore

        conn.commit()
    finally:
        _release_connection(conn)


# Initialize database on module load
try:
    _init_database()
except Exception as e:
    print(f"Warning: Could not initialize database: {e}")


def log_conversation_start(sender_id: str, app_id: str = "General", user_id: str = None, user_name: str = None) -> int:
    """Log start of a new conversation. Returns conversation ID."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Check if conversation exists and is not ended — get the latest one
        cursor.execute('SELECT id, ended_at FROM conversations WHERE sender_id = %s ORDER BY id DESC LIMIT 1', (sender_id,))
        row = cursor.fetchone()
        if row and not row.get('ended_at'):
            # Update last activity and user_id/user_name if provided
            updates = ['last_activity = %s']
            params = [datetime.now()]
            if user_id:
                updates.append('user_id = %s')
                params.append(user_id)
            if user_name:
                updates.append('user_name = %s')
                params.append(user_name)
            params.append(sender_id)
            cursor.execute(
                f'UPDATE conversations SET {", ".join(updates)} WHERE sender_id = %s',
                params
            )
            conn.commit()
            return row['id']
        # Otherwise, create new conversation
        cursor.execute(
            'INSERT INTO conversations (sender_id, app_id, user_id, user_name, started_at, last_activity) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id',
            (sender_id, app_id, user_id, user_name, datetime.now(), datetime.now())
        )
        new_id = cursor.fetchone()['id']
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def log_message(sender_id: str, message_type: str, text: str, intent: str = None, app_id: str = "General", user_id: str = None, ticket_id: str = None):
    """Log a message in the conversation (user or bot)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        
        # Get or create conversation (with user_id)
        conv_id = log_conversation_start(sender_id, app_id, user_id=user_id)
        
        # Insert message with app_id, user_id, and ticket_id
        cursor.execute(
            'INSERT INTO messages (conversation_id, sender, text, intent, app_id, user_id, ticket_id, timestamp) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
            (conv_id, message_type, text[:500] if text else "", intent, app_id, user_id, ticket_id, datetime.now())
        )
        
        # Update last activity and ticket_id on conversation if provided
        if ticket_id:
            cursor.execute(
                'UPDATE conversations SET last_activity = %s, ticket_id = %s WHERE id = %s',
                (datetime.now(), ticket_id, conv_id)
            )
        else:
            cursor.execute(
                'UPDATE conversations SET last_activity = %s WHERE id = %s',
                (datetime.now(), conv_id)
            )
        
        conn.commit()
    finally:
        _release_connection(conn)


def log_intent(sender_id: str, intent: str, confidence: float = None):
    """Log an intent detection (stored as part of message)."""
    # Intent is logged with messages, this is for compatibility
    pass


def log_feedback(sender_id: str, feedback_type: str, app_id: str = "General", user_id: str = None, ticket_id: str = None, rating: int = None, comments: str = None):
    """Log user feedback (positive/negative) with optional rating and comments to PostgreSQL."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # Normalize feedback type
        if feedback_type in ('up', 'positive'):
            feedback_type = 'positive'
        elif feedback_type in ('down', 'negative'):
            feedback_type = 'negative'

        # Get or create conversation (with user_id)
        conv_id = log_conversation_start(sender_id, app_id, user_id=user_id)

        # Insert feedback with app_id, user_id, ticket_id, rating, and comments
        cursor.execute(
            'INSERT INTO feedback (conversation_id, type, app_id, user_id, ticket_id, rating, comments, timestamp) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
            (conv_id, feedback_type, app_id, user_id, ticket_id, rating, comments, datetime.now())
        )

        # Mark as resolved if positive
        if feedback_type == 'positive':
            cursor.execute('UPDATE conversations SET resolved = 1 WHERE id = %s', (conv_id,))

        conn.commit()
        print(f"Feedback saved to PostgreSQL: {feedback_type} (rating: {rating}) for sender {sender_id}")
    except Exception as e:
        print(f"Error saving feedback to PostgreSQL: {e}")
        conn.rollback()
    finally:
        _release_connection(conn)


def log_action(sender_id: str, action_name: str, success: bool = True, app_id: str = "General", user_id: str = None, ticket_id: str = None):
    """Log an action execution to PostgreSQL."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Get or create conversation (with user_id)
        conv_id = log_conversation_start(sender_id, app_id, user_id=user_id)
        
        cursor.execute(
            'INSERT INTO actions (conversation_id, action_name, success, app_id, user_id, ticket_id, timestamp) VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (conv_id, action_name, 1 if success else 0, app_id, user_id, ticket_id, datetime.now())
        )
        conn.commit()
        print(f"Action logged to PostgreSQL: {action_name} for sender {sender_id}")
    except Exception as e:
        print(f"Error logging action to PostgreSQL: {e}")
        conn.rollback()
    finally:
        _release_connection(conn)


def get_analytics_summary(app_id: str = None) -> Dict:
    """Get analytics summary for dashboard. Filter by app_id if provided."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Build WHERE clause for app_id filter
        app_filter = ""
        app_params = ()
        if app_id and app_id != "all":
            app_filter = " WHERE app_id = %s"
            app_params = (app_id,)
        
        # Total conversations
        cursor.execute(f'SELECT COUNT(*) as count FROM conversations{app_filter}', app_params)
        total_conversations = cursor.fetchone()['count']
        
        # Total messages (join with conversations for app_id filter)
        if app_id and app_id != "all":
            cursor.execute('SELECT COUNT(*) as count FROM messages WHERE app_id = %s', (app_id,))
        else:
            cursor.execute('SELECT COUNT(*) as count FROM messages')
        total_messages = cursor.fetchone()['count']
        
        # Feedback counts
        if app_id and app_id != "all":
            cursor.execute("SELECT COUNT(*) as count FROM feedback WHERE type = 'positive' AND app_id = %s", (app_id,))
            feedback_positive = cursor.fetchone()['count']
            cursor.execute("SELECT COUNT(*) as count FROM feedback WHERE type = 'negative' AND app_id = %s", (app_id,))
            feedback_negative = cursor.fetchone()['count']
        else:
            cursor.execute("SELECT COUNT(*) as count FROM feedback WHERE type = 'positive'")
            feedback_positive = cursor.fetchone()['count']
            cursor.execute("SELECT COUNT(*) as count FROM feedback WHERE type = 'negative'")
            feedback_negative = cursor.fetchone()['count']
        
        # Resolution rate
        total_feedback = feedback_positive + feedback_negative
        resolution_rate = round((feedback_positive / total_feedback) * 100, 1) if total_feedback > 0 else 0
        
        # Top intents
        if app_id and app_id != "all":
            cursor.execute('''
                SELECT intent, COUNT(*) as count 
                FROM messages 
                WHERE intent IS NOT NULL AND intent != '' AND app_id = %s
                GROUP BY intent 
                ORDER BY count DESC 
                LIMIT 10
            ''', (app_id,))
        else:
            cursor.execute('''
                SELECT intent, COUNT(*) as count 
                FROM messages 
                WHERE intent IS NOT NULL AND intent != '' 
                GROUP BY intent 
                ORDER BY count DESC 
                LIMIT 10
            ''')
        top_intents = [(row['intent'], row['count']) for row in cursor.fetchall()]
        
        # Conversations today
        today = datetime.now().date()
        if app_id and app_id != "all":
            cursor.execute(
                "SELECT COUNT(*) as count FROM conversations WHERE DATE(last_activity) = %s AND app_id = %s",
                (today, app_id)
            )
        else:
            cursor.execute(
                "SELECT COUNT(*) as count FROM conversations WHERE DATE(last_activity) = %s",
                (today,)
            )
        conversations_today = cursor.fetchone()['count']
        
        return {
            "total_conversations": total_conversations,
            "total_messages": total_messages,
            "feedback_positive": feedback_positive,
            "feedback_negative": feedback_negative,
            "resolution_rate": resolution_rate,
            "top_intents": top_intents,
            "conversations_today": conversations_today,
            "intent_distribution": dict(top_intents),
            "app_id": app_id or "all"
        }
    finally:
        _release_connection(conn)


def get_recent_conversations(
    limit: int = 50,
    app_id: str = None,
    user_search: str = None,
    ticket_status: str = None,  # 'created', 'updated', 'resolved', 'none'
    date_filter: str = None,  # '24h', '7d', '30d', 'custom'
    date_from: str = None,
    date_to: str = None
) -> List[Dict]:
    """Get recent conversations with optional filters for dashboard.
    
    Args:
        limit: Max number of results
        app_id: Filter by app (e.g., 'IT', 'HR')
        user_search: Search in sender_id, user_id, or user_name
        ticket_status: Filter by ticket involvement
            - 'created': Conversations where ticket was created
            - 'updated': Conversations where ticket was updated
            - 'resolved': Resolved conversations
            - 'none': Conversations with no ticket
        date_filter: Predefined date ranges
            - '24h': Last 24 hours
            - '7d': Last 7 days
            - '30d': Last 30 days
            - 'custom': Use date_from and date_to
        date_from: Start date (YYYY-MM-DD) for custom range
        date_to: End date (YYYY-MM-DD) for custom range
    """
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Build query with filters
        query = '''
            SELECT 
                c.id,
                c.sender_id,
                c.app_id,
                c.user_id,
                c.user_name,
                c.ticket_id,
                c.started_at,
                c.last_activity,
                c.resolved,
                (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count,
                (SELECT type FROM feedback WHERE conversation_id = c.id ORDER BY timestamp DESC LIMIT 1) as feedback,
                (SELECT COUNT(*) FROM actions WHERE conversation_id = c.id AND action_name = 'action_create_glpi_ticket') as tickets_created,
                (SELECT COUNT(*) FROM actions WHERE conversation_id = c.id AND action_name = 'action_update_glpi_ticket') as tickets_updated
            FROM conversations c
            WHERE 1=1
        '''
        params = []
        
        # App filter
        if app_id and app_id != 'all':
            query += ' AND c.app_id = %s'
            params.append(app_id)
        
        # User search filter
        if user_search:
            query += ''' AND (
                c.sender_id ILIKE %s OR 
                c.user_id ILIKE %s OR 
                c.user_name ILIKE %s
            )'''
            search_term = f'%{user_search}%'
            params.extend([search_term, search_term, search_term])
        
        # Ticket status filter - check actual ticket actions and statuses
        if ticket_status:
            if ticket_status == 'created':
                # Chats where a ticket was created
                query += ''' AND EXISTS (
                    SELECT 1 FROM actions a 
                    WHERE a.conversation_id = c.id 
                    AND a.action_name = 'action_create_glpi_ticket'
                    AND a.success = 1
                )'''
            elif ticket_status == 'resolved':
                # Chats where ticket was resolved (check action or resolved flag)
                query += ''' AND (
                    c.resolved = 1 OR EXISTS (
                        SELECT 1 FROM actions a 
                        WHERE a.conversation_id = c.id 
                        AND a.action_name = 'action_verify_glpi_resolution'
                    )
                )'''
            elif ticket_status == 'closed':
                # Chats where ticket status was changed to closed/solved
                query += ''' AND EXISTS (
                    SELECT 1 FROM messages m 
                    WHERE m.conversation_id = c.id 
                    AND (LOWER(m.text) LIKE '%closed%' OR LOWER(m.text) LIKE '%solved%' OR LOWER(m.text) LIKE '%ticket has been%')
                )'''
            elif ticket_status == 'updated':
                # Chats where ticket was updated/commented
                query += ''' AND EXISTS (
                    SELECT 1 FROM actions a 
                    WHERE a.conversation_id = c.id 
                    AND a.action_name IN ('action_update_glpi_ticket', 'action_view_ticket_comments')
                )'''
            elif ticket_status == 'pending':
                # Chats with ticket but not resolved
                query += ''' AND EXISTS (
                    SELECT 1 FROM actions a 
                    WHERE a.conversation_id = c.id 
                    AND a.action_name = 'action_create_glpi_ticket'
                ) AND c.resolved = 0'''
            elif ticket_status == 'none':
                # Chats with no ticket activity
                query += ''' AND NOT EXISTS (
                    SELECT 1 FROM actions a 
                    WHERE a.conversation_id = c.id 
                    AND a.action_name IN ('action_create_glpi_ticket', 'action_update_glpi_ticket', 'action_check_glpi_status')
                )'''
        
        # Date filter
        if date_filter:
            if date_filter == '24h':
                query += " AND c.last_activity >= NOW() - INTERVAL '24 hours'"
            elif date_filter == '7d':
                query += " AND c.last_activity >= NOW() - INTERVAL '7 days'"
            elif date_filter == '30d':
                query += " AND c.last_activity >= NOW() - INTERVAL '30 days'"
            elif date_filter == '90d':
                query += " AND c.last_activity >= NOW() - INTERVAL '90 days'"
        
        query += ' ORDER BY c.last_activity DESC LIMIT %s'
        params.append(limit)
        
        cursor.execute(query, tuple(params))
        
        result = []
        rows = cursor.fetchall()
        
        for row in rows:
            # Get intents for this conversation
            cursor.execute('''
                SELECT DISTINCT intent FROM messages 
                WHERE conversation_id = %s AND intent IS NOT NULL AND intent != ''
                LIMIT 5
            ''', (row['id'],))
            intents = [r['intent'] for r in cursor.fetchall()]
            
            # Determine ticket activity status
            ticket_activity = None
            if row['tickets_created'] > 0:
                ticket_activity = 'created'
            elif row['tickets_updated'] > 0:
                ticket_activity = 'updated'
            
            # Use user_name if available, then user_id, then shortened sender_id
            display_name = row.get('user_name') or row.get('user_id') or (row['sender_id'][:12] + "..." if row['sender_id'] and len(row['sender_id']) > 12 else row['sender_id'])
            
            result.append({
                "id": row['id'],
                "sender_id": row['sender_id'][:12] + "..." if row['sender_id'] and len(row['sender_id']) > 12 else row['sender_id'],
                "sender_id_full": row['sender_id'],
                "display_name": display_name,
                "user_name": row.get('user_name'),
                "user_id": row.get('user_id'),
                "app_id": row['app_id'] or "General",
                "ticket_id": row.get('ticket_id'),
                "ticket_activity": ticket_activity,
                "started_at": row['started_at'].isoformat() if row['started_at'] else None,
                "last_activity": row['last_activity'].isoformat() if row['last_activity'] else None,
                "message_count": row['message_count'],
                "intents": intents,
                "feedback": row['feedback'],
                "resolved": bool(row['resolved'])
            })
        
        return result
    finally:
        _release_connection(conn)



def get_app_list() -> List[Dict]:
    """Get list of registered apps from chat_apps table."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT id, app_id, name, description, is_active FROM chat_apps WHERE is_active = 1 ORDER BY name')
        return [dict(row) for row in cursor.fetchall()]
    finally:
        _release_connection(conn)


def get_chat_app(app_id: str) -> Dict:
    """Get a specific app by app_id."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT id, app_id, name, description, is_active FROM chat_apps WHERE app_id = %s', (app_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        _release_connection(conn)


def create_chat_app(app_id: str, name: str, description: str = None) -> int:
    """Create a new chat app. Returns the new app id."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            'INSERT INTO chat_apps (app_id, name, description) VALUES (%s, %s, %s) RETURNING id',
            (app_id, name, description)
        )
        new_id = cursor.fetchone()['id']
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def update_chat_app(app_id: str, name: str = None, description: str = None, is_active: int = None) -> bool:
    """Update a chat app."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        updates = []
        params = []
        
        if name is not None:
            updates.append("name = %s")
            params.append(name)
        if description is not None:
            updates.append("description = %s")
            params.append(description)
        if is_active is not None:
            updates.append("is_active = %s")
            params.append(is_active)
        
        if not updates:
            return False
        
        params.append(app_id)
        cursor.execute(f"UPDATE chat_apps SET {', '.join(updates)} WHERE app_id = %s", params)
        conn.commit()
        return cursor.rowcount > 0
    finally:
        _release_connection(conn)


def delete_chat_app(app_id: str) -> bool:
    """Delete a chat app (soft delete by setting is_active=0)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('UPDATE chat_apps SET is_active = 0 WHERE app_id = %s', (app_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        _release_connection(conn)


def get_conversation_transcript(sender_id: str) -> List[Dict]:
    """Get full transcript for a conversation."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute('SELECT id FROM conversations WHERE sender_id = %s', (sender_id,))
        row = cursor.fetchone()
        
        if not row:
            return []
        
        cursor.execute('''
            SELECT sender, text, intent, timestamp 
            FROM messages 
            WHERE conversation_id = %s
            ORDER BY timestamp ASC
        ''', (row['id'],))
        
        return [dict(r) for r in cursor.fetchall()]
    finally:
        _release_connection(conn)


# =====================
# ADMIN FUNCTIONS
# =====================

def get_config(key: str = None) -> Dict:
    """Get configuration value(s)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        if key:
            cursor.execute('SELECT key, value FROM config WHERE key = %s', (key,))
            row = cursor.fetchone()
            return {row['key']: row['value']} if row else {}
        
        cursor.execute('SELECT key, value FROM config')
        return {row['key']: row['value'] for row in cursor.fetchall()}
    finally:
        _release_connection(conn)


def set_config(key: str, value: str):
    """Set configuration value."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO config (key, value, updated_at) 
            VALUES (%s, %s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        ''', (key, value, datetime.now()))
        conn.commit()
    finally:
        _release_connection(conn)


def set_config_bulk(config_dict: Dict):
    """Set multiple configuration values."""
    for key, value in config_dict.items():
        set_config(key, str(value) if value is not None else '')


def get_themes() -> List[Dict]:
    """Get all themes."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute('SELECT * FROM themes ORDER BY created_at DESC')
        themes = []
        for row in cursor.fetchall():
            theme = dict(row)
            # Convert datetime to string for JSON serialization
            if theme.get('created_at'):
                theme['created_at'] = theme['created_at'].isoformat()
            if theme.get('updated_at'):
                theme['updated_at'] = theme['updated_at'].isoformat()
            themes.append(theme)
        return themes
    finally:
        _release_connection(conn)


def get_theme(theme_id: int) -> Optional[Dict]:
    """Get a specific theme by ID."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute('SELECT * FROM themes WHERE id = %s', (theme_id,))
        row = cursor.fetchone()
        if row:
            theme = dict(row)
            if theme.get('created_at'):
                theme['created_at'] = theme['created_at'].isoformat()
            if theme.get('updated_at'):
                theme['updated_at'] = theme['updated_at'].isoformat()
            return theme
        return None
    finally:
        _release_connection(conn)


def create_theme(name: str, settings: str, is_default: bool = False) -> int:
    """Create a new theme. Returns theme ID."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # If this is default, unset other defaults
        if is_default:
            cursor.execute('UPDATE themes SET is_default = 0')
        
        cursor.execute('''
            INSERT INTO themes (name, settings, is_default, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
        ''', (name, settings, 1 if is_default else 0, datetime.now(), datetime.now()))
        new_id = cursor.fetchone()['id']
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def update_theme(theme_id: int, name: str = None, settings: str = None, is_default: bool = None):
    """Update an existing theme."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        
        updates = []
        params = []
        
        if name is not None:
            updates.append('name = %s')
            params.append(name)
        if settings is not None:
            updates.append('settings = %s')
            params.append(settings)
        if is_default is not None:
            if is_default:
                cursor.execute('UPDATE themes SET is_default = 0')
            updates.append('is_default = %s')
            params.append(1 if is_default else 0)
        
        if updates:
            updates.append('updated_at = %s')
            params.append(datetime.now())
            params.append(theme_id)
            
            cursor.execute(f'UPDATE themes SET {", ".join(updates)} WHERE id = %s', params)
            conn.commit()
    finally:
        _release_connection(conn)


def delete_theme(theme_id: int):
    """Delete a theme."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM themes WHERE id = %s', (theme_id,))
        conn.commit()
    finally:
        _release_connection(conn)


def get_default_theme() -> Optional[Dict]:
    """Get the default theme."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        cursor.execute('SELECT * FROM themes WHERE is_default = 1 LIMIT 1')
        row = cursor.fetchone()
        if row:
            theme = dict(row)
            if theme.get('created_at'):
                theme['created_at'] = theme['created_at'].isoformat()
            if theme.get('updated_at'):
                theme['updated_at'] = theme['updated_at'].isoformat()
            return theme
        return None
    finally:
        _release_connection(conn)


# =====================
# KB ARTICLES FUNCTIONS
# =====================

def add_kb_article(article_id: str, title: str, content: str, category: str = None, keywords: List[str] = None, question: str = None) -> bool:
    """Add or update a KB article in the database."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        
        keywords_str = json.dumps(keywords) if keywords else '[]'
        
        cursor.execute('''
            INSERT INTO kb_articles (id, title, content, category, keywords, question, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                content = EXCLUDED.content,
                category = EXCLUDED.category,
                keywords = EXCLUDED.keywords,
                question = EXCLUDED.question,
                updated_at = EXCLUDED.updated_at
        ''', (article_id, title, content, category, keywords_str, question, datetime.now()))
        
        conn.commit()
        return True
    except Exception as e:
        print(f"Error saving KB article {article_id}: {e}")
        conn.rollback()
        return False
    finally:
        _release_connection(conn)


def get_all_kb_articles() -> List[Dict]:
    """Get all KB articles from database."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute('SELECT * FROM kb_articles')
        articles = []
        for row in cursor.fetchall():
            article = dict(row)
            # Parse keywords JSON
            if article.get('keywords'):
                try:
                    article['keywords'] = json.loads(article['keywords'])
                except:
                    article['keywords'] = []
            else:
                article['keywords'] = []
            
            # Format dates
            if article.get('created_at'):
                article['created_at'] = article.get('created_at').isoformat()
            if article.get('updated_at'):
                article['updated_at'] = article.get('updated_at').isoformat()
                
            articles.append(article)
        return articles
    finally:
        _release_connection(conn)


# =====================================================================
# HANDOFF — RUNTIME CONFIG
# =====================================================================

_HANDOFF_RUNTIME_DEFAULTS = {
    "triggers": {
        "confidence_threshold": 0.40,
        "confidence_streak_required": 2,
        "frustration_threshold": 0.75,
        "frustration_streak_required": 2,
        "direct_handoff_intents": []
    },
    "queue": {
        "priority_boost_interval_mins": 5,
        "ask_user_after_mins": 15,
        "hard_timeout_mins": 30,
        "timeout_action": "ask_user",
        "max_queue_depth": 50,
        "default_priority": 5
    },
    "operators": {
        "default_max_concurrent": 3,
        "auto_busy_on_max_load": True
    },
    "availability": {
        "no_agents_action": "offer_ticket",
        "after_hours_action": "create_ticket",
        "working_hours": {
            "timezone": "UTC",
            "monday":    "00:00-23:59",
            "tuesday":   "00:00-23:59",
            "wednesday": "00:00-23:59",
            "thursday":  "00:00-23:59",
            "friday":    "00:00-23:59",
            "saturday":  "00:00-23:59",
            "sunday":    "00:00-23:59"
        }
    },
    "gdpr": {
        "consent_required": True,
        "admin_can_skip_consent": True,
        "mask_passwords": True,
        "mask_card_numbers": True,
        "mask_ibans": True,
        "mask_emails": False,
        "consent_version": "1.0"
    },
    "glpi": {
        "auto_create_ticket_on_handoff": False
    },
    "transcript": {
        "allow_user_download": True,
        "allow_user_email": True,
        "retention_days": 365
    },
    "ai_summary": {
        "mode": "rule_based",
        "max_turns_in_summary": 20
    }
}


def get_handoff_runtime_config() -> Dict:
    """Get runtime handoff settings from the DB config table.

    On first call (no row yet) the defaults are seeded into the DB and returned.
    All callers receive a fully-populated dict — no key can ever be missing.
    """
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT value FROM config WHERE key = 'handoff_settings'")
        row = cursor.fetchone()
        if row and row['value']:
            stored = json.loads(row['value'])
            # Deep-merge stored over defaults so new keys added in future releases
            # are always present even on older installations.
            merged = _deep_merge(_HANDOFF_RUNTIME_DEFAULTS, stored)
            return merged
        # First boot — seed the defaults
        cursor.execute(
            "INSERT INTO config (key, value, updated_at) VALUES ('handoff_settings', %s, %s) "
            "ON CONFLICT (key) DO NOTHING",
            (json.dumps(_HANDOFF_RUNTIME_DEFAULTS), datetime.now())
        )
        conn.commit()
        return dict(_HANDOFF_RUNTIME_DEFAULTS)
    finally:
        _release_connection(conn)


def set_handoff_runtime_config(settings: Dict) -> bool:
    """Save runtime handoff settings back to the DB config table."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO config (key, value, updated_at) VALUES ('handoff_settings', %s, %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at",
            (json.dumps(settings), datetime.now())
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Error saving handoff runtime config: {e}")
        conn.rollback()
        return False
    finally:
        _release_connection(conn)


def _deep_merge(base: Dict, override: Dict) -> Dict:
    """Recursively merge override into base. Base keys missing from override are kept."""
    result = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


# =====================================================================
# HANDOFF — OPERATOR CRUD
# =====================================================================

def get_operators(include_inactive: bool = False) -> List[Dict]:
    """Return all operators (active only by default)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        if include_inactive:
            cursor.execute(
                "SELECT id, username, display_name, email, team, app_ids, "
                "shift_schedule, status, max_concurrent, is_active, created_at, last_seen "
                "FROM operators ORDER BY display_name"
            )
        else:
            cursor.execute(
                "SELECT id, username, display_name, email, team, app_ids, "
                "shift_schedule, status, max_concurrent, is_active, password_hash "
                "FROM operators WHERE is_active = TRUE ORDER BY display_name"
            )
        rows = cursor.fetchall()
        result = []
        for row in rows:
            op = dict(row)
            if op.get('created_at'):
                op['created_at'] = op['created_at'].isoformat()
            if op.get('last_seen'):
                op['last_seen'] = op['last_seen'].isoformat()
            result.append(op)
        return result
    finally:
        _release_connection(conn)


def get_operator(operator_id: int) -> Optional[Dict]:
    """Return a single operator by ID (no password_hash)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT id, username, display_name, email, team, app_ids, "
            "shift_schedule, status, max_concurrent, is_active, password_hash "
            "FROM operators WHERE id = %s",
            (operator_id,)
        )
        row = cursor.fetchone()
        if not row:
            return None
        op = dict(row)
        if op.get('created_at'):
            op['created_at'] = op['created_at'].isoformat()
        if op.get('last_seen'):
            op['last_seen'] = op['last_seen'].isoformat()
        return op
    finally:
        _release_connection(conn)


def get_operator_by_username(username: str) -> Optional[Dict]:
    """Return operator including password_hash (used for login only)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT id, username, display_name, email, team, app_ids, "
            "shift_schedule, status, max_concurrent, is_active, password_hash "
            "FROM operators WHERE username = %s AND is_active = TRUE",
            (username,)
        )
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        _release_connection(conn)


def create_operator(username: str, display_name: str, password_hash: str,
                    email: str = None, team: str = None, app_ids: List[str] = None,
                    max_concurrent: int = None, shift_schedule: Dict = None) -> int:
    """Create a new operator. Returns new operator ID."""
    conn = _get_connection()
    try:
        cfg = get_handoff_runtime_config()
        default_max = cfg['operators']['default_max_concurrent']
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "INSERT INTO operators "
            "(username, display_name, password_hash, email, team, app_ids, max_concurrent, shift_schedule) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                username, display_name, password_hash, email, team,
                app_ids or [],
                max_concurrent if max_concurrent is not None else default_max,
                json.dumps(shift_schedule) if shift_schedule else None
            )
        )
        new_id = cursor.fetchone()['id']
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def update_operator(operator_id: int, **kwargs) -> bool:
    """Update operator fields. Accepted kwargs: display_name, email, team,
    app_ids, max_concurrent, shift_schedule, status, is_active, password_hash."""
    allowed = {'display_name', 'email', 'team', 'app_ids', 'max_concurrent',
               'shift_schedule', 'status', 'is_active', 'password_hash'}
    updates = {k: v for k, v in kwargs.items() if k in allowed}
    if not updates:
        return False
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        set_parts = []
        params = []
        for col, val in updates.items():
            set_parts.append(f"{col} = %s")
            if col == 'shift_schedule' and isinstance(val, dict):
                params.append(json.dumps(val))
            else:
                params.append(val)
        params.append(operator_id)
        cursor.execute(
            f"UPDATE operators SET {', '.join(set_parts)} WHERE id = %s",
            params
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        _release_connection(conn)


def update_operator_last_seen(operator_id: int, status: str = None) -> bool:
    """Touch last_seen timestamp; optionally update status."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        if status:
            cursor.execute(
                "UPDATE operators SET last_seen = %s, status = %s WHERE id = %s",
                (datetime.now(), status, operator_id)
            )
        else:
            cursor.execute(
                "UPDATE operators SET last_seen = %s WHERE id = %s",
                (datetime.now(), operator_id)
            )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        _release_connection(conn)


def get_operator_current_load(operator_id: int) -> int:
    """Return number of conversations currently assigned to operator."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT COUNT(*) FROM handoff_queue "
            "WHERE operator_id = %s AND status = 'assigned'",
            (operator_id,)
        )
        return cursor.fetchone()[0]
    finally:
        _release_connection(conn)


# =====================================================================
# HANDOFF — QUEUE CRUD
# =====================================================================

def get_available_operators(app_id: str = None) -> List[Dict]:
    """Return operators currently online and with free capacity.

    Applies shift-schedule check via Python (simpler than SQL JSONB parsing).
    """
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = (
            "SELECT o.id, o.display_name, o.team, o.app_ids, o.max_concurrent, "
            "o.shift_schedule, o.status, o.last_seen, "
            "(SELECT COUNT(*) FROM handoff_queue hq "
            " WHERE hq.operator_id = o.id AND hq.status = 'assigned') AS current_load "
            "FROM operators o "
            "WHERE o.is_active = TRUE "
            "AND o.last_seen > NOW() - INTERVAL '120 seconds' "
            "AND o.status NOT IN ('offline', 'away')"
        )
        params = []
        if app_id:
            # Empty app_ids array means the operator handles ALL apps (no restriction).
            # Only filter if the operator has explicitly listed specific apps.
            query += " AND (o.app_ids = '{}' OR %s = ANY(o.app_ids))"
            params.append(app_id)
        cursor.execute(query, params)
        rows = cursor.fetchall()

        eligible = []
        for row in rows:
            op = dict(row)
            # Skip if at capacity
            if op['current_load'] >= op['max_concurrent']:
                continue
            # Skip if outside shift schedule
            if op.get('shift_schedule') and not _is_within_shift(op['shift_schedule']):
                continue
            eligible.append(op)
        return eligible
    finally:
        _release_connection(conn)


def _is_within_shift(shift_schedule) -> bool:
    """Return True if current UTC time falls within the operator's configured shift."""
    import pytz
    from datetime import time as dtime
    try:
        if isinstance(shift_schedule, str):
            shift_schedule = json.loads(shift_schedule)
        tz_name = shift_schedule.get('timezone', 'UTC')
        tz = pytz.timezone(tz_name)
        now_local = datetime.now(tz)
        day_name = now_local.strftime('%A').lower()  # e.g. 'monday'
        hours_str = shift_schedule.get(day_name, '00:00-23:59')
        if hours_str.upper() == 'OFF':
            return False
        start_str, end_str = hours_str.split('-')
        start_h, start_m = map(int, start_str.split(':'))
        end_h, end_m = map(int, end_str.split(':'))
        current_time = now_local.time().replace(second=0, microsecond=0)
        return dtime(start_h, start_m) <= current_time <= dtime(end_h, end_m)
    except Exception:
        return True  # If schedule parse fails, assume available (safe default)


def enqueue_handoff(conversation_id: int, sender_id: str, app_id: str,
                    trigger_reason: str, trigger_detail: Dict = None,
                    priority: int = None, context_package: Dict = None,
                    target_team: str = None, required_skill: str = None) -> Optional[Dict]:
    """Create a new handoff queue entry. Returns the created row dict or None on error."""
    conn = _get_connection()
    try:
        cfg = get_handoff_runtime_config()
        if priority is None:
            priority = cfg['queue']['default_priority']

        cursor = conn.cursor(cursor_factory=RealDictCursor)

        # ── Duplicate prevention: return existing row if sender already active ──
        cursor.execute(
            "SELECT * FROM handoff_queue "
            "WHERE sender_id = %s AND status IN ('waiting', 'assigned') "
            "ORDER BY queued_at DESC LIMIT 1",
            (sender_id,)
        )
        existing = cursor.fetchone()
        if existing:
            return dict(existing)  # idempotent — caller gets back the live row

        # Check max queue depth
        cursor.execute(
            "SELECT COUNT(*) AS depth FROM handoff_queue WHERE app_id = %s AND status = 'waiting'",
            (app_id,)
        )
        current_depth = cursor.fetchone()['depth']
        if current_depth >= cfg['queue']['max_queue_depth']:
            return None  # Queue full

        cursor.execute(
            "INSERT INTO handoff_queue "
            "(conversation_id, sender_id, app_id, priority, trigger_reason, trigger_detail, "
            "target_team, required_skill, context_package) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
            (
                conversation_id, sender_id, app_id, priority, trigger_reason,
                json.dumps(trigger_detail) if trigger_detail else None,
                target_team, required_skill,
                json.dumps(context_package) if context_package else None
            )
        )
        row = dict(cursor.fetchone())

        # Update conversation handoff_state
        cursor.execute(
            "UPDATE conversations SET handoff_state = 'queued', handoff_count = handoff_count + 1 "
            "WHERE id = %s",
            (conversation_id,)
        )

        # Log state transition
        cursor.execute(
            "INSERT INTO handoff_state_log (conversation_id, from_state, to_state, triggered_by, note) "
            "VALUES (%s, 'bot_active', 'queued', %s, %s)",
            (conversation_id, trigger_reason, json.dumps(trigger_detail) if trigger_detail else None)
        )

        conn.commit()

        # Recalculate queue positions
        _recalculate_queue_positions(app_id)

        # Re-fetch with updated position
        cursor.execute("SELECT * FROM handoff_queue WHERE id = %s", (row['id'],))
        updated = cursor.fetchone()
        return dict(updated) if updated else row
    except Exception as e:
        print(f"Error enqueuing handoff: {e}")
        conn.rollback()
        return None
    finally:
        _release_connection(conn)


def _recalculate_queue_positions(app_id: str):
    """Recalculate queue_position for all waiting items in an app's queue."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id FROM handoff_queue "
            "WHERE app_id = %s AND status = 'waiting' "
            "ORDER BY priority DESC, queued_at ASC",
            (app_id,)
        )
        rows = cursor.fetchall()
        for pos, row in enumerate(rows, start=1):
            cursor.execute(
                "UPDATE handoff_queue SET queue_position = %s WHERE id = %s",
                (pos, row[0])
            )
        conn.commit()
    finally:
        _release_connection(conn)


def get_queue(app_id: str = None, team: str = None, status: str = 'waiting') -> List[Dict]:
    """Return queue items, optionally filtered by app_id, team, or status."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        query = (
            "SELECT hq.*, c.sender_id, c.user_name, c.user_id, c.low_conf_streak, c.frustration_score "
            "FROM handoff_queue hq "
            "JOIN conversations c ON c.id = hq.conversation_id "
            "WHERE 1=1"
        )
        params = []
        if status:
            query += " AND hq.status = %s"
            params.append(status)
        if app_id:
            query += " AND hq.app_id = %s"
            params.append(app_id)
        if team:
            query += " AND (hq.target_team = %s OR hq.target_team IS NULL)"
            params.append(team)
        query += " ORDER BY hq.priority DESC, hq.queued_at ASC"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        result = []
        for row in rows:
            item = dict(row)
            for ts_col in ('queued_at', 'assigned_at', 'resolved_at', 'abandoned_at'):
                if item.get(ts_col):
                    item[ts_col] = item[ts_col].isoformat()
            result.append(item)
        return result
    finally:
        _release_connection(conn)


def log_handoff_consent(sender_id: str, conversation_id: int,
                        consented: bool, ip_hash: str = None) -> int:
    """Write a GDPR consent record. Returns the new row ID."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "INSERT INTO handoff_consent_log (sender_id, conversation_id, consented, ip_hash) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            (sender_id, conversation_id, consented, ip_hash)
        )
        new_id = cursor.fetchone()['id']
        if consented:
            cursor.execute(
                "UPDATE conversations SET consent_given = TRUE WHERE id = %s",
                (conversation_id,)
            )
        conn.commit()
        return new_id
    finally:
        _release_connection(conn)


def end_conversation(conversation_id: int):
    """Mark a conversation as ended (set ended_at timestamp)."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            'UPDATE conversations SET ended_at = %s WHERE id = %s',
            (datetime.now(), conversation_id)
        )
        conn.commit()
    except Exception as e:
        print(f"Error ending conversation {conversation_id}: {e}")
        conn.rollback()
    finally:
        _release_connection(conn)


def get_operator_stats(operator_id: int) -> Dict:
    """Return performance statistics for one operator."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            "SELECT "
            "  COUNT(*) AS total_handled, "
            "  ROUND(AVG(handle_time_secs)) AS avg_handle_time_secs, "
            "  ROUND(AVG(wait_time_secs)) AS avg_wait_time_secs, "
            "  ROUND(AVG(agent_rating), 2) AS avg_context_rating, "
            "  COUNT(*) FILTER (WHERE return_to_bot = TRUE)  AS returned_to_bot, "
            "  COUNT(*) FILTER (WHERE return_to_bot = FALSE) AS closed_by_operator "
            "FROM handoff_queue "
            "WHERE operator_id = %s AND status = 'resolved'",
            (operator_id,)
        )
        row = cursor.fetchone()
        return dict(row) if row else {}
    finally:
        _release_connection(conn)
