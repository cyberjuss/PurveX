import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models

logger = logging.getLogger("purvex.audit_retention")


async def cleanup_audit_events(
    db: AsyncSession,
    retention_days: int,
    actor: Optional[models.User] = None,
    automated: bool = False,
) -> int:
    if retention_days <= 0:
        return 0

    cutoff = datetime.utcnow() - timedelta(days=retention_days)

    count_result = await db.execute(
        select(func.count()).select_from(models.AuditEvent).where(
            models.AuditEvent.created_at < cutoff
        )
    )
    delete_count = int(count_result.scalar() or 0)

    if delete_count == 0:
        return 0

    await db.execute(
        delete(models.AuditEvent).where(models.AuditEvent.created_at < cutoff)
    )

    details = (
        f"{'Automated' if automated else 'Manual'} audit retention cleanup: "
        f"deleted {delete_count} event(s) older than {retention_days} day(s)."
    )
    cleanup_event = models.AuditEvent(
        user_id=actor.id if actor else None,
        user_email=actor.email if actor else None,
        action="AUDIT_RETENTION_CLEANUP",
        resource_type="audit_events",
        resource_id=None,
        details=details,
    )
    db.add(cleanup_event)
    await db.commit()
    return delete_count


async def run_audit_retention_loop(
    sessionmaker,
    retention_days: int,
    interval_hours: int,
) -> None:
    if retention_days <= 0:
        logger.info("Audit retention disabled (retention_days=%s).", retention_days)
        return

    interval_seconds = max(1, interval_hours) * 60 * 60
    logger.info(
        "Starting audit retention loop: retention_days=%s, interval_hours=%s",
        retention_days,
        interval_hours,
    )

    while True:
        try:
            async with sessionmaker() as db:
                deleted = await cleanup_audit_events(
                    db,
                    retention_days=retention_days,
                    actor=None,
                    automated=True,
                )
                if deleted:
                    logger.info("Audit retention cleanup removed %s events.", deleted)
        except Exception as exc:
            logger.warning("Audit retention cleanup failed: %s", exc)

        await asyncio.sleep(interval_seconds)
