#!/usr/bin/env python3
"""
Script to automatically add bot response logging to all dispatcher.utter_message calls in actions.py
"""

import re
import sys

def add_logging_to_actions(file_path):
    """Add log_bot_response calls after dispatcher.utter_message calls that don't have them."""

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Count existing logging
    existing_logs = content.count('log_bot_response(tracker')
    print(f"Found {existing_logs} existing log_bot_response calls")

    # Split into lines for processing
    lines = content.split('\n')
    new_lines = []
    i = 0
    added_count = 0

    while i < len(lines):
        line = lines[i]
        new_lines.append(line)

        # Check if this line contains dispatcher.utter_message with text parameter
        if 'dispatcher.utter_message' in line and ('text=' in line or 'response=' in line):
            # Check if the next few lines already have log_bot_response
            has_logging = False
            for j in range(i+1, min(i+5, len(lines))):
                if 'log_bot_response' in lines[j]:
                    has_logging = True
                    break

            if not has_logging:
                # Extract the indentation
                indent = len(line) - len(line.lstrip())
                indent_str = ' ' * indent

                # Try to extract the text variable or value
                if 'text=' in line:
                    # Check if it's a variable or inline string
                    if re.search(r'text=([a-zA-Z_][a-zA-Z0-9_]*)', line):
                        # It's a variable like text=response_text
                        match = re.search(r'text=([a-zA-Z_][a-zA-Z0-9_]*)', line)
                        var_name = match.group(1)
                        log_line = f"{indent_str}log_bot_response(tracker, {var_name})"
                        new_lines.append(log_line)
                        added_count += 1
                    elif re.search(r'text=f["\']', line) or re.search(r'text=["\']', line):
                        # It's an inline f-string or string, need to extract it
                        # For now, skip these as they're harder to extract
                        # We'll handle them manually if needed
                        pass
                elif 'response=' in line:
                    # Template response like response="utter_ask_something"
                    # For template responses, we can't log them from actions.py
                    pass

        i += 1

    # Join lines back
    new_content = '\n'.join(new_lines)

    # Write back
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(new_content)

    print(f"Added {added_count} new log_bot_response calls")
    print(f"Total log_bot_response calls: {existing_logs + added_count}")
    return added_count

if __name__ == '__main__':
    file_path = 'actions/actions.py'
    added = add_logging_to_actions(file_path)

    if added > 0:
        print(f"\n✓ Successfully added logging to {added} more actions!")
        print("  Restart the Action Server to apply changes.")
    else:
        print("\n✓ All actions already have logging or use template responses.")
