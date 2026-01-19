"""
Rate limiting utilities for API endpoints.
"""
import time
from typing import Dict, List
from collections import defaultdict
from datetime import datetime, timedelta

# In-memory rate limit storage (in production, use Redis)
_rate_limit_store: Dict[str, List[float]] = defaultdict(list)

def check_rate_limit(
    key: str,
    max_requests: int = 5,
    window_seconds: int = 60,
    clear_old: bool = True
) -> tuple[bool, int]:
    """
    Check if a request should be rate limited.
    
    Args:
        key: Unique identifier for the rate limit (e.g., IP address, user ID)
        max_requests: Maximum number of requests allowed in the window
        window_seconds: Time window in seconds
        clear_old: Whether to clear old entries outside the window
    
    Returns:
        (is_allowed, remaining_requests)
    """
    now = time.time()
    bucket = _rate_limit_store[key]
    
    if clear_old:
        # Remove entries outside the window
        bucket = [ts for ts in bucket if now - ts < window_seconds]
        _rate_limit_store[key] = bucket
    
    if len(bucket) >= max_requests:
        return False, 0
    
    # Add current request
    bucket.append(now)
    _rate_limit_store[key] = bucket
    
    remaining = max_requests - len(bucket)
    return True, remaining

def clear_rate_limit(key: str):
    """Clear rate limit entries for a given key."""
    if key in _rate_limit_store:
        del _rate_limit_store[key]

def get_rate_limit_info(key: str, window_seconds: int = 60) -> dict:
    """Get rate limit information for a key."""
    now = time.time()
    bucket = _rate_limit_store.get(key, [])
    # Filter to window
    recent = [ts for ts in bucket if now - ts < window_seconds]
    return {
        "count": len(recent),
        "window_seconds": window_seconds,
        "oldest_request": min(recent) if recent else None,
    }

