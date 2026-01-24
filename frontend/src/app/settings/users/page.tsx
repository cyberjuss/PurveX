"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { getUsers, getUserRoles, assignRole, removeRole, listRoles, setUserPassword, apiFetch } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { 
  Search, UserPlus, Shield, Key, Users, Filter, CheckCircle2, XCircle, Clock, 
  MoreVertical, Eye, Edit, Trash2, Download, RefreshCw, AlertCircle, TrendingUp,
  Activity, Mail, Calendar, Lock, Unlock, UserCheck, X, Check, Loader2
} from "lucide-react";
import { format, formatRelative } from "date-fns";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

interface User {
  id: number;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
}

interface UserRole {
  id: number;
  role_id: number;
  role_name: string;
  assigned_at: string;
  expires_at: string | null;
}

function PasswordStrengthIndicator({ password }: { password: string }) {
  const getStrength = () => {
    if (!password) return { score: 0, label: "", color: "" };
    
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    
    if (score <= 2) return { score, label: "Weak", color: "bg-red-500" };
    if (score <= 4) return { score, label: "Fair", color: "bg-yellow-500" };
    if (score <= 5) return { score, label: "Good", color: "bg-blue-500" };
    return { score, label: "Strong", color: "bg-emerald-500" };
  };

  const strength = getStrength();
  const percentage = (strength.score / 6) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Password strength</span>
        <span className={cn(
          "font-medium",
          strength.score <= 2 && "text-red-400",
          strength.score <= 4 && strength.score > 2 && "text-yellow-400",
          strength.score <= 5 && strength.score > 4 && "text-blue-400",
          strength.score === 6 && "text-emerald-400"
        )}>
          {strength.label}
        </span>
      </div>
      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all duration-300", strength.color)}
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
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserConfirmPassword, setNewUserConfirmPassword] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [viewUserDetails, setViewUserDetails] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
      } catch (err: any) {
        setError(err.message || "Failed to load users.");
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
    } catch (err: any) {
      const message = err?.message || "Failed to assign role.";
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
    } catch (err: any) {
      setError(err.message || "Failed to remove role.");
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
    } catch (err: any) {
      setError(err.message || "Failed to set password.");
    } finally {
      setSettingPassword(false);
    }
  }

  async function handleCreateUser() {
    if (!newUserEmail || !newUserPassword) {
      setError("Email and password are required.");
      return;
    }
    if (newUserPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newUserPassword)) {
      setError("Password must contain uppercase, lowercase, and a number.");
      return;
    }
    if (newUserPassword !== newUserConfirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setCreatingUser(true);
      setError(null);
      // Use the register endpoint (will create non-admin user)
      await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email: newUserEmail,
          password: newUserPassword,
        }),
      });
      setCreateUserOpen(false);
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserConfirmPassword("");
      await fetchUsers();
    } catch (err: any) {
      setError(err.message || "Failed to create user.");
    } finally {
      setCreatingUser(false);
    }
  }

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter(u => u.is_active).length;
    const admins = users.filter(u => u.is_admin).length;
    const withRoles = users.filter(u => (userRoles[u.id] || []).length > 0 || u.is_admin).length;
    return { total, active, admins, inactive: total - active, withRoles };
  }, [users, userRoles]);

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
      <PageContainer>
        <Card className="elite-card ">
          <CardContent className="pt-6">
            <p className="text-slate-300">You don't have permission to manage users.</p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (loading && users.length === 0) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground">Loading users...</p>
          </div>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="w-full pl-0.5 pr-0 sm:pr-0 mb-4">
        <PageHeader
          className="mb-4"
          eyebrow="Access control"
          title="Users & Access Management"
          subtitle="Manage user accounts, roles, and permissions across your organization"
          icon={<Users className="h-5 w-5" />}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
                <DialogTrigger asChild>
                  <Button className="whitespace-nowrap">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Create User
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-2xl px-8 py-6">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  Create New User
                </DialogTitle>
                <DialogDescription>
                  Add a new user to your organization. They will need to set up their account.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="new-email">Username</Label>
                  <Input
                    id="new-email"
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="user@example.com"
                    className="bg-white border-slate-200 text-slate-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    placeholder="Enter password"
                    className="bg-white border-slate-200 text-slate-900"
                  />
                  <PasswordStrengthIndicator password={newUserPassword} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-confirm">Confirm Password</Label>
                  <Input
                    id="new-confirm"
                    type="password"
                    value={newUserConfirmPassword}
                    onChange={(e) => setNewUserConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="bg-white border-slate-200 text-slate-900"
                  />
                </div>
                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setCreateUserOpen(false)} className="flex-1">
                  Cancel
                </Button>
                <Button onClick={handleCreateUser} disabled={creatingUser} className="flex-1">
                  {creatingUser ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Create User
                    </>
                  )}
                </Button>
                </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          }
        />
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="elite-card  hover:border-blue-500/30 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Users</p>
                <p className="text-2xl font-bold mt-1">{stats.total}</p>
              </div>
              <Users className="h-8 w-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="elite-card  hover:border-emerald-500/30 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Users</p>
                <p className="text-2xl font-bold mt-1 text-emerald-400">{stats.active}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-emerald-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="elite-card  hover:border-purple-500/30 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Administrators</p>
                <p className="text-2xl font-bold mt-1 text-purple-400">{stats.admins}</p>
              </div>
              <Shield className="h-8 w-8 text-purple-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="elite-card hover:border-slate-600/50 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Inactive</p>
                <p className="text-2xl font-bold mt-1 text-slate-400">{stats.inactive}</p>
              </div>
              <XCircle className="h-8 w-8 text-slate-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="elite-card  hover:border-indigo-500/30 transition-colors">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">With Roles</p>
                <p className="text-2xl font-bold mt-1 text-indigo-400">{stats.withRoles}</p>
              </div>
              <UserCheck className="h-8 w-8 text-indigo-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Users Table Card */}
      <Card className="elite-card ">
        <CardHeader className="border-b border-white/5">
          <div className="flex items-center justify-between">
          <div>
              <CardTitle className="text-2xl font-display font-semibold flex items-center gap-2">
                <Users className="h-5 w-5" />
                User Accounts
              </CardTitle>
              <CardDescription className="mt-1">
                {selectedUsers.size > 0 && (
                  <span className="text-blue-400 font-medium">
                    {selectedUsers.size} selected
                  </span>
                )}
                {selectedUsers.size === 0 && (
                  <>
                    {filteredUsers.length} of {users.length} users
                  </>
                )}
            </CardDescription>
            </div>
            {selectedUsers.size > 0 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setSelectedUsers(new Set())}>
                  <X className="h-4 w-4 mr-2" />
                  Clear Selection
                </Button>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4 mr-2" />
                  Export Selected
                </Button>
              </div>
            )}
          </div>
          
          {/* Filters */}
          <div className="flex items-center gap-4 mt-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users by email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
              <SelectTrigger className="w-[140px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {availableRoles.map(role => (
                  <SelectItem key={role.id} value={role.name}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {error && !passwordDialogOpen && !createUserOpen && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          
          {filteredUsers.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-50" />
              <p className="text-muted-foreground">
                {searchQuery || statusFilter !== "all" || roleFilter !== "all"
                  ? "No users match your filters."
                  : "No users found. Create your first user to get started."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                    <TableHead className="w-[50px]">
                      <input
                        type="checkbox"
                        checked={selectedUsers.size === filteredUsers.length && filteredUsers.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-600"
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
                          "hover:bg-white/5 transition-colors",
                          isSelected && "bg-blue-500/10 border-blue-500/20"
                        )}
                      >
                        <TableCell className="align-middle py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleUserSelection(user.id)}
                            className="rounded border-slate-600"
                          />
                        </TableCell>
                        <TableCell className="align-middle py-3">
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30 flex items-center justify-center">
                                <span className="text-xs font-medium text-blue-300">
                                  {user.email.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{user.email}</div>
                                {user.is_admin && (
                                  <Badge variant="outline" className="bg-purple-500/10 text-purple-300 border-purple-500/30 text-xs mt-1 w-fit">
                                    <Shield className="h-3 w-3 mr-1" />
                                    Administrator
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="align-middle py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {displayRoles.map(ur => (
                              <Badge 
                                key={ur.id} 
                                className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-xs"
                              >
                                {ur.role_name}
                                {ur.expires_at && (
                                  <Clock className="h-3 w-3 ml-1" />
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="ml-1.5 h-4 w-4 p-0 hover:bg-blue-500/30 text-xs"
                                  onClick={() => handleRemoveRole(user.id, ur.id)}
                                >
                                  ×
                                </Button>
                              </Badge>
                            ))}
                            {!user.is_admin && currentRoles.length === 0 && (
                              <span className="text-xs text-muted-foreground italic">No roles assigned</span>
                            )}
                          </div>
                        </TableCell>
                    <TableCell className="align-middle py-3">
                          <Badge 
                            className={
                              user.is_active 
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-xs" 
                                : "bg-slate-500/20 text-slate-300 border-slate-500/40 text-xs"
                            }
                          >
                            {user.is_active ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Active
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3 w-3 mr-1" />
                                Inactive
                              </>
                            )}
                      </Badge>
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
                              <DialogContent className="w-[480px] max-w-[480px] sm:max-w-[480px] h-[480px] rounded-3xl border border-slate-200 bg-white shadow-2xl flex flex-col items-center justify-between px-6 py-5">
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
                                      className="bg-white border-slate-200 text-slate-900"
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
                                      className="bg-white border-slate-200 text-slate-900"
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
                                      className="bg-white border-slate-200 text-slate-900"
                                    />
                                  </div>
                                  {error && passwordDialogOpen === user.id && (
                                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
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
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700"
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
                          </div>
                    </TableCell>
                  </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Details Sidebar */}
      {selectedUser && (
        <Dialog open={viewUserDetails !== null} onOpenChange={(open) => !open && setViewUserDetails(null)}>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30 flex items-center justify-center">
                  <span className="text-sm font-medium text-blue-300">
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
                  <Badge 
                    className={
                      selectedUser.is_active 
                        ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" 
                        : "bg-slate-500/20 text-slate-300 border-slate-500/40"
                    }
                  >
                    {selectedUser.is_active ? (
                      <>
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Active
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3 mr-1" />
                        Inactive
                      </>
                    )}
                  </Badge>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Roles</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedUser.is_admin && (
                    <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40">
                      <Shield className="h-3 w-3 mr-1" />
                      Administrator
                    </Badge>
                  )}
                  {selectedUserRoles.map(ur => (
                    <Badge key={ur.id} className="bg-blue-500/20 text-blue-300 border-blue-500/40">
                      {ur.role_name}
                      {ur.expires_at && (
                        <span className="ml-1 text-xs">(expires {format(new Date(ur.expires_at), "MMM d")})</span>
                      )}
                    </Badge>
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

      {/* Available Roles Info */}
      {availableRoles.length > 0 && (
        <Card className="elite-card ">
          <CardHeader className="border-b border-white/5">
            <CardTitle className="text-2xl font-display font-semibold flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Available Roles & Permissions
            </CardTitle>
            <CardDescription>
              Roles define what users can do in PurveX. Assign roles to grant specific permissions.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {availableRoles.map(role => (
                <div key={role.id} className="p-4 border border-white/5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                  <div className="font-medium text-sm mb-1 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-400" />
                    {role.name}
                  </div>
                  {role.description && (
                    <div className="text-xs text-muted-foreground mt-2">{role.description}</div>
                  )}
                </div>
              ))}
    </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
