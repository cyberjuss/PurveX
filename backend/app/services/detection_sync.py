"""Detection sync — pull rules from a SIEM connection and upsert into PurveX.

Design
------
The upsert key is ``(siem_connection_id, external_id)``. For every rule the
SIEM returns we do one of four things:

* **create**   — no existing row.
* **update**   — upstream hash changed, local row has no PurveX-side edits
                 since the previous sync (safe to overwrite).
* **propose**  — upstream hash changed *and* a PurveX-side edit exists on a
                 tracked field since the last applied snapshot. We open a
                 ``DetectionProposal`` with ``proposed_by_kind="siem"`` and
                 leave the live row alone so an analyst arbitrates.
* **skip**     — hash matches the last applied snapshot, nothing changed.

Change events
-------------
Every create/update/propose emits a ``SIEMChangeEvent`` so downstream
consumers (the Git audit mirror, notifications, …) can observe the delta
without re-diffing the DB. The mirror service uses this exclusively — it
never touches the ``Detection`` table directly.

Local-drift detection
---------------------
We store the exact payload we applied on the last sync under
``Detection.source_payload`` (JSON). On each subsequent sync:

* If every field in that snapshot still matches the live row → no local
  drift; apply the upstream change in place (``update``).
* If any tracked field differs → local drift; file a proposal (``propose``).

Rows predating this column fall back to "assume no drift" on the first
post-migration sync, which populates ``source_payload`` correctly for the
next round.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from .siem_universal import SIEMUniversalService

logger = logging.getLogger("purvex.services.detection_sync")

# T1059, T1059.001, etc.
TECHNIQUE_RE = re.compile(r"\bT\d{4}(?:\.\d{3})?\b")

# Fields on a Detection that SIEM sync owns. We snapshot these in
# ``source_payload`` after every apply; on the next sync we compare them
# against the live row to detect local drift. Keep this list aligned with
# what the mirror service will serialize to YAML.
_TRACKED_FIELDS = (
    "title",
    "description",
    "siem_query",
    "criticality",
    "technique_id",
    "enabled_upstream",
)


@dataclass
class SIEMChangeEvent:
    """Per-rule outcome of a sync, emitted for downstream consumers.

    The mirror service walks these to decide what to commit. The sync
    endpoint uses the counts to render telemetry. Kept intentionally flat
    and JSON-serializable.
    """

    action: str  # "create" | "update" | "propose" | "skip"
    detection_id: Optional[str]
    external_id: str
    siem_type: str
    # The upstream rule payload we applied (or would have applied for
    # ``propose``). Used by the mirror to render a new YAML file.
    payload: Dict[str, Any] = field(default_factory=dict)
    # Fields that changed between the previous apply and this one. Empty
    # for ``create`` (everything is new) and ``skip`` (nothing changed).
    changed_fields: List[str] = field(default_factory=list)
    # Best-effort "who changed it upstream" from the SIEM's own metadata.
    # Most connectors can't surface this; carry it through when available.
    upstream_modified_by: Optional[str] = None
    upstream_modified_at: Optional[datetime] = None


@dataclass
class SyncReport:
    connection_id: int
    fetched: int = 0
    created: int = 0
    updated: int = 0
    proposals: int = 0
    drifted: int = 0  # alias for updated — preserved for UI backcompat
    unchanged: int = 0
    skipped: int = 0
    errors: List[str] = None
    events: List[SIEMChangeEvent] = None

    def __post_init__(self) -> None:
        if self.errors is None:
            self.errors = []
        if self.events is None:
            self.events = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "connection_id": self.connection_id,
            "fetched": self.fetched,
            "created": self.created,
            "updated": self.updated,
            "proposals": self.proposals,
            "drifted": self.drifted,
            "unchanged": self.unchanged,
            "skipped": self.skipped,
            "errors": self.errors,
        }


def _hash_rule(rule: Dict[str, Any]) -> str:
    """Stable hash of the upstream rule logic so we can detect drift.

    Excludes volatile fields (last_run_at, evidence_url) so cosmetic SIEM
    activity doesn't trip the drift flag.
    """
    payload = {
        "name": rule.get("name"),
        "query": rule.get("query"),
        "enabled": rule.get("enabled"),
        "severity": rule.get("severity"),
        "schedule": rule.get("schedule"),
        "description": rule.get("description"),
    }
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _extract_technique(rule: Dict[str, Any]) -> Optional[str]:
    """Pull the first MITRE technique ID we can find on a SIEM rule.

    Splunk ESCU stores this as JSON in `action.correlationsearch.annotations`.
    Sentinel exposes it as a native `techniques` array. As a last resort we
    fall back to scanning name/description text for a Txxxx[.yyy] pattern.
    """
    techniques = rule.get("techniques")
    if isinstance(techniques, list) and techniques:
        candidate = str(techniques[0]).strip().upper()
        if TECHNIQUE_RE.fullmatch(candidate):
            return candidate

    annotations = rule.get("annotations")
    if isinstance(annotations, str) and annotations:
        try:
            parsed = json.loads(annotations)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            mitre = parsed.get("mitre_attack") or parsed.get("mitre_attack_id")
            if isinstance(mitre, list) and mitre:
                candidate = str(mitre[0]).strip().upper()
                if TECHNIQUE_RE.fullmatch(candidate):
                    return candidate
            if isinstance(mitre, str):
                match = TECHNIQUE_RE.search(mitre)
                if match:
                    return match.group(0).upper()

    haystack = " ".join(
        str(rule.get(field_name) or "")
        for field_name in ("name", "description", "query")
    )
    match = TECHNIQUE_RE.search(haystack)
    if match:
        return match.group(0).upper()
    return None


def _normalize_severity(value: Any) -> str:
    if value is None:
        return "MEDIUM"
    text = str(value).strip().lower()
    if text in {"critical", "5", "very_high"}:
        return "CRITICAL"
    if text in {"high", "4"}:
        return "HIGH"
    if text in {"medium", "moderate", "3"}:
        return "MEDIUM"
    if text in {"low", "2"}:
        return "LOW"
    if text in {"informational", "info", "1"}:
        return "LOW"
    return "MEDIUM"


def _build_payload(
    *,
    title: str,
    description: Optional[str],
    query: str,
    severity: str,
    technique_id: str,
    enabled_upstream: bool,
) -> Dict[str, Any]:
    """Materialize the tracked-fields payload. Single source of truth for
    both the drift comparison and the mirror YAML export."""
    return {
        "title": title,
        "description": description,
        "siem_query": query,
        "criticality": severity,
        "technique_id": technique_id,
        "enabled_upstream": enabled_upstream,
    }


def _load_snapshot(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _detect_local_drift(
    existing: models.Detection, snapshot: Optional[Dict[str, Any]]
) -> List[str]:
    """Return field names where the live row differs from the last-applied
    snapshot. Empty list ⇒ no local drift ⇒ safe to overwrite."""
    if snapshot is None:
        # Legacy row — no snapshot to compare against. First post-migration
        # sync populates it; assume no drift so we don't spam proposals.
        return []
    drifted: List[str] = []
    for key, applied_value in snapshot.items():
        if key not in _TRACKED_FIELDS:
            continue
        live_value = getattr(existing, key, None)
        if live_value != applied_value:
            drifted.append(key)
    return drifted


def _changed_fields(
    new_payload: Dict[str, Any], snapshot: Optional[Dict[str, Any]]
) -> List[str]:
    """Fields where the new upstream payload differs from the snapshot."""
    if snapshot is None:
        return list(new_payload.keys())
    return [
        key
        for key, new_value in new_payload.items()
        if snapshot.get(key) != new_value
    ]


async def sync_connection(
    db: AsyncSession,
    connection: models.SIEMConnection,
    *,
    limit: int = 500,
    proposer_label: Optional[str] = None,
) -> SyncReport:
    """Pull rules from ``connection`` and upsert them as Detections.

    Idempotent. Safe to schedule on a cron — second invocation only writes
    when content_hash changes *and* the live row hasn't been edited in
    PurveX since the last sync (otherwise we file a proposal).
    """
    report = SyncReport(connection_id=connection.id)
    if connection.organization_id is None:
        report.errors.append("connection has no organization_id; cannot scope detections")
        return report

    service = SIEMUniversalService(connection)
    if not service.has_credentials():
        report.errors.append("missing credentials")
        return report

    try:
        rules = await service.get_rules(limit=limit)
    except Exception as exc:  # noqa: BLE001 - surface upstream errors verbatim
        logger.exception("Failed to fetch rules for connection %s", connection.id)
        report.errors.append(f"fetch failed: {exc}")
        return report

    report.fetched = len(rules)
    now = datetime.now(timezone.utc)

    existing_q = await db.execute(
        select(models.Detection).where(
            models.Detection.siem_connection_id == connection.id,
        )
    )
    existing_by_external = {
        det.external_id: det
        for det in existing_q.scalars().all()
        if det.external_id
    }

    label = proposer_label or f"SIEM Sync · {connection.name or connection.siem_type}"

    for rule in rules:
        external_id = rule.get("rule_id") or rule.get("name")
        if not external_id:
            report.skipped += 1
            continue
        external_id = str(external_id)

        rule_hash = _hash_rule(rule)
        technique_id = _extract_technique(rule) or "UNMAPPED"
        title = str(rule.get("name") or external_id)[:500]
        query = rule.get("query") or ""
        description = rule.get("description")
        severity = _normalize_severity(rule.get("severity"))
        enabled_upstream = bool(rule.get("enabled"))

        # Upstream authorship metadata — connectors surface these best-effort.
        upstream_modified_by = (
            rule.get("modified_by")
            or rule.get("updated_by")
            or rule.get("author")
        )
        upstream_modified_at_raw = (
            rule.get("modified_at")
            or rule.get("updated_at")
            or rule.get("last_modified")
        )
        upstream_modified_at = _coerce_datetime(upstream_modified_at_raw)

        payload = _build_payload(
            title=title,
            description=description,
            query=query,
            severity=severity,
            technique_id=technique_id,
            enabled_upstream=enabled_upstream,
        )
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))

        existing = existing_by_external.get(external_id)
        if existing is None:
            new_det = models.Detection(
                organization_id=connection.organization_id,
                technique_id=technique_id,
                title=title,
                description=description,
                siem_type=connection.siem_type,
                siem_query=query,
                criticality=severity,
                source="siem_sync",
                siem_connection_id=connection.id,
                external_id=external_id,
                content_hash=rule_hash,
                enabled_upstream=enabled_upstream,
                last_synced_at=now,
                source_payload=payload_json,
            )
            db.add(new_det)
            # Flush so the new row has an id we can attach to the change event.
            await db.flush()
            report.created += 1
            report.events.append(
                SIEMChangeEvent(
                    action="create",
                    detection_id=new_det.id,
                    external_id=external_id,
                    siem_type=connection.siem_type,
                    payload=payload,
                    changed_fields=list(payload.keys()),
                    upstream_modified_by=upstream_modified_by,
                    upstream_modified_at=upstream_modified_at,
                )
            )
            continue

        snapshot = _load_snapshot(existing.source_payload)
        if existing.content_hash == rule_hash:
            # No upstream change. Still refresh soft fields so the UI's
            # "last synced" clock moves forward.
            existing.last_synced_at = now
            existing.enabled_upstream = enabled_upstream
            report.unchanged += 1
            report.events.append(
                SIEMChangeEvent(
                    action="skip",
                    detection_id=existing.id,
                    external_id=external_id,
                    siem_type=connection.siem_type,
                    payload=payload,
                )
            )
            continue

        local_drift = _detect_local_drift(existing, snapshot)
        changed = _changed_fields(payload, snapshot)
        if local_drift:
            # Conflict: upstream changed AND someone tuned the rule in
            # PurveX since the last sync. File a proposal instead of
            # clobbering the analyst's work.
            snap = {
                name: getattr(existing, name, None) for name in _TRACKED_FIELDS
            }
            proposal = models.DetectionProposal(
                id=str(uuid.uuid4()),
                organization_id=connection.organization_id,
                detection_id=existing.id,
                proposed_by_kind="siem",
                proposed_by_user_id=None,
                proposed_by_label=label,
                action="update",
                status="pending",
                reason=(
                    f"Upstream SIEM rule '{external_id}' changed. Local edits "
                    f"detected on: {', '.join(local_drift)}. Change queued for "
                    "review instead of being applied automatically."
                ),
                target_fields=json.dumps(payload),
                current_snapshot=json.dumps(snap, default=str),
            )
            db.add(proposal)
            # Record that the upstream hash moved, but DON'T update the
            # tracked fields — the proposal is authoritative until reviewed.
            # We do advance last_synced_at so subsequent syncs skip this rule
            # while a proposal is pending.
            existing.content_hash = rule_hash
            existing.last_synced_at = now
            existing.drift_detected_at = now
            report.proposals += 1
            report.events.append(
                SIEMChangeEvent(
                    action="propose",
                    detection_id=existing.id,
                    external_id=external_id,
                    siem_type=connection.siem_type,
                    payload=payload,
                    changed_fields=changed,
                    upstream_modified_by=upstream_modified_by,
                    upstream_modified_at=upstream_modified_at,
                )
            )
            continue

        # Safe to apply upstream change.
        existing.title = title
        existing.description = description
        existing.siem_query = query
        existing.criticality = severity
        existing.enabled_upstream = enabled_upstream
        existing.content_hash = rule_hash
        existing.last_synced_at = now
        existing.drift_detected_at = now
        existing.source_payload = payload_json
        # Only overwrite technique mapping if the upstream rule provides one;
        # otherwise we keep whatever an analyst manually mapped earlier.
        if technique_id != "UNMAPPED":
            existing.technique_id = technique_id
        report.updated += 1
        report.drifted += 1  # backcompat alias
        report.events.append(
            SIEMChangeEvent(
                action="update",
                detection_id=existing.id,
                external_id=external_id,
                siem_type=connection.siem_type,
                payload=payload,
                changed_fields=changed,
                upstream_modified_by=upstream_modified_by,
                upstream_modified_at=upstream_modified_at,
            )
        )

    await db.commit()
    return report


def _coerce_datetime(value: Any) -> Optional[datetime]:
    """Best-effort parse of a SIEM-provided timestamp. ``None`` on failure."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        # Accept ISO-8601 with or without trailing Z.
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            return None
    return None


async def sync_all_connections(
    db: AsyncSession,
    organization_id: int,
    *,
    limit: int = 500,
) -> List[SyncReport]:
    result = await db.execute(
        select(models.SIEMConnection).where(
            models.SIEMConnection.organization_id == organization_id
        )
    )
    reports: List[SyncReport] = []
    for conn in result.scalars().all():
        reports.append(await sync_connection(db, conn, limit=limit))
    return reports
