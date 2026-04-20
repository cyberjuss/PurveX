"""Tests for the AI remediation guardrail endpoints (``/proposals``).

Covers:

* Policy guardrails are enforced at creation (AI can't delete CRITICAL,
  AI can't touch PROD, AI can't escalate to CRITICAL).
* Approval applies the change to the Detection and writes an AuditEvent.
* Rejection preserves the proposal with the reviewer note.
* Self-approval is blocked (four-eyes).
* Concurrent edits mark the proposal ``superseded`` rather than stomping.
* Stats endpoint returns the right counts per status.

We call router functions directly, matching the pattern in
``test_coverage_summary.py``. Admin users short-circuit RBAC in
``require_permission``, so we get to exercise our policy logic without
mocking the RBAC service.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def proposals_context():
    """Spin up an in-memory DB with two users so four-eyes tests have a reviewer."""
    from app import models
    import app.routers.proposals as proposals_router

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        proposer = models.User(
            id=1,
            username="proposer",
            email="proposer@example.test",
            hashed_password="not-used",
            organization_id=1,
            is_active=True,
            is_admin=True,
        )
        reviewer = models.User(
            id=2,
            username="reviewer",
            email="reviewer@example.test",
            hashed_password="not-used",
            organization_id=1,
            is_active=True,
            is_admin=True,
        )
        session.add_all([org, proposer, reviewer])
        await session.commit()
        yield proposals_router, session, proposer, reviewer

    await engine.dispose()


async def _seed_detection(session, models, **overrides):
    defaults = dict(
        id=str(uuid.uuid4()),
        title="Baseline Rule",
        description="",
        technique_id="T1059.001",
        criticality="HIGH",
        organization_id=1,
        status="ACTIVE",
        lifecycle_stage="identify",
        siem_type="splunk",
        siem_query="index=main event=baseline",
    )
    defaults.update(overrides)
    det = models.Detection(**defaults)
    session.add(det)
    await session.commit()
    return det


async def _count_audit(session, models, action: str) -> int:
    res = await session.execute(
        select(func.count()).select_from(models.AuditEvent).where(
            models.AuditEvent.action == action
        )
    )
    return int(res.scalar_one())


# ---------------------------------------------------------------------------
# Create / happy path
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_create_update_proposal_captures_snapshot_and_audit(proposals_context):
    from app import models, schemas
    proposals, session, proposer, _ = proposals_context
    det = await _seed_detection(session, models)

    body = schemas.DetectionProposalCreate(
        detection_id=det.id,
        action="update",
        proposed_by_kind="ai",
        proposed_by_label="PurveX Assistant",
        reason="Too many false positives; tighten the query.",
        target_fields={"siem_query": "index=main event=baseline process=powershell.exe"},
    )
    out = await proposals.create_proposal(
        body=body, request=None, db=session, current_user=proposer
    )

    assert out.status == "pending"
    assert out.detection_id == det.id
    # Snapshot was captured so reviewers can see "before".
    assert out.current_snapshot["siem_query"] == "index=main event=baseline"
    # Diff is computed at read time against the current detection.
    diff_fields = {e.field: e for e in out.diff}
    assert "siem_query" in diff_fields
    assert diff_fields["siem_query"].changed is True
    # Audit event was written.
    assert await _count_audit(session, models, "PROPOSAL_CREATED") == 1


# ---------------------------------------------------------------------------
# Approval applies + audits
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_approve_applies_change_and_writes_audit(proposals_context):
    from app import models, schemas
    proposals, session, proposer, reviewer = proposals_context
    det = await _seed_detection(session, models)

    # Proposer (id=1) files; reviewer (id=2) approves — four-eyes OK.
    out = await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            detection_id=det.id,
            action="update",
            proposed_by_kind="user",  # user-authored to exercise proposer_user_id
            target_fields={"notes": "Reviewed 2026-04-19"},
        ),
        request=None,
        db=session,
        current_user=proposer,
    )

    approved = await proposals.approve_proposal(
        proposal_id=out.id,
        body=schemas.DetectionProposalReview(note="Looks good"),
        request=None,
        db=session,
        current_user=reviewer,
    )

    assert approved.status == "applied"
    assert approved.reviewed_by_user_id == 2
    assert approved.review_note == "Looks good"
    # Detection was actually mutated.
    live = await session.get(models.Detection, det.id)
    assert live.notes == "Reviewed 2026-04-19"
    # Both create + apply audit events landed.
    assert await _count_audit(session, models, "PROPOSAL_CREATED") == 1
    assert await _count_audit(session, models, "PROPOSAL_APPLIED") == 1


# ---------------------------------------------------------------------------
# Policy: AI cannot delete CRITICAL
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ai_cannot_delete_critical_detection(proposals_context):
    from app import models, schemas
    proposals, session, proposer, _ = proposals_context
    det = await _seed_detection(session, models, criticality="CRITICAL")

    with pytest.raises(HTTPException) as exc:
        await proposals.create_proposal(
            body=schemas.DetectionProposalCreate(
                detection_id=det.id,
                action="delete",
                proposed_by_kind="ai",
            ),
            request=None,
            db=session,
            current_user=proposer,
        )
    assert exc.value.status_code == 403
    assert "CRITICAL" in exc.value.detail


# ---------------------------------------------------------------------------
# Policy: AI cannot touch PROD lifecycle
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ai_cannot_modify_prod_lifecycle(proposals_context):
    from app import models, schemas
    proposals, session, proposer, _ = proposals_context
    det = await _seed_detection(session, models, lifecycle_stage="prod")

    with pytest.raises(HTTPException) as exc:
        await proposals.create_proposal(
            body=schemas.DetectionProposalCreate(
                detection_id=det.id,
                action="update",
                proposed_by_kind="ai",
                target_fields={"notes": "tweak"},
            ),
            request=None,
            db=session,
            current_user=proposer,
        )
    assert exc.value.status_code == 403
    assert "PROD" in exc.value.detail


# ---------------------------------------------------------------------------
# Policy: AI cannot escalate to CRITICAL
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_ai_cannot_escalate_to_critical(proposals_context):
    from app import models, schemas
    proposals, session, proposer, _ = proposals_context
    det = await _seed_detection(session, models, criticality="LOW")

    with pytest.raises(HTTPException) as exc:
        await proposals.create_proposal(
            body=schemas.DetectionProposalCreate(
                detection_id=det.id,
                action="update",
                proposed_by_kind="ai",
                target_fields={"criticality": "CRITICAL"},
            ),
            request=None,
            db=session,
            current_user=proposer,
        )
    assert exc.value.status_code == 403
    assert "CRITICAL" in exc.value.detail


# ---------------------------------------------------------------------------
# Policy: reviewer cannot approve own user-proposal (four-eyes)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_self_approval_blocked(proposals_context):
    from app import models, schemas
    proposals, session, proposer, _ = proposals_context
    det = await _seed_detection(session, models)

    out = await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            detection_id=det.id,
            action="update",
            proposed_by_kind="user",
            target_fields={"notes": "self-approve should fail"},
        ),
        request=None,
        db=session,
        current_user=proposer,
    )
    with pytest.raises(HTTPException) as exc:
        await proposals.approve_proposal(
            proposal_id=out.id,
            body=schemas.DetectionProposalReview(),
            request=None,
            db=session,
            current_user=proposer,  # same user who filed
        )
    assert exc.value.status_code == 403
    assert "own proposal" in exc.value.detail


# ---------------------------------------------------------------------------
# Drift: if the detection changes between propose and approve, mark superseded
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_concurrent_edit_marks_proposal_superseded(proposals_context):
    from app import models, schemas
    proposals, session, proposer, reviewer = proposals_context
    det = await _seed_detection(session, models)

    out = await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            detection_id=det.id,
            action="update",
            proposed_by_kind="ai",
            target_fields={"siem_query": "index=main new=value"},
        ),
        request=None,
        db=session,
        current_user=proposer,
    )

    # Simulate a concurrent edit on the same field.
    det.siem_query = "index=main changed=elsewhere"
    await session.commit()

    result = await proposals.approve_proposal(
        proposal_id=out.id,
        body=schemas.DetectionProposalReview(),
        request=None,
        db=session,
        current_user=reviewer,
    )
    assert result.status == "superseded"
    # The change was NOT applied.
    live = await session.get(models.Detection, det.id)
    assert live.siem_query == "index=main changed=elsewhere"


# ---------------------------------------------------------------------------
# Reject writes a rejected row + audit event
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_reject_preserves_note_and_audit(proposals_context):
    from app import models, schemas
    proposals, session, proposer, reviewer = proposals_context
    det = await _seed_detection(session, models)

    out = await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            detection_id=det.id,
            action="update",
            proposed_by_kind="ai",
            target_fields={"notes": "noisy suggestion"},
        ),
        request=None,
        db=session,
        current_user=proposer,
    )
    rejected = await proposals.reject_proposal(
        proposal_id=out.id,
        body=schemas.DetectionProposalReview(note="Doesn't address root cause"),
        db=session,
        current_user=reviewer,
    )
    assert rejected.status == "rejected"
    assert rejected.review_note == "Doesn't address root cause"
    assert await _count_audit(session, models, "PROPOSAL_REJECTED") == 1


# ---------------------------------------------------------------------------
# Stats endpoint groups by status
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_stats_counts_by_status(proposals_context):
    from app import models, schemas
    proposals, session, proposer, reviewer = proposals_context
    det1 = await _seed_detection(session, models, title="A")
    det2 = await _seed_detection(session, models, title="B")

    # Two pending, one applied, one rejected.
    p1 = await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            detection_id=det1.id, action="update", proposed_by_kind="ai",
            target_fields={"notes": "a"},
        ),
        request=None, db=session, current_user=proposer,
    )
    p2 = await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            detection_id=det2.id, action="update", proposed_by_kind="ai",
            target_fields={"notes": "b"},
        ),
        request=None, db=session, current_user=proposer,
    )
    await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            detection_id=det1.id, action="update", proposed_by_kind="ai",
            target_fields={"notes": "c"},
        ),
        request=None, db=session, current_user=proposer,
    )
    await proposals.approve_proposal(
        proposal_id=p1.id, body=schemas.DetectionProposalReview(),
        request=None, db=session, current_user=reviewer,
    )
    await proposals.reject_proposal(
        proposal_id=p2.id, body=schemas.DetectionProposalReview(note="nope"),
        db=session, current_user=reviewer,
    )

    stats = await proposals.proposal_stats(db=session, current_user=proposer)
    assert stats.pending == 1
    assert stats.applied == 1
    assert stats.rejected == 1


# ---------------------------------------------------------------------------
# List + filter by status
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_list_filters_by_status(proposals_context):
    from app import models, schemas
    proposals, session, proposer, reviewer = proposals_context
    det = await _seed_detection(session, models)

    p = await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            detection_id=det.id, action="update", proposed_by_kind="ai",
            target_fields={"notes": "pending"},
        ),
        request=None, db=session, current_user=proposer,
    )
    await proposals.reject_proposal(
        proposal_id=p.id, body=schemas.DetectionProposalReview(note="no"),
        db=session, current_user=reviewer,
    )
    pending = await proposals.list_proposals(
        db=session,
        current_user=proposer,
        status_filter="pending",
        detection_id=None,
        skip=0,
        limit=50,
    )
    rejected = await proposals.list_proposals(
        db=session,
        current_user=proposer,
        status_filter="rejected",
        detection_id=None,
        skip=0,
        limit=50,
    )
    assert pending == []
    assert len(rejected) == 1
    assert rejected[0].status == "rejected"
