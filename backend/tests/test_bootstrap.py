import os
import pytest
from fastapi.testclient import TestClient

os.environ["PURVEX_ENV"] = "test"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-only-not-for-production"

from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_bootstrap_status_endpoint_exists(client):
    response = client.get("/auth/bootstrap/status")
    assert response.status_code == 200
    assert "needs_admin" in response.json()


def test_bootstrap_create_admin_requires_password(client):
    response = client.post("/auth/bootstrap", json={"username": "admin"})
    assert response.status_code in (400, 422)
