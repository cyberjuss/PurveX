from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..config import settings
from ..db import get_db
from ..utils.tenant import require_org_id
from .auth import get_current_user

router = APIRouter(prefix="/onboarding", tags=["onboarding"])

DBSession = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[models.User, Depends(get_current_user)]


class OnboardingStep(BaseModel):
    id: str
    title: str
    description: str
    completed: bool
    href: str
    status: Literal["complete", "action_required", "blocked"]
    recovery_hint: str | None = None


class OnboardingStatus(BaseModel):
    completed: bool
    progress: int  # 0..100
    steps: list[OnboardingStep]


async def _count(db: AsyncSession, model, org_id: int) -> int:
    result = await db.execute(
        select(func.count()).select_from(model).where(model.organization_id == org_id)
    )
    return int(result.scalar() or 0)


def _atomic_data_dir() -> Path:
    configured = getattr(settings, "ATOMIC_DATA_DIR", "") or ""
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".purvex" / "atomic-red-team"


def _atomic_catalog_installed() -> bool:
    atomic_root = _atomic_data_dir() / "atomics"
    return atomic_root.exists() and atomic_root.is_dir()


def _status(completed: bool, blocked: bool = False) -> Literal["complete", "action_required", "blocked"]:
    if completed:
        return "complete"
    return "blocked" if blocked else "action_required"


@router.get("/status", response_model=OnboardingStatus)
async def get_onboarding_status(db: DBSession, current_user: CurrentUser) -> OnboardingStatus:
    """Return per-step completion for the first-run onboarding wizard."""
    org_id = require_org_id(current_user)

    siem_count = await _count(db, models.SIEMConnection, org_id)
    endpoint_count = await _count(db, models.EnvironmentRunnerConfig, org_id)
    detection_count = await _count(db, models.Detection, org_id)
    test_count = await _count(db, models.Test, org_id)
    atomic_catalog_ready = _atomic_catalog_installed()

    steps = [
        OnboardingStep(
            id="connect_siem",
            title="Connect a SIEM",
            description="Link Splunk, Elastic, or Microsoft Sentinel so PurveX can validate detections against your live telemetry.",
            completed=siem_count > 0,
            href="/settings/siem",
            status=_status(siem_count > 0),
            recovery_hint="Add a SIEM connection and run the built-in connection test.",
        ),
        OnboardingStep(
            id="install_atomic_catalog",
            title="Install the Atomic catalog",
            description="Load Atomic Red Team tests so MITRE techniques can show executable validation scenarios.",
            completed=atomic_catalog_ready,
            href="/tests/explore/T1010",
            status=_status(atomic_catalog_ready),
            recovery_hint=f"Download the Atomic catalog from the technique detail page or place it at {_atomic_data_dir()}.",
        ),
        OnboardingStep(
            id="register_endpoint",
            title="Register a test endpoint",
            description="Add at least one lab endpoint with the PurveX atomic runner installed.",
            completed=endpoint_count > 0,
            href="/endpoints",
            status=_status(endpoint_count > 0),
            recovery_hint="Install an agent from Test Runner settings and wait for the first check-in.",
        ),
        OnboardingStep(
            id="import_detection",
            title="Import or author a detection",
            description="Sync detections from your SIEM or create one manually to start validating coverage.",
            completed=detection_count > 0,
            href="/detections",
            status=_status(detection_count > 0, blocked=siem_count == 0),
            recovery_hint=(
                "Connect a SIEM first, then sync or create a detection."
                if siem_count == 0
                else "Create a detection or sync rules from a connected SIEM."
            ),
        ),
        OnboardingStep(
            id="run_first_test",
            title="Run your first validation test",
            description="Fire an atomic technique and confirm your detections trigger end-to-end.",
            completed=test_count > 0,
            href="/run-test",
            status=_status(
                test_count > 0,
                blocked=siem_count == 0 or endpoint_count == 0 or detection_count == 0 or not atomic_catalog_ready,
            ),
            recovery_hint=(
                "Complete the SIEM, Atomic catalog, endpoint, and detection steps before running a validation."
            ),
        ),
    ]

    done = sum(1 for s in steps if s.completed)
    progress = int(round((done / len(steps)) * 100)) if steps else 100

    return OnboardingStatus(
        completed=done == len(steps),
        progress=progress,
        steps=steps,
    )
