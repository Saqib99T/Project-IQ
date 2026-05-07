import os
import glob

def rebrand_files():
    base_dirs = [
        'd:/99T/Rasa/Project-IQ/admin/ui/public',
        'd:/99T/Rasa/Project-IQ/admin/ui/src'
    ]
    
    # Text rules (from -> to) designed to avoid breaking backend identifiers
    replacements = {
        'Rasa Studio': 'Project IQ Studio',
        'GLPI Support Portal': 'Project IQ Support',
        'GLPI Support Team': 'Project IQ Team',
        'GLPI Chat Widget': 'Project IQ Widget',
        'GLPI Widget Integration Test': 'Project IQ Widget Integration Test',
        'GLPI Bot Widget': 'Project IQ Bot Widget',
        ' GLPI Chatbot': ' Project IQ Chatbot',
        '>Rasa<': '>NLP Core Engine<',
        '📋 GLPI ID:': '📋 Ticket ID:',
        'GLPI #': 'Ticket #'
    }
    
    extensions = ['*.html', '*.js', '*.jsx']
    modified_count = 0
    
    for base_dir in base_dirs:
        for ext in extensions:
            for filepath in glob.glob(os.path.join(base_dir, '**', ext), recursive=True):
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                original_content = content
                for old_val, new_val in replacements.items():
                    content = content.replace(old_val, new_val)
                
                if original_content != content:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(content)
                    modified_count += 1
                    print(f"Branded: {filepath}")
                    
    print(f"Total files rebranded: {modified_count}")

if __name__ == '__main__':
    rebrand_files()
