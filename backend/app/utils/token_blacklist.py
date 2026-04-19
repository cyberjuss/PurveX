"""
In-memory JWT token blacklist for logout revocation.

Tokens are tracked by their JTI (JWT ID) claim. Expired entries are
periodically pruned to prevent unbounded memory growth.

NOTE: This is in-memory and not shared across workers. For production
multi-process deployments, migrate to Redis.
"""
import time
import threading

_lock = threading.Lock()
_blacklist: dict[str, float] = {}  # jti -> expiry timestamp
_PRUNE_INTERVAL = 300  # seconds between prune sweeps
_last_prune: float = 0.0


def blacklist_token(jti: str, exp: float) -> None:
    """Add a JTI to the blacklist until its natural expiry."""
    with _lock:
        _blacklist[jti] = exp
        _maybe_prune()


def is_blacklisted(jti: str) -> bool:
    """Check whether a JTI has been revoked."""
    with _lock:
        _maybe_prune()
        return jti in _blacklist


def _maybe_prune() -> None:
    """Remove expired entries if enough time has passed."""
    global _last_prune
    now = time.time()
    if now - _last_prune < _PRUNE_INTERVAL:
        return
    _last_prune = now
    expired = [k for k, v in _blacklist.items() if v < now]
    for k in expired:
        del _blacklist[k]
