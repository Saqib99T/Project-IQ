#!/usr/bin/env python3
"""Check recent messages in database with safe encoding"""
import psycopg2
import sys
sys.path.insert(0, 'actions')
from config_manager import get_db_config

db_config = get_db_config()
conn = psycopg2.connect(**db_config)
cursor = conn.cursor()

# Check total counts
cursor.execute("SELECT sender, COUNT(*) FROM messages GROUP BY sender ORDER BY sender")
counts = cursor.fetchall()
print("\nTotal message counts by sender:")
for sender, count in counts:
    print(f"  {sender}: {count}")

# Check last 15 messages with safe text preview
cursor.execute("""
    SELECT timestamp, sender, LEFT(text, 80) as text_preview
    FROM messages
    ORDER BY timestamp DESC
    LIMIT 15
""")
messages = cursor.fetchall()

print("\nLast 15 messages:")
for timestamp, sender, text in messages:
    # Safe encoding for Windows console
    safe_text = text.encode('ascii', 'replace').decode('ascii')
    print(f"[{timestamp}] [{sender}] {safe_text}")

cursor.close()
conn.close()
