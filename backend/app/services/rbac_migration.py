"""
Automatic RBAC migration on startup.

This module provides functions to automatically set up RBAC tables and data
when the backend starts, without requiring a manual script run.
"""
import asyncio
import logging
from sqlalchemy import text, select
from datetime import datetime

from ..db import async_sessionmaker, async_engine
from ..models import Role, Permission, RolePermission, UserRole, User
from ..services.rbac import Role as RoleEnum, Permission as PermissionEnum

logger = logging.getLogger("purvex.rbac.migration")


async def ensure_rbac_tables():
    """Ensure RBAC tables exist and add criticality column to detections if needed.
    
    Note: Tables are created by SQLAlchemy Base.metadata.create_all() in main.py,
    but we need to handle the criticality column migration separately.
    """
    try:
        async with async_engine.begin() as conn:
            # Add criticality column to detections if it doesn't exist
            # This is a migration for existing databases
            try:
                await conn.execute(text("""
                    ALTER TABLE detections ADD COLUMN criticality VARCHAR DEFAULT 'MEDIUM'
                """))
                logger.info("✅ Added criticality column to detections")
            except Exception:
                # Column might already exist - that's fine
                pass
            
            # SECURITY: Add account lockout fields to users table if they don't exist
            try:
                await conn.execute(text("""
                    ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER
                """))
                # Set default value for existing rows
                await conn.execute(text("""
                    UPDATE users SET failed_login_attempts = 0 WHERE failed_login_attempts IS NULL
                """))
                logger.info("✅ Added failed_login_attempts column to users")
            except Exception:
                # Column might already exist - that's fine
                pass
            
            try:
                await conn.execute(text("""
                    ALTER TABLE users ADD COLUMN locked_until DATETIME
                """))
                logger.info("✅ Added locked_until column to users")
            except Exception:
                # Column might already exist - that's fine
                pass
            
            # SECURITY: Add 2FA fields to users table if they don't exist
            try:
                await conn.execute(text("""
                    ALTER TABLE users ADD COLUMN two_factor_enabled BOOLEAN DEFAULT 0
                """))
                logger.info("✅ Added two_factor_enabled column to users")
            except Exception:
                # Column might already exist - that's fine
                pass
            
            try:
                await conn.execute(text("""
                    ALTER TABLE users ADD COLUMN two_factor_secret VARCHAR
                """))
                logger.info("✅ Added two_factor_secret column to users")
            except Exception:
                # Column might already exist - that's fine
                pass
            
            try:
                await conn.execute(text("""
                    ALTER TABLE users ADD COLUMN two_factor_backup_codes TEXT
                """))
                logger.info("✅ Added two_factor_backup_codes column to users")
            except Exception:
                # Column might already exist - that's fine
                pass
    except Exception as e:
        logger.warning(f"Could not add columns (may already exist): {e}")


async def seed_roles_if_needed():
    """Seed default system roles if they don't exist."""
    async with async_sessionmaker() as session:
        roles_data = [
            {
                "name": RoleEnum.ADMINISTRATOR.value,
                "description": "Full platform access including user management and organization settings",
                "is_system": True,
            },
            {
                "name": RoleEnum.DETECTION_ENGINEER.value,
                "description": "Build and deploy detections to non-production environments",
                "is_system": True,
            },
            {
                "name": RoleEnum.SECURITY_ANALYST.value,
                "description": "Test and validate detections, view results from all environments",
                "is_system": True,
            },
            {
                "name": RoleEnum.VIEWER.value,
                "description": "Read-only access for auditing and reporting",
                "is_system": True,
            },
        ]
        
        for role_data in roles_data:
            result = await session.execute(
                text("SELECT id FROM roles WHERE name = :name"),
                {"name": role_data["name"]}
            )
            existing = result.scalar_one_or_none()
            
            if not existing:
                await session.execute(
                    text("""
                        INSERT INTO roles (name, description, is_system)
                        VALUES (:name, :description, :is_system)
                    """),
                    role_data
                )
        
        await session.commit()
        logger.info("✅ Default roles seeded")


async def seed_permissions_if_needed():
    """Seed all permissions if they don't exist."""
    async with async_sessionmaker() as session:
        # Use Permission enum from RBAC service as source of truth
        permissions_data = []
        
        # Detection permissions
        detection_perms = [
            (PermissionEnum.DETECTIONS_CREATE.value, "detections", "Create new detections"),
            (PermissionEnum.DETECTIONS_READ.value, "detections", "View detections"),
            (PermissionEnum.DETECTIONS_UPDATE.value, "detections", "Edit detections"),
            (PermissionEnum.DETECTIONS_DELETE.value, "detections", "Delete detections"),
            (PermissionEnum.DETECTIONS_DEPLOY.value, "detections", "Deploy detections to SIEM"),
            (PermissionEnum.DETECTIONS_APPROVE.value, "detections", "Approve detections for production"),
            (PermissionEnum.DETECTIONS_CRITICALITY_UPDATE.value, "detections", "Update detection criticality"),
        ]
        
        # Test permissions
        test_perms = [
            (PermissionEnum.TESTS_CREATE.value, "tests", "Create test runs"),
            (PermissionEnum.TESTS_READ.value, "tests", "View test results"),
            (PermissionEnum.TESTS_SCHEDULE.value, "tests", "Schedule recurring tests"),
            (PermissionEnum.TESTS_SCHEDULE_PROD.value, "tests", "Schedule tests in production"),
            (PermissionEnum.TESTS_RUN_LAB.value, "tests", "Run tests in LAB environment"),
            (PermissionEnum.TESTS_RUN_DEV.value, "tests", "Run tests in DEV environment"),
            (PermissionEnum.TESTS_RUN_PROD.value, "tests", "Run tests in PROD environment"),
        ]
        
        # Settings permissions
        settings_perms = [
            (PermissionEnum.SETTINGS_READ.value, "settings", "View settings"),
            (PermissionEnum.SETTINGS_UPDATE.value, "settings", "Modify settings"),
            (PermissionEnum.SETTINGS_SIEM_MANAGE.value, "settings", "Manage SIEM connections"),
            (PermissionEnum.SETTINGS_USERS_MANAGE.value, "settings", "Manage users and roles"),
            (PermissionEnum.SETTINGS_ORG_MANAGE.value, "settings", "Manage organization settings"),
            (PermissionEnum.SETTINGS_RUNNERS_MANAGE.value, "settings", "Manage environment runners"),
        ]
        
        # AI permissions
        ai_perms = [
            (PermissionEnum.ASSISTANT_USE.value, "assistant", "Use Watchtower AI assistant"),
            (PermissionEnum.ASSISTANT_CONFIGURE.value, "assistant", "Configure AI settings"),
        ]
        
        # Lifecycle permissions
        lifecycle_perms = [
            (PermissionEnum.LIFECYCLE_ADVANCE.value, "lifecycle", "Advance detection lifecycle stages"),
            (PermissionEnum.LIFECYCLE_APPROVE.value, "lifecycle", "Approve lifecycle transitions"),
            (PermissionEnum.LIFECYCLE_ROLLBACK.value, "lifecycle", "Rollback lifecycle stages"),
        ]
        
        # Reporting permissions
        report_perms = [
            (PermissionEnum.REPORTS_VIEW.value, "reports", "View reports"),
            (PermissionEnum.REPORTS_EXPORT.value, "reports", "Export reports"),
        ]
        
        all_perms = detection_perms + test_perms + settings_perms + ai_perms + lifecycle_perms + report_perms
        
        for perm_name, category, description in all_perms:
            result = await session.execute(
                text("SELECT id FROM permissions WHERE name = :name"),
                {"name": perm_name}
            )
            existing = result.scalar_one_or_none()
            
            if not existing:
                await session.execute(
                    text("""
                        INSERT INTO permissions (name, category, description)
                        VALUES (:name, :category, :description)
                    """),
                    {"name": perm_name, "category": category, "description": description}
                )
        
        await session.commit()
        logger.info("✅ Permissions seeded")


async def map_role_permissions_if_needed():
    """Map permissions to roles based on RBAC service logic."""
    async with async_sessionmaker() as session:
        # Get role IDs
        admin_result = await session.execute(
            text("SELECT id FROM roles WHERE name = 'ADMINISTRATOR'")
        )
        admin_id = admin_result.scalar_one()
        
        engineer_result = await session.execute(
            text("SELECT id FROM roles WHERE name = 'DETECTION_ENGINEER'")
        )
        engineer_id = engineer_result.scalar_one()
        
        analyst_result = await session.execute(
            text("SELECT id FROM roles WHERE name = 'SECURITY_ANALYST'")
        )
        analyst_id = analyst_result.scalar_one()
        
        viewer_result = await session.execute(
            text("SELECT id FROM roles WHERE name = 'VIEWER'")
        )
        viewer_id = viewer_result.scalar_one()
        
        # Get all permission IDs
        perm_result = await session.execute(
            text("SELECT id, name FROM permissions")
        )
        all_perms = {name: id for id, name in perm_result.all()}
        
        # Administrator: All permissions
        for perm_name in all_perms.keys():
            await session.execute(
                text("""
                    INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
                    VALUES (:role_id, :perm_id)
                """),
                {"role_id": admin_id, "perm_id": all_perms[perm_name]}
            )
        
        # Detection Engineer permissions
        engineer_perms = [
            PermissionEnum.DETECTIONS_CREATE.value,
            PermissionEnum.DETECTIONS_READ.value,
            PermissionEnum.DETECTIONS_UPDATE.value,
            PermissionEnum.DETECTIONS_DEPLOY.value,
            PermissionEnum.TESTS_CREATE.value,
            PermissionEnum.TESTS_READ.value,
            PermissionEnum.TESTS_SCHEDULE.value,
            PermissionEnum.TESTS_RUN_LAB.value,
            PermissionEnum.TESTS_RUN_DEV.value,
            PermissionEnum.ASSISTANT_USE.value,
            PermissionEnum.LIFECYCLE_ADVANCE.value,
            PermissionEnum.REPORTS_VIEW.value,
            PermissionEnum.REPORTS_EXPORT.value,
        ]
        for perm_name in engineer_perms:
            if perm_name in all_perms:
                await session.execute(
                    text("""
                        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
                        VALUES (:role_id, :perm_id)
                    """),
                    {"role_id": engineer_id, "perm_id": all_perms[perm_name]}
                )
        
        # Security Analyst permissions
        analyst_perms = [
            PermissionEnum.DETECTIONS_READ.value,
            PermissionEnum.TESTS_CREATE.value,
            PermissionEnum.TESTS_READ.value,
            PermissionEnum.TESTS_RUN_LAB.value,
            PermissionEnum.ASSISTANT_USE.value,
            PermissionEnum.REPORTS_VIEW.value,
        ]
        for perm_name in analyst_perms:
            if perm_name in all_perms:
                await session.execute(
                    text("""
                        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
                        VALUES (:role_id, :perm_id)
                    """),
                    {"role_id": analyst_id, "perm_id": all_perms[perm_name]}
                )
        
        # Viewer permissions
        viewer_perms = [
            PermissionEnum.DETECTIONS_READ.value,
            PermissionEnum.TESTS_READ.value,
            PermissionEnum.REPORTS_VIEW.value,
        ]
        for perm_name in viewer_perms:
            if perm_name in all_perms:
                await session.execute(
                    text("""
                        INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
                        VALUES (:role_id, :perm_id)
                    """),
                    {"role_id": viewer_id, "perm_id": all_perms[perm_name]}
                )
        
        await session.commit()
        logger.info("✅ Role-permission mappings created")


async def migrate_existing_users_if_needed():
    """Migrate existing users to roles based on is_admin flag."""
    async with async_sessionmaker() as session:
        try:
            # Get role IDs - handle case where roles don't exist yet
            admin_result = await session.execute(
                text("SELECT id FROM roles WHERE name = 'ADMINISTRATOR' LIMIT 1")
            )
            admin_role = admin_result.scalar_one_or_none()
            if not admin_role:
                logger.warning("ADMINISTRATOR role not found, skipping user migration")
                return
            
            admin_id = admin_role
            
            engineer_result = await session.execute(
                text("SELECT id FROM roles WHERE name = 'DETECTION_ENGINEER' LIMIT 1")
            )
            engineer_role = engineer_result.scalar_one_or_none()
            if not engineer_role:
                logger.warning("DETECTION_ENGINEER role not found, skipping user migration")
                return
            
            engineer_id = engineer_role
            
            # Get all users - handle missing organization_id
            users_result = await session.execute(
                text("SELECT id, organization_id, is_admin FROM users")
            )
            users = users_result.all()
            
            # Get or create default organization for users without org_id
            org_result = await session.execute(
                text("SELECT id FROM organizations LIMIT 1")
            )
            default_org = org_result.scalar_one_or_none()
            if not default_org:
                await session.execute(
                    text("INSERT INTO organizations (name) VALUES ('Default Organization')")
                )
                await session.commit()
                org_result = await session.execute(
                    text("SELECT id FROM organizations LIMIT 1")
                )
                default_org = org_result.scalar_one()
                logger.info("Created default organization for user migration")
            
            migrated_count = 0
            for user_id, org_id, is_admin in users:
                # Use default org if user doesn't have one
                user_org_id = org_id if org_id else default_org
                
                # Update user's org_id if missing
                if not org_id:
                    await session.execute(
                        text("UPDATE users SET organization_id = :org_id WHERE id = :user_id"),
                        {"org_id": user_org_id, "user_id": user_id}
                    )
                
                # Check if user already has a role
                existing_result = await session.execute(
                    text("""
                        SELECT id FROM user_roles 
                        WHERE user_id = :user_id AND organization_id = :org_id
                        LIMIT 1
                    """),
                    {"user_id": user_id, "org_id": user_org_id}
                )
                existing = existing_result.scalar_one_or_none()
                
                if not existing:
                    # Assign role based on is_admin
                    role_id = admin_id if is_admin else engineer_id
                    await session.execute(
                        text("""
                            INSERT INTO user_roles (user_id, role_id, organization_id)
                            VALUES (:user_id, :role_id, :org_id)
                        """),
                        {"user_id": user_id, "role_id": role_id, "org_id": user_org_id}
                    )
                    migrated_count += 1
            
            await session.commit()
            if migrated_count > 0:
                logger.info(f"✅ Migrated {migrated_count} existing users to roles")
        except Exception as e:
            logger.error(f"Error migrating users: {e}", exc_info=True)
            await session.rollback()
            # Don't raise - allow migration to continue


async def run_rbac_migration():
    """
    Run complete RBAC migration automatically.
    
    This is called on backend startup to ensure RBAC is set up.
    Safe to run multiple times (idempotent).
    """
    try:
        logger.info("🚀 Running automatic RBAC migration...")
        await ensure_rbac_tables()
        await seed_roles_if_needed()
        await seed_permissions_if_needed()
        await map_role_permissions_if_needed()
        await migrate_existing_users_if_needed()
        logger.info("✅ RBAC migration completed successfully")
    except asyncio.CancelledError:
        # Handle cancellation during hot reload
        logger.warning("RBAC migration cancelled (likely due to hot reload)")
        raise
    except Exception as e:
        logger.error(f"❌ RBAC migration failed: {e}", exc_info=True)
        # Don't raise - allow server to start even if migration fails
        # Admin can run manual migration script if needed

