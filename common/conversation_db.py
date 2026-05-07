"""
Conversation Database — backward-compatibility facade.

All implementation lives in common/db/:
  _connection.py  — pool, schema init, read-replica routing
  _messages.py    — conversation + message logging
  _analytics.py   — dashboard queries, app management
  _config.py      — config, themes, KB articles, handoff runtime config
  _handoff.py     — operators, queue, handoff state

Import from here or from common.db directly — both work.
"""
from common.db import *  # noqa: F401, F403
from common.db import (
    _get_connection, _release_connection,
    _get_read_connection, _release_read_connection,
    _deep_merge, _recalculate_queue_positions,
    _HANDOFF_RUNTIME_DEFAULTS,
)
