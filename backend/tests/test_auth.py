"""
Unit tests for authentication and authorization.
"""
import pytest
from fastapi.testclient import TestClient
import os

# Set test environment
os.environ["PURVEX_ENV"] = "test"
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-only-not-for-production"

from app.main import app
from app.security import hash_password, verify_password


class TestPasswordHashing:
    """Test password hashing functionality."""
    
    def test_password_hashing(self):
        """Test that passwords are hashed correctly."""
        password = "TestPassword123"
        hashed = hash_password(password)
        
        # Hashed password should be different from original
        assert hashed != password
        
        # Should be able to verify the password
        assert verify_password(password, hashed)
    
    def test_password_verification_fails_wrong_password(self):
        """Test that wrong passwords fail verification."""
        password = "TestPassword123"
        hashed = hash_password(password)
        
        # Wrong password should fail
        assert not verify_password("WrongPassword", hashed)
    
    def test_different_passwords_produce_different_hashes(self):
        """Test that different passwords produce different hashes."""
        password1 = "Password1"
        password2 = "Password2"
        
        hash1 = hash_password(password1)
        hash2 = hash_password(password2)
        
        # Hashes should be different (bcrypt includes salt)
        assert hash1 != hash2


class TestAuthentication:
    """Test authentication endpoints."""
    
    @pytest.fixture
    def client(self):
        """Create test client."""
        return TestClient(app)
    
    def test_health_endpoint(self, client):
        """Test that health endpoint is accessible."""
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
    
    def test_login_endpoint_exists(self, client):
        """Test that login endpoint exists."""
        # Try to login (may fail without proper setup, but endpoint should exist)
        response = client.post(
            "/api/v1/auth/login",
            data={"username": "admin", "password": "admin"}
        )
        # Should not be 404 (endpoint exists)
        assert response.status_code != 404


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

