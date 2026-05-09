import json

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from pydantic import ValidationError


@pytest_asyncio.fixture
async def settings_route_context(monkeypatch):
    monkeypatch.setenv("PURVEX_ENCRYPTION_KEY", Fernet.generate_key().decode())

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app import models
    import app.routers.settings as settings_router

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    test_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)

    async def allow_permission(*args, **kwargs):
        return None

    monkeypatch.setattr(settings_router, "async_sessionmaker", test_sessionmaker)
    monkeypatch.setattr(settings_router, "require_permission", allow_permission)

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
        yield settings_router, session, user, select, models

    await engine.dispose()


def test_siem_credentials_are_encrypted_on_create_storage_path(monkeypatch):
    monkeypatch.setenv("PURVEX_ENCRYPTION_KEY", Fernet.generate_key().decode())

    from app.routers.settings import _prepare_siem_credentials_for_storage
    from app.utils.encryption import decrypt_value, is_encrypted_value

    plaintext = {"token": "splunk-token-for-test", "username": "admin"}
    stored = _prepare_siem_credentials_for_storage(json.dumps(plaintext))

    assert stored != json.dumps(plaintext)
    assert is_encrypted_value(stored)
    assert json.loads(decrypt_value(stored)) == plaintext


def test_siem_credentials_are_encrypted_on_update_and_preserve_token(monkeypatch):
    monkeypatch.setenv("PURVEX_ENCRYPTION_KEY", Fernet.generate_key().decode())

    from app.routers.settings import _prepare_siem_credentials_for_storage
    from app.utils.encryption import decrypt_value, is_encrypted_value

    existing = _prepare_siem_credentials_for_storage(
        json.dumps({"token": "existing-token-for-test", "username": "old-admin"})
    )
    stored = _prepare_siem_credentials_for_storage(
        json.dumps({"username": "new-admin"}),
        existing,
    )
    decrypted = json.loads(decrypt_value(stored))

    assert stored != json.dumps({"username": "new-admin"})
    assert is_encrypted_value(stored)
    assert decrypted["username"] == "new-admin"
    assert decrypted["token"] == "existing-token-for-test"


def test_ai_provider_key_is_encrypted_on_update_storage_path(monkeypatch):
    monkeypatch.setenv("PURVEX_ENCRYPTION_KEY", Fernet.generate_key().decode())

    from app.routers.settings import _prepare_ai_api_key_for_storage
    from app.utils.encryption import decrypt_value, is_encrypted_value

    plaintext = "provider-key-for-test-only"
    stored = _prepare_ai_api_key_for_storage(plaintext)

    assert stored != plaintext
    assert is_encrypted_value(stored)
    assert decrypt_value(stored) == plaintext


@pytest.mark.asyncio
async def test_siem_create_route_does_not_store_plaintext_credentials(
    settings_route_context,
):
    settings_router, session, user, select, models = settings_route_context
    from app import schemas
    from app.utils.encryption import decrypt_value, is_encrypted_value

    credentials = {"token": "splunk-token-for-route-test", "username": "admin"}
    plaintext = json.dumps(credentials)

    await settings_router.create_siem_connection(
        schemas.SIEMConnectionCreate(
            siem_type="splunk",
            name="Route Test SIEM",
            url="https://splunk.example.test",
            auth_type="token",
            credentials=plaintext,
        ),
        session,
        user,
    )

    stored = (
        await session.execute(select(models.SIEMConnection))
    ).scalar_one().credentials
    assert stored != plaintext
    assert is_encrypted_value(stored)
    assert json.loads(decrypt_value(stored)) == credentials


@pytest.mark.asyncio
async def test_siem_update_route_does_not_store_plaintext_credentials(
    settings_route_context,
):
    settings_router, session, user, select, models = settings_route_context
    from app import schemas
    from app.routers.settings import _prepare_siem_credentials_for_storage
    from app.utils.encryption import decrypt_value, is_encrypted_value

    existing = models.SIEMConnection(
        organization_id=1,
        siem_type="splunk",
        name="Route Update SIEM",
        url="https://splunk.example.test",
        auth_type="token",
        credentials=_prepare_siem_credentials_for_storage(
            json.dumps({"token": "existing-route-token", "username": "old-admin"})
        ),
    )
    session.add(existing)
    await session.commit()
    await session.refresh(existing)

    update_plaintext = json.dumps({"username": "new-admin"})
    await settings_router.update_siem_connection(
        existing.id,
        schemas.SIEMConnectionCreate(
            siem_type="splunk",
            name="Route Update SIEM",
            url="https://splunk.example.test",
            auth_type="token",
            credentials=update_plaintext,
        ),
        session,
        user,
    )
    await session.refresh(existing)
    decrypted = json.loads(decrypt_value(existing.credentials))

    assert existing.credentials != update_plaintext
    assert is_encrypted_value(existing.credentials)
    assert decrypted["username"] == "new-admin"
    assert decrypted["token"] == "existing-route-token"


@pytest.mark.asyncio
async def test_ai_settings_route_does_not_store_plaintext_provider_keys(
    settings_route_context,
):
    settings_router, session, user, select, models = settings_route_context
    from app import schemas
    from app.utils.encryption import decrypt_value, is_encrypted_value

    create_plaintext = "provider-key-create-route-test"
    await settings_router.update_ai_assistant_settings(
        schemas.AIAssistantSettingsCreate(
            provider="OpenAI",
            model_name="gpt-test",
            api_base_url="https://api.openai.com/v1",
            api_key=create_plaintext,
        ),
        session,
        user,
    )
    row = (await session.execute(select(models.AIAssistantSettings))).scalar_one()

    assert row.api_key != create_plaintext
    assert is_encrypted_value(row.api_key)
    assert decrypt_value(row.api_key) == create_plaintext

    update_plaintext = "provider-key-update-route-test"
    await settings_router.update_ai_assistant_settings(
        schemas.AIAssistantSettingsCreate(
            provider="OpenAI",
            model_name="gpt-test",
            api_base_url="https://api.openai.com/v1",
            api_key=update_plaintext,
        ),
        session,
        user,
    )
    await session.refresh(row)

    assert row.api_key != update_plaintext
    assert is_encrypted_value(row.api_key)
    assert decrypt_value(row.api_key) == update_plaintext


def test_siem_schema_accepts_normal_https_url():
    from app import schemas

    model = schemas.SIEMConnectionCreate(
        siem_type="splunk",
        name="Valid SIEM",
        url="https://splunk.example.test:8089",
        auth_type="token",
        credentials='{"token":"abc"}',
    )

    assert model.url == "https://splunk.example.test:8089"


@pytest.mark.parametrize(
    "bad_url, expected_detail",
    [
        ("ftp://splunk.example.test", "http:// or https://"),
        ("http://localhost:8089", "loopback host"),
        ("http://127.0.0.1:8089", "loopback host"),
        ("http://0.0.0.0:8089", "loopback host"),
        ("http://169.254.169.254/latest/meta-data", "cloud metadata endpoint"),
        ("https://user:pass@splunk.example.test", "embed credentials"),
        ("https://splunk.example.test?token=abc", "query parameters or fragments"),
    ],
)
def test_siem_schema_rejects_unsafe_urls(bad_url, expected_detail):
    from app import schemas

    with pytest.raises(ValidationError) as exc_info:
        schemas.SIEMConnectionCreate(
            siem_type="splunk",
            name="Unsafe SIEM",
            url=bad_url,
            auth_type="token",
            credentials='{"token":"abc"}',
        )

    assert expected_detail in str(exc_info.value)
