"use client";

import { useState, useEffect, useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getUsers, getUserRoles, assignRole, removeRole, listRoles, setUserPassword, setUserActive, apiFetch } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import {
  Search, UserPlus, Shield, Key, Users, Filter, CheckCircle2, XCircle, Clock,
  Download, AlertCircle, Mail, Calendar, X, Loader2, Copy
} from "lucide-react";
import { format, formatRelative } from "date-fns";
import { cn } from "@/lib/utils";
import { toneClasses, type Tone } from "@/lib/status-tone";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsBanner,
} from "@/components/settings/settings-section";
import { PageSkeleton } from "@/components/ui/skeleton";
import { FieldError, FormError } from "@/components/ui/form-error";
import { UpgradeBanner, isUpgradeRequiredError } from "@/components/ui/upgrade-banner";
import { z } from "zod";
import { emailSchema } from "@/lib/validators";

interface User {
  id: number;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  is_pending_activation?: boolean;
  created_at: string;
}

interface UserRole {
  id: number;
  role_id: number;
  role_name: string;
  assigned_at: string;
  expires_at: string | null;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function PasswordStrengthIndicator({ password }: { password: string }) {
  const getStrength = (): { score: number; label: string; tone: Tone | null } => {
    if (!password) return { score: 0, label: "", tone: null };

    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;

    if (score <= 2) return { score, label: "Weak", tone: "danger" };
    if (score <= 4) return { score, label: "Fair", tone: "warning" };
    if (score <= 5) return { score, label: "Good", tone: "info" };
    return { score, label: "Strong", tone: "success" };
  };

  const strength = getStrength();
  const percentage = (strength.score / 6) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Password strength</span>
        <span className={cn("font-medium", strength.tone && toneClasses(strength.tone).text)}>
          {strength.label}
        </span>
      </div>
      <div className="h-1.5 w-full bg-[var(--surface-subtle)] rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300", strength.tone && toneClasses(strength.tone).bg)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  const { hasPermission, loading: permissionsLoading, permissions } = usePermissions();
  const [users, setUsers] = useState<User[]>([]);
  const [userRoles, setUserRoles] = useState<Record<number, UserRole[]>>({});
  const [availableRoles, setAvailableRoles] = useState<Array<{ id: number; name: string; description: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorIsUpgrade, setErrorIsUpgrade] = useState(false);
  const [assigningRole, setAssigningRole] = useState<number | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState<number | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [selectedUsers, setSelectedUsers] = useState<Set<number>>(new Set());
  const [togglingActiveId, setTogglingActiveId] = useState<number | null>(null);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [inviteFieldErrors, setInviteFieldErrors] = useState<{ email?: string }>({});
  // Set only when the invite was created but the activation email couldn't
  // actually be delivered (e.g. SMTP isn't configured) -- the API call
  // itself still succeeds either way, so this is the one place that tells
  // the admin "don't wait for an email that isn't coming."
  const [inviteLinkFallback, setInviteLinkFallback] = useState<string | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [viewUserDetails, setViewUserDetails] = useState<number | null>(null);
  const fetchUsers = async () => {
      try {
        setLoading(true);
      setError(null);
      
      const [allUsers, roles] = await Promise.all([
        getUsers(),
        listRoles(),
      ]);
      
      setUsers(allUsers);
      setAvailableRoles(roles);
      
      const rolesMap: Record<number, UserRole[]> = {};
      await Promise.all(
        allUsers.map(async (user) => {
          try {
            rolesMap[user.id] = await getUserRoles(user.id);
          } catch {
            rolesMap[user.id] = [];
          }
        })
      );
      setUserRoles(rolesMap);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to load users."));
      } finally {
        setLoading(false);
      }
  };

  useEffect(() => {
    if (permissionsLoading) {
      return;
    }

    const canManageUsers = permissions.includes(Permission.SETTINGS_USERS_MANAGE);
    
    if (!canManageUsers) {
      setLoading(false);
      return;
    }

    fetchUsers();
  }, [permissionsLoading, permissions]);
  
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = user.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === "all" || 
        (statusFilter === "active" && user.is_active) ||
        (statusFilter === "inactive" && !user.is_active);
      
      const userRoleNames = (userRoles[user.id] || []).map(ur => ur.role_name);
      if (user.is_admin) userRoleNames.push("ADMINISTRATOR");
      const matchesRole = roleFilter === "all" || userRoleNames.includes(roleFilter);
      
      return matchesSearch && matchesStatus && matchesRole;
    });
  }, [users, searchQuery, statusFilter, roleFilter, userRoles]);

  async function handleAssignRole(userId: number, roleName: string) {
    try {
      setAssigningRole(userId);
      await assignRole(userId, roleName);
      const roles = await getUserRoles(userId);
      setUserRoles(prev => ({ ...prev, [userId]: roles }));
    } catch (err: unknown) {
      const message = getErrorMessage(err, "Failed to assign role.");
      if (message.toLowerCase().includes("already has this role")) {
        const roles = await getUserRoles(userId);
        setUserRoles(prev => ({ ...prev, [userId]: roles }));
        return;
      }
      setError(message);
    } finally {
      setAssigningRole(null);
    }
  }
  
  async function handleRemoveRole(userId: number, roleId: number) {
    try {
      await removeRole(userId, roleId);
      const roles = await getUserRoles(userId);
      setUserRoles(prev => ({ ...prev, [userId]: roles }));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to remove role."));
    }
  }

  async function handleSetPassword(userId: number) {
    if (!currentPassword) {
      setError("Current password is required.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      setError("Password must contain uppercase, lowercase, and a number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setSettingPassword(true);
      setError(null);
      await setUserPassword(userId, currentPassword, newPassword);
      setPasswordDialogOpen(null);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to set password."));
    } finally {
      setSettingPassword(false);
    }
  }

  function handleExportSelected() {
    const rows = filteredUsers.filter((u) => selectedUsers.has(u.id));
    const roleNames = (u: User) => {
      const names = (userRoles[u.id] || []).map((r) => r.role_name);
      if (u.is_admin) names.unshift("ADMINISTRATOR");
      return names.join("; ");
    };
    const status = (u: User) => (u.is_pending_activation ? "pending" : u.is_active ? "active" : "inactive");
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const header = ["Email", "Roles", "Status", "Created"];
    const lines = rows.map((u) =>
      [u.email, roleNames(u), status(u), format(new Date(u.created_at), "yyyy-MM-dd")]
        .map(escapeCsv)
        .join(","),
    );
    const csv = [header.map(escapeCsv).join(","), ...lines].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `purvex-users-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleToggleActive(userId: number, currentlyActive: boolean) {
    const verb = currentlyActive ? "deactivate" : "reactivate";
    if (!window.confirm(`Are you sure you want to ${verb} this member?`)) return;
    try {
      setTogglingActiveId(userId);
      setError(null);
      await setUserActive(userId, !currentlyActive);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_active: !currentlyActive } : u)),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, `Failed to ${verb} member.`));
    } finally {
      setTogglingActiveId(null);
    }
  }

  async function handleCreateUser() {
    const parsed = z.object({ email: emailSchema }).safeParse({ email: newUserEmail });

    if (!parsed.success) {
      const next: { email?: string } = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "email" && !next.email) next.email = issue.message;
      }
      setInviteFieldErrors(next);
      setError(null);
      return;
    }

    try {
      setCreatingUser(true);
      setError(null);
      setErrorIsUpgrade(false);
      setInviteFieldErrors({});
      const result = (await apiFetch("/rbac/users/invite", {
        method: "POST",
        body: JSON.stringify({ email: parsed.data.email }),
      })) as { email_sent: boolean; invite_link: string | null };
      await fetchUsers();
      if (result.email_sent) {
        setCreateUserOpen(false);
        setNewUserEmail("");
      } else {
        // Leave the dialog open with the fallback link instead of closing
        // on a delivery failure the admin has no other way of noticing.
        setInviteLinkFallback(result.invite_link);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to send invite."));
      setErrorIsUpgrade(isUpgradeRequiredError(err));
    } finally {
      setCreatingUser(false);
    }
  }

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.is_active).length;
    const admins = users.filter(u => u.is_admin).length;
    return { total, active, admins };
  }, [users]);

  const toggleUserSelection = (userId: number) => {
    setSelectedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const selectedUser = viewUserDetails ? users.find(u => u.id === viewUserDetails) : null;
  const selectedUserRoles = selectedUser ? (userRoles[selectedUser.id] || []) : [];

  if (!hasPermission(Permission.SETTINGS_USERS_MANAGE)) {
    return (
      <SettingsPageShell eyebrow="Access control" title="Users" width="wide">
        <SettingsBanner tone="warning" title="Read-only">
          You do not have permission to manage members.
        </SettingsBanner>
      </SettingsPageShell>
    );
  }

  if (loading && users.length === 0) {
    return (
      <SettingsPageShell eyebrow="Access control" title="Users" width="wide" divided={false}>
        <PageSkeleton withEyebrow withActions variant="table" rows={6} />
      </SettingsPageShell>
    );
  }

  const summaryRows: Array<{ label: string; value: string; icon: typeof Users }> = [
    { label: "Members", value: stats.total.toString(), icon: Users },
    { label: "Active", value: stats.active.toString(), icon: CheckCircle2 },
    { label: "Administrators", value: stats.admins.toString(), icon: Shield },
  ];

  const filteringActive =
    Boolean(searchQuery) || statusFilter !== "all" || roleFilter !== "all";

  return (
    <SettingsPageShell
      eyebrow="Access control"
      title="Users"
      description="Manage workspace members, role assignments, and password access so the right people can operate PurveX."
      width="wide"
      status={
        <span className="text-xs text-[var(--surface-subtle-foreground)]">
          {stats.total} member{stats.total === 1 ? "" : "s"}
        </span>
      }
      actions={
        <Dialog
          open={createUserOpen}
          onOpenChange={(open) => {
            setCreateUserOpen(open);
            if (!open) {
              setNewUserEmail("");
              setInviteLinkFallback(null);
              setInviteLinkCopied(false);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" className="whitespace-nowrap">
              <UserPlus className="mr-2 h-4 w-4" />
              Add member
            </Button>
          </DialogTrigger>
          <DialogContent className="w-[min(calc(100vw-2rem),28rem)] px-6 py-6">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5" />
                Invite member
              </DialogTitle>
              <DialogDescription>
                {inviteLinkFallback
                  ? "The account was created, but the activation email could not be sent."
                  : "We will email an activation link so they can set their own password."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              {inviteLinkFallback ? (
                <>
                  <SettingsBanner tone="warning" title="Email not sent">
                    {`SMTP isn't configured on this instance (or the send failed), so ${newUserEmail || "they"} won't get an email. Share this activation link with them directly — it works the same way and expires in 7 days.`}
                  </SettingsBanner>
                  <div className="space-y-1.5">
                    <Label htmlFor="invite-link-fallback">Activation link</Label>
                    <div className="flex gap-2">
                      <Input id="invite-link-fallback" readOnly value={inviteLinkFallback} className="font-mono text-xs" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => {
                          navigator.clipboard?.writeText(inviteLinkFallback).then(() => {
                            setInviteLinkCopied(true);
                            setTimeout(() => setInviteLinkCopied(false), 1800);
                          });
                        }}
                        aria-label="Copy activation link"
                      >
                        {inviteLinkCopied ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="new-email">Email</Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => {
                      setNewUserEmail(e.target.value);
                      if (inviteFieldErrors.email)
                        setInviteFieldErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                    placeholder="user@example.com"
                    aria-invalid={!!inviteFieldErrors.email}
                    aria-describedby="new-email-error"
                  />
                  <FieldError id="new-email-error" message={inviteFieldErrors.email} />
                </div>
              )}
              {error && errorIsUpgrade ? (
                <UpgradeBanner message={error} />
              ) : (
                <FormError message={error} />
              )}
            </div>
            <DialogFooter className="gap-2">
              {inviteLinkFallback ? (
                <Button
                  onClick={() => {
                    setCreateUserOpen(false);
                    setNewUserEmail("");
                    setInviteLinkFallback(null);
                    setInviteLinkCopied(false);
                  }}
                  className="flex-1"
                >
                  Done
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setCreateUserOpen(false)}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateUser}
                    disabled={creatingUser}
                    className="flex-1"
                  >
                    {creatingUser ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Send invite
                      </>
                    )}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
      banner={
        error && !passwordDialogOpen && !createUserOpen ? (
          <SettingsBanner tone="danger" icon={<AlertCircle className="h-4 w-4" />}>
            {error}
          </SettingsBanner>
        ) : undefined
      }
    >

      <SettingsSection title="At a glance" stacked>
        <div className="grid gap-3 sm:grid-cols-3">
          {summaryRows.map((row) => {
            const Icon = row.icon;
            return (
              <div
                key={row.label}
                className="flex items-start justify-between rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-3"
              >
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                    {row.label}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-[var(--surface-card-foreground)]">
                    {row.value}
                  </p>
                </div>
                <Icon className="h-5 w-5 text-[var(--surface-subtle-foreground)]" />
              </div>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Members"
        description={
          selectedUsers.size > 0
            ? `${selectedUsers.size} selected`
            : `${filteredUsers.length} of ${users.length} member${users.length === 1 ? "" : "s"}`
        }
        stacked
      >
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--surface-subtle-foreground)]" />
              <Input
                placeholder="Search by email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
                aria-label="Search members"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={(value: "all" | "active" | "inactive") => setStatusFilter(value)}
            >
              <SelectTrigger className="sm:w-[140px]" aria-label="Filter by status">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="sm:w-[180px]" aria-label="Filter by role">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {availableRoles.map((role) => (
                  <SelectItem key={role.id} value={role.name}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedUsers.size > 0 ? (
              <div className="flex items-center gap-2 sm:ml-auto">
                <Button variant="outline" size="sm" onClick={() => setSelectedUsers(new Set())}>
                  <X className="mr-2 h-4 w-4" />
                  Clear selection
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportSelected}>
                  <Download className="mr-2 h-4 w-4" />
                  Export selected
                </Button>
              </div>
            ) : null}
          </div>

          {filteredUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--stroke-soft)] bg-[var(--surface-elevated)] py-12 text-center">
              <Users className="h-8 w-8 text-[var(--surface-subtle-foreground)] opacity-60" />
              <p className="text-sm text-[var(--surface-subtle-foreground)]">
                {filteringActive
                  ? "No members match your filters."
                  : "No members yet. Add your first member to get started."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[var(--stroke-soft)]">
            <Table>
              <TableHeader>
                <TableRow>
                    <TableHead className="w-[50px]">
                      <input
                        type="checkbox"
                        checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-[var(--stroke-soft)]"
                      />
                    </TableHead>
                    <TableHead className="w-[300px]">User</TableHead>
                    <TableHead>Roles & Permissions</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead className="w-[140px]">Created</TableHead>
                    <TableHead className="w-[220px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                  {filteredUsers.map(user => {
                    const currentRoles = userRoles[user.id] || [];
                    const displayRoles = user.is_admin
                      ? currentRoles.filter(role => role.role_name !== "ADMINISTRATOR")
                      : currentRoles;
                    const unassignedRoles = availableRoles.filter(
                      role => !currentRoles.some(ur => ur.role_name === role.name) && role.name !== "ADMINISTRATOR"
                    );
                    const createdDate = new Date(user.created_at);
                    const isSelected = selectedUsers.has(user.id);
                    
                    return (
                      <TableRow
                        key={user.id}
                        className={cn(
                          "hover:bg-[var(--surface-subtle)] transition-colors",
                          isSelected && "bg-[var(--accent-soft)] border-[var(--accent-line)]"
                        )}
                      >
                        <TableCell className="align-middle py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleUserSelection(user.id)}
                            className="rounded border-[var(--stroke-soft)]"
                          />
                        </TableCell>
                        <TableCell className="align-middle py-3">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <div className="h-9 w-9 rounded-full bg-[var(--accent-soft)] border border-[var(--accent-line)] flex items-center justify-center">
                                <span className="text-xs font-medium text-[var(--accent-strong)]">
                                  {user.email.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{user.email}</div>
                                {user.is_admin && (
                                  <Chip tone="accent" className="mt-1 w-fit">
                                    <Shield className="h-3 w-3" />
                                    Administrator
                                  </Chip>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="align-middle py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {displayRoles.map(ur => (
                              <Chip
                                key={ur.id}
                                tone="info"
                              >
                                {ur.role_name}
                                {ur.expires_at && (
                                  <Clock className="h-3 w-3 ml-1" />
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="ml-1.5 h-4 w-4 p-0 hover:bg-[var(--accent-soft)] text-xs"
                                  onClick={() => handleRemoveRole(user.id, ur.id)}
                                >
                                  ×
                                </Button>
                              </Chip>
                            ))}
                            {!user.is_admin && currentRoles.length === 0 && (
                              <span className="text-xs text-muted-foreground italic">No roles assigned</span>
                            )}
                          </div>
                        </TableCell>
                    <TableCell className="align-middle py-3">
                          <Chip tone={user.is_pending_activation ? "warning" : user.is_active ? "success" : "neutral"}>
                            {user.is_pending_activation ? (
                              <>
                                <Clock className="h-3 w-3" />
                                Pending
                              </>
                            ) : user.is_active ? (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                Active
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3 w-3" />
                                Inactive
                              </>
                            )}
                          </Chip>
                    </TableCell>
                    <TableCell className="align-middle py-3">
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            {format(createdDate, "MMM d, yyyy")}
                          </div>
                    </TableCell>
                    <TableCell className="align-middle py-3">
                          <div className="flex items-center justify-end gap-3">
                            {unassignedRoles.length > 0 && (
                              <Select
                                onValueChange={(roleName: string) => handleAssignRole(user.id, roleName)}
                                disabled={assigningRole === user.id}
                              >
                                <SelectTrigger className="w-[140px] h-8 text-xs">
                                  <SelectValue placeholder="Add role" />
                                </SelectTrigger>
                                <SelectContent>
                                  {unassignedRoles.map(role => (
                                    <SelectItem key={role.id} value={role.name}>
                                      {role.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                              <Dialog 
                              open={passwordDialogOpen === user.id}
                              onOpenChange={(open) => {
                                setPasswordDialogOpen(open ? user.id : null);
                                if (!open) {
                                  setCurrentPassword("");
                                  setNewPassword("");
                                  setConfirmPassword("");
                                  setError(null);
                                }
                              }}
                            >
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm" className="h-8 text-xs">
                                  <Key className="h-3 w-3 mr-1.5" />
                                  Password
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="w-[min(calc(100vw-2rem),30rem)] h-[480px] flex flex-col items-center justify-between px-6 py-5">
                                <div className="w-full">
                                  <DialogTitle className="text-lg font-semibold">Set Password for {user.email}</DialogTitle>
                                  <DialogDescription className="text-sm mt-1">
                                    Create a secure password. Use at least 8 characters with uppercase, lowercase, and a number.
                                  </DialogDescription>
                                </div>
                                <div className="flex-1 flex flex-col justify-center gap-4 w-full max-w-sm">
                                  <div className="space-y-2 text-left">
                                    <Label htmlFor="current-password">Current Password</Label>
                                    <Input
                                      id="current-password"
                                      type="password"
                                      value={currentPassword}
                                      onChange={(e) => setCurrentPassword(e.target.value)}
                                      placeholder="Enter your current password"
                                      className="bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]"
                                    />
                                  </div>
                                  <div className="space-y-2 text-left">
                                    <Label htmlFor="password">New Password</Label>
                                    <Input
                                      id="password"
                                      type="password"
                                      value={newPassword}
                                      onChange={(e) => setNewPassword(e.target.value)}
                                      placeholder="Enter new password"
                                      className="bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]"
                                    />
                                    <PasswordStrengthIndicator password={newPassword} />
                                  </div>
                                  <div className="space-y-2 text-left">
                                    <Label htmlFor="confirm">Confirm Password</Label>
                                    <Input
                                      id="confirm"
                                      type="password"
                                      value={confirmPassword}
                                      onChange={(e) => setConfirmPassword(e.target.value)}
                                      placeholder="Confirm password"
                                      className="bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]"
                                    />
                                  </div>
                                  {error && passwordDialogOpen === user.id && (
                                    <div className={cn("rounded-xl border px-3 py-2 text-sm", toneClasses("danger").border, `${toneClasses("danger").bg}/10`, toneClasses("danger").text)}>
                                      {error}
                                    </div>
                                  )}
                                </div>
                                <DialogFooter className="gap-3 pt-4 w-full">
                                  <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={() => {
                                      setPasswordDialogOpen(null);
                                      setCurrentPassword("");
                                      setNewPassword("");
                                      setConfirmPassword("");
                                      setError(null);
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    className="flex-1 bg-[var(--accent-strong)] text-white hover:opacity-90"
                                    onClick={() => handleSetPassword(user.id)}
                                    disabled={settingPassword || !currentPassword || !newPassword || !confirmPassword}
                                  >
                                    {settingPassword ? (
                                      <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Setting...
                                      </>
                                    ) : (
                                      "Set Password"
                                    )}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn(
                                "h-8 text-xs",
                                user.is_active && toneClasses("danger").text,
                              )}
                              disabled={togglingActiveId === user.id}
                              onClick={() => handleToggleActive(user.id, user.is_active)}
                            >
                              {togglingActiveId === user.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : user.is_active ? (
                                <>
                                  <XCircle className="h-3 w-3 mr-1.5" />
                                  Deactivate
                                </>
                              ) : (
                                <>
                                  <CheckCircle2 className="h-3 w-3 mr-1.5" />
                                  Reactivate
                                </>
                              )}
                            </Button>
                          </div>
                    </TableCell>
                  </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
            </div>
          )}
        </div>
      </SettingsSection>

      {/* User Details Sidebar */}
      {selectedUser && (
        <Dialog open={viewUserDetails !== null} onOpenChange={(open) => !open && setViewUserDetails(null)}>
          <DialogContent className="w-[min(calc(100vw-2rem),38rem)] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-full bg-[var(--accent-soft)] border border-[var(--accent-line)] flex items-center justify-center">
                  <span className="text-sm font-medium text-[var(--accent-strong)]">
                    {selectedUser.email.charAt(0).toUpperCase()}
                  </span>
                </div>
                User Details
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Email</Label>
                <p className="text-sm font-medium mt-1 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {selectedUser.email}
                </p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Status</Label>
                <div className="mt-1">
                  <Chip tone={selectedUser.is_active ? "success" : "neutral"} size="md">
                    {selectedUser.is_active ? (
                      <>
                        <CheckCircle2 className="h-3 w-3" />
                        Active
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3" />
                        Inactive
                      </>
                    )}
                  </Chip>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Roles</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedUser.is_admin && (
                    <Chip tone="accent" size="md">
                      <Shield className="h-3 w-3" />
                      Administrator
                    </Chip>
                  )}
                  {selectedUserRoles.map(ur => (
                    <Chip key={ur.id} tone="info" size="md">
                      {ur.role_name}
                      {ur.expires_at && (
                        <span className="ml-1 text-xs">(expires {format(new Date(ur.expires_at), "MMM d")})</span>
                      )}
                    </Chip>
                  ))}
                  {!selectedUser.is_admin && selectedUserRoles.length === 0 && (
                    <span className="text-sm text-muted-foreground">No roles assigned</span>
                  )}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Account Created</Label>
                <p className="text-sm mt-1 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  {format(new Date(selectedUser.created_at), "PPpp")}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatRelative(new Date(selectedUser.created_at), new Date())}
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

    </SettingsPageShell>
  );
}
