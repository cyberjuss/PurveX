"""Tests for the persisted ``/notifications`` inbox.

Covers the ``notify()`` dedup rule (services/notifications.py) and the
list/read/dismiss endpoints (routers/notifications.py). Replaces what used
to be client-only localStorage state on the "platform" notification
category.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def notifications_context():
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


@pytest.mark.asyncio
async def test_notify_dedups_unresolved_source(notifications_context):
    from app.services.notifications import notify
    session, _ = notifications_context

    first = await notify(
        session,
        organization_id=1,
        title="Validation agent stopped checking in",
        status="error",
        source_type="runner_stale",
        source_id="42",
    )
    await session.commit()
    second = await notify(
        session,
        organization_id=1,
        title="Validation agent stopped checking in",
        status="error",
        source_type="runner_stale",
        source_id="42",
    )
    await session.commit()

    assert first.id == second.id  # no duplicate row created


@pytest.mark.asyncio
async def test_notify_allows_new_row_after_dismissal(notifications_context):
    from app.services.notifications import notify
    session, _ = notifications_context

    first = await notify(
        session, organization_id=1, title="Runner went stale",
        source_type="runner_stale", source_id="7",
    )
    await session.commit()
    first.dismissed_at = first.created_at  # simulate an analyst dismissing it
    await session.commit()

    second = await notify(
        session, organization_id=1, title="Runner went stale again",
        source_type="runner_stale", source_id="7",
    )
    await session.commit()

    assert second.id != first.id


@pytest.mark.asyncio
async def test_list_read_dismiss_flow(notifications_context):
    from app.services.notifications import notify
    import app.routers.notifications as notifications
    session, user = notifications_context

    n = await notify(session, organization_id=1, title="New validation agent connected")
    await session.commit()

    listed = await notifications.list_notifications(
        db=session, current_user=user, status_filter=None, limit=80,
    )
    assert len(listed) == 1
    assert listed[0].read_at is None

    read = await notifications.mark_notification_read(
        notification_id=n.id, db=session, current_user=user,
    )
    assert read.read_at is not None

    unread = await notifications.list_notifications(
        db=session, current_user=user, status_filter="unread", limit=80,
    )
    assert unread == []

    dismissed = await notifications.dismiss_notification(
        notification_id=n.id, db=session, current_user=user,
    )
    assert dismissed.dismissed_at is not None

    remaining = await notifications.list_notifications(
        db=session, current_user=user, status_filter=None, limit=80,
    )
    assert remaining == []  # dismissed rows never come back in the list


@pytest.mark.asyncio
async def test_dismiss_notification_wrong_org_404s(notifications_context):
    from app import models
    import app.routers.notifications as notifications
    session, user = notifications_context

    other_org = models.Organization(id=2, name="Other Org")
    session.add(other_org)
    n = models.Notification(organization_id=2, title="Not yours", type="platform", status="info")
    session.add(n)
    await session.commit()

    with pytest.raises(HTTPException) as exc:
        await notifications.dismiss_notification(
            notification_id=n.id, db=session, current_user=user,
        )
    assert exc.value.status_code == 404
