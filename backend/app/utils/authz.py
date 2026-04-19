"""
Authorization utilities for RBAC and permission checking.
"""
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .. import models
from ..services.rbac import RBACService, Permission as PermissionEnum
from ..utils.csrf import require_csrf_token, get_csrf_token_from_request
from fastapi import Request

# Re-export Permission for convenience
Permission = PermissionEnum


async def require_permission(
    user: models.User,
    permission: PermissionEnum,
    db: AsyncSession,
    request: Request | None = None,
):
    """
    Check if a user has a specific permission.
    
    Admin users automatically have all permissions and bypass permission checks.
    
    Also validates CSRF token for state-changing operations if request is provided.
    
    Raises:
        HTTPException(403) if user doesn't have permission
        HTTPException(403) if CSRF token is invalid
    """
    # SECURITY: Admin users bypass all permission checks
    if user.is_admin:
        # Still validate CSRF for state-changing operations
        if request and request.method in ["POST", "PUT", "DELETE", "PATCH"] and request.cookies.get("access_token"):
            try:
                require_csrf_token(request, user.id)
            except HTTPException as e:
                import logging
                logger = logging.getLogger("purvex.api.csrf")
                logger.warning(f"CSRF token validation failed for admin user {user.id}: {e.detail}")
                raise
            except Exception:
                pass
        return  # Admin users have all permissions
    
    # CSRF protection for state-changing operations (optional for now, can be made mandatory later)
    # Only enforce CSRF for cookie-authenticated browser sessions.
    if request and request.method in ["POST", "PUT", "DELETE", "PATCH"] and request.cookies.get("access_token"):
        try:
            require_csrf_token(request, user.id)
        except HTTPException as e:
            # SECURITY: Enforce CSRF protection - fail the request if token is invalid
            import logging
            logger = logging.getLogger("purvex.api.csrf")
            logger.warning(f"CSRF token validation failed for user {user.id}: {e.detail}")
            # Enforce CSRF protection - raise the exception
            raise
        except Exception:
            # If CSRF token is missing, log but allow (graceful degradation)
            pass
    
    rbac = RBACService(db)
    org_id = getattr(user, "organization_id", None)
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User organization not set"
        )
    
    has_perm = await rbac.has_permission(user, permission)
    if not has_perm:
        # SECURITY: Log permission denial to audit log
        try:
            from ..db import async_sessionmaker
            async with async_sessionmaker() as session:
                session.add(
                    models.AuditEvent(
                        user_id=user.id if hasattr(user, 'id') else None,
                        user_email=user.email if hasattr(user, 'email') else None,
                        action="PERMISSION_DENIED",
                        resource_type="permission",
                        resource_id=permission.value,
                        details=f"User {user.email if hasattr(user, 'email') else 'unknown'} denied permission {permission.value}",
                    )
                )
                await session.commit()
        except Exception as e:
            # Don't fail the request if audit logging fails
            import logging
            logger = logging.getLogger("purvex.api.authz")
            logger.warning(f"Failed to log permission denial: {e}")
        
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Permission required: {permission.value}"
        )


def require_admin(user: models.User):
    """Check if user is an admin."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required"
        )


async def require_schedule(
    user: models.User,
    db: AsyncSession,
    environment: str,
    request: Request | None = None,
):
    """
    Check scheduling permission for an environment.

    PROD scheduling requires the dedicated PROD permission. Other environments
    use the general scheduling permission.
    """
    env = (environment or "").lower()
    if env == "prod":
        perm = Permission.TESTS_SCHEDULE_PROD
    elif env in {"lab", "dev"}:
        perm = Permission.TESTS_SCHEDULE
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown environment for scheduling: {environment!r}",
        )

    await require_permission(user, perm, db, request)


# Convenience functions for detection-related permissions
async def require_detection_create(
    user: models.User,
    db: AsyncSession,
    request: Request | None = None,
):
    """Check if user has permission to create detections."""
    await require_permission(user, Permission.DETECTIONS_CREATE, db, request)


async def require_detection_update(
    user: models.User,
    db: AsyncSession,
    request: Request | None = None,
):
    """Check if user has permission to update detections."""
    await require_permission(user, Permission.DETECTIONS_UPDATE, db, request)


async def require_detection_delete(
    user: models.User,
    db: AsyncSession,
    request: Request | None = None,
):
    """Check if user has permission to delete detections."""
    await require_permission(user, Permission.DETECTIONS_DELETE, db, request)


async def require_criticality_update(
    user: models.User,
    db: AsyncSession,
    request: Request | None = None,
):
    """Check if user has permission to update detection criticality."""
    await require_permission(user, Permission.DETECTIONS_CRITICALITY_UPDATE, db, request)


async def require_test_run(
    user: models.User,
    db: AsyncSession,
    environment: str,
    request: Request | None = None,
):
    """
    Check if a user has permission to run a test in the given environment.

    Maps environment -> specific TESTS_RUN_* permission:
      - "lab"  -> TESTS_RUN_LAB
      - "dev"  -> TESTS_RUN_DEV
      - "prod" -> TESTS_RUN_PROD
    """
    env = (environment or "").lower()

    if env == "lab":
        perm = Permission.TESTS_RUN_LAB
    elif env == "dev":
        perm = Permission.TESTS_RUN_DEV
    elif env == "prod":
        perm = Permission.TESTS_RUN_PROD
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown environment for test run: {environment!r}",
        )

    await require_permission(user, perm, db, request)
