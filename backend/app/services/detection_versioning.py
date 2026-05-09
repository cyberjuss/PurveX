"""Detection versioning — snapshot a rule's identity at Test-run time.

The fields hashed here are exactly the ones that determine *what the rule
fires on*. Editing metadata (title, description, criticality, owner, notes,
lifecycle_stage) must NOT spawn a new version; otherwise every cosmetic
edit pollutes the per-version KPI rollup with a fake "regression" that
isn't.

Distinct on purpose from ``Detection.content_hash`` — that field tracks
upstream source-of-truth (SIEM-side or git-side) for drift detection, and
is *not* updated when a proposal mutates the rule locally. We need a hash
that always reflects the live row regardless of how it got there.
"""
from __future__ import annotations

import hashlib
from typing import Optional

from .. import models


# Fields whose value defines the detection's behaviour. Order matters
# because we hash them positionally with a separator — changing the order
# would invalidate every existing hash, so don't reorder this tuple.
_VERSIONED_FIELDS: tuple[str, ...] = (
    "siem_type",
    "technique_id",
    "siem_query",
    "sigma_rule",
)

# Separator chosen to be a byte sequence that cannot appear in any of the
# hashed field values (NUL bytes are stripped by SQLAlchemy on text columns
# and rejected by Postgres anyway), so concatenation is unambiguous.
_SEP = b"\x00"


def compute_detection_version_hash(detection: models.Detection) -> str:
    """Return the sha256 hex digest of the rule-defining fields.

    None values are normalised to empty strings so a rule that adds a
    sigma_rule for the first time hashes differently from one that never
    had one — both correct outcomes.
    """
    parts: list[bytes] = []
    for field in _VERSIONED_FIELDS:
        value = getattr(detection, field, None) or ""
        parts.append(str(value).encode("utf-8"))
    return hashlib.sha256(_SEP.join(parts)).hexdigest()


def maybe_compute_version_hash(
    detection: Optional[models.Detection],
) -> Optional[str]:
    """Convenience wrapper for callers that may or may not have a Detection.

    Scenario-driven runs (``technique_id`` only, no ``detection_id``) get
    NULL — they're not validating a specific rule version, so they
    legitimately don't belong to any version bucket.
    """
    if detection is None:
        return None
    return compute_detection_version_hash(detection)
