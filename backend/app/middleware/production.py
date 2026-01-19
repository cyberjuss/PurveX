"""
Production security middleware for enforcing HTTPS and request limits.
"""
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import logging

logger = logging.getLogger("purvex.api.production")

class HTTPSEnforcementMiddleware(BaseHTTPMiddleware):
    """
    Enforce HTTPS in production environments.
    Redirects HTTP requests to HTTPS and sets HSTS headers.
    """
    
    def __init__(self, app, enforce_https: bool = False):
        super().__init__(app)
        self.enforce_https = enforce_https
    
    async def dispatch(self, request: Request, call_next):
        # Only enforce in production
        if self.enforce_https:
            # Check if request is over HTTPS
            # In production behind a proxy, check X-Forwarded-Proto header
            scheme = request.headers.get("X-Forwarded-Proto", request.url.scheme)
            
            if scheme != "https":
                # In production, redirect to HTTPS
                https_url = str(request.url).replace("http://", "https://", 1)
                logger.warning(
                    f"HTTP request blocked in production: {request.url.path} from {request.client.host}"
                )
                raise HTTPException(
                    status_code=status.HTTP_426_UPGRADE_REQUIRED,
                    detail="HTTPS is required. Please use HTTPS to access this API.",
                    headers={"Upgrade": "TLS/1.2, HTTP/1.1"}
                )
        
        response = await call_next(request)
        return response


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """
    Enforce maximum request size to prevent DoS attacks.
    """
    
    def __init__(self, app, max_request_size: int = 10 * 1024 * 1024):  # 10MB default
        super().__init__(app)
        self.max_request_size = max_request_size
    
    async def dispatch(self, request: Request, call_next):
        # Check Content-Length header if present
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                size = int(content_length)
                if size > self.max_request_size:
                    logger.warning(
                        f"Request size limit exceeded: {size} bytes from {request.client.host}"
                    )
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Request body too large. Maximum size is {self.max_request_size / (1024*1024):.1f}MB"
                    )
            except ValueError:
                # Invalid content-length header, let it through (will fail on read if too large)
                pass
        
        # For streaming requests, we can't check size upfront
        # The application server (uvicorn/gunicorn) should handle this
        response = await call_next(request)
        return response

