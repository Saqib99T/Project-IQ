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
            'database': 'ChatBot',
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
            maxconn=10,
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
        
        # Add app_id, user_id, ticket_id columns to existing tables (for migrations)
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
        
        conn.commit()
    finally:
        _release_connection(conn)


# Initialize database on module load
try:
    _init_database()
except Exception as e:
    print(f"Warning: Could not initialize database: {e}")


def log_conversation_start(sender_id: str, app_id: str = "General", user_id: str = None) -> int:
    """Log start of a new conversation. Returns conversation ID."""
    conn = _get_connection()
    try:
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Check if conversation exists
        cursor.execute('SELECT id FROM conversations WHERE sender_id = %s', (sender_id,))
        row = cursor.fetchone()
        
        if row:
            # Update last activity and user_id if provided
            if user_id:
                cursor.execute(
                    'UPDATE conversations SET last_activity = %s, user_id = %s WHERE sender_id = %s',
                    (datetime.now(), user_id, sender_id)
                )
            else:
                cursor.execute(
                    'UPDATE conversations SET last_activity = %s WHERE sender_id = %s',
                    (datetime.now(), sender_id)
                )
            conn.commit()
            return row['id']
        
        # Create new conversation with user_id
        cursor.execute(
            'INSERT INTO conversations (sender_id, app_id, user_id, started_at, last_activity) VALUES (%s, %s, %s, %s, %s) RETURNING id',
            (sender_id, app_id, user_id, datetime.now(), datetime.now())
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


def log_feedback(sender_id: str, feedback_type: str, app_id: str = "General", user_id: str = None, ticket_id: str = None):
    """Log user feedback (positive/negative) to PostgreSQL."""
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
        
        # Insert feedback with app_id, user_id, and ticket_id
        cursor.execute(
            'INSERT INTO feedback (conversation_id, type, app_id, user_id, ticket_id, timestamp) VALUES (%s, %s, %s, %s, %s, %s)',
            (conv_id, feedback_type, app_id, user_id, ticket_id, datetime.now())
        )
        
        # Mark as resolved if positive
        if feedback_type == 'positive':
            cursor.execute('UPDATE conversations SET resolved = 1 WHERE id = %s', (conv_id,))
        
        conn.commit()
        print(f"Feedback saved to PostgreSQL: {feedback_type} for sender {sender_id}")
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
