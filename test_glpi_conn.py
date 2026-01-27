
import requests
import json
import asyncio
from actions.config_manager import get_glpi_config

async def test_conn():
    config = get_glpi_config()
    print(f"Testing GLPI URL: {config['api_url']}")
    
    headers = {
        'App-Token': config['app_token'],
        'Content-Type': 'application/json'
    }
    
    url = f"{config['api_url']}/initSession"
    try:
        # User Token Auth (for system level)
        if config['user_token']:
            headers['Authorization'] = f"user_token {config['user_token']}"
            
        print(f"Sending request to {url}...")
        res = requests.get(url, headers=headers, timeout=5)
        
        print(f"Status Code: {res.status_code}")
        try:
            print(f"Response: {res.json()}")
        except:
            print(f"Response Text: {res.text}")
            
        if res.status_code == 200:
            print("✅ GLPI Connection Successful!")
        else:
            print("❌ GLPI Connection Failed")
            
    except Exception as e:
        print(f"❌ Exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_conn())
