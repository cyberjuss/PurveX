"""Arq task that wraps the atomic test pipeline.

Contract:
- Idempotent on retry: a terminal test (status ``completed`` or ``error`` with
  ``finished_at`` set) is a no-op on re-entry. This guarantees arq retries
  never double-run atomic commands against the runner.
- Per-job timeout via ``asyncio.wait_for`` so a hung SSH session cannot block
  the worker indefinitely even if the underlying driver ignores its own timeout.
- Job row in ``jobs`` table tracks attempts and last error so the UI can
  surface state the queue itself would otherwise lose on restart.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

from sqlalchemy import select

from .. import models
from ..config import settings
from ..db import async_sessionmaker
from ..services.atomic_runner import execute_test_pipeline

logger = logging.getLogger("purvex.jobs.test_execution")

TERMINAL_TEST_STATUSES = {"completed", "error", "cancelled"}


def _job_timeout_seconds() -> int:
    # STALE_TEST_TIMEOUT_MINUTES is the reconciliation cutoff; align the
    # per-job timeout so the worker kills the job before reconciliation would.
    return max(60, int(settings.STALE_TEST_TIMEOUT_MINUTES) * 60)


async def _update_job(arq_job_id: str | None, **fields: Any) -> None:
    if not arq_job_id:
        return
    async with async_sessionmaker() as session:
        result = await session.execute(
            select(models.Job).where(models.Job.arq_job_id == arq_job_id)
        )
        job = result.scalar_one_or_none()
        if not job:
            return
        for key, value in fields.items():
            setattr(job, key, value)
        await session.commit()


async def _test_is_terminal(test_id: int, org_id: int) -> bool:
    async with async_sessionmaker() as session:
        result = await session.execute(
            select(models.Test).where(
                models.Test.id == test_id,
                models.Test.organization_id == org_id,
            )
        )
        test = result.scalar_one_or_none()
        if not test:
            return True  # nothing to do; treat as done
        return test.status in TERMINAL_TEST_STATUSES and test.finished_at is not None


async def run_test_execution(
    ctx: dict[str, Any] | None,
    test_id: int,
    org_id: int,
) -> dict[str, Any]:
    """Arq entrypoint for executing a single test.

    ``ctx`` is provided by arq at runtime; callers invoking this directly
    (e.g. in-process fallback, unit tests) may pass ``None``.
    """
    arq_job_id = (ctx or {}).get("job_id")
    attempt = int((ctx or {}).get("job_try", 1))

    if await _test_is_terminal(test_id, org_id):
        logger.info(
            "Test %s already in terminal state; skipping retry execution", test_id
        )
        await _update_job(
            arq_job_id,
            status="success",
            attempts=attempt,
            finished_at=datetime.utcnow(),
        )
        return {"status": "skipped", "reason": "already_terminal"}

    await _update_job(
        arq_job_id,
        status="running",
        attempts=attempt,
        started_at=datetime.utcnow(),
    )

    timeout = _job_timeout_seconds()
    try:
        await asyncio.wait_for(execute_test_pipeline(test_id, org_id), timeout=timeout)
    except asyncio.TimeoutError:
        logger.error(
            "Test execution timed out after %ss (test_id=%s, attempt=%s)",
            timeout,
            test_id,
            attempt,
        )
        await _mark_test_error(test_id, org_id, f"Timed out after {timeout}s")
        await _update_job(
            arq_job_id,
            status="timeout",
            last_error=f"Timed out after {timeout}s",
            finished_at=datetime.utcnow(),
        )
        raise
    except Exception as exc:
        logger.exception(
            "Test execution failed (test_id=%s, attempt=%s)", test_id, attempt
        )
        await _update_job(
            arq_job_id,
            status="failed",
            last_error=str(exc)[:2000],
            finished_at=datetime.utcnow(),
        )
        raise

    await _update_job(
        arq_job_id,
        status="success",
        finished_at=datetime.utcnow(),
    )
    return {"status": "success"}


async def _mark_test_error(test_id: int, org_id: int, reason: str) -> None:
    """Force the Test row into an error state so the UI reflects the timeout."""
    async with async_sessionmaker() as session:
        result = await session.execute(
            select(models.Test).where(
                models.Test.id == test_id,
                models.Test.organization_id == org_id,
            )
        )
        test = result.scalar_one_or_none()
        if not test:
            return
        if test.status not in TERMINAL_TEST_STATUSES:
            test.status = "error"
            test.result = test.result or "inconclusive"
            test.finished_at = test.finished_at or datetime.utcnow()
            session.add(test)
            session.add(
                models.AuditEvent(
                    user_id=test.initiated_by_user_id,
                    user_email=test.initiated_by_email,
                    action="TEST_JOB_TIMEOUT",
                    resource_type="test",
                    resource_id=str(test.id),
                    details=reason,
                )
            )
            await session.commit()
