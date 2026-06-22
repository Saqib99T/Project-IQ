"""Centralized observability metric SQL — single source of truth.

avg-response and error-rate were each computed in several places across
observability.py, with subtle differences (a crude LAG/`*1000` heuristic, a
JOIN that inflated averages, an ILIKE-'sorry' error guess). These helpers
encapsulate the corrected SQL so a future fix lands in one place.

Each takes an open DB cursor and returns a scalar; callers keep their own
try/except + rollback. Window values are fixed code literals (e.g. "24 hours",
"7 days") — never user input — so interpolation is safe.
"""
import logging

logger = logging.getLogger(__name__)

# Avg ms between each bot message and the NEAREST preceding user message in the
# same conversation. Correlated subquery (not a JOIN) so far-apart pairs don't
# inflate the average into the millions.
_AVG_RESPONSE_SQL = """
    WITH bot_responses AS (
        SELECT bot.timestamp AS bot_ts,
            (SELECT MAX(u.timestamp)
             FROM messages u
             WHERE u.conversation_id = bot.conversation_id
               AND u.sender = 'user'
               AND u.timestamp < bot.timestamp) AS prev_user_ts
        FROM messages bot
        WHERE bot.sender = 'bot'{window}
    )
    SELECT AVG(EXTRACT(EPOCH FROM (bot_ts - prev_user_ts)) * 1000)
    FROM bot_responses
    WHERE prev_user_ts IS NOT NULL
"""

_ERROR_RATE_SQL = (
    "SELECT COUNT(*) FILTER (WHERE status = 'error') AS errors, "
    "COUNT(*) AS total FROM actions{window}"
)


def _avg_once(cursor, window_clause: str) -> int:
    cursor.execute(_AVG_RESPONSE_SQL.format(window=window_clause))
    row = cursor.fetchone()
    return round(row[0]) if row and row[0] else 0


def avg_bot_response_ms(cursor, window: str = "24 hours",
                        fallback_all_time: bool = True) -> int:
    """Average bot response time in ms over `window` (None = all time)."""
    clause = f"\n          AND bot.timestamp > NOW() - INTERVAL '{window}'" if window else ""
    val = _avg_once(cursor, clause)
    if val == 0 and fallback_all_time and window:
        val = _avg_once(cursor, "")
    return val


def error_rate_pct(cursor, window: str = "7 days",
                   fallback_all_time: bool = True) -> float:
    """Percent of action executions with status='error' over `window`."""
    def _once(clause: str):
        cursor.execute(_ERROR_RATE_SQL.format(window=clause))
        return cursor.fetchone()

    row = _once(f" WHERE timestamp > NOW() - INTERVAL '{window}'" if window else "")
    if row and row[1]:
        return round((row[0] / row[1]) * 100, 2)
    if fallback_all_time and window:
        row = _once("")
        if row and row[1]:
            return round((row[0] / row[1]) * 100, 2)
    return 0.0
