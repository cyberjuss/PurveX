import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getMyPermissions = vi.fn();
const getMyRoles = vi.fn();

vi.mock("./api", () => ({
  getMyPermissions: (...args: unknown[]) => getMyPermissions(...args),
  getMyRoles: (...args: unknown[]) => getMyRoles(...args),
}));

import {
  Permission,
  Role,
  loadPermissions,
  loadRoles,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  hasRole,
  isAdmin,
  canRunTest,
  canScheduleTest,
  canDeploy,
  clearPermissionCache,
} from "./permissions";

describe("permissions", () => {
  beforeEach(() => {
    clearPermissionCache();
    getMyPermissions.mockReset();
    getMyRoles.mockReset();
  });
  afterEach(() => {
    clearPermissionCache();
  });

  // SECURITY: before any permission data has loaded, every check must fail
  // closed (deny) rather than fail open — a UI that defaults to "allowed"
  // while permissions are still loading would flash privileged controls.
  it("denies everything before permissions have been loaded", () => {
    expect(hasPermission(Permission.DETECTIONS_CREATE)).toBe(false);
    expect(hasAnyPermission(Permission.DETECTIONS_CREATE, Permission.DETECTIONS_READ)).toBe(false);
    expect(hasAllPermissions(Permission.DETECTIONS_READ)).toBe(false);
    expect(hasRole(Role.ADMINISTRATOR)).toBe(false);
    expect(isAdmin()).toBe(false);
    expect(canRunTest("lab")).toBe(false);
    expect(canDeploy("lab")).toBe(false);
  });

  it("loads and caches permissions from the API", async () => {
    getMyPermissions.mockResolvedValue([Permission.DETECTIONS_READ, Permission.TESTS_RUN_LAB]);
    const result = await loadPermissions();
    expect(result).toEqual([Permission.DETECTIONS_READ, Permission.TESTS_RUN_LAB]);
    expect(hasPermission(Permission.DETECTIONS_READ)).toBe(true);
    expect(hasPermission(Permission.DETECTIONS_DELETE)).toBe(false);

    // Second call within the TTL window shouldn't hit the API again.
    await loadPermissions();
    expect(getMyPermissions).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list and doesn't throw if the API call fails", async () => {
    getMyPermissions.mockRejectedValue(new Error("network error"));
    const result = await loadPermissions();
    expect(result).toEqual([]);
    expect(hasPermission(Permission.DETECTIONS_READ)).toBe(false);
  });

  it("hasAnyPermission / hasAllPermissions match documented semantics", async () => {
    getMyPermissions.mockResolvedValue([Permission.DETECTIONS_READ, Permission.TESTS_RUN_LAB]);
    await loadPermissions();

    expect(hasAnyPermission(Permission.DETECTIONS_DELETE, Permission.TESTS_RUN_LAB)).toBe(true);
    expect(hasAnyPermission(Permission.DETECTIONS_DELETE, Permission.DETECTIONS_CREATE)).toBe(false);

    expect(hasAllPermissions(Permission.DETECTIONS_READ, Permission.TESTS_RUN_LAB)).toBe(true);
    expect(hasAllPermissions(Permission.DETECTIONS_READ, Permission.DETECTIONS_CREATE)).toBe(false);
  });

  it("isAdmin reflects the ADMINISTRATOR role", async () => {
    getMyRoles.mockResolvedValue([Role.ADMINISTRATOR]);
    await loadRoles();
    expect(isAdmin()).toBe(true);
    expect(hasRole(Role.VIEWER)).toBe(false);
  });

  describe("canRunTest / canScheduleTest — environment gating", () => {
    it("maps each environment to its own dedicated permission", async () => {
      getMyPermissions.mockResolvedValue([Permission.TESTS_RUN_LAB]);
      await loadPermissions();
      expect(canRunTest("lab")).toBe(true);
      expect(canRunTest("dev")).toBe(false);
      expect(canRunTest("prod")).toBe(false);
    });

    it("prod scheduling requires the dedicated prod-schedule permission, not the general one", async () => {
      getMyPermissions.mockResolvedValue([Permission.TESTS_SCHEDULE]);
      await loadPermissions();
      expect(canScheduleTest("lab")).toBe(true);
      expect(canScheduleTest("prod")).toBe(false);
    });
  });

  describe("canDeploy — prod requires admin, not just the deploy permission", () => {
    it("denies prod deploy for a non-admin even with DETECTIONS_DEPLOY", async () => {
      getMyPermissions.mockResolvedValue([Permission.DETECTIONS_DEPLOY]);
      getMyRoles.mockResolvedValue([Role.DETECTION_ENGINEER]);
      await loadPermissions();
      await loadRoles();
      expect(canDeploy("lab")).toBe(true);
      expect(canDeploy("prod")).toBe(false);
    });

    it("allows prod deploy for an admin", async () => {
      getMyPermissions.mockResolvedValue([]);
      getMyRoles.mockResolvedValue([Role.ADMINISTRATOR]);
      await loadPermissions();
      await loadRoles();
      expect(canDeploy("prod")).toBe(true);
    });
  });
});
