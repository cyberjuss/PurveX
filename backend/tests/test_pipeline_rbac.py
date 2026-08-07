"""Regression tests for RBAC gaps found while auditing the test-run and
test-schedule pipelines end to end per role.

1. ``POST /tests/`` (create_test) only checked the blanket ``tests:create``
   permission, ignoring the client-supplied ``environment`` field. A role
   holding ``tests:create`` but not ``tests:run:prod`` (e.g. SECURITY_ANALYST)
   could fabricate a passing "prod" Test row without ever running anything.
2. ``GET/PATCH/DELETE /tests/schedules*`` unconditionally required
   ``tests:schedule:prod`` (admin-only), even though ``POST /tests/schedules``
   lets any ``tests:schedule`` holder (e.g. DETECTION_ENGINEER) create a
   lab/dev schedule — leaving them unable to ever view, edit, or delete the
   schedule they just created via the API (and a frontend gate that expects
   they can, since it also only requires ``tests:schedule``).
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app import models, schemas
from app.services.rbac import Role as RoleEnum


@pytest_asyncio.fixture
async def pipeline_context(monkeypatch):
    from app.security import hash_password
    import app.db as db_module
    import app.routers.rbac as rbac_router

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    # Schedule update/delete and rbac role-assignment write their audit
    # events through the module-level async_sessionmaker rather than the
    # request-scoped session; without this they'd hit the real configured db.
    monkeypatch.setattr(db_module, "async_sessionmaker", test_sessionmaker)
    monkeypatch.setattr(rbac_router, "async_sessionmaker", test_sessionmaker)

    from app.utils import license as license_module
    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_a, **_k: license_module.LicenseStatus(
            plan="paid", seat_limit=None, runner_limit=None, schedules_enabled=True,
        ),
    )

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        session.add(org)

        roles = {
            role: models.Role(name=role.value, description=role.value, is_system=True)
            for role in (RoleEnum.DETECTION_ENGINEER, RoleEnum.SECURITY_ANALYST)
        }
        session.add_all(roles.values())
        await session.flush()

        engineer = models.User(
            id=1, username="engineer", email="engineer@example.test",
            hashed_password=hash_password("Engineer-Pass1!"),
            organization_id=1, is_active=True, is_admin=False,
        )
        analyst = models.User(
            id=2, username="analyst", email="analyst@example.test",
            hashed_password=hash_password("Analyst-Pass1!"),
            organization_id=1, is_active=True, is_admin=False,
        )
        session.add_all([engineer, analyst])
        await session.flush()

        session.add_all([
            models.UserRole(user_id=engineer.id, role_id=roles[RoleEnum.DETECTION_ENGINEER].id, organization_id=1),
            models.UserRole(user_id=analyst.id, role_id=roles[RoleEnum.SECURITY_ANALYST].id, organization_id=1),
        ])
        await session.commit()
        await session.refresh(engineer)
        await session.refresh(analyst)

        yield session, engineer, analyst

    await engine.dispose()


# ---------------------------------------------------------------------------
# create_test must respect the environment, not just the blanket TESTS_CREATE
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_create_test_rejects_environment_caller_cannot_run(pipeline_context):
    import app.routers.tests as tests_router

    session, _engineer, analyst = pipeline_context

    # SECURITY_ANALYST holds tests:create + tests:run:lab, but not
    # tests:run:prod -- must not be able to file a "prod" result.
    with pytest.raises(HTTPException) as exc_info:
        await tests_router.create_test(
            test=schemas.TestCreate(technique_id="T1059", environment="prod"),
            db=session,
            current_user=analyst,
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_create_test_allows_environment_caller_can_run(pipeline_context):
    import app.routers.tests as tests_router

    session, _engineer, analyst = pipeline_context

    result = await tests_router.create_test(
        test=schemas.TestCreate(
            technique_id="T1059", environment="lab",
            started_at=datetime.now(timezone.utc),
        ),
        db=session,
        current_user=analyst,
    )
    assert result.environment == "lab"


# ---------------------------------------------------------------------------
# Schedule list/update/delete must scope by the schedule's own environment,
# not hard-require the admin-only tests:schedule:prod permission.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_engineer_can_manage_own_lab_schedule(pipeline_context):
    import app.routers.tests as tests_router

    session, engineer, _analyst = pipeline_context

    created = await tests_router.create_test_schedule(
        payload=schemas.TestScheduleCreate(
            technique_id="T1059", environment="lab",
            schedule_type="interval", interval_seconds=3600,
        ),
        db=session,
        current_user=engineer,
    )

    listed = await tests_router.list_test_schedules(db=session, current_user=engineer)
    assert [s.id for s in listed] == [created.id]

    updated = await tests_router.update_test_schedule(
        schedule_id=created.id,
        payload=schemas.TestScheduleUpdate(enabled=False),
        db=session,
        current_user=engineer,
    )
    assert updated.enabled is False

    await tests_router.delete_test_schedule(
        schedule_id=created.id, db=session, current_user=engineer,
    )
    remaining = await session.execute(select(models.TestSchedule).where(models.TestSchedule.id == created.id))
    assert remaining.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_engineer_cannot_manage_prod_schedule(pipeline_context):
    import app.routers.tests as tests_router

    session, engineer, _analyst = pipeline_context

    prod_schedule = models.TestSchedule(
        organization_id=1, technique_id="T1059", environment="prod",
        schedule_type="interval", interval_seconds=3600,
    )
    session.add(prod_schedule)
    await session.commit()
    await session.refresh(prod_schedule)

    with pytest.raises(HTTPException) as exc_info:
        await tests_router.update_test_schedule(
            schedule_id=prod_schedule.id,
            payload=schemas.TestScheduleUpdate(enabled=False),
            db=session,
            current_user=engineer,
        )
    assert exc_info.value.status_code == 403

    with pytest.raises(HTTPException) as exc_info:
        await tests_router.delete_test_schedule(
            schedule_id=prod_schedule.id, db=session, current_user=engineer,
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_list_schedules_excludes_prod_for_non_prod_scheduler(pipeline_context):
    import app.routers.tests as tests_router

    session, engineer, _analyst = pipeline_context

    session.add_all([
        models.TestSchedule(
            organization_id=1, technique_id="T1059", environment="lab",
            schedule_type="interval", interval_seconds=3600,
        ),
        models.TestSchedule(
            organization_id=1, technique_id="T1059", environment="prod",
            schedule_type="interval", interval_seconds=3600,
        ),
    ])
    await session.commit()

    listed = await tests_router.list_test_schedules(db=session, current_user=engineer)
    assert len(listed) == 1
    assert listed[0].environment == "lab"
