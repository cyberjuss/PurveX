"""Create persisted, org-scoped notification rows.

Dedup rule: if ``dedup=True`` (the default) and an existing row for the same
``(organization_id, source_type, source_id)`` hasn't been dismissed yet, skip
the insert and return that row instead of creating a duplicate. This mirrors
``supersede_pending_for_detection`` in ``proposal_policy.py`` — don't let the
same underlying event pile up multiple open inbox items.
"""
from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models


async def notify(
    db: AsyncSession,
    *,
    organization_id: int,
    title: str,
    description: Optional[str] = None,
    action_url: Optional[str] = None,
    status: str = "info",
    type_: str = "platform",
    source_type: Optional[str] = None,
    source_id: Optional[str] = None,
    metadata: Optional[dict] = None,
    dedup: bool = True,
) -> models.Notification:
    if dedup and source_type and source_id:
        existing = await db.execute(
            select(models.Notification).where(
                models.Notification.organization_id == organization_id,
                models.Notification.source_type == source_type,
                models.Notification.source_id == str(source_id),
                models.Notification.dismissed_at.is_(None),
            )
        )
        row = existing.scalars().first()
        if row is not None:
            return row

    notification = models.Notification(
        organization_id=organization_id,
        type=type_,
        title=title,
        description=description,
        action_url=action_url,
        status=status,
        source_type=source_type,
        source_id=str(source_id) if source_id is not None else None,
        extra_metadata=json.dumps(metadata) if metadata is not None else None,
    )
    db.add(notification)
    await db.flush()
    return notification
