import asyncio
import os
import sys

# Add project root to path for cross-package imports
project_root = os.path.dirname(os.path.abspath(__file__))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from common.config_manager import get_glpi_config
from action_server.actions.glpi_service import GlpiService

async def test_login():
    config = get_glpi_config()
    print("Config used:", config)
    service = GlpiService(
        config['api_url'],
        config['app_token'],
        config['user_token']
    )
    
    username = "user-it"
    password = "password"
    
    print(f"\nAttempting login for '{username}'...")
    result = await service.login_with_credentials(username, password)
    print("\nResult:")
    print(result)

if __name__ == "__main__":
    asyncio.run(test_login())
