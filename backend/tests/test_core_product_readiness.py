import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


@pytest_asyncio.fixture
async def onboarding_context(monkeypatch):
    from app import models
    import app.routers.onboarding as onboarding_router

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    monkeypatch.setattr(onboarding_router, "_atomic_catalog_installed", lambda: False)
    monkeypatch.setattr(onboarding_router, "_atomic_data_dir", lambda: "C:/purvex/atomic-red-team")

    async with test_sessionmaker() as session:
        org = models.Organization(id=1, name="Test Org")
        user = models.User(
            id=1,
            username="admin",
            email="admin@example.test",
            hashed_password="not-used",
            organization_id=1,
            is_active=True,
            is_admin=True,
        )
        session.add_all([org, user])
        await session.commit()
        yield onboarding_router, session, user

    await engine.dispose()


@pytest.mark.asyncio
async def test_onboarding_status_surfaces_blockers_and_recovery_hints(onboarding_context):
    onboarding_router, session, user = onboarding_context

    status = await onboarding_router.get_onboarding_status(session, user)

    steps = {step.id: step for step in status.steps}

    assert status.completed is False
    assert steps["install_atomic_catalog"].completed is False
    assert steps["install_atomic_catalog"].status == "action_required"
    assert steps["install_atomic_catalog"].recovery_hint
    assert steps["run_first_test"].status == "blocked"
    assert "Complete the SIEM" in (steps["run_first_test"].recovery_hint or "")


@pytest.mark.asyncio
async def test_splunk_connector_retries_transient_request_failure(monkeypatch):
    import httpx

    from app.services import siem_connectors

    class FakeResponse:
        text = '{"ok": true}'

        def raise_for_status(self):
            return None

        def json(self):
            return {"ok": True}

    class FakeClient:
        calls = 0

        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def request(self, *args, **kwargs):
            FakeClient.calls += 1
            if FakeClient.calls == 1:
                raise httpx.ConnectError("temporary outage")
            return FakeResponse()

    async def no_delay(_attempt: int):
        return None

    monkeypatch.setattr(siem_connectors.httpx, "AsyncClient", FakeClient)

    connector = siem_connectors.SplunkConnector(
        "https://splunk.example.test",
        {"token": "test-token", "retry_attempts": 1},
    )
    monkeypatch.setattr(connector, "_retry_delay", no_delay)

    assert await connector._request("GET", "/services/server/info") == {"ok": True}
    assert FakeClient.calls == 2
