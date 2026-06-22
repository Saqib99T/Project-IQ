"""Server-side rate limiting (Flask-Limiter).

Per-IP tiers: a lenient global default, a strict limit on the auth blueprint
(brute-force protection), and a moderate limit on the chat blueprint. Storage is
Redis when configured (survives multiple Gunicorn workers), else in-memory.

Limits are configurable via an optional [RATELIMIT] section in app.config; sane
defaults are used otherwise. Health/status endpoints and CORS preflight
(OPTIONS) are never limited. Over-limit requests get a JSON 429 + Retry-After.

NOTE: limits are keyed per client IP. Many users behind one corporate NAT share
an IP, so the chat/default tiers are deliberately generous — tune in config.
"""
import logging

from flask import request, jsonify
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from common import config_manager

logger = logging.getLogger(__name__)

# Defaults (overridable via [RATELIMIT] in app.config). "per IP" applies to each.
_DEFAULTS = {
    "enabled": True,
    "default": "300 per minute",   # lenient catch-all
    "auth":    "30 per minute",    # login/callback — brute-force guard
    "chat":    "120 per minute",   # chat webhook + handoff — chatty but bounded
}

# Paths never rate-limited (monitoring + health checks).
_EXEMPT_PATHS = {"/api/status", "/health", "/health/rasa", "/health/actions", "/health/database"}


def _settings() -> dict:
    cfg = config_manager.load_config()
    if not cfg.has_section("RATELIMIT"):
        return dict(_DEFAULTS)
    g = lambda k, d: cfg.get("RATELIMIT", k, fallback=d)
    return {
        "enabled": cfg.getboolean("RATELIMIT", "enabled", fallback=_DEFAULTS["enabled"]),
        "default": g("default_limit", _DEFAULTS["default"]),
        "auth":    g("auth_limit",    _DEFAULTS["auth"]),
        "chat":    g("chat_limit",    _DEFAULTS["chat"]),
    }


def client_ip() -> str:
    """Real client IP, honouring X-Forwarded-For (we run behind Nginx)."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return get_remote_address()


def should_exempt() -> bool:
    """Skip CORS preflight and health/status endpoints."""
    if request.method == "OPTIONS":
        return True
    return request.path in _EXEMPT_PATHS


def _storage_uri() -> str:
    try:
        r = config_manager.get_redis_config()
        if r.get("enabled"):
            auth = f":{r['password']}@" if r.get("password") else ""
            return f"redis://{auth}{r['host']}:{r['port']}/{r['db']}"
    except Exception as e:  # never block startup on storage detection
        logger.warning("rate-limit: redis config unavailable (%s); using in-memory", e)
    return "memory://"


def make_limiter(app, default_limit: str, storage_uri: str = "memory://") -> Limiter:
    """Create + attach a Limiter (kept small so tests can build a throwaway one)."""
    limiter = Limiter(
        key_func=client_ip,
        default_limits=[default_limit],
        storage_uri=storage_uri,
        headers_enabled=True,           # adds X-RateLimit-* and Retry-After
        strategy="fixed-window",
    )
    limiter.request_filter(should_exempt)
    limiter.init_app(app)
    return limiter


def init_rate_limiting(app) -> "Limiter | None":
    """Wire rate limiting into the live app. No-op if disabled in config."""
    s = _settings()
    if not s["enabled"]:
        logger.info("rate limiting disabled via config")
        return None

    storage = _storage_uri()
    limiter = make_limiter(app, s["default"], storage)

    # Stricter per-blueprint tiers (applies to every route in the blueprint).
    try:
        from web.api.blueprints.bp_auth import bp as bp_auth
        limiter.limit(s["auth"])(bp_auth)
    except Exception as e:
        logger.warning("rate-limit: could not limit auth blueprint (%s)", e)
    try:
        from web.api.blueprints.bp_chat import bp as bp_chat
        limiter.limit(s["chat"])(bp_chat)
    except Exception as e:
        logger.warning("rate-limit: could not limit chat blueprint (%s)", e)

    @app.errorhandler(429)
    def _too_many(e):
        resp = jsonify({
            "error": "rate_limited",
            "message": "Too many requests. Please slow down and try again shortly.",
            "detail": getattr(e, "description", None),
        })
        resp.status_code = 429
        # Flask-Limiter sets Retry-After on the exception's response when headers
        # are enabled; mirror it if present.
        retry_after = getattr(getattr(e, "response", None), "headers", {}) or {}
        if retry_after.get("Retry-After"):
            resp.headers["Retry-After"] = retry_after["Retry-After"]
        return resp

    logger.info("rate limiting active (storage=%s, default=%s, auth=%s, chat=%s)",
                "redis" if storage.startswith("redis") else "memory",
                s["default"], s["auth"], s["chat"])
    return limiter
