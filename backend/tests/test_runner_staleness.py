"""Tests for stale-runner gating on ``/tests/run``.

``EnvironmentRunnerConfig.status`` only changes on explicit heartbeat/
pause/stop transitions — it never reflects a runner that silently stopped
heartbeating. This covers ``utils.runner_health.is_runner_stale`` and its
use in ``routers.tests.run_test`` to block scheduling a test against a
runner that looks "online" but hasn't checked in within its own
``alert_offline_minutes`` window (which would otherwise produce a
misleading "no detection fired" score).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def runner_context():
    from app import models

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        user = models.User(
            id=1, username="analyst", email="analyst@example.test",
            hashed_password="not-used", organization_id=1,
            is_active=True, is_admin=True,
        )
        session.add_all([org, user])
        await session.commit()
        yield session, user

    await engine.dispose()


def test_is_runner_stale_never_checked_in_is_not_stale():
    from app import models
    from app.utils.runner_health import is_runner_stale

    runner = models.EnvironmentRunnerConfig(
        organization_id=1, environment_name="lab", last_check_in=None,
        alert_offline_minutes=5,
    )
    assert is_runner_stale(runner) is False


def test_is_runner_stale_within_threshold_is_fresh():
    from app import models
    from app.utils.runner_health import is_runner_stale

    runner = models.EnvironmentRunnerConfig(
        organization_id=1, environment_name="lab",
        last_check_in=datetime.now(timezone.utc) - timedelta(minutes=2),
        alert_offline_minutes=5,
    )
    assert is_runner_stale(runner) is False


def test_is_runner_stale_past_threshold_is_stale():
    from app import models
    from app.utils.runner_health import is_runner_stale

    runner = models.EnvironmentRunnerConfig(
        organization_id=1, environment_name="lab",
        last_check_in=datetime.now(timezone.utc) - timedelta(minutes=20),
        alert_offline_minutes=5,
    )
    assert is_runner_stale(runner) is True


@pytest.mark.asyncio
async def test_run_test_blocked_against_stale_runner(runner_context):
    from app import models, schemas
    import app.routers.tests as tests_router
    session, user = runner_context

    runner = models.EnvironmentRunnerConfig(
        organization_id=1,
        environment_name="lab",
        hostname="stale-host",
        status="online",  # never explicitly paused/stopped
        last_check_in=datetime.now(timezone.utc) - timedelta(minutes=30),
        alert_offline_minutes=5,
    )
    session.add(runner)
    await session.commit()

    with pytest.raises(HTTPException) as exc:
        await tests_router.run_test(
            test_run=schemas.TestRunCreate(
                technique_id="T1059.001",
                environment="lab",
                endpoint="stale-host",
            ),
            background_tasks=BackgroundTasks(),
            db=session,
            current_user=user,
        )
    assert exc.value.status_code == 409
    assert "checked in" in exc.value.detail

    # A dedup'd notification was raised for the org.
    result = await session.execute(
        select(models.Notification).where(
            models.Notification.organization_id == 1,
            models.Notification.source_type == "runner_stale",
        )
    )
    notifications = result.scalars().all()
    assert len(notifications) == 1


@pytest.mark.asyncio
async def test_run_test_allowed_against_fresh_runner(runner_context):
    from app import models, schemas
    import app.routers.tests as tests_router
    session, user = runner_context

    runner = models.EnvironmentRunnerConfig(
        organization_id=1,
        environment_name="lab",
        hostname="fresh-host",
        status="online",
        last_check_in=datetime.now(timezone.utc) - timedelta(minutes=1),
        alert_offline_minutes=5,
    )
    session.add(runner)
    await session.commit()

    # Fresh runners shouldn't be blocked by staleness. The call may still
    # raise for unrelated reasons (no real atomic-test infra in this test
    # env), so we only assert it's not our 409 staleness message.
    try:
        await tests_router.run_test(
            test_run=schemas.TestRunCreate(
                technique_id="T1059.001",
                environment="lab",
                endpoint="fresh-host",
            ),
            background_tasks=BackgroundTasks(),
            db=session,
            current_user=user,
        )
    except HTTPException as exc:
        assert "checked in" not in exc.value.detail
