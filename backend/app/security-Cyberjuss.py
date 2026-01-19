from datetime import datetime, timedelta, timezone
from typing import Optional
import re

from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings

# Use bcrypt for password hashing (more secure than sha256_crypt)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)

def validate_password_complexity(password: str) -> tuple[bool, str]:
    """
    Validate password complexity requirements.
    Returns (is_valid, error_message)
    """
    # Enforce strong password policy for production readiness
    if len(password) < 12:
        return False, "Password must be at least 12 characters long"
    
    if re.search(r"\s", password):
        return False, "Password cannot contain spaces or whitespace"
    
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
    
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    
    if not re.search(r'\d', password):
        return False, "Password must contain at least one number"
    
    # SECURITY: Require special character for stronger passwords
    if not re.search(r'[!@#$%^&*(),.?":{}|<>\[\]\\/_+=~`-]', password):
        return False, "Password must contain at least one special character (!@#$%^&*(),.?\":{}|<>[]\\/_+=~`-)"
    
    # Basic weak-pattern guardrails
    lowered = password.lower()
    if "password" in lowered or "admin" in lowered:
        return False, "Password is too weak; avoid common words like 'password' or 'admin'"
    
    return True, ""

def create_access_token(
    data: dict, expires_minutes: Optional[int] = None
) -> str:
    to_encode = data.copy()
    if expires_minutes is None:
        expires_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES

    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    to_encode.update({"exp": expire})

    encoded_jwt = jwt.encode(
        to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except JWTError:
        return None
