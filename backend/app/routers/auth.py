from typing import Annotated
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

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
    role_result = await db.execute(select(models.Role).where(models.Role.name == RoleEnum.ADMINISTRATOR.value))
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


@router.get("/bootstrap/status", response_model=schemas.BootstrapStatus)
async def bootstrap_status(db: DBSession):
    result = await db.execute(select(models.User).where(models.User.is_admin == True))
    admin = result.scalars().first()
    return {"needs_admin": admin is None}


@router.post("/bootstrap", response_model=schemas.UserRead)
async def bootstrap_admin(user_in: schemas.BootstrapAdminCreate, db: DBSession):
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

# SECURITY: Disable public registration - only allow via admin interface
# This endpoint should be removed or restricted to admin-only in production
@router.post("/register", response_model=schemas.UserRead)
async def register_admin(user_in: schemas.UserCreate, db: DBSession):
    """
    SECURITY WARNING: This endpoint allows creating admin users.
    In production, this should be disabled or restricted to existing admins only.
    """
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
        raise HTTPException(status_code=400, detail="User already exists")

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

@router.post("/login", response_model=schemas.Token)
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
        # Use same error message to prevent user enumeration
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
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

    if not verify_password(form_data.password, user.hashed_password):
        # SECURITY: Increment failed login attempts and lock account after
        # configured number of failures.
        import logging
        logger = logging.getLogger("purvex.api")
        logger.warning(f"Failed login attempt for user: {form_data.username} from IP: {client_ip}")
        
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
                logger.warning(f"Account locked for user: {form_data.username} after {user.failed_login_attempts} failed attempts")
            
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
    
    # SECURITY: Check if 2FA is required for this account.
    # If enabled for the user (admin or non-admin), or if the environment
    # policy requires 2FA for this user class, we do NOT create a full
    # session yet. Instead we:
    # - Issue a short-lived "two_factor_token" JWT marked as pending.
    # - Return it to the client, which will call /auth/2fa/verify.
    try:
        await db.refresh(user)
    except Exception:
        pass

    two_factor_enabled = getattr(user, "two_factor_enabled", False)
    require_2fa_for_admins = getattr(app_settings, "REQUIRE_2FA_FOR_ADMINS", False)
    require_2fa_for_all = getattr(app_settings, "REQUIRE_2FA_FOR_ALL_USERS", False)

    must_use_2fa = two_factor_enabled or require_2fa_for_all or (require_2fa_for_admins and getattr(user, "is_admin", False))

    if must_use_2fa:
        from fastapi.responses import JSONResponse

        two_factor_token = create_access_token(
            data={
                "sub": user.email,
                "uid": user.id,
                "two_factor_pending": True,
            },
            # Short-lived token to reduce risk if intercepted.
            expires_minutes=10,
        )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "requires_2fa": True,
                "two_factor_token": two_factor_token,
                "message": "Two-factor authentication required",
            },
        )

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

    # Set cookie with explicit settings for better compatibility
    # Note: For cross-origin requests (localhost:3000 -> 127.0.0.1:8001), cookies may not be sent
    # The frontend will also send the token in the Authorization header as a fallback
    # SECURITY: Use Secure=True in production, SameSite=Strict for sensitive operations
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
    
    # Log cookie setting for debugging
    import logging
    logger = logging.getLogger("purvex.api")
    logger.info(f"Set access_token cookie for user {user.email}, max_age={settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60}s")

    return schemas.Token(access_token=access_token)


async def get_current_user(
    request: Request,
    db: DBSession,
) -> models.User:
    # Prefer httpOnly cookie for auth; fall back to Authorization header for
    # tooling / Swagger compatibility.
    token: str | None = request.cookies.get("access_token")
    
    # Debug: Log available cookies (without sensitive data)
    import logging
    logger = logging.getLogger("purvex.api")
    if not token:
        logger.debug(f"Cookie 'access_token' not found. Available cookies: {list(request.cookies.keys())}")

    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip() or None

    if not token:
        logger.warning(f"Authentication failed: No token found. Cookies: {list(request.cookies.keys())}, Headers: {list(request.headers.keys())}")
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

@router.get("/me", response_model=schemas.UserRead)
async def read_me(current_user: Annotated[models.User, Depends(get_current_user)]):
    return current_user

@router.post("/logout", response_model=dict)
async def logout(response: Response):
    response.delete_cookie(key="access_token", path="/")
    return {"message": "Logged out"}

@router.get("/test-cookie")
async def test_cookie(request: Request):
    """Test endpoint to verify cookie is being sent."""
    cookies = dict(request.cookies)
    has_token = "access_token" in cookies
    return {
        "cookies_received": list(cookies.keys()),
        "has_access_token": has_token,
        "cookie_count": len(cookies),
    }

@router.get("/csrf-token", response_model=dict)
async def get_csrf_token(current_user: Annotated[models.User, Depends(get_current_user)]):
    """Get a CSRF token for the current user."""
    from ..utils.csrf import generate_csrf_token, store_csrf_token
    
    token = generate_csrf_token()
    store_csrf_token(current_user.id, token)
    
    return {
        "csrf_token": token,
        "header_name": "X-CSRF-Token"
    }
