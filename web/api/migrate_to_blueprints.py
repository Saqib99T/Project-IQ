"""
One-time migration script: removes all @app.route decorators from admin_api.py
and activates the blueprint registration.

Run from the project root:
    python admin/api/migrate_to_blueprints.py [--dry-run]
"""
import re
import sys
import shutil
from pathlib import Path

DRY_RUN = '--dry-run' in sys.argv

ADMIN_API = Path(__file__).parent / 'web_api.py'
BACKUP    = ADMIN_API.with_suffix('.py.pre_blueprint_backup')

# The commented-out block to activate (exact text in admin_api.py)
ACTIVATION_COMMENT = "# from web.api.blueprints.register import register_blueprints\n# register_blueprints(app)"
ACTIVATION_CODE    = "from web.api.blueprints.register import register_blueprints\nregister_blueprints(app)"


def migrate():
    src = ADMIN_API.read_text(encoding='utf-8')
    lines = src.splitlines(keepends=True)

    # ── Step 1: remove @app.route(...) lines ─────────────────────────────────
    # These are one-line decorators: @app.route('...', ...)
    # Some span two lines with trailing arguments — handle continuation lines.
    removed = 0
    out_lines = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        if stripped.startswith('@app.route('):
            # Consume continuation lines (the decorator arg list spans multiple lines)
            full_decorator = line
            while ')' not in full_decorator.split('#')[0]:
                i += 1
                if i >= len(lines):
                    break
                full_decorator += lines[i]
            removed += 1
            print(f"  - removed: {line.rstrip()[:80]}")
            i += 1
            continue
        out_lines.append(line)
        i += 1

    # ── Step 2: activate blueprint registration ───────────────────────────────
    new_src = ''.join(out_lines)
    if ACTIVATION_COMMENT in new_src:
        new_src = new_src.replace(ACTIVATION_COMMENT, ACTIVATION_CODE, 1)
        print(f"\n  + activated: register_blueprints(app)")
    else:
        print("\n  ! activation comment not found — blueprint registration NOT added")
        print("    Add manually: register_blueprints(app)")

    print(f"\nRemoved {removed} @app.route decorators.")

    if DRY_RUN:
        print("\n[DRY RUN] No files written.")
        return

    # ── Write ─────────────────────────────────────────────────────────────────
    print(f"\nBacking up original to {BACKUP.name}")
    shutil.copy2(ADMIN_API, BACKUP)

    ADMIN_API.write_text(new_src, encoding='utf-8')
    print(f"Written: {ADMIN_API}")
    print("\nDone. Restart the admin server to activate blueprints.")
    print("If anything breaks: cp admin_api.py.pre_blueprint_backup admin_api.py")


if __name__ == '__main__':
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Migrating {ADMIN_API.name} to blueprints...\n")
    migrate()
