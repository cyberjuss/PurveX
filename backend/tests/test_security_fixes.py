"""Regression tests for the four vulnerabilities found in the 2026-07-27
platform-wide security audit:

1. Single-purpose JWTs (password-reset, invite) were accepted by
   ``get_current_user`` as full session credentials.
2. ``atomic_test_name`` could break out of the quoted shell argument it's
   embedded in when a test is dispatched to a Windows SSH runner.
3. ``POST /tests/`` let a caller attach a fabricated Test row to another
   organization's Detection, which ``list_detections``'s aggregation query
   would then surface as that detection's "latest result".
4. Login returned a different error message for a nonexistent account than
   for a wrong password on an existing one, enabling trivial enumeration.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import HTTPException
from starlette.requests import Request as StarletteRequest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _make_request(headers: dict[str, str] | None = None) -> StarletteRequest:
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return StarletteRequest({"type": "http", "headers": raw_headers})


@pytest_asyncio.fixture
async def security_context():
    from app import models
    from app.security import hash_password

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async with test_sessionmaker() as session:
        org_a = models.Organization(id=1, name="Org A")
        org_b = models.Organization(id=2, name="Org B")
        user = models.User(
            id=1, username="alice", email="alice@example.test",
            hashed_password=hash_password("Correct-Horse-1!"),
            organization_id=1, is_active=True, is_admin=True,
        )
        session.add_all([org_a, org_b, user])
        await session.commit()
        yield session, user

    await engine.dispose()


# ---------------------------------------------------------------------------
# Vuln 1: single-purpose tokens must not authenticate general requests
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_password_reset_token_rejected(security_context):
    from app.routers.auth import get_current_user
    from app.security import create_access_token
    session, user = security_context

    token = create_access_token(
        data={"sub": user.email, "uid": user.id, "purpose": "password_reset"},
        expires_minutes=30,
    )
    request = _make_request({"Authorization": f"Bearer {token}"})

    with pytest.raises(HTTPException) as exc:
        await get_current_user(request, session)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_invite_token_rejected(security_context):
    from app.routers.auth import get_current_user
    from app.security import create_access_token
    session, user = security_context

    token = create_access_token(
        data={"sub": user.email, "uid": user.id, "purpose": "user_invite"},
        expires_minutes=60 * 24 * 7,
    )
    request = _make_request({"Authorization": f"Bearer {token}"})

    with pytest.raises(HTTPException) as exc:
        await get_current_user(request, session)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_normal_session_token_still_accepted(security_context):
    """The fix must not break real sessions — only purpose-carrying tokens."""
    from app.routers.auth import get_current_user
    from app.security import create_access_token
    session, user = security_context

    token = create_access_token(data={"sub": user.email, "uid": user.id})
    request = _make_request({"Authorization": f"Bearer {token}"})

    result = await get_current_user(request, session)
    assert result.id == user.id


# ---------------------------------------------------------------------------
# Vuln 2: atomic_test_name shell-metacharacter injection
# ---------------------------------------------------------------------------
def test_atomic_test_name_schema_rejects_shell_metacharacters():
    from app import schemas
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        schemas.TestRunCreate(
            technique_id="T1059",
            environment="lab",
            atomic_test_name='x" & calc.exe & "',
        )


def test_atomic_test_name_schema_accepts_legitimate_name():
    from app import schemas

    run = schemas.TestRunCreate(
        technique_id="T1059",
        environment="lab",
        atomic_test_name="PowerShell -Version 2 Downgrade Attack",
    )
    assert run.atomic_test_name == "PowerShell -Version 2 Downgrade Attack"


def test_atomic_selector_rejects_injection_payload():
    from app.services.atomic_runner import _atomic_selector

    with pytest.raises(RuntimeError):
        _atomic_selector(None, 'x" & calc.exe & "', powershell=True)


def test_atomic_selector_accepts_legitimate_name():
    from app.services.atomic_runner import _atomic_selector

    result = _atomic_selector(None, "Command and Scripting Interpreter", powershell=True)
    assert "Command and Scripting Interpreter" in result


# ---------------------------------------------------------------------------
# Vuln 3: cross-tenant test-result injection
# ---------------------------------------------------------------------------
async def _seed_detection(session, models, org_id: int, **overrides):
    defaults = dict(
        id=str(uuid.uuid4()),
        title="Some Rule",
        technique_id="T1059.001",
        organization_id=org_id,
        siem_type="splunk",
        siem_query="index=main",
    )
    defaults.update(overrides)
    det = models.Detection(**defaults)
    session.add(det)
    await session.commit()
    return det


@pytest.mark.asyncio
async def test_create_test_rejects_foreign_org_detection_id(security_context):
    from app import models, schemas
    import app.routers.tests as tests_router
    session, user = security_context

    foreign_detection = await _seed_detection(session, models, org_id=2)

    with pytest.raises(HTTPException) as exc:
        await tests_router.create_test(
            test=schemas.TestCreate(
                technique_id="T1059",
                environment="lab",
                detection_id=foreign_detection.id,
            ),
            db=session,
            current_user=user,
        )
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_create_test_accepts_own_org_detection_id(security_context):
    from app import models, schemas
    import app.routers.tests as tests_router
    session, user = security_context

    own_detection = await _seed_detection(session, models, org_id=1)

    result = await tests_router.create_test(
        test=schemas.TestCreate(
            technique_id="T1059",
            environment="lab",
            detection_id=own_detection.id,
            started_at=datetime.now(timezone.utc),
        ),
        db=session,
        current_user=user,
    )
    assert result.detection_id == own_detection.id


@pytest.mark.asyncio
async def test_list_detections_ignores_foreign_org_test_rows(security_context):
    """Even if a foreign-org Test row exists (e.g. from before this fix, or
    a different bug), list_detections must not surface it as this org's
    detection status — organization_id must be part of the join, not just
    detection_id."""
    from app import models
    import app.routers.detections as detections_router
    session, user = security_context

    own_detection = await _seed_detection(session, models, org_id=1)

    # Simulate a fabricated cross-org Test row directly (bypassing create_test,
    # which is now fixed) to prove the *read* side is independently defended.
    foreign_test = models.Test(
        organization_id=2,
        detection_id=own_detection.id,
        technique_id="T1059.001",
        environment="lab",
        status="completed",
        result="FAIL",
        score=0,
        started_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        finished_at=datetime.now(timezone.utc),
    )
    session.add(foreign_test)
    await session.commit()

    detections = await detections_router.list_detections(
        db=session, current_user=user, request=_make_request(), skip=0, limit=50,
    )
    matching = [d for d in detections if d.id == own_detection.id]
    assert len(matching) == 1
    assert matching[0].last_result is None  # foreign org's Test must be ignored
    assert matching[0].last_score is None


# ---------------------------------------------------------------------------
# Vuln 4 (incidental): login error message consistency
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_login_error_message_identical_for_missing_vs_wrong_password(security_context):
    from fastapi.security import OAuth2PasswordRequestForm
    import app.routers.auth as auth_router
    session, user = security_context

    class _FakeRequest:
        client = type("client", (), {"host": "127.0.0.1"})()

    nonexistent_form = OAuth2PasswordRequestForm(
        username="nobody@example.test", password="whatever", scope="",
    )
    wrong_password_form = OAuth2PasswordRequestForm(
        username="alice@example.test", password="wrong-password", scope="",
    )

    with pytest.raises(HTTPException) as exc_missing:
        await auth_router.login(
            form_data=nonexistent_form, response=None, request=_FakeRequest(), db=session,
        )
    with pytest.raises(HTTPException) as exc_wrong:
        await auth_router.login(
            form_data=wrong_password_form, response=None, request=_FakeRequest(), db=session,
        )

    assert exc_missing.value.status_code == exc_wrong.value.status_code == 401
    assert exc_missing.value.detail == exc_wrong.value.detail


# ---------------------------------------------------------------------------
# Incidental fix found during live verification: the global
# RequestValidationError handler crashed to a 500 instead of returning 422
# whenever a @field_validator raised ValueError(...) — which pydantic
# represents with the *raw exception object* under errors()[i]["ctx"]["error"],
# not JSON-serializable by plain json.dumps. This affects every validator in
# the app (including the new atomic_test_name one above), not just this fix,
# so it's covered directly against the handler rather than one call site.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_validation_error_handler_serializes_value_error_context():
    from app.main import validation_exception_handler
    from fastapi.exceptions import RequestValidationError
    from pydantic import ValidationError
    from app import schemas

    try:
        schemas.TestRunCreate(technique_id="T1059", environment="lab", mode="NOT_A_REAL_MODE")
        pytest.fail("expected a ValidationError")
    except ValidationError as exc:
        # This is exactly the shape FastAPI wraps into RequestValidationError,
        # including the live ValueError instance under ctx.error.
        fastapi_exc = RequestValidationError(exc.errors())

    response = await validation_exception_handler(_make_request(), fastapi_exc)
    assert response.status_code == 422
    # Constructing the JSONResponse already serializes `content` — if this
    # didn't raise, the fix works. Double check the body actually decodes.
    import json
    body = json.loads(response.body)
    assert body["detail"][0]["loc"] == ["mode"]
