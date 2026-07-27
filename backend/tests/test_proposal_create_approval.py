"""Tests for approving a ``create`` DetectionProposal.

Previously ``approve_proposal`` left "create" proposals at status
"approved" without ever materializing a Detection row — the documented
state machine (models.py: DetectionProposal.status) says "approved" is
transitional and approval should eagerly apply. This covers the fix:
approval now builds the Detection from ``target_fields`` and the proposal
ends at "applied", matching update/delete.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def proposals_context():
    from app import models

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        proposer = models.User(
            id=1, username="proposer", email="proposer@example.test",
            hashed_password="not-used", organization_id=1,
            is_active=True, is_admin=True,
        )
        reviewer = models.User(
            id=2, username="reviewer", email="reviewer@example.test",
            hashed_password="not-used", organization_id=1,
            is_active=True, is_admin=True,
        )
        session.add_all([org, proposer, reviewer])
        await session.commit()
        yield session, proposer, reviewer

    await engine.dispose()


async def _count_audit(session, models, action: str) -> int:
    res = await session.execute(
        select(func.count()).select_from(models.AuditEvent).where(
            models.AuditEvent.action == action
        )
    )
    return int(res.scalar_one())


@pytest.mark.asyncio
async def test_create_proposal_requires_siem_fields(proposals_context):
    from app import schemas
    import app.routers.proposals as proposals
    session, proposer, _ = proposals_context

    with pytest.raises(HTTPException) as exc:
        await proposals.create_proposal(
            body=schemas.DetectionProposalCreate(
                action="create",
                proposed_by_kind="ai",
                target_fields={"title": "New rule"},  # missing siem_type/siem_query
            ),
            request=None,
            db=session,
            current_user=proposer,
        )
    assert exc.value.status_code == 400
    assert "siem_type" in exc.value.detail or "siem_query" in exc.value.detail


@pytest.mark.asyncio
async def test_approve_create_proposal_materializes_detection(proposals_context):
    from app import models, schemas
    import app.routers.proposals as proposals
    session, proposer, reviewer = proposals_context

    out = await proposals.create_proposal(
        body=schemas.DetectionProposalCreate(
            action="create",
            proposed_by_kind="ai",
            reason="Cover new lateral movement technique.",
            target_fields={
                "title": "New PsExec Detection",
                "technique_id": "T1021.002",
                "siem_type": "splunk",
                "siem_query": "index=main process=psexec.exe",
                "criticality": "HIGH",
            },
        ),
        request=None,
        db=session,
        current_user=proposer,
    )
    assert out.status == "pending"
    assert out.detection_id is None

    approved = await proposals.approve_proposal(
        proposal_id=out.id,
        body=schemas.DetectionProposalReview(note="Looks good, ship it"),
        request=None,
        db=session,
        current_user=reviewer,
    )

    # The proposal is fully applied — no more stuck "approved" limbo.
    assert approved.status == "applied"
    assert approved.detection_id is not None

    detection = await session.get(models.Detection, approved.detection_id)
    assert detection is not None
    assert detection.organization_id == 1
    assert detection.title == "New PsExec Detection"
    assert detection.technique_id == "T1021.002"
    assert detection.siem_type == "splunk"
    assert detection.siem_query == "index=main process=psexec.exe"
    assert detection.criticality == "HIGH"
    assert detection.source == "manual"

    assert await _count_audit(session, models, "PROPOSAL_APPLIED") == 1


@pytest.mark.asyncio
async def test_approve_create_proposal_missing_field_blocked_at_approval(proposals_context):
    """A proposal created before the propose-time guard existed (or via a
    path that bypassed it) must still be rejected at approval time rather
    than silently inserting a Detection with a NULL siem_query."""
    from app import models, schemas
    import app.routers.proposals as proposals
    session, proposer, reviewer = proposals_context

    proposal = models.DetectionProposal(
        id=str(uuid.uuid4()),
        organization_id=1,
        detection_id=None,
        proposed_by_kind="ai",
        proposed_by_label="AI Assistant",
        action="create",
        status="pending",
        target_fields='{"title": "Incomplete rule", "siem_type": "splunk"}',
    )
    session.add(proposal)
    await session.commit()

    with pytest.raises(HTTPException) as exc:
        await proposals.approve_proposal(
            proposal_id=proposal.id,
            body=schemas.DetectionProposalReview(),
            request=None,
            db=session,
            current_user=reviewer,
        )
    assert exc.value.status_code == 422

    refreshed = await session.get(models.DetectionProposal, proposal.id)
    assert refreshed.status == "pending"  # unchanged, no partial apply
