"""
Turn ERROR/exception log records into admin alerts.

Instead of inferring failures from bot wording (the old ILIKE '%sorry%'
heuristic), this captures the *actual* ERROR/CRITICAL records the code already
emits — with their traceback and the [req=...] correlation id — and pushes them
to admins through a caller-supplied sink (e.g. notify_admins).

Guards against alert storms:
  - per-signature cooldown: the same error (same logger + level + message
    template) alerts at most once per ``cooldown_secs``;
  - global cap: at most ``global_max`` alerts per ``global_window_secs`` across
    all signatures.

The sink is injected so this module imports nothing from web/DB — install it
from the process that owns the alert channel (the Admin API). Processes that
never install a sink simply don't alert.
"""
import logging
import time

# Records from these loggers never alert — they ARE the alert/notify machinery,
# so alerting on them could feed back on itself.
_SKIP_PREFIXES = ("common.error_alerting", "web.api.impl.notify")


class AdminAlertHandler(logging.Handler):
    """Fires ``sink(title, body, payload)`` on ERROR+ records, deduped + capped."""

    def __init__(self, sink, cooldown_secs=600, global_window_secs=300, global_max=8):
        super().__init__(level=logging.ERROR)
        self._sink = sink
        self._cooldown = cooldown_secs
        self._global_window = global_window_secs
        self._global_max = global_max
        self._last_sent = {}        # signature -> monotonic timestamp
        self._window_start = 0.0
        self._window_count = 0
        self._in_emit = False       # same-thread reentrancy guard

    @staticmethod
    def _signature(record: logging.LogRecord) -> str:
        # Group by the format string (record.msg), not the interpolated message,
        # so "DB error: 17" and "DB error: 42" collapse to one signature.
        return f"{record.name}:{record.levelno}:{record.msg}"

    def emit(self, record: logging.LogRecord) -> None:
        if self._in_emit or record.name.startswith(_SKIP_PREFIXES):
            return
        now = time.monotonic()
        sig = self._signature(record)

        last = self._last_sent.get(sig)
        if last is not None and (now - last) < self._cooldown:
            return

        # Global storm cap (rolling window).
        if now - self._window_start >= self._global_window:
            self._window_start = now
            self._window_count = 0
        if self._window_count >= self._global_max:
            return

        self._last_sent[sig] = now
        self._window_count += 1

        self._in_emit = True
        try:
            from common.request_context import get_request_id
            rid = get_request_id()
            title = f"⚠️ {record.levelname}: {record.name}"
            body = self.format(record)
            if len(body) > 600:
                body = body[:600] + "…"
            self._sink(title, body, {
                "level":      record.levelname,
                "logger":     record.name,
                "request_id": rid,
                "where":      f"{record.pathname}:{record.lineno}",
            })
        except Exception:
            # Alerting must never break the thing it's observing.
            pass
        finally:
            self._in_emit = False


def install_admin_alerts(sink, **kwargs):
    """Attach an :class:`AdminAlertHandler` to the root logger. Idempotent.

    ``sink`` is called as ``sink(title, body, payload)``. Extra kwargs tune the
    cooldown / cap (see :class:`AdminAlertHandler`). Returns the handler, or the
    existing one if already installed.
    """
    root = logging.getLogger()
    for h in root.handlers:
        if isinstance(h, AdminAlertHandler):
            return h
    handler = AdminAlertHandler(sink, **kwargs)
    handler.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(handler)
    return handler
