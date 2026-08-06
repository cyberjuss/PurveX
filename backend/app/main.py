import asyncio
import json
import logging
import os
import sys
import re
from pathlib import Path

# Add the project root to the Python path to allow absolute imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy import or_, select, text, inspect
from starlette.exceptions import HTTPException as StarletteHTTPException
from .middleware.security import SecurityHeadersMiddleware, RateLimitMiddleware, RequestLoggingMiddleware
from .middleware.csrf import CSRFProtectionMiddleware
from .middleware.request_context import RequestContextMiddleware
from .middleware.metrics import PrometheusMiddleware, metrics_response
from .logging_config import configure_logging

configure_logging()

from .config import settings
from . import models
from .db import Base, async_engine, async_sessionmaker
from .routers import detections, tests
from .routers import auth
from .routers import settings as settings_router
from .routers import agent as agent_router
from .routers import audit as audit_router
from .routers import assistant as assistant_router
from .routers import atomic as atomic_router
from .routers import mitre as mitre_router
from .routers import rbac as rbac_router
from .routers import password_reset as password_reset_router
from .routers import reports as reports_router
from .routers import onboarding as onboarding_router
from .routers import proposals as proposals_router
from .routers import notifications as notifications_router
from .routers import detection_sources as detection_sources_router
from .routers import detection_mirrors as detection_mirrors_router
from .security import hash_password, verify_password
from .utils.security import validate_jwt_secret
from .services.audit_retention import run_audit_retention_loop
from .services.test_retention import run_test_retention_loop
from .services.test_reconciliation import reconcile_stale_tests

logger = logging.getLogger("purvex.api")
MANAGED_SCHEMA_ENVS = {"prod", "staging", "beta"}
STRICT_SECURITY_ENVS = MANAGED_SCHEMA_ENVS


async def _atomic_warmup_wrapper(preload):
    """Log the outcome of Atomic catalog preload without blocking startup."""
    try:
        count = await preload()
        if count:
            logger.info("Atomic catalog warmed: %d tests loaded", count)
        else:
            logger.debug("Atomic catalog warmup returned 0 tests")
    except Exception:
        logger.exception("Atomic catalog warmup raised")


def _is_managed_schema_env() -> bool:
    return settings.DEPLOYMENT_ENV.lower() in MANAGED_SCHEMA_ENVS


def _current_alembic_head() -> str:
    """Return the expected Alembic head revision from the local migration tree."""
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
    except ImportError as exc:
        raise RuntimeError("Alembic is required for beta/staging/production startup checks.") from exc

    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    script = ScriptDirectory.from_config(config)
    head = script.get_current_head()
    if not head:
        raise RuntimeError("No Alembic migration head found.")
    return head


async def verify_database_migrations_current() -> None:
    """Fail fast when a managed deployment schema is not managed by Alembic."""
    expected_head = _current_alembic_head()

    async with async_engine.begin() as conn:
        def check_version(sync_conn):
            inspector = inspect(sync_conn)
            if not inspector.has_table("alembic_version"):
                raise RuntimeError(
                    "Database is missing alembic_version. Run `alembic upgrade head` "
                    "before starting PurveX in beta/staging/production."
                )
            rows = sync_conn.execute(text("SELECT version_num FROM alembic_version")).fetchall()
            versions = {row[0] for row in rows}
            if expected_head not in versions:
                raise RuntimeError(
                    f"Database migration version mismatch. Expected Alembic head "
                    f"{expected_head!r}, found {sorted(versions)!r}. Run `alembic upgrade head`."
                )

        await conn.run_sync(check_version)


def ensure_bcrypt_compatible():
    """
    Smoke-test the bcrypt + passlib stack at startup.

    Why a functional check, not a version pin
    ----------------------------------------
    The previous version of this guard rejected bcrypt >=4.x to keep
    compatibility with passlib 1.7.x's bcrypt wrapper. That worked when the
    project pinned bcrypt 3.2.2, but bcrypt 3.x is unmaintained and the 2026-05
    security audit moved us to bcrypt >=4.2.0. With bcrypt 4.x + passlib 1.7.4
    you'll see a benign "(trapped) error reading bcrypt version" warning the
    first time passlib loads the backend — passlib looks for `bcrypt.__about__`
    which 4.x removed. Hashing and verification still work, so we'd rather
    prove that than block boot on a cosmetic warning.

    What this does
    --------------
    1. Verifies bcrypt is importable.
    2. Round-trips a throwaway password through the same `pwd_context` the
       login path uses. If hashing or verification fails, we fail fast with a
       clear error so operators don't discover it on the first login attempt.
    """
    try:
        import bcrypt  # type: ignore  # noqa: F401  (proves the package is installed)
    except ImportError as exc:
        raise RuntimeError(
            "bcrypt is not installed; install backend requirements before starting the API."
        ) from exc

    try:
        from .security import pwd_context

        sample = "purvex-startup-probe"
        digest = pwd_context.hash(sample)
        if not pwd_context.verify(sample, digest):
            raise RuntimeError("bcrypt round-trip verification returned False")
    except Exception as exc:
        raise RuntimeError(
            "bcrypt + passlib stack is broken: password hashing failed at startup. "
            "Reinstall backend requirements (`pip install -r requirements.txt`) and "
            "verify your bcrypt/passlib versions."
        ) from exc

    logger.debug(
        "bcrypt %s + passlib hash round-trip OK at startup.",
        getattr(bcrypt, "__version__", "unknown"),
    )

# SECURITY: Configure request size limits to prevent DoS attacks
# Max request body size: 10MB (adjust based on needs)
app = FastAPI(
    title="PurveX API",
    # Request size limits
    max_request_size=10 * 1024 * 1024,  # 10MB
)


@app.on_event("startup")
async def configure_observability():
    """Enable OpenTelemetry tracing when an OTLP endpoint is configured."""
    try:
        from .tracing import configure_tracing
        configure_tracing(app, engine=async_engine)
    except Exception:
        logger.exception("Failed to configure tracing (non-fatal)")


@app.on_event("startup")  # Register as a startup event
async def create_db_and_tables():
    """Create database tables and ensure a default admin exists for first‑run.

    In production you should rotate the default admin credentials and
    eventually disable CREATE_DEFAULT_ADMIN.
    """
    try:
        if _is_managed_schema_env():
            await verify_database_migrations_current()
            logger.info("Database migration state is current.")

        # Create tables using SQLAlchemy metadata
        async with async_engine.begin() as conn:
            if not _is_managed_schema_env():
                await conn.run_sync(Base.metadata.create_all)
            # Ensure new columns exist in legacy databases (lightweight migration).
            def ensure_tests_endpoint(sync_conn):
                inspector = inspect(sync_conn)
                columns = {col["name"] for col in inspector.get_columns("tests")}
                if "endpoint" not in columns:
                    sync_conn.execute(text("ALTER TABLE tests ADD COLUMN endpoint VARCHAR(255)"))
                if "initiated_by_user_id" not in columns:
                    sync_conn.execute(text("ALTER TABLE tests ADD COLUMN initiated_by_user_id INTEGER"))
                if "initiated_by_email" not in columns:
                    sync_conn.execute(text("ALTER TABLE tests ADD COLUMN initiated_by_email VARCHAR(255)"))
                if "initiated_by_username" not in columns:
                    sync_conn.execute(text("ALTER TABLE tests ADD COLUMN initiated_by_username VARCHAR(100)"))
                if "initiated_by_role" not in columns:
                    sync_conn.execute(text("ALTER TABLE tests ADD COLUMN initiated_by_role VARCHAR(100)"))
                # Backfill columns added by alembic 0003 for legacy SQLite
                # databases that pre-date the migration.
                if "atomic_test_id" not in columns:
                    sync_conn.execute(text("ALTER TABLE tests ADD COLUMN atomic_test_id VARCHAR(255)"))
                if "atomic_test_name" not in columns:
                    sync_conn.execute(text("ALTER TABLE tests ADD COLUMN atomic_test_name VARCHAR(500)"))
                if "atomic_test_number" not in columns:
                    sync_conn.execute(text("ALTER TABLE tests ADD COLUMN atomic_test_number INTEGER"))
                # Lightweight backfill for the run-mode column. Mirrors the
                # Alembic 0004 migration for managed environments.
                if "mode" not in columns:
                    sync_conn.execute(text(
                        "ALTER TABLE tests ADD COLUMN mode VARCHAR(50) "
                        "NOT NULL DEFAULT 'DETECTION_VALIDATION'"
                    ))
                user_columns = {col["name"] for col in inspector.get_columns("users")}
                if "username" not in user_columns:
                    sync_conn.execute(text("ALTER TABLE users ADD COLUMN username VARCHAR(100)"))
                # Mirror Alembic 0015 for legacy SQLite databases that pre-date
                # password-change session revocation. Without this column,
                # every User query errors with "no such column".
                if "token_valid_after" not in user_columns:
                    sync_conn.execute(text("ALTER TABLE users ADD COLUMN token_valid_after DATETIME"))
                runner_columns = {col["name"] for col in inspector.get_columns("environment_runner_configs")}
                if "os" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN os VARCHAR(255)"))
                if "ip_address" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN ip_address VARCHAR(255)"))
                if "agent_version" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN agent_version VARCHAR(255)"))
                if "last_check_in" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN last_check_in DATETIME"))
                if "status" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN status VARCHAR(100)"))
                if "runner_token_hash" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN runner_token_hash VARCHAR(255)"))
                if "runner_token_last_rotated_at" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN runner_token_last_rotated_at DATETIME"))
                if "runner_token_expires_at" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN runner_token_expires_at DATETIME"))
                if "owner_name" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN owner_name VARCHAR(255)"))
                if "owner_email" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN owner_email VARCHAR(255)"))
                if "siem_connection_id" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN siem_connection_id INTEGER"))
                # Mirror Alembic 0009 for legacy SQLite databases that pre-date
                # SSH host-key pinning. Without this column, every list/run
                # against EnvironmentRunnerConfig errors with "no such column".
                if "ssh_host_key_sha256" not in runner_columns:
                    sync_conn.execute(text("ALTER TABLE environment_runner_configs ADD COLUMN ssh_host_key_sha256 VARCHAR(255)"))
                ai_columns = {col["name"] for col in inspector.get_columns("ai_assistant_settings")}
                if "analysis_mode" not in ai_columns:
                    sync_conn.execute(text("ALTER TABLE ai_assistant_settings ADD COLUMN analysis_mode VARCHAR(50)"))
                policy_columns = {col["name"] for col in inspector.get_columns("testing_policies")}
                if "test_data_retention_days" not in policy_columns:
                    sync_conn.execute(text("ALTER TABLE testing_policies ADD COLUMN test_data_retention_days INTEGER DEFAULT 90"))
                if "retention_pass_days_lab" not in policy_columns:
                    sync_conn.execute(text("ALTER TABLE testing_policies ADD COLUMN retention_pass_days_lab INTEGER DEFAULT 7"))
                if "retention_fail_days_lab" not in policy_columns:
                    sync_conn.execute(text("ALTER TABLE testing_policies ADD COLUMN retention_fail_days_lab INTEGER DEFAULT 30"))
                if "retention_pass_days_dev" not in policy_columns:
                    sync_conn.execute(text("ALTER TABLE testing_policies ADD COLUMN retention_pass_days_dev INTEGER DEFAULT 30"))
                if "retention_fail_days_dev" not in policy_columns:
                    sync_conn.execute(text("ALTER TABLE testing_policies ADD COLUMN retention_fail_days_dev INTEGER DEFAULT 90"))
                if "retention_pass_days_prod" not in policy_columns:
                    sync_conn.execute(text("ALTER TABLE testing_policies ADD COLUMN retention_pass_days_prod INTEGER DEFAULT 90"))
                if "retention_fail_days_prod" not in policy_columns:
                    sync_conn.execute(text("ALTER TABLE testing_policies ADD COLUMN retention_fail_days_prod INTEGER DEFAULT 180"))
                # Backfill runner org_id for legacy rows
                sync_conn.execute(text(
                    "UPDATE environment_runner_configs SET organization_id = (SELECT id FROM organizations LIMIT 1) "
                    "WHERE organization_id IS NULL"
                ))
                detection_columns = {col["name"] for col in inspector.get_columns("detections")}
                if "siem_connection_id" not in detection_columns:
                    sync_conn.execute(text("ALTER TABLE detections ADD COLUMN siem_connection_id INTEGER"))
                if "external_id" not in detection_columns:
                    sync_conn.execute(text("ALTER TABLE detections ADD COLUMN external_id VARCHAR(255)"))
                if "content_hash" not in detection_columns:
                    sync_conn.execute(text("ALTER TABLE detections ADD COLUMN content_hash VARCHAR(64)"))
                if "source" not in detection_columns:
                    sync_conn.execute(text("ALTER TABLE detections ADD COLUMN source VARCHAR(32) DEFAULT 'manual'"))
                if "enabled_upstream" not in detection_columns:
                    sync_conn.execute(text("ALTER TABLE detections ADD COLUMN enabled_upstream BOOLEAN"))
                if "last_synced_at" not in detection_columns:
                    sync_conn.execute(text("ALTER TABLE detections ADD COLUMN last_synced_at DATETIME"))
                if "drift_detected_at" not in detection_columns:
                    sync_conn.execute(text("ALTER TABLE detections ADD COLUMN drift_detected_at DATETIME"))
                # Git provenance columns (alembic 0007 — Detection-as-Code).
                if "detection_source_id" not in detection_columns:
                    sync_conn.execute(
                        text(
                            "ALTER TABLE detections ADD COLUMN detection_source_id INTEGER"
                        )
                    )
                if "source_path" not in detection_columns:
                    sync_conn.execute(
                        text("ALTER TABLE detections ADD COLUMN source_path VARCHAR(500)")
                    )
                if "source_commit_sha" not in detection_columns:
                    sync_conn.execute(
                        text(
                            "ALTER TABLE detections ADD COLUMN source_commit_sha VARCHAR(64)"
                        )
                    )
                if "source_payload" not in detection_columns:
                    sync_conn.execute(
                        text("ALTER TABLE detections ADD COLUMN source_payload TEXT")
                    )

                # Backfill composite performance indexes (alembic 0005) on
                # legacy SQLite databases. create_all() only makes missing
                # tables, not missing indexes on existing tables.
                existing_indexes: set[str] = set()
                for tbl in ("tests", "audit_events", "jobs"):
                    try:
                        existing_indexes.update(
                            ix["name"] for ix in inspector.get_indexes(tbl)
                        )
                    except Exception:
                        continue

                perf_indexes = [
                    ("ix_tests_org_started_at", "tests", "organization_id, started_at"),
                    ("ix_tests_detection_mode_started", "tests", "detection_id, mode, started_at"),
                    ("ix_tests_org_status", "tests", "organization_id, status"),
                    ("ix_audit_events_created_at", "audit_events", "created_at"),
                    ("ix_audit_events_action_created_at", "audit_events", "action, created_at"),
                    ("ix_jobs_status_enqueued_at", "jobs", "status, enqueued_at"),
                    ("ix_jobs_org_enqueued_at", "jobs", "organization_id, enqueued_at"),
                ]
                for name, table, cols in perf_indexes:
                    if name in existing_indexes:
                        continue
                    try:
                        sync_conn.execute(
                            text(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({cols})")
                        )
                    except Exception as exc:  # pragma: no cover - defensive
                        logger.debug("Skipped index %s: %s", name, exc)
            if not _is_managed_schema_env():
                await conn.run_sync(ensure_tests_endpoint)
        
        # Automatically run RBAC migration on startup.
        from .services.rbac_migration import run_rbac_migration
        await run_rbac_migration()
        
        # SECURITY: Enforce strong JWT secret in every managed deployment.
        is_managed_deployment = settings.DEPLOYMENT_ENV.lower() in STRICT_SECURITY_ENVS
        if not validate_jwt_secret(settings.JWT_SECRET_KEY):
            error_msg = (
                "SECURITY ERROR: JWT_SECRET_KEY is weak or default. "
                "Please set a strong secret via JWT_SECRET_KEY environment variable. "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
            )
            if is_managed_deployment:
                logger.error(error_msg)
                raise RuntimeError(
                    "CRITICAL SECURITY ERROR: Cannot start a managed deployment with a weak JWT secret. "
                    "Set JWT_SECRET_KEY environment variable to a strong secret (32+ characters)."
                )
            else:
                logger.warning(error_msg)

        # Verify bcrypt compatibility early to avoid login crashes.
        ensure_bcrypt_compatible()

        reconciled = await reconcile_stale_tests(
            async_sessionmaker,
            timeout_minutes=settings.STALE_TEST_TIMEOUT_MINUTES,
        )
        if reconciled:
            logger.warning("Reconciled %d stale test run(s) during startup", reconciled)
        
        # SECURITY: Enforce beta/staging/production security requirements.

        # Block default admin creation in managed deployments.
        if is_managed_deployment and settings.CREATE_DEFAULT_ADMIN:
            logger.error(
                "SECURITY ERROR: CREATE_DEFAULT_ADMIN cannot be True in beta/staging/production. "
                "This would create a well-known admin account."
            )
            raise RuntimeError(
                "CRITICAL SECURITY ERROR: CREATE_DEFAULT_ADMIN must be False in managed deployments. "
                "Set CREATE_DEFAULT_ADMIN=false in your environment configuration."
            )
        
        # Check for default admin credentials in managed deployments.
        if is_managed_deployment:
            async with async_sessionmaker() as session:
                result = await session.execute(
                    select(models.User).where(
                        models.User.email == settings.DEFAULT_ADMIN_EMAIL,
                        models.User.is_admin == True
                    )
                )
                existing_admin = result.scalar_one_or_none()
                if existing_admin:
                    # Verify password is not default (check if hash matches default password)
                    if settings.DEFAULT_ADMIN_PASSWORD and verify_password(
                        settings.DEFAULT_ADMIN_PASSWORD,
                        existing_admin.hashed_password,
                    ):
                        logger.error(
                            f"SECURITY ERROR: Default admin credentials detected for user '{settings.DEFAULT_ADMIN_EMAIL}'. "
                            "This is a critical security risk in a managed deployment."
                        )
                        raise RuntimeError(
                            f"CRITICAL SECURITY ERROR: Default admin credentials detected. "
                            f"User '{settings.DEFAULT_ADMIN_EMAIL}' still has default password. "
                            "Change the admin password before opening the deployment to users."
                        )
        
        # The auto-create-admin path is opt-in only: an operator must
        # explicitly set CREATE_DEFAULT_ADMIN=true *and* provide their own
        # DEFAULT_ADMIN_PASSWORD. The default beta install relies on the
        # launcher's interactive bootstrap (scripts/create_admin.py), so this
        # block stays disabled and admin/admin can never be created
        # implicitly. Managed deployments never enter this branch.
        if settings.CREATE_DEFAULT_ADMIN and not is_managed_deployment:
            if not settings.DEFAULT_ADMIN_PASSWORD:
                raise RuntimeError(
                    "DEFAULT_ADMIN_PASSWORD must be set when CREATE_DEFAULT_ADMIN=true. "
                    "There is no built-in default password."
                )
            async with async_sessionmaker() as session:
                # Get or create default organization
                org_result = await session.execute(select(models.Organization))
                org = org_result.scalars().first()
                if not org:
                    org = models.Organization(
                        name=settings.ORGANIZATION_NAME,
                        primary_contact_email=settings.PRIMARY_CONTACT_EMAIL,
                        timezone=settings.DEFAULT_TIMEZONE,
                        locale=settings.DEFAULT_LOCALE,
                        default_environment_names=settings.DEFAULT_ENVIRONMENT_NAMES,
                        compliance_mode_flags=settings.COMPLIANCE_MODE_FLAGS,
                    )
                    session.add(org)
                    await session.commit()
                    await session.refresh(org)
                
                # Check if admin user exists
                result = await session.execute(
                    select(models.User).where(models.User.email == settings.DEFAULT_ADMIN_EMAIL)
                )
                admin = result.scalars().first()
                if admin is None:
                    admin = models.User(
                        username="admin",
                        email=settings.DEFAULT_ADMIN_EMAIL,
                        hashed_password=hash_password(settings.DEFAULT_ADMIN_PASSWORD),
                        is_admin=True,
                        is_active=True,
                        organization_id=org.id,
                    )
                    session.add(admin)
                    await session.commit()
                    await session.refresh(admin)
                    
                    # Assign ADMINISTRATOR role to the admin user
                    from .services.rbac import Role as RoleEnum
                    role_result = await session.execute(
                        select(models.Role).where(
                            models.Role.name == RoleEnum.ADMINISTRATOR.value,
                            or_(models.Role.organization_id == org.id, models.Role.organization_id.is_(None)),
                        )
                    )
                    admin_role = role_result.scalar_one_or_none()
                    if admin_role:
                        # Check if user already has this role
                        existing_role = await session.execute(
                            select(models.UserRole).where(
                                models.UserRole.user_id == admin.id,
                                models.UserRole.role_id == admin_role.id,
                                models.UserRole.organization_id == org.id,
                            )
                        )
                        if not existing_role.scalar_one_or_none():
                            user_role = models.UserRole(
                                user_id=admin.id,
                                role_id=admin_role.id,
                                organization_id=org.id,
                            )
                            session.add(user_role)
                            await session.commit()
                    
                    logger.info(
                        "Created default admin user '%s' in %s environment (change the password immediately).",
                        settings.DEFAULT_ADMIN_EMAIL,
                        settings.DEPLOYMENT_ENV,
                    )
                else:
                    # Ensure existing admin has the ADMINISTRATOR role
                    from .services.rbac import Role as RoleEnum
                    role_result = await session.execute(
                        select(models.Role).where(models.Role.name == RoleEnum.ADMINISTRATOR.value)
                    )
                    admin_role = role_result.scalar_one_or_none()
                    if admin_role:
                        existing_role = await session.execute(
                            select(models.UserRole).where(
                                models.UserRole.user_id == admin.id,
                                models.UserRole.role_id == admin_role.id,
                                models.UserRole.organization_id == admin.organization_id,
                            )
                        )
                        if not existing_role.scalar_one_or_none():
                            user_role = models.UserRole(
                                user_id=admin.id,
                                role_id=admin_role.id,
                                organization_id=admin.organization_id,
                            )
                            session.add(user_role)
                            await session.commit()
                            logger.info("Assigned ADMINISTRATOR role to existing admin user")

        # JWT secret presence is enforced at module import time (config.py).
        # Production refuses to boot when JWT_SECRET_KEY is missing; non-prod
        # logs a warning and uses an ephemeral key.

        logger.info(
            "PurveX API started with CORS_ORIGINS=%s", ",".join(settings.CORS_ORIGINS)
        )
        
        if settings.AI_PROVIDER.strip().lower() == "openai":
            if settings.OPENAI_API_KEY:
                logger.info(
                    "OpenAI integration enabled with model %s",
                    settings.OPENAI_MODEL,
                )
            else:
                logger.warning(
                    "OpenAI integration is selected but OPENAI_API_KEY is not configured. "
                    "Watchtower AI will report provider unavailability until it is configured."
                )
        
        # Start the test scheduler worker
        from .services.test_scheduler import start_scheduler
        try:
            start_scheduler(interval_seconds=60)  # Check every minute
            logger.info("Test scheduler worker started")
        except Exception as scheduler_err:
            logger.warning(f"Failed to start test scheduler: {scheduler_err}")

        # Start the SIEM → git audit mirror scheduler. Cadence is governed
        # by PURVEX_MIRROR_SCHEDULER_INTERVAL_SEC (default 900s). Disable
        # with PURVEX_MIRROR_SCHEDULER_ENABLED=false if you only want
        # manual (endpoint-triggered) syncs.
        try:
            from .services.mirror_scheduler import start_mirror_scheduler

            start_mirror_scheduler()
            logger.info("Mirror scheduler worker started")
        except Exception as mirror_err:
            logger.warning(f"Failed to start mirror scheduler: {mirror_err}")

        # Warm the Atomic Red Team catalog off the hot path so the first
        # /atomic/tests request doesn't pay the full parse cost. Runs as a
        # fire-and-forget task; failures only affect first-request latency.
        try:
            from .routers.atomic import preload_atomic_catalog

            asyncio.create_task(_atomic_warmup_wrapper(preload_atomic_catalog))
        except Exception as warm_err:  # pragma: no cover - defensive
            logger.warning(f"Atomic catalog warmup skipped: {warm_err}")

        # Start audit retention cleanup loop
        if settings.AUDIT_RETENTION_ENABLED:
            asyncio.create_task(
                run_audit_retention_loop(
                    async_sessionmaker,
                    retention_days=settings.AUDIT_RETENTION_DAYS,
                    interval_hours=settings.AUDIT_RETENTION_INTERVAL_HOURS,
                )
            )
            logger.info(
                "Audit retention enabled: %s days, interval %s hours",
                settings.AUDIT_RETENTION_DAYS,
                settings.AUDIT_RETENTION_INTERVAL_HOURS,
            )

        # Start test retention cleanup loop
        if settings.TEST_RETENTION_ENABLED:
            asyncio.create_task(
                run_test_retention_loop(
                    async_sessionmaker,
                    retention_days=settings.TEST_RETENTION_DAYS,
                    interval_hours=settings.TEST_RETENTION_INTERVAL_HOURS,
                )
            )
            logger.info(
                "Test retention enabled: %s days, interval %s hours",
                settings.TEST_RETENTION_DAYS,
                settings.TEST_RETENTION_INTERVAL_HOURS,
            )
        
    except asyncio.CancelledError:
        # Handle cancellation gracefully during hot reload
        logger.warning("Startup cancelled (likely due to hot reload)")
        # Stop schedulers on cancellation
        try:
            from .services.test_scheduler import stop_scheduler
            await stop_scheduler()
        except Exception:
            pass
        try:
            from .services.mirror_scheduler import stop_mirror_scheduler
            await stop_mirror_scheduler()
        except Exception:
            pass
        raise
    except Exception as e:
        logger.error(f"Error during startup: {e}", exc_info=True)
        raise


# Production environment check
IS_PRODUCTION = settings.DEPLOYMENT_ENV.lower() == "prod"

def parse_cors_origins(raw_value: str) -> list[str]:
    if not raw_value:
        return []
    value = raw_value.strip()
    if value.startswith("["):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(origin).strip() for origin in parsed if str(origin).strip()]
        except json.JSONDecodeError:
            pass
    return [origin.strip() for origin in value.split(",") if origin.strip()]

# Security middleware (add first, processes responses last)
# RequestContextMiddleware is added last so it runs FIRST on inbound — every
# other middleware sees the correlation ID.
app.add_middleware(SecurityHeadersMiddleware)
if os.getenv("PURVEX_ENV", "dev").lower() == "prod":
    app.add_middleware(RateLimitMiddleware, max_requests=100, window_seconds=60)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(CSRFProtectionMiddleware)
app.add_middleware(PrometheusMiddleware)
app.add_middleware(RequestContextMiddleware)

# Production security middleware
from .middleware.production import HTTPSEnforcementMiddleware, RequestSizeLimitMiddleware
if IS_PRODUCTION:
    app.add_middleware(HTTPSEnforcementMiddleware, enforce_https=True)
    # 10MB request size limit in production (configurable via env var)
    max_request_size = int(os.getenv("MAX_REQUEST_SIZE_MB", "10")) * 1024 * 1024
    app.add_middleware(RequestSizeLimitMiddleware, max_request_size=max_request_size)
    logger.info(f"Production security enabled: HTTPS enforcement and {max_request_size / (1024*1024):.0f}MB request limit")

# CORS middleware (must be after security middleware)
# SECURITY: Restrict CORS in production to specific origins
if IS_PRODUCTION:
    # In production, only allow explicitly configured origins
    # If CORS_ORIGINS is not set, default to empty list (no CORS allowed)
    production_origins = parse_cors_origins(os.getenv("CORS_ORIGINS", ""))
    
    if not production_origins:
        logger.warning(
            "SECURITY WARNING: No CORS origins configured for production. "
            "Set CORS_ORIGINS environment variable with comma-separated list of allowed origins."
        )
    
    app.add_middleware(
        CORSMiddleware,
        allow_origins=production_origins,  # Only explicitly allowed origins
        allow_origin_regex=None,  # Disable regex in production
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
        expose_headers=["X-RateLimit-Remaining", "X-RateLimit-Reset"],
        max_age=3600,  # Cache preflight for 1 hour
    )
    logger.info(f"Production CORS configured with {len(production_origins)} allowed origin(s)")
else:
    # Development: Allow localhost and private IPs
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_origin_regex=settings.CORS_ALLOW_ORIGIN_REGEX,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )


# Global exception handlers to ensure CORS headers and security headers are always present
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Ensure CORS headers and security headers are present on HTTPException responses."""
    origin = request.headers.get("origin")
    if origin and (
        origin in settings.CORS_ORIGINS
        or (settings.CORS_ALLOW_ORIGIN_REGEX and re.match(settings.CORS_ALLOW_ORIGIN_REGEX, origin))
    ):
        headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        }
    else:
        headers = {}
    
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # SECURITY: Add security headers to validation error responses
    from .middleware.security import SecurityHeadersMiddleware
    import os
    IS_PRODUCTION = os.getenv("PURVEX_ENV", "dev").lower() == "prod"
    
    security_headers = {
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
    }
    
    if IS_PRODUCTION:
        csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests;"
        security_headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    else:
        csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    security_headers["Content-Security-Policy"] = csp
    
    origin = request.headers.get("origin")
    headers = {}
    
    if IS_PRODUCTION:
        # In production, only allow explicitly configured origins
        production_origins = os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else []
        production_origins = [o.strip() for o in production_origins if o.strip()]
        if origin and origin in production_origins:
            headers = {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
            }
    else:
        # Development: Allow localhost and private IPs
        if origin and (
            origin in settings.CORS_ORIGINS
            or (settings.CORS_ALLOW_ORIGIN_REGEX and re.match(settings.CORS_ALLOW_ORIGIN_REGEX, origin))
        ):
            headers = {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
            }
    
    headers.update(security_headers)
    
    # BUGFIX: exc.errors() can contain raw exception objects (e.g.
    # ctx.error is the actual ValueError instance whenever a
    # @field_validator raises ValueError(...) — a very common pattern
    # throughout this codebase). Passing that straight to JSONResponse's
    # plain json.dumps crashes with a 500 instead of returning the 422 this
    # handler exists to produce. jsonable_encoder converts non-serializable
    # values (like the exception object) to strings first.
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": jsonable_encoder(exc.errors())},
        headers=headers,
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Ensure CORS headers and security headers are present on all error responses, including 500s."""
    logger.exception("Unhandled exception", exc_info=exc)
    origin = request.headers.get("origin")
    headers = {}
    
    # SECURITY: Add security headers to all error responses
    import os
    IS_PRODUCTION = os.getenv("PURVEX_ENV", "dev").lower() == "prod"
    
    security_headers = {
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "X-XSS-Protection": "1; mode=block",
        "Referrer-Policy": "strict-origin-when-cross-origin",
    }
    
    if IS_PRODUCTION:
        csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests;"
        security_headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    else:
        csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    security_headers["Content-Security-Policy"] = csp
    
    headers.update(security_headers)
    
    if IS_PRODUCTION:
        # In production, only allow explicitly configured origins
        production_origins = os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else []
        production_origins = [o.strip() for o in production_origins if o.strip()]
        if origin and origin in production_origins:
            headers = {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
            }
    else:
        # Development: Allow localhost and private IPs
        if origin and (
            origin in settings.CORS_ORIGINS
            or (settings.CORS_ALLOW_ORIGIN_REGEX and re.match(settings.CORS_ALLOW_ORIGIN_REGEX, origin))
        ):
            headers = {
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
            }
    
    headers.update(security_headers)
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
        headers=headers,
    )

app.include_router(auth.router)  # /auth/login, /auth/me, /auth/register
app.include_router(detections.router)  # existing
app.include_router(tests.router)  # existing
app.include_router(settings_router.router)
app.include_router(agent_router.router)
app.include_router(audit_router.router)
app.include_router(assistant_router.router)
app.include_router(atomic_router.router)
app.include_router(mitre_router.router)
app.include_router(rbac_router.router)  # /rbac/me/roles, /rbac/me/permissions, etc.
app.include_router(password_reset_router.router)
app.include_router(reports_router.router)  # /reports/generate, /reports/, /reports/{report_id}/download
app.include_router(onboarding_router.router)  # /onboarding/status
app.include_router(proposals_router.router)  # /proposals (AI remediation guardrails)
app.include_router(notifications_router.router)  # /notifications (persisted platform inbox)
app.include_router(detection_sources_router.router)  # /detection-sources (DaC sync)
app.include_router(detection_mirrors_router.router)  # /detection-mirrors (SIEM-to-Git audit mirror)


@app.get("/health")
async def health():
    """Simple liveness endpoint for load balancers and uptime checks."""
    return {"status": "ok"}


@app.get("/metrics", include_in_schema=False)
async def metrics():
    """Prometheus-format metrics exposition."""
    return metrics_response()


@app.get("/ready")
@app.get("/health/dependencies")
async def ready():
    """Readiness probe that verifies every hard dependency."""
    checks: dict[str, dict] = {}
    overall_ok = True

    try:
        async with async_sessionmaker() as session:
            await session.execute(select(1))
        checks["database"] = {"status": "ok"}
    except Exception as exc:
        overall_ok = False
        checks["database"] = {"status": "error", "detail": str(exc)[:200]}
        logger.exception("Database readiness check failed", exc_info=exc)

    try:
        from .utils.redis_client import get_redis_client
        client = get_redis_client()
        if client is None:
            checks["redis"] = {"status": "disabled"}
        else:
            client.ping()
            checks["redis"] = {"status": "ok"}
    except Exception as exc:
        # Redis is optional — don't fail readiness if it's down.
        checks["redis"] = {"status": "degraded", "detail": str(exc)[:200]}

    payload = {"status": "ready" if overall_ok else "not_ready", "checks": checks}
    if not overall_ok:
        raise HTTPException(status_code=503, detail=payload)
    return payload


@app.on_event("shutdown")
async def shutdown_event():
    """Graceful shutdown: stop background workers and close DB connections.

    Order matters — stop schedulers first so they don't fire new DB work while
    we're tearing down the engine.
    """
    logger.info("Shutdown requested — draining background workers")

    try:
        from .services.test_scheduler import stop_scheduler
        await stop_scheduler()
        logger.info("Test scheduler stopped")
    except Exception as exc:
        logger.warning(f"Error stopping scheduler: {exc}")

    try:
        from .services.mirror_scheduler import stop_mirror_scheduler
        await stop_mirror_scheduler()
        logger.info("Mirror scheduler stopped")
    except Exception as exc:
        logger.warning(f"Error stopping mirror scheduler: {exc}")

    try:
        from .jobs import drain_inprocess_jobs

        drained = await drain_inprocess_jobs(timeout_seconds=30)
        if drained:
            logger.info("Drained %d in-process background job(s)", drained)
    except Exception as exc:
        logger.warning(f"Error draining in-process jobs: {exc}")

    try:
        await async_engine.dispose()
        logger.info("Database engine disposed")
    except Exception as exc:
        logger.warning(f"Error disposing database engine: {exc}")

    try:
        from .utils.redis_client import get_redis_client
        client = get_redis_client()
        if client is not None:
            client.close()
            logger.info("Redis client closed")
    except Exception as exc:
        logger.warning(f"Error closing Redis client: {exc}")

    logger.info("Shutdown complete")
