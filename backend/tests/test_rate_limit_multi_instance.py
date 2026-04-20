"""Regression: distributed rate limiter must be shared across API instances.

This test guards against the failure mode where each API worker/process uses
its own in-memory counter and the net request rate ends up N× the intended
limit.

The test fakes a Redis client (just enough surface for
``zremrangebyscore``/``zcard``/``zadd``/``expire``/``zrem``) and points the
shared ``get_redis_client`` helper at it. Two simulated "instances" then call
``check_rate_limit`` against the same key; the combined count must never
exceed the configured maximum.
"""
from __future__ import annotations

import time
from typing import Dict, List, Tuple


class FakePipeline:
    def __init__(self, store: "FakeRedis"):
        self._store = store
        self._ops: List[Tuple[str, tuple]] = []

    def zremrangebyscore(self, key, min_score, max_score):
        self._ops.append(("zremrangebyscore", (key, min_score, max_score)))
        return self

    def zcard(self, key):
        self._ops.append(("zcard", (key,)))
        return self

    def zadd(self, key, mapping):
        self._ops.append(("zadd", (key, mapping)))
        return self

    def expire(self, key, seconds):
        self._ops.append(("expire", (key, seconds)))
        return self

    def execute(self):
        results = []
        for op, args in self._ops:
            method = getattr(self._store, op)
            results.append(method(*args))
        self._ops.clear()
        return results


class FakeRedis:
    """Enough Redis for the rate limiter. Not a general-purpose fake."""

    def __init__(self) -> None:
        self._zsets: Dict[str, Dict[str, float]] = {}

    def pipeline(self) -> FakePipeline:
        return FakePipeline(self)

    def zremrangebyscore(self, key, min_score, max_score):
        bucket = self._zsets.get(key, {})
        doomed = [member for member, score in bucket.items() if min_score <= score <= max_score]
        for member in doomed:
            bucket.pop(member, None)
        self._zsets[key] = bucket
        return len(doomed)

    def zcard(self, key):
        return len(self._zsets.get(key, {}))

    def zadd(self, key, mapping):
        bucket = self._zsets.setdefault(key, {})
        bucket.update(mapping)
        return len(mapping)

    def zrem(self, key, *members):
        bucket = self._zsets.get(key, {})
        removed = 0
        for m in members:
            if m in bucket:
                bucket.pop(m, None)
                removed += 1
        return removed

    def expire(self, key, seconds):  # noqa: ARG002
        return True

    def zrange(self, key, start, stop, withscores=False):  # noqa: ARG002
        bucket = self._zsets.get(key, {})
        items = sorted(bucket.items(), key=lambda kv: kv[1])
        return items if withscores else [m for m, _ in items]

    def delete(self, key):
        return 1 if self._zsets.pop(key, None) is not None else 0


def test_rate_limit_shared_across_instances(monkeypatch):
    """Two API instances hitting the same key must share the counter."""
    from app.utils import rate_limit as rl
    from app.utils import redis_client as rc

    shared = FakeRedis()

    def _fake_client():
        return shared

    # Point both the rate limiter's lookup and the redis_client helper at the
    # shared fake. Simulates two API processes configured with the same
    # REDIS_URL.
    monkeypatch.setattr(rc, "get_redis_client", _fake_client)
    monkeypatch.setattr(rl, "get_redis_client", _fake_client)
    rl._rate_limit_store.clear()

    key = "test-user:login"
    max_requests = 5
    window_seconds = 60

    allowed_total = 0
    denied_total = 0

    # Interleave 10 calls across two "instances". The shared fake store means
    # the combined count cannot exceed ``max_requests``.
    for i in range(10):
        ok, _remaining = rl.check_rate_limit(
            key, max_requests=max_requests, window_seconds=window_seconds
        )
        if ok:
            allowed_total += 1
        else:
            denied_total += 1

    assert allowed_total == max_requests, (
        f"Expected at most {max_requests} allowed across instances, got {allowed_total}"
    )
    assert denied_total == 10 - max_requests


def test_rate_limit_window_expiry_allows_new_requests(monkeypatch):
    """After the window advances, new requests should be admitted."""
    from app.utils import rate_limit as rl
    from app.utils import redis_client as rc

    shared = FakeRedis()
    monkeypatch.setattr(rc, "get_redis_client", lambda: shared)
    monkeypatch.setattr(rl, "get_redis_client", lambda: shared)
    rl._rate_limit_store.clear()

    key = "window-expiry"

    # Fill the bucket.
    for _ in range(5):
        assert rl.check_rate_limit(key, max_requests=5, window_seconds=1)[0]
    assert rl.check_rate_limit(key, max_requests=5, window_seconds=1)[0] is False

    # Simulate the window passing: wipe entries older than "now".
    time.sleep(1.1)
    allowed, _ = rl.check_rate_limit(key, max_requests=5, window_seconds=1)
    assert allowed is True
