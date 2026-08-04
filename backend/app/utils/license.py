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


def get_license_status() -> LicenseStatus:
    """Verify PURVEX_LICENSE_KEY (if set) and return the effective plan limits.

    Any failure to verify (missing key, bad signature, expired, malformed
    claims) silently falls back to the free tier rather than raising — a
    license problem should never be the reason a self-hosted instance stops
    working for its own admin.
    """
    token = (settings.PURVEX_LICENSE_KEY or "").strip()
    if not token:
        return FREE_LICENSE_STATUS

    if not settings.LICENSE_PUBLIC_KEY_PEM:
        logger.warning("PURVEX_LICENSE_KEY is set but no verification public key is configured.")
        return FREE_LICENSE_STATUS

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
        logger.warning("License key failed verification, falling back to free tier: %s", exc)
        return FREE_LICENSE_STATUS

    plan = claims.get("plan")
    if plan != "paid":
        return FREE_LICENSE_STATUS

    return LicenseStatus(
        plan="paid",
        seat_limit=claims.get("seat_limit"),
        runner_limit=claims.get("runner_limit"),
    )
