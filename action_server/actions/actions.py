# actions.py — package entry point
# Rasa loads Action subclasses from this module.
# Implementations live in domain-specific files; re-exported here for discovery.

import os
import sys

project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from action_server.actions.actions_itsm_auth    import *  # noqa: F401,F403
from action_server.actions.actions_itsm_tickets import *  # noqa: F401,F403
from action_server.actions.actions_session      import *  # noqa: F401,F403
from action_server.actions.actions_general      import *  # noqa: F401,F403
from action_server.actions.actions_kb           import *  # noqa: F401,F403
from action_server.actions.actions_feedback     import *  # noqa: F401,F403
from action_server.actions.actions_handoff      import *  # noqa: F401,F403
from action_server.actions.actions_fallback      import *  # noqa: F401,F403
from action_server.actions.actions_shopify       import *  # noqa: F401,F403
