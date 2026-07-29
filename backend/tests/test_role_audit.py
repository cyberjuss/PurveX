"""Regression test for a gap found during the ship-to-production fresh-install
drill: assign_role and remove_role (backend/app/routers/rbac.py) performed a
real, privilege-relevant change with zero audit trail, while every sibling
endpoint in the same file (set_user_password, invite_user, set_user_status)
already wrote one. Confirmed live against a real Postgres instance, then
fixed by adding the same AuditEvent write these endpoints already use.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def role_audit_context(monkeypatch):
    from app import models
    from app.security import hash_password

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    # assign_role/remove_role write their audit event via a separate
    # `async_sessionmaker()` call (not the injected `db` session), same as
    # invite_user/set_user_status — point that at our isolated test engine.
    import app.routers.rbac as rbac_router
    monkeypatch.setattr(rbac_router, "async_sessionmaker", test_sessionmaker)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        admin = models.User(
            id=1, username="admin", email="admin@example.test",
            hashed_password=hash_password("Admin-Pass1!"),
            organization_id=1, is_active=True, is_admin=True,
        )
        member = models.User(
            id=2, username="member", email="member@example.test",
            hashed_password=hash_password("Member-Pass1!"),
            organization_id=1, is_active=True, is_admin=False,
        )
        role = models.Role(
            id=1, name="SECURITY_ANALYST", organization_id=None, is_system=True,
        )
        session.add_all([org, admin, member, role])
        await session.commit()
        yield session, admin, member, role

    await engine.dispose()


@pytest.mark.asyncio
async def test_assign_role_writes_audit_event(role_audit_context):
    from app import models
    import app.routers.rbac as rbac_router

    session, admin, member, role = role_audit_context

    await rbac_router.assign_role(
        user_id=member.id,
        payload=rbac_router.AssignRoleRequest(role_name=role.name),
        db=session,
        current_user=admin,
    )

    events = (await session.execute(select(models.AuditEvent))).scalars().all()
    assert len(events) == 1
    event = events[0]
    assert event.action == "ROLE_ASSIGNED"
    assert event.user_id == admin.id
    assert event.resource_id == str(member.id)
    assert role.name in event.details
    assert member.email in event.details


@pytest.mark.asyncio
async def test_remove_role_writes_audit_event(role_audit_context):
    from app import models
    import app.routers.rbac as rbac_router

    session, admin, member, role = role_audit_context

    assign_result = await rbac_router.assign_role(
        user_id=member.id,
        payload=rbac_router.AssignRoleRequest(role_name=role.name),
        db=session,
        current_user=admin,
    )
    user_role_id = assign_result["id"]

    await rbac_router.remove_role(
        user_id=member.id,
        role_id=user_role_id,
        db=session,
        current_user=admin,
    )

    events = (
        await session.execute(
            select(models.AuditEvent).order_by(models.AuditEvent.id)
        )
    ).scalars().all()
    actions = [e.action for e in events]
    assert actions == ["ROLE_ASSIGNED", "ROLE_REMOVED"]
    remove_event = events[-1]
    assert remove_event.user_id == admin.id
    assert remove_event.resource_id == str(member.id)
    assert role.name in remove_event.details
