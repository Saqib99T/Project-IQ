"""
Analytics Store Module
Wrapper module that delegates to PostgreSQL database for conversation storage.
Maintains backward compatibility with existing analytics API.
"""

# Import all functions from the SQLite database module
from .conversation_db import (
    log_conversation_start,
    log_message,
    log_intent,
    log_feedback,
    log_action,
    get_analytics_summary,
    get_recent_conversations,
    get_conversation_transcript,
    get_deflection_metrics,
)

# Re-export all functions for backward compatibility
__all__ = [
    'log_conversation_start',
    'log_message',
    'log_intent',
    'log_feedback',
    'log_action',
    'get_analytics_summary',
    'get_recent_conversations',
    'get_conversation_transcript',
    'get_deflection_metrics',
]
