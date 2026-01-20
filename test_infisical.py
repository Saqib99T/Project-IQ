"""
Test script to verify Infisical connection and secrets retrieval.
Run: python test_infisical.py
"""

import os
import sys

# Add project to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
    print("✓ Loaded .env file")
except ImportError:
    print("⚠ python-dotenv not installed, using system env vars")

# Check environment variables
print("\n--- Infisical Configuration ---")
print(f"Project ID: {os.environ.get('INFISICAL_PROJECT_ID', 'NOT SET')[:20]}...")
print(f"Client ID: {os.environ.get('INFISICAL_CLIENT_ID', 'NOT SET')[:20]}...")
print(f"Client Secret: {'SET (hidden)' if os.environ.get('INFISICAL_CLIENT_SECRET') else 'NOT SET'}")
print(f"Environment: {os.environ.get('INFISICAL_ENVIRONMENT', 'dev')}")

# Test Infisical connection
print("\n--- Testing Infisical Connection ---")
try:
    from actions.config_manager import get_glpi_config, get_db_config, is_using_infisical
    
    if is_using_infisical():
        print("✓ Connected to Infisical Cloud!")
        
        print("\n--- Retrieved Secrets ---")
        glpi = get_glpi_config()
        print(f"GLPI API URL: {glpi.get('api_url', 'NOT SET')}")
        print(f"GLPI App Token: {'SET (hidden)' if glpi.get('app_token') else 'NOT SET'}")
        print(f"GLPI User Token: {'SET (hidden)' if glpi.get('user_token') else 'NOT SET'}")
        
        db = get_db_config()
        print(f"DB Host: {db.get('host', 'NOT SET')}")
        print(f"DB Name: {db.get('database', 'NOT SET')}")
        print(f"DB User: {db.get('user', 'NOT SET')}")
        print(f"DB Password: {'SET (hidden)' if db.get('password') else 'NOT SET'}")
        
        print("\n✓ All secrets retrieved successfully!")
    else:
        print("⚠ Infisical not configured or unavailable, using local app.config")
        
except Exception as e:
    print(f"✗ Error: {e}")
    import traceback
    traceback.print_exc()
