"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SkeletonTableRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuditEvents, getAuditStats, cleanupAuditEvents, AuditEvent, AuditStats } from "@/lib/api";
import { 
  Search, Filter, Download, User, Activity, 
  Shield, Settings, TestTube, Key, Server, Clock,
  FileText, AlertCircle
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/toast";

// Audit events have many action codes but only a handful of semantic
// meanings (created / updated / deleted / security / sensitive). Collapse
// them into Chip tones so the audit log stays colour-consistent even when
// new action codes are added on the backend — any unmapped code defaults
// to `neutral`.
const ACTION_TONE: Record<string, NonNullable<ChipProps["tone"]>> = {
  LOGIN_SUCCESS: "success",
  PROVISION_SANDBOX: "success",
  LOGIN_FAILED: "danger",
  DELETE_DETECTION: "danger",
  DELETE_SIEM_CONNECTION: "danger",
  CREATE_DETECTION: "info",
  CREATE_SIEM_CONNECTION: "info",
  UPDATE_DETECTION: "warning",
  UPDATE_SIEM_CONNECTION: "warning",
  RESET_SANDBOX: "warning",
  SET_USER_PASSWORD: "warning",
  RUN_TEST: "accent",
  SCHEDULE_TEST: "accent",
  UPDATE_SETTINGS_ORGANIZATION: "neutral",
};

const RESOURCE_ICONS: Record<string, typeof Activity> = {
  "detection": FileText,
  "test": TestTube,
  "settings": Settings,
  "auth": Shield,
  "user": User,
  "sandbox": Server,
};

interface AuditQueryParams {
  skip: number;
  limit: number;
  search?: string;
  action?: string;
  resource_type?: string;
  start_date?: string;
  end_date?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function getActionIcon(action: string) {
  if (action.includes("LOGIN")) return Shield;
  if (action.includes("DETECTION")) return FileText;
  if (action.includes("TEST")) return TestTube;
  if (action.includes("SETTINGS") || action.includes("SIEM") || action.includes("RUNNER")) return Settings;
  if (action.includes("PASSWORD") || action.includes("ROLE")) return Key;
  if (action.includes("SANDBOX")) return Server;
  return Activity;
}

export default function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupDays, setCleanupDays] = useState(30);
  const { isAdmin } = usePermissions();
  const { toast } = useToast();
  
  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("7d");
  const [page, setPage] = useState(0);
  const [limit] = useState(50);

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);
      const params: AuditQueryParams = {
        skip: page * limit,
        limit,
      };

      if (searchQuery) {
        params.search = searchQuery;
      }

      if (actionFilter !== "all") {
        params.action = actionFilter;
      }

      if (resourceTypeFilter !== "all") {
        params.resource_type = resourceTypeFilter;
      }

      if (dateRange !== "all") {
        const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        params.start_date = startDate.toISOString();
        params.end_date = endDate.toISOString();
      }

      const data = await getAuditEvents(params);
      setEvents(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load audit events"));
      console.error("Error fetching audit events:", err);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, dateRange, limit, page, resourceTypeFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : dateRange === "90d" ? 90 : 7;
      const data = await getAuditStats(days);
      setStats(data);
    } catch (err: unknown) {
      console.error("Error fetching audit stats:", err);
    }
  }, [dateRange]);

  useEffect(() => {
    setLoading(true);
    void fetchEvents();
    void fetchStats();
  }, [fetchEvents, fetchStats]);

  const handleCleanup = async () => {
    if (!Number.isFinite(cleanupDays) || cleanupDays < 1) {
      setError("Please enter a valid number of days (1+).");
      return;
    }
    const confirmed = window.confirm(
      `This will delete audit events older than ${cleanupDays} day(s). This action cannot be undone. Continue?`
    );
    if (!confirmed) return;
    try {
      setCleaning(true);
      const result = await cleanupAuditEvents(cleanupDays);
      setPage(0);
      await fetchEvents();
      await fetchStats();
      toast({
        type: "success",
        title: "Audit log cleaned",
        description: `Removed ${result?.deleted ?? 0} event(s) older than ${cleanupDays} day(s).`,
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err, "Failed to clean audit events");
      setError(message);
      toast({
        type: "error",
        title: "Cleanup failed",
        description: message,
      });
    } finally {
      setCleaning(false);
    }
  };

  const handleExport = () => {
    // Export to CSV
    const headers = ["ID", "Timestamp", "User", "Action", "Resource Type", "Resource ID", "Details"];
    const rows = events.map(e => [
      e.id,
      e.created_at,
      e.user_email || "Unknown",
      e.action,
      e.resource_type || "",
      e.resource_id || "",
      e.details || "",
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Get unique actions and resource types for filters
  const uniqueActions = Array.from(new Set(events.map(e => e.action))).sort();
  const uniqueResourceTypes = Array.from(
    new Set(events.map((e) => e.resource_type).filter((type): type is string => Boolean(type)))
  ).sort();

  return (
    <PageContainer>
      <div className="w-full pl-0.5 pr-0 sm:pr-0">
        <PageHeader
          className="mb-6"
          eyebrow="Governance"
          title="Audit"
          subtitle="Review who changed what and when so configuration, access, and operational changes stay traceable."
          icon={<FileText className="h-5 w-5" />}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={events.length === 0}
              className="h-9 whitespace-nowrap bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)] hover:bg-[var(--surface-elevated)] shadow-sm"
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          }
        />
      </div>

      {isAdmin() && (
        <Card className="mb-6 border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <CardHeader>
            <CardTitle className="text-base">Retention cleanup</CardTitle>
            <CardDescription>
              Delete older audit records only when you need to reduce retained history.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  value={cleanupDays}
                  onChange={(e) => setCleanupDays(Number(e.target.value))}
                  className="h-9 w-24 text-center border-slate-200 bg-slate-50 text-[var(--foreground)] font-semibold"
                  aria-label="Audit cleanup days"
                />
                <span className="text-sm text-slate-600 dark:text-slate-400">days to keep at minimum</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCleanup}
                disabled={cleaning}
                className="h-9 whitespace-nowrap bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)] hover:bg-[var(--surface-elevated)] shadow-sm"
              >
                <Filter className={cn("h-4 w-4 mr-2", cleaning && "animate-spin")} />
                Clean records older than {cleanupDays} days
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {stats && (
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400">Total Events</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-100">{stats.total_events.toLocaleString()}</div>
              <p className="text-xs text-slate-500 mt-1">Last {stats.period_days} days</p>
            </CardContent>
          </Card>

          <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400">Top Action</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-100">
                {Object.entries(stats.events_by_action)[0]?.[0]?.replace(/_/g, " ") || "N/A"}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {Object.entries(stats.events_by_action)[0]?.[1] || 0} events
              </p>
            </CardContent>
          </Card>

          <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400">Top Resource</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-100">
                {Object.entries(stats.events_by_resource)[0]?.[0] || "N/A"}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {Object.entries(stats.events_by_resource)[0]?.[1] || 0} events
              </p>
            </CardContent>
          </Card>

          <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm dark:border-slate-800 dark:bg-slate-950">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400">Most Active User</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-100 truncate">
                {Object.entries(stats.top_users)[0]?.[0]?.split("@")[0] || "N/A"}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {Object.entries(stats.top_users)[0]?.[1] || 0} events
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="mb-6 border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <CardHeader>
          <CardTitle className="text-base">Find changes</CardTitle>
          <CardDescription>Search audit history by person, action, resource type, and time range.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="search" className="text-xs text-slate-400">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  id="search"
                  placeholder="Search details..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setPage(0);
                      fetchEvents();
                    }
                  }}
                  className="pl-9 h-9 bg-white border-slate-200 text-[var(--foreground)] placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="action" className="text-xs text-slate-400">Action</Label>
              <Select value={actionFilter} onValueChange={(v: string) => { setActionFilter(v); setPage(0); }}>
                <SelectTrigger id="action" className="h-9 bg-white border-slate-200 text-[var(--foreground)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-[var(--stroke-soft)] shadow-lg">
                  <SelectItem value="all">All Actions</SelectItem>
                  {uniqueActions.map(action => (
                    <SelectItem key={action} value={action}>
                      {action.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="resource" className="text-xs text-slate-400">Resource Type</Label>
              <Select value={resourceTypeFilter} onValueChange={(v: string) => { setResourceTypeFilter(v); setPage(0); }}>
                <SelectTrigger id="resource" className="h-9 bg-white border-slate-200 text-[var(--foreground)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-[var(--stroke-soft)] shadow-lg">
                  <SelectItem value="all">All Resources</SelectItem>
                  {uniqueResourceTypes.map(type => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateRange" className="text-xs text-slate-400">Date Range</Label>
              <Select value={dateRange} onValueChange={(value: "7d" | "30d" | "90d" | "all") => { setDateRange(value); setPage(0); }}>
                <SelectTrigger id="dateRange" className="h-9 bg-white border-slate-200 text-[var(--foreground)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-[var(--stroke-soft)] shadow-lg">
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <CardHeader>
          <CardTitle className="text-base">Change history</CardTitle>
          <CardDescription className="text-slate-500">
            Showing {events.length} event{events.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Table>
              <TableBody>
                <SkeletonTableRows rows={6} columns={5} />
              </TableBody>
            </Table>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-400">
              <AlertCircle className="h-5 w-5 mr-2" />
              {error}
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <FileText className="h-5 w-5 mr-2" />
              No audit events found
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[var(--stroke-soft)] overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200 bg-slate-50">
                      <TableHead className="text-slate-500">Timestamp</TableHead>
                      <TableHead className="text-slate-500">User</TableHead>
                      <TableHead className="text-slate-500">Action</TableHead>
                      <TableHead className="text-slate-500">Resource</TableHead>
                      <TableHead className="text-slate-500">Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((event) => {
                      const ActionIcon = getActionIcon(event.action);
                      const ResourceIcon = RESOURCE_ICONS[event.resource_type || ""] || Activity;
                      
                      return (
                        <TableRow key={event.id} className="border-slate-200 hover:bg-slate-50">
                          <TableCell className="text-slate-700">
                            <div className="flex items-center gap-2">
                              <Clock className="h-3.5 w-3.5 text-slate-500" />
                              <div>
                                <div className="text-sm">{format(parseISO(event.created_at), "MMM d, yyyy")}</div>
                                <div className="text-xs text-slate-500">{format(parseISO(event.created_at), "h:mm:ss a")}</div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-700">
                            <div className="flex items-center gap-2">
                              <User className="h-3.5 w-3.5 text-slate-500" />
                              <span className="text-sm">{event.user_email || "Unknown"}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Chip tone={ACTION_TONE[event.action] ?? "neutral"}>
                              <ActionIcon className="h-3 w-3" />
                              {event.action.replace(/_/g, " ")}
                            </Chip>
                          </TableCell>
                          <TableCell className="text-slate-300">
                            {event.resource_type ? (
                              <div className="flex items-center gap-2">
                                <ResourceIcon className="h-3.5 w-3.5 text-slate-500" />
                                <span className="text-sm">{event.resource_type}</span>
                                {event.resource_id && (
                                  <span className="text-xs text-slate-500">#{event.resource_id.slice(0, 8)}</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-slate-500">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-slate-400 text-sm max-w-md truncate">
                            {event.details || "-"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-slate-500">
                  Page {page + 1} - {events.length} events
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => p + 1)}
                    disabled={events.length < limit}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
