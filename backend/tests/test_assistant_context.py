"""Tests for the Watchtower assistant context builders.

These guard the grounding signal that gets sent to the LLM. The actual LLM
call is not exercised — we only verify the context blocks contain the
specific values that drive analyst-grade answers (criticality, lifecycle,
recent trend, per-env split, top failing detections, sample-event counts).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def assistant_context():
    from app import models

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        session.add(org)
        await session.commit()

    yield test_sessionmaker, models

    await engine.dispose()


async def _seed_detection(session, models, **overrides):
    defaults = dict(
        id=str(uuid.uuid4()),
        title="Suspicious PowerShell EncodedCommand",
        description="",
        technique_id="T1059.001",
        criticality="CRITICAL",
        organization_id=1,
        status="ACTIVE",
        lifecycle_stage="prod",
        siem_type="splunk",
        siem_query="index=windows EventCode=4104 ScriptBlockText=*EncodedCommand*",
        source="git",
        last_pass_at=datetime.now(timezone.utc) - timedelta(days=14),
        last_fail_at=datetime.now(timezone.utc) - timedelta(hours=2),
        last_tested_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    defaults.update(overrides)
    det = models.Detection(**defaults)
    session.add(det)
    await session.commit()
    return det


async def _seed_test(session, models, detection, *, environment, result, mode="DETECTION_VALIDATION", started_offset_minutes=0, score=None):
    t = models.Test(
        organization_id=1,
        detection_id=detection.id,
        technique_id=detection.technique_id,
        environment=environment,
        mode=mode,
        status="completed",
        result=result,
        score=score,
        started_at=datetime.now(timezone.utc) - timedelta(minutes=started_offset_minutes),
        finished_at=datetime.now(timezone.utc) - timedelta(minutes=max(0, started_offset_minutes - 1)),
    )
    session.add(t)
    await session.commit()
    return t


@pytest.mark.asyncio
async def test_detection_context_includes_grounding_signal(assistant_context):
    """The detection context must surface the fields a senior analyst needs:
    criticality, lifecycle stage, source provenance, last pass/fail, recent
    trend (multiple runs), and an honest sample-events count.
    """
    from app import models
    from app.routers.assistant import _build_detection_context

    sm, _ = assistant_context
    async with sm() as session:
        det = await _seed_detection(session, models)
        # Three FAILs and one PASS — recent trend should reflect this in order.
        await _seed_test(session, models, det, environment="lab", result="PASS", started_offset_minutes=200, score=92)
        await _seed_test(session, models, det, environment="lab", result="FAIL", started_offset_minutes=150, score=20)
        await _seed_test(session, models, det, environment="prod", result="FAIL", started_offset_minutes=100, score=15)
        latest = await _seed_test(session, models, det, environment="prod", result="FAIL", started_offset_minutes=10, score=10)
        # A telemetry-only run that should NOT appear in the trend (mode filter).
        await _seed_test(session, models, det, environment="prod", result="PASS", mode="TELEMETRY_CHECK", started_offset_minutes=5)

        artifact = models.TestArtifact(
            organization_id=1,
            test_id=latest.id,
            siem_sample_events=json.dumps([{"_time": "2026-04-22T10:00:00Z", "host": "web-1"}] * 3),
            atomic_command="powershell.exe -EncodedCommand cG93ZXJzaGVsbA==",
        )
        session.add(artifact)
        await session.commit()

        context = await _build_detection_context(session, org_id=1, detection_id=det.id)

    assert "Criticality: CRITICAL" in context
    assert "Lifecycle stage: prod" in context
    assert "Source: git" in context, "git-sourced detections must be flagged so the AI proposes upstream, not in-place"
    assert "Last PASS:" in context
    assert "Last FAIL:" in context
    assert "Recent test trend (last 4" in context, "telemetry-only runs must be excluded from the trend"
    assert "[lab] PASS" in context
    assert "[prod] FAIL" in context
    assert "Sample events captured: 3" in context, "sample count must be honest about how many events were actually captured"
    assert "Mode: DETECTION_VALIDATION" in context


@pytest.mark.asyncio
async def test_portfolio_context_surfaces_top_failing_and_env_split(assistant_context):
    """Portfolio context must include: pass rate that excludes telemetry-only
    runs, per-environment pass/fail breakdown, and top repeatedly-failing
    detections in the last 30 days.
    """
    from app import models
    from app.routers.assistant import _build_portfolio_context

    sm, _ = assistant_context
    async with sm() as session:
        bad = await _seed_detection(session, models, title="Repeatedly Failing Rule", lifecycle_stage="tune", source="manual")
        good = await _seed_detection(session, models, title="Healthy Rule", criticality="MEDIUM", lifecycle_stage="prod", source="manual", technique_id="T1003")

        for offset in (5, 60, 120, 180):
            await _seed_test(session, models, bad, environment="prod", result="FAIL", started_offset_minutes=offset)
        await _seed_test(session, models, good, environment="lab", result="PASS", started_offset_minutes=30)
        await _seed_test(session, models, good, environment="prod", result="PASS", started_offset_minutes=20)
        await _seed_test(session, models, good, environment="lab", result="INCONCLUSIVE", started_offset_minutes=15)
        # Telemetry-only run — must NOT count toward pass rate or top-failing.
        await _seed_test(session, models, good, environment="prod", result="FAIL", mode="TELEMETRY_CHECK", started_offset_minutes=10)

        context = await _build_portfolio_context(session, org_id=1)

    assert "Total detections: 2" in context
    assert "Tests scored (excl. telemetry-only): 7" in context, "telemetry-only runs must not inflate the scored total"
    assert "Pass rate: 29%" in context, "2 PASS / 7 scored ≈ 29%"
    assert "Per-environment:" in context
    assert "lab:" in context and "prod:" in context
    assert "Top failing detections (last 30d):" in context
    assert "Repeatedly Failing Rule" in context
    assert "4× FAIL/30d" in context, "the count of repeated failures is the actionable signal"


@pytest.mark.asyncio
async def test_portfolio_context_handles_empty_workspace(assistant_context):
    """Empty workspaces must still produce a coherent context block — no
    KeyErrors, no division by zero, and an explicit 'no failures' line so
    the LLM doesn't hallucinate a problem.
    """
    from app.routers.assistant import _build_portfolio_context

    sm, _ = assistant_context
    async with sm() as session:
        context = await _build_portfolio_context(session, org_id=1)

    assert "Total detections: 0" in context
    assert "Pass rate: 0%" in context
    assert "no scored runs yet" in context
    assert "None — no repeated failures" in context
    assert "No tests have been run yet" in context
