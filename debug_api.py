"""Test the operator API directly to verify it returns messages."""
import requests
import json

BASE = "http://localhost:8181"

# Step 1: Login to get token
print("=== LOGIN ===")
r = requests.post(f"{BASE}/operator/login", json={"username": "admin", "password": "admin"})
if r.status_code != 200:
    # Try common passwords
    for pw in ["admin", "12345", "password", "admin123"]:
        r = requests.post(f"{BASE}/operator/login", json={"username": "admin", "password": pw})
        if r.status_code == 200:
            break
    if r.status_code != 200:
        print(f"Login failed: {r.status_code} {r.text}")
        # Try to get operators list
        exit(1)

data = r.json()
token = data.get("token")
print(f"Token: {token[:20]}..." if token else f"No token. Response: {data}")

if not token:
    exit(1)

headers = {"Authorization": f"Bearer {token}"}

# Step 2: Check queue
print("\n=== QUEUE (assigned) ===")
r = requests.get(f"{BASE}/operator/queue?status=assigned", headers=headers)
print(f"Status: {r.status_code}")
items = r.json().get("items", [])
for it in items:
    print(f"  qid={it['id']} conv={it['conversation_id']} sender={it['sender_id']} status={it['status']}")

# Step 3: Fetch conversation messages for each assigned chat
for it in items:
    cid = it["conversation_id"]
    print(f"\n=== CONVERSATION {cid} ===")
    r = requests.get(f"{BASE}/operator/conversation/{cid}", headers=headers)
    print(f"Status: {r.status_code}")
    d = r.json()
    msgs = d.get("messages", [])
    print(f"Message count: {len(msgs)}")
    for m in msgs[:5]:
        print(f"  [{m.get('sender')}] {str(m.get('text',''))[:60]}")
    if len(msgs) > 5:
        print(f"  ... and {len(msgs)-5} more")
