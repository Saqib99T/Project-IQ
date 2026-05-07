"""
common.db — domain-driven database layer.

Five submodules, each owning one domain:
  _connection : pool, schema init, read-replica routing
  _messages   : conversation + message logging, transcripts
  _analytics  : dashboard queries, app management
  _config     : config table, themes, KB articles, handoff runtime config
  _handoff    : operators, queue, availability, consent

Import from here or from conversation_db — both work.
"""
from common.db._connection import (
    _get_connection, _release_connection,
    _get_read_connection, _release_read_connection,
    _init_database,
)
from common.db._messages import (
    log_conversation_start, log_message, log_intent,
    log_feedback, log_action,
    get_conversation_transcript, end_conversation,
)
from common.db._analytics import (
    get_analytics_summary, get_recent_conversations,
    get_app_list, get_chat_app, create_chat_app, update_chat_app, delete_chat_app,
)
from common.db._config import (
    get_config, set_config, set_config_bulk,
    get_themes, get_theme, create_theme, update_theme, delete_theme, get_default_theme,
    add_kb_article, get_all_kb_articles,
    get_handoff_runtime_config, set_handoff_runtime_config,
    _deep_merge, _HANDOFF_RUNTIME_DEFAULTS,
)
from common.db._handoff import (
    get_operators, get_operator, get_operator_by_username,
    create_operator, update_operator, update_operator_last_seen,
    get_operator_current_load, get_operator_stats,
    get_available_operators, _is_within_shift,
    enqueue_handoff, _recalculate_queue_positions,
    get_queue, log_handoff_consent,
)

__all__ = [
    # connection
    '_get_connection', '_release_connection',
    '_get_read_connection', '_release_read_connection', '_init_database',
    # messages
    'log_conversation_start', 'log_message', 'log_intent',
    'log_feedback', 'log_action', 'get_conversation_transcript', 'end_conversation',
    # analytics
    'get_analytics_summary', 'get_recent_conversations',
    'get_app_list', 'get_chat_app', 'create_chat_app', 'update_chat_app', 'delete_chat_app',
    # config
    'get_config', 'set_config', 'set_config_bulk',
    'get_themes', 'get_theme', 'create_theme', 'update_theme', 'delete_theme', 'get_default_theme',
    'add_kb_article', 'get_all_kb_articles',
    'get_handoff_runtime_config', 'set_handoff_runtime_config',
    '_deep_merge', '_HANDOFF_RUNTIME_DEFAULTS',
    # handoff
    'get_operators', 'get_operator', 'get_operator_by_username',
    'create_operator', 'update_operator', 'update_operator_last_seen',
    'get_operator_current_load', 'get_operator_stats',
    'get_available_operators', '_is_within_shift',
    'enqueue_handoff', '_recalculate_queue_positions',
    'get_queue', 'log_handoff_consent',
]
