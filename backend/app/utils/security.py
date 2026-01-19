"""
Security utilities for input validation and sanitization.
"""
import re
from typing import Optional
from html import escape

def sanitize_string(value: str, max_length: Optional[int] = None) -> str:
    """
    Sanitize a string input to prevent XSS and injection attacks.
    
    Args:
        value: Input string to sanitize
        max_length: Maximum allowed length
    
    Returns:
        Sanitized string
    """
    if not isinstance(value, str):
        return ""
    
    # Remove null bytes
    value = value.replace("\x00", "")
    
    # Trim whitespace
    value = value.strip()
    
    # Enforce max length
    if max_length and len(value) > max_length:
        value = value[:max_length]
    
    return value

def sanitize_email(email: str) -> Optional[str]:
    """
    Validate and sanitize an email address.
    
    Returns:
        Sanitized email or None if invalid
    """
    if not email:
        return None
    
    email = sanitize_string(email, max_length=255)
    
    # Basic email validation regex
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, email):
        return None
    
    return email.lower()

def sanitize_url(url: str) -> Optional[str]:
    """
    Validate and sanitize a URL.
    
    Returns:
        Sanitized URL or None if invalid
    """
    if not url:
        return None
    
    url = sanitize_string(url, max_length=2048)
    
    # Basic URL validation
    if not url.startswith(("http://", "https://")):
        return None
    
    return url

def escape_html(text: str) -> str:
    """
    Escape HTML special characters to prevent XSS.
    
    Args:
        text: Text to escape
    
    Returns:
        Escaped text
    """
    return escape(text)

def validate_jwt_secret(secret: str) -> bool:
    """
    Validate that JWT secret is strong enough.
    
    Returns:
        True if secret is acceptable
    """
    if not secret:
        return False
    
    # Minimum length requirement
    if len(secret) < 32:
        return False
    
    # Should not be a default/weak secret
    weak_secrets = [
        "super-secret-change-me",
        "super-secret-change-me-in-production",
        "secret",
        "password",
        "changeme",
        "default",
        "admin",
        "12345678",
    ]
    secret_lower = secret.lower()
    # Check if secret contains any weak secret (for partial matches)
    for weak in weak_secrets:
        if weak in secret_lower or secret_lower in weak:
            return False
    
    return True

