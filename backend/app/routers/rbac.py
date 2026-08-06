"""
RBAC API endpoints for role and permission management.
"""
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import selectinload
from typing_extensions import Annotated

from .. import models, schemas
from ..db import get_db, async_sessionmaker
from ..routers.auth import get_current_user
from ..utils.tenant import require_org_id
from ..utils.authz import require_permission, Permission
from ..services.rbac import RBACService, Role as RoleEnum, Permission as PermissionEnum
from ..security import hash_password, validate_password_complexity, verify_password
from ..utils.rate_limit import check_rate_limit
from ..utils.endpoint_rate_limit import endpoint_rate_limit
from fastapi import Request, Depends
from pydantic import BaseModel

router = APIRouter(
    prefix="/rbac",
    tags=["rbac"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


class AssignRoleRequest(BaseModel):
    role_name: str
    expires_at: Optional[str] = None


@router.get("/me/roles", response_model=List[str])
async def get_my_roles(
    db: DBSession,
    current_user: CurrentUser,
):
    """Get current user's roles in their organization."""
    org_id = require_org_id(current_user)
    rbac = RBACService(db)
    roles = await rbac.get_user_roles(current_user.id, org_id)
    return [role.value for role in roles]


@router.get("/me/permissions", response_model=List[str])
async def get_my_permissions(
    db: DBSession,
    current_user: CurrentUser,
):
    """Get all permissions for the current user."""
    org_id = require_org_id(current_user)
    rbac = RBACService(db)
    roles = await rbac.get_user_roles(current_user.id, org_id)

    # Resolve permissions directly from the role matrix (local Python) instead
    # of round-tripping to the DB once per permission. Previously this was
    # O(roles × permissions) async queries per request.
    all_permissions: set[str] = set()
    for role in roles:
        for perm in PermissionEnum:
            if await rbac._role_has_permission(role, perm, None, None):
                all_permissions.add(perm.value)

    return sorted(all_permissions)


@router.get("/users", response_model=List[dict])
async def list_users(
    db: DBSession,
    current_user: CurrentUser,
    request: Request,
    _rate_limit = Depends(endpoint_rate_limit(max_requests=30, window_seconds=60, key_prefix="rbac:users", per_user=True, per_ip=True)),
):
    # Set user in request.state for rate limiting
    request.state.user = current_user
    """List all users in the organization (admin only)."""
    await require_permission(current_user, Permission.SETTINGS_USERS_MANAGE, db)
    org_id = require_org_id(current_user)
    
    stmt = select(models.User).where(models.User.organization_id == org_id).order_by(models.User.email)
    result = await db.execute(stmt)
    users = result.scalars().all()
    
    return [
        {
            "id": user.id,
            "email": user.email,
            "is_admin": user.is_admin,
            "is_active": user.is_active,
            "is_pending_activation": getattr(user, "is_pending_activation", False),
            "created_at": user.created_at.isoformat() if user.created_at else None,
        }
        for user in users
    ]


@router.get("/roles", response_model=List[dict])
async def list_roles(
    db: DBSession,
    current_user: CurrentUser,
):
    """List all available roles (admin only)."""
    await require_permission(current_user, Permission.SETTINGS_USERS_MANAGE, db)
    
    org_id = require_org_id(current_user)
    stmt = (
        select(models.Role)
        .where(or_(models.Role.organization_id == org_id, models.Role.organization_id.is_(None)))
        .order_by(models.Role.name)
    )
    result = await db.execute(stmt)
    roles = result.scalars().all()
    
    return [
        {
            "id": role.id,
            "name": role.name,
            "description": role.description,
            "is_system": role.is_system,
        }
        for role in roles
    ]


@router.get("/users/{user_id}/roles", response_model=List[dict])
async def get_user_roles(
    user_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    """Get roles for a specific user (admin only)."""
    # SECURITY: Validate user_id is positive
    if user_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID")
    
    await require_permission(current_user, Permission.SETTINGS_USERS_MANAGE, db)
    org_id = require_org_id(current_user)
    
    # Verify user belongs to same org
    user = await db.get(models.User, user_id)
    if not user or user.organization_id != org_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Join with Role to get role name (left join in case role is missing)
    stmt = (
        select(models.UserRole, models.Role)
        .outerjoin(models.Role, models.UserRole.role_id == models.Role.id)
        .where(
            models.UserRole.user_id == user_id,
            models.UserRole.organization_id == org_id,
        )
    )
    result = await db.execute(stmt)
    rows = result.all()
    
    # Build response using joined data (don't access relationship)
    response = []
    for ur, role in rows:
        response.append({
            "id": ur.id,
            "role_id": ur.role_id,
            "role_name": role.name if role else None,  # Use joined role, not ur.role
            "assigned_at": ur.assigned_at.isoformat() if ur.assigned_at else None,
            "expires_at": ur.expires_at.isoformat() if ur.expires_at else None,
        })
    
    return response


@router.post("/users/{user_id}/roles", response_model=dict)
async def assign_role(
    user_id: int,
    payload: AssignRoleRequest,
    db: DBSession,
    current_user: CurrentUser,
):
    """Assign a role to a user (admin only)."""
    # SECURITY: Validate user_id is positive
    if user_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID")
    
    await require_permission(current_user, Permission.SETTINGS_USERS_MANAGE, db)
    org_id = require_org_id(current_user)
    
    # Verify user belongs to same org
    user = await db.get(models.User, user_id)
    if not user or user.organization_id != org_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    role_name = payload.role_name
    expires_at = payload.expires_at
    
    # Get role
    stmt = select(models.Role).where(
        models.Role.name == role_name.upper(),
        or_(models.Role.organization_id == org_id, models.Role.organization_id.is_(None)),
    )
    result = await db.execute(stmt)
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    # Check if user already has this role
    existing = await db.execute(
        select(models.UserRole).where(
            models.UserRole.user_id == user_id,
            models.UserRole.role_id == role.id,
            models.UserRole.organization_id == org_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User already has this role")
    
    role_name_value = role.name

    # Create user role
    user_role = models.UserRole(
        user_id=user_id,
        role_id=role.id,
        organization_id=org_id,
        assigned_by=current_user.id,
        expires_at=datetime.fromisoformat(expires_at) if expires_at else None,
    )
    db.add(user_role)
    await db.flush()
    user_role_id = user_role.id
    assigned_at = user_role.assigned_at
    await db.commit()

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=current_user.id,
                user_email=current_user.email,
                action="ROLE_ASSIGNED",
                resource_type="user",
                resource_id=str(user.id),
                details=f"Assigned role {role_name_value} to {user.email}",
            )
        )
        await session.commit()

    return {
        "id": user_role_id,
        "user_id": user_role.user_id,
        "role_name": role_name_value,
        "assigned_at": assigned_at.isoformat() if assigned_at else None,
    }


@router.delete("/users/{user_id}/roles/{role_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_role(
    user_id: int,
    role_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    """Remove a role from a user (admin only)."""
    # SECURITY: Validate IDs are positive
    if user_id <= 0 or role_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user or role ID")
    
    await require_permission(current_user, Permission.SETTINGS_USERS_MANAGE, db)
    org_id = require_org_id(current_user)
    
    # Verify user belongs to same org
    user = await db.get(models.User, user_id)
    if not user or user.organization_id != org_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get user role with role joined to avoid lazy loading
    stmt = (
        select(models.UserRole, models.Role)
        .join(models.Role, models.UserRole.role_id == models.Role.id)
        .where(
            models.UserRole.id == role_id,
            models.UserRole.user_id == user_id,
            models.UserRole.organization_id == org_id,
        )
    )
    result = await db.execute(stmt)
    row = result.first()
    
    if not row:
        raise HTTPException(status_code=404, detail="User role not found")
    
    user_role, role = row
    
    # Don't allow removing system roles from admins (safety check)
    if role and role.is_system and role.name == RoleEnum.ADMINISTRATOR.value:
        if user.is_admin:
            raise HTTPException(
                status_code=400,
                detail="Cannot remove ADMINISTRATOR role from admin user"
            )
    
    await db.execute(
        delete(models.UserRole).where(
            models.UserRole.id == user_role.id,
            models.UserRole.user_id == user_id,
            models.UserRole.organization_id == org_id,
        )
    )
    await db.commit()

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=current_user.id,
                user_email=current_user.email,
                action="ROLE_REMOVED",
                resource_type="user",
                resource_id=str(user.id),
                details=f"Removed role {role.name} from {user.email}",
            )
        )
        await session.commit()

    return None


class SetPasswordRequest(BaseModel):
    current_password: str
    password: str


@router.post("/users/{user_id}/password", response_model=dict)
async def set_user_password(
    user_id: int,
    password_request: SetPasswordRequest,
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
):
    """Set or reset a user's password (admin only)."""
    # SECURITY: Validate user_id is positive
    if user_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID")
    
    # SECURITY: Sanitize password input (though password validation will catch most issues)
    from ..utils.security import sanitize_string
    current_password = sanitize_string(password_request.current_password, max_length=128)
    if not current_password:
        raise HTTPException(status_code=400, detail="Current password is required")

    password = sanitize_string(password_request.password, max_length=128)
    if not password:
        raise HTTPException(status_code=400, detail="Password cannot be empty")
    
    await require_permission(current_user, Permission.SETTINGS_USERS_MANAGE, db)
    org_id = require_org_id(current_user)

    if not current_user.hashed_password or not verify_password(current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    # Rate limiting: Prevent abuse of password reset
    # SECURITY: Use IP + user_id + admin_id to prevent enumeration and ensure per-admin limits
    client_ip = request.client.host if request.client else "unknown"
    # Include both target user_id and admin user_id to prevent bypass via predictable user IDs
    rate_key = f"password_reset:{client_ip}:{current_user.id}:{user_id}"
    allowed, remaining = check_rate_limit(rate_key, max_requests=10, window_seconds=3600)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password reset attempts. Please wait and try again."
        )
    
    # Verify user belongs to same org
    user = await db.get(models.User, user_id)
    if not user or user.organization_id != org_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Validate password complexity
    is_valid, error_msg = validate_password_complexity(password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)
    
    # SECURITY: Prevent re-use of recent passwords by checking against
    # the current hash and a limited password history.
    from ..config import settings as app_settings

    # Check against current password
    try:
        if user.hashed_password and verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=400,
                detail="New password cannot be the same as the current password",
            )
    except Exception:
        # If verification fails for any reason, continue to history checks
        pass

    # Load password history for this user (most recent first)
    history_length = getattr(app_settings, "PASSWORD_HISTORY_LENGTH", 5)
    if history_length and history_length > 0:
        from sqlalchemy import select, desc

        history_stmt = (
            select(models.PasswordHistory)
            .where(models.PasswordHistory.user_id == user.id)
            .order_by(desc(models.PasswordHistory.created_at))
            .limit(history_length)
        )
        history_result = await db.execute(history_stmt)
        previous_passwords = history_result.scalars().all()

        for entry in previous_passwords:
            try:
                if verify_password(password, entry.hashed_password):
                    raise HTTPException(
                        status_code=400,
                        detail="New password cannot match any of your recent passwords",
                    )
            except Exception:
                continue

    # Set new password and store in history
    new_hash = hash_password(password)
    user.hashed_password = new_hash
    # SECURITY: revoke any session issued before this reset — see
    # token_valid_after on the User model / auth.get_current_user.
    user.token_valid_after = datetime.now(timezone.utc)
    db.add(
        models.PasswordHistory(
            user_id=user.id,
            hashed_password=new_hash,
        )
    )
    await db.commit()
    
    # Audit the password change
    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=current_user.id,
                user_email=current_user.email,
                action="SET_USER_PASSWORD",
                resource_type="user",
                resource_id=str(user_id),
                details=f"Password reset for user {user.email}",
            )
        )
        await session.commit()
    
    return {"message": "Password updated successfully"}


class InviteUserRequest(BaseModel):
    email: str
    username: Optional[str] = None


@router.post("/users/invite", response_model=dict)
async def invite_user(
    payload: InviteUserRequest,
    request: Request,
    db: DBSession,
    current_user: CurrentUser,
):
    """Invite a new user by email (admin only).

    Creates the account in a pending state with no usable password and
    emails an activation link. The user sets their own password via
    POST /auth/invite/accept, replacing the old flow where an admin chose
    and had to relay a plaintext password out-of-band.
    """
    await require_permission(current_user, Permission.SETTINGS_USERS_MANAGE, db)
    org_id = require_org_id(current_user)

    client_ip = request.client.host if request.client else "unknown"
    allowed, _ = check_rate_limit(
        f"invite_user:{client_ip}:{current_user.id}", max_requests=20, window_seconds=3600
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many invites sent. Please wait and try again.",
        )

    from ..utils.security import sanitize_email

    email = sanitize_email(payload.email)
    if not email:
        raise HTTPException(status_code=400, detail="A valid email is required")

    existing = await db.execute(select(models.User).where(models.User.email == email))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="A user with this email already exists")

    from ..utils.license import get_org_license_status

    org_license = await get_org_license_status(db, org_id)
    seat_limit = org_license.seat_limit
    if seat_limit is not None:
        seat_count_result = await db.execute(
            select(func.count(models.User.id)).where(models.User.organization_id == org_id)
        )
        current_seats = seat_count_result.scalar_one()
        if current_seats >= seat_limit:
            # SECURITY/UX: a paid org can still have a finite seat_limit --
            # it's whatever the license was issued for, not "unlimited by
            # definition of being paid." Telling a paying customer "Free
            # plan is limited..." is both wrong and points them at the
            # pricing page they've already been through; point them at
            # their own account owner instead, who can request more seats.
            if org_license.plan == "paid":
                detail = (
                    f"Your license is limited to {seat_limit} users. "
                    "Contact your PurveX account owner to add more seats."
                )
            else:
                detail = (
                    f"Free plan is limited to {seat_limit} users. "
                    "Upgrade at purvex-llc.com/pricing to invite more."
                )
            raise HTTPException(status_code=402, detail=detail)

    username = (payload.username or email.split("@")[0]).strip() or None

    import secrets as _secrets

    # Unusable placeholder — the invited user must complete
    # POST /auth/invite/accept to set a real password. is_pending_activation
    # additionally blocks login outright until that happens.
    user = models.User(
        username=username,
        email=email,
        hashed_password=hash_password(_secrets.token_urlsafe(32)),
        is_admin=False,
        is_active=True,
        is_pending_activation=True,
        organization_id=org_id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    from ..security import create_access_token, decode_access_token

    invite_token = create_access_token(
        data={"sub": user.email, "uid": user.id, "purpose": "user_invite"},
        expires_minutes=60 * 24 * 7,  # 7 days
    )
    claims = decode_access_token(invite_token)
    if claims and claims.get("jti") and claims.get("exp"):
        db.add(
            models.UserInviteToken(
                user_id=user.id,
                invited_by_user_id=current_user.id,
                jti=str(claims["jti"]),
                expires_at=datetime.fromtimestamp(float(claims["exp"]), tz=timezone.utc),
            )
        )
        await db.commit()

    from ..config import settings as app_settings
    from ..utils.email import send_invite_email

    invite_link = f"{app_settings.APP_BASE_URL.rstrip('/')}/accept-invite?token={invite_token}"
    sent = await send_invite_email(user.email, invite_link, inviter_name=current_user.username or current_user.email)
    if not sent:
        import logging

        logging.getLogger("purvex.api").warning(
            "Invite created for %s — email not sent, link: %s", user.email, invite_link
        )

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=current_user.id,
                user_email=current_user.email,
                action="USER_INVITED",
                resource_type="user",
                resource_id=str(user.id),
                details=f"Invited {user.email}",
            )
        )
        await session.commit()

    return {"message": "Invite sent", "user_id": user.id, "email": user.email}


class SetUserStatusRequest(BaseModel):
    is_active: bool


@router.patch("/users/{user_id}/status", response_model=dict)
async def set_user_status(
    user_id: int,
    payload: SetUserStatusRequest,
    db: DBSession,
    current_user: CurrentUser,
):
    """Deactivate or reactivate a user (admin only). Deactivating blocks
    login immediately and also kills any already-issued session on the
    next request (see is_active check in auth.get_current_user)."""
    await require_permission(current_user, Permission.SETTINGS_USERS_MANAGE, db)
    org_id = require_org_id(current_user)

    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    user = await db.get(models.User, user_id)
    if not user or user.organization_id != org_id:
        raise HTTPException(status_code=404, detail="User not found")

    user.is_active = payload.is_active
    await db.commit()

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=current_user.id,
                user_email=current_user.email,
                action="USER_ACTIVATED" if payload.is_active else "USER_DEACTIVATED",
                resource_type="user",
                resource_id=str(user.id),
                details=f"{'Reactivated' if payload.is_active else 'Deactivated'} {user.email}",
            )
        )
        await session.commit()

    return {"message": "User reactivated" if payload.is_active else "User deactivated"}
