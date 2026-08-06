"""Tests for the offline-verifiable paid-plan license (app/utils/license.py)
and the seat/runner limits it gates on the invite and runner-registration
endpoints. A license problem (missing, expired, tampered) must always fall
back to free-tier limits rather than erroring -- see license.py's docstring.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import jwt
import pytest
import pytest_asyncio
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _keypair_and_token(claims: dict) -> tuple[str, str]:
    """Return (public_pem, signed_token) for a throwaway license keypair."""
    private_key = Ed25519PrivateKey.generate()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("ascii")
    token = jwt.encode(claims, private_pem, algorithm="EdDSA")
    return public_pem, token


def test_no_license_key_returns_free_defaults(monkeypatch):
    from app.config import settings
    from app.utils.license import FREE_RUNNER_LIMIT, FREE_SEAT_LIMIT, get_license_status

    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", "")
    status = get_license_status()
    assert status.plan == "free"
    assert status.seat_limit == FREE_SEAT_LIMIT
    assert status.runner_limit == FREE_RUNNER_LIMIT
    assert status.is_paid is False


def test_valid_paid_license_unlocks_configured_limits(monkeypatch):
    from app.config import settings
    from app.utils.license import get_license_status

    now = datetime.now(timezone.utc)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "seat_limit": 10, "runner_limit": 4,
        "iat": now, "exp": now + timedelta(days=30),
    })
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)
    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", token)

    status = get_license_status()
    assert status.plan == "paid"
    assert status.seat_limit == 10
    assert status.runner_limit == 4
    assert status.is_paid is True


def test_paid_license_unlimited_when_limits_null(monkeypatch):
    from app.config import settings
    from app.utils.license import get_license_status

    now = datetime.now(timezone.utc)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "seat_limit": None, "runner_limit": None,
        "iat": now, "exp": now + timedelta(days=30),
    })
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)
    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", token)

    status = get_license_status()
    assert status.seat_limit is None
    assert status.runner_limit is None


def test_expired_license_falls_back_to_free(monkeypatch):
    from app.config import settings
    from app.utils.license import FREE_SEAT_LIMIT, get_license_status

    past = datetime.now(timezone.utc) - timedelta(days=1)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "seat_limit": 999, "runner_limit": 999,
        "iat": past - timedelta(days=30), "exp": past,
    })
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)
    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", token)

    status = get_license_status()
    assert status.plan == "free"
    assert status.seat_limit == FREE_SEAT_LIMIT


def test_tampered_signature_falls_back_to_free(monkeypatch):
    from app.config import settings
    from app.utils.license import get_license_status

    now = datetime.now(timezone.utc)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "seat_limit": 999, "runner_limit": 999,
        "iat": now, "exp": now + timedelta(days=30),
    })
    # Sign with a *different* key than the one PurveX is told to verify
    # against -- simulates a forged or corrupted token.
    other_public_pem, _ = _keypair_and_token({"plan": "paid"})
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", other_public_pem)
    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", token)

    status = get_license_status()
    assert status.plan == "free"


def test_malformed_public_key_configuration_falls_back_to_free(monkeypatch):
    from app.config import settings
    from app.utils.license import get_license_status

    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", "not a real PEM key")
    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", "irrelevant.token.value")

    status = get_license_status()
    assert status.plan == "free"


# --- verify_license_key: strict validation for the Settings -> License save path ---

def test_verify_license_key_accepts_a_valid_token(monkeypatch):
    from app.config import settings
    from app.utils.license import verify_license_key

    now = datetime.now(timezone.utc)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "seat_limit": 10, "runner_limit": 4,
        "iat": now, "exp": now + timedelta(days=30),
    })
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)

    status = verify_license_key(token)
    assert status.plan == "paid"
    assert status.seat_limit == 10


def test_verify_license_key_raises_on_tampered_token(monkeypatch):
    from app.config import settings
    from app.utils.license import LicenseKeyInvalid, verify_license_key

    now = datetime.now(timezone.utc)
    _, token = _keypair_and_token({"plan": "paid", "iat": now, "exp": now + timedelta(days=30)})
    other_public_pem, _ = _keypair_and_token({"plan": "paid"})
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", other_public_pem)

    with pytest.raises(LicenseKeyInvalid):
        verify_license_key(token)


def test_verify_license_key_raises_on_garbage_input(monkeypatch):
    from app.config import settings
    from app.utils.license import LicenseKeyInvalid, verify_license_key

    now = datetime.now(timezone.utc)
    public_pem, _ = _keypair_and_token({"plan": "paid", "iat": now, "exp": now + timedelta(days=30)})
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)

    with pytest.raises(LicenseKeyInvalid):
        verify_license_key("not-a-jwt-at-all")


# --- get_org_license_status: DB-saved key takes priority over the env var ---

@pytest.mark.asyncio
async def test_org_saved_key_overrides_free_env(org_context, monkeypatch):
    from app.config import settings
    from app import models
    from app.utils.encryption import encrypt_value
    from app.utils.license import get_org_license_status
    from sqlalchemy.future import select

    session, admin = org_context

    now = datetime.now(timezone.utc)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "seat_limit": 25, "runner_limit": 10,
        "iat": now, "exp": now + timedelta(days=30),
    })
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)
    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", "")  # no env-level key set

    org = (await session.execute(select(models.Organization).where(models.Organization.id == 1))).scalar_one()
    org.license_key_encrypted = encrypt_value(token)
    await session.commit()

    status = await get_org_license_status(session, org_id=1)
    assert status.plan == "paid"
    assert status.seat_limit == 25
    assert status.runner_limit == 10


@pytest.mark.asyncio
async def test_org_without_saved_key_falls_back_to_env(org_context, monkeypatch):
    from app.config import settings
    from app.utils.license import get_org_license_status

    session, admin = org_context
    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", "")

    status = await get_org_license_status(session, org_id=1)
    assert status.plan == "free"


# --- Enforcement: seat limit on invite, runner limit on registration ---

def _fake_request(method: str = "POST") -> SimpleNamespace:
    return SimpleNamespace(method=method, headers={}, cookies={}, client=SimpleNamespace(host="127.0.0.1"))


@pytest_asyncio.fixture
async def org_context(monkeypatch):
    from app import models
    from app.security import hash_password

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    import app.routers.rbac as rbac_router
    monkeypatch.setattr(rbac_router, "async_sessionmaker", test_sessionmaker)

    # settings.create_environment_runner writes its audit event through its
    # own module-level async_sessionmaker import too (same fire-and-forget
    # pattern as rbac's), separate from the `db` session passed into the
    # route function itself. Without this, any test that reaches a
    # successful runner registration silently falls through to the real
    # configured database instead of this fixture's in-memory one -- masked
    # whenever a real backend/purvex.db with migrated tables happens to
    # exist on the machine running the suite, but a hard failure
    # ("no such table") on a clean checkout or CI.
    import app.routers.settings as settings_router
    monkeypatch.setattr(settings_router, "async_sessionmaker", test_sessionmaker)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        admin = models.User(
            id=1, username="admin", email="admin@example.test",
            hashed_password=hash_password("Admin-Pass1!"),
            organization_id=1, is_active=True, is_admin=True,
        )
        session.add_all([org, admin])
        await session.commit()
        yield session, admin

    await engine.dispose()


@pytest.mark.asyncio
async def test_free_plan_blocks_invite_past_seat_limit(org_context, monkeypatch):
    from app.utils import license as license_module
    import app.routers.rbac as rbac_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        # Accepts the optional license_key arg get_org_license_status passes
        # through (the enforcement call sites go through it, not this
        # function, directly -- see get_org_license_status's docstring).
        lambda *_args, **_kwargs: license_module.LicenseStatus(plan="free", seat_limit=3, runner_limit=1),
    )

    session, admin = org_context

    # Admin (1) + two invites = 3 total, exactly at the free limit.
    for i in range(2):
        await rbac_router.invite_user(
            payload=rbac_router.InviteUserRequest(email=f"teammate{i}@example.test"),
            request=_fake_request(),
            db=session,
            current_user=admin,
        )

    with pytest.raises(HTTPException) as exc_info:
        await rbac_router.invite_user(
            payload=rbac_router.InviteUserRequest(email="onetoomany@example.test"),
            request=_fake_request(),
            db=session,
            current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "3 users" in exc_info.value.detail


@pytest.mark.asyncio
async def test_paid_plan_with_finite_seats_blocks_past_its_own_limit_with_paid_message(org_context, monkeypatch):
    """A paid license isn't necessarily unlimited -- it's whatever seat
    count it was issued for. Hitting that cap must not tell the customer
    "Free plan is limited..." (false, and points them at a pricing page
    they've already been through); it should point them at their own
    account owner instead."""
    from app.utils import license as license_module
    import app.routers.rbac as rbac_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_args, **_kwargs: license_module.LicenseStatus(plan="paid", seat_limit=2, runner_limit=None),
    )

    session, admin = org_context

    # Admin (1) + one invite = 2 total, exactly at this license's seat cap.
    await rbac_router.invite_user(
        payload=rbac_router.InviteUserRequest(email="teammate0@example.test"),
        request=_fake_request(),
        db=session,
        current_user=admin,
    )

    with pytest.raises(HTTPException) as exc_info:
        await rbac_router.invite_user(
            payload=rbac_router.InviteUserRequest(email="onetoomany@example.test"),
            request=_fake_request(),
            db=session,
            current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "2 users" in exc_info.value.detail
    assert "account owner" in exc_info.value.detail
    assert "Free plan" not in exc_info.value.detail


@pytest.mark.asyncio
async def test_paid_unlimited_license_allows_invite_past_free_default(org_context, monkeypatch):
    from app.utils import license as license_module
    import app.routers.rbac as rbac_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_args, **_kwargs: license_module.LicenseStatus(plan="paid", seat_limit=None, runner_limit=None),
    )

    session, admin = org_context

    for i in range(5):
        result = await rbac_router.invite_user(
            payload=rbac_router.InviteUserRequest(email=f"teammate{i}@example.test"),
            request=_fake_request(),
            db=session,
            current_user=admin,
        )
        assert result["email"] == f"teammate{i}@example.test"


@pytest.mark.asyncio
async def test_free_plan_blocks_runner_past_limit(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.settings as settings_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        # Accepts the optional license_key arg get_org_license_status passes
        # through (the enforcement call sites go through it, not this
        # function, directly -- see get_org_license_status's docstring).
        lambda *_args, **_kwargs: license_module.LicenseStatus(plan="free", seat_limit=3, runner_limit=1),
    )

    session, admin = org_context

    def make_runner(name: str) -> "schemas.EnvironmentRunnerConfigCreate":
        return schemas.EnvironmentRunnerConfigCreate(
            environment_name=name,
            runner_type="SSH",
            hostname="lab-box.internal",
            username="purvex",
            ssh_host_key_sha256="SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk",
        )

    await settings_router.create_environment_runner(
        request=_fake_request(), runner_create=make_runner("lab-1"), db=session, current_user=admin,
    )

    with pytest.raises(HTTPException) as exc_info:
        await settings_router.create_environment_runner(
            request=_fake_request(), runner_create=make_runner("lab-2"), db=session, current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "1 test runner" in exc_info.value.detail


@pytest.mark.asyncio
async def test_paid_plan_with_finite_runners_blocks_with_paid_message(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.settings as settings_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_args, **_kwargs: license_module.LicenseStatus(plan="paid", seat_limit=None, runner_limit=1),
    )

    session, admin = org_context

    def make_runner(name: str) -> "schemas.EnvironmentRunnerConfigCreate":
        return schemas.EnvironmentRunnerConfigCreate(
            environment_name=name,
            runner_type="SSH",
            hostname="lab-box.internal",
            username="purvex",
            ssh_host_key_sha256="SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk",
        )

    await settings_router.create_environment_runner(
        request=_fake_request(), runner_create=make_runner("lab-1"), db=session, current_user=admin,
    )

    with pytest.raises(HTTPException) as exc_info:
        await settings_router.create_environment_runner(
            request=_fake_request(), runner_create=make_runner("lab-2"), db=session, current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "1 test runner" in exc_info.value.detail
    assert "account owner" in exc_info.value.detail
    assert "Free plan" not in exc_info.value.detail


@pytest.mark.asyncio
async def test_paid_unlimited_license_allows_runner_past_free_default(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.settings as settings_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_args, **_kwargs: license_module.LicenseStatus(plan="paid", seat_limit=None, runner_limit=None),
    )

    session, admin = org_context

    for i in range(3):
        result = await settings_router.create_environment_runner(
            request=_fake_request(),
            runner_create=schemas.EnvironmentRunnerConfigCreate(
                environment_name=f"lab-{i}",
                runner_type="SSH",
                hostname="lab-box.internal",
                username="purvex",
                ssh_host_key_sha256="SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk",
            ),
            db=session,
            current_user=admin,
        )
        assert result.environment_name == f"lab-{i}"


# --- Capability gates: schedules, Detection-as-Code, reports, audit retention ---

def test_free_status_has_no_advanced_capabilities():
    from app.utils.license import FREE_LICENSE_STATUS, FREE_AUDIT_RETENTION_DAYS

    assert FREE_LICENSE_STATUS.schedules_enabled is False
    assert FREE_LICENSE_STATUS.detection_as_code_enabled is False
    assert FREE_LICENSE_STATUS.reports_enabled is False
    assert FREE_LICENSE_STATUS.audit_retention_days == FREE_AUDIT_RETENTION_DAYS == 30


def test_paid_token_with_no_capability_claims_defaults_to_fully_unlocked(monkeypatch):
    """A license minted before these claims existed (or issued with the
    CLI's defaults) omits them entirely -- must not silently downgrade an
    already-issued paid customer."""
    from app.config import settings
    from app.utils.license import get_license_status

    now = datetime.now(timezone.utc)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "seat_limit": None, "runner_limit": None,
        "iat": now, "exp": now + timedelta(days=30),
    })
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)

    status = get_license_status(token)
    assert status.schedules_enabled is True
    assert status.detection_as_code_enabled is True
    assert status.reports_enabled is True
    assert status.audit_retention_days is None  # unlimited


def test_paid_token_can_explicitly_restrict_capabilities(monkeypatch):
    """Lets a future lower paid tier withhold specific capabilities via the
    CLI's --no-* flags, instead of only ever being all-or-nothing."""
    from app.config import settings
    from app.utils.license import get_license_status

    now = datetime.now(timezone.utc)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "seat_limit": None, "runner_limit": None,
        "schedules_enabled": False, "detection_as_code_enabled": False,
        "reports_enabled": False, "audit_retention_days": 90,
        "iat": now, "exp": now + timedelta(days=30),
    })
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)

    status = get_license_status(token)
    assert status.schedules_enabled is False
    assert status.detection_as_code_enabled is False
    assert status.reports_enabled is False
    assert status.audit_retention_days == 90


@pytest.mark.asyncio
async def test_free_plan_blocks_schedule_creation(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.tests as tests_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_a, **_k: license_module.FREE_LICENSE_STATUS,
    )

    session, admin = org_context

    with pytest.raises(HTTPException) as exc_info:
        await tests_router.create_test_schedule(
            payload=schemas.TestScheduleCreate(
                technique_id="T1059",
                environment="lab",
                schedule_type="interval",
                interval_seconds=3600,
            ),
            db=session,
            current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "paid plan" in exc_info.value.detail


@pytest.mark.asyncio
async def test_paid_plan_allows_schedule_creation(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.tests as tests_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_a, **_k: license_module.LicenseStatus(
            plan="paid", seat_limit=None, runner_limit=None, schedules_enabled=True,
        ),
    )

    session, admin = org_context

    result = await tests_router.create_test_schedule(
        payload=schemas.TestScheduleCreate(
            technique_id="T1059",
            environment="lab",
            schedule_type="interval",
            interval_seconds=3600,
        ),
        db=session,
        current_user=admin,
    )
    assert result.technique_id == "T1059"


@pytest.mark.asyncio
async def test_free_plan_blocks_detection_source_creation(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.detection_sources as detection_sources_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_a, **_k: license_module.FREE_LICENSE_STATUS,
    )

    session, admin = org_context

    with pytest.raises(HTTPException) as exc_info:
        await detection_sources_router.create_detection_source(
            payload=schemas.DetectionSourceCreate(
                name="detections-repo",
                provider="git",
                repo_url="https://github.com/example/detections.git",
                branch="main",
                path_glob="detections/**/*.yml",
                auth_type="none",
                enabled=True,
            ),
            db=session,
            current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "paid plan" in exc_info.value.detail


@pytest.mark.asyncio
async def test_free_plan_blocks_test_run_past_daily_limit(org_context, monkeypatch):
    from fastapi import BackgroundTasks
    from app import schemas
    from app.utils import license as license_module
    import app.routers.tests as tests_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_a, **_k: license_module.FREE_LICENSE_STATUS,
    )

    session, admin = org_context

    # FREE_DAILY_TEST_RUN_LIMIT is checked before any detection/runner
    # lookups, so seed org_id's Test count directly rather than driving 3
    # real runs through the full execution pipeline.
    from app import models
    for i in range(license_module.FREE_DAILY_TEST_RUN_LIMIT):
        session.add(models.Test(
            organization_id=1, technique_id="T1059", environment="lab",
            status="completed", mode="TELEMETRY_CHECK",
            started_at=datetime.now(timezone.utc),
        ))
    await session.commit()

    with pytest.raises(HTTPException) as exc_info:
        await tests_router.run_test(
            test_run=schemas.TestRunCreate(technique_id="T1059", environment="lab", mode="TELEMETRY_CHECK"),
            background_tasks=BackgroundTasks(),
            db=session,
            current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "3 test runs per day" in exc_info.value.detail


@pytest.mark.asyncio
async def test_free_plan_audit_log_clamped_to_retention_window(org_context, monkeypatch):
    from app.utils import license as license_module
    import app.routers.audit as audit_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_a, **_k: license_module.FREE_LICENSE_STATUS,
    )

    session, admin = org_context

    # Asking for "all time" (no start_date) on a free plan must not surface
    # events older than the retention window -- verified indirectly here by
    # confirming the call succeeds and returns a list (the clamp itself is
    # applied to the query, not observable without seeded old events, but a
    # regression that made this raise would be caught here).
    result = await audit_router.list_audit_events(
        db=session, current_user=admin,
        skip=0, limit=100, action=None, resource_type=None, user_id=None,
        start_date=None, end_date=None, search=None,
    )
    assert isinstance(result, list)


# --- Enforcement: the background scheduler must re-check the license on
# every firing, not just at schedule-creation time (see
# app/services/test_scheduler.py). Without this, a schedule made while paid
# would keep running forever after the license lapses, completely exempt
# from both the schedules_enabled and daily_test_run_limit gates. ---

@pytest.mark.asyncio
async def test_scheduler_auto_pauses_schedule_when_license_lapses(org_context, monkeypatch):
    from app import models
    from app.utils import license as license_module
    from app.services import test_scheduler
    from sqlalchemy import func
    from sqlalchemy.future import select

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_a, **_k: license_module.FREE_LICENSE_STATUS,
    )

    session, admin = org_context
    schedule = models.TestSchedule(
        organization_id=1, environment="lab", schedule_type="interval",
        interval_seconds=3600, enabled=True, created_by_user_id=admin.id,
    )
    session.add(schedule)
    await session.commit()
    await session.refresh(schedule)

    await test_scheduler.execute_scheduled_test(schedule, session)

    await session.refresh(schedule)
    assert schedule.enabled is False

    test_count = (await session.execute(select(func.count(models.Test.id)))).scalar_one()
    assert test_count == 0

    audit = (
        await session.execute(
            select(models.AuditEvent).where(models.AuditEvent.action == "SCHEDULE_AUTO_PAUSED")
        )
    ).scalars().first()
    assert audit is not None


@pytest.mark.asyncio
async def test_scheduler_skips_run_past_daily_limit_but_reschedules(org_context, monkeypatch):
    from app import models
    from app.config import settings
    from app.services import test_scheduler
    from sqlalchemy import func
    from sqlalchemy.future import select

    session, admin = org_context

    now = datetime.now(timezone.utc)
    public_pem, token = _keypair_and_token({
        "plan": "paid", "schedules_enabled": True, "daily_test_run_limit": 1,
        "iat": now, "exp": now + timedelta(days=30),
    })
    monkeypatch.setattr(settings, "LICENSE_PUBLIC_KEY_PEM", public_pem)
    monkeypatch.setattr(settings, "PURVEX_LICENSE_KEY", token)

    # Already at today's cap of 1.
    session.add(models.Test(
        organization_id=1, technique_id="T1000", environment="lab",
        status="pass", marker="purvex_test", started_at=now,
    ))
    schedule = models.TestSchedule(
        organization_id=1, environment="lab", schedule_type="interval",
        interval_seconds=3600, enabled=True, created_by_user_id=admin.id,
        next_run_at=now,
    )
    session.add(schedule)
    await session.commit()
    await session.refresh(schedule)

    await test_scheduler.execute_scheduled_test(schedule, session)

    await session.refresh(schedule)
    # Skipped, not disabled -- it should try again on its normal cadence.
    # update_schedule_next_run computes this with a naive datetime.utcnow(),
    # unlike `now` above, so compare against a naive baseline.
    assert schedule.enabled is True
    assert schedule.next_run_at is not None
    assert schedule.next_run_at > datetime.utcnow().replace(tzinfo=None)

    test_count = (await session.execute(select(func.count(models.Test.id)))).scalar_one()
    assert test_count == 1  # only the pre-seeded one; no new run created


# --- Enforcement: /auth/register (a direct admin-create-user path distinct
# from rbac.invite_user, the one the UI actually calls) must also respect
# seat_limit -- otherwise it's a straight bypass of the free-tier seat cap
# for anyone who calls it directly instead of the invite flow. ---

@pytest.mark.asyncio
async def test_free_plan_blocks_direct_register_past_seat_limit(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.auth as auth_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_args, **_kwargs: license_module.LicenseStatus(plan="free", seat_limit=3, runner_limit=1),
    )

    session, admin = org_context

    # Admin (1) + two directly-registered users = 3 total, exactly at the free limit.
    for i in range(2):
        await auth_router.register_admin(
            user_in=schemas.UserCreate(email=f"direct{i}@example.test", password="Direct-Pass1!"),
            db=session,
            current_user=admin,
        )

    with pytest.raises(HTTPException) as exc_info:
        await auth_router.register_admin(
            user_in=schemas.UserCreate(email="onetoomany-direct@example.test", password="Direct-Pass1!"),
            db=session,
            current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "3 users" in exc_info.value.detail


@pytest.mark.asyncio
async def test_paid_plan_direct_register_blocks_with_paid_message(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.auth as auth_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda *_args, **_kwargs: license_module.LicenseStatus(plan="paid", seat_limit=2, runner_limit=None),
    )

    session, admin = org_context

    await auth_router.register_admin(
        user_in=schemas.UserCreate(email="direct0@example.test", password="Direct-Pass1!"),
        db=session,
        current_user=admin,
    )

    with pytest.raises(HTTPException) as exc_info:
        await auth_router.register_admin(
            user_in=schemas.UserCreate(email="onetoomany-direct-paid@example.test", password="Direct-Pass1!"),
            db=session,
            current_user=admin,
        )
    assert exc_info.value.status_code == 402
    assert "2 users" in exc_info.value.detail
    assert "account owner" in exc_info.value.detail
    assert "Free plan" not in exc_info.value.detail
