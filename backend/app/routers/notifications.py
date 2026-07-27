"""``/notifications`` router — the persisted platform inbox.

Only the "platform" category (new runner connected, runner gone stale,
proposal outcomes) lives here. Test/detection activity is still derived
live from their own tables by the frontend — see notes on
``models.Notification``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..db import get_db
from ..routers.auth import get_current_user
from ..utils.endpoint_rate_limit import endpoint_rate_limit
from ..utils.tenant import require_org_id

router = APIRouter(
    prefix="/notifications",
    tags=["notifications"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


@router.get("", response_model=List[schemas.NotificationOut])
@router.get("/", response_model=List[schemas.NotificationOut])
async def list_notifications(
    db: DBSession,
    current_user: CurrentUser,
    status_filter: Optional[str] = Query(None, alias="status", description="'unread' or 'all' (default 'all')"),
    limit: int = Query(80, ge=1, le=200),
):
    org_id = require_org_id(current_user)
    query = select(models.Notification).where(
        models.Notification.organization_id == org_id,
        models.Notification.dismissed_at.is_(None),
    )
    if status_filter == "unread":
        query = query.where(models.Notification.read_at.is_(None))
    query = query.order_by(models.Notification.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


async def _get_owned_notification(
    db: AsyncSession, current_user: models.User, notification_id: int
) -> models.Notification:
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.Notification).where(
            models.Notification.id == notification_id,
            models.Notification.organization_id == org_id,
        )
    )
    notification = result.scalars().first()
    if notification is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    return notification


@router.post("/{notification_id}/read", response_model=schemas.NotificationOut)
async def mark_notification_read(
    notification_id: int,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(max_requests=120, window_seconds=60, key_prefix="notifications:mutate")
    ),
):
    notification = await _get_owned_notification(db, current_user, notification_id)
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(notification)
    return notification


@router.post("/{notification_id}/dismiss", response_model=schemas.NotificationOut)
async def dismiss_notification(
    notification_id: int,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(max_requests=120, window_seconds=60, key_prefix="notifications:mutate")
    ),
):
    notification = await _get_owned_notification(db, current_user, notification_id)
    now = datetime.now(timezone.utc)
    if notification.read_at is None:
        notification.read_at = now
    notification.dismissed_at = now
    await db.commit()
    await db.refresh(notification)
    return notification


@router.post("/dismiss-all", response_model=dict)
async def dismiss_all_notifications(
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(max_requests=30, window_seconds=60, key_prefix="notifications:mutate-all")
    ),
):
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.Notification).where(
            models.Notification.organization_id == org_id,
            models.Notification.dismissed_at.is_(None),
        )
    )
    now = datetime.now(timezone.utc)
    rows = result.scalars().all()
    for row in rows:
        row.dismissed_at = now
        if row.read_at is None:
            row.read_at = now
    await db.commit()
    return {"dismissed": len(rows)}
