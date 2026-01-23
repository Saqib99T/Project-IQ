print("Importing custom_tracker_store...")
try:
    import custom_tracker_store
    print("Success: custom_tracker_store imported.")
    print("Classes:", dir(custom_tracker_store))
except Exception as e:
    print(f"FAIL: {e}")
    import traceback
    traceback.print_exc()
