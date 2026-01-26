
import os
import sys
import asyncio
import traceback

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from actions.config_manager import get_glpi_config
from actions.glpi_service import GlpiService

async def test_kb_loading():
    print("--- 1. Testing Config Loading ---")
    try:
        config = get_glpi_config()
        print(f"GLPI URL: {config.get('api_url')}")
        print(f"App Token: {config.get('app_token')}")
    except Exception as e:
        print(f"❌ Failed to load config: {e}")
        return

    print("\n--- 2. Testing GLPI KB Connection ---")
    service = GlpiService(
        config['api_url'],
        config['app_token'],
        config['user_token']
    )
    
    session_token = None
    try:
        print("Initializing session...")
        session_token = await service.init_session()
        if session_token:
            print(f"✅ initSession success! Token: {session_token[:10]}...")
            
            print("Fetching KB items...")
            items = await service.get_all_knowbase_items(session_token)
            
            print(f"✅ Retrieved {len(items)} KB items.")
            if len(items) > 0:
                print(f"Sample item: {items[0].get('name', 'Unknown')}")
            else:
                print("⚠️ No items returned but connection succeeded.")
                
        else:
            print("❌ initSession failed (returned None). Check URL and App-Token.")
            
    except Exception as e:
        print(f"❌ Exception during KB fetch: {e}")
        traceback.print_exc()
    finally:
        if session_token:
            await service.kill_session(session_token)
            print("Session killed.")

if __name__ == "__main__":
    asyncio.run(test_kb_loading())
