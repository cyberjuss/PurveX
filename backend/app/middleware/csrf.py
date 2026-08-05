"""
CSRF protection middleware for FastAPI.
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import logging

from ..security import decode_access_token
from ..utils.csrf import require_csrf_token, cleanup_expired_tokens

logger = logging.getLogger("purvex.api.csrf")


class CSRFProtectionMiddleware(BaseHTTPMiddleware):
    """
    CSRF protection middleware.
    
    Validates CSRF tokens for state-changing requests (POST, PUT, DELETE, PATCH).
    Skips validation for GET, HEAD, OPTIONS requests.
    """
    
    # Endpoints that don't require CSRF protection.
    # Backend routes are mounted without the /api/v1 prefix (the Next.js
    # rewrite strips it before forwarding), so we list both forms to stay
    # correct whether the backend is reached directly or through the proxy.
    EXEMPT_PATHS = [
        "/health",
        "/ready",
        "/auth/login",
        "/auth/bootstrap",
        "/auth/password-reset/request",
        "/auth/password-reset/confirm",
        "/api/v1/auth/login",
        "/api/v1/auth/bootstrap",
        "/api/v1/auth/password-reset/request",
        "/api/v1/auth/password-reset/confirm",
        "/docs",
        "/openapi.json",
        "/redoc",
    ]
    
    async def dispatch(self, request: Request, call_next):
        # Skip CSRF check for exempt paths
        if any(request.url.path.startswith(path) for path in self.EXEMPT_PATHS):
            return await call_next(request)
        
        # Skip CSRF check for read-only methods
        if request.method in ["GET", "HEAD", "OPTIONS"]:
            return await call_next(request)
        
        # Enforce CSRF only for cookie-authenticated session flows. Bearer-token
        # clients are not vulnerable to browser-driven CSRF in the same way.
        session_token = request.cookies.get("access_token")
        if session_token:
            payload = decode_access_token(session_token)
            user_id = payload.get("uid") if payload else None
            if not user_id:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Invalid or missing CSRF token"},
                )
            try:
                require_csrf_token(request, int(user_id))
            except Exception as exc:
                detail = getattr(exc, "detail", "Invalid or missing CSRF token")
                return JSONResponse(
                    status_code=403,
                    content={"detail": detail},
                )

        # Clean up expired tokens periodically (every 100 requests)
        if hasattr(self, '_request_count'):
            self._request_count += 1
        else:
            self._request_count = 1
        
        if self._request_count % 100 == 0:
            cleanup_expired_tokens()
        
        response = await call_next(request)
        return response
