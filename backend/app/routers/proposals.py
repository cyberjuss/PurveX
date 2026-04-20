"""``/proposals`` router — the AI remediation guardrail surface.

Endpoints
---------
* ``POST  /proposals``                  create (AI, user, or git)
* ``GET   /proposals``                  list (filter by status)
* ``GET   /proposals/stats``            counts by status (sidebar badge)
* ``GET   /proposals/{id}``             detail with computed diff
* ``POST  /proposals/{id}/approve``     apply the change, audit-log
* ``POST  /proposals/{id}/reject``      dismiss with note

All mutating routes are tenant-scoped on ``current_user`` and rate-limited.
Approval writes the Detection mutation and the AuditEvent in one transaction
so we never apply a change without its audit trail.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from typing_extensions import Annotated

from .. import models, schemas
from ..db import get_db
from ..routers.auth import get_current_user
from ..services.proposal_policy import (
    enforce_create_policy,
    enforce_review_policy,
)
from ..utils.authz import (
    Permission,
    require_detection_create,
    require_detection_delete,
    require_detection_read,
    require_detection_update,
    require_permission,
)
from ..utils.endpoint_rate_limit import endpoint_rate_limit
from ..utils.tenant import require_org_id

logger = logging.getLogger("purvex.api.proposals")

router = APIRouter(
    prefix="/proposals",
    tags=["proposals"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


# Fields we snapshot at create time. Kept in sync with PROPOSAL_EDITABLE_FIELDS
# (schemas.py) so the diff only ever shows rows the proposer is allowed to touch.
_SNAPSHOT_FIELDS = (
    "title",
    "description",
    "sigma_rule",
    "siem_type",
    "siem_query",
    "technique_id",
    "status",
    "criticality",
    "owner",
    "notes",
    "lifecycle_stage",
)


def _snapshot(det: models.Detection) -> dict:
    """Capture the editable slice of a Detection as a JSON-safe dict."""
    snap = {}
    for field in _SNAPSHOT_FIELDS:
        snap[field] = getattr(det, field, None)
    return snap


def _compute_diff(
    target_fields: dict,
    snapshot: dict | None,
    action: str,
) -> tuple[List[schemas.DetectionProposalDiffEntry], bool]:
    """Build the field-level diff and detect drift.

    Returns ``(entries, stale)`` where ``stale`` is True when the snapshot
    no longer matches the target fields' current values — i.e. the
    detection drifted under the proposal while it was pending.
    """
    entries: List[schemas.DetectionProposalDiffEntry] = []
    stale = False
    snap = snapshot or {}
    if action == "delete":
        for field in _SNAPSHOT_FIELDS:
            if field in snap:
                entries.append(
                    schemas.DetectionProposalDiffEntry(
                        field=field, before=snap[field], after=None, changed=True
                    )
                )
        return entries, False
    for field, after in target_fields.items():
        before = snap.get(field)
        entries.append(
            schemas.DetectionProposalDiffEntry(
                field=field,
                before=before,
                after=after,
                changed=(before != after),
            )
        )
    # Drift detection is comparison with the *live* detection, which we
    # don't have here — callers pass a fresh snapshot when they want it.
    return entries, stale


def _load_json(raw: str | None, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


async def _resolve_reviewer_label(
    db: AsyncSession, user_id: Optional[int]
) -> Optional[str]:
    """Turn a user id into a human label for display ("alice@example.com")."""
    if user_id is None:
        return None
    res = await db.execute(select(models.User).where(models.User.id == user_id))
    user = res.scalars().first()
    if user is None:
        return None
    return user.username or user.email or f"user:{user_id}"


async def _to_out(
    db: AsyncSession,
    proposal: models.DetectionProposal,
    *,
    include_live_detection: bool = True,
) -> schemas.DetectionProposalOut:
    """Serialise a proposal ORM row, computing diff + drift.

    When ``include_live_detection`` is True we re-fetch the Detection so
    the diff is rendered against current values (and ``stale`` flips if
    the detection drifted since the snapshot was captured).
    """
    target = _load_json(proposal.target_fields, {})
    snapshot = _load_json(proposal.current_snapshot, {})
    stale = False
    detection_title: Optional[str] = None
    if include_live_detection and proposal.detection_id:
        res = await db.execute(
            select(models.Detection).where(
                models.Detection.id == proposal.detection_id
            )
        )
        live = res.scalars().first()
        if live is not None:
            detection_title = live.title
            live_snapshot = _snapshot(live)
            # Drift only matters for fields we actually care about — compare
            # against the snapshot, not the target, so an already-applied
            # change doesn't look like drift.
            for field in target.keys():
                if snapshot.get(field) != live_snapshot.get(field):
                    stale = True
                    break
            # Prefer the live values for the "before" side of the diff so
            # reviewers see the latest state, not a stale snapshot.
            snapshot = live_snapshot
    diff, _ = _compute_diff(target, snapshot, proposal.action)
    return schemas.DetectionProposalOut(
        id=proposal.id,
        organization_id=proposal.organization_id,
        detection_id=proposal.detection_id,
        detection_title=detection_title,
        proposed_by_kind=proposal.proposed_by_kind,
        proposed_by_user_id=proposal.proposed_by_user_id,
        proposed_by_label=proposal.proposed_by_label,
        action=proposal.action,
        status=proposal.status,
        reason=proposal.reason,
        target_fields=target,
        current_snapshot=snapshot or None,
        diff=diff,
        stale=stale and proposal.status == "pending",
        created_at=proposal.created_at,
        reviewed_at=proposal.reviewed_at,
        reviewed_by_user_id=proposal.reviewed_by_user_id,
        reviewed_by_label=await _resolve_reviewer_label(
            db, proposal.reviewed_by_user_id
        ),
        review_note=proposal.review_note,
    )


# ---------------------------------------------------------------------------
# POST /proposals — create
# ---------------------------------------------------------------------------
@router.post("", response_model=schemas.DetectionProposalOut, status_code=201)
@router.post("/", response_model=schemas.DetectionProposalOut, status_code=201)
async def create_proposal(
    body: schemas.DetectionProposalCreate,
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(max_requests=60, window_seconds=60, key_prefix="proposals:create")
    ),
):
    """Register a pending proposal. The AI path calls this; users can too
    (e.g. "propose a notes change for a peer to approve")."""

    # RBAC gate depends on the action. We require the same permission the
    # reviewer will need — proposing a delete without delete permission is
    # meaningless because you'd never be able to approve it either.
    if body.action == "create":
        await require_detection_create(current_user, db, request)
    elif body.action == "update":
        await require_detection_update(current_user, db, request)
    elif body.action == "delete":
        await require_detection_delete(current_user, db, request)

    org_id = require_org_id(current_user)

    # Resolve the target detection (for update/delete) and enforce tenancy.
    target_detection: Optional[models.Detection] = None
    if body.detection_id:
        res = await db.execute(
            select(models.Detection).where(
                models.Detection.id == body.detection_id,
                models.Detection.organization_id == org_id,
            )
        )
        target_detection = res.scalars().first()
        if target_detection is None:
            raise HTTPException(status_code=404, detail="Detection not found")

    # Guardrails: AI can't delete CRITICAL, touch PROD, escalate to CRITICAL.
    enforce_create_policy(
        proposed_by_kind=body.proposed_by_kind,
        action=body.action,
        target_detection=target_detection,
        target_fields=body.target_fields,
    )

    # update proposals need a non-empty patch; create proposals need at
    # least the non-nullable Detection columns. We only enforce the former
    # here — create is behind a flag and routed through the DaC path later.
    if body.action == "update" and not body.target_fields:
        raise HTTPException(
            status_code=400,
            detail="target_fields cannot be empty for update proposals",
        )

    # Human proposers have a user_id; AI proposers don't.
    proposed_by_user_id: Optional[int] = None
    if body.proposed_by_kind == "user":
        try:
            proposed_by_user_id = int(current_user.id)
        except Exception:
            proposed_by_user_id = None

    snapshot = _snapshot(target_detection) if target_detection else None
    proposal = models.DetectionProposal(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        detection_id=body.detection_id,
        proposed_by_kind=body.proposed_by_kind,
        proposed_by_user_id=proposed_by_user_id,
        proposed_by_label=body.proposed_by_label,
        action=body.action,
        status="pending",
        reason=body.reason,
        target_fields=json.dumps(body.target_fields or {}),
        current_snapshot=json.dumps(snapshot) if snapshot is not None else None,
    )
    db.add(proposal)

    # Audit row — captures the intent even if the proposal is later rejected.
    try:
        actor_id = int(current_user.id)
        actor_email = str(current_user.email)
    except Exception:
        actor_id = None
        actor_email = None
    db.add(
        models.AuditEvent(
            user_id=actor_id,
            user_email=actor_email,
            action="PROPOSAL_CREATED",
            resource_type="detection_proposal",
            resource_id=proposal.id,
            details=json.dumps(
                {
                    "detection_id": body.detection_id,
                    "action": body.action,
                    "proposed_by_kind": body.proposed_by_kind,
                    "fields": list(body.target_fields.keys()),
                }
            ),
        )
    )
    await db.commit()
    await db.refresh(proposal)
    return await _to_out(db, proposal)


# ---------------------------------------------------------------------------
# GET /proposals — list
# ---------------------------------------------------------------------------
@router.get("", response_model=List[schemas.DetectionProposalOut])
@router.get("/", response_model=List[schemas.DetectionProposalOut])
async def list_proposals(
    db: DBSession,
    current_user: CurrentUser,
    status_filter: Optional[str] = Query(None, alias="status"),
    detection_id: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    await require_permission(current_user, Permission.DETECTIONS_READ, db)
    org_id = require_org_id(current_user)
    stmt = (
        select(models.DetectionProposal)
        .where(models.DetectionProposal.organization_id == org_id)
        .order_by(models.DetectionProposal.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    if status_filter:
        if status_filter not in schemas.PROPOSAL_STATUSES:
            raise HTTPException(status_code=400, detail="invalid status filter")
        stmt = stmt.where(models.DetectionProposal.status == status_filter)
    if detection_id:
        stmt = stmt.where(models.DetectionProposal.detection_id == detection_id)
    res = await db.execute(stmt)
    proposals = res.scalars().all()
    # N+1 is acceptable here: page size is capped at 200 and each _to_out
    # fetches at most 2 rows (Detection + reviewer User). If this becomes
    # hot we can batch in a second SELECT.
    return [await _to_out(db, p) for p in proposals]


# ---------------------------------------------------------------------------
# GET /proposals/stats — sidebar badge counts
# ---------------------------------------------------------------------------
@router.get("/stats", response_model=schemas.DetectionProposalStats)
async def proposal_stats(db: DBSession, current_user: CurrentUser):
    await require_permission(current_user, Permission.DETECTIONS_READ, db)
    org_id = require_org_id(current_user)
    stmt = (
        select(models.DetectionProposal.status, func.count())
        .where(models.DetectionProposal.organization_id == org_id)
        .group_by(models.DetectionProposal.status)
    )
    res = await db.execute(stmt)
    counts = {row[0]: int(row[1]) for row in res.all()}
    return schemas.DetectionProposalStats(
        pending=counts.get("pending", 0),
        approved=counts.get("approved", 0),
        applied=counts.get("applied", 0),
        rejected=counts.get("rejected", 0),
        superseded=counts.get("superseded", 0),
    )


# ---------------------------------------------------------------------------
# GET /proposals/{id} — detail with diff
# ---------------------------------------------------------------------------
@router.get("/{proposal_id}", response_model=schemas.DetectionProposalOut)
async def get_proposal(
    proposal_id: str,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.DETECTIONS_READ, db)
    org_id = require_org_id(current_user)
    res = await db.execute(
        select(models.DetectionProposal).where(
            models.DetectionProposal.id == proposal_id,
            models.DetectionProposal.organization_id == org_id,
        )
    )
    proposal = res.scalars().first()
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return await _to_out(db, proposal)


# ---------------------------------------------------------------------------
# POST /proposals/{id}/approve — apply
# ---------------------------------------------------------------------------
@router.post(
    "/{proposal_id}/approve",
    response_model=schemas.DetectionProposalOut,
)
async def approve_proposal(
    proposal_id: str,
    body: schemas.DetectionProposalReview,
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(max_requests=60, window_seconds=60, key_prefix="proposals:approve")
    ),
):
    """Apply the proposal's change to the target Detection.

    We re-check RBAC here (not just at create time) because a proposal
    may have been filed by one user and is being reviewed by another.
    The reviewer must have the permission appropriate for the action,
    and — via ``enforce_review_policy`` — cannot be the proposer.
    """
    org_id = require_org_id(current_user)
    res = await db.execute(
        select(models.DetectionProposal).where(
            models.DetectionProposal.id == proposal_id,
            models.DetectionProposal.organization_id == org_id,
        )
    )
    proposal = res.scalars().first()
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found")

    # Action-specific RBAC. The review policy blocks self-approval.
    try:
        reviewer_user_id = int(current_user.id)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid reviewer") from exc
    enforce_review_policy(proposal=proposal, reviewer_user_id=reviewer_user_id)

    if proposal.action == "create":
        await require_detection_create(current_user, db, request)
    elif proposal.action == "update":
        await require_detection_update(current_user, db, request)
    elif proposal.action == "delete":
        await require_detection_delete(current_user, db, request)

    target_fields = _load_json(proposal.target_fields, {})
    snapshot = _load_json(proposal.current_snapshot, {})

    live: Optional[models.Detection] = None
    if proposal.detection_id:
        res = await db.execute(
            select(models.Detection).where(
                models.Detection.id == proposal.detection_id,
                models.Detection.organization_id == org_id,
            )
        )
        live = res.scalars().first()

    # For update/delete the target must still exist AND the snapshot must
    # still match on the fields being changed — otherwise mark superseded
    # rather than silently stomping a concurrent edit.
    if proposal.action in {"update", "delete"}:
        if live is None:
            proposal.status = "superseded"
            proposal.reviewed_at = datetime.now(timezone.utc)
            proposal.reviewed_by_user_id = reviewer_user_id
            proposal.review_note = "Target detection no longer exists."
            await db.commit()
            await db.refresh(proposal)
            return await _to_out(db, proposal)
        live_snapshot = _snapshot(live)
        drifted = any(
            snapshot.get(f) != live_snapshot.get(f) for f in target_fields
        )
        if drifted:
            proposal.status = "superseded"
            proposal.reviewed_at = datetime.now(timezone.utc)
            proposal.reviewed_by_user_id = reviewer_user_id
            proposal.review_note = (
                "Target detection drifted; re-propose against current state."
            )
            await db.commit()
            await db.refresh(proposal)
            return await _to_out(db, proposal)

    # Apply the change.
    if proposal.action == "update" and live is not None:
        for field, value in target_fields.items():
            setattr(live, field, value)
        live.last_updated_at = datetime.now(timezone.utc)
    elif proposal.action == "delete" and live is not None:
        await db.delete(live)
    elif proposal.action == "create":
        # Create proposals go through a separate codepath (DaC) so we
        # intentionally don't apply them here in V1. Mark approved but
        # not applied so an operator can pick it up manually.
        proposal.status = "approved"
        proposal.reviewed_at = datetime.now(timezone.utc)
        proposal.reviewed_by_user_id = reviewer_user_id
        proposal.review_note = body.note
        await db.commit()
        await db.refresh(proposal)
        return await _to_out(db, proposal)

    proposal.status = "applied"
    proposal.reviewed_at = datetime.now(timezone.utc)
    proposal.reviewed_by_user_id = reviewer_user_id
    proposal.review_note = body.note

    try:
        actor_id = int(current_user.id)
        actor_email = str(current_user.email)
    except Exception:
        actor_id = None
        actor_email = None
    db.add(
        models.AuditEvent(
            user_id=actor_id,
            user_email=actor_email,
            action="PROPOSAL_APPLIED",
            resource_type="detection_proposal",
            resource_id=proposal.id,
            details=json.dumps(
                {
                    "detection_id": proposal.detection_id,
                    "action": proposal.action,
                    "proposed_by_kind": proposal.proposed_by_kind,
                    "fields": list(target_fields.keys()),
                }
            ),
        )
    )
    await db.commit()
    await db.refresh(proposal)
    return await _to_out(db, proposal)


# ---------------------------------------------------------------------------
# POST /proposals/{id}/reject — dismiss
# ---------------------------------------------------------------------------
@router.post(
    "/{proposal_id}/reject",
    response_model=schemas.DetectionProposalOut,
)
async def reject_proposal(
    proposal_id: str,
    body: schemas.DetectionProposalReview,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(max_requests=60, window_seconds=60, key_prefix="proposals:reject")
    ),
):
    await require_permission(current_user, Permission.DETECTIONS_READ, db)
    org_id = require_org_id(current_user)
    res = await db.execute(
        select(models.DetectionProposal).where(
            models.DetectionProposal.id == proposal_id,
            models.DetectionProposal.organization_id == org_id,
        )
    )
    proposal = res.scalars().first()
    if proposal is None:
        raise HTTPException(status_code=404, detail="Proposal not found")

    try:
        reviewer_user_id = int(current_user.id)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid reviewer") from exc
    enforce_review_policy(proposal=proposal, reviewer_user_id=reviewer_user_id)

    proposal.status = "rejected"
    proposal.reviewed_at = datetime.now(timezone.utc)
    proposal.reviewed_by_user_id = reviewer_user_id
    proposal.review_note = body.note

    try:
        actor_id = int(current_user.id)
        actor_email = str(current_user.email)
    except Exception:
        actor_id = None
        actor_email = None
    db.add(
        models.AuditEvent(
            user_id=actor_id,
            user_email=actor_email,
            action="PROPOSAL_REJECTED",
            resource_type="detection_proposal",
            resource_id=proposal.id,
            details=json.dumps(
                {
                    "detection_id": proposal.detection_id,
                    "note": body.note,
                }
            ),
        )
    )
    await db.commit()
    await db.refresh(proposal)
    return await _to_out(db, proposal)
