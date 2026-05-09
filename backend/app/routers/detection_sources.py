"""Detection-as-Code API — manage upstream git sources + trigger sync.

Routes
------
* ``GET    /detection-sources`` — list all sources for the caller's org
* ``POST   /detection-sources`` — create a new source
* ``GET    /detection-sources/{id}`` — fetch one
* ``PATCH  /detection-sources/{id}`` — edit config
* ``DELETE /detection-sources/{id}`` — remove (detections stay; they just
  lose their git link)
* ``POST   /detection-sources/{id}/sync`` — run a sync now
* ``GET    /detections/{id}/export?format=yaml`` — dump a detection as YAML

Access model
------------
* Listing / reading sources uses ``SETTINGS_READ``.
* Mutating sources (create/update/delete) uses ``SETTINGS_SIEM_MANAGE`` —
  we reuse the SIEM-management scope because the risk profile is
  identical: both hand an admin control over an outbound integration
  with credentials. A dedicated ``DAC_MANAGE`` scope can be split out
  later without an API change.
* The sync endpoint mirrors ``DETECTIONS_CREATE`` / ``DETECTIONS_UPDATE``
  since that's effectively what it does on behalf of the git source.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models, schemas
from ..db import get_db
from ..routers.auth import get_current_user
from ..services import git_sync
from ..services.proposal_policy import supersede_pending_for_source
from ..utils.authz import Permission, require_permission
from ..utils.encryption import encrypt_value
from ..utils.endpoint_rate_limit import endpoint_rate_limit
from ..utils.tenant import require_org_id

router = APIRouter(
    prefix="/detection-sources",
    tags=["detection-sources"],
    responses={404: {"description": "Not found"}},
)

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _to_out(source: models.DetectionSource) -> schemas.DetectionSource:
    return schemas.DetectionSource(
        id=source.id,
        organization_id=source.organization_id,
        name=source.name,
        provider=source.provider,
        repo_url=source.repo_url,
        branch=source.branch,
        path_glob=source.path_glob,
        auth_type=source.auth_type,
        enabled=source.enabled,
        has_auth_secret=bool(source.auth_secret),
        last_synced_at=source.last_synced_at,
        last_sync_status=source.last_sync_status,
        last_sync_error=source.last_sync_error,
        last_commit_sha=source.last_commit_sha,
        last_created_count=source.last_created_count or 0,
        last_updated_count=source.last_updated_count or 0,
        last_proposals_count=source.last_proposals_count or 0,
        last_skipped_count=source.last_skipped_count or 0,
        created_at=source.created_at or datetime.now(timezone.utc),
    )


async def _get_or_404(
    db: AsyncSession, source_id: int, org_id: int
) -> models.DetectionSource:
    result = await db.execute(
        select(models.DetectionSource).where(
            models.DetectionSource.id == source_id,
            models.DetectionSource.organization_id == org_id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Detection source not found")
    return row


# Hard cap on serialized audit details. Sync outcomes with thousands of
# files would otherwise put multi-KB JSON into every audit row and slow
# the audit list page. We already truncate the ``errors`` list upstream,
# but a long ``commit`` SHA list or a verbose status string could still
# blow past this; the truncation marker makes that visible.
_AUDIT_DETAIL_BYTE_CAP = 4096


def _cap_audit_detail(blob: str | None) -> str | None:
    if blob is None or len(blob) <= _AUDIT_DETAIL_BYTE_CAP:
        return blob
    head = blob[: _AUDIT_DETAIL_BYTE_CAP - 32]
    return head + "…[truncated]"


async def _audit(
    db: AsyncSession,
    user: models.User,
    action: str,
    source: models.DetectionSource,
    *,
    details: str | None = None,
) -> None:
    db.add(
        models.AuditEvent(
            user_id=user.id,
            user_email=user.email,
            action=action,
            resource_type="detection_source",
            resource_id=str(source.id),
            details=_cap_audit_detail(details) or source.name,
        )
    )


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
@router.get("", response_model=List[schemas.DetectionSource])
async def list_detection_sources(
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.SETTINGS_READ, db)
    org_id = require_org_id(current_user)
    res = await db.execute(
        select(models.DetectionSource)
        .where(models.DetectionSource.organization_id == org_id)
        .order_by(models.DetectionSource.created_at.desc())
    )
    return [_to_out(s) for s in res.scalars().all()]


@router.post(
    "",
    response_model=schemas.DetectionSource,
    status_code=status.HTTP_201_CREATED,
)
async def create_detection_source(
    payload: schemas.DetectionSourceCreate,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(
            max_requests=30, window_seconds=60, key_prefix="dac:create"
        )
    ),
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    org_id = require_org_id(current_user)

    secret = payload.auth_secret or None
    if payload.auth_type == "token" and not secret:
        raise HTTPException(
            status_code=400,
            detail="auth_secret is required when auth_type is 'token'",
        )
    if payload.auth_type == "none":
        # Never store a secret for a 'none' source — avoids the foot-gun
        # where a user changes auth_type back to 'none' and a stale token
        # lingers on the row.
        secret = None

    row = models.DetectionSource(
        organization_id=org_id,
        name=payload.name,
        provider=payload.provider,
        repo_url=payload.repo_url,
        branch=payload.branch,
        path_glob=payload.path_glob,
        auth_type=payload.auth_type,
        auth_secret=encrypt_value(secret) if secret else None,
        enabled=payload.enabled,
    )
    db.add(row)
    await db.flush()
    await _audit(db, current_user, "DETECTION_SOURCE_CREATED", row)
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.get("/{source_id}", response_model=schemas.DetectionSource)
async def get_detection_source(
    source_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.SETTINGS_READ, db)
    org_id = require_org_id(current_user)
    row = await _get_or_404(db, source_id, org_id)
    return _to_out(row)


@router.patch("/{source_id}", response_model=schemas.DetectionSource)
async def update_detection_source(
    source_id: int,
    payload: schemas.DetectionSourceUpdate,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(
            max_requests=30, window_seconds=60, key_prefix="dac:update"
        )
    ),
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    org_id = require_org_id(current_user)
    row = await _get_or_404(db, source_id, org_id)

    data = payload.model_dump(exclude_unset=True)
    # Handle auth_secret explicitly: empty string ⇒ clear; None/omitted ⇒ keep.
    if "auth_secret" in data:
        secret = data.pop("auth_secret")
        if secret is None or secret == "":
            row.auth_secret = None
        else:
            row.auth_secret = encrypt_value(secret)
    for key, value in data.items():
        setattr(row, key, value)
    # Invariant: auth_type=none must not keep a secret.
    if row.auth_type == "none":
        row.auth_secret = None
    row.updated_at = datetime.now(timezone.utc)
    await _audit(db, current_user, "DETECTION_SOURCE_UPDATED", row)
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_detection_source(
    source_id: int,
    db: DBSession,
    current_user: CurrentUser,
):
    await require_permission(current_user, Permission.SETTINGS_SIEM_MANAGE, db)
    org_id = require_org_id(current_user)
    row = await _get_or_404(db, source_id, org_id)

    # Supersede any pending git-authored proposals targeting detections
    # that came from this source — the inbox would otherwise show ghost
    # rows the reviewer can't act on cleanly. Must run BEFORE we null
    # out detection_source_id, since the join uses that FK.
    superseded = await supersede_pending_for_source(
        db,
        organization_id=org_id,
        detection_source_id=row.id,
    )

    # Null-out the FK on detections that came from this source so they're
    # not orphaned. We leave the rules themselves in place — the user
    # explicitly asked to forget the *source*, not the detections.
    await db.execute(
        models.Detection.__table__.update()
        .where(models.Detection.detection_source_id == row.id)
        .values(detection_source_id=None)
    )
    await _audit(
        db,
        current_user,
        "DETECTION_SOURCE_DELETED",
        row,
        details=json.dumps({"superseded_proposals": superseded}) if superseded else None,
    )
    await db.delete(row)
    await db.commit()
    return


# ---------------------------------------------------------------------------
# Sync
# ---------------------------------------------------------------------------
@router.post(
    "/{source_id}/sync",
    response_model=schemas.DetectionSourceSyncResult,
)
async def sync_detection_source(
    source_id: int,
    db: DBSession,
    current_user: CurrentUser,
    _rl: None = Depends(
        endpoint_rate_limit(
            max_requests=10, window_seconds=60, key_prefix="dac:sync"
        )
    ),
):
    # Sync may create or update Detection rows and raise Proposals — require
    # the stronger write permission. Read is implied.
    await require_permission(current_user, Permission.DETECTIONS_UPDATE, db)
    org_id = require_org_id(current_user)
    row = await _get_or_404(db, source_id, org_id)

    outcome = await git_sync.sync_detection_source(
        db,
        row,
        proposer_label=f"Detection-as-Code · {row.name}",
    )
    await _audit(
        db,
        current_user,
        "DETECTION_SOURCE_SYNC",
        row,
        details=json.dumps(
            {
                "status": row.last_sync_status,
                "commit": outcome.commit_sha,
                "created": outcome.created,
                "updated": outcome.updated,
                "proposals": outcome.proposals,
                "skipped": outcome.skipped,
                "errors": outcome.errors[:5],
            }
        ),
    )
    await db.commit()
    result = git_sync.to_api_result(row.id, outcome)
    if row.last_sync_status == "error" and not result.errors:
        result.errors = ["sync failed — see server logs"]
    return result
