"""
2FA (Two-Factor Authentication) endpoints.
"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing_extensions import Annotated
from pydantic import BaseModel

import logging

from .. import models, schemas
from ..db import get_db
from ..routers.auth import get_current_user
from ..utils.totp import (
    generate_totp_secret,
    generate_totp_uri,
    verify_totp_token,
    generate_backup_codes,
    serialize_backup_codes,
    verify_backup_code,
    deserialize_backup_codes,
    normalize_totp_secret,
)
from ..utils.security import sanitize_string

router = APIRouter(
    prefix="/auth/2fa",
    tags=["2fa"],
    responses={404: {"description": "Not found"}},
)

logger = logging.getLogger("purvex.auth.2fa")

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


class Setup2FARequest(BaseModel):
    """Request to set up 2FA (includes verification token)."""
    token: str  # 6-digit TOTP token from authenticator app


class Verify2FARequest(BaseModel):
    """Request to verify 2FA token during login."""
    token: str  # 6-digit TOTP token or backup code
    two_factor_token: str  # short-lived JWT issued by /auth/login when 2FA is required


class Disable2FARequest(BaseModel):
    """Request to disable 2FA (requires password confirmation)."""
    password: str


@router.get("/setup", response_model=dict)
async def get_2fa_setup(
    current_user: CurrentUser,
    db: DBSession,
):
    """
    Get 2FA setup information (QR code URI and backup codes).
    Only available if 2FA is not yet enabled.
    """
    if current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is already enabled for this account"
        )
    
    # Generate new secret if not exists
    if not current_user.two_factor_secret:
        secret = generate_totp_secret()
        current_user.two_factor_secret = secret
        await db.commit()
        await db.refresh(current_user)
    else:
        secret = current_user.two_factor_secret
    
    # Generate provisioning URI
    normalized_secret = normalize_totp_secret(secret)
    if normalized_secret != secret:
        current_user.two_factor_secret = normalized_secret
        await db.commit()
        await db.refresh(current_user)
        secret = normalized_secret
    try:
        uri = generate_totp_uri(secret, current_user.email)
    except Exception as exc:
        logger.warning("Failed to build TOTP URI for user %s: %s. Generating a new secret.", current_user.email, exc)
        secret = generate_totp_secret()
        current_user.two_factor_secret = secret
        await db.commit()
        await db.refresh(current_user)
        uri = generate_totp_uri(secret, current_user.email)
    
    # Generate backup codes if not exists
    if not current_user.two_factor_backup_codes:
        backup_codes = generate_backup_codes()
        current_user.two_factor_backup_codes = serialize_backup_codes(backup_codes)
        await db.commit()
        await db.refresh(current_user)
    else:
        backup_codes = deserialize_backup_codes(current_user.two_factor_backup_codes)
    
    return {
        "qr_code_uri": uri,
        "backup_codes": backup_codes,  # Show only once during setup
        "secret": secret,  # For manual entry if QR code doesn't work
    }


@router.post("/setup", response_model=dict)
async def complete_2fa_setup(
    request: Setup2FARequest,
    current_user: CurrentUser,
    db: DBSession,
):
    """
    Complete 2FA setup by verifying the initial token.
    """
    if current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is already enabled for this account"
        )
    
    if not current_user.two_factor_secret:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired 2FA setup session",
        )
    
    # Sanitize token input
    token = sanitize_string(request.token, max_length=10)
    if len(token) != 6 or not token.isdigit():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code",
        )
    
    # Verify token
    if not verify_totp_token(current_user.two_factor_secret, token):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code",
        )
    
    # Enable 2FA
    current_user.two_factor_enabled = True
    await db.commit()
    
    return {
        "message": "2FA enabled successfully",
        "backup_codes": deserialize_backup_codes(current_user.two_factor_backup_codes)
    }


@router.post("/verify", response_model=dict)
async def verify_2fa_token(
    request: Verify2FARequest,
    db: DBSession,
    response,
):
    """
    Verify a 2FA token (used during login).
    This endpoint is called after password verification, using a short-lived
    "two_factor_token" JWT issued by /auth/login.
    """
    from fastapi import Response
    from ..security import decode_access_token, create_access_token
    from ..config import settings

    if not isinstance(response, Response):
        # FastAPI will inject a Response instance; this is a safety check.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Response object not available for 2FA verification",
        )

    # Decode and validate the short-lived two_factor_token.
    payload = decode_access_token(request.two_factor_token)
    if not payload or not payload.get("two_factor_pending"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired 2FA session token",
        )

    user_id = payload.get("uid")
    email = payload.get("sub")
    if not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired 2FA session token",
        )

    # Load the user and ensure 2FA is still enabled.
    from sqlalchemy import select
    result = await db.execute(select(models.User).where(models.User.id == user_id))
    current_user: Optional[models.User] = result.scalars().first()

    if not current_user or current_user.email != email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired 2FA session token",
        )

    if not current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled for this account",
        )

    # Sanitize token input
    token = sanitize_string(request.token, max_length=10)

    # Try TOTP token first
    if len(token) == 6 and token.isdigit():
        if not (current_user.two_factor_secret and verify_totp_token(current_user.two_factor_secret, token)):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid verification code",
            )
        method = "totp"
    # Try backup code
    elif len(token) == 8 and token.isdigit():
        is_valid, updated_codes = verify_backup_code(current_user.two_factor_backup_codes, token)
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid verification code",
            )
        current_user.two_factor_backup_codes = updated_codes
        await db.commit()
        method = "backup_code"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid verification code",
        )

    # At this point 2FA is verified. Issue the real access token and set the
    # primary session cookie, mirroring /auth/login success behaviour.
    access_token = create_access_token(
        data={
            "sub": current_user.email,
            "uid": current_user.id,
            "adm": current_user.is_admin,
            "oid": getattr(current_user, "organization_id", None),
        }
    )

    is_production = settings.DEPLOYMENT_ENV.lower() == "prod"
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=is_production,
        samesite="strict" if is_production else "lax",
        path="/",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    return {
        "verified": True,
        "method": method,
        "access_token": access_token,
    }


@router.get("/status", response_model=dict)
async def get_2fa_status(
    current_user: CurrentUser,
):
    """Get 2FA status for the current user."""
    return {
        "enabled": current_user.two_factor_enabled,
        "has_backup_codes": bool(current_user.two_factor_backup_codes and deserialize_backup_codes(current_user.two_factor_backup_codes))
    }


@router.post("/disable", response_model=dict)
async def disable_2fa(
    request: Disable2FARequest,
    current_user: CurrentUser,
    db: DBSession,
):
    """
    Disable 2FA for the current user.
    Requires password confirmation.
    """
    if not current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled for this account"
        )
    
    # Verify password
    from ..security import verify_password
    if not verify_password(request.password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid password"
        )
    
    # Disable 2FA
    current_user.two_factor_enabled = False
    current_user.two_factor_secret = None
    current_user.two_factor_backup_codes = None
    await db.commit()
    
    return {"message": "2FA disabled successfully"}


@router.post("/regenerate-backup-codes", response_model=dict)
async def regenerate_backup_codes(
    current_user: CurrentUser,
    db: DBSession,
):
    """
    Regenerate backup codes for 2FA.
    Old codes are invalidated.
    """
    if not current_user.two_factor_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="2FA is not enabled for this account"
        )
    
    backup_codes = generate_backup_codes()
    current_user.two_factor_backup_codes = serialize_backup_codes(backup_codes)
    await db.commit()
    
    return {
        "backup_codes": backup_codes,
        "message": "Backup codes regenerated. Old codes are no longer valid."
    }
