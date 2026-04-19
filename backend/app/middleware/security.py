"""
Security middleware for FastAPI application.
Implements comprehensive security headers and protections.
"""
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse
import time
import logging
import os

logger = logging.getLogger("purvex.api.security")

# Check if we're in production
IS_PRODUCTION = os.getenv("PURVEX_ENV", "dev").lower() == "prod"

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Add comprehensive security headers to all responses.
    Implements OWASP security best practices.
    """
    
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        
        # Content Security Policy
        # SECURITY: Stricter CSP - unsafe-eval removed, unsafe-inline minimized
        # In development, we still need unsafe-inline for Next.js hot reload, but unsafe-eval is removed
        # In production, both are removed for maximum security
        if IS_PRODUCTION:
            csp = (
                "default-src 'self'; "
                "script-src 'self'; "  # No unsafe-inline or unsafe-eval in production
                "style-src 'self' 'unsafe-inline'; "  # CSS may need unsafe-inline for some frameworks
                "img-src 'self' data: https:; "
                "font-src 'self' data:; "
                "connect-src 'self' https:; "  # Only HTTPS in production
                "frame-ancestors 'none'; "
                "base-uri 'self'; "
                "form-action 'self'; "
                "object-src 'none'; "  # Block plugins
                "upgrade-insecure-requests;"  # Upgrade HTTP to HTTPS
            )
        else:
            # Development: Allow unsafe-inline for Next.js dev server, but NO unsafe-eval
            csp = (
                "default-src 'self'; "
                "script-src 'self' 'unsafe-inline'; "  # unsafe-inline for dev, but NO unsafe-eval
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: https:; "
                "font-src 'self' data:; "
                "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; "
                "frame-ancestors 'none'; "
                "base-uri 'self'; "
                "form-action 'self'"
            )
        
        # Security headers
        security_headers = {
            # Prevent clickjacking
            "X-Frame-Options": "DENY",
            # Prevent MIME type sniffing
            "X-Content-Type-Options": "nosniff",
            # XSS Protection (legacy but still useful)
            "X-XSS-Protection": "1; mode=block",
            # Referrer Policy
            "Referrer-Policy": "strict-origin-when-cross-origin",
            # Permissions Policy (formerly Feature Policy)
            "Permissions-Policy": (
                "geolocation=(), "
                "microphone=(), "
                "camera=(), "
                "payment=(), "
                "usb=()"
            ),
            # Content Security Policy
            "Content-Security-Policy": csp.replace("  ", " ").strip(),
        }
        
            # Strict Transport Security (only in production)
        if IS_PRODUCTION:
            security_headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
        
        # Add security headers
        for header, value in security_headers.items():
            response.headers[header] = value
        
        # Remove server header (don't leak server info)
        # MutableHeaders supports __delitem__, just try to delete it
        try:
            del response.headers["server"]
        except (KeyError, AttributeError, TypeError):
            # Header doesn't exist or response doesn't support deletion
            pass
        
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Global rate limiting middleware.
    In production, this should use Redis or similar.
    """
    
    def __init__(self, app, max_requests: int = 100, window_seconds: int = 60):
        super().__init__(app)
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._store: dict[str, list[float]] = {}
    
    async def dispatch(self, request: Request, call_next):
        # Disable rate limiting in non-production environments.
        if not IS_PRODUCTION:
            return await call_next(request)
        allow_local = os.getenv("ALLOW_RATE_LIMIT_LOCALHOST", "0").lower() in {"1", "true", "yes"}
        if allow_local and request.client and request.client.host in {"127.0.0.1", "::1", "localhost"}:
            return await call_next(request)
        # Skip rate limiting for health checks
        if request.url.path in ["/health", "/ready"]:
            return await call_next(request)
        
        # Get client identifier
        client_ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "unknown")
        key = f"{client_ip}:{user_agent[:50]}"
        
        # Clean old entries
        now = time.time()
        if key in self._store:
            self._store[key] = [
                ts for ts in self._store[key]
                if now - ts < self.window_seconds
            ]
        else:
            self._store[key] = []
        
        # Check rate limit
        if len(self._store[key]) >= self.max_requests:
            logger.warning(f"Rate limit exceeded for {client_ip}")
            
            # SECURITY: Log rate limit violation to audit log
            try:
                from ..db import async_sessionmaker
                import asyncio
                async def log_rate_limit():
                    async with async_sessionmaker() as session:
                        from .. import models
                        session.add(
                            models.AuditEvent(
                                user_id=None,  # May not be authenticated
                                user_email=None,
                                action="RATE_LIMIT_EXCEEDED",
                                resource_type="api",
                                resource_id=request.url.path,
                                details=f"Rate limit exceeded: {client_ip} on {request.url.path} ({len(self._store[key])}/{self.max_requests} requests)",
                            )
                        )
                        await session.commit()
                # Run async audit log in background (fire and forget)
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        # If loop is running, create task
                        asyncio.create_task(log_rate_limit())
                    else:
                        loop.run_until_complete(log_rate_limit())
                except Exception:
                    # If async logging fails, continue anyway
                    pass
            except Exception as e:
                # Don't fail the request if audit logging fails
                logger.debug(f"Failed to log rate limit violation: {e}")
            
            return StarletteResponse(
                status_code=429,
                content='{"detail":"Too many requests. Please slow down."}',
                media_type="application/json",
                headers={
                    "Retry-After": str(self.window_seconds),
                    "X-RateLimit-Limit": str(self.max_requests),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(now + self.window_seconds)),
                }
            )
        
        # Add current request
        self._store[key].append(now)
        
        # Process request and get response
        response = await call_next(request)
        
        # Add rate limit headers (only if response is a Response object)
        if hasattr(response, 'headers'):
            response.headers["X-RateLimit-Limit"] = str(self.max_requests)
            response.headers["X-RateLimit-Remaining"] = str(
                self.max_requests - len(self._store[key])
            )
            response.headers["X-RateLimit-Reset"] = str(int(now + self.window_seconds))
        
        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Log all requests for security auditing.
    """
    
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        client_ip = request.client.host if request.client else "unknown"
        
        # Log request (without sensitive data)
        logger.info(
            f"Request: {request.method} {request.url.path} "
            f"from {client_ip} "
            f"User-Agent: {request.headers.get('user-agent', 'unknown')[:100]}"
        )
        
        response = await call_next(request)
        
        # Log response
        process_time = time.time() - start_time
        status_code = getattr(response, 'status_code', 'unknown')
        logger.info(
            f"Response: {request.method} {request.url.path} "
            f"Status: {status_code} "
            f"Time: {process_time:.3f}s"
        )
        
        # Add timing header only in non-production
        if not IS_PRODUCTION and hasattr(response, 'headers'):
            response.headers["X-Process-Time"] = f"{process_time:.3f}"
        
        return response
