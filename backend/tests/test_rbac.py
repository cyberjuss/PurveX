"""
Tests for RBAC (Role-Based Access Control) system.

Tests permission checking, criticality-based restrictions, and environment-based access.
"""
import pytest
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, Role, Permission, RolePermission, UserRole, Organization, Detection
from app.services.rbac import RBACService, Role as RoleEnum, Permission as PermissionEnum, Criticality


@pytest.fixture
async def test_org(db: AsyncSession):
    """Create a test organization."""
    org = Organization(name="Test Org")
    db.add(org)
    await db.commit()
    await db.refresh(org)
    return org


@pytest.fixture
async def test_user(db: AsyncSession, test_org):
    """Create a test user."""
    user = User(
        email="test@example.com",
        hashed_password="hashed",
        is_active=True,
        is_admin=False,
        organization_id=test_org.id
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.fixture
async def admin_user(db: AsyncSession, test_org):
    """Create an admin user."""
    user = User(
        email="admin@example.com",
        hashed_password="hashed",
        is_active=True,
        is_admin=True,
        organization_id=test_org.id
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest.fixture
async def seeded_roles(db: AsyncSession):
    """Seed default roles."""
    roles = [
        Role(name=RoleEnum.ADMINISTRATOR.value, description="Admin", is_system=True),
        Role(name=RoleEnum.DETECTION_ENGINEER.value, description="Engineer", is_system=True),
        Role(name=RoleEnum.SECURITY_ANALYST.value, description="Analyst", is_system=True),
        Role(name=RoleEnum.VIEWER.value, description="Viewer", is_system=True),
    ]
    for role in roles:
        db.add(role)
    await db.commit()
    return roles


@pytest.mark.asyncio
async def test_admin_has_all_permissions(db: AsyncSession, admin_user):
    """Test that admin users have all permissions."""
    rbac = RBACService(db)
    
    # Admin should have all permissions
    assert await rbac.has_permission(admin_user, PermissionEnum.DETECTIONS_CREATE)
    assert await rbac.has_permission(admin_user, PermissionEnum.DETECTIONS_DELETE)
    assert await rbac.has_permission(admin_user, PermissionEnum.TESTS_RUN_PROD)
    assert await rbac.has_permission(admin_user, PermissionEnum.SETTINGS_USERS_MANAGE)


@pytest.mark.asyncio
async def test_engineer_permissions(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test Detection Engineer role permissions."""
    rbac = RBACService(db)
    
    # Get engineer role
    engineer_role = await db.execute(
        "SELECT * FROM roles WHERE name = 'DETECTION_ENGINEER'"
    )
    engineer = engineer_role.scalar_one()
    
    # Assign engineer role to user
    user_role = UserRole(
        user_id=test_user.id,
        role_id=engineer.id,
        organization_id=test_org.id
    )
    db.add(user_role)
    await db.commit()
    
    # Engineer should have these permissions
    assert await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_CREATE)
    assert await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_READ)
    assert await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_UPDATE)
    assert await rbac.has_permission(test_user, PermissionEnum.TESTS_RUN_LAB)
    assert await rbac.has_permission(test_user, PermissionEnum.TESTS_RUN_DEV)
    
    # Engineer should NOT have these permissions
    assert not await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_DELETE)
    assert not await rbac.has_permission(test_user, PermissionEnum.TESTS_RUN_PROD)
    assert not await rbac.has_permission(test_user, PermissionEnum.SETTINGS_USERS_MANAGE)


@pytest.mark.asyncio
async def test_analyst_permissions(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test Security Analyst role permissions."""
    rbac = RBACService(db)
    
    # Get analyst role
    analyst_role = await db.execute(
        "SELECT * FROM roles WHERE name = 'SECURITY_ANALYST'"
    )
    analyst = analyst_role.scalar_one()
    
    # Assign analyst role to user
    user_role = UserRole(
        user_id=test_user.id,
        role_id=analyst.id,
        organization_id=test_org.id
    )
    db.add(user_role)
    await db.commit()
    
    # Analyst should have read access to all environments
    assert await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_READ)
    assert await rbac.has_permission(test_user, PermissionEnum.TESTS_READ)
    assert await rbac.has_permission(test_user, PermissionEnum.TESTS_RUN_LAB)
    
    # Analyst should NOT have write permissions
    assert not await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_CREATE)
    assert not await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_UPDATE)
    assert not await rbac.has_permission(test_user, PermissionEnum.TESTS_RUN_DEV)
    assert not await rbac.has_permission(test_user, PermissionEnum.TESTS_RUN_PROD)


@pytest.mark.asyncio
async def test_viewer_permissions(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test Viewer role permissions."""
    rbac = RBACService(db)
    
    # Get viewer role
    viewer_role = await db.execute(
        "SELECT * FROM roles WHERE name = 'VIEWER'"
    )
    viewer = viewer_role.scalar_one()
    
    # Assign viewer role to user
    user_role = UserRole(
        user_id=test_user.id,
        role_id=viewer.id,
        organization_id=test_org.id
    )
    db.add(user_role)
    await db.commit()
    
    # Viewer should only have read permissions
    assert await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_READ)
    assert await rbac.has_permission(test_user, PermissionEnum.TESTS_READ)
    assert await rbac.has_permission(test_user, PermissionEnum.REPORTS_VIEW)
    
    # Viewer should NOT have any write permissions
    assert not await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_CREATE)
    assert not await rbac.has_permission(test_user, PermissionEnum.TESTS_CREATE)
    assert not await rbac.has_permission(test_user, PermissionEnum.ASSISTANT_USE)


@pytest.mark.asyncio
async def test_environment_based_restrictions(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test environment-based permission restrictions."""
    rbac = RBACService(db)
    
    # Get engineer role
    engineer_role = await db.execute(
        "SELECT * FROM roles WHERE name = 'DETECTION_ENGINEER'"
    )
    engineer = engineer_role.scalar_one()
    
    # Assign engineer role
    user_role = UserRole(
        user_id=test_user.id,
        role_id=engineer.id,
        organization_id=test_org.id
    )
    db.add(user_role)
    await db.commit()
    
    # Engineer can run tests in LAB
    assert await rbac.has_permission(
        test_user, PermissionEnum.TESTS_RUN_LAB, environment="lab"
    )
    
    # Engineer can run tests in DEV
    assert await rbac.has_permission(
        test_user, PermissionEnum.TESTS_RUN_DEV, environment="dev"
    )
    
    # Engineer CANNOT run tests in PROD
    assert not await rbac.has_permission(
        test_user, PermissionEnum.TESTS_RUN_PROD, environment="prod"
    )


@pytest.mark.asyncio
async def test_criticality_based_restrictions(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test detection criticality-based restrictions."""
    rbac = RBACService(db)
    
    # Get engineer role
    engineer_role = await db.execute(
        "SELECT * FROM roles WHERE name = 'DETECTION_ENGINEER'"
    )
    engineer = engineer_role.scalar_one()
    
    # Assign engineer role
    user_role = UserRole(
        user_id=test_user.id,
        role_id=engineer.id,
        organization_id=test_org.id
    )
    db.add(user_role)
    await db.commit()
    
    # Engineer can deploy LOW/MEDIUM to DEV
    assert await rbac.has_permission(
        test_user,
        PermissionEnum.DETECTIONS_DEPLOY,
        resource_criticality=Criticality.LOW,
        environment="dev"
    )
    assert await rbac.has_permission(
        test_user,
        PermissionEnum.DETECTIONS_DEPLOY,
        resource_criticality=Criticality.MEDIUM,
        environment="dev"
    )
    
    # Engineer CANNOT deploy HIGH/CRITICAL (needs admin approval)
    assert not await rbac.has_permission(
        test_user,
        PermissionEnum.DETECTIONS_DEPLOY,
        resource_criticality=Criticality.HIGH,
        environment="dev"
    )
    assert not await rbac.has_permission(
        test_user,
        PermissionEnum.DETECTIONS_DEPLOY,
        resource_criticality=Criticality.CRITICAL,
        environment="dev"
    )
    
    # Engineer CANNOT deploy to PROD (regardless of criticality)
    assert not await rbac.has_permission(
        test_user,
        PermissionEnum.DETECTIONS_DEPLOY,
        resource_criticality=Criticality.LOW,
        environment="prod"
    )


@pytest.mark.asyncio
async def test_schedule_permissions(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test scheduling permission restrictions."""
    rbac = RBACService(db)
    
    # Get engineer role
    engineer_role = await db.execute(
        "SELECT * FROM roles WHERE name = 'DETECTION_ENGINEER'"
    )
    engineer = engineer_role.scalar_one()
    
    # Assign engineer role
    user_role = UserRole(
        user_id=test_user.id,
        role_id=engineer.id,
        organization_id=test_org.id
    )
    db.add(user_role)
    await db.commit()
    
    # Engineer can schedule in LAB/DEV
    assert await rbac.has_permission(
        test_user, PermissionEnum.TESTS_SCHEDULE, environment="lab"
    )
    assert await rbac.has_permission(
        test_user, PermissionEnum.TESTS_SCHEDULE, environment="dev"
    )
    
    # Engineer CANNOT schedule in PROD
    assert not await rbac.has_permission(
        test_user, PermissionEnum.TESTS_SCHEDULE_PROD, environment="prod"
    )


@pytest.mark.asyncio
async def test_expired_role(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test that expired roles are not considered."""
    rbac = RBACService(db)
    
    # Get engineer role
    engineer_role = await db.execute(
        "SELECT * FROM roles WHERE name = 'DETECTION_ENGINEER'"
    )
    engineer = engineer_role.scalar_one()
    
    # Assign engineer role with expiration in the past
    user_role = UserRole(
        user_id=test_user.id,
        role_id=engineer.id,
        organization_id=test_org.id,
        expires_at=datetime.utcnow() - timedelta(days=1)  # Expired yesterday
    )
    db.add(user_role)
    await db.commit()
    
    # User should NOT have permissions from expired role
    assert not await rbac.has_permission(test_user, PermissionEnum.DETECTIONS_CREATE)


@pytest.mark.asyncio
async def test_require_permission_raises(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test that require_permission raises HTTPException when permission denied."""
    from fastapi import HTTPException
    
    rbac = RBACService(db)
    
    # User with no roles should not have permission
    with pytest.raises(HTTPException) as exc_info:
        await rbac.require_permission(
            test_user,
            PermissionEnum.DETECTIONS_CREATE
        )
    
    assert exc_info.value.status_code == 403
    assert "Permission required" in exc_info.value.detail


@pytest.mark.asyncio
async def test_get_user_roles(db: AsyncSession, test_user, test_org, seeded_roles):
    """Test getting user roles."""
    rbac = RBACService(db)
    
    # Get engineer role
    engineer_role = await db.execute(
        "SELECT * FROM roles WHERE name = 'DETECTION_ENGINEER'"
    )
    engineer = engineer_role.scalar_one()
    
    # Assign engineer role
    user_role = UserRole(
        user_id=test_user.id,
        role_id=engineer.id,
        organization_id=test_org.id
    )
    db.add(user_role)
    await db.commit()
    
    # Get user roles
    roles = await rbac.get_user_roles(test_user.id, test_org.id)
    
    assert RoleEnum.DETECTION_ENGINEER in roles
    assert len(roles) == 1

