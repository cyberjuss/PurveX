from typing import List, Optional, Dict, Any
from typing_extensions import Annotated

import json
import logging
from datetime import datetime, date, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..db import get_db
from ..routers.auth import get_current_user
from ..schemas import (
    CoverageSummary,
    CoverageTechniqueGap,
    CoverageTotals,
    CoverageTrend,
    CoverageTrendPoint,
    MitreTechnique,
)
from ..utils.tenant import require_org_id


logger = logging.getLogger("purvex.mitre")
router = APIRouter(prefix="/mitre", tags=["mitre"])


# Criticality ladder used by the weighted coverage metric. Values were chosen
# so each tier is ~2× the previous — that makes "CRITICAL validated" dominate
# "10x LOW validated", which matches how SOC leaders actually think about
# coverage gaps. Keep these in sync with the Detection.criticality values.
_CRITICALITY_WEIGHT: Dict[str, int] = {
    "LOW": 1,
    "MEDIUM": 2,
    "HIGH": 4,
    "CRITICAL": 8,
}


def _criticality_weight(value: Optional[str]) -> int:
    return _CRITICALITY_WEIGHT.get((value or "MEDIUM").upper(), 2)


def _max_criticality(a: Optional[str], b: Optional[str]) -> str:
    return a if _criticality_weight(a) >= _criticality_weight(b) else (b or "MEDIUM")


_SAMPLE_OS_PLATFORMS = ["Windows", "Linux", "macOS"]


def _sample_catalog() -> List[MitreTechnique]:
    """Fallback catalog when enterprise-attack.json isn't on disk.

    Each sample technique carries plausible platforms so the frontend platform
    filter still demos correctly in fresh dev environments where the full STIX
    bundle hasn't been downloaded yet.
    """
    return [
        # Reconnaissance — scanning is cross-OS and typically comes from network
        # appliance telemetry.
        MitreTechnique(
            id="T1595",
            name="Active Scanning",
            tactics=["Reconnaissance"],
            platforms=["PRE"],
            data_sources=["Network Traffic"],
        ),
        MitreTechnique(
            id="T1595.001",
            name="Active Scanning: Scanning IP Blocks",
            tactics=["Reconnaissance"],
            is_subtechnique=True,
            platforms=["PRE"],
            data_sources=["Network Traffic"],
        ),
        # Resource Development
        MitreTechnique(
            id="T1583",
            name="Acquire Infrastructure",
            tactics=["Resource Development"],
            platforms=["PRE"],
            data_sources=["Internet Scan"],
        ),
        MitreTechnique(
            id="T1583.001",
            name="Acquire Infrastructure: Domains",
            tactics=["Resource Development"],
            is_subtechnique=True,
            platforms=["PRE"],
            data_sources=["Internet Scan"],
        ),
        # Initial Access — phishing is typically observable on mail / endpoint.
        MitreTechnique(
            id="T1566",
            name="Phishing",
            tactics=["Initial Access"],
            platforms=_SAMPLE_OS_PLATFORMS,
            data_sources=["Application Log", "File", "Network Traffic"],
        ),
        MitreTechnique(
            id="T1566.001",
            name="Spearphishing Attachment",
            tactics=["Initial Access"],
            is_subtechnique=True,
            platforms=_SAMPLE_OS_PLATFORMS,
            data_sources=["Application Log", "File"],
        ),
        # Execution
        MitreTechnique(
            id="T1059",
            name="Command and Scripting Interpreter",
            tactics=["Execution"],
            platforms=_SAMPLE_OS_PLATFORMS,
            data_sources=["Command", "Process"],
        ),
        MitreTechnique(
            id="T1059.001",
            name="PowerShell",
            tactics=["Execution"],
            is_subtechnique=True,
            platforms=["Windows"],
            data_sources=["Command", "Process", "Module"],
        ),
        MitreTechnique(
            id="T1047",
            name="Windows Management Instrumentation",
            tactics=["Execution"],
            platforms=["Windows"],
            data_sources=["Command", "Process", "WMI"],
        ),
    ]


def _load_mitre_catalog() -> List[MitreTechnique]:
    """Load the full MITRE ATT&CK Enterprise catalog from enterprise-attack.json.

    The file is expected at backend/data/enterprise-attack.json relative to the
    backend package root. If the file is missing or cannot be parsed, we fall
    back to a small built-in sample so the UI still works.
    """

    backend_root = Path(__file__).resolve().parents[2]  # .../backend
    attack_path = backend_root / "data" / "enterprise-attack.json"

    if not attack_path.exists():
        logger.warning(
            "MITRE ATT&CK JSON not found at %s – using small built-in sample catalog.",
            attack_path,
        )
        return _sample_catalog()

    try:
        with attack_path.open("r", encoding="utf-8") as f:
            data: Dict[str, Any] = json.load(f)
    except Exception:
        logger.exception(
            "Failed to load MITRE ATT&CK catalog from %s – falling back to sample.",
            attack_path,
        )
        return _sample_catalog()

    objects: List[Dict[str, Any]] = data.get("objects", [])

    # Map tactic shortnames (e.g. "execution") to friendly names ("Execution")
    tactic_short_to_name: Dict[str, str] = {}
    for obj in objects:
        if obj.get("type") == "x-mitre-tactic":
            shortname = obj.get("x_mitre_shortname") or obj.get("x-mitre-shortname")
            name = obj.get("name")
            if shortname and name:
                tactic_short_to_name[shortname] = name

    # Resolve data-source names for each attack-pattern.
    #
    # ATT&CK has changed this graph twice in the last three years:
    #   - Legacy (≤v10):   attack-pattern.x_mitre_data_sources: [str]
    #   - v11..v16:        x-mitre-data-source ←─ x-mitre-data-component ──detects──▶ attack-pattern
    #   - v17+:            x-mitre-detection-strategy ──detects──▶ attack-pattern
    #                      strategy.x_mitre_analytic_refs → x-mitre-analytic
    #                      analytic.x_mitre_log_source_references[].name → SIEM source name
    #
    # We support all three. The inline legacy array is consumed in the
    # attack-pattern loop below; the two relationship models are pre-resolved
    # here into ``technique_data_sources`` keyed by attack-pattern STIX id.
    data_source_name_by_id: Dict[str, str] = {}
    component_to_source_id: Dict[str, str] = {}
    component_name_by_id: Dict[str, str] = {}
    analytic_log_sources: Dict[str, List[str]] = {}
    strategy_analytic_refs: Dict[str, List[str]] = {}
    for obj in objects:
        obj_type = obj.get("type")
        obj_id = obj.get("id")
        if obj_type == "x-mitre-data-source":
            if obj_id and obj.get("name"):
                data_source_name_by_id[obj_id] = obj["name"]
        elif obj_type == "x-mitre-data-component":
            if obj_id:
                if obj.get("name"):
                    component_name_by_id[obj_id] = obj["name"]
                ref = obj.get("x_mitre_data_source_ref")
                if ref:
                    component_to_source_id[obj_id] = ref
        elif obj_type == "x-mitre-analytic":
            if not obj_id:
                continue
            names: List[str] = []
            for ls in obj.get("x_mitre_log_source_references") or []:
                nm = ls.get("name") if isinstance(ls, dict) else None
                if nm and nm not in names:
                    names.append(nm)
            if names:
                analytic_log_sources[obj_id] = names
        elif obj_type == "x-mitre-detection-strategy":
            if obj_id:
                refs = obj.get("x_mitre_analytic_refs") or []
                if refs:
                    strategy_analytic_refs[obj_id] = [str(r) for r in refs]

    technique_data_sources: Dict[str, List[str]] = {}

    def _add_source(target: str, name: str) -> None:
        existing = technique_data_sources.setdefault(target, [])
        if name not in existing:
            existing.append(name)

    for obj in objects:
        if obj.get("type") != "relationship":
            continue
        if obj.get("relationship_type") != "detects":
            continue
        source_ref = obj.get("source_ref") or ""
        target_ref = obj.get("target_ref") or ""
        if not target_ref.startswith("attack-pattern--"):
            continue

        if source_ref.startswith("x-mitre-data-component--"):
            ds_id = component_to_source_id.get(source_ref)
            resolved = data_source_name_by_id.get(ds_id) if ds_id else None
            if not resolved:
                # Some bundles leave the data_source_ref empty; fall back to
                # the component name, which is still human-meaningful.
                resolved = component_name_by_id.get(source_ref)
            if resolved:
                _add_source(target_ref, resolved)
        elif source_ref.startswith("x-mitre-detection-strategy--"):
            for analytic_id in strategy_analytic_refs.get(source_ref, []):
                for name in analytic_log_sources.get(analytic_id, []):
                    _add_source(target_ref, name)

    techniques: List[MitreTechnique] = []

    for obj in objects:
        if obj.get("type") != "attack-pattern":
            continue

        # Skip deprecated / revoked.
        if obj.get("revoked") or obj.get("x_mitre_deprecated") or obj.get(
            "x-mitre-deprecated"
        ):
            continue

        external_id: Optional[str] = None
        for ref in obj.get("external_references", []):
            if ref.get("source_name") in {
                "mitre-attack",
                "mitre-enterprise",
                "mitre-ics-attack",
                "mitre-mobile-attack",
            }:
                external_id = ref.get("external_id")
                break

        if not external_id or not external_id.startswith("T"):
            continue

        # Only include techniques in the Enterprise (mitre-attack) kill-chain.
        kill_chain_phases = obj.get("kill_chain_phases", [])
        phase_shortnames = [
            phase.get("phase_name")
            for phase in kill_chain_phases
            if phase.get("kill_chain_name") == "mitre-attack"
        ]

        if not phase_shortnames:
            continue

        tactic_names: List[str] = [
            tactic_short_to_name.get(short, (short or "").title())
            for short in phase_shortnames
            if short
        ]

        if not tactic_names:
            continue

        is_sub = bool(
            obj.get("x_mitre_is_subtechnique")
            or obj.get("x-mitre-is-subtechnique")
        )

        platforms = [
            str(p)
            for p in (obj.get("x_mitre_platforms") or obj.get("x-mitre-platforms") or [])
            if p
        ]

        # Prefer the inline array if the bundle still has it (older revs); fall
        # back to the relationship graph we pre-built above (newer revs).
        inline_data_sources = obj.get("x_mitre_data_sources") or obj.get("x-mitre-data-sources") or []
        if inline_data_sources:
            data_sources = [str(ds) for ds in inline_data_sources if ds]
        else:
            data_sources = list(technique_data_sources.get(obj.get("id", ""), []))

        techniques.append(
            MitreTechnique(
                id=external_id,
                name=obj.get("name") or external_id,
                tactics=tactic_names,
                is_subtechnique=is_sub,
                platforms=platforms,
                data_sources=data_sources,
            )
        )

    techniques.sort(key=lambda t: t.id)
    logger.info(
        "Loaded %d MITRE ATT&CK techniques from %s", len(techniques), attack_path
    )
    return techniques


MITRE_TECHNIQUES: List[MitreTechnique] = _load_mitre_catalog()


@router.get("/techniques", response_model=List[MitreTechnique])
async def list_mitre_techniques(tactic: Optional[str] = None) -> List[MitreTechnique]:
    """
    Return the ATT&CK Enterprise techniques used by the Tests tab.

    - `tactic` can be used to filter by high-level tactic name, e.g. "Execution".
    """
    if tactic:
        tactic_lower = tactic.lower()
        return [
            t
            for t in MITRE_TECHNIQUES
            if any(tactic_lower == tac.lower() for tac in t.tactics)
        ]
    return MITRE_TECHNIQUES


# -- Coverage summary / trend -----------------------------------------------
#
# These power the executive heatmap header on /mitre. Everything is derived
# on-the-fly from Detection + Test state — there's no snapshot table to keep
# in sync, so the numbers never go stale.


DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


@router.get("/coverage/summary", response_model=CoverageSummary)
async def get_coverage_summary(
    db: DBSession,
    current_user: CurrentUser,
) -> CoverageSummary:
    """Return a heatmap executive summary for the current org.

    The response is designed to answer three questions at a glance:

    1. **How much of ATT&CK are we instrumenting?** → totals + simple_coverage_percent
    2. **How much of what we're instrumenting is actually working, weighted
       by how much it matters?** → weighted_coverage_percent
    3. **Where should I look first?** → top_untested_high_value + top_failing_high_value
    """
    org_id = require_org_id(current_user)

    # Only read the columns we need. Detections can be numerous per org and
    # we're about to do an in-Python aggregation — keeping the row size small
    # is cheaper than loading the full ORM object graph.
    stmt = select(
        models.Detection.id,
        models.Detection.technique_id,
        models.Detection.criticality,
        models.Detection.last_result,
        models.Detection.last_score,
    ).where(models.Detection.organization_id == org_id)
    rows = (await db.execute(stmt)).all()

    # Bucket detections by technique. Techniques without a mapped detection
    # remain "unmapped" in the totals below.
    by_technique: Dict[str, List[Any]] = {}
    for row in rows:
        tid = row.technique_id
        if not tid:
            continue
        by_technique.setdefault(tid, []).append(row)

    # Look up canonical technique metadata (name, tactics) from the STIX
    # catalog. Fall back to the technique id if it's not in the catalog — the
    # heatmap should still render for custom / deprecated ids.
    catalog_by_id = {t.id: t for t in MITRE_TECHNIQUES}
    total_techniques = len(MITRE_TECHNIQUES)

    validated = 0
    at_risk = 0
    mapped = 0

    weighted_numerator = 0
    weighted_denominator = 0

    untested_candidates: List[CoverageTechniqueGap] = []
    failing_candidates: List[CoverageTechniqueGap] = []

    for tid, dets in by_technique.items():
        max_crit = "LOW"
        for d in dets:
            max_crit = _max_criticality(max_crit, d.criticality)
        weight = _criticality_weight(max_crit)

        tested = [d for d in dets if d.last_result]
        passing = [d for d in dets if (d.last_result or "").upper() == "PASS"]
        failing = [d for d in dets if (d.last_result or "").upper() == "FAIL"]

        if passing:
            status = "validated"
            validated += 1
            weighted_numerator += weight
            weighted_denominator += weight
        elif tested:
            status = "at_risk"
            at_risk += 1
            weighted_denominator += weight
        else:
            status = "mapped"
            mapped += 1
            weighted_denominator += weight

        technique = catalog_by_id.get(tid)
        name = technique.name if technique else tid
        tactics = technique.tactics if technique else []

        # Use the worst score across detections as the representative score
        # so a "top failing" list promotes the detections with the biggest drop.
        scored = [d.last_score for d in dets if d.last_score is not None]
        last_score = min(scored) if scored else None
        last_result = failing[0].last_result if failing else (tested[0].last_result if tested else None)

        gap = CoverageTechniqueGap(
            technique_id=tid,
            technique_name=name,
            tactics=tactics,
            detection_count=len(dets),
            max_criticality=max_crit,
            last_score=last_score,
            last_result=last_result,
        )

        if status == "mapped" and _criticality_weight(max_crit) >= _CRITICALITY_WEIGHT["HIGH"]:
            untested_candidates.append(gap)
        if status == "at_risk" and _criticality_weight(max_crit) >= _CRITICALITY_WEIGHT["HIGH"]:
            failing_candidates.append(gap)

    unmapped = max(0, total_techniques - (validated + at_risk + mapped))

    simple_pct = round((validated / total_techniques) * 100, 2) if total_techniques else 0.0
    weighted_pct = (
        round((weighted_numerator / weighted_denominator) * 100, 2)
        if weighted_denominator
        else 0.0
    )

    # Sort by weight then by least-valuable last_score to surface the worst
    # actionable items first.
    untested_candidates.sort(
        key=lambda g: (-_criticality_weight(g.max_criticality), -g.detection_count)
    )
    failing_candidates.sort(
        key=lambda g: (-_criticality_weight(g.max_criticality), g.last_score or 1.0)
    )

    return CoverageSummary(
        totals=CoverageTotals(
            total_techniques=total_techniques,
            validated=validated,
            at_risk=at_risk,
            mapped=mapped,
            unmapped=unmapped,
        ),
        simple_coverage_percent=simple_pct,
        weighted_coverage_percent=weighted_pct,
        top_untested_high_value=untested_candidates[:5],
        top_failing_high_value=failing_candidates[:5],
        captured_at=datetime.now(timezone.utc),
    )


@router.get("/coverage/trend", response_model=CoverageTrend)
async def get_coverage_trend(
    db: DBSession,
    current_user: CurrentUser,
    days: int = Query(30, ge=1, le=180),
) -> CoverageTrend:
    """Return a daily sparkline of validated-technique count over N days.

    Derived directly from the Test table — no snapshot table needed. For each
    day we compute "how many distinct techniques had at least one PASSing test
    ending on that day". That captures the cumulative-validation-rate curve
    that customers intuitively expect a coverage trend chart to show.
    """
    org_id = require_org_id(current_user)

    since = datetime.now(timezone.utc) - timedelta(days=days)

    # `Test.technique_id` is already denormalized onto the test row at run
    # creation time — no need to join Detection just to read it. Dropping
    # the join is measurable on orgs with lots of tests, and it lets the
    # `ix_tests_org_started_at` composite index serve the query directly.
    stmt = (
        select(
            models.Test.started_at,
            models.Test.result,
            models.Test.technique_id,
        )
        .where(models.Test.organization_id == org_id)
        .where(models.Test.started_at >= since)
        # Telemetry-only runs don't evaluate the full rule so they don't move
        # the coverage needle — same policy as the detection-detail page.
        .where((models.Test.mode != "TELEMETRY_CHECK") | (models.Test.mode.is_(None)))
    )
    rows = (await db.execute(stmt)).all()

    # Group tests per day to compute distinct-validated-techniques per day.
    # A technique is "validated on day D" if at least one test on D returned PASS.
    per_day_tested: Dict[date, set] = {}
    per_day_validated: Dict[date, set] = {}
    for row in rows:
        if not row.started_at or not row.technique_id:
            continue
        day = row.started_at.date() if hasattr(row.started_at, "date") else row.started_at
        per_day_tested.setdefault(day, set()).add(row.technique_id)
        if (row.result or "").upper() == "PASS":
            per_day_validated.setdefault(day, set()).add(row.technique_id)

    points: List[CoverageTrendPoint] = []
    today = datetime.now(timezone.utc).date()
    for offset in range(days - 1, -1, -1):
        d = today - timedelta(days=offset)
        points.append(
            CoverageTrendPoint(
                day=d,
                tested=len(per_day_tested.get(d, ())),
                validated=len(per_day_validated.get(d, ())),
            )
        )

    return CoverageTrend(days=days, points=points)

