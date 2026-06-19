"""
Cross-service correlation IDs.

A single user turn flows:
  widget / mobile → Admin API (:8181) → Rasa (:5005) → Action server (:5055)
  → itsm-service (:8000)

This module carries ONE ``request_id`` across those hops so a single grep
reconstructs the whole turn instead of guessing which log lines belong together.

Transport between processes:
  - HTTP boundaries use the ``X-Request-ID`` header (``REQUEST_ID_HEADER``).
  - The Rasa → Action-server hop has no header we control, so the id also rides
    inside the message ``metadata.request_id`` (``REQUEST_ID_META_KEY``); the
    action server reads it back off the tracker.

The current id lives in a contextvar (greenlet- and async-task-local under
eventlet/asyncio), so ``RequestIdFilter`` can stamp it onto every ``logging``
record without callers threading it by hand.
"""
import contextvars
import logging
import uuid

REQUEST_ID_HEADER = "X-Request-ID"
REQUEST_ID_META_KEY = "request_id"

_request_id: contextvars.ContextVar = contextvars.ContextVar("request_id", default="-")


def new_request_id() -> str:
    """A short, log-friendly correlation id (first 8 hex of a uuid4)."""
    return uuid.uuid4().hex[:8]


def set_request_id(rid) -> str:
    """Bind ``rid`` as the current request id for this context.

    A blank/None value yields a fresh id, so callers can do
    ``set_request_id(request.headers.get(REQUEST_ID_HEADER))`` unconditionally.
    Returns the id that was bound.
    """
    rid = (str(rid).strip() if rid else "") or new_request_id()
    _request_id.set(rid)
    return rid


def get_request_id() -> str:
    """Current request id, or ``'-'`` when none is bound."""
    return _request_id.get()


class RequestIdFilter(logging.Filter):
    """Injects ``request_id`` onto every record so formatters can reference it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id()
        return True


def install_request_id_logging(level=None) -> None:
    """Stamp ``[req=<id>]`` onto this process's ``logging`` output.

    Adds ``RequestIdFilter`` to the root logger's handlers and gives each a
    formatter that prints the id. Idempotent — repeated calls don't stack
    filters. Only touches the root level when ``level`` is passed.

    Note: this only affects the ``logging`` module. ``print()`` sites are not
    covered (that's the separate structured-logging migration).
    """
    root = logging.getLogger()
    fmt = logging.Formatter(
        "%(asctime)s [req=%(request_id)s] %(levelname)s %(name)s: %(message)s"
    )
    handlers = list(root.handlers)
    if not handlers:
        handlers = [logging.StreamHandler()]
        root.addHandler(handlers[0])
    for h in handlers:
        if not any(isinstance(f, RequestIdFilter) for f in h.filters):
            h.addFilter(RequestIdFilter())
        h.setFormatter(fmt)
    if level is not None:
        root.setLevel(level)
