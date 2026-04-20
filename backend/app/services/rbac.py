"""
RBAC (Role-Based Access Control) Service

Provides permission checking with criticality-based access control.
"""
from enum import Enum
from typing import List, Optional
from datetime import datetime
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import selectinload

from .. import models


class Role(str, Enum):
    """System roles."""
    ADMINISTRATOR = "ADMINISTRATOR"
    DETECTION_ENGINEER = "DETECTION_ENGINEER"
    SECURITY_ANALYST = "SECURITY_ANALYST"
    VIEWER = "VIEWER"


class Permission(str, Enum):
    """Canonical permission list - single source of truth."""
    # Detection permissions
    DETECTIONS_CREATE = "detections:create"
    DETECTIONS_READ = "detections:read"
    DETECTIONS_UPDATE = "detections:update"
    DETECTIONS_DELETE = "detections:delete"
    DETECTIONS_DEPLOY = "detections:deploy"
    DETECTIONS_APPROVE = "detections:approve"
    DETECTIONS_CRITICALITY_UPDATE = "detections:criticality:update"
    
    # Test permissions
    TESTS_CREATE = "tests:create"
    TESTS_READ = "tests:read"
    TESTS_SCHEDULE = "tests:schedule"
    TESTS_SCHEDULE_PROD = "tests:schedule:prod"
    TESTS_RUN_LAB = "tests:run:lab"
    TESTS_RUN_DEV = "tests:run:dev"
    TESTS_RUN_PROD = "tests:run:prod"
    
    # Settings permissions
    SETTINGS_READ = "settings:read"
    SETTINGS_UPDATE = "settings:update"
    SETTINGS_SIEM_MANAGE = "settings:siem:manage"
    SETTINGS_USERS_MANAGE = "settings:users:manage"
    SETTINGS_ORG_MANAGE = "settings:organization:manage"
    SETTINGS_RUNNERS_MANAGE = "settings:runners:manage"
    
    # AI Assistant permissions
    ASSISTANT_USE = "assistant:use"
    ASSISTANT_CONFIGURE = "assistant:configure"
    
    # Lifecycle permissions
    LIFECYCLE_ADVANCE = "lifecycle:advance"
    LIFECYCLE_APPROVE = "lifecycle:approve"
    LIFECYCLE_ROLLBACK = "lifecycle:rollback"
    
    # Reporting permissions
    REPORTS_VIEW = "reports:view"
    REPORTS_EXPORT = "reports:export"


class Criticality(str, Enum):
    """Detection criticality levels."""
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


ROLE_DESCRIPTIONS: dict[Role, str] = {
    Role.ADMINISTRATOR: (
        "Full platform administration, including production actions, SIEM "
        "management, endpoint management, users, roles, and organization settings."
    ),
    Role.DETECTION_ENGINEER: (
        "Build and maintain detections, run validation in lab/dev, and export "
        "reports. Cannot manage users/settings or take production/high-criticality "
        "approval actions."
    ),
    Role.SECURITY_ANALYST: (
        "Validate and review detection coverage, run lab validations, use "
        "Watchtower, and view operational evidence. Cannot edit detections or "
        "run production/dev validations."
    ),
    Role.VIEWER: (
        "Read-only access to detections, validation evidence, endpoint status, "
        "settings summaries, and reports. Cannot change data or run tests."
    ),
}


PERMISSION_METADATA: dict[Permission, tuple[str, str]] = {
    Permission.DETECTIONS_CREATE: ("detections", "Create new detections"),
    Permission.DETECTIONS_READ: ("detections", "View detections"),
    Permission.DETECTIONS_UPDATE: ("detections", "Edit detection owner, notes, and lifecycle metadata"),
    Permission.DETECTIONS_DELETE: ("detections", "Delete detections"),
    Permission.DETECTIONS_DEPLOY: ("detections", "Deploy detections to non-production environments when allowed"),
    Permission.DETECTIONS_APPROVE: ("detections", "Approve detections for production or high-criticality promotion"),
    Permission.DETECTIONS_CRITICALITY_UPDATE: ("detections", "Update detection criticality"),
    Permission.TESTS_CREATE: ("tests", "Create validation test records"),
    Permission.TESTS_READ: ("tests", "View validation runs and artifacts"),
    Permission.TESTS_SCHEDULE: ("tests", "Schedule recurring validations in lab/dev"),
    Permission.TESTS_SCHEDULE_PROD: ("tests", "Schedule recurring validations in production"),
    Permission.TESTS_RUN_LAB: ("tests", "Run validations in the lab environment"),
    Permission.TESTS_RUN_DEV: ("tests", "Run validations in the dev environment"),
    Permission.TESTS_RUN_PROD: ("tests", "Run validations in production"),
    Permission.SETTINGS_READ: ("settings", "View non-secret settings, SIEM status, and endpoint inventory"),
    Permission.SETTINGS_UPDATE: ("settings", "Modify general platform settings"),
    Permission.SETTINGS_SIEM_MANAGE: ("settings", "Create, update, sync, and delete SIEM connections"),
    Permission.SETTINGS_USERS_MANAGE: ("settings", "Manage users and role assignments"),
    Permission.SETTINGS_ORG_MANAGE: ("settings", "Manage organization settings"),
    Permission.SETTINGS_RUNNERS_MANAGE: ("settings", "Register, edit, pause, resume, and remove endpoints/runners"),
    Permission.ASSISTANT_USE: ("assistant", "Use Watchtower AI assistant"),
    Permission.ASSISTANT_CONFIGURE: ("assistant", "Configure Watchtower AI assistant settings"),
    Permission.LIFECYCLE_ADVANCE: ("lifecycle", "Advance normal detection lifecycle stages"),
    Permission.LIFECYCLE_APPROVE: ("lifecycle", "Approve restricted lifecycle transitions"),
    Permission.LIFECYCLE_ROLLBACK: ("lifecycle", "Rollback lifecycle stages"),
    Permission.REPORTS_VIEW: ("reports", "View reports"),
    Permission.REPORTS_EXPORT: ("reports", "Export reports"),
}


ROLE_PERMISSION_MATRIX: dict[Role, set[Permission]] = {
    Role.ADMINISTRATOR: set(Permission),
    Role.DETECTION_ENGINEER: {
        Permission.DETECTIONS_CREATE,
        Permission.DETECTIONS_READ,
        Permission.DETECTIONS_UPDATE,
        Permission.DETECTIONS_DEPLOY,
        Permission.TESTS_CREATE,
        Permission.TESTS_READ,
        Permission.TESTS_SCHEDULE,
        Permission.TESTS_RUN_LAB,
        Permission.TESTS_RUN_DEV,
        Permission.SETTINGS_READ,
        Permission.ASSISTANT_USE,
        Permission.LIFECYCLE_ADVANCE,
        Permission.REPORTS_VIEW,
        Permission.REPORTS_EXPORT,
    },
    Role.SECURITY_ANALYST: {
        Permission.DETECTIONS_READ,
        Permission.TESTS_CREATE,
        Permission.TESTS_READ,
        Permission.TESTS_RUN_LAB,
        Permission.SETTINGS_READ,
        Permission.ASSISTANT_USE,
        Permission.REPORTS_VIEW,
    },
    Role.VIEWER: {
        Permission.DETECTIONS_READ,
        Permission.TESTS_READ,
        Permission.SETTINGS_READ,
        Permission.REPORTS_VIEW,
    },
}


class RBACService:
    """Service for checking permissions and enforcing RBAC."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def get_user_roles(self, user_id: int, org_id: int) -> List[Role]:
        """
        Get all active roles for a user in an organization.
        
        Also checks is_admin for backward compatibility.
        """
        # Check is_admin first (backward compatibility)
        user = await self.db.get(models.User, user_id)
        if user and getattr(user, "is_admin", False):
            return [Role.ADMINISTRATOR]
        
        # Eager-load role so accessing ur.role doesn't trigger N async queries.
        stmt = (
            select(models.UserRole)
            .options(selectinload(models.UserRole.role))
            .where(
                and_(
                    models.UserRole.user_id == user_id,
                    models.UserRole.organization_id == org_id,
                    or_(
                        models.UserRole.expires_at.is_(None),
                        models.UserRole.expires_at > datetime.utcnow()
                    )
                )
            )
        )
        result = await self.db.execute(stmt)
        user_roles = result.scalars().all()

        return [Role(ur.role.name) for ur in user_roles if ur.role]
    
    async def has_role(self, user: models.User, role: Role, org_id: Optional[int] = None) -> bool:
        """Check if user has a specific role."""
        if not org_id:
            org_id = getattr(user, "organization_id", None)
        if not org_id:
            return False
        
        roles = await self.get_user_roles(user.id, org_id)
        return role in roles
    
    async def has_permission(
        self,
        user: models.User,
        permission: Permission,
        resource_criticality: Optional[Criticality] = None,
        environment: Optional[str] = None
    ) -> bool:
        """
        Check if user has a specific permission, considering criticality.
        
        Args:
            user: The user to check
            permission: The permission to check
            resource_criticality: Criticality level of the resource (for detections)
            environment: Environment (lab/dev/prod) for environment-specific checks
        """
        org_id = getattr(user, "organization_id", None)
        if not org_id:
            return False
        
        # Admins have all permissions
        if getattr(user, "is_admin", False):
            return True
        
        # Get user roles
        roles = await self.get_user_roles(user.id, org_id)
        
        # Check if any role has the permission
        for role in roles:
            if await self._role_has_permission(role, permission, resource_criticality, environment):
                return True
        
        return False
    
    async def _role_has_permission(
        self,
        role: Role,
        permission: Permission,
        resource_criticality: Optional[Criticality],
        environment: Optional[str]
    ) -> bool:
        """
        Check if a role has a permission, considering criticality rules.
        
        This is the canonical permission matrix.
        """
        # ADMINISTRATOR holds every permission unconditionally. The restriction
        # matrix below describes what NON-ADMIN roles can do; without this
        # short-circuit, rules like "only admins can delete" would incorrectly
        # also block admins when permissions are enumerated directly (e.g. from
        # GET /rbac/me/permissions, which bypasses has_permission's is_admin
        # shortcut).
        if role == Role.ADMINISTRATOR:
            return True

        # Check base permission
        if permission not in ROLE_PERMISSION_MATRIX.get(role, set()):
            return False

        env = environment.lower() if environment else None

        # Apply criticality-based restrictions
        
        # 1. Deploy restrictions
        if permission == Permission.DETECTIONS_DEPLOY:
            # Engineers can deploy to DEV, but PROD requires admin
            if env == "prod":
                return False  # Only admins can deploy to PROD
            # High/critical detections need admin approval even for DEV
            if resource_criticality in [Criticality.HIGH, Criticality.CRITICAL]:
                return False  # High/critical detections need admin approval
        
        # 2. Test run restrictions
        if permission == Permission.TESTS_RUN_PROD:
            # Only admins can run tests in PROD
            return False
        
        # 3. Schedule restrictions
        if permission == Permission.TESTS_SCHEDULE:
            if env == "prod":
                return False
            # LAB/DEV scheduling is allowed for roles that hold TESTS_SCHEDULE.
            return True

        if permission == Permission.TESTS_SCHEDULE_PROD:
            return False
        
        # 4. Delete restrictions
        if permission == Permission.DETECTIONS_DELETE:
            # Only admins can delete (regardless of role)
            return False
        
        # 5. Criticality update restrictions
        if permission == Permission.DETECTIONS_CRITICALITY_UPDATE:
            # Only admins can change criticality
            return False
        
        # 6. Settings management restrictions
        if permission in [
            Permission.SETTINGS_UPDATE,
            Permission.SETTINGS_SIEM_MANAGE,
            Permission.SETTINGS_USERS_MANAGE,
            Permission.SETTINGS_ORG_MANAGE,
            Permission.SETTINGS_RUNNERS_MANAGE,
        ]:
            # Only admins can manage settings
            return False
        
        # 7. Approval permissions
        if permission in [
            Permission.DETECTIONS_APPROVE,
            Permission.LIFECYCLE_APPROVE,
        ]:
            # Only admins can approve
            return False
        
        return True
    
    async def require_permission(
        self,
        user: models.User,
        permission: Permission,
        resource_criticality: Optional[Criticality] = None,
        environment: Optional[str] = None
    ) -> None:
        """
        Require a permission or raise HTTPException.
        
        This is the main enforcement function - use this in routers.
        """
        if not await self.has_permission(user, permission, resource_criticality, environment):
            # Build helpful error message
            msg = f"Permission required: {permission.value}"
            if environment:
                msg += f" (environment: {environment})"
            if resource_criticality:
                msg += f" (criticality: {resource_criticality.value})"
            
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=msg
            )
    
    async def require_role(self, user: models.User, role: Role, org_id: Optional[int] = None) -> None:
        """Require a specific role or raise HTTPException."""
        if not await self.has_role(user, role, org_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role required: {role.value}"
            )

