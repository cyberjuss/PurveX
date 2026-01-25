from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv
from pathlib import Path
import os
from typing import Optional, List

# Always load the repo-root .env regardless of current working directory.
ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(dotenv_path=ROOT_ENV)

class Settings(BaseSettings):
    project_name: str = "PurveX"
    api_v1_str: str = "/api/v1"
    # Database settings
    database_url: str = "sqlite+aiosqlite:///./purvex.db" # Changed database name

    # JWT Settings
    # SECURITY: In production, this MUST be set via environment variable
    # Generate a strong secret: python -c "import secrets; print(secrets.token_urlsafe(32))"
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "super-secret-change-me-in-production")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 1 day

    # Authentication & login security policy
    # These knobs control lockout and rate limiting behaviour for login attempts.
    # Defaults are tuned for production; dev/staging can override via env vars.
    LOGIN_MAX_ATTEMPTS: int = 5  # Failed attempts before account lockout (prod default)
    LOGIN_LOCKOUT_MINUTES: int = 30  # How long an account stays locked (prod default)
    LOGIN_RATE_LIMIT_MAX_REQUESTS: int = 5  # Attempts allowed in rate-limit window (prod default)
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300  # Window size in seconds for rate limit (prod default)

    # Password history / reuse policy
    PASSWORD_HISTORY_LENGTH: int = 5  # How many previous hashes to remember per user

    # MFA policy
    # When enabled, these flags allow security teams to require 2FA for
    # specific classes of users in higher environments.
    REQUIRE_2FA_FOR_ADMINS: bool = False
    REQUIRE_2FA_FOR_ALL_USERS: bool = False

    # Allow localhost defaults; broader IPs handled via CORS_ALLOW_ORIGIN_REGEX.
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    # Permit any loopback or RFC1918 host (e.g., 192.168.x.x:3000) during local dev.
    CORS_ALLOW_ORIGIN_REGEX: str = r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(:\d+)?"

    # Organization Settings (MVP)
    ORGANIZATION_NAME: str = "Default Organization"
    PRIMARY_CONTACT_EMAIL: Optional[str] = None
    DEFAULT_TIMEZONE: str = "UTC"
    DEFAULT_LOCALE: str = "en_US"
    DEFAULT_ENVIRONMENT_NAMES: str = "lab,dev,prod" # Comma-separated string
    COMPLIANCE_MODE_FLAGS: str = "" # Comma-separated string

    # Default Administrator (for dev/demo)
    DEFAULT_ADMIN_EMAIL: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str = "admin"
    DEFAULT_ADMIN_NAME: str = "PurveX Admin"
    # Default admin creation is enabled by default for local/dev.
    # In production, this must be set to False (startup will fail if left true).
    CREATE_DEFAULT_ADMIN: bool = True

    # SIEM Configuration (MVP)
    # SPLUNK_URL, SPLUNK_USERNAME, etc. moved to SIEMConnection model
    SIEM_DEFAULT_WINDOWS_INDEX: Optional[str] = None
    SIEM_DEFAULT_LINUX_INDEX: Optional[str] = None
    SIEM_DEFAULT_CLOUD_INDEX: Optional[str] = None
    SIEM_LOG_MARKER_PATTERN: str = "purvex_*"

    # Test Runner & Environment Settings (MVP)
    # ATTACK_VM_HOST, etc. moved to EnvironmentRunnerConfig model
    DEFAULT_RUNNER_TYPE: str = "SSH"
    DEFAULT_RUNNER_PORT: int = 22
    DEFAULT_RUNNER_AUTH_METHOD: str = "key"
    DEFAULT_ALLOWED_TEST_TYPES: str = "Atomic only" # Comma-separated string
    DEFAULT_MAX_CONCURRENT_TESTS: int = 1
    DEFAULT_RUNNER_HEARTBEAT_INTERVAL: int = 60
    DEFAULT_RUNNER_ALERT_OFFLINE_MINUTES: int = 5
    RUNNER_TOKEN_TTL_DAYS: int = 90
    AGENT_REGISTRATION_TOKEN_TTL_MINUTES: int = 60

    # Testing Policy & Safety Settings (MVP)
    ALLOWED_TEST_ENVIRONMENTS: str = "lab,dev" # Comma-separated string
    DEFAULT_MARKER_PREFIX: str = "purvex_"
    INCLUDE_ENV_TIMESTAMP_IN_MARKER: bool = True
    TAG_TEST_ALERTS: str = "Purvex_Test = true"
    NOTIFY_BEFORE_PROD_TESTS: bool = False
    DISALLOW_TESTS_DURING_BUSINESS_HOURS: bool = False
    BUSINESS_HOURS_START: str = "09:00"
    BUSINESS_HOURS_END: str = "17:00"
    ONLY_PROD_DURING_MAINTENANCE_WINDOWS: bool = False

    # Audit log retention
    AUDIT_RETENTION_DAYS: int = 30
    AUDIT_RETENTION_ENABLED: bool = True
    AUDIT_RETENTION_INTERVAL_HOURS: int = 24

    # Detection Scoring & Health Settings (MVP)
    BASE_SCORING_EXPLANATION: str = (
        "Score = last test score if available. If not, use base scores "
        "(PASS 80, FAIL 30, INCONCLUSIVE 50). Recent tests weigh more "
        "than stale tests."
    )
    PASS_LOG_BASE_SCORE: int = 80
    FAIL_LOG_BASE_SCORE: int = 30
    INCONCLUSIVE_BASE_SCORE: int = 50
    RECENT_PASS_FAIL_WEIGHT: int = 10
    FALSE_POSITIVE_PENALTY: int = 10
    ENVIRONMENT_PENALTY_DISCOUNT: int = 0
    HEALTH_THRESHOLD_HEALTHY: int = 80
    HEALTH_THRESHOLD_AT_RISK: int = 50
    HEALTH_THRESHOLD_CRITICAL: int = 20
    SCORING_WINDOW_N_TESTS: int = 10

    # SIEM Adapter (MVP – defaults keep Splunk in stub mode)
    SIEM_TYPE: str = "splunk"
    SPLUNK_URL: Optional[str] = None
    SPLUNK_USERNAME: Optional[str] = None
    SPLUNK_PASSWORD: Optional[str] = None
    SPLUNK_TOKEN: Optional[str] = None

    # AI Assistant Settings (MVP)
    OLLAMA_API_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL_NAME: str = "gemma2:2b"  # Default local model
    OPENAI_API_KEY: Optional[str] = None # Kept as an optional env var
    AI_PROVIDER: str = "Local LLaMA"
    GENERATE_TUNING_SUGGESTIONS: bool = True
    EXPLAIN_TEST_FAILURES: bool = True
    AUTOMATICALLY_MODIFY_RULES: bool = False
    STRIP_IPS_HOSTNAMES: bool = True
    NO_RAW_LOGS_OUTSIDE_ENV: bool = False
    AI_AUDIENCE_PREFERENCE: str = "Analyst"

    # Deployment environment hint ("dev", "staging", "prod") used for safety checks.
    DEPLOYMENT_ENV: str = os.getenv("PURVEX_ENV", "dev")

    # Atomic Red Team catalog storage
    ATOMIC_DATA_DIR: str = os.getenv(
        "PURVEX_ATOMIC_DATA_DIR",
        str(Path.home() / ".purvex" / "atomic-red-team"),
    )
    ATOMIC_TARBALL_URL: str = os.getenv(
        "PURVEX_ATOMIC_TARBALL_URL",
        "https://github.com/redcanaryco/atomic-red-team/archive/refs/heads/master.tar.gz",
    )

    # Pydantic v2 settings configuration
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",  # Allow legacy/unused env vars like ATTACK_VM_* without failing
    )

settings = Settings()
