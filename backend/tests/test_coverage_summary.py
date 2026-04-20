"""Tests for the MITRE heatmap coverage endpoints.

These guard the executive summary + trend endpoints that power the heatmap
navigator: weighted coverage math, gap prioritization, and the TELEMETRY_CHECK
exclusion on the trend line.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def coverage_context():
    from app import models
    import app.routers.mitre as mitre_router

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        user = models.User(
            id=1,
            username="admin",
            email="admin@example.test",
            hashed_password="not-used",
            organization_id=1,
            is_active=True,
            is_admin=True,
        )
        session.add_all([org, user])
        await session.commit()
        yield mitre_router, session, user

    await engine.dispose()


async def _seed_detection(session, models, **overrides):
    defaults = dict(
        title="Test Detection",
        description="",
        technique_id="T1059.001",
        criticality="HIGH",
        organization_id=1,
        status="ACTIVE",
        siem_type="splunk",
        siem_query="index=main",
    )
    defaults.update(overrides)
    det = models.Detection(**defaults)
    session.add(det)
    await session.commit()
    return det


async def _seed_test(session, models, *, detection_id: str, result: str, started_at, mode: str = "DETECTION_VALIDATION", technique_id: str = "T1059.001"):
    test = models.Test(
        detection_id=detection_id,
        organization_id=1,
        technique_id=technique_id,
        environment="lab",
        status="completed",
        result=result,
        started_at=started_at,
        mode=mode,
    )
    session.add(test)
    await session.commit()
    return test


@pytest.mark.asyncio
async def test_coverage_summary_weights_by_criticality(coverage_context):
    """A PASSing CRITICAL detection should dominate a PASSing LOW one."""
    from app import models

    mitre_router, session, user = coverage_context

    # CRITICAL detection with PASS → contributes 8 to numerator, 8 to denominator
    crit = await _seed_detection(
        session, models, technique_id="T1059.001", criticality="CRITICAL",
        last_result="PASS", last_score=95,
    )
    # LOW detection with FAIL → contributes 0 to numerator, 1 to denominator
    low = await _seed_detection(
        session, models, technique_id="T1595", criticality="LOW",
        last_result="FAIL", last_score=20,
    )

    summary = await mitre_router.get_coverage_summary(db=session, current_user=user)

    # Weighted = 8 / (8 + 1) ≈ 88.89%
    assert 88.0 < summary.weighted_coverage_percent < 89.0
    assert summary.totals.validated == 1
    assert summary.totals.at_risk == 1
    # Only HIGH/CRITICAL make the "top failing" list
    ids = [g.technique_id for g in summary.top_failing_high_value]
    assert "T1595" not in ids  # LOW shouldn't be in the list

    _ = crit, low  # silence unused


@pytest.mark.asyncio
async def test_coverage_summary_surfaces_untested_high_value(coverage_context):
    """A HIGH-criticality detection with no test runs should appear in top_untested."""
    from app import models

    mitre_router, session, user = coverage_context

    await _seed_detection(
        session, models, technique_id="T1059.001", criticality="HIGH",
        last_result=None,
    )

    summary = await mitre_router.get_coverage_summary(db=session, current_user=user)

    assert summary.totals.mapped == 1
    assert summary.totals.validated == 0
    assert len(summary.top_untested_high_value) == 1
    assert summary.top_untested_high_value[0].technique_id == "T1059.001"


@pytest.mark.asyncio
async def test_coverage_trend_excludes_telemetry_check_runs(coverage_context):
    """TELEMETRY_CHECK tests must not show up on the coverage curve.

    Telemetry runs don't evaluate the rule, so counting them would inflate the
    coverage number. Matches the detection-detail page's filter.
    """
    from app import models

    mitre_router, session, user = coverage_context

    det = await _seed_detection(session, models, technique_id="T1059.001")

    now = datetime.now(timezone.utc)
    await _seed_test(session, models, detection_id=det.id, result="PASS", started_at=now, mode="TELEMETRY_CHECK")

    trend = await mitre_router.get_coverage_trend(db=session, current_user=user, days=7)

    # No DETECTION_VALIDATION runs → every day should read zero.
    assert all(p.validated == 0 for p in trend.points)
    assert all(p.tested == 0 for p in trend.points)


@pytest.mark.asyncio
async def test_coverage_trend_counts_distinct_techniques_per_day(coverage_context):
    """Two PASSing tests on the same technique+day should count once."""
    from app import models

    mitre_router, session, user = coverage_context

    det = await _seed_detection(session, models, technique_id="T1059.001")
    now = datetime.now(timezone.utc)

    await _seed_test(session, models, detection_id=det.id, result="PASS", started_at=now)
    await _seed_test(session, models, detection_id=det.id, result="PASS", started_at=now)

    trend = await mitre_router.get_coverage_trend(db=session, current_user=user, days=7)

    # The last point (today) should have validated=1 exactly.
    assert trend.points[-1].validated == 1
    assert trend.points[-1].tested == 1


def test_mitre_technique_schema_carries_platforms_and_data_sources():
    """Regression: schema must expose the two new fields the frontend depends on."""
    from app.schemas import MitreTechnique

    t = MitreTechnique(
        id="T1059.001",
        name="PowerShell",
        tactics=["Execution"],
        platforms=["Windows"],
        data_sources=["Command", "Process"],
    )
    assert t.platforms == ["Windows"]
    assert t.data_sources == ["Command", "Process"]
