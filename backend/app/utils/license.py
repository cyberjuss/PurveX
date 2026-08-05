"""Offline-verifiable license keys for the self-hosted paid plan.

A license is a JWT signed with EdDSA (ed25519) by a private key that only
the operator issuing licenses holds (see backend/scripts/issue_license.py).
PurveX verifies it locally against the public key below — no network call
to any licensing server, ever. A missing, invalid, or expired license just
means this instance runs under free-tier limits; it never blocks the
product from working.

Claims:
  plan          "free" | "paid"
  seat_limit    max total users in the org, or null for unlimited
  runner_limit  max registered environment runners, or null for unlimited
  exp           standard JWT expiry (PyJWT enforces this on decode)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import jwt

from ..config import settings

logger = logging.getLogger(__name__)

LICENSE_ALGORITHM = "EdDSA"

FREE_SEAT_LIMIT = 3
FREE_RUNNER_LIMIT = 1


@dataclass(frozen=True)
class LicenseStatus:
    plan: str
    seat_limit: Optional[int]
    runner_limit: Optional[int]

    @property
    def is_paid(self) -> bool:
        return self.plan == "paid"


FREE_LICENSE_STATUS = LicenseStatus(plan="free", seat_limit=FREE_SEAT_LIMIT, runner_limit=FREE_RUNNER_LIMIT)


class LicenseKeyInvalid(Exception):
    """A license key failed verification. Carries a human-readable reason
    so the Settings -> License endpoint can tell the admin why, instead of
    the silent free-tier fallback that's correct everywhere else."""


def _decode(token: str) -> LicenseStatus:
    if not settings.LICENSE_PUBLIC_KEY_PEM:
        raise LicenseKeyInvalid("No license verification key is configured on this instance.")

    try:
        claims = jwt.decode(
            token,
            settings.LICENSE_PUBLIC_KEY_PEM,
            algorithms=[LICENSE_ALGORITHM],
            options={"require": ["exp", "plan"]},
        )
    except (jwt.PyJWTError, ValueError) as exc:
        # ValueError covers a malformed/placeholder LICENSE_PUBLIC_KEY_PEM
        # (e.g. before an operator swaps in the real key) in addition to
        # PyJWTError's own verification failures.
        raise LicenseKeyInvalid(str(exc)) from exc

    plan = claims.get("plan")
    if plan != "paid":
        raise LicenseKeyInvalid(f"Unexpected plan claim: {plan!r}")

    return LicenseStatus(
        plan="paid",
        seat_limit=claims.get("seat_limit"),
        runner_limit=claims.get("runner_limit"),
    )


def verify_license_key(token: str) -> LicenseStatus:
    """Verify a license key strictly, raising LicenseKeyInvalid on failure.

    Used when an admin submits a new key via Settings -> License: unlike
    get_license_status's silent fall-back-to-free (right at request time,
    wrong at save time), saving a bad key should tell the admin why.
    """
    return _decode(token.strip())


def get_license_status(license_key: Optional[str] = None) -> LicenseStatus:
    """Verify a license key and return the effective plan limits.

    `license_key`, if given, is a per-organization key saved via Settings ->
    License (see get_org_license_status) and takes priority over the
    instance-wide PURVEX_LICENSE_KEY env var. Any failure to verify
    (missing key, bad signature, expired, malformed claims) silently falls
    back to the free tier rather than raising — a license problem should
    never be the reason a self-hosted instance stops working for its own
    admin.
    """
    token = (license_key or settings.PURVEX_LICENSE_KEY or "").strip()
    if not token:
        return FREE_LICENSE_STATUS

    try:
        return _decode(token)
    except LicenseKeyInvalid as exc:
        logger.warning("License key failed verification, falling back to free tier: %s", exc)
        return FREE_LICENSE_STATUS


async def get_org_license_status(db, org_id: int) -> LicenseStatus:
    """Look up this org's saved license key (Settings -> License) and verify
    it, falling back to the instance-wide PURVEX_LICENSE_KEY env var if none
    is saved. Request-time enforcement (invite_user, runner registration)
    calls this instead of get_license_status() directly, so a key saved
    through the UI takes effect immediately with no restart.
    """
    from sqlalchemy.future import select

    from .. import models
    from .encryption import decrypt_value

    result = await db.execute(
        select(models.Organization.license_key_encrypted).where(models.Organization.id == org_id)
    )
    encrypted = result.scalar_one_or_none()
    stored_key = decrypt_value(encrypted) if encrypted else None
    return get_license_status(stored_key)
