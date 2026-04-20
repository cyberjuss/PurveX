from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List
from typing_extensions import Annotated
from datetime import datetime, timedelta
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func

from .. import models, schemas
from ..db import get_db, async_sessionmaker
from ..routers.auth import get_current_user
from ..utils.tenant import require_org_id
from ..utils.authz import (
    require_detection_create,
    require_detection_read,
    require_detection_update,
    require_detection_delete,
    require_criticality_update,
)
from ..utils.endpoint_rate_limit import endpoint_rate_limit
from fastapi import Depends, Request
import uuid

logger = logging.getLogger("purvex.api.detections")

router = APIRouter(
    prefix="/detections",
    tags=["detections"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


@router.post("/", response_model=schemas.Detection)
async def create_detection(
    det: schemas.DetectionCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    # RBAC: Check permission to create detections
    await require_detection_create(current_user, db)
    
    # SECURITY: Sanitize all input fields
    from ..utils.sanitize_inputs import sanitize_model_inputs
    sanitized_data = sanitize_model_inputs(det)
    
    # Capture user identity early to avoid lazy-load after commit (async sessions
    # expire objects on commit, and accessing attributes like current_user.id
    # afterwards can trigger a greenlet-related error).
    try:
        user_id = int(current_user.id)
        user_email = str(current_user.email)
    except Exception:
        user_id = None
        user_email = None
    # DetectionCreate carries some derived lifecycle fields (last_result, last_score, etc.)
    # that are NOT real columns on the Detection model. Exclude them when constructing
    # the ORM object to avoid "invalid keyword argument" errors.
    # Merge sanitized data with excluded fields
    excluded_fields = {
        "last_result",
        "last_score",
        "last_tested_at",
        "last_pass_at",
        "last_fail_at",
        "last_alert_at",
        "status",
        "last_reviewed_at",
        "owner",
        "notes",
    }
    payload = {
        k: v for k, v in sanitized_data.items() if k not in excluded_fields
    }
    org_id = require_org_id(current_user)
    db_detection = models.Detection(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        **payload,
    )
    db.add(db_detection)
    await db.commit()
    await db.refresh(db_detection)

    # Append an audit event for traceability using the SAME DB session.
    # Use the captured user_id/email to avoid triggering lazy loads on an
    # expired ORM instance after commit.
    db.add(
        models.AuditEvent(
            user_id=user_id,
            user_email=user_email,
            action="CREATE_DETECTION",
            resource_type="detection",
            resource_id=db_detection.id,
            details=db_detection.title,
        )
    )
    await db.commit()

    return db_detection


@router.get("/", response_model=list[schemas.Detection])
async def list_detections(
    db: DBSession,
    current_user: CurrentUser,
    request: Request,
    skip: int = Query(0, ge=0, le=10_000),
    limit: int = Query(100, ge=1, le=200),
    _rate_limit = Depends(endpoint_rate_limit(max_requests=50, window_seconds=60, key_prefix="detections:list", per_user=True, per_ip=True)),
):
    # Set user in request.state for rate limiting
    request.state.user = current_user
    """
    List all detections with their latest test results.
    Returns empty list if no detections exist (production-ready).
    """
    await require_detection_read(current_user, db)
    try:
        # Get all detections first - handle empty database gracefully
        try:
            org_id = require_org_id(current_user)
            stmt = (
                select(models.Detection)
                .distinct()
                .where(models.Detection.organization_id == org_id)
                .offset(skip)
                .limit(limit)
            )

            detections_result = await db.execute(stmt)
            detections = detections_result.scalars().all()
            # Additional safeguard: deduplicate by ID (shouldn't be needed, but safety first)
            seen_ids = set()
            unique_detections = []
            for det in detections:
                if det.id not in seen_ids:
                    seen_ids.add(det.id)
                    unique_detections.append(det)
            detections = unique_detections
        except Exception as db_error:
            # If there's a schema issue, log it and return empty list
            logger.error(f"Database error in list_detections: {db_error}", exc_info=True)
            # Check if it's a schema issue
            if "no such column" in str(db_error).lower() or "operationalerror" in str(db_error).lower():
                logger.error("Database schema mismatch detected. Please recreate the database.")
                raise HTTPException(
                    status_code=500,
                    detail="Database schema mismatch. Please restart the backend to recreate the database."
                )
            raise

        if not detections:
            return []

        # Fetch all tests for this batch of detections in ONE query, then pick the
        # latest per detection in Python. Previously this issued N+1 queries.
        # Telemetry-readiness runs are intentionally excluded: they do not
        # evaluate the rule, so they must not flip a detection's last_result /
        # last_score / last_tested_at indicators.
        detection_ids = [d.id for d in detections]
        latest_by_detection: dict[str, models.Test] = {}
        try:
            tests_result = await db.execute(
                select(models.Test).where(
                    models.Test.detection_id.in_(detection_ids),
                    models.Test.mode != "TELEMETRY_CHECK",
                )
            )
            epoch = datetime(1970, 1, 1)
            for test in tests_result.scalars().all():
                current = latest_by_detection.get(test.detection_id)
                key_new = (test.finished_at or epoch, test.started_at or epoch)
                if current is None:
                    latest_by_detection[test.detection_id] = test
                else:
                    key_current = (current.finished_at or epoch, current.started_at or epoch)
                    if key_new > key_current:
                        latest_by_detection[test.detection_id] = test
        except Exception as test_error:
            logger.warning(f"Error batch-fetching tests: {test_error}")

        detections_with_last_test = []
        for detection in detections:
            try:
                detection_data = schemas.Detection.model_validate(detection)
                latest_test = latest_by_detection.get(detection.id)
                if latest_test:
                    detection_data.last_result = latest_test.result
                    detection_data.last_score = latest_test.score
                    detection_data.last_tested_at = latest_test.finished_at
                else:
                    detection_data.last_result = None
                    detection_data.last_score = None
                    detection_data.last_tested_at = None
                detections_with_last_test.append(detection_data)
            except Exception as validation_error:
                logger.error(f"Error validating detection {detection.id}: {validation_error}", exc_info=True)
                continue

        return detections_with_last_test
    except HTTPException:
        # Re-raise HTTP exceptions (like schema mismatch)
        raise
    except Exception as e:
        logger.error("Unexpected error in list_detections", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unable to load detections.",
        )


@router.get("/{detection_id}", response_model=schemas.Detection)
async def get_detection(
    detection_id: str,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_detection_read(current_user, db)
    # SECURITY: Validate detection_id format (UUID)
    import uuid
    try:
        uuid.UUID(detection_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid detection ID format")
    
    org_id = require_org_id(current_user)
    stmt = (
        select(models.Detection)
        .where(
            models.Detection.id == detection_id,
            models.Detection.organization_id == org_id,
        )
    )

    result = await db.execute(stmt)
    det = result.scalar_one_or_none()
    if not det:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")
    return det


@router.get("/{detection_id}/export", response_model=schemas.DetectionExport)
async def export_detection(
    detection_id: str,
    db: DBSession,
    current_user: CurrentUser,
    format: str = Query("yaml", description="Only 'yaml' is supported today."),
):
    """Export a detection as YAML for seeding a Detection-as-Code repo.

    Stable schema: ``id``, ``title``, ``description``, ``sigma_rule``,
    ``siem_type``, ``siem_query``, ``technique_id``, ``status``,
    ``criticality``, ``owner``, ``notes``, ``lifecycle_stage``. Anything
    runtime-only (scores, last-run timestamps, …) is intentionally
    omitted so round-tripping through git doesn't fight with PurveX's
    own bookkeeping.
    """
    await require_detection_read(current_user, db)
    try:
        uuid.UUID(detection_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid detection ID format",
        )
    if format != "yaml":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only format='yaml' is supported",
        )
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.Detection).where(
            models.Detection.id == detection_id,
            models.Detection.organization_id == org_id,
        )
    )
    det = result.scalar_one_or_none()
    if not det:
        raise HTTPException(status_code=404, detail="Detection not found")

    # Local import to avoid pulling the git-sync module at app startup when
    # it's not needed; it imports ``yaml`` + ``subprocess`` which we don't
    # want hot on the import path for the rest of the detections router.
    from ..services.git_sync import detection_to_yaml

    return schemas.DetectionExport(id=det.id, yaml=detection_to_yaml(det))


@router.get("/{detection_id}/alerts", response_model=List[schemas.DetectionAlert])
async def get_detection_alerts(
    detection_id: str,
    db: DBSession,
    current_user: CurrentUser,
    hours: int = Query(24, ge=1, le=168),
    limit: int = Query(50, ge=1, le=500),
):
    """Return recent SIEM events that match the detection's query.

    Queries the org's SIEM connection for the given detection's `siem_type`
    over the last `hours` window. Returns `[]` if no matching SIEM connection
    is configured or the upstream query fails (the failure is logged).
    """
    await require_detection_read(current_user, db)
    try:
        uuid.UUID(detection_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid detection ID format")

    org_id = require_org_id(current_user)
    det = (
        await db.execute(
            select(models.Detection).where(
                models.Detection.id == detection_id,
                models.Detection.organization_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if not det:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")

    connection = (
        await db.execute(
            select(models.SIEMConnection)
            .where(
                models.SIEMConnection.organization_id == org_id,
                func.lower(models.SIEMConnection.siem_type) == (det.siem_type or "").strip().lower(),
            )
            .order_by(models.SIEMConnection.id.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if connection is None:
        return []

    from ..services.siem_adapter import get_siem_adapter
    import asyncio
    import json

    now = datetime.utcnow()
    earliest = now - timedelta(hours=hours)

    try:
        adapter = get_siem_adapter(connection)
        events = await asyncio.to_thread(adapter.search_events, det.siem_query, earliest, now)
    except Exception as exc:
        logger.warning(
            "SIEM alert lookup failed for detection %s on connection %s: %s",
            det.id, connection.id, exc,
        )
        return []

    alerts: List[schemas.DetectionAlert] = []
    for idx, event in enumerate(events[:limit], start=1):
        time_value = (
            event.get("_time")
            or event.get("@timestamp")
            or event.get("TimeGenerated")
        )
        try:
            event_time = datetime.fromisoformat(str(time_value).replace("Z", "+00:00")) if time_value else now
        except ValueError:
            event_time = now

        severity = (
            event.get("severity")
            or event.get("Severity")
            or (event.get("event") or {}).get("severity")
            or (event.get("rule") or {}).get("severity")
            or "info"
        )

        host = (
            event.get("host")
            or event.get("Computer")
            or event.get("dest")
            or event.get("dest_host")
            or (event.get("host") if isinstance(event.get("host"), str) else None)
            or ((event.get("host") or {}).get("name") if isinstance(event.get("host"), dict) else None)
        )

        try:
            raw_event = json.dumps(event, default=str)[:8000]
        except (TypeError, ValueError):
            raw_event = str(event)[:8000]

        alerts.append(
            schemas.DetectionAlert(
                id=idx,
                name=det.title,
                time=event_time,
                severity=str(severity).lower(),
                host=str(host) if host else None,
                query=det.siem_query,
                raw_event=raw_event,
                test_id=None,
            )
        )

    return alerts


@router.patch("/{detection_id}", response_model=schemas.Detection)
async def update_detection(
    detection_id: str,
    detection_update: schemas.DetectionUpdate,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Update a detection (partial update).
    
    RBAC: Requires DETECTIONS_UPDATE permission.
    Only allows updating specific fields like owner, notes, status, etc.
    """
    # SECURITY: Validate detection_id format (UUID)
    import uuid
    try:
        uuid.UUID(detection_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid detection ID format")
    
    # RBAC: Check permission to update detections
    await require_detection_update(current_user, db)
    
    org_id = require_org_id(current_user)
    stmt = (
        select(models.Detection)
        .where(
            models.Detection.id == detection_id,
            models.Detection.organization_id == org_id,
        )
    )
    
    result = await db.execute(stmt)
    det = result.scalar_one_or_none()
    if not det:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")
    
    # SECURITY: Sanitize input fields
    from ..utils.sanitize_inputs import sanitize_model_inputs
    update_dict = detection_update.model_dump(exclude_unset=True)
    sanitized_data = sanitize_model_inputs(update_dict)
    
    # Only allow updating specific fields (whitelist approach for security)
    allowed_fields = {
        "owner",  # Can assign/unassign owner
        "notes",  # Can update review notes
        "status",  # Can update lifecycle status (if user has permission)
        "criticality",  # Can update criticality (if user has permission)
        # Detection-engineering lifecycle stage (identify -> maintain). Safe
        # to update via the same PATCH because DetectionUpdate validates the
        # value against the enum, and DaC-managed rules are protected by the
        # proposal flow rather than this endpoint.
        "lifecycle_stage",
    }
    
    # Filter to only allowed fields that are actually set
    update_data = {k: v for k, v in sanitized_data.items() if k in allowed_fields and v is not None}
    
    # Special handling for owner: allow null to unassign
    if "owner" in update_dict:
        owner_value = update_dict["owner"]
        if owner_value == "" or owner_value is None:
            update_data["owner"] = None
        else:
            # Validate owner is a string (email)
            if not isinstance(owner_value, str):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Owner must be a valid email address"
                )
            update_data["owner"] = owner_value

    if "criticality" in update_data:
        await require_criticality_update(current_user, db)
    
    # Apply updates
    for key, value in update_data.items():
        setattr(det, key, value)
    
    # Update last_updated_at timestamp
    det.last_updated_at = datetime.utcnow()
    
    await db.commit()
    await db.refresh(det)
    
    # Audit log
    try:
        user_id = int(current_user.id)
        user_email = str(current_user.email)
    except Exception:
        user_id = None
        user_email = None
    
    db.add(
        models.AuditEvent(
            user_id=user_id,
            user_email=user_email,
            action="UPDATE_DETECTION",
            resource_type="detection",
            resource_id=det.id,
            details=f"Updated fields: {', '.join(update_data.keys())}",
        )
    )
    await db.commit()
    try:
        await db.refresh(det)
    except Exception:
        pass
    
    return det
