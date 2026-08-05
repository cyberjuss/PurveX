from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def test_current_alembic_head_is_available():
    from app.main import _current_alembic_head

    assert _current_alembic_head() == "0018"


def test_beta_is_treated_as_managed_schema_env():
    from app.main import MANAGED_SCHEMA_ENVS

    assert "beta" in MANAGED_SCHEMA_ENVS


def test_dependency_health_endpoint_exists():
    from fastapi.testclient import TestClient

    from app.main import app

    response = TestClient(app).get("/health/dependencies")

    assert response.status_code == 200
    assert response.json()["checks"]["database"]["status"] == "ok"


@pytest_asyncio.fixture
async def reconciliation_context():
    from app import models

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        stale = models.Test(
            organization_id=1,
            technique_id="T1010",
            environment="lab",
            status="running",
            started_at=datetime.utcnow() - timedelta(minutes=90),
            initiated_by_user_id=7,
            initiated_by_email="operator@example.test",
        )
        fresh = models.Test(
            organization_id=1,
            technique_id="T1010",
            environment="lab",
            status="running",
            started_at=datetime.utcnow(),
        )
        session.add_all([org, stale, fresh])
        await session.commit()
        yield test_sessionmaker, stale.id, fresh.id, models

    await engine.dispose()


@pytest.mark.asyncio
async def test_reconcile_stale_tests_marks_only_old_active_tests(
    reconciliation_context,
):
    from sqlalchemy import select

    from app.services.test_reconciliation import reconcile_stale_tests

    test_sessionmaker, stale_id, fresh_id, models = reconciliation_context

    changed = await reconcile_stale_tests(test_sessionmaker, timeout_minutes=60)

    assert changed == 1

    async with test_sessionmaker() as session:
        stale = await session.get(models.Test, stale_id)
        fresh = await session.get(models.Test, fresh_id)
        audit_events = (
            await session.execute(select(models.AuditEvent))
        ).scalars().all()

    assert stale.status == "error"
    assert stale.result == "inconclusive"
    assert stale.finished_at is not None
    assert fresh.status == "running"
    assert len(audit_events) == 1
    assert audit_events[0].action == "RECONCILE_STALE_TEST"
