
import requests
import json
import sys

BASE_URL = "http://localhost:80"

def test_files():
    print(f"Testing {BASE_URL}/admin/studio/files...")
    try:
        res = requests.get(f"{BASE_URL}/admin/studio/files")
        if res.status_code == 200:
            data = res.json()
            if data['success']:
                print(f"✅ Success: Found {len(data['files'])} files.")
                return data['files']
            else:
                print(f"❌ API Error: {data.get('error')}")
        else:
            print(f"❌ HTTP Error: {res.status_code}")
    except Exception as e:
        print(f"❌ Connection Failed: {e}")
    return []

def test_read_file(filename):
    print(f"\nTesting Read {filename}...")
    try:
        res = requests.get(f"{BASE_URL}/admin/studio/file", params={"file": filename})
        if res.status_code == 200:
            data = res.json()
            if data['success']:
                print(f"✅ Success: Read {len(data['content'])} bytes.")
                return True
            else:
                print(f"❌ API Error: {data.get('error')}")
        else:
            print(f"❌ HTTP Error: {res.status_code}")
    except Exception as e:
        print(f"❌ Connection Failed: {e}")
    return False

def test_train_status():
    print(f"\nTesting Training Status...")
    try:
        res = requests.get(f"{BASE_URL}/admin/studio/train/status")
        if res.status_code == 200:
            data = res.json()
            if data['success']:
                status = data['status']
                print(f"✅ Success: Training={'Yes' if status['is_training'] else 'No'}")
                return True
            else:
                print(f"❌ API Error: {data.get('error')}")
        else:
            print(f"❌ HTTP Error: {res.status_code}")
    except Exception as e:
        print(f"❌ Connection Failed: {e}")
    return False

if __name__ == "__main__":
    files = test_files()
    if files:
        first_file = files[0]['name']
        test_read_file(first_file)
    test_train_status()
