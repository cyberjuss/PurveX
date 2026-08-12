"""Regression tests for the runner-provisioning gap found while auditing the
"customer downloads and runs the installer script" flow: the script could
register a runner that showed "online" in the UI but that PurveX could never
actually SSH into (no ssh_host_key_sha256, no key material anywhere but the
PurveX server's own filesystem). This closes it by minting a keypair
alongside the registration token, requiring a pinned host key for SSH
runners at registration time, and letting atomic_runner authenticate with
the runner's decrypted private key instead of a server-local key_path.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _fake_request(method: str = "POST", bearer_token: str | None = None) -> SimpleNamespace:
    # create_environment_runner reads Authorization/cookies directly off the
    # request, and require_permission's CSRF check short-circuits on empty
    # cookies -- see backend/app/utils/authz.py.
    headers = {"Authorization": f"Bearer {bearer_token}"} if bearer_token else {}
    return SimpleNamespace(method=method, headers=headers, cookies={})


@pytest_asyncio.fixture
async def runner_context():
    from app import models
    from app.security import hash_password

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

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
async def test_registration_token_mints_and_encrypts_keypair(runner_context):
    from app.routers import settings as settings_router
    from app.utils.encryption import decrypt_value

    session, admin = runner_context

    response = await settings_router.generate_agent_registration_token(
        db=session, current_user=admin,
    )

    assert response["public_key"].startswith("ssh-ed25519 ")

    from app import models
    from sqlalchemy import select

    token_record = (
        await session.execute(select(models.AgentRegistrationToken))
    ).scalar_one()
    assert token_record.ssh_public_key == response["public_key"]
    assert token_record.ssh_private_key_encrypted
    assert token_record.ssh_private_key_encrypted != decrypt_value(token_record.ssh_private_key_encrypted)
    assert "BEGIN OPENSSH PRIVATE KEY" in decrypt_value(token_record.ssh_private_key_encrypted)


@pytest.mark.asyncio
async def test_ssh_runner_without_host_key_fingerprint_is_rejected(runner_context):
    from app import schemas
    from app.routers import settings as settings_router
    from fastapi import HTTPException

    session, admin = runner_context

    runner_create = schemas.EnvironmentRunnerConfigCreate(
        environment_name="lab",
        runner_type="SSH",
        hostname="lab-box.internal",
        username="purvex",
    )

    with pytest.raises(HTTPException) as exc_info:
        await settings_router.create_environment_runner(
            request=_fake_request(),
            runner_create=runner_create,
            db=session,
            current_user=admin,
        )
    assert exc_info.value.status_code == 400
    assert "host key" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_installer_token_registration_provisions_runner_with_keypair(runner_context):
    from app import schemas
    from app.routers import settings as settings_router
    from app.security import decode_access_token

    session, admin = runner_context

    token_response = await settings_router.generate_agent_registration_token(
        db=session, current_user=admin,
    )
    registration_token = token_response["token"]
    public_key = token_response["public_key"]

    runner_create = schemas.EnvironmentRunnerConfigCreate(
        environment_name="lab",
        runner_type="SSH",
        hostname="lab-box.internal",
        username="purvex",
        ssh_host_key_sha256="SHA256:9mYpK4pQd6VG8t7jPjvaERh6XiW6m87iJi3G5EPI3Hk",
    )

    result = await settings_router.create_environment_runner(
        request=_fake_request(bearer_token=registration_token),
        runner_create=runner_create,
        db=session,
        current_user=admin,
    )

    # The response schema never serializes the private key.
    assert not hasattr(result, "ssh_private_key_encrypted")
    assert result.ssh_public_key == public_key

    from app import models
    from sqlalchemy import select

    db_runner = (
        await session.execute(
            select(models.EnvironmentRunnerConfig).filter(
                models.EnvironmentRunnerConfig.id == result.id
            )
        )
    ).scalar_one()
    assert db_runner.ssh_public_key == public_key
    assert db_runner.ssh_private_key_encrypted

    # Token is now consumed -- replaying it must fail.
    token_payload = decode_access_token(registration_token) or {}
    token_record = (
        await session.execute(
            select(models.AgentRegistrationToken).filter(
                models.AgentRegistrationToken.jti == token_payload.get("jti")
            )
        )
    ).scalar_one()
    assert token_record.used_at is not None
    assert token_record.used_by_runner_id == db_runner.id


def test_atomic_runner_loads_decrypted_private_key():
    from app.services.atomic_runner import _load_runner_pkey
    from app.utils.encryption import encrypt_value
    from app.utils.ssh_keys import generate_ed25519_keypair

    private_pem, public_line = generate_ed25519_keypair()
    runner = {"ssh_private_key_encrypted": encrypt_value(private_pem)}

    pkey = _load_runner_pkey(runner)

    assert pkey is not None
    # The parsed key's own public half should match what was minted.
    assert public_line.startswith(f"ssh-ed25519 {pkey.get_base64()}")


def test_atomic_runner_returns_none_without_encrypted_key():
    from app.services.atomic_runner import _load_runner_pkey

    assert _load_runner_pkey({"key_path": "/opt/purvex/id_ed25519"}) is None


@pytest.mark.asyncio
async def test_agent_registration_token_rejected_as_general_credential(runner_context):
    """An agent-registration token is meant to be embedded in a downloadable
    script and run on a separate, less-trusted machine. It must not double
    as a full admin session usable against arbitrary endpoints -- only
    create_environment_runner (via get_current_user_allow_agent_registration)
    may accept it.
    """
    from app.routers import settings as settings_router
    from app.routers.auth import get_current_user
    from fastapi import HTTPException

    session, admin = runner_context

    token_response = await settings_router.generate_agent_registration_token(
        db=session, current_user=admin,
    )
    registration_token = token_response["token"]

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(
            request=_fake_request(bearer_token=registration_token),
            db=session,
        )
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_agent_registration_token_accepted_for_runner_creation_only(runner_context):
    from app.routers import settings as settings_router
    from app.routers.auth import get_current_user_allow_agent_registration

    session, admin = runner_context

    token_response = await settings_router.generate_agent_registration_token(
        db=session, current_user=admin,
    )
    registration_token = token_response["token"]

    user = await get_current_user_allow_agent_registration(
        request=_fake_request(bearer_token=registration_token),
        db=session,
    )
    assert user.id == admin.id
