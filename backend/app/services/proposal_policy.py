"""Policy guardrails for :class:`DetectionProposal`.

Kept in one file so the rules are auditable and easy to extend. Every check
raises :class:`HTTPException` with a stable ``detail`` string — the frontend
matches on these to render useful user-facing messages (see
``/proposals`` inbox).

Design notes:

* We enforce at *creation* time (not just review) so an AI that tries to
  delete a CRITICAL rule never even gets a row — it fails closed and the
  assistant sees an explicit 4xx.
* Self-approval is a separate check because it can only be evaluated with
  the reviewer user in hand, which the creation path doesn't have.
* The ``supersede_pending_for_*`` helpers are the *only* way to bulk-cancel
  pending proposals when the upstream resource (a Detection or a
  DetectionSource) gets removed. Callers must invoke them in the same
  transaction as the parent delete to keep the inbox consistent.
* No LLM I/O here. The supersede helpers do touch the DB; everything else
  stays pure for fast unit testing.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable, List, Mapping, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..schemas import PROPOSAL_EDITABLE_FIELDS


# Criticality tiers that the AI kind ("ai") is not allowed to delete.
# Users can still propose the delete and another user can approve it.
_AI_BLOCK_DELETE_CRITICALITY = {"CRITICAL"}

# Lifecycle stages the AI kind is not allowed to touch at all. "prod"
# means the rule is actively alerting in a production environment;
# changes there go through the slower DaC path (Sprint 3).
_AI_BLOCK_LIFECYCLE_STAGES = {"prod", "produce", "production"}


def enforce_create_policy(
    *,
    proposed_by_kind: str,
    action: str,
    target_detection: Optional[models.Detection],
    target_fields: Mapping[str, Any],
) -> None:
    """Apply creation-time guardrails. Raises HTTPException on violation."""

    # 1. Field whitelist is enforced by Pydantic, but we defence-in-depth
    # here too in case a future router skips schema validation.
    invalid = [k for k in target_fields if k not in PROPOSAL_EDITABLE_FIELDS]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"fields not allowed in proposals: {sorted(invalid)}",
        )

    # 2. update requires a non-empty patch. "create" with an empty payload
    # is caught at the router layer (it consults the Detection schema for
    # required fields); "delete" doesn't carry a patch.
    if action == "update" and not target_fields:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="target_fields cannot be empty for update proposals",
        )

    # 3. update / delete require a target_detection.
    if action in {"update", "delete"} and target_detection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="detection_id is required for update/delete proposals",
        )

    if proposed_by_kind != "ai":
        # User-authored and git-authored proposals skip the AI-specific
        # guardrails below — those paths already have explicit human
        # intent (a PR or a form click).
        return

    # 4. AI cannot delete CRITICAL detections outright.
    if (
        action == "delete"
        and target_detection is not None
        and (target_detection.criticality or "").upper()
        in _AI_BLOCK_DELETE_CRITICALITY
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "AI cannot propose deletion of CRITICAL detections. "
                "Have a human reviewer file the proposal instead."
            ),
        )

    # 5. AI cannot touch PROD-lifecycle detections.
    if target_detection is not None and (
        (target_detection.lifecycle_stage or "").lower()
        in _AI_BLOCK_LIFECYCLE_STAGES
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "AI cannot modify detections in the PROD lifecycle stage. "
                "Promote the change through Detection-as-Code instead."
            ),
        )

    # 6. AI cannot flip a detection's criticality up into the block tier
    # (escalating a LOW rule into CRITICAL silently would be a footgun).
    if action == "update" and "criticality" in target_fields:
        new_crit = str(target_fields["criticality"] or "").upper()
        if new_crit in _AI_BLOCK_DELETE_CRITICALITY:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "AI cannot escalate a detection to CRITICAL. "
                    "Requires human proposer."
                ),
            )


def enforce_review_policy(
    *,
    proposal: models.DetectionProposal,
    reviewer_user_id: int,
) -> None:
    """Apply review-time guardrails. Raises HTTPException on violation."""

    if proposal.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"proposal is already {proposal.status}",
        )

    # Four-eyes: a user cannot approve/reject their own proposal. AI
    # proposers have no user_id so this check only bites user-authored
    # proposals.
    if (
        proposal.proposed_by_user_id is not None
        and proposal.proposed_by_user_id == reviewer_user_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You cannot review your own proposal.",
        )


async def _supersede_proposals(
    db: AsyncSession,
    *,
    proposals: Iterable[models.DetectionProposal],
    note: str,
) -> int:
    """Mark a batch of pending proposals as superseded with a uniform note.
    Returns the count actually transitioned (rows already in a terminal
    state are left alone, so the helper is idempotent).
    """
    now = datetime.now(timezone.utc)
    transitioned = 0
    for proposal in proposals:
        if proposal.status != "pending":
            continue
        proposal.status = "superseded"
        proposal.reviewed_at = now
        proposal.review_note = note
        transitioned += 1
    return transitioned


async def supersede_pending_for_detection(
    db: AsyncSession,
    *,
    organization_id: int,
    detection_id: str,
) -> int:
    """Supersede every pending proposal targeting ``detection_id``.

    Called immediately before a Detection delete so the inbox doesn't
    show ghost rows pointing at a non-existent target. Idempotent — safe
    to call even if no pending proposals exist.
    """
    res = await db.execute(
        select(models.DetectionProposal).where(
            models.DetectionProposal.organization_id == organization_id,
            models.DetectionProposal.detection_id == detection_id,
            models.DetectionProposal.status == "pending",
        )
    )
    proposals: List[models.DetectionProposal] = list(res.scalars())
    return await _supersede_proposals(
        db,
        proposals=proposals,
        note="Target detection was deleted before this proposal was reviewed.",
    )


async def supersede_pending_for_source(
    db: AsyncSession,
    *,
    organization_id: int,
    detection_source_id: int,
) -> int:
    """Supersede every pending git-authored proposal whose target detection
    came from a now-removed :class:`DetectionSource`. Run in the same
    transaction as the source delete.
    """
    res = await db.execute(
        select(models.DetectionProposal)
        .join(
            models.Detection,
            models.Detection.id == models.DetectionProposal.detection_id,
        )
        .where(
            models.DetectionProposal.organization_id == organization_id,
            models.DetectionProposal.proposed_by_kind == "git",
            models.DetectionProposal.status == "pending",
            models.Detection.detection_source_id == detection_source_id,
        )
    )
    proposals: List[models.DetectionProposal] = list(res.scalars())
    return await _supersede_proposals(
        db,
        proposals=proposals,
        note="Originating detection source was removed before this proposal was reviewed.",
    )
