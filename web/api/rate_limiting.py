"""Server-side rate limiting — dependency-free (per-IP fixed-window).

A custom limiter rather than Flask-Limiter: rasa 3.6 hard-pins `packaging<21`
and the web app shares rasa's venv, so Flask-Limiter's dependency closure can't
be installed alongside rasa. This uses only stdlib + the `redis` client already
in requirements.

Per-IP tiers: a lenient global default, a strict limit on the auth blueprint
(brute-force), and a moderate limit on the chat blueprint. Storage is Redis when
configured (survives multiple Gunicorn workers), else an in-process dict.
Health/status endpoints and CORS preflight (OPTIONS) are never limited.
Over-limit → JSON 429 + Retry-After.

NOTE: keyed per client IP — users behind one corporate NAT share a budget, so
the chat/default tiers are deliberately generous. Tune via [RATELIMIT] config.
"""
import time
import threading
import logging

from flask import request, jsonify

from common import config_manager

logger = logging.getLogger(__name__)

_DEFAULTS = {
    "enabled": True,
    "default": "300 per minute",
    "auth": "30 per minute",
    "chat": "120 per minute",
}
_EXEMPT_PATHS = {"/api/status", "/health", "/health/rasa", "/health/actions", "/health/database"}
_PERIODS = {"second": 1, "minute": 60, "hour": 3600, "day": 86400}


def _parse_limit(text: str):
    """'300 per minute' -> (300, 60). Tolerant of 'minute'/'minutes'."""
    left, _, right = text.lower().partition("per")
    n = int(left.strip())
    period = right.strip().rstrip("s") or "minute"
    return n, _PERIODS.get(period, 60)


def _settings() -> dict:
    cfg = config_manager.load_config()
    if not cfg.has_section("RATELIMIT"):
        return dict(_DEFAULTS)
    return {
        "enabled": cfg.getboolean("RATELIMIT", "enabled", fallback=_DEFAULTS["enabled"]),
        "default": cfg.get("RATELIMIT", "default_limit", fallback=_DEFAULTS["default"]),
        "auth": cfg.get("RATELIMIT", "auth_limit", fallback=_DEFAULTS["auth"]),
        "chat": cfg.get("RATELIMIT", "chat_limit", fallback=_DEFAULTS["chat"]),
    }


def client_ip() -> str:
    """Real client IP, honouring X-Forwarded-For (we run behind Nginx)."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


def should_exempt() -> bool:
    if request.method == "OPTIONS":
        return True
    return request.path in _EXEMPT_PATHS


# ── storage backends: hit(key, max_n, window) -> (allowed, retry_after_secs) ──
class MemoryStore:
    def __init__(self):
        self._d = {}
        self._lock = threading.Lock()

    def hit(self, key, max_n, window):
        now = time.time()
        with self._lock:
            count, start = self._d.get(key, (0, now))
            if now - start >= window:
                count, start = 0, now
            count += 1
            self._d[key] = (count, start)
            if count > max_n:
                return False, int(window - (now - start)) + 1
            return True, 0


class RedisStore:
    def __init__(self, client):
        self.r = client

    def hit(self, key, max_n, window):
        try:
            count = self.r.incr(key)
            if count == 1:
                self.r.expire(key, window)
            if count > max_n:
                ttl = self.r.ttl(key)
                return False, max(int(ttl), 1)
            return True, 0
        except Exception as e:  # never let a storage hiccup block traffic
            logger.warning("rate-limit: redis store error (%s); allowing request", e)
            return True, 0


def _make_store():
    try:
        r = config_manager.get_redis_config()
        if r.get("enabled"):
            import redis
            client = redis.Redis(host=r["host"], port=r["port"], db=r["db"],
                                 password=r.get("password") or None,
                                 socket_timeout=2, socket_connect_timeout=2)
            client.ping()
            logger.info("rate limiting: using Redis store")
            return RedisStore(client), "redis"
    except Exception as e:
        logger.warning("rate-limit: redis unavailable (%s); using in-memory store", e)
    return MemoryStore(), "memory"


def _install(app, scope_limits: dict, store) -> None:
    """Register the before_request enforcer. scope_limits maps blueprint name
    (or 'default') -> (max_n, window_secs)."""
    @app.before_request
    def _enforce():
        if should_exempt():
            return None
        scope = request.blueprint if request.blueprint in scope_limits else "default"
        max_n, window = scope_limits[scope]
        allowed, retry = store.hit(f"rl:{scope}:{client_ip()}", max_n, window)
        if not allowed:
            resp = jsonify({
                "error": "rate_limited",
                "message": "Too many requests. Please slow down and try again shortly.",
            })
            resp.status_code = 429
            resp.headers["Retry-After"] = str(retry)
            return resp
        return None


def make_limiter(app, default_limit: str, store=None):
    """Minimal single-tier limiter (used by tests). Returns the store."""
    store = store or MemoryStore()
    _install(app, {"default": _parse_limit(default_limit)}, store)
    return store


def init_rate_limiting(app):
    """Wire rate limiting into the live app. No-op if disabled in config."""
    s = _settings()
    if not s["enabled"]:
        logger.info("rate limiting disabled via config")
        return None
    store, kind = _make_store()
    limits = {
        "default": _parse_limit(s["default"]),
        "auth": _parse_limit(s["auth"]),   # bp_auth = Blueprint('auth')
        "chat": _parse_limit(s["chat"]),   # bp_chat = Blueprint('chat')
    }
    _install(app, limits, store)
    logger.info("rate limiting active (store=%s, default=%s, auth=%s, chat=%s)",
                kind, s["default"], s["auth"], s["chat"])
    return store
