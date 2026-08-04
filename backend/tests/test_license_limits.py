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
        lambda: license_module.LicenseStatus(plan="free", seat_limit=3, runner_limit=1),
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
    assert exc_info.value.status_code == 403
    assert "3 users" in exc_info.value.detail


@pytest.mark.asyncio
async def test_paid_unlimited_license_allows_invite_past_free_default(org_context, monkeypatch):
    from app.utils import license as license_module
    import app.routers.rbac as rbac_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda: license_module.LicenseStatus(plan="paid", seat_limit=None, runner_limit=None),
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
        lambda: license_module.LicenseStatus(plan="free", seat_limit=3, runner_limit=1),
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
    assert exc_info.value.status_code == 403
    assert "1 test runner" in exc_info.value.detail


@pytest.mark.asyncio
async def test_paid_unlimited_license_allows_runner_past_free_default(org_context, monkeypatch):
    from app import schemas
    from app.utils import license as license_module
    import app.routers.settings as settings_router

    monkeypatch.setattr(
        license_module, "get_license_status",
        lambda: license_module.LicenseStatus(plan="paid", seat_limit=None, runner_limit=None),
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
