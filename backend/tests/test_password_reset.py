from datetime import datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def password_reset_context(monkeypatch):
    from app import models
    import app.routers.password_reset as password_reset_router

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    monkeypatch.setattr(password_reset_router, "async_sessionmaker", test_sessionmaker)

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        user = models.User(
            id=1,
            username="reset-user",
            email="reset@example.test",
            hashed_password=password_reset_router.hash_password("OldValidPass123!"),
            organization_id=1,
            is_active=True,
            is_admin=False,
        )
        session.add_all([org, user])
        await session.commit()
        yield password_reset_router, session, user, models, select

    await engine.dispose()


async def _issue_reset_token(password_reset_router, session, user, models):
    token = password_reset_router.create_access_token(
        data={
            "sub": user.email,
            "uid": user.id,
            "purpose": "password_reset",
        },
        expires_minutes=30,
    )
    claims = password_reset_router.decode_access_token(token)
    session.add(
        models.PasswordResetToken(
            user_id=user.id,
            jti=str(claims["jti"]),
            expires_at=datetime.fromtimestamp(float(claims["exp"]), tz=timezone.utc),
        )
    )
    await session.commit()
    return token


@pytest.mark.asyncio
async def test_password_reset_token_is_single_use(password_reset_context):
    password_reset_router, session, user, models, select_fn = password_reset_context
    token = await _issue_reset_token(password_reset_router, session, user, models)

    first_response = await password_reset_router.confirm_password_reset(
        password_reset_router.PasswordResetConfirm(
            token=token,
            new_password="NewValidPass123!",
        ),
        session,
    )

    assert first_response["message"] == "Password has been reset successfully"

    token_record = (
        await session.execute(select_fn(models.PasswordResetToken))
    ).scalar_one()
    assert token_record.used_at is not None

    with pytest.raises(password_reset_router.HTTPException) as exc_info:
        await password_reset_router.confirm_password_reset(
            password_reset_router.PasswordResetConfirm(
                token=token,
                new_password="AnotherValidPass123!",
            ),
            session,
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Invalid or expired reset token"


@pytest.mark.asyncio
async def test_password_reset_rejects_current_password_reuse(password_reset_context):
    password_reset_router, session, user, models, _ = password_reset_context
    token = await _issue_reset_token(password_reset_router, session, user, models)

    with pytest.raises(password_reset_router.HTTPException) as exc_info:
        await password_reset_router.confirm_password_reset(
            password_reset_router.PasswordResetConfirm(
                token=token,
                new_password="OldValidPass123!",
            ),
            session,
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "New password cannot be the same as the current password"
