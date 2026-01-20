"""
SQLite to PostgreSQL Data Migration Script
Migrates all data from SQLite chatbot.db to PostgreSQL ChatBot database.
"""

import sqlite3
import psycopg2
from psycopg2.extras import RealDictCursor
from pathlib import Path

# SQLite source
SQLITE_PATH = Path(__file__).parent.parent / "data" / "chatbot.db"

# PostgreSQL target
PG_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'ChatBot',
    'user': 'postgres',
    'password': '12345'
}


def migrate_data():
    """Migrate all data from SQLite to PostgreSQL."""
    
    if not SQLITE_PATH.exists():
        print(f"SQLite database not found at {SQLITE_PATH}")
        print("Nothing to migrate.")
        return
    
    # Connect to SQLite
    sqlite_conn = sqlite3.connect(str(SQLITE_PATH))
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cursor = sqlite_conn.cursor()
    
    # Connect to PostgreSQL
    pg_conn = psycopg2.connect(**PG_CONFIG)
    pg_cursor = pg_conn.cursor()
    
    try:
        # Create tables in PostgreSQL (if not exist)
        print("Creating PostgreSQL tables...")
        
        pg_cursor.execute('''
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                sender_id TEXT UNIQUE NOT NULL,
                app_id TEXT DEFAULT 'General',
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved INTEGER DEFAULT 0
            )
        ''')
        
        pg_cursor.execute('''
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
        
        pg_cursor.execute('''
            CREATE TABLE IF NOT EXISTS feedback (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        ''')
        
        pg_cursor.execute('''
            CREATE TABLE IF NOT EXISTS actions (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER NOT NULL,
                action_name TEXT NOT NULL,
                success INTEGER DEFAULT 1,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        ''')
        
        pg_cursor.execute('''
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        pg_cursor.execute('''
            CREATE TABLE IF NOT EXISTS themes (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                settings TEXT,
                is_default INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        pg_cursor.execute('CREATE INDEX IF NOT EXISTS idx_conv_sender ON conversations(sender_id)')
        pg_cursor.execute('CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id)')
        pg_cursor.execute('CREATE INDEX IF NOT EXISTS idx_msg_intent ON messages(intent)')
        
        pg_conn.commit()
        print("Tables created successfully!")
        
        # Track ID mappings (SQLite ID -> PostgreSQL ID)
        conversation_id_map = {}
        
        # Migrate conversations
        print("\nMigrating conversations...")
        sqlite_cursor.execute('SELECT * FROM conversations ORDER BY id')
        rows = sqlite_cursor.fetchall()
        for row in rows:
            pg_cursor.execute('''
                INSERT INTO conversations (sender_id, app_id, started_at, last_activity, resolved)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (sender_id) DO UPDATE SET last_activity = EXCLUDED.last_activity
                RETURNING id
            ''', (row['sender_id'], row['app_id'], row['started_at'], row['last_activity'], row['resolved']))
            new_id = pg_cursor.fetchone()[0]
            conversation_id_map[row['id']] = new_id
        print(f"  Migrated {len(rows)} conversations")
        
        # Migrate messages
        print("Migrating messages...")
        sqlite_cursor.execute('SELECT * FROM messages ORDER BY id')
        rows = sqlite_cursor.fetchall()
        migrated_messages = 0
        for row in rows:
            old_conv_id = row['conversation_id']
            if old_conv_id in conversation_id_map:
                pg_cursor.execute('''
                    INSERT INTO messages (conversation_id, sender, text, intent, timestamp)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (conversation_id_map[old_conv_id], row['sender'], row['text'], row['intent'], row['timestamp']))
                migrated_messages += 1
        print(f"  Migrated {migrated_messages} messages")
        
        # Migrate feedback
        print("Migrating feedback...")
        sqlite_cursor.execute('SELECT * FROM feedback ORDER BY id')
        rows = sqlite_cursor.fetchall()
        migrated_feedback = 0
        for row in rows:
            old_conv_id = row['conversation_id']
            if old_conv_id in conversation_id_map:
                pg_cursor.execute('''
                    INSERT INTO feedback (conversation_id, type, timestamp)
                    VALUES (%s, %s, %s)
                ''', (conversation_id_map[old_conv_id], row['type'], row['timestamp']))
                migrated_feedback += 1
        print(f"  Migrated {migrated_feedback} feedback entries")
        
        # Migrate actions
        print("Migrating actions...")
        sqlite_cursor.execute('SELECT * FROM actions ORDER BY id')
        rows = sqlite_cursor.fetchall()
        migrated_actions = 0
        for row in rows:
            old_conv_id = row['conversation_id']
            if old_conv_id in conversation_id_map:
                pg_cursor.execute('''
                    INSERT INTO actions (conversation_id, action_name, success, timestamp)
                    VALUES (%s, %s, %s, %s)
                ''', (conversation_id_map[old_conv_id], row['action_name'], row['success'], row['timestamp']))
                migrated_actions += 1
        print(f"  Migrated {migrated_actions} actions")
        
        # Migrate config
        print("Migrating config...")
        sqlite_cursor.execute('SELECT * FROM config')
        rows = sqlite_cursor.fetchall()
        for row in rows:
            pg_cursor.execute('''
                INSERT INTO config (key, value, updated_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
            ''', (row['key'], row['value'], row['updated_at']))
        print(f"  Migrated {len(rows)} config entries")
        
        # Migrate themes
        print("Migrating themes...")
        sqlite_cursor.execute('SELECT * FROM themes ORDER BY id')
        rows = sqlite_cursor.fetchall()
        for row in rows:
            pg_cursor.execute('''
                INSERT INTO themes (name, settings, is_default, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s)
            ''', (row['name'], row['settings'], row['is_default'], row['created_at'], row['updated_at']))
        print(f"  Migrated {len(rows)} themes")
        
        # Commit all changes
        pg_conn.commit()
        
        # Verify migration
        print("\n" + "="*50)
        print("MIGRATION SUMMARY")
        print("="*50)
        
        tables = ['conversations', 'messages', 'feedback', 'actions', 'config', 'themes']
        for table in tables:
            sqlite_cursor.execute(f'SELECT COUNT(*) as count FROM {table}')
            sqlite_count = sqlite_cursor.fetchone()['count']
            
            pg_cursor.execute(f'SELECT COUNT(*) as count FROM {table}')
            pg_count = pg_cursor.fetchone()[0]
            
            status = "✓" if sqlite_count == pg_count else "⚠"
            print(f"{status} {table}: SQLite={sqlite_count}, PostgreSQL={pg_count}")
        
        print("\n✅ Migration completed successfully!")
        
    except Exception as e:
        pg_conn.rollback()
        print(f"\n❌ Migration failed: {e}")
        raise
    finally:
        sqlite_conn.close()
        pg_conn.close()


if __name__ == '__main__':
    migrate_data()
