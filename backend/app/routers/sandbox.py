from typing import Annotated
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from ..db import get_db, async_sessionmaker
from .. import models, schemas
from ..routers.auth import get_current_user
from ..utils.tenant import require_org_id
from ..utils.authz import require_permission, Permission

router = APIRouter(
    prefix="/sandbox",
    tags=["sandbox"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


def _serialize_metadata(metadata: dict | None) -> str | None:
    if metadata is None:
        return None
    try:
        return json.dumps(metadata)
    except Exception:
        return None


@router.get("/", response_model=schemas.SandboxEnvironment)
async def get_sandbox_environment(
    db: DBSession,
    current_user: CurrentUser,
):
    """Return the current organisation's PurveX Lab / sandbox, if it exists."""
    await require_permission(current_user, Permission.SETTINGS_READ, db)

    org_id = require_org_id(current_user)

    result = await db.execute(
        select(models.SandboxEnvironment).where(
            models.SandboxEnvironment.organization_id == org_id
        )
    )
    sandbox = result.scalar_one_or_none()
    if not sandbox:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No sandbox environment has been provisioned for this organisation yet.",
        )
    return sandbox


@router.post("/provision", response_model=schemas.SandboxEnvironment, status_code=status.HTTP_201_CREATED)
async def provision_sandbox_environment(
    db: DBSession,
    current_user: CurrentUser,
):
    """Create (or return) a per‑tenant PurveX Lab record.

    For the MVP this *does not* talk to a real orchestrator yet. It simply
    creates a logical sandbox record that future n8n workflows and lab
    provisioning services can attach to.
    """
    await require_permission(current_user, Permission.SETTINGS_UPDATE, db)

    org_id = require_org_id(current_user)

    # If a sandbox already exists for this org, just return it.
    existing_result = await db.execute(
        select(models.SandboxEnvironment).where(
            models.SandboxEnvironment.organization_id == org_id
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        return existing

    sandbox = models.SandboxEnvironment(
        organization_id=org_id,
        external_id=str(uuid.uuid4()),
        display_name=f"PurveX Lab for org {org_id}",
        status="ready",
        size="small",
        provider="purvex_stub",
        extra_metadata=_serialize_metadata(
            {
                "note": "Stub sandbox created by PurveX API; attach real orchestrator later.",
            }
        ),
    )
    db.add(sandbox)
    await db.commit()
    await db.refresh(sandbox)

    # Append a simple audit event.
    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=current_user.id,
                user_email=current_user.email,
                action="PROVISION_SANDBOX",
                resource_type="sandbox",
                resource_id=str(sandbox.id),
                details=f"Sandbox provisioned with external_id={sandbox.external_id}",
            )
        )
        await session.commit()

    return sandbox


@router.post("/reset", response_model=schemas.SandboxEnvironment)
async def reset_sandbox_environment(
    db: DBSession,
    current_user: CurrentUser,
):
    """Reset the logical sandbox record to a healthy / ready state.

    In a future version this will call the external orchestrator (via n8n or a
    dedicated service) to actually tear down and recreate lab VMs. For now, we
    just ensure the record exists and mark it as ready.
    """
    await require_permission(current_user, Permission.SETTINGS_UPDATE, db)

    org_id = require_org_id(current_user)

    result = await db.execute(
        select(models.SandboxEnvironment).where(
            models.SandboxEnvironment.organization_id == org_id
        )
    )
    sandbox = result.scalar_one_or_none()
    if not sandbox:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No sandbox environment exists to reset for this organisation.",
        )

    sandbox.status = "ready"
    db.add(sandbox)
    await db.commit()
    await db.refresh(sandbox)

    async with async_sessionmaker() as session:
        session.add(
            models.AuditEvent(
                user_id=current_user.id,
                user_email=current_user.email,
                action="RESET_SANDBOX",
                resource_type="sandbox",
                resource_id=str(sandbox.id),
                details="Sandbox status reset to ready.",
            )
        )
        await session.commit()

    return sandbox



