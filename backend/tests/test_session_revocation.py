"""Regression tests for session revocation on password change.

JWTs are stateless, so an admin-forced password reset didn't by itself
invalidate any already-issued token for that user — if an account was
compromised and the password reset specifically because of that, the
attacker's existing session kept working until it naturally expired.
get_current_user now rejects any token whose `iat` predates
`User.token_valid_after`, which set_user_password (rbac.py) and
scripts/reset.py both set on every change.
"""
from __future__ import annotations

import time

import pytest
import pytest_asyncio
from fastapi import HTTPException, Request
from starlette.requests import Request as StarletteRequest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _make_request(headers: dict[str, str] | None = None) -> StarletteRequest:
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return StarletteRequest({"type": "http", "headers": raw_headers})


class _FakeRequest:
    client = type("client", (), {"host": "127.0.0.1"})()


@pytest_asyncio.fixture
async def revocation_context(monkeypatch):
    from app import models
    from app.security import hash_password

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    # rbac.set_user_password writes its audit event via a separate
    # `async_sessionmaker()` call, not the injected `db` session.
    import app.routers.rbac as rbac_router
    monkeypatch.setattr(rbac_router, "async_sessionmaker", test_sessionmaker)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        admin = models.User(
            id=1, username="admin", email="admin@example.test",
            hashed_password=hash_password("Admin-Pass1!"),
            organization_id=1, is_active=True, is_admin=True,
        )
        victim = models.User(
            id=2, username="victim", email="victim@example.test",
            hashed_password=hash_password("Old-Pass1!"),
            organization_id=1, is_active=True,
        )
        session.add_all([org, admin, victim])
        await session.commit()
        yield session, admin, victim

    await engine.dispose()


@pytest.mark.asyncio
async def test_admin_password_reset_revokes_existing_session(revocation_context):
    from app.security import create_access_token
    import app.routers.auth as auth_router
    import app.routers.rbac as rbac_router
    session, admin, victim = revocation_context

    # Simulate an attacker holding a session token issued before the reset.
    old_token = create_access_token(data={"sub": victim.email, "uid": victim.id})
    old_request = _make_request({"Authorization": f"Bearer {old_token}"})
    # Sanity check: works before the reset.
    result = await auth_router.get_current_user(old_request, session)
    assert result.id == victim.id

    # A tick to guarantee the reset's timestamp strictly exceeds the old
    # token's `iat` (both are second-resolution).
    time.sleep(1.1)

    await rbac_router.set_user_password(
        user_id=victim.id,
        password_request=rbac_router.SetPasswordRequest(
            current_password="Admin-Pass1!", password="New-Compromise-Fix1!",
        ),
        request=_FakeRequest(),
        db=session,
        current_user=admin,
    )

    with pytest.raises(HTTPException) as exc:
        await auth_router.get_current_user(old_request, session)
    assert exc.value.status_code == 401

    # A fresh login token (issued after the reset) works fine.
    new_token = create_access_token(data={"sub": victim.email, "uid": victim.id})
    new_request = _make_request({"Authorization": f"Bearer {new_token}"})
    result = await auth_router.get_current_user(new_request, session)
    assert result.id == victim.id


@pytest.mark.asyncio
async def test_user_with_no_prior_password_change_is_unaffected(revocation_context):
    """token_valid_after is NULL for accounts that predate this feature (or
    just haven't changed their password yet) — must not break their sessions."""
    from app.security import create_access_token
    import app.routers.auth as auth_router
    session, admin, victim = revocation_context

    assert victim.token_valid_after is None
    token = create_access_token(data={"sub": victim.email, "uid": victim.id})
    request = _make_request({"Authorization": f"Bearer {token}"})
    result = await auth_router.get_current_user(request, session)
    assert result.id == victim.id
