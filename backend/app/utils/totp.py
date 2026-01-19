"""
TOTP (Time-based One-Time Password) utilities for 2FA.
"""
import secrets
import base64
import json
from typing import Optional, List, Tuple
from passlib.totp import TOTP
import json


def generate_totp_secret() -> str:
    """Generate a new TOTP secret key (base32 encoded)."""
    totp = TOTP.new()
    return totp.base32_key


def normalize_totp_secret(secret: Optional[str]) -> Optional[str]:
    """
    Normalize stored secrets.
    Older builds saved the entire TOTP JSON blob; new builds use base32.
    """
    if not secret:
        return secret
    stripped = secret.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        try:
            totp = TOTP.from_json(stripped)
            return totp.base32_key
        except Exception:
            return secret
    return stripped


def generate_totp_uri(secret: str, email: str, issuer: str = "PurveX") -> str:
    """
    Generate a TOTP provisioning URI for QR code generation.
    
    Args:
        secret: TOTP secret key (base32)
        email: User's email address
        issuer: Service name (default: "PurveX")
    
    Returns:
        otpauth:// URI string
    """
    secret = normalize_totp_secret(secret) or secret
    totp = TOTP(key=secret)
    return totp.to_uri(label=email, issuer=issuer)


def verify_totp_token(secret: str, token: str, window: int = 1) -> bool:
    """
    Verify a TOTP token against a secret.
    
    Args:
        secret: TOTP secret key (base32)
        token: 6-digit token from user's authenticator app
        window: Time window tolerance (default: 1 = ±30 seconds)
    
    Returns:
        True if token is valid, False otherwise
    """
    try:
        secret = normalize_totp_secret(secret)
        if not secret:
            return False
        totp = TOTP(key=secret)
        return totp.match(token, window=window) is not None
    except Exception:
        return False


def generate_backup_codes(count: int = 10) -> List[str]:
    """
    Generate backup codes for 2FA recovery.
    
    Args:
        count: Number of backup codes to generate (default: 10)
    
    Returns:
        List of backup codes (8-digit strings)
    """
    codes = []
    for _ in range(count):
        # Generate 8-digit backup code
        code = ''.join([str(secrets.randbelow(10)) for _ in range(8)])
        codes.append(code)
    return codes


def serialize_backup_codes(codes: List[str]) -> str:
    """Serialize backup codes to JSON string for storage."""
    return json.dumps(codes)


def deserialize_backup_codes(codes_json: Optional[str]) -> List[str]:
    """Deserialize backup codes from JSON string."""
    if not codes_json:
        return []
    try:
        return json.loads(codes_json)
    except Exception:
        return []


def verify_backup_code(codes_json: Optional[str], code: str) -> Tuple[bool, Optional[str]]:
    """
    Verify a backup code and remove it if valid.
    
    Args:
        codes_json: JSON string of backup codes
        code: Backup code to verify
    
    Returns:
        Tuple of (is_valid, updated_codes_json)
        If valid, returns updated JSON with code removed
        If invalid, returns original JSON
    """
    codes = deserialize_backup_codes(codes_json)
    if code in codes:
        codes.remove(code)
        return True, serialize_backup_codes(codes)
    return False, codes_json
