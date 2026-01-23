from typing import List, Optional, Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from datetime import datetime
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
    return result.scalars().all()

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

    return db_siem

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
    return siem_connection

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

    return siem_connection

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
    from ..security import create_access_token
    
    # Create a token that expires in 1 year (long-lived for agent registration)
    # Include user info and a flag indicating this is an agent registration token
    token_data = {
        "sub": current_user.email,
        "user_id": current_user.id,
        "is_admin": current_user.is_admin,
        "agent_registration": True,  # Flag to identify this as an agent registration token
    }
    
    # Generate token with 1 year expiration (365 days * 24 hours * 60 minutes)
    registration_token = create_access_token(
        data=token_data,
        expires_minutes=365 * 24 * 60
    )
    
    return {
        "token": registration_token,
        "expires_in_days": 365,
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

@router.post("/environment-runners", response_model=schemas.EnvironmentRunnerConfig, status_code=status.HTTP_201_CREATED)
async def create_environment_runner(
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
    
    org_id = require_org_id(current_user)
    db_runner = models.EnvironmentRunnerConfig(organization_id=org_id, **sanitized_data)
    db.add(db_runner)
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

    return db_runner

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

@router.post("/environment-runners/{runner_id}/heartbeat", response_model=schemas.EnvironmentRunnerConfig)
async def update_environment_runner_heartbeat(
    runner_id: int,
    heartbeat: schemas.EnvironmentRunnerHeartbeat,
    db: DBSession,
    current_user: CurrentUser,
):
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

    update_data = heartbeat.model_dump(exclude_unset=True)
    if "status" not in update_data:
        update_data["status"] = "online"
    update_data["last_check_in"] = datetime.utcnow()

    for key, value in update_data.items():
        setattr(runner_config, key, value)

    await db.commit()
    await db.refresh(runner_config)
    return runner_config

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
