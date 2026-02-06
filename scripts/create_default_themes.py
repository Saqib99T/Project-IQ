"""
Script to create 8 default themes for the Admin Dashboard
"""
import sys
import os
import json

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from common.conversation_db import create_theme, get_themes

# Define 8 distinct themes
DEFAULT_THEMES = [
    {
        "name": "Ocean Blue",
        "settings": {
            "primaryColor": "#0077B6",
            "secondaryColor": "#00B4D8",
            "bgColor": "#ffffff",
            "textColor": "#1f2937",
            "fontFamily": "Inter",
            "borderRadius": "12"
        },
        "is_default": True
    },
    {
        "name": "Forest Green",
        "settings": {
            "primaryColor": "#2D6A4F",
            "secondaryColor": "#40916C",
            "bgColor": "#ffffff",
            "textColor": "#1f2937",
            "fontFamily": "Inter",
            "borderRadius": "12"
        },
        "is_default": False
    },
    {
        "name": "Sunset Orange",
        "settings": {
            "primaryColor": "#E85D04",
            "secondaryColor": "#F48C06",
            "bgColor": "#ffffff",
            "textColor": "#1f2937",
            "fontFamily": "Inter",
            "borderRadius": "12"
        },
        "is_default": False
    },
    {
        "name": "Royal Purple",
        "settings": {
            "primaryColor": "#7B2CBF",
            "secondaryColor": "#9D4EDD",
            "bgColor": "#ffffff",
            "textColor": "#1f2937",
            "fontFamily": "Inter",
            "borderRadius": "12"
        },
        "is_default": False
    },
    {
        "name": "Corporate Blue",
        "settings": {
            "primaryColor": "#1E3A8A",
            "secondaryColor": "#3B82F6",
            "bgColor": "#ffffff",
            "textColor": "#1f2937",
            "fontFamily": "Inter",
            "borderRadius": "8"
        },
        "is_default": False
    },
    {
        "name": "Modern Dark",
        "settings": {
            "primaryColor": "#6366F1",
            "secondaryColor": "#8B5CF6",
            "bgColor": "#1f2937",
            "textColor": "#f9fafb",
            "fontFamily": "Inter",
            "borderRadius": "16"
        },
        "is_default": False
    },
    {
        "name": "Rose Pink",
        "settings": {
            "primaryColor": "#DB2777",
            "secondaryColor": "#EC4899",
            "bgColor": "#ffffff",
            "textColor": "#1f2937",
            "fontFamily": "Inter",
            "borderRadius": "12"
        },
        "is_default": False
    },
    {
        "name": "Teal Fresh",
        "settings": {
            "primaryColor": "#0D9488",
            "secondaryColor": "#14B8A6",
            "bgColor": "#ffffff",
            "textColor": "#1f2937",
            "fontFamily": "Inter",
            "borderRadius": "12"
        },
        "is_default": False
    }
]

def main():
    # Check existing themes
    existing = get_themes()
    existing_names = [t['name'] for t in existing]
    
    print(f"Found {len(existing)} existing themes: {existing_names}")
    
    created = 0
    for theme in DEFAULT_THEMES:
        if theme['name'] not in existing_names:
            theme_id = create_theme(
                theme['name'],
                json.dumps(theme['settings']),
                theme['is_default']
            )
            print(f"Created theme '{theme['name']}' with ID: {theme_id}")
            created += 1
        else:
            print(f"Theme '{theme['name']}' already exists, skipping")
    
    print(f"\nDone! Created {created} new themes.")
    
    # Show all themes
    all_themes = get_themes()
    print(f"\nAll themes ({len(all_themes)}):")
    for t in all_themes:
        default_marker = " [DEFAULT]" if t.get('is_default') else ""
        print(f"  - {t['name']}{default_marker}")

if __name__ == "__main__":
    main()
