
import requests
import sys
import os
import json

# Add actions to path
sys.path.append(os.path.join(os.getcwd(), 'actions'))
from config_manager import get_glpi_config
from glpi_service import GlpiService

def test_action_server(ticket_id="17"):
    # 1. Get Session Token
    config = get_glpi_config()
    service = GlpiService(config['api_url'], config['app_token'], config['user_token'])
    session_token = service.init_session()
    
    if not session_token:
        print("Failed to get session token")
        return

    print(f"Session Token: {session_token}")
    
    # 2. Call Action Server
    url = "http://localhost:5055/webhook"
    
    # Payload simulating Rasa Core request
    payload = {
        "next_action": "action_list_attachments",
        "sender_id": "debug_user",
        "tracker": {
            "sender_id": "debug_user",
            "slots": {
                "session_token": session_token,
                "ticket_id": ticket_id
            },
            "latest_message": {
                "text": "List of attachments 17",
                "intent": {"name": "list_attachments"},
                "entities": [{"entity": "ticket_id", "value": ticket_id}]
            }
        },
        "domain": {}
    }
    
    try:
        print("Calling Action Server...")
        response = requests.post(url, json=payload)
        response.raise_for_status()
        
        result = response.json()
        print(json.dumps(result, indent=2))
        
        # Check logs if we captured them (dispatcher responses)
        if 'responses' in result:
             print("Responses in Result:")
             for r in result['responses']:
                 print(r)
        
        # Check events
        if 'events' in result:
            print("Events:")
            for e in result['events']:
                print(e)
                
    except Exception as e:
        print(f"Action Server Error: {e}")
        if hasattr(e, 'response') and e.response:
             print(e.response.text)

    # Cleanup
    service.kill_session(session_token)

if __name__ == "__main__":
    test_action_server()
