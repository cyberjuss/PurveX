"""
Symmetric encryption for sensitive fields stored at rest (SIEM credentials,
API keys, TOTP secrets).

The encryption key is read from the ``PURVEX_ENCRYPTION_KEY`` environment
variable.  In *development* mode a deterministic fallback is used so the app
still starts, but a loud warning is emitted.  In *production* the app refuses
to start without a proper key.

Generate a key once with::

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

from __future__ import annotations

import logging
import os

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_KEY_ENV = "PURVEX_ENCRYPTION_KEY"


def _load_key() -> bytes:
    raw = os.getenv(_KEY_ENV)
    if raw:
        return raw.encode()

    from ..config import settings

    if getattr(settings, "DEPLOYMENT_ENV", "dev").lower() in ("prod", "staging"):
        raise RuntimeError(
            f"{_KEY_ENV} environment variable is required in production/staging. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )

    # In development, generate an ephemeral key so the app starts without
    # manual configuration.  Encrypted data will NOT survive restarts unless
    # the developer sets PURVEX_ENCRYPTION_KEY in their .env.
    logger.warning(
        "%s not set — generating an ephemeral dev key. "
        "Encrypted data will be lost on restart. "
        "Set this variable in .env before storing real credentials.",
        _KEY_ENV,
    )
    key = Fernet.generate_key()
    # Cache in env so the same process reuses the key within a single run.
    os.environ[_KEY_ENV] = key.decode()
    return key


def _fernet() -> Fernet:
    return Fernet(_load_key())


def encrypt_value(plaintext: str | None) -> str | None:
    """Encrypt a plaintext string.  Returns a URL-safe base64 token or *None*."""
    if not plaintext:
        return plaintext
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str | None) -> str | None:
    """Decrypt a previously encrypted value.

    If *ciphertext* was never encrypted (legacy plaintext), it is returned
    as-is so the migration path is seamless — callers always get usable data.
    """
    if not ciphertext:
        return ciphertext
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception):
        # Assume the value is legacy plaintext that predates encryption.
        return ciphertext
