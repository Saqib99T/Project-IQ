
import sys
import os
sys.path.append(os.getcwd())

try:
    from actions.actions import ActionGreet
    print("SUCCESS: ActionGreet is importable")
    obj = ActionGreet()
    print(f"Action Name: {obj.name()}")
except Exception as e:
    print(f"ERROR: {e}")
