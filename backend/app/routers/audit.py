from typing import List, Annotated, Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import and_, or_

from ..db import get_db
from .. import models, schemas
from ..routers.auth import get_current_user
from ..utils.tenant import require_org_id
from ..config import settings
from ..services.audit_retention import cleanup_audit_events

router = APIRouter(
    prefix="/audit",
    tags=["audit"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


@router.get("/events", response_model=List[schemas.AuditEvent])
async def list_audit_events(
    db: DBSession,
    current_user: CurrentUser,
    skip: int = Query(0, ge=0, le=10000),
    limit: int = Query(100, ge=1, le=500),
    action: Optional[str] = Query(None, description="Filter by action type"),
    resource_type: Optional[str] = Query(None, description="Filter by resource type"),
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    start_date: Optional[datetime] = Query(None, description="Start date (ISO format)"),
    end_date: Optional[datetime] = Query(None, description="End date (ISO format)"),
    search: Optional[str] = Query(None, description="Search in details field"),
):
    """
    Return audit events with filtering options (admin-only).
    
    The audit log tracks:
    - Authentication: LOGIN_SUCCESS, LOGIN_FAILED
    - Detections: CREATE_DETECTION, UPDATE_DETECTION, DELETE_DETECTION
    - Tests: RUN_TEST, SCHEDULE_TEST
    - Settings: UPDATE_SETTINGS_ORGANIZATION, CREATE_SIEM_CONNECTION, etc.
    - RBAC: SET_USER_PASSWORD, ASSIGN_ROLE, REMOVE_ROLE
    - Sandbox: PROVISION_SANDBOX, RESET_SANDBOX
    """
    # RBAC: Require admin permission
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can view audit events",
        )
    
    # Build query with filters
    query = select(models.AuditEvent)
    
    # Apply filters
    filters = []
    
    if action:
        filters.append(models.AuditEvent.action.ilike(f"%{action}%"))
    
    if resource_type:
        filters.append(models.AuditEvent.resource_type == resource_type)
    
    if user_id:
        filters.append(models.AuditEvent.user_id == user_id)
    
    if start_date:
        filters.append(models.AuditEvent.created_at >= start_date)
    
    if end_date:
        filters.append(models.AuditEvent.created_at <= end_date)
    
    if search:
        filters.append(models.AuditEvent.details.ilike(f"%{search}%"))
    
    if filters:
        query = query.where(and_(*filters))
    
    # Order by most recent first
    query = query.order_by(models.AuditEvent.created_at.desc())
    
    # Apply pagination
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/events/stats", response_model=dict)
async def get_audit_stats(
    db: DBSession,
    current_user: CurrentUser,
    days: int = Query(7, ge=1, le=365, description="Number of days to analyze"),
):
    """Get audit event statistics (admin-only)."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can view audit statistics",
        )
    
    from datetime import timedelta
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
    # Get total events
    total_result = await db.execute(
        select(models.AuditEvent)
        .where(models.AuditEvent.created_at >= cutoff_date)
    )
    total_events = len(total_result.scalars().all())
    
    # Get events by action type
    actions_result = await db.execute(
        select(
            models.AuditEvent.action,
            models.AuditEvent.created_at
        )
        .where(models.AuditEvent.created_at >= cutoff_date)
    )
    actions = {}
    for row in actions_result.all():
        action = row[0]
        actions[action] = actions.get(action, 0) + 1
    
    # Get events by resource type
    resources_result = await db.execute(
        select(
            models.AuditEvent.resource_type,
            models.AuditEvent.created_at
        )
        .where(models.AuditEvent.created_at >= cutoff_date)
    )
    resources = {}
    for row in resources_result.all():
        resource_type = row[0] or "unknown"
        resources[resource_type] = resources.get(resource_type, 0) + 1
    
    # Get top users
    users_result = await db.execute(
        select(
            models.AuditEvent.user_email,
            models.AuditEvent.created_at
        )
        .where(models.AuditEvent.created_at >= cutoff_date)
    )
    users = {}
    for row in users_result.all():
        user_email = row[0] or "unknown"
        users[user_email] = users.get(user_email, 0) + 1
    
    return {
        "total_events": total_events,
        "period_days": days,
        "events_by_action": dict(sorted(actions.items(), key=lambda x: x[1], reverse=True)[:10]),
        "events_by_resource": dict(sorted(resources.items(), key=lambda x: x[1], reverse=True)[:10]),
        "top_users": dict(sorted(users.items(), key=lambda x: x[1], reverse=True)[:10]),
    }


@router.post("/cleanup", response_model=dict)
async def cleanup_audit_events_endpoint(
    db: DBSession,
    current_user: CurrentUser,
    days: int = Query(settings.AUDIT_RETENTION_DAYS, ge=1, le=3650),
):
    """Manually purge audit events older than the retention window (admin-only)."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can clean audit events",
        )

    deleted = await cleanup_audit_events(db, retention_days=days, actor=current_user)
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    return {"deleted": deleted, "retention_days": days, "cutoff": cutoff}


