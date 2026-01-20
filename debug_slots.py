
import yaml
import os

def load_yaml(path):
    with open(path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

domain = load_yaml('domain.yml')
domain_slots = set(domain.get('slots', {}).keys())

print(f"Domain slots: {sorted(list(domain_slots))}")

def check_file(path):
    print(f"Checking {path}...")
    data = load_yaml(path)
    if not data: return
    
    items = data.get('stories', []) + data.get('rules', [])
    
    for item in items:
        steps = item.get('steps', [])
        for step in steps:
            if 'slot_was_set' in step:
                slots = step['slot_was_set']
                if isinstance(slots, list):
                    for s in slots:
                        if isinstance(s, dict):
                            for k in s.keys():
                                if k not in domain_slots:
                                    print(f"ERROR: Slot '{k}' found in {path} but NOT in domain.")
                        elif isinstance(s, str):
                            if s not in domain_slots:
                                print(f"ERROR: Slot '{s}' found in {path} but NOT in domain.")
                elif isinstance(slots, dict):
                     for k in slots.keys():
                        if k not in domain_slots:
                            print(f"ERROR: Slot '{k}' found in {path} but NOT in domain.")

if os.path.exists('data/stories.yml'):
    check_file('data/stories.yml')

if os.path.exists('data/rules.yml'):
    check_file('data/rules.yml')
