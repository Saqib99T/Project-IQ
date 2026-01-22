#!/usr/bin/env python3
"""Check recent messages in database"""
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

# Check last 10 messages
cursor.execute("""
    SELECT timestamp, sender, LEFT(text, 60) as text_preview
    FROM messages
    ORDER BY timestamp DESC
    LIMIT 10
""")
messages = cursor.fetchall()

print("\nLast 10 messages:")
for timestamp, sender, text in messages:
    print(f"[{timestamp}] [{sender}] {text}")

cursor.close()
conn.close()
