"""
Test Scheduling Worker

This service periodically checks for scheduled tests that are due to run
and executes them automatically.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy import func, select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import async_sessionmaker
from .. import models
from .atomic_runner import execute_test_pipeline
from .detection_versioning import maybe_compute_version_hash
from ..utils.license import get_org_license_status

logger = logging.getLogger("purvex.scheduler")

# Global flag to control worker lifecycle
_scheduler_running = False
_scheduler_task: Optional[asyncio.Task] = None


async def process_due_schedules():
    """
    Check for scheduled tests that are due to run and execute them.
    This function is called periodically by the scheduler worker.
    """
    try:
        async with async_sessionmaker() as session:
            # Find all enabled schedules where next_run_at is in the past
            now = datetime.utcnow()
            
            stmt = select(models.TestSchedule).where(
                and_(
                    models.TestSchedule.enabled == True,
                    models.TestSchedule.next_run_at <= now,
                    models.TestSchedule.next_run_at.isnot(None)
                )
            )
            
            result = await session.execute(stmt)
            due_schedules = result.scalars().all()
            
            if not due_schedules:
                return
            
            logger.info(f"Found {len(due_schedules)} scheduled test(s) due to run")
            
            for schedule in due_schedules:
                try:
                    await execute_scheduled_test(schedule, session)
                except Exception as exc:
                    logger.exception(
                        f"Failed to execute scheduled test {schedule.id}",
                        exc_info=exc
                    )
                    # Continue with other schedules even if one fails
                    
    except asyncio.CancelledError:
        # Allow cancellation to propagate cleanly during shutdown/reload
        raise
    except Exception as exc:
        logger.exception("Error in process_due_schedules", exc_info=exc)


async def execute_scheduled_test(schedule: models.TestSchedule, session: AsyncSession):
    """
    Execute a single scheduled test and update the schedule for the next run.
    """
    logger.info(
        f"Executing scheduled test {schedule.id} "
        f"(detection_id={schedule.detection_id}, technique_id={schedule.technique_id}, "
        f"env={schedule.environment})"
    )
    
    # Create a Test record (similar to /tests/run endpoint)
    # We don't need TestRunCreate here, we'll create the Test directly
    org_id = schedule.organization_id

    # SECURITY: schedule creation already requires schedules_enabled (see
    # tests.create_test_schedule), but that check only ran once, at create
    # time. Without re-checking here, a schedule made while paid would keep
    # firing forever after the license lapses back to free, and every run it
    # produces would be exempt from the free-tier daily_test_run_limit too
    # (this function is the only other place that inserts a Test row besides
    # the gated /tests/run endpoint). Re-verify both on every firing instead.
    license_status = await get_org_license_status(session, org_id)
    if not license_status.schedules_enabled:
        logger.warning(
            f"Schedule {schedule.id} (org={org_id}) is no longer covered by a paid plan; "
            "pausing it instead of executing."
        )
        schedule.enabled = False
        schedule.next_run_at = None
        session.add(
            models.AuditEvent(
                user_id=schedule.created_by_user_id,
                user_email=None,
                action="SCHEDULE_AUTO_PAUSED",
                resource_type="test_schedule",
                resource_id=str(schedule.id),
                details="Paused: organization's license no longer includes scheduled runs.",
            )
        )
        await session.commit()
        return

    if license_status.daily_test_run_limit is not None:
        day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        today_count_result = await session.execute(
            select(func.count(models.Test.id)).where(
                models.Test.organization_id == org_id,
                models.Test.started_at >= day_start,
            )
        )
        if today_count_result.scalar_one() >= license_status.daily_test_run_limit:
            logger.info(
                f"Schedule {schedule.id} (org={org_id}) skipped this firing: "
                "free plan's daily test run limit already reached today."
            )
            await update_schedule_next_run(schedule, session)
            await session.commit()
            return

    # Generate marker
    from .atomic_runner import generate_marker
    marker = generate_marker(schedule.environment)
    
    initiated_email = None
    initiated_username = None
    initiated_role = None
    if schedule.created_by_user_id:
        try:
            result = await session.execute(
                select(models.User.email, models.User.username).where(models.User.id == schedule.created_by_user_id)
            )
            row = result.first()
            if row:
                initiated_email, initiated_username = row
            from ..services.rbac import RBACService
            rbac = RBACService(session)
            roles = await rbac.get_user_roles(schedule.created_by_user_id, org_id)
            if roles:
                initiated_role = roles[0].value
        except Exception:
            initiated_email = None

    # Snapshot the rule's version hash at run time. Scenario-only schedules
    # (no detection_id) skip the load and store NULL, matching /tests/run.
    scheduled_detection: Optional[models.Detection] = None
    if schedule.detection_id:
        det_result = await session.execute(
            select(models.Detection).where(
                models.Detection.id == schedule.detection_id,
                models.Detection.organization_id == org_id,
            )
        )
        scheduled_detection = det_result.scalar_one_or_none()

    db_test = models.Test(
        organization_id=org_id,
        detection_id=schedule.detection_id,
        technique_id=schedule.technique_id or "UNKNOWN",
        environment=schedule.environment,
        mode=schedule.mode or "DETECTION_VALIDATION",
        status="pending",
        marker=marker,
        initiated_by_user_id=schedule.created_by_user_id,
        initiated_by_email=initiated_email,
        initiated_by_username=initiated_username,
        initiated_by_role=initiated_role,
        started_at=datetime.utcnow(),
        detection_version_hash=maybe_compute_version_hash(scheduled_detection),
    )
    session.add(db_test)
    await session.commit()
    await session.refresh(db_test)
    
    # Log audit event
    session.add(
        models.AuditEvent(
            user_id=schedule.created_by_user_id,
            user_email=None,  # System-initiated
            action="SCHEDULE_TEST",
            resource_type="test",
            resource_id=str(db_test.id),
            details=(
                f"Scheduled test executed: schedule_id={schedule.id}, "
                f"detection_id={schedule.detection_id}, env={schedule.environment}"
            ),
        )
    )
    await session.commit()
    
    # Execute the test pipeline in the background
    # Note: execute_test_pipeline expects test_id and org_id
    # Use create_task to run in background without blocking
    try:
        asyncio.create_task(execute_test_pipeline(db_test.id, org_id))
    except Exception as pipeline_err:
        logger.exception(
            f"Failed to start test pipeline for scheduled test {schedule.id}",
            exc_info=pipeline_err
        )
    
    # Update schedule for next run
    await update_schedule_next_run(schedule, session)


async def update_schedule_next_run(schedule: models.TestSchedule, session: AsyncSession):
    """
    Calculate and update the next_run_at timestamp based on schedule type.
    """
    now = datetime.utcnow()
    
    if schedule.schedule_type == "once":
        # One-time schedule - disable it
        schedule.enabled = False
        schedule.next_run_at = None
        logger.info(f"One-time schedule {schedule.id} completed and disabled")
        
    elif schedule.schedule_type == "interval":
        # Interval schedule - add interval to now
        if schedule.interval_seconds:
            schedule.next_run_at = now + timedelta(seconds=schedule.interval_seconds)
            logger.info(
                f"Interval schedule {schedule.id} next run at {schedule.next_run_at}"
            )
        else:
            schedule.enabled = False
            logger.warning(f"Interval schedule {schedule.id} has no interval_seconds, disabling")
            
    elif schedule.schedule_type == "cron":
        # Cron schedule - calculate next run from cron expression
        if schedule.cron_expression:
            try:
                from croniter import croniter
                cron = croniter(schedule.cron_expression, now)
                schedule.next_run_at = cron.get_next(datetime)
                logger.info(
                    f"Cron schedule {schedule.id} next run at {schedule.next_run_at}"
                )
            except ImportError:
                logger.error(
                    "croniter package not installed. Install with: pip install croniter"
                )
                schedule.enabled = False
            except Exception as exc:
                logger.exception(
                    f"Error parsing cron expression '{schedule.cron_expression}' for schedule {schedule.id}",
                    exc_info=exc
                )
                schedule.enabled = False
        else:
            schedule.enabled = False
            logger.warning(f"Cron schedule {schedule.id} has no cron_expression, disabling")
    
    session.add(schedule)
    await session.commit()


async def scheduler_worker(interval_seconds: int = 60):
    """
    Background worker that periodically checks for due scheduled tests.
    
    Args:
        interval_seconds: How often to check for due schedules (default: 60 seconds)
    """
    logger.info(f"Test scheduler worker started (checking every {interval_seconds}s)")
    
    try:
        while _scheduler_running:
            try:
                await process_due_schedules()
            except asyncio.CancelledError:
                # Propagate cancellation to exit loop promptly
                raise
            except Exception as exc:
                logger.exception("Error in scheduler worker loop", exc_info=exc)
            
            # Wait before next check
            await asyncio.sleep(interval_seconds)
    except asyncio.CancelledError:
        logger.info("Scheduler worker cancelled; exiting")
        raise
    finally:
        logger.info("Test scheduler worker stopped")


def start_scheduler(interval_seconds: int = 60):
    """
    Start the test scheduler worker.
    
    Args:
        interval_seconds: How often to check for due schedules
    """
    global _scheduler_running, _scheduler_task
    
    if _scheduler_running:
        logger.warning("Scheduler is already running")
        return
    
    _scheduler_running = True
    _scheduler_task = asyncio.create_task(scheduler_worker(interval_seconds))
    logger.info("Test scheduler started")


async def stop_scheduler():
    """
    Stop the test scheduler worker.
    """
    global _scheduler_running, _scheduler_task
    
    if not _scheduler_running:
        return
    
    _scheduler_running = False
    if _scheduler_task:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
        _scheduler_task = None
    logger.info("Test scheduler stopped")
