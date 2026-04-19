"""Detection sync — pull rules from a SIEM connection and upsert into PurveX.

The upsert key is (siem_connection_id, external_id). A new content_hash on an
existing detection marks the row as drifted (last edit happened upstream) and
re-stamps last_synced_at; the analyst sees this in the reports Action Items
queue without overwriting test history.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from .siem_universal import SIEMUniversalService

logger = logging.getLogger("purvex.services.detection_sync")

# T1059, T1059.001, etc.
TECHNIQUE_RE = re.compile(r"\bT\d{4}(?:\.\d{3})?\b")


@dataclass
class SyncReport:
    connection_id: int
    fetched: int = 0
    created: int = 0
    updated: int = 0
    drifted: int = 0
    unchanged: int = 0
    skipped: int = 0
    errors: List[str] = None

    def __post_init__(self) -> None:
        if self.errors is None:
            self.errors = []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "connection_id": self.connection_id,
            "fetched": self.fetched,
            "created": self.created,
            "updated": self.updated,
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
        str(rule.get(field) or "")
        for field in ("name", "description", "query")
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


async def sync_connection(
    db: AsyncSession,
    connection: models.SIEMConnection,
    *,
    limit: int = 500,
) -> SyncReport:
    """Pull rules from `connection` and upsert them as Detections.

    Idempotent. Safe to schedule on a cron — second invocation only writes
    when content_hash changes.
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
            )
            db.add(new_det)
            report.created += 1
            continue

        if existing.content_hash == rule_hash:
            existing.last_synced_at = now
            existing.enabled_upstream = enabled_upstream
            report.unchanged += 1
            continue

        existing.title = title
        existing.description = description
        existing.siem_query = query
        existing.criticality = severity
        existing.enabled_upstream = enabled_upstream
        existing.content_hash = rule_hash
        existing.last_synced_at = now
        existing.drift_detected_at = now
        # Only overwrite technique mapping if the upstream rule provides one;
        # otherwise we keep whatever an analyst manually mapped earlier.
        if technique_id != "UNMAPPED":
            existing.technique_id = technique_id
        report.drifted += 1
        report.updated += 1

    await db.commit()
    return report


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
