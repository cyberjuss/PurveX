"""Shared Redis client for rate limiting and other use cases.

Returns a lazily initialized client if REDIS_URL is configured, else None so
callers can fall back to in-memory storage. This keeps Redis optional in
development and required-when-configured in production.
"""
import logging
import os
from typing import Optional

logger = logging.getLogger("purvex.redis")

_client = None
_initialized = False


def get_redis_client():
    """Return a Redis client instance, or None if Redis is not configured/available."""
    global _client, _initialized
    if _initialized:
        return _client
    _initialized = True

    url = os.getenv("REDIS_URL")
    if not url:
        return None

    try:
        import redis
        _client = redis.Redis.from_url(url, decode_responses=True, socket_timeout=2)
        _client.ping()
        logger.info("Redis connected: %s", url.split("@")[-1])
    except Exception as exc:
        logger.warning("Redis unavailable (%s), falling back to in-memory storage", exc)
        _client = None

    return _client


def redis_available() -> bool:
    return get_redis_client() is not None
