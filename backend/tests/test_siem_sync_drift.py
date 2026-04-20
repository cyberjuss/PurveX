"""Tests for SIEM-sync drift detection (Sprint 4 Phase 1).

Covers
------
* First sync creates ``source`` detections with a populated snapshot.
* Second sync with unchanged upstream is a no-op (``skip`` events).
* Upstream change + no local edits ⇒ in-place update + ``update`` event.
* Upstream change + local edit on tracked field ⇒ proposal raised, live
  row unchanged on tracked fields, ``propose`` event emitted.
* Legacy row with no snapshot gets a snapshot populated without a
  spurious proposal (backfill semantics).

Uses a stub SIEM universal service so we don't touch the network.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


class _StubUniversal:
    """Minimal stub matching ``SIEMUniversalService`` interface used by
    ``detection_sync.sync_connection``."""

    def __init__(self, rules):
        self._rules = rules

    def has_credentials(self) -> bool:
        return True

    async def get_rules(self, limit: int = 500):
        return self._rules


def _patch_service(monkeypatch, rules):
    """Force ``SIEMUniversalService(conn)`` to return a stub with fixed rules."""
    from app.services import detection_sync

    monkeypatch.setattr(
        detection_sync,
        "SIEMUniversalService",
        lambda conn: _StubUniversal(rules),
    )


@pytest_asyncio.fixture
async def sync_context():
    from app import models

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sm = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
    async with sm() as session:
        org = models.Organization(id=1, name="T")
        conn = models.SIEMConnection(
            organization_id=1,
            siem_type="splunk",
            name="primary",
            url="https://splunk.test",
            auth_type="token",
            credentials="{}",
        )
        session.add_all([org, conn])
        await session.commit()
        await session.refresh(conn)
        yield session, conn, models
    await engine.dispose()


@pytest.mark.asyncio
async def test_first_sync_creates_detection_with_snapshot(
    monkeypatch, sync_context
):
    from app.services.detection_sync import sync_connection

    session, conn, models = sync_context
    rules = [
        {
            "rule_id": "r1",
            "name": "PowerShell base64",
            "query": "index=main EncodedCommand",
            "severity": "high",
            "description": "Base64 PS",
            "techniques": ["T1059.001"],
            "enabled": True,
        }
    ]
    _patch_service(monkeypatch, rules)

    report = await sync_connection(session, conn)
    assert report.created == 1
    assert report.updated == 0
    assert report.proposals == 0
    assert any(e.action == "create" for e in report.events)

    det = (
        await session.execute(
            select(models.Detection).where(
                models.Detection.siem_connection_id == conn.id
            )
        )
    ).scalar_one()
    assert det.source == "siem_sync"
    assert det.source_payload is not None
    assert "index=main EncodedCommand" in det.source_payload
    assert det.content_hash


@pytest.mark.asyncio
async def test_second_sync_is_noop_when_upstream_unchanged(
    monkeypatch, sync_context
):
    from app.services.detection_sync import sync_connection

    session, conn, models = sync_context
    rules = [
        {
            "rule_id": "r1",
            "name": "rule",
            "query": "q",
            "severity": "medium",
            "techniques": ["T1059"],
            "enabled": True,
        }
    ]
    _patch_service(monkeypatch, rules)

    await sync_connection(session, conn)
    report = await sync_connection(session, conn)
    assert report.created == 0
    assert report.updated == 0
    assert report.proposals == 0
    assert report.unchanged == 1
    assert all(e.action == "skip" for e in report.events)


@pytest.mark.asyncio
async def test_upstream_change_without_local_edit_applies_in_place(
    monkeypatch, sync_context
):
    from app.services.detection_sync import sync_connection

    session, conn, models = sync_context

    # First sync with initial rule.
    _patch_service(
        monkeypatch,
        [
            {
                "rule_id": "r1",
                "name": "first",
                "query": "q1",
                "severity": "medium",
                "techniques": ["T1059"],
                "enabled": True,
            }
        ],
    )
    await sync_connection(session, conn)

    # Second sync with upstream changes on query and severity.
    _patch_service(
        monkeypatch,
        [
            {
                "rule_id": "r1",
                "name": "first",
                "query": "q2",  # changed
                "severity": "high",  # changed
                "techniques": ["T1059"],
                "enabled": True,
            }
        ],
    )
    report = await sync_connection(session, conn)

    assert report.updated == 1
    assert report.proposals == 0
    assert any(e.action == "update" for e in report.events)

    det = (
        await session.execute(select(models.Detection))
    ).scalar_one()
    assert det.siem_query == "q2"
    assert det.criticality == "HIGH"


@pytest.mark.asyncio
async def test_upstream_change_with_local_edit_raises_proposal(
    monkeypatch, sync_context
):
    from app.services.detection_sync import sync_connection

    session, conn, models = sync_context

    _patch_service(
        monkeypatch,
        [
            {
                "rule_id": "r1",
                "name": "base",
                "query": "original",
                "severity": "medium",
                "techniques": ["T1059"],
                "enabled": True,
            }
        ],
    )
    await sync_connection(session, conn)

    # Simulate an analyst tuning the query locally in PurveX.
    det = (await session.execute(select(models.Detection))).scalar_one()
    det.siem_query = "original | where user!=\"svc_noise\""
    await session.commit()

    # Upstream changes criticality.
    _patch_service(
        monkeypatch,
        [
            {
                "rule_id": "r1",
                "name": "base",
                "query": "original",
                "severity": "critical",  # changed
                "techniques": ["T1059"],
                "enabled": True,
            }
        ],
    )
    report = await sync_connection(session, conn)

    assert report.proposals == 1
    assert report.updated == 0
    assert any(e.action == "propose" for e in report.events)

    # Live row's tuned query was NOT clobbered.
    refreshed = (
        await session.execute(select(models.Detection))
    ).scalar_one()
    assert refreshed.siem_query == "original | where user!=\"svc_noise\""
    # A proposal now exists for this detection.
    proposals = (
        await session.execute(
            select(models.DetectionProposal).where(
                models.DetectionProposal.detection_id == refreshed.id
            )
        )
    ).scalars().all()
    assert len(proposals) == 1
    assert proposals[0].proposed_by_kind == "siem"
    assert proposals[0].status == "pending"


@pytest.mark.asyncio
async def test_legacy_row_without_snapshot_backfills_without_proposal(
    monkeypatch, sync_context
):
    """Rows predating ``source_payload`` must sync without spamming proposals."""
    from app.services.detection_sync import sync_connection

    session, conn, models = sync_context

    legacy = models.Detection(
        id=str(uuid.uuid4()),
        organization_id=1,
        technique_id="T1059",
        title="legacy",
        siem_type="splunk",
        siem_query="q_old",
        criticality="MEDIUM",
        source="siem_sync",
        siem_connection_id=conn.id,
        external_id="r1",
        content_hash="stale",
        source_payload=None,  # legacy
    )
    session.add(legacy)
    await session.commit()

    _patch_service(
        monkeypatch,
        [
            {
                "rule_id": "r1",
                "name": "legacy",
                "query": "q_new",
                "severity": "high",
                "techniques": ["T1059"],
                "enabled": True,
            }
        ],
    )
    report = await sync_connection(session, conn)
    assert report.proposals == 0
    # Safe to apply because we had no snapshot → assume no drift.
    assert report.updated == 1
    refreshed = (
        await session.execute(
            select(models.Detection).where(models.Detection.id == legacy.id)
        )
    ).scalar_one()
    assert refreshed.source_payload is not None
    assert refreshed.siem_query == "q_new"
