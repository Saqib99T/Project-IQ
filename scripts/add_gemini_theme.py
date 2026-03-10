import os
import sys
import json

# Add parent dir to path to import common
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from common.conversation_db import create_theme, get_themes, _get_connection, _release_connection

def set_all_themes_not_default():
    conn = _get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('UPDATE themes SET is_default = 0')
        conn.commit()
    finally:
        _release_connection(conn)

def main():
    gemini_theme = {
        "primaryColor": "#1a73e8",   # Classic Google blue
        "secondaryColor": "#8ab4f8",
        "bgColor": "#ffffff",
        "textColor": "#1f2937",
        "botIcon": "✨",
        "botIconColor": "transparent",
        "userIcon": "👤",
        "userIconColor": "#f0f4f9",
        "sendIcon": "🚀",
        "sendIconColor": "#1a73e8",
        "attachIcon": "📎",
        "headerFontSize": "16",
        "messageFontSize": "15",
        "buttonFontSize": "14",
        "inputFontSize": "15",
        "fontFamily": "'Google Sans', 'Inter', sans-serif",
        "borderRadius": "24"
    }
    
    settings_json = json.dumps(gemini_theme)
    
    # First, make all existing themes non-default
    print("Clearing existing default themes...")
    set_all_themes_not_default()
    
    print("Creating Gemini Elegance theme...")
    theme_id = create_theme("Gemini Elegance", settings_json, 1)
    print(f"Theme 'Gemini Elegance' created successfully with ID: {theme_id} and set as default.")

if __name__ == "__main__":
    main()
