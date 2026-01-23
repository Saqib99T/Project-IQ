import requests
import time
import psycopg2
from datetime import datetime

DB_CONFIG = {
    'host': 'localhost',
    'port': 5432,
    'database': 'Chatbot',
    'user': 'postgres',
    'password': '12345'
}

def get_message_count():
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM messages")
        count = cursor.fetchone()[0]
        conn.close()
        return count
    except Exception as e:
        print(f"DB Error: {e}")
        return -1

def get_latest_messages(limit=5):
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cursor = conn.cursor()
        cursor.execute("SELECT sender, text, timestamp FROM messages ORDER BY id DESC LIMIT %s", (limit,))
        rows = cursor.fetchall()
        conn.close()
        return rows
    except Exception as e:
        print(f"DB Error: {e}")
        return []

def send_message(text):
    url = "http://localhost:5005/webhooks/rest/webhook"
    payload = {
        "sender": "test_verifier_user",
        "message": text
    }
    try:
        r = requests.post(url, json=payload)
        return r.json()
    except Exception as e:
        print(f"API Error: {e}")
        return []

def verify():
    print("--- Verifying Custom Tracker Store Logging ---")
    
    initial_count = get_message_count()
    print(f"Initial Message Count: {initial_count}")
    
    test_msg = f"Testing logging {datetime.now().timestamp()}"
    print(f"Sending message: '{test_msg}'")
    
    responses = send_message(test_msg)
    print(f"Bot Responses: {len(responses)}")
    
    # Wait a moment for async logging (though custom tracker store save is sync usually)
    time.sleep(2)
    
    final_count = get_message_count()
    print(f"Final Message Count: {final_count}")
    
    if final_count > initial_count:
        print("PASS: Message count increased.")
        
        # Check content
        latest = get_latest_messages(2)
        print("Latest DB Entries:")
        for l in latest:
            print(f" - {l[0]}: {l[1]}")
            
        found = False
        for l in latest:
            if l[1] == test_msg:
                found = True
        
        if found:
            print("PASS: Exact test message found in DB.")
        else:
            print("FAIL: Test message text not found in latest entries.")
    else:
        print("FAIL: Message count did not increase.")

if __name__ == "__main__":
    verify()
