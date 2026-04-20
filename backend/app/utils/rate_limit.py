"""Rate limiting utilities.

Uses Redis as a shared store when REDIS_URL is configured, otherwise falls
back to an in-memory sliding window (fine for single-process dev).
"""
import time
from typing import Dict, List
from collections import defaultdict

from .redis_client import get_redis_client

_rate_limit_store: Dict[str, List[float]] = defaultdict(list)


def _check_redis(key: str, max_requests: int, window_seconds: int) -> tuple[bool, int]:
    client = get_redis_client()
    now = time.time()
    redis_key = f"ratelimit:{key}"
    try:
        pipe = client.pipeline()
        pipe.zremrangebyscore(redis_key, 0, now - window_seconds)
        pipe.zcard(redis_key)
        pipe.zadd(redis_key, {str(now): now})
        pipe.expire(redis_key, window_seconds)
        _, count, _, _ = pipe.execute()

        if count >= max_requests:
            # Roll back the added entry so we don't count over the limit
            client.zrem(redis_key, str(now))
            return False, 0
        return True, max_requests - count - 1
    except Exception:
        # Fall through to in-memory on any Redis error
        return _check_memory(key, max_requests, window_seconds)


def _check_memory(key: str, max_requests: int, window_seconds: int) -> tuple[bool, int]:
    now = time.time()
    bucket = _rate_limit_store[key]
    bucket = [ts for ts in bucket if now - ts < window_seconds]
    _rate_limit_store[key] = bucket

    if len(bucket) >= max_requests:
        return False, 0

    bucket.append(now)
    return True, max_requests - len(bucket)


def check_rate_limit(
    key: str,
    max_requests: int = 5,
    window_seconds: int = 60,
    clear_old: bool = True,
) -> tuple[bool, int]:
    """Check whether a request should be allowed for `key`.

    Returns (allowed, remaining_requests_in_window).
    """
    if get_redis_client() is not None:
        return _check_redis(key, max_requests, window_seconds)
    return _check_memory(key, max_requests, window_seconds)


def clear_rate_limit(key: str):
    client = get_redis_client()
    if client is not None:
        try:
            client.delete(f"ratelimit:{key}")
        except Exception:
            pass
    if key in _rate_limit_store:
        del _rate_limit_store[key]


def get_rate_limit_info(key: str, window_seconds: int = 60) -> dict:
    now = time.time()
    client = get_redis_client()
    if client is not None:
        try:
            redis_key = f"ratelimit:{key}"
            client.zremrangebyscore(redis_key, 0, now - window_seconds)
            count = client.zcard(redis_key)
            oldest = client.zrange(redis_key, 0, 0, withscores=True)
            return {
                "count": count,
                "window_seconds": window_seconds,
                "oldest_request": oldest[0][1] if oldest else None,
            }
        except Exception:
            pass
    bucket = _rate_limit_store.get(key, [])
    recent = [ts for ts in bucket if now - ts < window_seconds]
    return {
        "count": len(recent),
        "window_seconds": window_seconds,
        "oldest_request": min(recent) if recent else None,
    }
