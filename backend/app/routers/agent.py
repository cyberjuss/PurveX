from datetime import datetime, timezone
import hashlib

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from ..db import get_db
from .. import models, schemas
from ..services.notifications import notify

router = APIRouter(
    prefix="/agent",
    tags=["agent"],
    responses={404: {"description": "Not found"}},
)

async def get_current_runner(request: Request, db: AsyncSession) -> models.EnvironmentRunnerConfig:
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing runner token")
    token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing runner token")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    result = await db.execute(
        select(models.EnvironmentRunnerConfig).filter(
            models.EnvironmentRunnerConfig.runner_token_hash == token_hash
        )
    )
    runner = result.scalar_one_or_none()
    if not runner:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid runner token")
    now = datetime.now(timezone.utc)
    if runner.runner_token_expires_at:
        expires_at = runner.runner_token_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Runner token expired")
    return runner


@router.post("/heartbeat", response_model=schemas.EnvironmentRunnerConfig)
async def agent_heartbeat(
    heartbeat: schemas.EnvironmentRunnerHeartbeat,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    runner = await get_current_runner(request, db)
    is_first_check_in = runner.last_check_in is None
    update_data = heartbeat.model_dump(exclude_unset=True)
    if "status" not in update_data:
        update_data["status"] = "online"
    update_data["last_check_in"] = datetime.utcnow()
    for key, value in update_data.items():
        setattr(runner, key, value)
    if is_first_check_in and runner.organization_id is not None:
        await notify(
            db,
            organization_id=runner.organization_id,
            title="New validation agent connected",
            description=f"{runner.hostname or 'Runner'} ({runner.environment_name or 'unknown'})",
            action_url="/lab",
            status="success",
            source_type="runner_new",
            source_id=str(runner.id),
        )
    await db.commit()
    await db.refresh(runner)
    return runner


@router.get("/commands/next", response_model=schemas.AgentCommand | dict)
async def get_next_agent_command(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    runner = await get_current_runner(request, db)
    result = await db.execute(
        select(models.AgentCommand)
        .filter(models.AgentCommand.runner_id == runner.id)
        .filter(models.AgentCommand.status == "pending")
        .order_by(models.AgentCommand.created_at.asc())
        .limit(1)
    )
    cmd = result.scalar_one_or_none()
    if not cmd:
        return {"command": None}
    return schemas.AgentCommand.model_validate(cmd)


@router.post("/commands/{command_id}/ack", response_model=schemas.AgentCommand)
async def ack_agent_command(
    command_id: int,
    payload: schemas.AgentCommandAck,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    runner = await get_current_runner(request, db)
    result = await db.execute(
        select(models.AgentCommand)
        .filter(models.AgentCommand.id == command_id)
        .filter(models.AgentCommand.runner_id == runner.id)
    )
    cmd = result.scalar_one_or_none()
    if not cmd:
        raise HTTPException(status_code=404, detail="Command not found")
    now = datetime.utcnow()
    cmd.status = payload.status
    cmd.message = payload.message
    cmd.acknowledged_at = now
    if payload.status in ("completed", "failed", "cancelled"):
        cmd.completed_at = now
        if payload.status == "completed":
            if cmd.command_type == "STOP_AGENT":
                runner.status = "stopped"
            elif cmd.command_type == "PAUSE_AGENT":
                runner.status = "paused"
            elif cmd.command_type == "RESUME_AGENT":
                runner.status = "online"
    await db.commit()
    await db.refresh(cmd)
    return schemas.AgentCommand.model_validate(cmd)
