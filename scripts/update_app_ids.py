"""
Script to update existing database records with app_id values.
Distributes existing data across IT, Accounting, HR, General.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from actions.conversation_db import _get_connection, _release_connection

def update_existing_data():
    """Update existing records with distributed app_id values."""
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        
        # Get ALL conversations to redistribute
        cursor.execute("SELECT id FROM conversations ORDER BY id")
        rows = cursor.fetchall()
        
        if not rows:
            print("No conversations found in database.")
            return
        
        app_ids = ['IT', 'Accounting', 'HR', 'General']
        
        # Distribute conversations evenly across app_ids
        for i, row in enumerate(rows):
            conv_id = row[0]
            app_id = app_ids[i % len(app_ids)]
            
            # Update conversation
            cursor.execute("UPDATE conversations SET app_id = %s WHERE id = %s", (app_id, conv_id))
            
            # Update related messages
            cursor.execute("UPDATE messages SET app_id = %s WHERE conversation_id = %s", (app_id, conv_id))
            
            # Update related feedback
            cursor.execute("UPDATE feedback SET app_id = %s WHERE conversation_id = %s", (app_id, conv_id))
            
            # Update related actions
            cursor.execute("UPDATE actions SET app_id = %s WHERE conversation_id = %s", (app_id, conv_id))
            
            print(f"Updated conversation {conv_id} -> {app_id}")
        
        conn.commit()
        print(f"\n✅ Updated {len(rows)} conversations with app_id values")
        
        # Show distribution
        cursor.execute("SELECT app_id, COUNT(*) as count FROM conversations GROUP BY app_id ORDER BY app_id")
        print("\nApp ID Distribution:")
        for row in cursor.fetchall():
            print(f"  {row[0]}: {row[1]} conversations")
            
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
    finally:
        _release_connection(conn)

if __name__ == "__main__":
    update_existing_data()
