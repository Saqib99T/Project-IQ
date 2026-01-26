
import os
import sys
import psycopg2
from psycopg2 import pool

# Add parent directory to path to find config_manager
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from actions.config_manager import get_db_config
    db_config = get_db_config()
except ImportError:
    print("Warning: Could not import config_manager, using default credentials")
    db_config = {
        'host': 'localhost',
        'port': 5432,
        'database': 'Chatbot',
        'user': 'postgres',
        'password': '12345'
    }

def apply_indexes():
    print(f"Connecting to database {db_config['database']} at {db_config['host']}...")
    try:
        conn = psycopg2.connect(**db_config)
        conn.autocommit = True
        cursor = conn.cursor()
        
        indexes = [
            ("idx_conv_ticket", "CREATE INDEX IF NOT EXISTS idx_conv_ticket ON conversations(ticket_id)"),
            ("idx_conv_user", "CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id)"),
            ("idx_actions_conv_name", "CREATE INDEX IF NOT EXISTS idx_actions_conv_name ON actions(conversation_id, action_name)"),
            ("idx_feedback_conv", "CREATE INDEX IF NOT EXISTS idx_feedback_conv ON feedback(conversation_id)"),
            ("idx_msg_ticket", "CREATE INDEX IF NOT EXISTS idx_msg_ticket ON messages(ticket_id)")
        ]
        
        print("Applying indexes...")
        for name, sql in indexes:
            print(f"Creating index {name}...")
            cursor.execute(sql)
            print(f"Index {name} applied.")
            
        print("✅ All indexes applied successfully.")
        
    except Exception as e:
        print(f"❌ Error applying indexes: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()

if __name__ == "__main__":
    apply_indexes()
