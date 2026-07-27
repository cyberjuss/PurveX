"""Regression tests for the admin-invite user flow (previously untested,
now verified live against a running server and covered here):

  POST /rbac/users/invite -> email (or logged link) -> POST /auth/invite/accept
  -> user can log in -> PATCH /rbac/users/{id}/status deactivates/reactivates.

Covers: single-use token enforcement, password-complexity gating, blocked
login while pending activation, blocked login while deactivated, and the
self-deactivation guard.
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def invite_context(monkeypatch):
    from app import models
    from app.security import hash_password

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    # rbac.invite_user / set_user_status write their audit event via a
    # separate `async_sessionmaker()` call (not the injected `db` session) —
    # point that at our isolated test engine too, so audit writes don't leak
    # into whatever the process's real configured database is.
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


class _FakeRequest:
    client = type("client", (), {"host": "127.0.0.1"})()


class _FakeResponse:
    def set_cookie(self, *args, **kwargs):
        pass


@pytest.mark.asyncio
async def test_invite_accept_login_full_flow(invite_context):
    from app import models, schemas
    import app.routers.rbac as rbac_router
    import app.routers.auth as auth_router
    session, admin = invite_context

    invite_result = await rbac_router.invite_user(
        payload=rbac_router.InviteUserRequest(email="newhire@example.test"),
        request=_FakeRequest(),
        db=session,
        current_user=admin,
    )
    assert invite_result["email"] == "newhire@example.test"
    new_user_id = invite_result["user_id"]

    invited = await session.get(models.User, new_user_id)
    assert invited.is_pending_activation is True

    invite_row = (await session.execute(
        select(models.UserInviteToken).where(
            models.UserInviteToken.user_id == new_user_id
        )
    )).scalars().first()
    assert invite_row is not None
    assert invite_row.used_at is None

    # Reconstruct the token the way accept_invite expects it — invite_user
    # doesn't return the raw token (it's only ever delivered via email/log),
    # so mint one with the same claims/jti to drive the accept endpoint.
    from app.security import create_access_token
    raw_token = create_access_token(
        data={"sub": invited.email, "uid": invited.id, "purpose": "user_invite"},
        expires_minutes=60 * 24 * 7,
    )
    from app.security import decode_access_token
    # Swap in the jti we actually stored, since create_access_token mints a
    # fresh random jti each call and accept_invite matches on the stored row.
    invite_row.jti = decode_access_token(raw_token)["jti"]
    await session.commit()

    # Weak password rejected.
    with pytest.raises(HTTPException) as exc:
        await auth_router.accept_invite(
            payload=auth_router.AcceptInviteRequest(token=raw_token, new_password="weak"),
            db=session,
        )
    assert exc.value.status_code == 400

    # Strong password activates the account.
    result = await auth_router.accept_invite(
        payload=auth_router.AcceptInviteRequest(token=raw_token, new_password="NewHire-Pass1!"),
        db=session,
    )
    assert "activated" in result["message"].lower()

    await session.refresh(invited)
    assert invited.is_pending_activation is False

    # Token is single-use.
    with pytest.raises(HTTPException) as exc:
        await auth_router.accept_invite(
            payload=auth_router.AcceptInviteRequest(token=raw_token, new_password="AnotherStrong1!"),
            db=session,
        )
    assert exc.value.status_code == 400

    # New user can now log in.
    login_result = await auth_router.login(
        form_data=OAuth2PasswordRequestForm(
            username="newhire@example.test", password="NewHire-Pass1!", scope="",
        ),
        response=_FakeResponse(),
        request=_FakeRequest(),
        db=session,
    )
    assert login_result is not None


@pytest.mark.asyncio
async def test_pending_invite_cannot_log_in_before_acceptance(invite_context):
    """A pending-activation user has no real password yet — but the block
    should trigger on is_pending_activation, not merely "wrong password"."""
    from app import models
    from app.security import hash_password
    import app.routers.auth as auth_router
    session, _ = invite_context

    pending = models.User(
        username="pending", email="pending@example.test",
        hashed_password=hash_password("some-placeholder"),
        organization_id=1, is_active=True, is_pending_activation=True,
    )
    session.add(pending)
    await session.commit()

    with pytest.raises(HTTPException) as exc:
        await auth_router.login(
            form_data=OAuth2PasswordRequestForm(
                username="pending@example.test", password="some-placeholder", scope="",
            ),
            response=_FakeResponse(),
            request=_FakeRequest(),
            db=session,
        )
    assert exc.value.status_code == 400
    assert "not yet activated" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_deactivate_blocks_login_and_self_deactivation_is_blocked(invite_context):
    from app import models, schemas
    from app.security import hash_password
    import app.routers.rbac as rbac_router
    import app.routers.auth as auth_router
    session, admin = invite_context

    other = models.User(
        id=2, username="other", email="other@example.test",
        hashed_password=hash_password("Other-Pass1!"),
        organization_id=1, is_active=True,
    )
    session.add(other)
    await session.commit()

    result = await rbac_router.set_user_status(
        user_id=other.id,
        payload=rbac_router.SetUserStatusRequest(is_active=False),
        db=session,
        current_user=admin,
    )
    assert "deactivated" in result["message"].lower()

    with pytest.raises(HTTPException) as exc:
        await auth_router.login(
            form_data=OAuth2PasswordRequestForm(
                username="other@example.test", password="Other-Pass1!", scope="",
            ),
            response=_FakeResponse(),
            request=_FakeRequest(),
            db=session,
        )
    assert exc.value.status_code == 400
    assert "inactive" in exc.value.detail.lower()

    # Admin cannot deactivate themselves.
    with pytest.raises(HTTPException) as exc:
        await rbac_router.set_user_status(
            user_id=admin.id,
            payload=rbac_router.SetUserStatusRequest(is_active=False),
            db=session,
            current_user=admin,
        )
    assert exc.value.status_code == 400
    assert "cannot deactivate your own" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_invite_rejects_duplicate_email(invite_context):
    import app.routers.rbac as rbac_router
    session, admin = invite_context

    await rbac_router.invite_user(
        payload=rbac_router.InviteUserRequest(email="dup@example.test"),
        request=_FakeRequest(), db=session, current_user=admin,
    )
    with pytest.raises(HTTPException) as exc:
        await rbac_router.invite_user(
            payload=rbac_router.InviteUserRequest(email="dup@example.test"),
            request=_FakeRequest(), db=session, current_user=admin,
        )
    assert exc.value.status_code == 400
