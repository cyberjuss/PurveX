from datetime import datetime, timedelta, timezone
import secrets
from typing import Optional
import re

# SECURITY: Migrated from `python-jose` (unmaintained, CVE-2024-33663 algorithm
# confusion + CVE-2024-33664 DoS) to PyJWT during the 2026-05 audit. PyJWT is
# the de-facto replacement and shares the same surface for our HS256 use case.
import jwt
from jwt import PyJWTError
from passlib.context import CryptContext
import bcrypt as _bcrypt

from .config import settings

# bcrypt >=4.x removed the `__about__` submodule that passlib 1.7.4
# (unmaintained) still probes for a version-logging line. The probe is
# wrapped in a bare except in passlib itself, so this never breaks hashing
# or verification (see ensure_bcrypt_compatible() in main.py, which
# round-trips a real hash at startup) -- but it does make passlib log a full
# "(trapped) error reading bcrypt version" traceback the first time a
# password is hashed, which reads as a crash even though nothing failed.
# Patching the missing attribute makes the probe succeed instead of hitting
# that except branch at all.
if not hasattr(_bcrypt, "__about__"):
    class _BcryptAbout:
        __version__ = getattr(_bcrypt, "__version__", "unknown")
    _bcrypt.__about__ = _BcryptAbout()

# Use bcrypt for password hashing (more secure than sha256_crypt).
# SECURITY: Pin bcrypt rounds explicitly so cost is controlled and auditable.
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12,
)

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
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
    
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    
    if not re.search(r'\d', password):
        return False, "Password must contain at least one number"
    
    # SECURITY: Require special character for stronger passwords
    if not re.search(r'[!@#$%^&*(),.?":{}|<>\[\]\\/_+=~`-]', password):
        return False, "Password must contain at least one special character (!@#$%^&*(),.?\":{}|<>[]\\/_+=~`-)"
    
    return True, ""

def create_access_token(
    data: dict, expires_minutes: Optional[int] = None
) -> str:
    to_encode = data.copy()
    if expires_minutes is None:
        expires_minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES

    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=expires_minutes)
    to_encode.update({
        "exp": expire,
        "iat": now,
        "jti": secrets.token_hex(16),
    })

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
    except PyJWTError:
        return None
