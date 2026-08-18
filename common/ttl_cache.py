"""
common.ttl_cache — lightweight in-process TTL caches.

Pre-built singleton used across the API:
  handoff_config_cache  — caches handoff config in-process (5 min TTL)
"""
import time
import threading
from typing import Any, Optional


class TTLCache:
    """Thread-safe in-memory key/value cache with per-entry TTL."""

    def __init__(self, ttl_seconds: int = 300):
        self._ttl = ttl_seconds
        self._store: dict[str, tuple[Any, float]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.monotonic() > expires_at:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        expires_at = time.monotonic() + (ttl if ttl is not None else self._ttl)
        with self._lock:
            self._store[key] = (value, expires_at)

    def delete(self, key: str) -> None:
        with self._lock:
            self._store.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


handoff_config_cache = TTLCache(ttl_seconds=300)   # 5 min — handoff config
