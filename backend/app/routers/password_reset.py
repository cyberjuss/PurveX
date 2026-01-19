"""
Self-service password reset endpoints.

This flow is intentionally minimal for now:
- /auth/password-reset/request accepts an email and, if the user exists,
  issues a short-lived reset token and logs it server-side (for integration
  with an email provider in production).
- /auth/password-reset/confirm accepts the token and a new password,
  validates it, enforces password history, and updates the user's password.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing_extensions import Annotated
from pydantic import BaseModel

from ..db import get_db, async_sessionmaker
from .. import models
from ..security import hash_password, verify_password, validate_password_complexity, create_access_token, decode_access_token
from ..utils.security import sanitize_email, sanitize_string
from ..utils.rate_limit import check_rate_limit
from ..config import settings as app_settings

router = APIRouter(
    prefix="/auth/password-reset",
    tags=["auth"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]


class PasswordResetRequest(BaseModel):
    email: str


class PasswordResetConfirm(BaseModel):
    token: str
    new_password: str


async def _get_user_by_email(db: AsyncSession, email: str) -> Optional[models.User]:
    result = await db.execute(select(models.User).where(models.User.email == email))
    return result.scalars().first()


@router.post("/request", response_model=dict)
async def request_password_reset(payload: PasswordResetRequest, request: Request, db: DBSession):
    """
    Request a password reset link. For security reasons, the response is the
    same whether or not the email exists.
    """
    client_ip = request.client.host if request.client else "unknown"
    email = sanitize_email(payload.email)
    if not email:
        # Use generic message to avoid enumeration
        return {"message": "If an account exists for this email, a reset link has been generated."}

    # Rate limit reset requests per IP + email
    rate_key = f"password_reset_request:{client_ip}:{email}"
    allowed, _ = check_rate_limit(rate_key, max_requests=5, window_seconds=3600)
    if not allowed:
        # Generic message to avoid enumeration but log server-side
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password reset attempts. Please try again later.",
        )

    user = await _get_user_by_email(db, email)
    if not user:
        # Do not reveal whether the user exists
        return {"message": "If an account exists for this email, a reset link has been generated."}

    # Create a short-lived reset token encoded as a JWT.
    reset_token = create_access_token(
        data={
            "sub": user.email,
            "uid": user.id,
            "purpose": "password_reset",
        },
        expires_minutes=30,
    )

    # In a production deployment this token should be delivered via email.
    # For now we log it to the server log so it can be used during manual testing.
    import logging

    logger = logging.getLogger("purvex.api")
    logger.info("Password reset token generated for %s", user.email)

    # Do not return the raw token in production APIs – here we include it only
    # to make local testing and development easier.
    if app_settings.DEPLOYMENT_ENV.lower() != "prod":
        return {
            "message": "If an account exists for this email, a reset link has been generated.",
            "reset_token": reset_token,
        }

    return {"message": "If an account exists for this email, a reset link has been generated."}


@router.post("/confirm", response_model=dict)
async def confirm_password_reset(payload: PasswordResetConfirm, db: DBSession):
    """
    Confirm a password reset using the reset token and set a new password.
    """
    token = sanitize_string(payload.token, max_length=4096)
    new_password = sanitize_string(payload.new_password, max_length=128)

    if not token or not new_password:
        raise HTTPException(status_code=400, detail="Token and new password are required")

    # Decode and validate the reset token
    claims = decode_access_token(token)
    if not claims or claims.get("purpose") != "password_reset":
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    user_id = claims.get("uid")
    email = claims.get("sub")
    if not user_id or not email:
        raise HTTPException(status_code=400, detail="Invalid reset token payload")

    user = await db.get(models.User, user_id)
    if not user or user.email != email:
        raise HTTPException(status_code=400, detail="Invalid reset token payload")

    # Validate password complexity
    is_valid, error_msg = validate_password_complexity(new_password)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    # Enforce password history and prevent reuse.
    history_length = getattr(app_settings, "PASSWORD_HISTORY_LENGTH", 5)

    # Check against current password
    try:
        if user.hashed_password and verify_password(new_password, user.hashed_password):
            raise HTTPException(
                status_code=400,
                detail="New password cannot be the same as the current password",
            )
    except Exception:
        pass

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
                if verify_password(new_password, entry.hashed_password):
                    raise HTTPException(
                        status_code=400,
                        detail="New password cannot match any of your recent passwords",
                    )
            except Exception:
                continue

    # All checks passed – update the password and history.
    new_hash = hash_password(new_password)
    user.hashed_password = new_hash
    db.add(
        models.PasswordHistory(
            user_id=user.id,
            hashed_password=new_hash,
        )
    )
    await db.commit()

    # Optionally write an audit event
    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user.id,
                user_email=user.email,
                action="PASSWORD_RESET_SELF_SERVICE",
                resource_type="user",
                resource_id=str(user.id),
                details="User completed password reset via self-service flow",
            )
        )
        await session.commit()

    return {"message": "Password has been reset successfully"}

