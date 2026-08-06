from pydantic_settings import BaseSettings, SettingsConfigDict
from dotenv import load_dotenv
from pathlib import Path
import os
import secrets
import logging
from typing import Optional, List

# Always load the repo-root .env regardless of current working directory.
BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_ENV = BACKEND_DIR.parent / ".env"
load_dotenv(dotenv_path=ROOT_ENV)

DEFAULT_DEPLOYMENT_ENV = os.getenv("PURVEX_ENV", "dev")
STRICT_DEPLOYMENT_ENVS = {"prod", "staging", "beta"}
DEFAULT_DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{(BACKEND_DIR / 'purvex.db').as_posix()}",
)
# CREATE_DEFAULT_ADMIN is opt-in only. The launcher's interactive bootstrap
# (scripts/create_admin.py) is the supported path; the in-process auto-create
# path is reserved for unattended local dev where the operator has explicitly
# set DEFAULT_ADMIN_PASSWORD. There is no implicit "admin" fallback.
DEFAULT_CREATE_DEFAULT_ADMIN = False
DEFAULT_ADMIN_PASSWORD_VALUE = os.getenv("DEFAULT_ADMIN_PASSWORD")

class Settings(BaseSettings):
    project_name: str = "PurveX"
    api_v1_str: str = "/api/v1"
    # Database settings
    database_url: str = DEFAULT_DATABASE_URL

    # JWT Settings
    # SECURITY: This MUST be set via environment variable in any environment
    # other than ad-hoc local dev. If unset, we generate an *ephemeral* key and
    # log a loud warning — every restart invalidates all sessions, so this is
    # only acceptable on a developer's laptop. Beta/staging/production boot is
    # blocked at the bottom of this file when JWT_SECRET_KEY is missing.
    # Generate a strong secret: python -c "import secrets; print(secrets.token_urlsafe(32))"
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "") or secrets.token_urlsafe(32)
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 120  # 2 hours

    # Authentication & login security policy
    # These knobs control lockout and rate limiting behaviour for login attempts.
    # Defaults are tuned for production; dev/staging can override via env vars.
    LOGIN_MAX_ATTEMPTS: int = 5  # Failed attempts before account lockout (prod default)
    LOGIN_LOCKOUT_MINUTES: int = 30  # How long an account stays locked (prod default)
    LOGIN_RATE_LIMIT_MAX_REQUESTS: int = 5  # Attempts allowed in rate-limit window (prod default)
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = 300  # Window size in seconds for rate limit (prod default)
    REDIS_URL: Optional[str] = os.getenv("REDIS_URL")

    # Password history / reuse policy
    PASSWORD_HISTORY_LENGTH: int = 5  # How many previous hashes to remember per user

    # Base URL the app is reachable at, used to build absolute links in
    # outbound emails (password reset, invites). Must be set to the real
    # public URL in staging/prod; the dev default matches the port used by
    # `next start` in this repo's local workflow.
    APP_BASE_URL: str = os.getenv("APP_BASE_URL", "http://127.0.0.1:1120")

    # Outbound email (SMTP). Optional: if unset, email-dependent flows
    # (password reset, user invites) degrade gracefully — the API still
    # responds correctly (no enumeration leakage) but logs a loud warning
    # instead of actually sending, so this is safe to leave unset in dev.
    SMTP_HOST: Optional[str] = os.getenv("SMTP_HOST")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: Optional[str] = os.getenv("SMTP_USERNAME")
    SMTP_PASSWORD: Optional[str] = os.getenv("SMTP_PASSWORD")
    SMTP_FROM_EMAIL: Optional[str] = os.getenv("SMTP_FROM_EMAIL")
    SMTP_FROM_NAME: str = os.getenv("SMTP_FROM_NAME", "PurveX")
    SMTP_USE_TLS: bool = os.getenv("SMTP_USE_TLS", "true").strip().lower() in {"1", "true", "yes", "y"}

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
    DEFAULT_ADMIN_EMAIL: str = os.getenv("DEFAULT_ADMIN_EMAIL", "admin")
    DEFAULT_ADMIN_PASSWORD: Optional[str] = DEFAULT_ADMIN_PASSWORD_VALUE
    DEFAULT_ADMIN_NAME: str = "PurveX Admin"
    # Default admin creation is enabled by default for local/dev.
    # In production, this must be set to False (startup will fail if left true).
    CREATE_DEFAULT_ADMIN: bool = os.getenv(
        "CREATE_DEFAULT_ADMIN",
        "true" if DEFAULT_CREATE_DEFAULT_ADMIN else "false",
    ).strip().lower() in {"1", "true", "yes", "y"}

    # SIEM Configuration (MVP)
    # SPLUNK_URL, SPLUNK_USERNAME, etc. moved to SIEMConnection model
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

    # Paid-plan license (see app/utils/license.py). PURVEX_LICENSE_KEY is the
    # signed token an admin pastes in after purchasing; the public key below
    # verifies it offline and never changes per-install — it's the public
    # half of a keypair only the license issuer holds, not a secret itself.
    # Generated once via backend/scripts/issue_license.py keygen; the
    # matching private key never leaves the operator's own machine (see
    # backend/.license_signing_key.pem, gitignored). LICENSE_PUBLIC_KEY_PEM
    # can still override this per-deployment if the key is ever rotated.
    PURVEX_LICENSE_KEY: str = os.getenv("PURVEX_LICENSE_KEY", "")
    LICENSE_PUBLIC_KEY_PEM: str = os.getenv("LICENSE_PUBLIC_KEY_PEM", "") or (
        "-----BEGIN PUBLIC KEY-----\n"
        "MCowBQYDK2VwAyEA9gRnGC9Alpz2eG+aRO0Rbps0Z0UBtBj8svD4IjjYxbY=\n"
        "-----END PUBLIC KEY-----"
    )

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

    # Slow-query logger — any SQL that takes longer than this is emitted at
    # WARNING so ops can spot regressions before they hit users. Set to 0 to
    # disable. Default is intentionally loose; tune once baselined.
    SLOW_QUERY_THRESHOLD_MS: int = int(os.getenv("SLOW_QUERY_THRESHOLD_MS", "500"))

    # Audit log retention
    AUDIT_RETENTION_DAYS: int = 30
    AUDIT_RETENTION_ENABLED: bool = True
    AUDIT_RETENTION_INTERVAL_HOURS: int = 24

    # Test + artifact retention. Tests generate a lot of data once scheduled runs
    # are in use; default to a longer window than audit events but still bounded.
    TEST_RETENTION_DAYS: int = 180
    TEST_RETENTION_ENABLED: bool = True
    TEST_RETENTION_INTERVAL_HOURS: int = 24
    STALE_TEST_TIMEOUT_MINUTES: int = 60

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
    OPENAI_API_KEY: Optional[str] = os.getenv("OPENAI_API_KEY")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    OPENAI_API_BASE_URL: str = os.getenv("OPENAI_API_BASE_URL", "https://api.openai.com/v1")
    AI_PROVIDER: str = os.getenv("AI_PROVIDER", "OpenAI")
    # Comma-separated extra hostnames allowed for the LLM `api_base_url` on
    # top of the built-in api.openai.com / api.deepseek.com. Use this to
    # whitelist self-hosted endpoints (Azure OpenAI, vLLM behind a public TLS
    # proxy, …). Per-org `api_base_url` settings that don't match the
    # allowlist are rejected before any request is made.
    LLM_EXTRA_ALLOWED_HOSTS: str = os.getenv("PURVEX_LLM_ALLOWED_HOSTS", "")
    # Per-user rate limit on Watchtower chat (sliding window). Defaults are
    # tuned so an interactive user is never throttled but a stuck client or
    # malicious actor can't exhaust the customer's LLM quota.
    AI_CHAT_RATE_LIMIT_MAX_REQUESTS: int = int(
        os.getenv("AI_CHAT_RATE_LIMIT_MAX_REQUESTS", "30")
    )
    AI_CHAT_RATE_LIMIT_WINDOW_SECONDS: int = int(
        os.getenv("AI_CHAT_RATE_LIMIT_WINDOW_SECONDS", "300")
    )
    GENERATE_TUNING_SUGGESTIONS: bool = True
    EXPLAIN_TEST_FAILURES: bool = True
    AUTOMATICALLY_MODIFY_RULES: bool = False
    STRIP_IPS_HOSTNAMES: bool = True
    NO_RAW_LOGS_OUTSIDE_ENV: bool = False
    AI_AUDIENCE_PREFERENCE: str = "Analyst"

    # Deployment environment hint ("dev", "beta", "staging", "prod") used for safety checks.
    DEPLOYMENT_ENV: str = DEFAULT_DEPLOYMENT_ENV

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

# --- Production safety checks ---
_config_logger = logging.getLogger("purvex.config")

if settings.DEPLOYMENT_ENV.lower() in STRICT_DEPLOYMENT_ENVS:
    _missing = []
    if not os.getenv("JWT_SECRET_KEY"):
        _missing.append("JWT_SECRET_KEY")
    if not os.getenv("PURVEX_ENCRYPTION_KEY"):
        _missing.append("PURVEX_ENCRYPTION_KEY")
    if not os.getenv("REDIS_URL"):
        _missing.append("REDIS_URL (required for distributed rate limiting in beta/staging/production)")
    if "sqlite" in settings.database_url.lower():
        _missing.append("DATABASE_URL (SQLite is not supported in managed deployments — use PostgreSQL)")
    if _missing:
        raise RuntimeError(
            f"Managed deployment blocked — missing required config: {', '.join(_missing)}. "
            "See .env.example for setup instructions."
        )
elif "sqlite" in settings.database_url.lower():
    _config_logger.warning(
        "Using SQLite database. This is fine for development but not suitable "
        "for production. Set DATABASE_URL to a PostgreSQL connection string."
    )

if settings.DEPLOYMENT_ENV.lower() in STRICT_DEPLOYMENT_ENVS and not settings.SMTP_HOST:
    _config_logger.warning(
        "SMTP_HOST is not set — password reset and user invite emails will not "
        "be sent. Those flows will still respond correctly but no email will "
        "reach the user. Set SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM_EMAIL "
        "to enable outbound email."
    )

if not os.getenv("JWT_SECRET_KEY"):
    _config_logger.warning(
        "JWT_SECRET_KEY is not set; generated an ephemeral key for this process. "
        "All sessions will be invalidated on the next restart. Set JWT_SECRET_KEY "
        "in the environment (see scripts/purvex.sh setup or docs/beta-install-runbook.md)."
    )
