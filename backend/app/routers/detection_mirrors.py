"""Detection Git audit mirror API.

Routes
------
* ``GET    /detection-mirrors``                            — list all mirrors in the caller's org
* ``POST   /detection-mirrors``                            — create a mirror
* ``GET    /detection-mirrors/{id}``                       — fetch one
* ``PATCH  /detection-mirrors/{id}``                       — edit config (incl. rotate ``auth_secret``)
* ``DELETE /detection-mirrors/{id}``                       — remove (detaches any linked SIEM connections)
* ``POST   /detection-mirrors/{id}/bootstrap``             — one-time full export from a specific SIEM connection
* ``POST   /detection-mirrors/{id}/link-siem/{siem_id}``   — attach mirror to a SIEM connection
* ``POST   /detection-mirrors/{id}/unlink-siem/{siem_id}`` — detach

Access model
------------
Read uses ``SETTINGS_READ``; write / bootstrap / link use
``SETTINGS_SIEM_MANAGE`` (same rationale as ``detection_sources``: an
outbound integration with credentials).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..db import get_db
from ..routers.auth import get_current_user
from ..services import git_writeback
from ..utils.authz import Permission, require_permission
from ..utils.encryption import encrypt_value
from ..utils.endpoint_rate_limit import endpoint_rate_limit
from ..utils.tenant import require_org_id

router = APIRouter(
    prefix="/detection-mirrors",
    tags=["detection-mirrors"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _to_out(mirror: models.DetectionGitMirror) -> schemas.DetectionGitMirror:
    return schemas.DetectionGitMirror(
        id=mirror.id,
        organization_id=mirror.organization_id,
        name=mirror.name,
        repo_url=mirror.repo_url,
        branch=mirror.branch,
        path_template=mirror.path_template,
        commit_author_name=mirror.commit_author_name,
        commit_author_email=mirror.commit_author_email,
        write_mode=mirror.write_mode,
        auth_type=mirror.auth_type,
        enabled=mirror.enabled,
        has_auth_secret=bool(mirror.auth_secret),
        last_mirrored_at=mirror.last_mirrored_at,
        last_mirror_status=mirror.last_mirror_status,
        last_mirror_error=mirror.last_mirror_error,
        last_commit_sha=mirror.last_commit_sha,
        last_commits_count=mirror.last_commits_count or 0,
        last_files_written=mirror.last_files_written or 0,
        created_at=mirror.created_at or datetime.now(timezone.utc),
    )


async def _get_or_404(
    db: AsyncSession, mirror_id: int, org_id: int
) -> models.DetectionGitMirror:
    result = await db.execute(
        select(models.DetectionGitMirror).where(
            models.DetectionGitMirror.id == mirror_id,
            models.DetectionGitMirror.organization_id == org_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Mirror not found")
    return row


async def _get_connection_or_404(
    db: AsyncSession, connection_id: int, org_id: int
) -> models.SIEMConnection:
    result = await db.execute(
        select(models.SIEMConnection).where(
            models.SIEMConnection.id == connection_id,
            models.SIEMConnection.organization_id == org_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="SIEM connection not found")
    return row


async def _audit(
    db: AsyncSession,
    user: models.User,
    action: str,
    mirror: models.DetectionGitMirror,
    *,
    details: str | None = None,
) -> None:
    db.add(
        models.AuditEvent(
            user_id=user.id,
            user_email=user.email,
            action=action,
            resource_type="detection_git_mirror",
            resource_id=str(mirror.id),
            details=details or mirror.name,
        )
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("", response_model=List[schemas.DetectionGitMirror])
async def list_detection_mirrors(
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.SETTINGS_READ, db)
    org_id = require_org_id(current_user)
    res = await db.execute(
        select(models.DetectionGitMirror)
        .where(models.DetectionGitMirror.organization_id == org_id)
        .order_by(models.DetectionGitMirror.created_at.desc())
    )
    return [_to_out(m) for m in res.scalars().all()]


@router.post(
    "",
    response_model=schemas.DetectionGitMirror,
    status_code=status.HTTP_201_CREATED,
)
async def create_detection_mirror(
    payload: schemas.DetectionGitMirrorCreate,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(
            max_requests=30, window_seconds=60, key_prefix="dac-mirror:create"
        )
    ),
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    org_id = require_org_id(current_user)

    from ..utils.license import get_org_license_status
    license_status = await get_org_license_status(db, org_id)
    if not license_status.detection_as_code_enabled:
        raise HTTPException(
            status_code=403,
            detail="Detection-as-Code (git mirrors) requires a paid plan. Upgrade at purvex-llc.com/pricing.",
        )

    secret = payload.auth_secret or None
    if payload.auth_type == "token" and not secret:
        raise HTTPException(
            status_code=400,
            detail="auth_secret is required when auth_type is 'token'",
        )
    if payload.auth_type == "none":
        secret = None

    row = models.DetectionGitMirror(
        organization_id=org_id,
        name=payload.name,
        repo_url=payload.repo_url,
        branch=payload.branch,
        path_template=payload.path_template,
        commit_author_name=payload.commit_author_name,
        commit_author_email=payload.commit_author_email,
        write_mode=payload.write_mode,
        auth_type=payload.auth_type,
        auth_secret=encrypt_value(secret) if secret else None,
        enabled=payload.enabled,
    )
    db.add(row)
    await db.flush()
    await _audit(db, current_user, "DETECTION_MIRROR_CREATED", row)
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.get("/{mirror_id}", response_model=schemas.DetectionGitMirror)
async def get_detection_mirror(
    mirror_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.SETTINGS_READ, db)
    org_id = require_org_id(current_user)
    row = await _get_or_404(db, mirror_id, org_id)
    return _to_out(row)


@router.patch("/{mirror_id}", response_model=schemas.DetectionGitMirror)
async def update_detection_mirror(
    mirror_id: int,
    payload: schemas.DetectionGitMirrorUpdate,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(
            max_requests=30, window_seconds=60, key_prefix="dac-mirror:update"
        )
    ),
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    org_id = require_org_id(current_user)
    row = await _get_or_404(db, mirror_id, org_id)

    data = payload.model_dump(exclude_unset=True)
    if "auth_secret" in data:
        secret = data.pop("auth_secret")
        if secret is None or secret == "":
            row.auth_secret = None
        else:
            row.auth_secret = encrypt_value(secret)
    for key, value in data.items():
        setattr(row, key, value)
    if row.auth_type == "none":
        row.auth_secret = None
    row.updated_at = datetime.now(timezone.utc)
    await _audit(db, current_user, "DETECTION_MIRROR_UPDATED", row)
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.delete("/{mirror_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detection_mirror(
    mirror_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    org_id = require_org_id(current_user)
    row = await _get_or_404(db, mirror_id, org_id)

    # Detach any SIEM connections that point at this mirror so they
    # don't carry a dangling FK after the row is gone.
    await db.execute(
        models.SIEMConnection.__table__.update()
        .where(models.SIEMConnection.audit_mirror_id == row.id)
        .values(audit_mirror_id=None, audit_mirror_enabled=False)
    )
    await _audit(db, current_user, "DETECTION_MIRROR_DELETED", row)
    await db.delete(row)
    await db.commit()
    return


# ---------------------------------------------------------------------------
# Link a mirror to a SIEM connection
# ---------------------------------------------------------------------------
@router.post(
    "/{mirror_id}/link-siem/{siem_id}",
    response_model=schemas.DetectionGitMirror,
)
async def link_siem_connection(
    mirror_id: int,
    siem_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    org_id = require_org_id(current_user)
    mirror = await _get_or_404(db, mirror_id, org_id)
    conn = await _get_connection_or_404(db, siem_id, org_id)

    conn.audit_mirror_id = mirror.id
    conn.audit_mirror_enabled = True
    await _audit(
        db,
        current_user,
        "DETECTION_MIRROR_LINKED",
        mirror,
        details=f"linked SIEM connection {siem_id} ({conn.name})",
    )
    await db.commit()
    await db.refresh(mirror)
    return _to_out(mirror)


@router.post(
    "/{mirror_id}/unlink-siem/{siem_id}",
    response_model=schemas.DetectionGitMirror,
)
async def unlink_siem_connection(
    mirror_id: int,
    siem_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    org_id = require_org_id(current_user)
    mirror = await _get_or_404(db, mirror_id, org_id)
    conn = await _get_connection_or_404(db, siem_id, org_id)

    if conn.audit_mirror_id == mirror.id:
        conn.audit_mirror_id = None
        conn.audit_mirror_enabled = False
    await _audit(
        db,
        current_user,
        "DETECTION_MIRROR_UNLINKED",
        mirror,
        details=f"unlinked SIEM connection {siem_id} ({conn.name})",
    )
    await db.commit()
    await db.refresh(mirror)
    return _to_out(mirror)


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
@router.post(
    "/{mirror_id}/bootstrap",
    response_model=schemas.DetectionMirrorPublishResult,
)
async def bootstrap_from_siem(
    mirror_id: int,
    siem_id: int,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(
            max_requests=5, window_seconds=60, key_prefix="dac-mirror:bootstrap"
        )
    ),
):
    """Full export: write every current ``siem_sync`` detection from
    ``siem_id`` into the mirror as one commit. Run this once when you
    first attach a mirror to a SIEM, so the audit log isn't missing
    the pre-PurveX baseline.
    """
    await require_permission(current_user, Permission.DETECTIONS_UPDATE, db)
    org_id = require_org_id(current_user)
    mirror = await _get_or_404(db, mirror_id, org_id)
    conn = await _get_connection_or_404(db, siem_id, org_id)

    outcome = await git_writeback.bootstrap_mirror(db, mirror, conn)
    await _audit(
        db,
        current_user,
        "DETECTION_MIRROR_BOOTSTRAP",
        mirror,
        details=json.dumps(
            {
                "siem_id": siem_id,
                "commit": outcome.commit_sha,
                "files_written": outcome.files_written,
                "commits": outcome.commits,
                "errors": outcome.errors[:5],
            }
        ),
    )
    await db.commit()
    return schemas.DetectionMirrorPublishResult(
        mirror_id=mirror.id,
        commit_sha=outcome.commit_sha,
        files_written=outcome.files_written,
        commits=outcome.commits,
        skipped=outcome.skipped,
        errors=outcome.errors,
    )
