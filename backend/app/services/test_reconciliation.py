"""Startup reconciliation for tests left active by interrupted workers."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker as AsyncSessionMaker

from .. import models

logger = logging.getLogger("purvex.tests.reconciliation")

ACTIVE_TEST_STATUSES = ("pending", "running", "qa")


async def reconcile_stale_tests(
    sessionmaker: AsyncSessionMaker,
    *,
    timeout_minutes: int,
) -> int:
    """Mark active tests older than the timeout as errored.

    This prevents API restarts, worker crashes, or SSH hangs from leaving tests
    permanently stuck in active states.
    """
    timeout_minutes = max(1, int(timeout_minutes))
    cutoff = datetime.utcnow() - timedelta(minutes=timeout_minutes)
    changed = 0

    async with sessionmaker() as session:
        result = await session.execute(
            select(models.Test).where(
                models.Test.status.in_(ACTIVE_TEST_STATUSES),
                models.Test.started_at < cutoff,
            )
        )
        stale_tests = result.scalars().all()
        now = datetime.utcnow()

        for test in stale_tests:
            previous_status = test.status
            test.status = "error"
            test.result = test.result or "inconclusive"
            test.finished_at = test.finished_at or now
            changed += 1
            session.add(test)

            session.add(
                models.AuditEvent(
                    user_id=test.initiated_by_user_id,
                    user_email=test.initiated_by_email,
                    action="RECONCILE_STALE_TEST",
                    resource_type="test",
                    resource_id=str(test.id),
                    details=(
                        f"Marked stale {previous_status} test as error after "
                        f"{timeout_minutes} minute timeout"
                    ),
                )
            )

        if changed:
            await session.commit()
            logger.warning("Reconciled %d stale active test(s)", changed)

    return changed
