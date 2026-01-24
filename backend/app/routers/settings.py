from typing import List, Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, status, Request, Body, Response
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func # for default timestamps
import json

from ..db import get_db, async_sessionmaker
from .. import models, schemas
from ..routers.auth import get_current_user
from ..utils.tenant import require_org_id
from ..utils.authz import require_permission, Permission
from ..config import settings

router = APIRouter(
    prefix="/settings",
    tags=["settings"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]

# Helper function to convert JSON strings to/from Python lists/dicts
def serialize_json_column(data):
    if isinstance(data, list) or isinstance(data, dict):
        return json.dumps(data)
    return data

def deserialize_json_column(data):
    if isinstance(data, str):
        try:
            return json.loads(data)
        except json.JSONDecodeError:
            pass # Return original string if not valid JSON
    return data

def safe_user_identity(user: models.User):
    try:
        return int(user.id), str(user.email)
    except Exception:
        return None, None

# --- Organization Settings ---

@router.get("/organization", response_model=schemas.Organization)
async def get_organization_settings(
    db: DBSession,
    current_user: CurrentUser, # Requires authentication
):
    # Assuming a single organization for MVP
    result = await db.execute(select(models.Organization))
    organization = result.scalar_one_or_none()

    # If no organization exists, create a fully-populated default one
    if not organization:
        # Convert comma-separated strings to JSON arrays
        env_names_json = json.dumps([e.strip() for e in settings.DEFAULT_ENVIRONMENT_NAMES.split(",") if e.strip()]) if settings.DEFAULT_ENVIRONMENT_NAMES else '[]'
        compliance_flags_json = json.dumps([f.strip() for f in settings.COMPLIANCE_MODE_FLAGS.split(",") if f.strip()]) if settings.COMPLIANCE_MODE_FLAGS else '[]'
        
        organization = models.Organization(
            name=settings.ORGANIZATION_NAME,
            primary_contact_email=settings.PRIMARY_CONTACT_EMAIL,
            timezone=settings.DEFAULT_TIMEZONE,
            locale=settings.DEFAULT_LOCALE,
            default_environment_names=env_names_json,
            compliance_mode_flags=compliance_flags_json,
        )
        db.add(organization)
        await db.commit()
        await db.refresh(organization)
    else:
        # Hardening: older rows might have NULLs; normalise to non-null defaults
        changed = False
        if organization.timezone is None:
            organization.timezone = settings.DEFAULT_TIMEZONE
            changed = True
        if organization.locale is None:
            organization.locale = settings.DEFAULT_LOCALE
            changed = True
        if organization.default_environment_names is None:
            # Convert comma-separated string to JSON array
            env_names_json = json.dumps([e.strip() for e in settings.DEFAULT_ENVIRONMENT_NAMES.split(",") if e.strip()]) if settings.DEFAULT_ENVIRONMENT_NAMES else '[]'
            organization.default_environment_names = env_names_json
            changed = True
        if organization.compliance_mode_flags is None:
            # Convert comma-separated string to JSON array
            compliance_flags_json = json.dumps([f.strip() for f in settings.COMPLIANCE_MODE_FLAGS.split(",") if f.strip()]) if settings.COMPLIANCE_MODE_FLAGS else '[]'
            organization.compliance_mode_flags = compliance_flags_json
            changed = True

        if changed:
            db.add(organization)
            await db.commit()
            await db.refresh(organization)

    return organization

@router.put("/organization", response_model=schemas.Organization)
async def update_organization_settings(
    org_update: schemas.OrganizationCreate,
    db: DBSession,
    current_user: CurrentUser, # Requires authentication
):
    try:
        # RBAC: Require organization management permission
        await require_permission(current_user, Permission.SETTINGS_ORG_MANAGE, db)
        user_id, user_email = safe_user_identity(current_user)
        
        # Get the update data (only fields that were set)
        update_dict = org_update.model_dump(exclude_unset=True)
        
        # SECURITY: Sanitize all input fields (except JSON fields which are already JSON strings)
        from ..utils.sanitize_inputs import sanitize_model_inputs
        
        # Separate JSON fields from regular fields
        json_fields = {}
        regular_fields = {}
        for key, value in update_dict.items():
            if key in ["default_environment_names", "compliance_mode_flags"]:
                json_fields[key] = value
            else:
                regular_fields[key] = value
        
        # Sanitize regular fields
        sanitized_regular = sanitize_model_inputs(regular_fields) if regular_fields else {}
        
        # Combine sanitized regular fields with JSON fields (JSON fields are already strings)
        sanitized_data = {**sanitized_regular, **json_fields}

        result = await db.execute(select(models.Organization))
        organization = result.scalar_one_or_none()

        if not organization:
            # Create if not exists (should be handled by GET, but as a fallback)
            # Ensure JSON fields are properly formatted
            for key in ["default_environment_names", "compliance_mode_flags"]:
                if key in sanitized_data and isinstance(sanitized_data[key], str):
                    # Validate it's valid JSON, if not try to parse and re-serialize
                    try:
                        json.loads(sanitized_data[key])  # Validate
                    except json.JSONDecodeError:
                        # If invalid, try to treat as comma-separated and convert
                        if sanitized_data[key]:
                            sanitized_data[key] = json.dumps([v.strip() for v in sanitized_data[key].split(",") if v.strip()])
                        else:
                            sanitized_data[key] = "[]"
            organization = models.Organization(**sanitized_data)
            db.add(organization)
        else:
            # Update existing organization
            for key, value in sanitized_data.items():
                if key in ["default_environment_names", "compliance_mode_flags"]:
                    # Ensure it's a valid JSON string
                    if isinstance(value, str):
                        try:
                            json.loads(value)  # Validate it's valid JSON
                            setattr(organization, key, value)  # Use as-is
                        except json.JSONDecodeError:
                            # If not valid JSON, try to convert from comma-separated
                            if value:
                                setattr(organization, key, json.dumps([v.strip() for v in value.split(",") if v.strip()]))
                            else:
                                setattr(organization, key, "[]")
                    else:
                        setattr(organization, key, serialize_json_column(value))
                else:
                    setattr(organization, key, value)
        
        await db.commit()
        await db.refresh(organization)

        # Audit the organization settings update.
        async with async_sessionmaker() as session:
            session.add(
                models.AuditEvent(
                    user_id=user_id,
                    user_email=user_email,
                    action="UPDATE_SETTINGS_ORGANIZATION",
                    resource_type="settings",
                    resource_id=str(organization.id),
                    details="organization settings updated",
                )
            )
            await session.commit()

        return organization
    except HTTPException:
        raise
    except Exception as e:
        import logging
        logger = logging.getLogger("purvex.api")
        logger.error(f"Error updating organization settings: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update organization settings: {str(e)}"
        )

    return organization

# --- User Management (existing User model, but settings view)
# Endpoints for Users (list, get, update) could go here or in a separate user router
# For MVP, assume User management happens via /auth/register initially and direct DB access for now.

# --- SIEM & Data Source Settings ---

@router.get("/siem-connections", response_model=List[schemas.SIEMConnection])
async def list_siem_connections(
    db: DBSession,
    current_user: CurrentUser,
):
    # Scope SIEM connections to the caller's organization.
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection).where(models.SIEMConnection.organization_id == org_id)
    )
    from ..services.siem_universal import SIEMUniversalService
    return [SIEMUniversalService(conn).to_connection_response() for conn in result.scalars().all()]

@router.post("/siem-connections", response_model=schemas.SIEMConnection, status_code=status.HTTP_201_CREATED)
async def create_siem_connection(
    siem_create: schemas.SIEMConnectionCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    # RBAC: Require SIEM management permission
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    user_id, user_email = safe_user_identity(current_user)
    
    # SECURITY: Sanitize all input fields
    from ..utils.sanitize_inputs import sanitize_model_inputs
    sanitized_data = sanitize_model_inputs(siem_create)
    sanitized_data.pop("organization_id", None)
    
    org_id = require_org_id(current_user)
    db_siem = models.SIEMConnection(
        organization_id=org_id,
        **sanitized_data,
    )
    db.add(db_siem)
    await db.commit()
    await db.refresh(db_siem)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="CREATE_SIEM_CONNECTION",
                resource_type="settings",
                resource_id=str(db_siem.id),
                details=db_siem.name,
            )
        )
        await session.commit()

    from ..services.siem_universal import SIEMUniversalService
    return SIEMUniversalService(db_siem).to_connection_response()

@router.get("/siem-connections/{siem_id}", response_model=schemas.SIEMConnection)
async def get_siem_connection(
    siem_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    # SECURITY: Validate siem_id is positive
    if siem_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SIEM connection ID")
    
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection)
        .filter(models.SIEMConnection.id == siem_id)
        .filter(models.SIEMConnection.organization_id == org_id)
    )
    siem_connection = result.scalar_one_or_none()
    if not siem_connection:
        raise HTTPException(status_code=404, detail="SIEM Connection not found")
    from ..services.siem_universal import SIEMUniversalService
    return SIEMUniversalService(siem_connection).to_connection_response()

@router.put("/siem-connections/{siem_id}", response_model=schemas.SIEMConnection)
async def update_siem_connection(
    siem_id: int,
    siem_update: schemas.SIEMConnectionCreate, # Using Create schema for update as well
    db: DBSession,
    current_user: CurrentUser,
):
    # SECURITY: Validate siem_id is positive
    if siem_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SIEM connection ID")
    
    # RBAC: Require SIEM management permission
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    user_id, user_email = safe_user_identity(current_user)
    
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection)
        .filter(models.SIEMConnection.id == siem_id)
        .filter(models.SIEMConnection.organization_id == org_id)
    )
    siem_connection = result.scalar_one_or_none()
    if not siem_connection:
        raise HTTPException(status_code=404, detail="SIEM Connection not found")
    
    # SECURITY: Sanitize all input fields
    from ..utils.sanitize_inputs import sanitize_model_inputs
    sanitized_update = sanitize_model_inputs(siem_update)
    update_data = sanitized_update.model_dump(exclude_unset=True) if hasattr(sanitized_update, 'model_dump') else sanitized_update
    # SECURITY: Do not overwrite credentials unless explicitly provided
    if update_data.get("credentials") in ["", None]:
        update_data.pop("credentials", None)
    if "credentials" in update_data:
        try:
            incoming = update_data.get("credentials")
            incoming_data = json.loads(incoming) if isinstance(incoming, str) else (incoming or {})
        except Exception:
            incoming_data = {}
        try:
            existing_data = json.loads(siem_connection.credentials) if siem_connection.credentials else {}
        except Exception:
            existing_data = {}
        if isinstance(existing_data, dict) and isinstance(incoming_data, dict):
            if "token" not in incoming_data and existing_data.get("token"):
                incoming_data["token"] = existing_data.get("token")
            update_data["credentials"] = json.dumps(incoming_data)
    for key, value in update_data.items():
        setattr(siem_connection, key, value)
    
    await db.commit()
    await db.refresh(siem_connection)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="UPDATE_SIEM_CONNECTION",
                resource_type="settings",
                resource_id=str(siem_connection.id),
                details=siem_connection.name,
            )
        )
        await session.commit()

    from ..services.siem_universal import SIEMUniversalService
    return SIEMUniversalService(siem_connection).to_connection_response()

@router.delete("/siem-connections/{siem_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_siem_connection(
    siem_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    # SECURITY: Validate siem_id is positive
    if siem_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SIEM connection ID")
    
    # RBAC: Require SIEM management permission
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    user_id, user_email = safe_user_identity(current_user)
    
    # CRITICAL: Verify SIEM connection belongs to this org before deletion.
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection)
        .filter(models.SIEMConnection.id == siem_id)
        .filter(models.SIEMConnection.organization_id == org_id)
    )
    siem_connection = result.scalar_one_or_none()
    if not siem_connection:
        raise HTTPException(status_code=404, detail="SIEM Connection not found or access denied")
    
    await db.delete(siem_connection)
    await db.commit()

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="DELETE_SIEM_CONNECTION",
                resource_type="settings",
                resource_id=str(siem_id),
                details=siem_connection.name,
            )
        )
        await session.commit()

    return {"message": "SIEM Connection deleted successfully"}

@router.get("/siem-connections/{siem_id}/alerts", response_model=List[schemas.SIEMAlert])
async def get_siem_alerts(
    siem_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    limit: int = 50,
):
    await require_permission(current_user, Permission.DETECTIONS_READ, db)
    if siem_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SIEM connection ID")
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection)
        .filter(models.SIEMConnection.id == siem_id)
        .filter(models.SIEMConnection.organization_id == org_id)
    )
    siem_connection = result.scalar_one_or_none()
    if not siem_connection:
        raise HTTPException(status_code=404, detail="SIEM Connection not found")
    from ..services.siem_universal import SIEMUniversalService
    return await SIEMUniversalService(siem_connection).get_alerts(limit=limit)


@router.get("/siem-connections/{siem_id}/events", response_model=List[schemas.SIEMEvent])
async def get_siem_events(
    siem_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    limit: int = 100,
):
    await require_permission(current_user, Permission.DETECTIONS_READ, db)
    if siem_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SIEM connection ID")
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection)
        .filter(models.SIEMConnection.id == siem_id)
        .filter(models.SIEMConnection.organization_id == org_id)
    )
    siem_connection = result.scalar_one_or_none()
    if not siem_connection:
        raise HTTPException(status_code=404, detail="SIEM Connection not found")
    from ..services.siem_universal import SIEMUniversalService
    return await SIEMUniversalService(siem_connection).get_events(limit=limit)


@router.get("/siem-connections/{siem_id}/rules", response_model=List[schemas.SIEMRule])
async def get_siem_rules(
    siem_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    limit: int = 200,
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    if siem_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SIEM connection ID")
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection)
        .filter(models.SIEMConnection.id == siem_id)
        .filter(models.SIEMConnection.organization_id == org_id)
    )
    siem_connection = result.scalar_one_or_none()
    if not siem_connection:
        raise HTTPException(status_code=404, detail="SIEM Connection not found")
    from ..services.siem_universal import SIEMUniversalService
    return await SIEMUniversalService(siem_connection).get_rules(limit=limit)


@router.get("/siem-connections/{siem_id}/health", response_model=schemas.SIEMHealth)
async def get_siem_health(
    siem_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    if siem_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SIEM connection ID")
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection)
        .filter(models.SIEMConnection.id == siem_id)
        .filter(models.SIEMConnection.organization_id == org_id)
    )
    siem_connection = result.scalar_one_or_none()
    if not siem_connection:
        raise HTTPException(status_code=404, detail="SIEM Connection not found")
    from ..services.siem_universal import SIEMUniversalService
    health = await SIEMUniversalService(siem_connection).get_health()
    if health.status == "connected":
        siem_connection.last_validated_at = datetime.now(timezone.utc)
        await db.commit()
    return health

@router.get("/siem-connections/{siem_id}/evidence", response_model=schemas.SIEMEvidenceBundle)
async def get_siem_evidence(
    siem_id: int,
    db: DBSession,
    current_user: CurrentUser,
    earliest: str = "-2m",
    latest: str = "now",
    host: Optional[str] = None,
    user: Optional[str] = None,
    dest: Optional[str] = None,
    src: Optional[str] = None,
    limit: int = 50,
):
    await require_permission(current_user, Permission.DETECTIONS_READ, db)
    if siem_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SIEM connection ID")
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.SIEMConnection)
        .filter(models.SIEMConnection.id == siem_id)
        .filter(models.SIEMConnection.organization_id == org_id)
    )
    siem_connection = result.scalar_one_or_none()
    if not siem_connection:
        raise HTTPException(status_code=404, detail="SIEM Connection not found")
    from ..services.siem_universal import SIEMUniversalService
    try:
        return await SIEMUniversalService(siem_connection).get_evidence(
            earliest=earliest,
            latest=latest,
            host=host,
            user=user,
            dest=dest,
            src=src,
            limit=limit,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Splunk evidence request failed. Check URL, token, and SSL settings. {str(exc)}",
        )


# --- Environment Runner Settings ---

@router.post("/agent-registration-token", response_model=dict)
async def generate_agent_registration_token(
    db: DBSession,
    current_user: CurrentUser,
):
    """
    Generate a registration token for agent registration.
    This token is specifically for registering agents and has limited scope.
    """
    from ..security import create_access_token, decode_access_token

    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can generate registration tokens")
    
    # Create a token that expires in 1 year (long-lived for agent registration)
    # Include user info and a flag indicating this is an agent registration token
    token_data = {
        "sub": current_user.email,
        "user_id": current_user.id,
        "is_admin": current_user.is_admin,
        "agent_registration": True,  # Flag to identify this as an agent registration token
    }
    
    # Generate a short-lived token for one-time agent registration
    registration_token = create_access_token(
        data=token_data,
        expires_minutes=settings.AGENT_REGISTRATION_TOKEN_TTL_MINUTES,
    )

    token_payload = decode_access_token(registration_token) or {}
    token_jti = token_payload.get("jti")
    token_exp = token_payload.get("exp")
    if token_jti and token_exp:
        org_id = require_org_id(current_user)
        db.add(
            models.AgentRegistrationToken(
                organization_id=org_id,
                issued_by_user_id=current_user.id,
                jti=token_jti,
                expires_at=datetime.fromtimestamp(token_exp, tz=timezone.utc),
            )
        )
        await db.commit()

    return {
        "token": registration_token,
        "expires_in_minutes": settings.AGENT_REGISTRATION_TOKEN_TTL_MINUTES,
        "message": "Agent registration token generated successfully"
    }

@router.get("/environment-runners", response_model=List[schemas.EnvironmentRunnerConfig])
async def list_environment_runners(
    db: DBSession,
    current_user: CurrentUser,
):
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.EnvironmentRunnerConfig).where(
            models.EnvironmentRunnerConfig.organization_id == org_id
        )
    )
    return result.scalars().all()

@router.post("/environment-runners", response_model=schemas.EnvironmentRunnerRegistrationResponse, status_code=status.HTTP_201_CREATED)
async def create_environment_runner(
    request: Request,
    runner_create: schemas.EnvironmentRunnerConfigCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can create environment runners")
    user_id, user_email = safe_user_identity(current_user)
    
    # SECURITY: Sanitize all input fields
    from ..utils.sanitize_inputs import sanitize_model_inputs
    sanitized_data = sanitize_model_inputs(runner_create)
    sanitized_data.pop("organization_id", None)
    sanitized_data.pop("runner_token_hash", None)
    sanitized_data.pop("runner_token_last_rotated_at", None)
    sanitized_data.pop("runner_token_expires_at", None)
    
    org_id = require_org_id(current_user)
    token_record = None
    now = datetime.now(timezone.utc)
    auth_header = request.headers.get("Authorization")
    token = None
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.cookies.get("access_token")

    if token:
        from ..security import decode_access_token
        payload = decode_access_token(token) or {}
        if payload.get("agent_registration"):
            token_jti = payload.get("jti")
            if not token_jti:
                raise HTTPException(status_code=401, detail="Invalid registration token")
            result = await db.execute(
                select(models.AgentRegistrationToken)
                .filter(models.AgentRegistrationToken.jti == token_jti)
                .filter(models.AgentRegistrationToken.organization_id == org_id)
            )
            token_record = result.scalar_one_or_none()
            if not token_record:
                raise HTTPException(status_code=401, detail="Registration token expired or invalid")
            if token_record.expires_at:
                expires_at = token_record.expires_at
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if expires_at < now:
                    raise HTTPException(status_code=401, detail="Registration token expired or invalid")
            if token_record.used_at is not None:
                raise HTTPException(status_code=409, detail="Registration token already used")
    runner_token = secrets.token_urlsafe(32)
    runner_token_hash = hashlib.sha256(runner_token.encode()).hexdigest()
    expires_at = now + timedelta(days=settings.RUNNER_TOKEN_TTL_DAYS)
    db_runner = models.EnvironmentRunnerConfig(
        organization_id=org_id,
        runner_token_hash=runner_token_hash,
        runner_token_last_rotated_at=now,
        runner_token_expires_at=expires_at,
        **sanitized_data,
    )
    db.add(db_runner)
    await db.flush()
    if token_record:
        token_record.used_at = now
        token_record.used_by_runner_id = db_runner.id
    await db.commit()
    await db.refresh(db_runner)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="CREATE_ENVIRONMENT_RUNNER",
                resource_type="settings",
                resource_id=str(db_runner.id),
                details=db_runner.environment_name,
            )
        )
        await session.commit()

    response = schemas.EnvironmentRunnerRegistrationResponse.model_validate(db_runner)
    response.runner_token = runner_token
    return response

@router.post("/environment-runners/{runner_id}/stop", response_model=dict)
async def stop_environment_runner(
    runner_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can stop environment runners")
    user_id, user_email = safe_user_identity(current_user)
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.EnvironmentRunnerConfig)
        .filter(models.EnvironmentRunnerConfig.id == runner_id)
        .filter(models.EnvironmentRunnerConfig.organization_id == org_id)
    )
    runner_config = result.scalar_one_or_none()
    if not runner_config:
        raise HTTPException(status_code=404, detail="Environment Runner Config not found")

    existing = await db.execute(
        select(models.AgentCommand)
        .filter(models.AgentCommand.runner_id == runner_id)
        .filter(models.AgentCommand.status == "pending")
        .filter(models.AgentCommand.command_type == "STOP_AGENT")
    )
    existing_cmd = existing.scalar_one_or_none()
    if existing_cmd:
        return {"command_id": existing_cmd.id, "status": "pending"}

    cmd = models.AgentCommand(
        organization_id=org_id,
        runner_id=runner_id,
        command_type="STOP_AGENT",
        status="pending",
        issued_by_user_id=current_user.id,
    )
    runner_config.status = "stopping"
    db.add(cmd)
    await db.commit()
    await db.refresh(cmd)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="STOP_ENVIRONMENT_RUNNER",
                resource_type="settings",
                resource_id=str(runner_id),
                details=runner_config.environment_name,
            )
        )
        await session.commit()

    return {"command_id": cmd.id, "status": "queued"}

@router.post("/environment-runners/{runner_id}/pause", response_model=dict)
async def pause_environment_runner(
    runner_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can pause environment runners")
    user_id, user_email = safe_user_identity(current_user)
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.EnvironmentRunnerConfig)
        .filter(models.EnvironmentRunnerConfig.id == runner_id)
        .filter(models.EnvironmentRunnerConfig.organization_id == org_id)
    )
    runner_config = result.scalar_one_or_none()
    if not runner_config:
        raise HTTPException(status_code=404, detail="Environment Runner Config not found")

    existing = await db.execute(
        select(models.AgentCommand)
        .filter(models.AgentCommand.runner_id == runner_id)
        .filter(models.AgentCommand.status == "pending")
        .filter(models.AgentCommand.command_type == "PAUSE_AGENT")
    )
    existing_cmd = existing.scalar_one_or_none()
    if existing_cmd:
        return {"command_id": existing_cmd.id, "status": "pending"}

    cmd = models.AgentCommand(
        organization_id=org_id,
        runner_id=runner_id,
        command_type="PAUSE_AGENT",
        status="pending",
        issued_by_user_id=current_user.id,
    )
    runner_config.status = "pausing"
    db.add(cmd)
    await db.commit()
    await db.refresh(cmd)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="PAUSE_ENVIRONMENT_RUNNER",
                resource_type="settings",
                resource_id=str(runner_id),
                details=runner_config.environment_name,
            )
        )
        await session.commit()

    return {"command_id": cmd.id, "status": "queued"}

@router.post("/environment-runners/{runner_id}/resume", response_model=dict)
async def resume_environment_runner(
    runner_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can resume environment runners")
    user_id, user_email = safe_user_identity(current_user)
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.EnvironmentRunnerConfig)
        .filter(models.EnvironmentRunnerConfig.id == runner_id)
        .filter(models.EnvironmentRunnerConfig.organization_id == org_id)
    )
    runner_config = result.scalar_one_or_none()
    if not runner_config:
        raise HTTPException(status_code=404, detail="Environment Runner Config not found")

    existing = await db.execute(
        select(models.AgentCommand)
        .filter(models.AgentCommand.runner_id == runner_id)
        .filter(models.AgentCommand.status == "pending")
        .filter(models.AgentCommand.command_type == "RESUME_AGENT")
    )
    existing_cmd = existing.scalar_one_or_none()
    if existing_cmd:
        return {"command_id": existing_cmd.id, "status": "pending"}

    cmd = models.AgentCommand(
        organization_id=org_id,
        runner_id=runner_id,
        command_type="RESUME_AGENT",
        status="pending",
        issued_by_user_id=current_user.id,
    )
    runner_config.status = "resuming"
    db.add(cmd)
    await db.commit()
    await db.refresh(cmd)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="RESUME_ENVIRONMENT_RUNNER",
                resource_type="settings",
                resource_id=str(runner_id),
                details=runner_config.environment_name,
            )
        )
        await session.commit()

    return {"command_id": cmd.id, "status": "queued"}

@router.post("/environment-runners/{runner_id}/rotate-token", response_model=dict)
async def rotate_environment_runner_token(
    runner_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can rotate runner tokens")
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.EnvironmentRunnerConfig)
        .filter(models.EnvironmentRunnerConfig.id == runner_id)
        .filter(models.EnvironmentRunnerConfig.organization_id == org_id)
    )
    runner_config = result.scalar_one_or_none()
    if not runner_config:
        raise HTTPException(status_code=404, detail="Environment Runner Config not found")

    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = datetime.utcnow()
    expires_at = now + timedelta(days=settings.RUNNER_TOKEN_TTL_DAYS)

    runner_config.runner_token_hash = token_hash
    runner_config.runner_token_last_rotated_at = now
    runner_config.runner_token_expires_at = expires_at
    await db.commit()
    await db.refresh(runner_config)

    user_id, user_email = safe_user_identity(current_user)
    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="ROTATE_ENVIRONMENT_RUNNER_TOKEN",
                resource_type="settings",
                resource_id=str(runner_config.id),
                details=runner_config.environment_name,
            )
        )
        await session.commit()

    return {
        "token": token,
        "expires_at": runner_config.runner_token_expires_at,
        "runner_id": runner_config.id,
    }

@router.get("/environment-runners/{runner_id}", response_model=schemas.EnvironmentRunnerConfig)
async def get_environment_runner(
    runner_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    # SECURITY: Validate runner_id is positive
    if runner_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid environment runner ID")
    
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.EnvironmentRunnerConfig)
        .filter(models.EnvironmentRunnerConfig.id == runner_id)
        .filter(models.EnvironmentRunnerConfig.organization_id == org_id)
    )
    runner_config = result.scalar_one_or_none()
    if not runner_config:
        raise HTTPException(status_code=404, detail="Environment Runner Config not found")
    return runner_config

@router.put("/environment-runners/{runner_id}", response_model=schemas.EnvironmentRunnerConfig)
async def update_environment_runner(
    runner_id: int,
    runner_update: schemas.EnvironmentRunnerConfigCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    # SECURITY: Validate runner_id is positive
    if runner_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid environment runner ID")
    
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can update environment runners")
    user_id, user_email = safe_user_identity(current_user)
    
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.EnvironmentRunnerConfig)
        .filter(models.EnvironmentRunnerConfig.id == runner_id)
        .filter(models.EnvironmentRunnerConfig.organization_id == org_id)
    )
    runner_config = result.scalar_one_or_none()
    if not runner_config:
        raise HTTPException(status_code=404, detail="Environment Runner Config not found")
    
    # SECURITY: Sanitize all input fields
    from ..utils.sanitize_inputs import sanitize_model_inputs
    sanitized_update = sanitize_model_inputs(runner_update)
    update_data = sanitized_update.model_dump(exclude_unset=True) if hasattr(sanitized_update, 'model_dump') else sanitized_update
    for key, value in update_data.items():
        if key == "allowed_test_types": # Handle JSON string conversion
            setattr(runner_config, key, serialize_json_column(value))
        else:
            setattr(runner_config, key, value)

    await db.commit()
    await db.refresh(runner_config)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="UPDATE_ENVIRONMENT_RUNNER",
                resource_type="settings",
                resource_id=str(runner_config.id),
                details=runner_config.environment_name,
            )
        )
        await session.commit()

    return runner_config

@router.post("/environment-runners/{runner_id}/heartbeat", response_model=None)
async def update_environment_runner_heartbeat(
    runner_id: int,
    request: Request,
    db: DBSession,
):
    if runner_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid environment runner ID")

    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip() or None

    runner_config = None
    if token:
        result = await db.execute(
            select(models.EnvironmentRunnerConfig)
            .filter(models.EnvironmentRunnerConfig.id == runner_id)
        )
        runner_config = result.scalar_one_or_none()
        if not runner_config:
            return Response(status_code=status.HTTP_404_NOT_FOUND)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        if runner_config.runner_token_hash:
            if runner_config.runner_token_hash != token_hash:
                # Allow valid registration tokens to heartbeat (older agents/scripts).
                from ..security import decode_access_token
                payload = decode_access_token(token) or {}
                if payload.get("agent_registration"):
                    token_jti = payload.get("jti")
                    if token_jti:
                        result = await db.execute(
                            select(models.AgentRegistrationToken)
                            .filter(models.AgentRegistrationToken.jti == token_jti)
                            .filter(models.AgentRegistrationToken.organization_id == runner_config.organization_id)
                        )
                        token_record = result.scalar_one_or_none()
                        if token_record:
                            expires_at = token_record.expires_at
                            now = datetime.now(timezone.utc)
                            if expires_at and expires_at.tzinfo is None:
                                expires_at = expires_at.replace(tzinfo=timezone.utc)
                            if not expires_at or expires_at >= now:
                                runner_token_valid = True
                            else:
                                runner_token_valid = False
                        else:
                            runner_token_valid = False
                    else:
                        runner_token_valid = False
                else:
                    runner_token_valid = False
                if not runner_token_valid:
                    return Response(status_code=status.HTTP_204_NO_CONTENT)
        else:
            # Backfill missing runner token hash for legacy records.
            runner_config.runner_token_hash = token_hash
            runner_config.runner_token_last_rotated_at = datetime.now(timezone.utc)
            runner_config.runner_token_expires_at = datetime.now(timezone.utc) + timedelta(days=settings.RUNNER_TOKEN_TTL_DAYS)
    else:
        # Legacy endpoint: only accept user-authenticated calls; otherwise ignore quietly.
        if "access_token" not in request.cookies:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        try:
            current_user = await get_current_user(request, db)
        except HTTPException:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        org_id = require_org_id(current_user)
        result = await db.execute(
            select(models.EnvironmentRunnerConfig)
            .filter(models.EnvironmentRunnerConfig.id == runner_id)
            .filter(models.EnvironmentRunnerConfig.organization_id == org_id)
        )
        runner_config = result.scalar_one_or_none()
        if not runner_config:
            return Response(status_code=status.HTTP_404_NOT_FOUND)

    update_data = {}
    try:
        payload = await request.json()
        if isinstance(payload, dict) and payload:
            try:
                update_data = schemas.EnvironmentRunnerHeartbeat(**payload).model_dump(exclude_unset=True)
            except Exception:
                update_data = {}
    except Exception:
        update_data = {}
    if "status" not in update_data:
        update_data["status"] = "online"
    update_data["last_check_in"] = datetime.utcnow()

    for key, value in update_data.items():
        setattr(runner_config, key, value)

    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.delete("/environment-runners/{runner_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_environment_runner(
    runner_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only administrators can delete environment runners")
    user_id, user_email = safe_user_identity(current_user)
    
    # CRITICAL: Verify environment runner belongs to this org before deletion.
    org_id = require_org_id(current_user)
    result = await db.execute(
        select(models.EnvironmentRunnerConfig)
        .filter(models.EnvironmentRunnerConfig.id == runner_id)
        .filter(models.EnvironmentRunnerConfig.organization_id == org_id)
    )
    runner_config = result.scalar_one_or_none()
    if not runner_config:
        raise HTTPException(status_code=404, detail="Environment Runner Config not found or access denied")
    
    await db.delete(runner_config)
    await db.commit()

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="DELETE_ENVIRONMENT_RUNNER",
                resource_type="settings",
                resource_id=str(runner_id),
                details=runner_config.environment_name,
            )
        )
        await session.commit()

    return {"message": "Environment Runner Config deleted successfully"}

# --- Testing Policy & Safety Settings ---

@router.get("/testing-policy", response_model=schemas.TestingPolicy)
async def get_testing_policy(
    db: DBSession,
    current_user: CurrentUser,
):
    # Get user's organization_id - auto-assign to default org if missing
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        try:
            # Get or create default organization
            result = await db.execute(select(models.Organization))
            org = result.scalar_one_or_none()
            if not org:
                org = models.Organization(name="Default Organization")
                db.add(org)
                await db.commit()
                await db.refresh(org)
            
            # Assign org to user - ensure user is in the session
            await db.refresh(current_user)  # Refresh to ensure we have latest state
            current_user.organization_id = org.id
            db.add(current_user)  # Explicitly add to session
            await db.commit()
            await db.refresh(current_user)
            org_id = org.id
        except Exception as e:
            # If auto-assignment fails, log and raise
            import logging
            logger = logging.getLogger("purvex.api")
            user_id, _ = safe_user_identity(current_user)
            logger.error(f"Failed to auto-assign organization to user {user_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to assign organization to user: {str(e)}"
            )
    else:
        org_id = int(org_id)
    
    # Query by organization_id
    result = await db.execute(
        select(models.TestingPolicy).filter(models.TestingPolicy.organization_id == org_id)
    )
    policy = result.scalar_one_or_none()
    if not policy:
        # Create default policy for this organization
        policy = models.TestingPolicy(organization_id=org_id)
        db.add(policy)
        await db.commit()
        await db.refresh(policy)
    return policy

@router.put("/testing-policy", response_model=schemas.TestingPolicy)
async def update_testing_policy(
    policy_update: schemas.TestingPolicyCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    # RBAC: Require settings update permission (testing policy is a setting)
    await require_permission(current_user, Permission.SETTINGS_UPDATE, db)

    # Capture user identity early to avoid lazy-load after commit.
    user_id, user_email = safe_user_identity(current_user)
    
    # Get user's organization_id - auto-assign to default org if missing
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        # Get or create default organization
        result = await db.execute(select(models.Organization))
        org = result.scalar_one_or_none()
        if not org:
            org = models.Organization(name="Default Organization")
            db.add(org)
            await db.commit()
            await db.refresh(org)
        
        # Assign org to user
        current_user.organization_id = org.id
        await db.commit()
        await db.refresh(current_user)
        org_id = org.id
    else:
        org_id = int(org_id)
    
    # Query by organization_id
    result = await db.execute(
        select(models.TestingPolicy).filter(models.TestingPolicy.organization_id == org_id)
    )
    policy = result.scalar_one_or_none()
    
    if not policy:
        # Create new policy for this organization
        policy_data = policy_update.model_dump()
        policy_data["organization_id"] = org_id
        policy = models.TestingPolicy(**policy_data)
        db.add(policy)
    else:
        update_data = policy_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            if key == "allowed_environments": # Handle JSON string conversion
                setattr(policy, key, serialize_json_column(value))
            else:
                setattr(policy, key, value)

    await db.commit()
    await db.refresh(policy)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="UPDATE_TESTING_POLICY",
                resource_type="settings",
                resource_id=str(policy.id),
                details="testing policy updated",
            )
        )
        await session.commit()

    return policy

# --- Detection Scoring & Health Settings ---

@router.get("/detection-scoring", response_model=schemas.DetectionScoring)
async def get_detection_scoring(
    db: DBSession,
    current_user: CurrentUser,
):
    # Get user's organization_id - auto-assign to default org if missing
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        # Get or create default organization
        result = await db.execute(select(models.Organization))
        org = result.scalar_one_or_none()
        if not org:
            org = models.Organization(name="Default Organization")
            db.add(org)
            await db.commit()
            await db.refresh(org)
        
        # Assign org to user
        current_user.organization_id = org.id
        await db.commit()
        await db.refresh(current_user)
        org_id = org.id
    else:
        org_id = int(org_id)
    
    # Query by organization_id
    result = await db.execute(
        select(models.DetectionScoring).filter(models.DetectionScoring.organization_id == org_id)
    )
    scoring = result.scalar_one_or_none()
    if not scoring:
        # Create default scoring for this organization
        scoring = models.DetectionScoring(organization_id=org_id)
        db.add(scoring)
        await db.commit()
        await db.refresh(scoring)
    return scoring

@router.put("/detection-scoring", response_model=schemas.DetectionScoring)
async def update_detection_scoring(
    scoring_update: schemas.DetectionScoringCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    # RBAC: Require settings update permission
    await require_permission(current_user, Permission.SETTINGS_UPDATE, db)
    user_id, user_email = safe_user_identity(current_user)
    
    # Get user's organization_id - auto-assign to default org if missing
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        # Get or create default organization
        result = await db.execute(select(models.Organization))
        org = result.scalar_one_or_none()
        if not org:
            org = models.Organization(name="Default Organization")
            db.add(org)
            await db.commit()
            await db.refresh(org)
        
        # Assign org to user
        current_user.organization_id = org.id
        await db.commit()
        await db.refresh(current_user)
        org_id = org.id
    else:
        org_id = int(org_id)
    
    # Query by organization_id
    result = await db.execute(
        select(models.DetectionScoring).filter(models.DetectionScoring.organization_id == org_id)
    )
    scoring = result.scalar_one_or_none()

    if not scoring:
        # Create new scoring for this organization
        scoring_data = scoring_update.model_dump()
        scoring_data["organization_id"] = org_id
        scoring = models.DetectionScoring(**scoring_data)
        db.add(scoring)
    else:
        update_data = scoring_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(scoring, key, value)
    
    await db.commit()
    await db.refresh(scoring)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="UPDATE_DETECTION_SCORING",
                resource_type="settings",
                resource_id=str(scoring.id),
                details="detection scoring updated",
            )
        )
        await session.commit()

    return scoring

# --- AI Assistant Settings ---

@router.get("/ai-assistant-settings", response_model=schemas.AIAssistantSettings)
async def get_ai_assistant_settings(
    db: DBSession,
    current_user: CurrentUser,
):
    # Get user's organization_id - auto-assign to default org if missing
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        # Get or create default organization
        result = await db.execute(select(models.Organization))
        org = result.scalar_one_or_none()
        if not org:
            org = models.Organization(name="Default Organization")
            db.add(org)
            await db.commit()
            await db.refresh(org)
        
        # Assign org to user
        current_user.organization_id = org.id
        await db.commit()
        await db.refresh(current_user)
        org_id = org.id
    else:
        org_id = int(org_id)
    
    # Query by organization_id
    result = await db.execute(
        select(models.AIAssistantSettings).filter(models.AIAssistantSettings.organization_id == org_id)
    )
    ai_settings = result.scalar_one_or_none()
    if not ai_settings:
        # Create default AI settings for this organization
        ai_settings = models.AIAssistantSettings(organization_id=org_id)
        db.add(ai_settings)
        await db.commit()
        await db.refresh(ai_settings)
    return ai_settings

@router.put("/ai-assistant-settings", response_model=schemas.AIAssistantSettings)
async def update_ai_assistant_settings(
    ai_settings_update: schemas.AIAssistantSettingsCreate,
    db: DBSession,
    current_user: CurrentUser,
):
    # RBAC: Require AI assistant configure permission
    await require_permission(current_user, Permission.ASSISTANT_CONFIGURE, db)
    user_id, user_email = safe_user_identity(current_user)
    
    # Get user's organization_id - auto-assign to default org if missing
    org_id = getattr(current_user, "organization_id", None)
    if not org_id:
        # Get or create default organization
        result = await db.execute(select(models.Organization))
        org = result.scalar_one_or_none()
        if not org:
            org = models.Organization(name="Default Organization")
            db.add(org)
            await db.commit()
            await db.refresh(org)
        
        # Assign org to user
        current_user.organization_id = org.id
        await db.commit()
        await db.refresh(current_user)
        org_id = org.id
    else:
        org_id = int(org_id)
    
    # Query by organization_id
    result = await db.execute(
        select(models.AIAssistantSettings).filter(models.AIAssistantSettings.organization_id == org_id)
    )
    ai_settings = result.scalar_one_or_none()

    if not ai_settings:
        # Create new AI settings for this organization
        ai_settings_data = ai_settings_update.model_dump()
        ai_settings_data["organization_id"] = org_id
        ai_settings = models.AIAssistantSettings(**ai_settings_data)
        db.add(ai_settings)
    else:
        update_data = ai_settings_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(ai_settings, key, value)
    
    await db.commit()
    await db.refresh(ai_settings)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=user_id,
                user_email=user_email,
                action="UPDATE_AI_ASSISTANT_SETTINGS",
                resource_type="settings",
                resource_id=str(ai_settings.id),
                details="ai assistant settings updated",
            )
        )
        await session.commit()

    return ai_settings
