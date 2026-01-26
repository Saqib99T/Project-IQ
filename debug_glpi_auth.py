
import os
import sys
import asyncio

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from actions.config_manager import get_glpi_config
from actions.glpi_service import GlpiService

async def test_auth():
    print("--- 1. Testing Config Loading ---")
    try:
        config = get_glpi_config()
        print(f"GLPI URL: {config.get('api_url')}")
        print(f"App Token: {config.get('app_token')}")
        print(f"User Token: {'[MASKED]' if config.get('user_token') else 'None'}")
    except Exception as e:
        print(f"❌ Failed to load config: {e}")
        return

    print("\n--- 2. Testing GLPI Connection ---")
    service = GlpiService(
        config['api_url'],
        config['app_token'],
        config['user_token']
    )
    
    # Test Init Session
    try:
        session_token = await service.init_session()
        if session_token:
            print(f"✅ initSession success! Token: {session_token[:10]}...")
            await service.kill_session(session_token)
        else:
            print("❌ initSession failed (returned None). Check URL and App-Token.")
    except Exception as e:
        print(f"❌ initSession exception: {e}")

if __name__ == "__main__":
    asyncio.run(test_auth())
