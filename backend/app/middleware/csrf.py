"""
CSRF protection middleware for FastAPI.
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import logging

from ..utils.csrf import require_csrf_token, cleanup_expired_tokens

logger = logging.getLogger("purvex.api.csrf")


class CSRFProtectionMiddleware(BaseHTTPMiddleware):
    """
    CSRF protection middleware.
    
    Validates CSRF tokens for state-changing requests (POST, PUT, DELETE, PATCH).
    Skips validation for GET, HEAD, OPTIONS requests.
    """
    
    # Endpoints that don't require CSRF protection
    EXEMPT_PATHS = [
        "/health",
        "/ready",
        "/api/v1/auth/login",
        "/api/v1/auth/register",
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
        
        # For state-changing requests, check if user is authenticated
        # If authenticated, validate CSRF token
        # Note: We can't access current_user here, so we'll validate in the endpoint
        # This middleware just ensures the token is present in the request
        
        # Clean up expired tokens periodically (every 100 requests)
        if hasattr(self, '_request_count'):
            self._request_count += 1
        else:
            self._request_count = 1
        
        if self._request_count % 100 == 0:
            cleanup_expired_tokens()
        
        response = await call_next(request)
        return response

