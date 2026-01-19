"use client";

import { useState, useEffect } from "react";
import { loadPermissions, loadRoles, hasPermission, hasRole, Permission, Role, clearPermissionCache } from "@/lib/permissions";

/**
 * React hook for checking user permissions and roles.
 * 
 * Automatically loads permissions on mount and provides helper functions.
 * 
 * @example
 * ```tsx
 * const { hasPermission, isAdmin, canRunTest } = usePermissions();
 * 
 * {hasPermission(Permission.DETECTIONS_CREATE) && (
 *   <Button onClick={createDetection}>Create Detection</Button>
 * )}
 * ```
 */
export function usePermissions() {
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchPermissions() {
      try {
        setLoading(true);
        const [perms, userRoles] = await Promise.all([
          loadPermissions(),
          loadRoles(),
        ]);
        setPermissions(perms);
        setRoles(userRoles);
        setError(null);
      } catch (err) {
        console.error("Failed to load permissions:", err);
        setError(err instanceof Error ? err : new Error("Unknown error"));
        setPermissions([]);
        setRoles([]);
      } finally {
        setLoading(false);
      }
    }

    fetchPermissions();
  }, []);

  return {
    permissions,
    roles,
    loading,
    error,
    hasPermission: (permission: Permission | string) => {
      return permissions.includes(permission);
    },
    hasAnyPermission: (...perms: (Permission | string)[]) => {
      return perms.some(perm => permissions.includes(perm));
    },
    hasAllPermissions: (...perms: (Permission | string)[]) => {
      return perms.every(perm => permissions.includes(perm));
    },
    hasRole: (role: Role | string) => {
      return roles.includes(role);
    },
    isAdmin: () => {
      return roles.includes(Role.ADMINISTRATOR);
    },
    canRunTest: (environment: "lab" | "dev" | "prod") => {
      switch (environment) {
        case "lab":
          return permissions.includes(Permission.TESTS_RUN_LAB);
        case "dev":
          return permissions.includes(Permission.TESTS_RUN_DEV);
        case "prod":
          return permissions.includes(Permission.TESTS_RUN_PROD);
        default:
          return false;
      }
    },
    canScheduleTest: (environment: "lab" | "dev" | "prod") => {
      if (environment === "prod") {
        return permissions.includes(Permission.TESTS_SCHEDULE_PROD);
      }
      return permissions.includes(Permission.TESTS_SCHEDULE);
    },
    canDeploy: (environment: "lab" | "dev" | "prod") => {
      if (environment === "prod") {
        return roles.includes(Role.ADMINISTRATOR);
      }
      return permissions.includes(Permission.DETECTIONS_DEPLOY);
    },
    refresh: async () => {
      clearPermissionCache();
      try {
        const [perms, userRoles] = await Promise.all([
          loadPermissions(),
          loadRoles(),
        ]);
        setPermissions(perms);
        setRoles(userRoles);
      } catch (err) {
        console.error("Failed to refresh permissions:", err);
      }
    },
  };
}

