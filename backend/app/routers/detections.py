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

        # If no detections, return empty list (valid state)
        if not detections:
            return []

        # For each detection, get the latest test result
        detections_with_last_test = []
        for detection in detections:
            try:
                # Get all tests for this detection and find the latest one in Python
                # This is simpler and more reliable than complex SQL
                try:
                    tests_result = await db.execute(
                        select(models.Test)
                        .filter(models.Test.detection_id == detection.id)
                    )
                    all_tests = tests_result.scalars().all()
                except Exception as test_error:
                    logger.warning(f"Error fetching tests for detection {detection.id}: {test_error}")
                    all_tests = []
                
                # Find the latest test (prefer finished_at, fallback to started_at)
                latest_test = None
                if all_tests:
                    try:
                        # Sort by finished_at DESC, then started_at DESC, handling None values
                        latest_test = max(
                            all_tests,
                            key=lambda t: (
                                t.finished_at if t.finished_at else (datetime(1970, 1, 1)),
                                t.started_at if t.started_at else (datetime(1970, 1, 1))
                            )
                        )
                    except Exception as max_error:
                        logger.warning(f"Error finding latest test for detection {detection.id}: {max_error}")
                        latest_test = None
                
                # Validate and build response
                try:
                    detection_data = schemas.Detection.model_validate(detection)
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
                    # Skip invalid detections but continue processing others
                    continue
                    
            except Exception as e:
                logger.error(f"Error processing detection {detection.id}: {e}", exc_info=True)
                # Try to include the detection even if test lookup fails
                try:
                    detection_data = schemas.Detection.model_validate(detection)
                    detection_data.last_result = None
                    detection_data.last_score = None
                    detection_data.last_tested_at = None
                    detections_with_last_test.append(detection_data)
                except Exception as e2:
                    logger.error(f"Error validating detection {detection.id}: {e2}", exc_info=True)
                    # Skip this detection if we can't even validate it
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


@router.get("/{detection_id}/alerts", response_model=List[schemas.DetectionAlert])
async def get_detection_alerts(
    detection_id: str,
    db: DBSession,
    current_user: CurrentUser,
):
    # SECURITY: Validate detection_id format (UUID)
    import uuid
    try:
        uuid.UUID(detection_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid detection ID format")
    
    """Return recent SIEM alerts for a given detection (stubbed for MVP).

    For now this does NOT call a real Splunk API – it just returns a few
    synthetic alerts that are shaped like what the UI expects. This lets us
    design the workflow and detail views before wiring real credentials.
    """
    org_id = require_org_id(current_user)
    stmt = select(models.Detection).where(
        models.Detection.id == detection_id,
        models.Detection.organization_id == org_id,
    )

    result = await db.execute(stmt)
    det = result.scalar_one_or_none()
    if not det:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")

    now = datetime.utcnow()
    alerts: List[schemas.DetectionAlert] = [
        schemas.DetectionAlert(
            id=1,
            name=f"{det.title} – sample alert 1",
            time=now - timedelta(minutes=5),
            severity="medium",
            host="lab-endpoint-1",
            query=det.siem_query,
            raw_event=f'Stub Splunk event for detection {det.id} at {now.isoformat()} (PurveX demo)',
            test_id=1,
        ),
        schemas.DetectionAlert(
            id=2,
            name=f"{det.title} – sample alert 2",
            time=now - timedelta(minutes=20),
            severity="high",
            host="lab-endpoint-2",
            query=det.siem_query,
            raw_event=f'Stub Splunk event (high severity) for detection {det.id}',
            test_id=2,
        ),
    ]

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
