/**
 * Permission checking utilities for frontend RBAC.
 * 
 * This provides a simple way to check if the current user has specific permissions
 * without making API calls on every check (permissions are cached).
 */

// Canonical permission list (matches backend)
export enum Permission {
  // Detection permissions
  DETECTIONS_CREATE = "detections:create",
  DETECTIONS_READ = "detections:read",
  DETECTIONS_UPDATE = "detections:update",
  DETECTIONS_DELETE = "detections:delete",
  DETECTIONS_DEPLOY = "detections:deploy",
  DETECTIONS_APPROVE = "detections:approve",
  DETECTIONS_CRITICALITY_UPDATE = "detections:criticality:update",
  
  // Test permissions
  TESTS_CREATE = "tests:create",
  TESTS_READ = "tests:read",
  TESTS_SCHEDULE = "tests:schedule",
  TESTS_SCHEDULE_PROD = "tests:schedule:prod",
  TESTS_RUN_LAB = "tests:run:lab",
  TESTS_RUN_DEV = "tests:run:dev",
  TESTS_RUN_PROD = "tests:run:prod",
  
  // Settings permissions
  SETTINGS_READ = "settings:read",
  SETTINGS_UPDATE = "settings:update",
  SETTINGS_SIEM_MANAGE = "settings:siem:manage",
  SETTINGS_USERS_MANAGE = "settings:users:manage",
  SETTINGS_ORG_MANAGE = "settings:organization:manage",
  SETTINGS_RUNNERS_MANAGE = "settings:runners:manage",
  
  // AI Assistant permissions
  ASSISTANT_USE = "assistant:use",
  ASSISTANT_CONFIGURE = "assistant:configure",
  
  // Lifecycle permissions
  LIFECYCLE_ADVANCE = "lifecycle:advance",
  LIFECYCLE_APPROVE = "lifecycle:approve",
  LIFECYCLE_ROLLBACK = "lifecycle:rollback",
  
  // Reporting permissions
  REPORTS_VIEW = "reports:view",
  REPORTS_EXPORT = "reports:export",
}

export enum Role {
  ADMINISTRATOR = "ADMINISTRATOR",
  DETECTION_ENGINEER = "DETECTION_ENGINEER",
  SECURITY_ANALYST = "SECURITY_ANALYST",
  VIEWER = "VIEWER",
}

export enum Criticality {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

// Permission cache (loaded from API)
let cachedPermissions: string[] | null = null;
let cachedRoles: string[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load permissions from API and cache them.
 */
export async function loadPermissions(): Promise<string[]> {
  const now = Date.now();
  
  // Return cached permissions if still valid
  if (cachedPermissions && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedPermissions;
  }
  
  try {
    const { getMyPermissions } = await import("./api");
    cachedPermissions = await getMyPermissions();
    cacheTimestamp = now;
    return cachedPermissions;
  } catch (error) {
    console.error("Failed to load permissions:", error);
    return [];
  }
}

/**
 * Load roles from API and cache them.
 */
export async function loadRoles(): Promise<string[]> {
  const now = Date.now();
  
  // Return cached roles if still valid
  if (cachedRoles && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedRoles;
  }
  
  try {
    const { getMyRoles } = await import("./api");
    cachedRoles = await getMyRoles();
    cacheTimestamp = now;
    return cachedRoles;
  } catch (error) {
    console.error("Failed to load roles:", error);
    return [];
  }
}

/**
 * Check if user has a specific permission.
 * 
 * Note: This checks the cached permissions. Call loadPermissions() first
 * or use the usePermissions hook for automatic loading.
 */
export function hasPermission(permission: Permission | string): boolean {
  if (!cachedPermissions) {
    return false;
  }
  return cachedPermissions.includes(permission);
}

/**
 * Check if user has any of the specified permissions.
 */
export function hasAnyPermission(...permissions: (Permission | string)[]): boolean {
  if (!cachedPermissions) {
    return false;
  }
  return permissions.some(perm => cachedPermissions!.includes(perm));
}

/**
 * Check if user has all of the specified permissions.
 */
export function hasAllPermissions(...permissions: (Permission | string)[]): boolean {
  if (!cachedPermissions) {
    return false;
  }
  return permissions.every(perm => cachedPermissions!.includes(perm));
}

/**
 * Check if user has a specific role.
 */
export function hasRole(role: Role | string): boolean {
  if (!cachedRoles) {
    return false;
  }
  return cachedRoles.includes(role);
}

/**
 * Check if user is an administrator.
 */
export function isAdmin(): boolean {
  return hasRole(Role.ADMINISTRATOR);
}

/**
 * Check if user can run tests in a specific environment.
 */
export function canRunTest(environment: "lab" | "dev" | "prod"): boolean {
  switch (environment) {
    case "lab":
      return hasPermission(Permission.TESTS_RUN_LAB);
    case "dev":
      return hasPermission(Permission.TESTS_RUN_DEV);
    case "prod":
      return hasPermission(Permission.TESTS_RUN_PROD);
    default:
      return false;
  }
}

/**
 * Check if user can schedule tests in an environment.
 */
export function canScheduleTest(environment: "lab" | "dev" | "prod"): boolean {
  if (environment === "prod") {
    return hasPermission(Permission.TESTS_SCHEDULE_PROD);
  }
  return hasPermission(Permission.TESTS_SCHEDULE);
}

/**
 * Check if user can deploy a detection to an environment.
 * 
 * Note: This is a simplified check. The backend also considers detection criticality.
 */
export function canDeploy(environment: "lab" | "dev" | "prod"): boolean {
  if (environment === "prod") {
    // Only admins can deploy to PROD
    return isAdmin();
  }
  return hasPermission(Permission.DETECTIONS_DEPLOY);
}

/**
 * Clear the permission cache (useful after role changes).
 */
export function clearPermissionCache(): void {
  cachedPermissions = null;
  cachedRoles = null;
  cacheTimestamp = 0;
}

