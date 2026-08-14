"""
Automatic RBAC migration on startup.

This module provides functions to automatically set up RBAC tables and data
when the backend starts, without requiring a manual script run.
"""
import asyncio
import logging
from sqlalchemy import text, select, inspect
from datetime import datetime

from ..db import async_sessionmaker, async_engine
from ..models import Role, Permission, RolePermission, UserRole, User
from ..services.rbac import (
    PERMISSION_METADATA,
    ROLE_DESCRIPTIONS,
    ROLE_PERMISSION_MATRIX,
    Role as RoleEnum,
    Permission as PermissionEnum,
)

logger = logging.getLogger("purvex.rbac.migration")


async def ensure_rbac_tables():
    """Ensure RBAC tables exist and add criticality column to detections if needed.
    
    Note: Tables are created by SQLAlchemy Base.metadata.create_all() in main.py,
    but we need to handle the criticality column migration separately.
    """
    try:
        async with async_engine.begin() as conn:
            def _add_missing_columns(sync_conn):
                inspector = inspect(sync_conn)

                detection_columns = {col["name"] for col in inspector.get_columns("detections")}
                if "criticality" not in detection_columns:
                    sync_conn.execute(text("""
                        ALTER TABLE detections ADD COLUMN criticality VARCHAR DEFAULT 'MEDIUM'
                    """))
                    logger.info("✅ Added criticality column to detections")

                # SECURITY: account lockout fields
                user_columns = {col["name"] for col in inspector.get_columns("users")}
                if "failed_login_attempts" not in user_columns:
                    sync_conn.execute(text("""
                        ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER
                    """))
                    sync_conn.execute(text("""
                        UPDATE users SET failed_login_attempts = 0 WHERE failed_login_attempts IS NULL
                    """))
                    logger.info("✅ Added failed_login_attempts column to users")
                if "locked_until" not in user_columns:
                    sync_conn.execute(text("""
                        ALTER TABLE users ADD COLUMN locked_until TIMESTAMP
                    """))
                    logger.info("✅ Added locked_until column to users")

            # Column existence is checked up front (rather than try/ALTER/except)
            # because Postgres aborts the whole transaction on a failed DDL
            # statement -- a later, legitimate ALTER in the same connection
            # would silently never apply once an earlier one hit a
            # "column already exists" error.
            await conn.run_sync(_add_missing_columns)

    except Exception as e:
        logger.warning(f"Could not add columns (may already exist): {e}")


async def seed_roles_if_needed():
    """Seed default system roles if they don't exist."""
    async with async_sessionmaker() as session:
        roles_data = [
            {
                "name": role.value,
                "description": ROLE_DESCRIPTIONS[role],
                "is_system": True,
            }
            for role in RoleEnum
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
        all_perms = [
            (permission.value, category, description)
            for permission, (category, description) in PERMISSION_METADATA.items()
        ]
        
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
        role_ids: dict[RoleEnum, int] = {}
        for role in RoleEnum:
            result = await session.execute(
                text("SELECT id FROM roles WHERE name = :name"),
                {"name": role.value},
            )
            role_ids[role] = result.scalar_one()
        
        # Get all permission IDs
        perm_result = await session.execute(
            text("SELECT id, name FROM permissions")
        )
        all_perms = {name: id for id, name in perm_result.all()}
        
        for role, permissions in ROLE_PERMISSION_MATRIX.items():
            allowed_names = {permission.value for permission in permissions}
            role_id = role_ids[role]
            for perm_name, perm_id in all_perms.items():
                if perm_name in allowed_names:
                    existing_mapping = await session.execute(
                        text("""
                            SELECT 1 FROM role_permissions
                            WHERE role_id = :role_id AND permission_id = :perm_id
                        """),
                        {"role_id": role_id, "perm_id": perm_id}
                    )
                    if existing_mapping.scalar_one_or_none() is None:
                        await session.execute(
                            text("""
                                INSERT INTO role_permissions (role_id, permission_id)
                                VALUES (:role_id, :perm_id)
                            """),
                            {"role_id": role_id, "perm_id": perm_id}
                        )
                else:
                    await session.execute(
                        text("""
                            DELETE FROM role_permissions
                            WHERE role_id = :role_id AND permission_id = :perm_id
                        """),
                        {"role_id": role_id, "perm_id": perm_id}
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
