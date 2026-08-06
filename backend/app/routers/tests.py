from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status, Query
from typing import List
from datetime import datetime, timedelta, timezone
from typing_extensions import Annotated
import logging
import json
import re
import time

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, desc, func

from .. import models, schemas
from ..db import get_db, async_sessionmaker
from ..services.atomic_runner import generate_marker, execute_test_pipeline
from ..services.detection_versioning import maybe_compute_version_hash
from ..services.scoring import score_test_run
from ..jobs import enqueue_test_execution
from ..schemas import TestDetailResponse
from ..routers.auth import get_current_user
from ..utils.tenant import require_org_id
from ..utils.authz import require_permission, require_test_run, Permission
from ..utils.runner_health import is_runner_stale
from ..services.notifications import notify

router = APIRouter(
    prefix="/tests",
    tags=["tests"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]

logger = logging.getLogger("purvex.api.tests")

# Simple in‑process rate limiter for /tests/run to reduce abuse.
_RATE_LIMIT_WINDOW_SECONDS = 60
_MAX_TESTS_PER_WINDOW = 10
_rate_limit_buckets: dict[str, list[float]] = {}

class TestWithDetectionTitle(schemas.Test):
    # Simple extension of the base Test schema with a denormalised title field.
    # We construct this manually in the query below rather than relying on Pydantic aliases.
    detection_title: str

@router.post("/", response_model=schemas.Test)
async def create_test(
    test: schemas.TestCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.TESTS_CREATE, db)

    # SECURITY: Sanitize all input fields
    from ..utils.sanitize_inputs import sanitize_model_inputs
    sanitized_data = sanitize_model_inputs(test)

    org_id = require_org_id(current_user)

    # SECURITY: detection_id is client-supplied. Without this check a caller
    # could attach a fabricated Test row to another organization's Detection
    # (the FK only requires the id to exist in *some* org), which then gets
    # surfaced as that detection's "latest result" by list_detections's
    # cross-org-unaware aggregation query.
    detection_id = sanitized_data.get("detection_id")
    if detection_id:
        det_result = await db.execute(
            select(models.Detection.id).where(
                models.Detection.id == detection_id,
                models.Detection.organization_id == org_id,
            )
        )
        if det_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Detection not found")

    try:
        db_test = models.Test(organization_id=org_id, **sanitized_data)
        db.add(db_test)
        await db.commit()
        await db.refresh(db_test)
        return db_test
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Failed to create test",
            extra={"user_id": current_user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to create test.",
        ) from exc

@router.post("/run", response_model=schemas.Test)
async def run_test(
    test_run: schemas.TestRunCreate,
    background_tasks: BackgroundTasks,
    db: DBSession,
    current_user: CurrentUser,
):
    # Capture simple fields from the ORM user up front so we never trigger
    # lazy loads inside background sessions or exception handlers.
    safe_user_id = getattr(current_user, "id", None)
    safe_user_email = getattr(current_user, "email", None)

    try:
        # 1. Load Detection from DB, scoped to the user's organization.
        org_id = require_org_id(current_user)
        detection = None
        technique_id: str

        # Free plan: cap real test runs per calendar day (UTC). Checked before
        # anything else so a free org that's hit today's cap gets a clear,
        # specific reason rather than failing deeper in for an unrelated cause.
        from ..utils.license import get_org_license_status
        license_status = await get_org_license_status(db, org_id)
        if license_status.daily_test_run_limit is not None:
            day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            today_count_result = await db.execute(
                select(func.count(models.Test.id)).where(
                    models.Test.organization_id == org_id,
                    models.Test.started_at >= day_start,
                )
            )
            today_count = today_count_result.scalar_one()
            if today_count >= license_status.daily_test_run_limit:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        f"Free plan is limited to {license_status.daily_test_run_limit} test runs per day. "
                        "Upgrade at purvex-llc.com/pricing to run more, or try again tomorrow."
                    ),
                )

        # Load current testing policy for safety checks (allowed envs, etc.).
        policy_result = await db.execute(
            select(models.TestingPolicy).where(
                models.TestingPolicy.organization_id == org_id
            )
        )
        policy = policy_result.scalar_one_or_none()
        allowed_envs = ["lab", "dev"]
        if policy and getattr(policy, "allowed_environments", None):
            try:
                allowed_envs = json.loads(policy.allowed_environments)
            except Exception:
                # Fall back to defaults if JSON is malformed
                allowed_envs = ["lab", "dev"]

        if test_run.environment not in allowed_envs:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Environment '{test_run.environment}' is not allowed by testing policy.",
            )

        # Block execution on paused/stopped runners.
        if test_run.endpoint:
            runner_result = await db.execute(
                select(models.EnvironmentRunnerConfig)
                .where(models.EnvironmentRunnerConfig.organization_id == org_id)
                .where(models.EnvironmentRunnerConfig.hostname == test_run.endpoint)
            )
            runner = runner_result.scalar_one_or_none()
            if runner and runner.status in {"paused", "pausing", "stopped", "stopping"}:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Runner '{test_run.endpoint}' is {runner.status}. Resume it before running tests.",
                )
            if runner and is_runner_stale(runner):
                minutes = runner.alert_offline_minutes or 5
                await notify(
                    db,
                    organization_id=org_id,
                    title="Validation agent stopped checking in",
                    description=(
                        f"{runner.hostname or 'Runner'} hasn't sent a heartbeat in over "
                        f"{minutes} minutes. Test runs against it are blocked."
                    ),
                    action_url="/lab",
                    status="error",
                    source_type="runner_stale",
                    source_id=str(runner.id),
                )
                await db.commit()
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Runner '{test_run.endpoint}' hasn't checked in for over {minutes} "
                        "minutes; results would be unreliable. Verify the agent is running."
                    ),
                )

        # RBAC: Check permission to run tests in this environment
        await require_test_run(current_user, db, test_run.environment)

        # 1b. Per‑org + per‑user rate limiting for /tests/run.
        rate_key = f"{org_id}:{safe_user_id or 'anon'}"
        now = time.time()
        bucket = _rate_limit_buckets.get(rate_key, [])
        # Drop entries outside the sliding window.
        bucket = [ts for ts in bucket if now - ts < _RATE_LIMIT_WINDOW_SECONDS]
        if len(bucket) >= _MAX_TESTS_PER_WINDOW:
            logger.warning(
                "Rate limit exceeded for org=%s user=%s", org_id, safe_user_id
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many test runs requested. Please wait a moment and try again.",
            )
        bucket.append(now)
        _rate_limit_buckets[rate_key] = bucket

        if test_run.detection_id:
            stmt = select(models.Detection).where(
                models.Detection.id == test_run.detection_id,
                models.Detection.organization_id == org_id,
            )

            result = await db.execute(stmt)
            detection = result.scalar_one_or_none()

            if not detection:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")

            technique_id = detection.technique_id
        else:
            # Scenario‑driven run without a concrete Detection in inventory.
            if not test_run.technique_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="technique_id is required when no detection_id is provided.",
                )
            # Basic input validation for technique_id to match Txxxx or Txxxx.yyy.
            if not re.match(r"^T\d{4}(\.\d{3})?$", test_run.technique_id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid technique_id format. Expected Txxxx or Txxxx.yyy.",
                )
            technique_id = test_run.technique_id

        # 2. Create Test row
        # Generate marker here to ensure it's available for the pipeline and consistent
        marker = generate_marker(test_run.environment)
        initiated_by_username = getattr(current_user, "username", None) or (safe_user_email.split("@")[0] if safe_user_email else None)
        initiated_by_role = None
        if safe_user_id:
            try:
                from ..services.rbac import RBACService
                rbac = RBACService(db)
                roles = await rbac.get_user_roles(safe_user_id, org_id)
                if roles:
                    initiated_by_role = roles[0].value
            except Exception:
                initiated_by_role = None

        db_test = models.Test(
            organization_id=org_id,
            detection_id=test_run.detection_id,
            technique_id=technique_id,
            environment=test_run.environment,
            mode=test_run.mode or "DETECTION_VALIDATION",
            status="pending",  # Will be set to "running" in pipeline
            marker=marker,
            endpoint=test_run.endpoint,
            atomic_test_id=test_run.atomic_test_id,
            atomic_test_name=test_run.atomic_test_name,
            atomic_test_number=test_run.atomic_test_number,
            initiated_by_user_id=safe_user_id,
            initiated_by_email=safe_user_email,
            initiated_by_username=initiated_by_username,
            initiated_by_role=initiated_by_role,
            started_at=datetime.utcnow(),
            detection_version_hash=maybe_compute_version_hash(detection),
        )
        db.add(db_test)
        await db.commit()
        await db.refresh(db_test)

        # 3. Append an audit event for the scheduled test run.
        async with async_sessionmaker() as session:
            session.add(
                models.AuditEvent(
                    user_id=safe_user_id,
                    user_email=safe_user_email,
                    action="RUN_TEST",
                    resource_type="test",
                    resource_id=str(db_test.id),
                    details=(
                        f"detection_id={db_test.detection_id}, "
                        f"env={db_test.environment}, "
                        f"mode={getattr(test_run, 'mode', 'DETECTION_VALIDATION')}, "
                        f"atomic_test_number={db_test.atomic_test_number or 'default'}"
                    ),
                )
            )
            await session.commit()

        # 4. Enqueue the test for the worker (arq when REDIS_URL is set,
        # in-process BackgroundTasks otherwise). A Job row is created so the
        # UI can show status, attempts, and last error independently of the
        # underlying queue driver.
        await enqueue_test_execution(
            db=db,
            background_tasks=background_tasks,
            test_id=db_test.id,
            org_id=org_id,
        )

        # 5. Return `{ id, status, environment }`
        return db_test
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Failed to run test",
            extra={"user_id": safe_user_id},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to start test run.",
        ) from exc

@router.get("/", response_model=List[TestWithDetectionTitle])
async def get_all_tests(
    db: DBSession,
    current_user: CurrentUser,
    skip: int = Query(0, ge=0, le=10_000),
    limit: int = Query(20, ge=1, le=100),
):
    await require_permission(current_user, Permission.TESTS_READ, db)

    org_id = require_org_id(current_user)
    try:
        # If there are no tests, return empty list immediately
        stmt = (
            select(models.Test, models.Detection.title, models.TestArtifact.atomic_command)
            .outerjoin(models.Detection, models.Test.detection_id == models.Detection.id)
            .outerjoin(models.TestArtifact, models.Test.id == models.TestArtifact.test_id)
            .where(models.Test.organization_id == org_id)
            .order_by(desc(models.Test.started_at))
            .offset(skip)
            .limit(limit)
        )
        result = await db.execute(stmt)
        
        tests_with_titles = []
        rows = result.all()
        
        # Handle empty result gracefully
        if not rows:
            return []
        
        for row in rows:
            test_obj, detection_title, atomic_command = row
            try:
                test_data = schemas.Test.model_validate(test_obj)
                tests_with_titles.append(
                    TestWithDetectionTitle(
                        **test_data.model_dump(),
                        detection_title=detection_title or "Unknown Detection",
                        atomic_command=atomic_command,
                    )
                )
            except Exception as exc:
                logger.error(
                    "Error validating test",
                    exc_info=True,
                    extra={"test_id": getattr(test_obj, "id", None), "user_id": current_user.id},
                )
                # Skip invalid tests but continue processing others
                continue
        
        return tests_with_titles
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Error in get_all_tests",
            extra={"user_id": current_user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load tests.",
        ) from exc

# IMPORTANT: Schedule routes must be defined BEFORE /{test_id} route
# to prevent "schedules" from being matched as a test_id parameter
@router.get("/schedules", response_model=List[schemas.TestSchedule])
async def list_test_schedules(
    db: DBSession,
    current_user: CurrentUser,
):
    """
    List all test schedules for the current organisation.

    Restricted to admin users to keep scheduling under explicit control.
    """
    await require_permission(current_user, Permission.TESTS_SCHEDULE_PROD, db)
    org_id = require_org_id(current_user)

    stmt = (
        select(models.TestSchedule)
        .where(models.TestSchedule.organization_id == org_id)
        .order_by(models.TestSchedule.created_at.desc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/schedules", response_model=schemas.TestSchedule, status_code=status.HTTP_201_CREATED)
async def create_test_schedule(
    payload: schemas.TestScheduleCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Create a new scheduled test run (once / interval / cron).

    RBAC: Requires tests:schedule permission (or tests:schedule:prod for PROD).
    For now, execution is handled by an external worker that reads next_run_at as the trigger.
    """
    # SECURITY: Sanitize all input fields
    from ..utils.sanitize_inputs import sanitize_model_inputs
    sanitized_data = sanitize_model_inputs(payload)
    
    from ..utils.authz import require_schedule
    await require_schedule(current_user, db, sanitized_data.get("environment") or payload.environment)
    org_id = require_org_id(current_user)

    from ..utils.license import get_org_license_status
    license_status = await get_org_license_status(db, org_id)
    if not license_status.schedules_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Scheduled test runs require a paid plan. Upgrade at purvex-llc.com/pricing.",
        )

    schedule_type = sanitized_data.get("schedule_type") or payload.schedule_type
    if schedule_type not in {"once", "interval", "cron"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="schedule_type must be one of: once, interval, cron.",
        )

    detection_id = sanitized_data.get("detection_id") or payload.detection_id
    technique_id = sanitized_data.get("technique_id") or payload.technique_id
    
    if not detection_id and not technique_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either detection_id or technique_id must be provided.",
        )

    # Ensure referenced detection belongs to this organisation when provided.
    if detection_id:
        stmt = select(models.Detection).where(
            models.Detection.id == detection_id,
            models.Detection.organization_id == org_id,
        )
        det_result = await db.execute(stmt)
        detection = det_result.scalar_one_or_none()
        if detection is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Detection not found for this organisation.",
            )

    # Derive next_run_at based on schedule type.
    next_run_at = None
    if schedule_type == "once":
        run_at = sanitized_data.get("run_at") or payload.run_at
        if run_at is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="run_at is required for 'once' schedules.",
            )
        next_run_at = run_at
    elif schedule_type == "interval":
        interval_seconds = sanitized_data.get("interval_seconds") or payload.interval_seconds
        if not interval_seconds or interval_seconds <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="interval_seconds must be > 0 for 'interval' schedules.",
            )
        next_run_at = datetime.utcnow() + timedelta(seconds=interval_seconds)
    else:  # cron
        cron_expression = sanitized_data.get("cron_expression") or payload.cron_expression
        if not cron_expression:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="cron_expression is required for 'cron' schedules.",
            )
        # Calculate next_run_at for cron schedules
        try:
            from croniter import croniter
            cron = croniter(cron_expression, datetime.utcnow())
            next_run_at = cron.get_next(datetime)
        except ImportError:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="croniter package not installed. Install with: pip install croniter",
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid cron expression: {str(exc)}",
            )

    schedule = models.TestSchedule(
        organization_id=org_id,
        detection_id=detection_id,
        technique_id=technique_id,
        environment=sanitized_data.get("environment") or payload.environment,
        mode=sanitized_data.get("mode") or payload.mode,
        schedule_type=schedule_type,
        run_at=sanitized_data.get("run_at") or payload.run_at,
        interval_seconds=sanitized_data.get("interval_seconds") or payload.interval_seconds,
        cron_expression=sanitized_data.get("cron_expression") or payload.cron_expression,
        enabled=sanitized_data.get("enabled") if "enabled" in sanitized_data else payload.enabled,
        created_by_user_id=getattr(current_user, "id", None),
        next_run_at=next_run_at,
    )

    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return schedule


@router.get("/{test_id}", response_model=TestDetailResponse)
async def get_test_detail(
    test_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.TESTS_READ, db)

    # SECURITY: Validate test_id is positive
    if test_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid test ID")
    
    org_id = require_org_id(current_user)
    try:
        stmt = (
            select(models.Test, models.Detection, models.TestArtifact)
            .where(
                models.Test.id == test_id,
                models.Test.organization_id == org_id,
            )
            .outerjoin(models.Detection, models.Test.detection_id == models.Detection.id)
            .outerjoin(models.TestArtifact, models.Test.id == models.TestArtifact.test_id)
        )

        result = await db.execute(stmt)

        rows = result.all()
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found")

        # Assuming one test, optional detection, and at most one artifact per test for now
        test_obj, detection_obj, artifact_obj = rows[0]

        detection_payload = (
            schemas.Detection.model_validate(detection_obj) if detection_obj is not None else None
        )

        # Manually construct the response using TestDetailResponse schema
        return TestDetailResponse(
            id=test_obj.id,
            detection_id=test_obj.detection_id,
            technique_id=test_obj.technique_id,
            marker=test_obj.marker,
            environment=test_obj.environment,
            status=test_obj.status,
            result=test_obj.result,
            score=test_obj.score,
            started_at=test_obj.started_at,
            finished_at=test_obj.finished_at,
            detection=detection_payload,
            artifact=schemas.TestArtifact.model_validate(artifact_obj) if artifact_obj else None,
        )
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Error loading test detail",
            extra={"test_id": test_id, "user_id": current_user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load test details.",
        ) from exc

@router.post("/{test_id}/artifacts/", response_model=schemas.TestArtifact)
async def create_test_artifact(
    test_id: int,
    artifact: schemas.TestArtifactCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.TESTS_CREATE, db)

    # SECURITY: Validate test_id is positive
    if test_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid test ID")
    
    org_id = require_org_id(current_user)
    try:
        # CRITICAL: Verify test exists and belongs to this org before creating artifact.
        test_stmt = select(models.Test).where(
            models.Test.id == test_id,
            models.Test.organization_id == org_id,
        )
        test_result = await db.execute(test_stmt)
        test = test_result.scalar_one_or_none()
        if test is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Test not found or access denied.",
            )
        
        db_artifact = models.TestArtifact(
            organization_id=org_id,
            **artifact.model_dump(),
            test_id=test_id,
        )
        db.add(db_artifact)
        await db.commit()
        await db.refresh(db_artifact)
        return db_artifact
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Failed to create test artifact",
            extra={"test_id": test_id, "user_id": current_user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to create test artifact.",
        ) from exc

@router.get("/{test_id}/artifacts/", response_model=List[schemas.TestArtifact])
async def read_test_artifacts(
    test_id: int,
    db: DBSession,
    current_user: CurrentUser,
    skip: int = Query(0, ge=0, le=10_000),
    limit: int = Query(100, ge=1, le=200),
):
    await require_permission(current_user, Permission.TESTS_READ, db)

    # SECURITY: Validate test_id is positive
    if test_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid test ID")
    
    org_id = require_org_id(current_user)
    try:
        stmt = (
            select(models.TestArtifact)
            .where(
                models.TestArtifact.test_id == test_id,
                models.TestArtifact.organization_id == org_id,
            )
            .offset(skip)
            .limit(limit)
        )

        result = await db.execute(stmt)
        artifacts = result.scalars().all()
        return artifacts
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Error loading test artifacts",
            extra={"test_id": test_id, "user_id": current_user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load test artifacts.",
        ) from exc

@router.get("/{test_id}/artifacts/{artifact_id}", response_model=schemas.TestArtifact)
async def read_test_artifact(
    test_id: int,
    artifact_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.TESTS_READ, db)

    # SECURITY: Validate IDs are positive
    if test_id <= 0 or artifact_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid test or artifact ID")
    org_id = require_org_id(current_user)
    try:
        stmt = select(models.TestArtifact).where(
            models.TestArtifact.test_id == test_id,
            models.TestArtifact.id == artifact_id,
            models.TestArtifact.organization_id == org_id,
        )

        result = await db.execute(stmt)
        artifact = result.scalar_one_or_none()
        if artifact is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test Artifact not found")
        return artifact
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Error loading single test artifact",
            extra={"test_id": test_id, "artifact_id": artifact_id, "user_id": current_user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load test artifact.",
        ) from exc


@router.post("/{test_id}/results/score", response_model=schemas.ScoreTestRunResponse)
async def score_test_results(
    test_id: int,
    body: schemas.ScoreTestRunRequest,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Compute C/T/F/E + 5W scores for a test run using a payload from Watchtower.

    This keeps Watchtower and the PurveX API in sync by funnelling all scoring
    through a single backend implementation.
    """
    await require_permission(current_user, Permission.TESTS_CREATE, db)

    org_id = require_org_id(current_user)

    # Ensure the test exists and belongs to the caller's organisation.
    stmt = select(models.Test).where(
        models.Test.id == test_id,
        models.Test.organization_id == org_id,
    )
    result = await db.execute(stmt)
    test = result.scalar_one_or_none()
    if test is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Test not found",
        )

    # Delegate to the pure scoring function so logic stays centralised.
    scoring = score_test_run(
        attack_start_time=body.attack_start_time,
        detections_raw=[d.model_dump() for d in body.detections],
        ml_model=None,  # ML model can be injected here later.
    )

    # Best-effort: persist the final numeric score onto the Test row so the UI
    # stays aligned with Watchtower. Errors here should not break the API.
    try:
        test.score = int(round(float(scoring.get("final_score", 0.0))))
        db.add(test)
        await db.commit()
        await db.refresh(test)
    except Exception as exc:  # pragma: no cover - defensive safety
        logger.exception(
            "Failed to persist scored test result",
            extra={"test_id": test_id, "user_id": current_user.id},
        )

    return scoring

@router.post("/debug_post")
async def debug_post(current_user: CurrentUser):
    # Keep this endpoint for local diagnostics only; restrict to admin users.
    # This route has no DB dependency, so keep the legacy admin flag check.
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return {"message": "Debug POST successful!"}


@router.post("/reset-active", response_model=dict)
async def reset_active_tests(
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Clear the "queue" of active tests for the current organisation by
    marking any running/QA/pending tests as completed.

    This is primarily a UX escape hatch so the Active Tests card can be
    reset during demos and lab work.
    """
    await require_permission(current_user, Permission.SETTINGS_UPDATE, db)
    org_id = require_org_id(current_user)

    try:
        stmt = select(models.Test).where(
            models.Test.organization_id == org_id,
            models.Test.status.in_(["running", "qa", "pending"]),
        )
        result = await db.execute(stmt)
        tests = result.scalars().all()

        cleared = 0
        now = datetime.utcnow()
        for t in tests:
            t.status = "completed"
            if not t.finished_at:
                t.finished_at = now
            cleared += 1

        if cleared:
            await db.commit()

        return {"cleared": cleared}
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception(
            "Failed to reset active tests",
            extra={"user_id": current_user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to reset active tests.",
        ) from exc


@router.patch("/schedules/{schedule_id}", response_model=schemas.TestSchedule)
async def update_test_schedule(
    schedule_id: int,
    payload: schemas.TestScheduleUpdate,
    db: DBSession,
    current_user: CurrentUser,
):
    """Enable, disable, or re-parameterize a schedule."""
    if schedule_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid schedule ID")
    await require_permission(current_user, Permission.TESTS_SCHEDULE_PROD, db)
    org_id = require_org_id(current_user)

    stmt = select(models.TestSchedule).where(
        models.TestSchedule.id == schedule_id,
        models.TestSchedule.organization_id == org_id,
    )
    result = await db.execute(stmt)
    schedule = result.scalar_one_or_none()
    if schedule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found")

    updates = payload.model_dump(exclude_unset=True)
    was_disabled = not schedule.enabled
    for field, value in updates.items():
        setattr(schedule, field, value)

    # If re-enabling a schedule that has no scheduled next run, compute one.
    if updates.get("enabled") is True and was_disabled and schedule.next_run_at is None:
        now = datetime.utcnow()
        if schedule.schedule_type == "interval" and schedule.interval_seconds:
            schedule.next_run_at = now + timedelta(seconds=schedule.interval_seconds)
        elif schedule.schedule_type == "cron" and schedule.cron_expression:
            try:
                from croniter import croniter
                schedule.next_run_at = croniter(schedule.cron_expression, now).get_next(datetime)
            except Exception:
                pass

    await db.commit()
    await db.refresh(schedule)

    from ..db import async_sessionmaker
    async with async_sessionmaker() as session:
        session.add(models.AuditEvent(
            user_id=current_user.id,
            user_email=current_user.email,
            action="UPDATE_TEST_SCHEDULE",
            resource_type="test_schedule",
            resource_id=str(schedule_id),
            details=f"Updated: {', '.join(updates.keys())}",
        ))
        await session.commit()

    return schedule


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_test_schedule(
    schedule_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    # SECURITY: Validate schedule_id is positive
    if schedule_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid schedule ID")
    
    """
    Delete a test schedule by ID.
    
    Restricted to admin users. Ensures the schedule belongs to the caller's organization.
    """
    await require_permission(current_user, Permission.TESTS_SCHEDULE_PROD, db)
    org_id = require_org_id(current_user)
    
    # CRITICAL: Verify schedule exists and belongs to this org before deletion.
    stmt = select(models.TestSchedule).where(
        models.TestSchedule.id == schedule_id,
        models.TestSchedule.organization_id == org_id,
    )
    result = await db.execute(stmt)
    schedule = result.scalar_one_or_none()
    
    if schedule is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Schedule not found or access denied.",
        )
    
    # Capture schedule details for audit log before deletion
    schedule_details = f"Schedule ID {schedule_id} (detection_id={schedule.detection_id}, technique_id={schedule.technique_id})"
    
    await db.execute(
        delete(models.TestSchedule).where(
            models.TestSchedule.id == schedule_id,
            models.TestSchedule.organization_id == org_id,
        )
    )
    await db.commit()
    
    # SECURITY: Audit log for schedule deletion
    from ..db import async_sessionmaker
    async with async_sessionmaker() as session:
        try:
            user_id = int(current_user.id) if current_user.id else None
            user_email = str(current_user.email) if current_user.email else None
        except Exception:
            user_id = None
            user_email = None
        
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="DELETE_TEST_SCHEDULE",
                resource_type="test_schedule",
                resource_id=str(schedule_id),
                details=schedule_details,
            )
        )
        await session.commit()

    return None


@router.get("/{test_id}/job")
async def get_test_job(
    test_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    """Return the most recent background job row for a test.

    The UI polls this to show worker state (queued/running/failed/timeout) in
    addition to the test's own status field.
    """
    await require_permission(current_user, Permission.TESTS_READ, db)

    org_id = require_org_id(current_user)
    # Confirm the test belongs to the caller's org before leaking job metadata.
    test_result = await db.execute(
        select(models.Test).where(
            models.Test.id == test_id,
            models.Test.organization_id == org_id,
        )
    )
    if not test_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Test not found")

    job_result = await db.execute(
        select(models.Job)
        .where(
            models.Job.resource_type == "test",
            models.Job.resource_id == str(test_id),
            models.Job.organization_id == org_id,
        )
        .order_by(desc(models.Job.enqueued_at))
        .limit(1)
    )
    job = job_result.scalar_one_or_none()
    if not job:
        return {"status": "none"}
    return {
        "id": job.id,
        "status": job.status,
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "last_error": job.last_error,
        "enqueued_at": job.enqueued_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }
