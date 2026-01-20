import requests
import time
import uuid

RASA_URL = "http://localhost:5005/webhooks/rest/webhook"
SENDER = str(uuid.uuid4())

def send(message):
    print(f"User: {message}")
    try:
        r = requests.post(RASA_URL, json={"sender": SENDER, "message": message}, timeout=10)
        r.raise_for_status()
        responses = r.json()
        if not responses:
            print("Bot: [No response]")
        for response in responses:
            print(f"Bot: {response.get('text')}")
    except Exception as e:
        print(f"Error: {e}")

print(f"Starting conversation with ID: {SENDER}")
send("hi")
time.sleep(1)
send("list open tickets")
time.sleep(1)
send("I want to create a ticket")
time.sleep(1)
send("Hardware")
time.sleep(1)
send("High")
