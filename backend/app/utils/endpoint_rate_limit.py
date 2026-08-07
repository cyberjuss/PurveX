"""
Endpoint-specific rate limiting for FastAPI routes.
Provides per-endpoint, per-user, and per-IP rate limiting.
"""
from fastapi import Request, Depends, HTTPException, status
from .rate_limit import check_rate_limit


def endpoint_rate_limit(
    max_requests: int = 50,
    window_seconds: int = 60,
    key_prefix: str = "endpoint",
    per_user: bool = False,
    per_ip: bool = True,
):
    """
    Create a FastAPI dependency for endpoint-specific rate limiting.

    Args:
        max_requests: Maximum number of requests allowed in the window
        window_seconds: Time window in seconds
        key_prefix: Prefix for the rate limit key (e.g., "detections:list")
        per_user: Whether to rate limit per user (requires authenticated user)
        per_ip: Whether to rate limit per IP address

    Returns:
        A FastAPI dependency function that can be used with Depends()
    """

    async def _enforce(request: Request, user=None):
        key_parts = [key_prefix]

        if per_user and user is not None:
            user_id = getattr(user, "id", None) or getattr(user, "email", None)
            if user_id:
                key_parts.append(f"user:{user_id}")

        if per_ip:
            client_ip = request.client.host if request.client else "unknown"
            key_parts.append(f"ip:{client_ip}")

        rate_limit_key = ":".join(key_parts)

        allowed, remaining = check_rate_limit(
            key=rate_limit_key,
            max_requests=max_requests,
            window_seconds=window_seconds,
        )

        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Maximum {max_requests} requests per {window_seconds} seconds.",
                headers={
                    "Retry-After": str(window_seconds),
                    "X-RateLimit-Limit": str(max_requests),
                    "X-RateLimit-Remaining": "0",
                }
            )

    if per_user:
        # Deferred import: avoids a module-load-time cycle with routers.auth,
        # which itself gets imported by every router that reaches for this
        # dependency. FastAPI caches Depends(get_current_user) per request,
        # so this doesn't cost a second auth lookup on endpoints that already
        # depend on the current user elsewhere.
        from ..routers.auth import get_current_user

        async def rate_limit_dependency(request: Request, user=Depends(get_current_user)):
            await _enforce(request, user)
    else:
        async def rate_limit_dependency(request: Request):
            await _enforce(request)

    return rate_limit_dependency
