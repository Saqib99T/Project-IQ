
import sys
import os
import logging

# Add actions directory to path so we can import modules
sys.path.append(os.path.join(os.getcwd(), 'actions'))

from config_manager import get_glpi_config
from glpi_service import GlpiService

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_list_attachments(ticket_id):
    print(f"Testing list attachments for Ticket ID: {ticket_id}")
    
    try:
        config = get_glpi_config()
        print(f"Using API URL: {config['api_url']}")
        
        service = GlpiService(
            config['api_url'],
            config['app_token'],
            config['user_token']
        )
        
        # 1. Login
        print("Logging in...")
        session_token = service.init_session()
        if not session_token:
            print("Failed to initialize session.")
            return

        print(f"Session Token: {session_token}")
        
        # 2. Get Ticket Documents
        print(f"Fetching documents for ticket {ticket_id}...")
        docs = service.get_ticket_documents(session_token, ticket_id)
        
        print(f"Result: {docs}")
        
        if not docs:
            print("No documents found.")
        else:
            print(f"Found {len(docs)} documents:")
            for d in docs:
                print(f" - ID: {d.get('id')}, Name: {d.get('name')}, File: {d.get('filename')}")
                
        # 3. Kill Session
        service.kill_session(session_token)
        print("Session killed.")

    except Exception as e:
        print(f"An error occurred: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_list_attachments(17)
