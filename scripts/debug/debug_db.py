import psycopg2
from psycopg2.extras import RealDictCursor

conn = psycopg2.connect(host='localhost', port=5432, database='Chatbot', user='postgres', password='12345')
cur = conn.cursor(cursor_factory=RealDictCursor)

# Handoff queue
cur.execute('SELECT id, conversation_id, sender_id, status, operator_id FROM handoff_queue ORDER BY id DESC LIMIT 5')
print("=== HANDOFF QUEUE ===")
for r in cur.fetchall():
    print(dict(r))

# Conversations
cur.execute('SELECT id, sender_id, last_activity FROM conversations ORDER BY last_activity DESC LIMIT 5')
convs = cur.fetchall()
print("\n=== CONVERSATIONS ===")
for r in convs:
    print(dict(r))

# Messages for top 2 conversations
for c in convs[:2]:
    cid = c['id']
    cur.execute(
        "SELECT sender, substring(text,1,80) as txt, timestamp FROM messages "
        "WHERE conversation_id = %s ORDER BY timestamp ASC", (cid,)
    )
    msgs = cur.fetchall()
    print(f"\n=== MESSAGES conv_id={cid} (count={len(msgs)}) ===")
    for m in msgs:
        print(f"  [{m['sender']}] {m['txt']}")

# Operator messages for top 2 conversations
for c in convs[:2]:
    cid = c['id']
    cur.execute(
        "SELECT om.message_text, om.sent_at FROM operator_messages om "
        "WHERE om.conversation_id = %s ORDER BY om.sent_at ASC", (cid,)
    )
    msgs = cur.fetchall()
    print(f"\n=== OPERATOR_MESSAGES conv_id={cid} (count={len(msgs)}) ===")
    for m in msgs:
        print(f"  [operator] {m['message_text']}")

conn.close()
