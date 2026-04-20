"""Tests for the background job framework.

Covers the acceptance criteria for Phase 2 Workstream 4:
- Retried jobs are idempotent (terminal tests are not re-executed)
- Per-job timeout marks the test as error and records the failure on the Job
- Enqueue writes a Job row even when Redis is absent (in-process fallback)
"""
from __future__ import annotations

import asyncio
from datetime import datetime

import pytest
import pytest_asyncio
from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def job_context(monkeypatch):
    from app import models

    # Ensure the enqueue helper takes the in-process path, not the arq path.
    monkeypatch.delenv("REDIS_URL", raising=False)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    sm = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with sm() as session:
        org = models.Organization(id=1, name="Test Org")
        session.add(org)
        await session.commit()

        test = models.Test(
            organization_id=1,
            technique_id="T1010",
            environment="lab",
            status="pending",
            started_at=datetime.utcnow(),
        )
        session.add(test)
        await session.commit()
        await session.refresh(test)
        test_id = test.id

    # Point the task's sessionmaker at the in-memory engine so _update_job
    # and _mark_test_error operate on the same rows the tests assert against.
    import app.jobs.test_execution as te

    monkeypatch.setattr(te, "async_sessionmaker", sm)

    yield sm, test_id, models
    await engine.dispose()


@pytest.mark.asyncio
async def test_enqueue_creates_job_row_with_inprocess_fallback(job_context):
    from app.jobs.enqueue import enqueue_test_execution
    from app import models as app_models

    sm, test_id, models = job_context

    # The in-process path schedules the task on BackgroundTasks; we don't want
    # it to actually run during this test, so stub the real pipeline.
    import app.jobs.test_execution as te

    async def noop_pipeline(*_args, **_kwargs):
        return None

    async with sm() as session:
        bg = BackgroundTasks()
        # Monkey-patch at the module level for this test only.
        original_run = te.run_test_execution

        async def fake_run(ctx, tid, oid):
            return {"status": "success"}

        te.run_test_execution = fake_run  # type: ignore[assignment]
        try:
            dispatch = await enqueue_test_execution(
                db=session,
                background_tasks=bg,
                test_id=test_id,
                org_id=1,
            )
        finally:
            te.run_test_execution = original_run  # type: ignore[assignment]

    assert dispatch.mode == "inprocess"
    assert dispatch.arq_job_id is None

    async with sm() as session:
        jobs = (await session.execute(select(app_models.Job))).scalars().all()
        assert len(jobs) == 1
        job = jobs[0]
        assert job.job_type == "test_execution"
        assert job.resource_type == "test"
        assert job.resource_id == str(test_id)
        assert job.status == "queued"
        assert job.arq_job_id and job.arq_job_id.startswith("inproc-")


@pytest.mark.asyncio
async def test_retry_is_idempotent_when_test_already_terminal(job_context):
    """A retry on a completed test must not re-run the atomic pipeline."""
    from app.jobs.test_execution import run_test_execution
    import app.jobs.test_execution as te

    sm, test_id, models = job_context

    # Seed: test is already in a terminal state (e.g. previous attempt finished).
    async with sm() as session:
        test = await session.get(models.Test, test_id)
        test.status = "completed"
        test.finished_at = datetime.utcnow()
        session.add(test)
        # Also seed a Job row so _update_job finds something to update.
        job = models.Job(
            organization_id=1,
            job_type="test_execution",
            resource_type="test",
            resource_id=str(test_id),
            arq_job_id="purvex-retry-test",
            status="running",
            attempts=1,
            max_attempts=3,
        )
        session.add(job)
        await session.commit()

    # Guard: the pipeline must never be called on a terminal test.
    pipeline_calls = {"count": 0}

    async def guard_pipeline(*_args, **_kwargs):
        pipeline_calls["count"] += 1

    monkeypatched_pipeline = te.execute_test_pipeline
    te.execute_test_pipeline = guard_pipeline  # type: ignore[assignment]
    try:
        result = await run_test_execution(
            {"job_id": "purvex-retry-test", "job_try": 2},
            test_id,
            1,
        )
    finally:
        te.execute_test_pipeline = monkeypatched_pipeline  # type: ignore[assignment]

    assert result == {"status": "skipped", "reason": "already_terminal"}
    assert pipeline_calls["count"] == 0

    async with sm() as session:
        job = (
            await session.execute(select(models.Job).where(models.Job.arq_job_id == "purvex-retry-test"))
        ).scalar_one()
        assert job.status == "success"
        assert job.finished_at is not None


@pytest.mark.asyncio
async def test_timeout_marks_test_as_error(job_context, monkeypatch):
    """A pipeline that exceeds the per-job timeout is forced to error."""
    from app.jobs.test_execution import run_test_execution
    import app.jobs.test_execution as te

    sm, test_id, models = job_context

    # Seed the Job row the task will update.
    async with sm() as session:
        job = models.Job(
            organization_id=1,
            job_type="test_execution",
            resource_type="test",
            resource_id=str(test_id),
            arq_job_id="purvex-timeout-test",
            status="queued",
            attempts=0,
            max_attempts=3,
        )
        session.add(job)
        await session.commit()

    # Shrink the timeout and replace the pipeline with one that hangs.
    monkeypatch.setattr(te, "_job_timeout_seconds", lambda: 1)

    async def hanging_pipeline(*_args, **_kwargs):
        await asyncio.sleep(10)

    monkeypatch.setattr(te, "execute_test_pipeline", hanging_pipeline)

    with pytest.raises(asyncio.TimeoutError):
        await run_test_execution(
            {"job_id": "purvex-timeout-test", "job_try": 1},
            test_id,
            1,
        )

    async with sm() as session:
        test = await session.get(models.Test, test_id)
        assert test.status == "error"
        assert test.finished_at is not None

        job = (
            await session.execute(
                select(models.Job).where(models.Job.arq_job_id == "purvex-timeout-test")
            )
        ).scalar_one()
        assert job.status == "timeout"
        assert job.last_error and "Timed out" in job.last_error
        assert job.attempts == 1

        audit = (
            await session.execute(
                select(models.AuditEvent).where(
                    models.AuditEvent.action == "TEST_JOB_TIMEOUT"
                )
            )
        ).scalars().all()
        assert len(audit) == 1
