"""Centralized observability metric queries (web/api/impl/metrics_queries).

A fake cursor records executed SQL and returns scripted rows, so we verify the
query shape + parsing + fallback logic without a live database.
"""
from web.api.impl import metrics_queries as mq


class FakeCursor:
    def __init__(self, rows):
        self._rows = list(rows)      # one row returned per execute(), in order
        self.executed = []

    def execute(self, sql, *a):
        self.executed.append(sql)

    def fetchone(self):
        return self._rows.pop(0)


# ── avg_bot_response_ms ───────────────────────────────────────────────────────
def test_avg_uses_nearest_preceding_subquery_not_join():
    cur = FakeCursor([(1234.6,)])
    val = mq.avg_bot_response_ms(cur, window="24 hours", fallback_all_time=False)
    assert val == 1235                                   # rounded
    sql = cur.executed[0]
    assert "WITH bot_responses" in sql and "MAX(u.timestamp)" in sql   # correlated subquery
    assert "JOIN" not in sql.upper()
    assert "24 hours" in sql


def test_avg_falls_back_to_all_time_when_window_empty():
    # First (windowed) call returns 0 → triggers all-time second call.
    cur = FakeCursor([(0,), (900.2,)])
    val = mq.avg_bot_response_ms(cur, window="7 days", fallback_all_time=True)
    assert val == 900
    assert len(cur.executed) == 2
    assert "7 days" in cur.executed[0] and "7 days" not in cur.executed[1]


def test_avg_no_fallback_returns_zero():
    cur = FakeCursor([(None,)])
    assert mq.avg_bot_response_ms(cur, window="24 hours", fallback_all_time=False) == 0
    assert len(cur.executed) == 1


# ── error_rate_pct ────────────────────────────────────────────────────────────
def test_error_rate_uses_status_filter_not_wording():
    cur = FakeCursor([(3, 12)])
    rate = mq.error_rate_pct(cur, window="7 days", fallback_all_time=False)
    assert rate == 25.0
    sql = cur.executed[0]
    assert "FILTER (WHERE status = 'error')" in sql
    assert "ILIKE" not in sql.upper() and "sorry" not in sql.lower()


def test_error_rate_falls_back_to_all_time():
    cur = FakeCursor([(0, 0), (1, 50)])    # windowed has no rows → all-time
    rate = mq.error_rate_pct(cur, window="7 days", fallback_all_time=True)
    assert rate == 2.0
    assert len(cur.executed) == 2


def test_error_rate_zero_when_no_actions():
    cur = FakeCursor([(0, 0)])
    assert mq.error_rate_pct(cur, window="24 hours", fallback_all_time=False) == 0.0
