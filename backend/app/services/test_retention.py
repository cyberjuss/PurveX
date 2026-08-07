"""Retention job for the tests + test_artifacts tables.

Scheduled test runs accumulate quickly, so old completed/failed tests are
purged along with their artifacts after a configurable window. Only terminal
states are eligible — in-flight tests are never touched.
"""

import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models

logger = logging.getLogger("purvex.test_retention")

_TERMINAL_STATUSES = ("completed", "failed")


async def cleanup_old_tests(db: AsyncSession, retention_days: int) -> int:
    """Delete tests older than the cutoff, plus their artifacts.

    Returns the number of tests deleted. Audit events referencing these tests
    are left intact — they're protected by the separate audit retention job.
    """
    if retention_days <= 0:
        return 0

    cutoff = datetime.utcnow() - timedelta(days=retention_days)

    count_result = await db.execute(
        select(func.count())
        .select_from(models.Test)
        .where(models.Test.started_at < cutoff)
        .where(models.Test.status.in_(_TERMINAL_STATUSES))
    )
    delete_count = int(count_result.scalar() or 0)
    if delete_count == 0:
        return 0

    stale_ids_result = await db.execute(
        select(models.Test.id)
        .where(models.Test.started_at < cutoff)
        .where(models.Test.status.in_(_TERMINAL_STATUSES))
    )
    stale_ids = [row[0] for row in stale_ids_result.all()]
    if not stale_ids:
        return 0

    await db.execute(
        delete(models.TestArtifact).where(models.TestArtifact.test_id.in_(stale_ids))
    )
    await db.execute(delete(models.Test).where(models.Test.id.in_(stale_ids)))
    await db.commit()
    return len(stale_ids)


async def run_test_retention_loop(
    sessionmaker,
    retention_days: int,
    interval_hours: int,
) -> None:
    if retention_days <= 0:
        logger.info("Test retention disabled (retention_days=%s).", retention_days)
        return

    interval_seconds = max(1, interval_hours) * 60 * 60
    logger.info(
        "Starting test retention loop: retention_days=%s, interval_hours=%s",
        retention_days,
        interval_hours,
    )

    while True:
        try:
            async with sessionmaker() as db:
                deleted = await cleanup_old_tests(db, retention_days=retention_days)
                if deleted:
                    logger.info("Test retention cleanup removed %s tests.", deleted)
        except Exception as exc:
            logger.warning("Test retention cleanup failed: %s", exc)

        await asyncio.sleep(interval_seconds)
