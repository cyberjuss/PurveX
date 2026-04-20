"""Job enqueue helpers.

When ``REDIS_URL`` is configured the job is enqueued to arq. Otherwise it is
executed in-process via :class:`fastapi.BackgroundTasks` to keep local-dev
working without a broker. Either way a :class:`Job` row is written so the UI
has a consistent view of job state.

Shutdown contract: in-process fallback tasks are tracked in a module-level
set so the FastAPI shutdown hook can await them and log any still running.
This keeps dev workflows safe without requiring the arq worker.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from .test_execution import run_test_execution

logger = logging.getLogger("purvex.jobs.enqueue")

# Tracks in-flight in-process jobs so the shutdown hook can drain them.
# Populated only when Redis is absent (dev/test path).
_inprocess_tasks: set[asyncio.Task] = set()


def _track_inprocess(coro) -> asyncio.Task:
    """Wrap an awaitable in an asyncio.Task and register it for drain."""
    task = asyncio.create_task(coro)
    _inprocess_tasks.add(task)
    task.add_done_callback(_inprocess_tasks.discard)
    return task


async def drain_inprocess_jobs(timeout_seconds: float = 30.0) -> int:
    """Wait for in-flight in-process background jobs to complete.

    Returns the number of tasks that finished before the timeout. Tasks still
    running after ``timeout_seconds`` are left alone (the job row will be
    reconciled as stale on next startup).
    """
    if not _inprocess_tasks:
        return 0
    pending = list(_inprocess_tasks)
    logger.info("Draining %d in-process background job(s)", len(pending))
    try:
        done, _ = await asyncio.wait(pending, timeout=timeout_seconds)
        return len(done)
    except Exception:  # pragma: no cover - defensive
        logger.exception("Error draining in-process jobs")
        return 0


@dataclass
class JobDispatch:
    job_id: int
    arq_job_id: Optional[str]
    mode: str  # "arq" | "inprocess"


def _redis_configured() -> bool:
    return bool(os.getenv("REDIS_URL"))


async def _create_job_row(
    db: AsyncSession,
    *,
    org_id: int,
    job_type: str,
    resource_type: str,
    resource_id: str,
    arq_job_id: Optional[str],
    max_attempts: int = 3,
) -> models.Job:
    job = models.Job(
        organization_id=org_id,
        job_type=job_type,
        resource_type=resource_type,
        resource_id=resource_id,
        arq_job_id=arq_job_id,
        status="queued" if arq_job_id else "pending",
        max_attempts=max_attempts,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def _enqueue_arq(function_name: str, *args) -> Optional[str]:
    """Enqueue via arq. Returns the arq job id or None on failure."""
    try:
        from arq import create_pool
        from arq.connections import RedisSettings
        from urllib.parse import urlparse

        parsed = urlparse(os.environ["REDIS_URL"])
        pool = await create_pool(
            RedisSettings(
                host=parsed.hostname or "localhost",
                port=parsed.port or 6379,
                database=int(parsed.path.lstrip("/") or 0),
                password=parsed.password,
                ssl=parsed.scheme == "rediss",
            )
        )
        try:
            job_id = f"purvex-{uuid.uuid4().hex}"
            enqueued = await pool.enqueue_job(function_name, *args, _job_id=job_id)
            if enqueued is None:
                logger.warning(
                    "arq refused to enqueue %s (duplicate job id?)", function_name
                )
                return None
            return job_id
        finally:
            await pool.close()
    except Exception:
        logger.exception("Failed to enqueue %s via arq; will fall back", function_name)
        return None


async def enqueue_test_execution(
    *,
    db: AsyncSession,
    background_tasks: BackgroundTasks,
    test_id: int,
    org_id: int,
    max_attempts: int = 3,
) -> JobDispatch:
    """Enqueue a detection test execution.

    If Redis is configured, the job runs in the arq worker. Otherwise it runs
    in the API process via FastAPI ``BackgroundTasks`` — fine for dev but not
    robust across restarts.
    """
    arq_job_id: Optional[str] = None
    if _redis_configured():
        arq_job_id = await _enqueue_arq("run_test_execution", test_id, org_id)

    job = await _create_job_row(
        db,
        org_id=org_id,
        job_type="test_execution",
        resource_type="test",
        resource_id=str(test_id),
        arq_job_id=arq_job_id,
        max_attempts=max_attempts,
    )

    if arq_job_id is None:
        # In-process fallback: mimic arq's ctx so the task can update the Job row.
        inprocess_ctx = {"job_id": f"inproc-{job.id}", "job_try": 1}
        job.arq_job_id = inprocess_ctx["job_id"]
        job.status = "queued"
        await db.commit()

        def _schedule_tracked():
            _track_inprocess(run_test_execution(inprocess_ctx, test_id, org_id))

        # FastAPI BackgroundTasks runs callables after the response is sent.
        # Wrapping in _schedule_tracked() means the Task handle is created in
        # the correct event loop and registered for graceful shutdown.
        background_tasks.add_task(_schedule_tracked)
        return JobDispatch(job_id=job.id, arq_job_id=None, mode="inprocess")

    return JobDispatch(job_id=job.id, arq_job_id=arq_job_id, mode="arq")
