
import sys
import os
import json

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.conversation_db import get_themes

def main():
    try:
        themes = get_themes()
        print(f"Total Themes: {len(themes)}")
        for t in themes:
            if t['id'] == 6:
                print(f"ID: {t['id']} | Name: {t['name']}")
                print(f"Settings: {t['settings']}")
    except Exception as e:
        print(f"Error fetching themes: {e}")

if __name__ == "__main__":
    main()
