"""
Splits V1's monolithic actions.py into V2 domain-specific files.
Run from anywhere: python scripts/split_actions.py
"""
import ast, textwrap
from pathlib import Path

V1_FILE  = Path(r"D:\99T\Code\Project-IQ-V1\action_server\actions\actions.py")
V2_DIR   = Path(__file__).parent.parent / "action_server" / "actions"

# Domain → class name substrings (checked with 'in class_name')
DOMAIN_MAP = {
    "actions_glpi_auth": [
        "ActionGlpiLogin", "ActionInitGlpiSession",
    ],
    "actions_glpi_tickets": [
        "ActionCreateGlpiTicket", "ActionCheckGlpiStatus",
        "ActionUpdateGlpiTicket", "ActionVerifyGlpiResolution",
        "ActionDeactivateForm", "ActionViewTicketComments",
        "ActionListOpenTickets", "ActionUploadFile",
        "ActionListAttachments", "ActionShowTicketGraph",
        "ValidateTicketForm", "ActionCreateTicketFromForm",
    ],
    "actions_session": [
        "ActionClearSession", "ActionExtractContext",
        "ActionGdprConsent", "ActionConfirmGdprConsent", "ActionDenyGdprConsent",
    ],
    "actions_general": [
        "ActionGreet", "ActionShowChart",
        "ActionHandleMultiIntent", "ActionTrackConfidence",
    ],
    "actions_kb": [
        "ActionSearchKnowledgeBase", "ActionShowKbFullAnswer",
        "ActionShowKbFullArticle", "ActionSearchKbBeforeTicket",
    ],
    "actions_feedback": [
        "ActionSaveFeedback", "ActionSaveSatisfactionRating",
    ],
    "actions_handoff": [
        "ActionRequestHandoff", "ActionConfirmHandoff",
        "ActionCancelHandoff", "ActionResumeFromHandoff",
    ],
}

SHARED_IMPORTS = """\
import os, sys, logging, json, re, datetime, traceback
from typing import Text, List, Any, Dict, Optional

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from rasa_sdk import Action, Tracker
from rasa_sdk.events import SlotSet, AllSlotsReset, Restarted, ActiveLoop, UserUttered, FollowupAction
from rasa_sdk.forms import FormValidationAction
from rasa_sdk.executor import CollectingDispatcher
from action_server.actions.glpi_service import GlpiService
from common import analytics_store
from common.config_manager import get_glpi_config
from action_server.actions._shared import (
    get_glpi_service, get_glpi_base_url, log_bot_response,
    get_analytics_context, get_effective_session_token,
    check_user_login, glpi_service, logger,
)
"""

def get_class_line_ranges(source_lines: list[str], tree: ast.AST) -> dict:
    """Returns {class_name: (start_line, end_line)} — 0-indexed."""
    classes = [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]
    classes.sort(key=lambda c: c.lineno)
    ranges = {}
    for i, cls in enumerate(classes):
        start = cls.lineno - 1  # 0-indexed
        end   = classes[i + 1].lineno - 2 if i + 1 < len(classes) else len(source_lines) - 1
        # Trim trailing blank lines
        while end > start and not source_lines[end].strip():
            end -= 1
        ranges[cls.name] = (start, end)
    return ranges

def main():
    src = V1_FILE.read_text(encoding="utf-8")
    lines = src.splitlines(keepends=True)
    tree  = ast.parse(src)

    # Extract shared helpers (everything before the first class definition)
    first_class_line = min(
        n.lineno for n in ast.walk(tree) if isinstance(n, ast.ClassDef)
    )
    shared_body = "".join(lines[:first_class_line - 1])

    # Write _shared.py — helper functions and module-level vars
    shared_out = V2_DIR / "_shared.py"
    shared_out.write_text(
        "# Auto-generated shared helpers — do not import directly, use domain files.\n"
        + shared_body,
        encoding="utf-8"
    )
    print(f"  wrote {shared_out.name}")

    ranges = get_class_line_ranges(lines, tree)

    # Build reverse map: class_name → domain
    class_to_domain = {}
    for domain, names in DOMAIN_MAP.items():
        for name in names:
            class_to_domain[name] = domain

    # Group source blocks per domain
    domain_blocks: dict[str, list[str]] = {d: [] for d in DOMAIN_MAP}
    unmatched = []
    for cls_name, (start, end) in ranges.items():
        domain = class_to_domain.get(cls_name)
        if domain:
            block = "".join(lines[start : end + 1]).rstrip() + "\n\n\n"
            domain_blocks[domain].append(block)
        else:
            unmatched.append(cls_name)

    if unmatched:
        print(f"  WARNING: unmapped classes (add to DOMAIN_MAP): {unmatched}")

    # Write each domain file
    for domain, blocks in domain_blocks.items():
        out_path = V2_DIR / f"{domain}.py"
        content  = SHARED_IMPORTS + "\n\n" + "".join(blocks)
        out_path.write_text(content, encoding="utf-8")
        print(f"  wrote {out_path.name}  ({len(blocks)} class(es))")

    print("\nDone. Action server should now start cleanly.")

if __name__ == "__main__":
    main()
