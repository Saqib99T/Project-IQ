
import os
import sys
import logging

# Add current dir to path so we can import actions
sys.path.append(os.getcwd())

from actions.glpi_service import GlpiService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GLPI_API_URI = "http://localhost:8083/apirest.php"
GLPI_USER_TOKEN = "BHht1jncO8wZEi6MDLtqinFU13jIPgXHu4VxpUwq"
GLPI_APP_TOKEN = "c2xAtAzqKzx5YXcleWDqB6rAirV5yoUIRsbxR9Dv"

def test_glpi():
    print("--- Starting GLPI Service Test ---")
    service = GlpiService(GLPI_API_URI, GLPI_APP_TOKEN, GLPI_USER_TOKEN)
    
    print("1. Initializing Session...")
    token = service.init_session()
    
    if not token:
        print("❌ Failed to init session.")
        return

    print(f"✅ Session Token: {token}")
    
    print("2. Getting Ticket 9...")
    ticket = service.get_ticket(token, 9)
    if ticket:
        print(f"✅ Ticket Found: {ticket.get('name')}")
    else:
        print("❌ Ticket 9 not found.")
        
    print("3. Killing Session...")
    service.kill_session(token)
    print("✅ Done.")

if __name__ == "__main__":
    test_glpi()
