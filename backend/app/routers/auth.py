from typing import Annotated
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, or_, select

from ..db import get_db, async_sessionmaker
from .. import models, schemas
from ..security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    validate_password_complexity,
)
from ..utils.rate_limit import check_rate_limit
from ..config import settings as app_settings

router = APIRouter(prefix="/auth", tags=["auth"])

DBSession = Annotated[AsyncSession, Depends(get_db)]

async def get_user_by_email(db: AsyncSession, email: str) -> models.User | None:
    # Accept either email or username as the login identifier.
    result = await db.execute(
        select(models.User).where(
            (models.User.email == email) | (models.User.username == email)
        )
    )
    return result.scalars().first()


async def _get_or_create_org(db: AsyncSession) -> models.Organization:
    result = await db.execute(select(models.Organization))
    org = result.scalars().first()
    if org:
        return org
    org = models.Organization(
        name=app_settings.ORGANIZATION_NAME,
        primary_contact_email=app_settings.PRIMARY_CONTACT_EMAIL,
        timezone=app_settings.DEFAULT_TIMEZONE,
        locale=app_settings.DEFAULT_LOCALE,
        default_environment_names=app_settings.DEFAULT_ENVIRONMENT_NAMES,
        compliance_mode_flags=app_settings.COMPLIANCE_MODE_FLAGS,
    )
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


async def _ensure_admin_role(db: AsyncSession, user: models.User, org_id: int) -> None:
    try:
        from ..services.rbac import Role as RoleEnum
    except Exception:
        return
    role_result = await db.execute(
        select(models.Role).where(
            models.Role.name == RoleEnum.ADMINISTRATOR.value,
            or_(models.Role.organization_id == org_id, models.Role.organization_id.is_(None)),
        )
    )
    admin_role = role_result.scalar_one_or_none()
    if not admin_role:
        return
    existing_role = await db.execute(
        select(models.UserRole).where(
            models.UserRole.user_id == user.id,
            models.UserRole.role_id == admin_role.id,
            models.UserRole.organization_id == org_id,
        )
    )
    if existing_role.scalar_one_or_none():
        return
    db.add(
        models.UserRole(
            user_id=user.id,
            role_id=admin_role.id,
            organization_id=org_id,
        )
    )
    await db.commit()


async def get_current_user(
    request: Request,
    db: DBSession,
) -> models.User:
    # Prefer httpOnly cookie for auth; fall back to Authorization header for
    # tooling / Swagger compatibility.
    token: str | None = request.cookies.get("access_token")

    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip() or None

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    # SECURITY: single-purpose tokens (password-reset, invite) are minted
    # with the same signing key/algorithm as a real session so they must
    # never be usable as a general Bearer credential. Each of those tokens
    # is validated and consumed directly by its own endpoint
    # (password_reset.confirm_password_reset, auth.accept_invite) via
    # decode_access_token — neither depends on get_current_user — so
    # rejecting any such claim here is safe and closes the bypass without
    # affecting those flows.
    if payload.get("purpose"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    # Check if token has been revoked (logout)
    from ..utils.token_blacklist import is_blacklisted
    jti = payload.get("jti")
    if jti and is_blacklisted(jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    email: str | None = payload.get("sub")
    if email is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    user = await get_user_by_email(db, email=email)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    # SECURITY: reject tokens issued before the user's last password change.
    # JWTs are otherwise stateless, so without this a password reset (e.g.
    # in response to a suspected compromise) wouldn't invalidate whatever
    # session the attacker already had. See set_user_password and
    # confirm_password_reset, which set token_valid_after.
    token_valid_after = getattr(user, "token_valid_after", None)
    if token_valid_after is not None:
        issued_at = payload.get("iat")
        if issued_at is not None:
            if token_valid_after.tzinfo is None:
                token_valid_after = token_valid_after.replace(tzinfo=timezone.utc)
            # `iat` is second-resolution (JWT/PyJWT truncate to whole
            # seconds); token_valid_after has sub-second precision. Floor it
            # before comparing so a token minted in the *same* second as the
            # password change isn't wrongly rejected — the reset always
            # completes before a subsequent login can be attempted, so same-
            # second here means "at or after", not "before".
            if int(issued_at) < int(token_valid_after.timestamp()):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session has been revoked. Please log in again.",
                )

    # Re-checked on every request (not just at login) so a deactivation
    # takes effect immediately instead of waiting for the session to expire.
    if not getattr(user, "is_active", True):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This account has been deactivated",
        )

    if user.organization_id is None:
        org_result = await db.execute(select(models.Organization))
        org = org_result.scalars().first()
        if not org:
            org = models.Organization(
                name=app_settings.ORGANIZATION_NAME,
                primary_contact_email=app_settings.PRIMARY_CONTACT_EMAIL,
                timezone=app_settings.DEFAULT_TIMEZONE,
                locale=app_settings.DEFAULT_LOCALE,
                default_environment_names=app_settings.DEFAULT_ENVIRONMENT_NAMES,
                compliance_mode_flags=app_settings.COMPLIANCE_MODE_FLAGS,
            )
            db.add(org)
            await db.flush()

        user.organization_id = org.id
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return user


CurrentUser = Annotated[models.User, Depends(get_current_user)]


@router.get("/bootstrap/status", response_model=schemas.BootstrapStatus)
async def bootstrap_status(request: Request, db: DBSession):
    client_ip = request.client.host if request.client else "unknown"
    allowed, _ = check_rate_limit(f"bootstrap_status:{client_ip}", max_requests=10, window_seconds=60)
    if not allowed:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many requests")
    result = await db.execute(select(models.User).where(models.User.is_admin == True))
    admin = result.scalars().first()
    return {"needs_admin": admin is None}


@router.post("/bootstrap", response_model=schemas.UserRead)
async def bootstrap_admin(user_in: schemas.BootstrapAdminCreate, request: Request, db: DBSession):
    client_ip = request.client.host if request.client else "unknown"
    allowed, _ = check_rate_limit(f"bootstrap:{client_ip}", max_requests=3, window_seconds=3600)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many bootstrap attempts. Please try again later.",
        )
    result = await db.execute(select(models.User).where(models.User.is_admin == True))
    admin = result.scalars().first()
    if admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An admin user already exists.",
        )

    is_valid, error_msg = validate_password_complexity(user_in.password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    org = await _get_or_create_org(db)
    email = user_in.email or user_in.username
    user = models.User(
        username=user_in.username,
        email=email,
        hashed_password=hash_password(user_in.password),
        is_admin=True,
        is_active=True,
        organization_id=org.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await _ensure_admin_role(db, user, org.id)
    return user

@router.post("/register", response_model=schemas.UserRead)
async def register_admin(
    user_in: schemas.UserCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Create a new user. Requires admin authentication.
    For initial setup, use POST /auth/bootstrap instead.
    """
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can create new users",
        )

    # Rate limit registration attempts
    rate_key = f"register:{user_in.email}"
    allowed, remaining = check_rate_limit(rate_key, max_requests=3, window_seconds=3600)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many registration attempts. Please try again later."
        )
    
    # Validate password complexity
    is_valid, error_msg = validate_password_complexity(user_in.password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)
    
    existing = await get_user_by_email(db, user_in.email)
    if existing:
        raise HTTPException(status_code=400, detail="Unable to create user with the provided details")

    # SECURITY: this endpoint creates a user directly (no invite, no seat
    # check) and predates rbac.invite_user, which is what the UI actually
    # calls and does enforce seat_limit. Without this, it's a straight
    # bypass of the free-tier seat cap for anyone who calls it directly.
    from ..utils.license import get_org_license_status
    from ..utils.tenant import require_org_id

    org_id_for_seat_check = require_org_id(current_user)
    seat_limit = (await get_org_license_status(db, org_id_for_seat_check)).seat_limit
    if seat_limit is not None:
        seat_count_result = await db.execute(
            select(func.count(models.User.id)).where(
                models.User.organization_id == org_id_for_seat_check
            )
        )
        current_seats = seat_count_result.scalar_one()
        if current_seats >= seat_limit:
            raise HTTPException(
                status_code=402,
                detail=(
                    f"Free plan is limited to {seat_limit} users. "
                    "Upgrade at purvex-llc.com/pricing to add more."
                ),
            )

    # Ensure an organization exists for this user.
    org_result = await db.execute(select(models.Organization))
    org = org_result.scalars().first()
    if not org:
        org = models.Organization(
            name=app_settings.ORGANIZATION_NAME,
            primary_contact_email=app_settings.PRIMARY_CONTACT_EMAIL,
            timezone=app_settings.DEFAULT_TIMEZONE,
            locale=app_settings.DEFAULT_LOCALE,
            default_environment_names=app_settings.DEFAULT_ENVIRONMENT_NAMES,
            compliance_mode_flags=app_settings.COMPLIANCE_MODE_FLAGS,
        )
        db.add(org)
        await db.commit()
        await db.refresh(org)

    # SECURITY: Do not allow creating admin users via this endpoint.
    # Admin users should only be created by existing admins.
    username = user_in.username or user_in.email.split("@")[0]
    user = models.User(
        username=username,
        email=user_in.email,
        hashed_password=hash_password(user_in.password),
        is_admin=False,  # Changed: Do not allow admin creation via registration
        is_active=True,
        organization_id=org.id,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Seed password history with the initial password hash to prevent the user
    # from reusing it on future password changes.
    try:
        from ..config import settings as app_settings
        history_length = getattr(app_settings, "PASSWORD_HISTORY_LENGTH", 5)
        if history_length and history_length > 0:
            db.add(
                models.PasswordHistory(
                    user_id=user.id,
                    hashed_password=user.hashed_password,
                )
            )
            await db.commit()
    except Exception:
        # Registration should not fail solely due to history bookkeeping.
        pass
    return user

@router.post("/login", response_model=schemas.LoginResponse)
async def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    response: Response,
    request: Request,
    db: DBSession,
):
    # Rate limiting: Prevent brute force attacks
    # Use IP address + username as key
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"login:{client_ip}:{form_data.username}"

    # Load configurable policy knobs for login rate limiting.
    from ..config import settings as app_settings
    max_requests = getattr(app_settings, "LOGIN_RATE_LIMIT_MAX_REQUESTS", 5)
    window_seconds = getattr(app_settings, "LOGIN_RATE_LIMIT_WINDOW_SECONDS", 300)

    allowed, remaining = check_rate_limit(
        rate_key,
        max_requests=max_requests,
        window_seconds=window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Please wait 5 minutes and try again."
        )
    
    user = await get_user_by_email(db, form_data.username)
    if not user:
        # SECURITY: must match the wrong-password/locked-account message
        # below verbatim — a nonexistent account is otherwise trivially
        # distinguishable from a wrong password by text alone.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    # SECURITY: Check if account is locked.
    # Handle case where columns might not exist yet (defensive coding).
    from datetime import datetime, timezone
    locked_until_raw = getattr(user, "locked_until", None)
    locked_until = None

    if locked_until_raw:
        try:
            # Normalize to an aware UTC datetime for safe comparison.
            if isinstance(locked_until_raw, datetime):
                if locked_until_raw.tzinfo is None or locked_until_raw.tzinfo.utcoffset(locked_until_raw) is None:
                    locked_until = locked_until_raw.replace(tzinfo=timezone.utc)
                else:
                    locked_until = locked_until_raw.astimezone(timezone.utc)
            elif isinstance(locked_until_raw, str):
                # Fallback if ORM delivered a string (edge case)
                locked_until = datetime.fromisoformat(locked_until_raw).replace(tzinfo=timezone.utc)
        except Exception:
            # If anything unexpected occurs, treat as locked to be safe.
            locked_until = datetime.max.replace(tzinfo=timezone.utc)

    now_utc = datetime.now(timezone.utc)
    if locked_until and locked_until > now_utc:
        # Use the same generic error message as for invalid credentials to avoid
        # leaking lockout state to attackers. The lock itself is still enforced.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    # Use getattr to avoid lazy loading issues in async context
    is_active = getattr(user, 'is_active', True)
    if not is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    if getattr(user, "is_pending_activation", False):
        raise HTTPException(
            status_code=400,
            detail="Account not yet activated. Use the invite link sent to your email to set a password.",
        )

    if not verify_password(form_data.password, user.hashed_password):
        # SECURITY: Increment failed login attempts and lock account after
        # configured number of failures.
        import logging
        logger = logging.getLogger("purvex.api")
        logger.warning("Failed login attempt from IP: %s", client_ip)
        
        # Handle case where columns might not exist yet (defensive coding)
        try:
            # Increment failed attempts
            current_attempts = getattr(user, 'failed_login_attempts', 0) or 0
            user.failed_login_attempts = current_attempts + 1
            
            # Lock account after N failed attempts for a configured duration.
            max_attempts = getattr(app_settings, "LOGIN_MAX_ATTEMPTS", 5)
            lockout_minutes = getattr(app_settings, "LOGIN_LOCKOUT_MINUTES", 30)
            if user.failed_login_attempts >= max_attempts:
                from datetime import timedelta
                user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=lockout_minutes)
                logger.warning("Account locked after %d failed attempts from IP: %s", user.failed_login_attempts, client_ip)
            
            await db.commit()
        except (AttributeError, Exception) as e:
            # If columns don't exist yet, just log and continue (migration will add them on restart)
            logger.warning(f"Account lockout fields not available yet (migration pending): {e}")
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    
    # SECURITY: Reset failed login attempts and unlock account on successful login
    # Handle case where columns might not exist yet (defensive coding)
    try:
        failed_attempts = getattr(user, 'failed_login_attempts', None)
        locked_until = getattr(user, 'locked_until', None)
        if (failed_attempts and failed_attempts > 0) or locked_until:
            user.failed_login_attempts = 0
            user.locked_until = None
            await db.commit()
    except (AttributeError, Exception) as e:
        # If columns don't exist yet, that's fine (migration will add them on restart)
        pass
    
    # Clear rate limit on successful login
    from ..utils.rate_limit import clear_rate_limit
    clear_rate_limit(rate_key)

    access_token = create_access_token(
        data={
            "sub": user.email,
            # Optionally include org/role claims for future use. We still
            # look up the user in the DB on each request for freshness.
            "uid": user.id,
            "adm": user.is_admin,
            "oid": getattr(user, "organization_id", None),
        }
    )

    # Fire‑and‑forget audit event for successful login.
    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user.id,
                user_email=user.email,
                action="LOGIN_SUCCESS",
                resource_type="auth",
                resource_id=None,
                details=None,
            )
        )
        await session.commit()

    # Set an httpOnly cookie for the primary session token.
    # Use secure cookies in non‑local environments.
    from ..config import settings  # local import to avoid cycles at module import time
    secure_cookie = settings.DEPLOYMENT_ENV.lower() == "prod"

    # Set cookie with explicit settings for better compatibility.
    # SECURITY: Use Secure=True in production, SameSite=Strict for sensitive operations.
    is_production = settings.DEPLOYMENT_ENV.lower() == "prod"
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=is_production,  # True in production, False in dev
        samesite="strict" if is_production else "lax",  # Strict in prod for better security
        path="/",  # Ensure cookie is accessible from all routes
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # align with ACCESS_TOKEN_EXPIRE_MINUTES
        # domain=None means browser will use the current domain (localhost/127.0.0.1)
    )
    
    return schemas.LoginResponse()


@router.get("/me", response_model=schemas.UserRead)
async def read_me(current_user: CurrentUser):
    return current_user

@router.post("/logout", response_model=dict)
async def logout(request: Request, response: Response):
    token = request.cookies.get("access_token")
    if token:
        payload = decode_access_token(token)
        if payload and payload.get("jti"):
            from ..utils.token_blacklist import blacklist_token
            exp = payload.get("exp", 0)
            blacklist_token(payload["jti"], float(exp))
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Logged out"}

@router.get("/csrf-token", response_model=dict)
async def get_csrf_token(current_user: CurrentUser):
    """Get a CSRF token for the current user."""
    from ..utils.csrf import generate_csrf_token, store_csrf_token
    
    token = generate_csrf_token()
    store_csrf_token(current_user.id, token)
    
    return {
        "csrf_token": token,
        "header_name": "X-CSRF-Token"
    }


class AcceptInviteRequest(BaseModel):
    token: str
    new_password: str


@router.post("/invite/accept", response_model=dict)
async def accept_invite(payload: AcceptInviteRequest, db: DBSession):
    """Public endpoint: an invited user sets their password and activates
    their account. Mirrors /auth/password-reset/confirm's validation shape,
    but against UserInviteToken and clearing is_pending_activation."""
    from ..utils.security import sanitize_string

    token = sanitize_string(payload.token, max_length=4096)
    new_password = sanitize_string(payload.new_password, max_length=128)
    if not token or not new_password:
        raise HTTPException(status_code=400, detail="Token and new password are required")

    claims = decode_access_token(token)
    if not claims or claims.get("purpose") != "user_invite":
        raise HTTPException(status_code=400, detail="Invalid or expired invite link")

    user_id = claims.get("uid")
    email = claims.get("sub")
    jti = claims.get("jti")
    if not user_id or not email or not jti:
        raise HTTPException(status_code=400, detail="Invalid invite token payload")

    user = await db.get(models.User, user_id)
    if not user or user.email != email:
        raise HTTPException(status_code=400, detail="Invalid invite token payload")

    token_result = await db.execute(
        select(models.UserInviteToken).where(
            models.UserInviteToken.user_id == user.id,
            models.UserInviteToken.jti == str(jti),
        )
    )
    invite_record = token_result.scalars().first()
    now = datetime.now(timezone.utc)
    if not invite_record or invite_record.used_at:
        raise HTTPException(status_code=400, detail="Invalid or expired invite link")

    expires_at = invite_record.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < now:
        raise HTTPException(status_code=400, detail="Invalid or expired invite link")

    if not user.is_pending_activation:
        raise HTTPException(status_code=400, detail="This account has already been activated")

    is_valid, error_msg = validate_password_complexity(new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    user.hashed_password = hash_password(new_password)
    user.is_pending_activation = False
    invite_record.used_at = now
    db.add(models.PasswordHistory(user_id=user.id, hashed_password=user.hashed_password))
    await db.commit()

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user.id,
                user_email=user.email,
                action="USER_INVITE_ACCEPTED",
                resource_type="user",
                resource_id=str(user.id),
                details="User activated account via invite",
            )
        )
        await session.commit()

    return {"message": "Account activated. You can now sign in."}
