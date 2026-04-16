import json, time, base64, hmac, hashlib, requests

secret = 'handoff-local-dev-secret-change-in-prod'

# Build JWT for operator id=1
header = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
payload = {"sub":1,"username":"support-it","type":"operator","exp":int(time.time())+3600,"iat":int(time.time())}
body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{header}.{body}".encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
token = f"{header}.{body}.{sig}"

h = {"Authorization": f"Bearer {token}"}

# Test conversation 64
print("=== GET /operator/conversation/64 ===")
r = requests.get("http://localhost:8181/operator/conversation/64", headers=h)
d = r.json()
print(f"Status: {r.status_code}")
print(f"Count field: {d.get('count', 'N/A')}")
msgs = d.get("messages", [])
print(f"Messages array length: {len(msgs)}")
for m in msgs[:5]:
    sender = m.get("sender", "?")
    text = str(m.get("text", ""))[:70]
    print(f"  [{sender}] {text}")
if len(msgs) > 5:
    print(f"  ... +{len(msgs)-5} more")

# Test conversation 62
print("\n=== GET /operator/conversation/62 ===")
r2 = requests.get("http://localhost:8181/operator/conversation/62", headers=h)
d2 = r2.json()
print(f"Status: {r2.status_code}")
msgs2 = d2.get("messages", [])
print(f"Messages array length: {len(msgs2)}")
for m in msgs2[:5]:
    sender = m.get("sender", "?")
    text = str(m.get("text", ""))[:70]
    print(f"  [{sender}] {text}")
if len(msgs2) > 5:
    print(f"  ... +{len(msgs2)-5} more")

# Test queue
print("\n=== GET /operator/queue?status=assigned ===")
r3 = requests.get("http://localhost:8181/operator/queue?status=assigned", headers=h)
d3 = r3.json()
print(f"Status: {r3.status_code}")
items = d3.get("items", [])
for it in items:
    print(f"  qid={it['id']} conv={it['conversation_id']} sender={it['sender_id']}")
