"""
CSRF (Cross-Site Request Forgery) protection utilities.
"""
import secrets
import time
from typing import Optional
from fastapi import Request, HTTPException, status

# In-memory CSRF token store (in production, use Redis)
_csrf_tokens: dict[str, dict[str, float]] = {}
CSRF_TOKEN_EXPIRE_SECONDS = 3600  # 1 hour


def generate_csrf_token() -> str:
    """Generate a secure CSRF token."""
    return secrets.token_urlsafe(32)


def store_csrf_token(user_id: int, token: str):
    """Store a CSRF token for a user."""
    key = f"user:{user_id}"
    if key not in _csrf_tokens:
        _csrf_tokens[key] = {}
    _csrf_tokens[key][token] = time.time()


def validate_csrf_token(user_id: int, token: Optional[str]) -> bool:
    """
    Validate a CSRF token for a user.
    
    Returns:
        True if token is valid, False otherwise
    """
    if not token:
        return False
    
    key = f"user:{user_id}"
    if key not in _csrf_tokens:
        return False
    
    # Check if token exists and hasn't expired
    if token not in _csrf_tokens[key]:
        return False
    
    token_time = _csrf_tokens[key][token]
    if time.time() - token_time > CSRF_TOKEN_EXPIRE_SECONDS:
        # Token expired, remove it
        del _csrf_tokens[key][token]
        return False
    
    return True


def get_csrf_token_from_request(request: Request) -> Optional[str]:
    """Extract CSRF token from request headers or form data."""
    # Check X-CSRF-Token header first (preferred)
    token = request.headers.get("X-CSRF-Token")
    if token:
        return token
    
    # Check X-XSRF-Token header (alternative)
    token = request.headers.get("X-XSRF-Token")
    if token:
        return token
    
    # Check form data (for form submissions)
    if hasattr(request, "_form") and request._form:
        form_data = request._form
        if isinstance(form_data, dict):
            return form_data.get("csrf_token")
    
    return None


def require_csrf_token(request: Request, user_id: int):
    """
    Validate CSRF token for a request.
    
    Raises:
        HTTPException if token is missing or invalid
    """
    # Skip CSRF check for GET, HEAD, OPTIONS requests
    if request.method in ["GET", "HEAD", "OPTIONS"]:
        return
    
    token = get_csrf_token_from_request(request)
    if not validate_csrf_token(user_id, token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing CSRF token"
        )


def cleanup_expired_tokens():
    """Remove expired CSRF tokens (call periodically)."""
    now = time.time()
    keys_to_remove = []
    
    for key, tokens in _csrf_tokens.items():
        expired = [
            token for token, token_time in tokens.items()
            if now - token_time > CSRF_TOKEN_EXPIRE_SECONDS
        ]
        for token in expired:
            del tokens[token]
        
        if not tokens:
            keys_to_remove.append(key)
    
    for key in keys_to_remove:
        del _csrf_tokens[key]

