
import requests
import json

def debug_nlu(text):
    url = "http://localhost:5005/model/parse"
    payload = {"text": text}
    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        print(json.dumps(data, indent=2))
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    debug_nlu("List of attachments 17")
