
import asyncio
import sys
import os

# Add current directory to path
sys.path.append(os.getcwd())

from actions.config_manager import get_glpi_config
from actions.glpi_service import GlpiService

async def test_login():
    config = get_glpi_config()
    print(f"Testing Login on: {config['api_url']}")
    
    service = GlpiService(
        config['api_url'],
        config['app_token'],
        config['user_token']
    )
    
    username = "glpi" 
    password = "123" # Intentional wrong password first? Or try standard glpi? 
                    # If user is using a specific one, I don't know it. 
                    # But if they are admin, maybe 'glpi'/'glpi'?
    if len(sys.argv) > 2:
        username = sys.argv[1]
        password = sys.argv[2]
    
    print(f"Attempting login for user: {username}")
    
    result = await service.login_with_credentials(username, password)
    
    if result['success']:
        print("✅ Login SUCCESS!")
        print(f"Session Token: {result['session_token']}")
        print(f"User: {result['user_firstname']} {result['user_name']}")
    else:
        print("❌ Login FAILED")
        print(f"Error: {result['error']}")

if __name__ == "__main__":
    if sys.platform == 'win32':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(test_login())
