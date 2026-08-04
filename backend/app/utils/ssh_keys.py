"""Server-side SSH keypair generation for the automated runner installer flow.

PurveX mints an ed25519 keypair per registration token so the installer
script can provision its own `authorized_keys` entry on the target machine,
while the private key never leaves the PurveX server — it's returned to the
script only as its *public* half, and stored encrypted at rest (see
utils/encryption.py) for the backend's own outbound SSH connections.
"""

from __future__ import annotations

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def generate_ed25519_keypair(comment: str = "purvex-agent") -> tuple[str, str]:
    """Return (private_key_openssh_pem, public_key_openssh_line)."""
    private_key = Ed25519PrivateKey.generate()

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.OpenSSH,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("ascii")

    public_line = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.OpenSSH,
        format=serialization.PublicFormat.OpenSSH,
    ).decode("ascii")
    if comment:
        public_line = f"{public_line} {comment}"

    return private_pem, public_line
