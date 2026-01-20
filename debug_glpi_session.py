
import requests
import json

# Configuration (from actions.py)
GLPI_API_URI = "http://localhost:8083/apirest.php"
GLPI_USER_TOKEN = "BHht1jncO8wZEi6MDLtqinFU13jIPgXHu4VxpUwq"
GLPI_APP_TOKEN = "c2xAtAzqKzx5YXcleWDqB6rAirV5yoUIRsbxR9Dv"

def debug_session():
    # 1. Init Session
    init_url = f"{GLPI_API_URI}/initSession"
    headers = {
        "App-Token": GLPI_APP_TOKEN,
        "Authorization": f"user_token {GLPI_USER_TOKEN}"
    }
    
    print(f"Connecting to {init_url}...")
    try:
        response = requests.get(init_url, headers=headers)
        response.raise_for_status()
        data = response.json()
        session_token = data.get("session_token")
        print(f"Session Token: {session_token}")
        
        # 2. Get Full Session Info (User Profile)
        # GLPI stores session data in /getMyProfiles or just inspecting the session
        # Let's try /initSession response first, it often has data.
        # If not, try /getMyProfiles
        
        headers_sess = {
            "App-Token": GLPI_APP_TOKEN,
            "Session-Token": session_token
        }
        
        # Get active profile
        # Usually fetching /Course or /User/me might confirm identity
        print("\nChecking Current User (/User/1 works usually if admin, or /getFullSession)...")
        
        # Try getFullSession
        sess_url = f"{GLPI_API_URI}/getFullSession"
        sess_resp = requests.get(sess_url, headers=headers_sess)
        
        if sess_resp.status_code == 200:
             sess_data = sess_resp.json()
             user_name = sess_data.get("session", {}).get("glpifriendlyname")
             profile = sess_data.get("session", {}).get("glpiprofile", {}).get("name")
             print(f"Logged In User: {user_name}")
             print(f"Active Profile: {profile}")
             print("Full Session Data keys:", sess_data.get("session", {}).keys())
        else:
             print("getFullSession failed. Trying alternate...")
             
        # Check specific profiles
        prof_url = f"{GLPI_API_URI}/getMyProfiles"
        prof_resp = requests.get(prof_url, headers=headers_sess)
        print(f"\nProfiles Status: {prof_resp.status_code}")
        print(json.dumps(prof_resp.json(), indent=2))

    except Exception as e:
        print(f"Error: {e}")
        try:
            print(response.text)
        except:
            pass

if __name__ == "__main__":
    debug_session()
