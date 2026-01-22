from actions.conversation_db import get_app_list

def test_module():
    try:
        print("Attempting to call get_app_list()...")
        apps = get_app_list()
        print(f"Success! Found {len(apps)} apps: {apps}")
    except Exception as e:
        print(f"Error calling get_app_list(): {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_module()
