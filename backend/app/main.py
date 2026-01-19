import asyncio
import logging
import os
import sys
import re

# Add the project root to the Python path to allow absolute imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select
from starlette.exceptions import HTTPException as StarletteHTTPException
from .middleware.security import SecurityHeadersMiddleware, RateLimitMiddleware, RequestLoggingMiddleware
from .middleware.csrf import CSRFProtectionMiddleware

from .config import settings
from . import models
from .db import Base, async_engine, async_sessionmaker
from .routers import detections, tests
from .routers import auth
from .routers import settings as settings_router
from .routers import audit as audit_router
from .routers import assistant as assistant_router
from .routers import atomic as atomic_router
from .routers import mitre as mitre_router
from .routers import sandbox as sandbox_router
from .routers import rbac as rbac_router
from .routers import auth_2fa as auth_2fa_router
from .routers import password_reset as password_reset_router
from .routers import reports as reports_router
from .security import hash_password, verify_password
from .utils.security import validate_jwt_secret
from .services.audit_retention import run_audit_retention_loop

logger = logging.getLogger("purvex.api")


def ensure_bcrypt_compatible():
    """
    Guard against bcrypt versions that are incompatible with passlib 1.7.x.
    Newer bcrypt (>=4.x) breaks passlib's bcrypt wrapper and causes 500s on login.
    """
    try:
        import bcrypt  # type: ignore
    except ImportError as exc:
        raise RuntimeError("bcrypt is not installed; install backend requirements before starting the API.") from exc

    version_str = getattr(bcrypt, "__version__", "0")
    try:
        major = int(version_str.split(".")[0])
    except Exception:
        major = 0

    if major >= 4:
        raise RuntimeError(
            "Unsupported bcrypt version detected (>=4.x). "
            "Install bcrypt==3.2.2 to stay compatible with passlib (pip install -r requirements.txt)."
        )
    logger.debug("bcrypt version %s detected; compatible with passlib.", version_str)

# SECURITY: Configure request size limits to prevent DoS attacks
# Max request body size: 10MB (adjust based on needs)
app = FastAPI(
    title="PurveX API",
    # Request size limits
    max_request_size=10 * 1024 * 1024,  # 10MB
)


@app.on_event("startup")  # Register as a startup event
async def create_db_and_tables():
    """Create database tables and ensure a default admin exists for first‑run.

    In production you should rotate the default admin credentials and
    eventually disable CREATE_DEFAULT_ADMIN.
    """
    try:
        # Create tables using SQLAlchemy metadata
        async with async_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        
        # Automatically run RBAC migration on startup
        # Temporarily disabled to debug startup hang
        # from .services.rbac_migration import run_rbac_migration
        # await run_rbac_migration()
        logger.info("RBAC migration temporarily disabled for debugging")
        
        # SECURITY: Enforce strong JWT secret in production
        is_production = settings.DEPLOYMENT_ENV.lower() == "prod"
        if not validate_jwt_secret(settings.JWT_SECRET_KEY):
            error_msg = (
                "SECURITY ERROR: JWT_SECRET_KEY is weak or default. "
                "Please set a strong secret via JWT_SECRET_KEY environment variable. "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
            )
            if is_production:
                logger.error(error_msg)
                raise RuntimeError(
                    "CRITICAL SECURITY ERROR: Cannot start in production with weak JWT secret. "
                    "Set JWT_SECRET_KEY environment variable to a strong secret (32+ characters)."
                )
            else:
                logger.warning(error_msg)

        # Verify bcrypt compatibility early to avoid login crashes.
        ensure_bcrypt_compatible()
        
        # SECURITY: Enforce production security requirements
        is_production = settings.DEPLOYMENT_ENV.lower() == "prod"
        
        # Block default admin creation in production
        if is_production and settings.CREATE_DEFAULT_ADMIN:
            logger.error(
                "SECURITY ERROR: CREATE_DEFAULT_ADMIN cannot be True in production. "
                "This would create a well-known admin account."
            )
            raise RuntimeError(
                "CRITICAL SECURITY ERROR: CREATE_DEFAULT_ADMIN must be False in production. "
                "Set CREATE_DEFAULT_ADMIN=false in your environment configuration."
            )
        
        # Check for default admin credentials in production
        if is_production:
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
                    if verify_password(settings.DEFAULT_ADMIN_PASSWORD, existing_admin.hashed_password):
                        logger.error(
                            f"SECURITY ERROR: Default admin credentials detected for user '{settings.DEFAULT_ADMIN_EMAIL}'. "
                            "This is a critical security risk in production."
                        )
                        raise RuntimeError(
                            f"CRITICAL SECURITY ERROR: Default admin credentials detected. "
                            f"User '{settings.DEFAULT_ADMIN_EMAIL}' still has default password. "
                            "Change the admin password before deploying to production."
            )
        
        # Only create the default admin in non‑production environments. This avoids
        # shipping a well‑known username/password pair into real deployments.
        if settings.CREATE_DEFAULT_ADMIN and not is_production:
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
                        select(models.Role).where(models.Role.name == RoleEnum.ADMINISTRATOR.value)
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

                # Seed a sample detection for the default organization if none exist (dev convenience)
                detections_result = await session.execute(
                    select(models.Detection).where(models.Detection.organization_id == org.id)
                )
                if not detections_result.scalars().first():
                    sample_title = "PowerShell Command Execution"
                    sample_technique_id = "T1059.001"
                    sample_detection = models.Detection(
                        organization_id=org.id,
                        technique_id=sample_technique_id,
                        title=sample_title,
                        description=(
                            "Detects PowerShell command execution patterns and validates "
                            "telemetry coverage through Atomic Red Team."
                        ),
                        sigma_rule="title: PowerShell Command Execution\nstatus: experimental",
                        siem_type="splunk",
                        siem_query="index=windows sourcetype=\"WinEventLog:Security\" EventCode=4688 New_Process_Name=*powershell.exe*",
                        scheduled=False,
                        notes="Purpose: Validate PowerShell execution telemetry in the LAB environment.",
                    )
                    session.add(sample_detection)
                    await session.commit()
                    logger.info(
                        "Seeded sample detection '%s' (technique_id=%s) for org %s",
                        sample_title,
                        sample_technique_id,
                        org.id,
                    )

                # Normalize legacy sample detection metadata (one-time fix for dev data)
                legacy_result = await session.execute(
                    select(models.Detection).where(
                        models.Detection.organization_id == org.id,
                        models.Detection.title == "Sample PowerShell Command Execution (LAB)",
                        models.Detection.technique_id == "T1059.003",
                    )
                )
                legacy_detections = legacy_result.scalars().all()
                if legacy_detections:
                    for det in legacy_detections:
                        det.title = "PowerShell Command Execution"
                        det.technique_id = "T1059.001"
                        det.description = (
                            "Detects PowerShell command execution patterns and validates "
                            "telemetry coverage through Atomic Red Team."
                        )
                        det.sigma_rule = "title: PowerShell Command Execution\nstatus: experimental"
                        det.notes = "Purpose: Validate PowerShell execution telemetry in the LAB environment."
                        det.siem_type = "splunk"
                    await session.commit()
                    logger.info("Normalized legacy sample detection metadata for org %s", org.id)
        
        # Warn or fail fast on insecure defaults in non-dev environments.
        if settings.JWT_SECRET_KEY == "super-secret-change-me":
            if settings.DEPLOYMENT_ENV.lower() == "prod":
                # In production, refuse to start with a known default secret.
                raise RuntimeError(
                    "Refusing to start PurveX API with default JWT_SECRET_KEY in PROD. "
                    "Set a strong JWT_SECRET_KEY in the environment."
                )
            else:
                logger.warning(
                    "JWT_SECRET_KEY is still using the insecure default value – "
                    "set JWT_SECRET_KEY in the environment before running in production."
                )

        logger.info(
            "PurveX API started with CORS_ORIGINS=%s", ",".join(settings.CORS_ORIGINS)
        )
        
        # Check if Ollama is available (non-blocking, just log a warning if not)
        try:
            import httpx
            ollama_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
            with httpx.Client(timeout=2.0) as client:
                resp = client.get(f"{ollama_url}/api/tags")
                if resp.status_code == 200:
                    ollama_models = resp.json().get("models", [])
                    model_names = [m.get("name", "unknown") for m in ollama_models]
                    logger.info(f"✓ Ollama is available at {ollama_url} with models: {', '.join(model_names)}")
                else:
                    logger.warning(f"Ollama responded with status {resp.status_code} at {ollama_url}")
        except Exception as e:
            logger.warning(f"⚠ Ollama is not available at {ollama_url}. Watchtower AI features will not work. Error: {e}")
            logger.info("  To start Ollama, run: ollama serve")
            logger.info("  Or use the startup script: scripts\\start_ollama.ps1")
        
        # Start the test scheduler worker
        from .services.test_scheduler import start_scheduler
        try:
            start_scheduler(interval_seconds=60)  # Check every minute
            logger.info("✓ Test scheduler worker started")
        except Exception as scheduler_err:
            logger.warning(f"⚠ Failed to start test scheduler: {scheduler_err}")

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
        
    except asyncio.CancelledError:
        # Handle cancellation gracefully during hot reload
        logger.warning("Startup cancelled (likely due to hot reload)")
        # Stop scheduler on cancellation
        try:
            from .services.test_scheduler import stop_scheduler
            await stop_scheduler()
        except Exception:
            pass
        raise
    except Exception as e:
        logger.error(f"Error during startup: {e}", exc_info=True)
        # Don't prevent server from starting if migration fails
        # The server can still run, but RBAC might not be fully initialized


# Production environment check
IS_PRODUCTION = settings.DEPLOYMENT_ENV.lower() == "prod"

# Security middleware (add first, processes responses last)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware, max_requests=100, window_seconds=60)
app.add_middleware(RequestLoggingMiddleware)

# Production security middleware
from .middleware.production import HTTPSEnforcementMiddleware, RequestSizeLimitMiddleware
if IS_PRODUCTION:
    app.add_middleware(HTTPSEnforcementMiddleware, enforce_https=True)
    # 10MB request size limit in production (configurable via env var)
    max_request_size = int(os.getenv("MAX_REQUEST_SIZE_MB", "10")) * 1024 * 1024
    app.add_middleware(RequestSizeLimitMiddleware, max_request_size=max_request_size)
    logger.info(f"Production security enabled: HTTPS enforcement and {max_request_size / (1024*1024):.0f}MB request limit")

# CSRF protection middleware (validates tokens for state-changing requests)
from .middleware.csrf import CSRFProtectionMiddleware
app.add_middleware(CSRFProtectionMiddleware)

# CORS middleware (must be after security middleware)
# SECURITY: Restrict CORS in production to specific origins
if IS_PRODUCTION:
    # In production, only allow explicitly configured origins
    # If CORS_ORIGINS is not set, default to empty list (no CORS allowed)
    production_origins = os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else []
    production_origins = [origin.strip() for origin in production_origins if origin.strip()]
    
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
    
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors()},
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
app.include_router(audit_router.router)
app.include_router(assistant_router.router)
app.include_router(atomic_router.router)
app.include_router(mitre_router.router)
app.include_router(sandbox_router.router)
app.include_router(rbac_router.router)  # /rbac/me/roles, /rbac/me/permissions, etc.
app.include_router(auth_2fa_router.router)  # /auth/2fa/setup, /auth/2fa/verify, etc.
app.include_router(password_reset_router.router)
app.include_router(reports_router.router)  # /reports/generate, /reports/, /reports/{report_id}/download


@app.get("/health")
async def health():
    """Simple liveness endpoint for load balancers and uptime checks."""
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    """Readiness probe that verifies database connectivity."""
    try:
        async with async_sessionmaker() as session:
            # Cheap query just to ensure the connection and metadata are usable.
            await session.execute(select(1))
        return {"status": "ready"}
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.exception("Readiness check failed", exc_info=exc)
        raise HTTPException(status_code=503, detail="Service not ready")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown."""
    try:
        from .services.test_scheduler import stop_scheduler
        await stop_scheduler()
        logger.info("Test scheduler stopped")
    except Exception as exc:
        logger.warning(f"Error stopping scheduler: {exc}")
