"""
Database migration script for RBAC implementation.

This script:
1. Creates RBAC tables (roles, permissions, role_permissions, user_roles)
2. Adds criticality field to detections
3. Seeds default roles and permissions
4. Migrates existing users to roles
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.db import async_sessionmaker, async_engine
from app.models import (
    Role, Permission, RolePermission, UserRole, User, Detection
)
from app.services.rbac import (
    PERMISSION_METADATA,
    ROLE_DESCRIPTIONS,
    ROLE_PERMISSION_MATRIX,
    Role as RoleEnum,
)


async def create_tables():
    """Create RBAC tables if they don't exist."""
    async with async_engine.begin() as conn:
        # Create roles table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR NOT NULL UNIQUE,
                description TEXT,
                is_system BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))
        
        # Create permissions table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR NOT NULL UNIQUE,
                category VARCHAR NOT NULL,
                description TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """))
        
        # Create role_permissions table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS role_permissions (
                role_id INTEGER NOT NULL,
                permission_id INTEGER NOT NULL,
                PRIMARY KEY (role_id, permission_id),
                FOREIGN KEY (role_id) REFERENCES roles(id),
                FOREIGN KEY (permission_id) REFERENCES permissions(id)
            )
        """))
        
        # Create user_roles table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS user_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                role_id INTEGER NOT NULL,
                organization_id INTEGER NOT NULL,
                assigned_by INTEGER,
                assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (role_id) REFERENCES roles(id),
                FOREIGN KEY (organization_id) REFERENCES organizations(id),
                FOREIGN KEY (assigned_by) REFERENCES users(id),
                UNIQUE(user_id, role_id, organization_id)
            )
        """))
        
        # Add criticality column to detections if it doesn't exist
        try:
            await conn.execute(text("""
                ALTER TABLE detections ADD COLUMN criticality VARCHAR DEFAULT 'MEDIUM'
            """))
        except Exception:
            # Column might already exist
            pass
        
        await conn.commit()
    print("✅ RBAC tables created")


async def seed_roles():
    """Seed default system roles."""
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
    print("✅ Default roles seeded")


async def seed_permissions():
    """Seed all permissions."""
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
    print("✅ Permissions seeded")


async def map_role_permissions():
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
                    await session.execute(
                        text("""
                            INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
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
    print("✅ Role-permission mappings created")


async def migrate_existing_users():
    """Migrate existing users to roles based on is_admin flag."""
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
        
        # Get all users
        users_result = await session.execute(
            text("SELECT id, organization_id, is_admin FROM users")
        )
        users = users_result.all()
        
        for user_id, org_id, is_admin in users:
            # Check if user already has a role
            existing_result = await session.execute(
                text("""
                    SELECT id FROM user_roles 
                    WHERE user_id = :user_id AND organization_id = :org_id
                """),
                {"user_id": user_id, "org_id": org_id}
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
                    {"user_id": user_id, "role_id": role_id, "org_id": org_id}
                )
        
        await session.commit()
    print("✅ Existing users migrated to roles")


async def main():
    """Run all migration steps."""
    print("🚀 Starting RBAC migration...")
    
    try:
        await create_tables()
        await seed_roles()
        await seed_permissions()
        await map_role_permissions()
        await migrate_existing_users()
        
        print("\n✅ RBAC migration completed successfully!")
        print("\nNext steps:")
        print("1. Restart the backend server")
        print("2. Test permission checks in API endpoints")
        print("3. Update frontend to show/hide UI based on roles")
        
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        import traceback
        traceback.print_exc()
        raise


if __name__ == "__main__":
    asyncio.run(main())

