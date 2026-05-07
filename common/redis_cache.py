"""
common.redis_cache — optional Redis cache with in-memory fallback.

Tries to connect to Redis on startup. If Redis is unavailable the same
interface is served by an in-process TTLCache so callers need no guard code.

Public API
----------
cache                  — generic TTLCache/Redis wrapper (get/set/delete)
get_handoff_config()   — returns cached handoff config dict or None
set_handoff_config(v)  — stores handoff config with 5-min TTL
invalidate_handoff_config() — evicts handoff config entry
"""
import json
import os
from common.ttl_cache import TTLCache

# ── Redis connection (optional) ───────────────────────────────────────────────

_redis_client = None

def _try_connect_redis():
    global _redis_client
    try:
        import redis as _redis
        url = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
        r = _redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)
        r.ping()
        _redis_client = r
    except Exception:
        _redis_client = None

_try_connect_redis()


# ── Unified cache wrapper ─────────────────────────────────────────────────────

class _Cache:
    """Redis when available, in-process TTLCache otherwise."""

    def __init__(self, default_ttl: int = 300):
        self._fallback = TTLCache(ttl_seconds=default_ttl)
        self._ttl = default_ttl

    def get(self, key: str):
        if _redis_client is not None:
            try:
                raw = _redis_client.get(key)
                if raw is None:
                    return None
                return json.loads(raw)
            except Exception:
                pass
        return self._fallback.get(key)

    def set(self, key: str, value, ttl: int = None):
        ttl = ttl or self._ttl
        if _redis_client is not None:
            try:
                _redis_client.setex(key, ttl, json.dumps(value, default=str))
                return
            except Exception:
                pass
        self._fallback.set(key, value, ttl=ttl)

    def delete(self, key: str):
        if _redis_client is not None:
            try:
                _redis_client.delete(key)
                return
            except Exception:
                pass
        self._fallback.delete(key)


cache = _Cache(default_ttl=300)

# ── Handoff config helpers ────────────────────────────────────────────────────

_HANDOFF_KEY = 'handoff_config'

def get_handoff_config():
    return cache.get(_HANDOFF_KEY)

def set_handoff_config(value):
    cache.set(_HANDOFF_KEY, value, ttl=300)

def invalidate_handoff_config():
    cache.delete(_HANDOFF_KEY)
