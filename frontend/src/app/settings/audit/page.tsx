"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SkeletonTableRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  getAuditEvents,
  getAuditStats,
  cleanupAuditEvents,
  AuditEvent,
  AuditStats,
} from "@/lib/api";
import {
  Search,
  Download,
  User,
  Activity,
  Shield,
  Settings as SettingsIcon,
  TestTube,
  Key,
  Server,
  Clock,
  FileText,
  AlertCircle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/toast";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsBanner,
  SettingsStatusPill,
} from "@/components/settings/settings-section";

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
  detection: FileText,
  test: TestTube,
  settings: SettingsIcon,
  auth: Shield,
  user: User,
  sandbox: Server,
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getActionIcon(action: string) {
  if (action.includes("LOGIN")) return Shield;
  if (action.includes("DETECTION")) return FileText;
  if (action.includes("TEST")) return TestTube;
  if (action.includes("SETTINGS") || action.includes("SIEM") || action.includes("RUNNER"))
    return SettingsIcon;
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

  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [resourceTypeFilter, setResourceTypeFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d" | "all">("7d");
  const [page, setPage] = useState(0);
  const [limit] = useState(50);

  const fetchEvents = useCallback(async () => {
    try {
      setError(null);
      const params: AuditQueryParams = { skip: page * limit, limit };
      if (searchQuery) params.search = searchQuery;
      if (actionFilter !== "all") params.action = actionFilter;
      if (resourceTypeFilter !== "all") params.resource_type = resourceTypeFilter;
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
    } finally {
      setLoading(false);
    }
  }, [actionFilter, dateRange, limit, page, resourceTypeFilter, searchQuery]);

  const fetchStats = useCallback(async () => {
    try {
      const days =
        dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : dateRange === "90d" ? 90 : 7;
      const data = await getAuditStats(days);
      setStats(data);
    } catch {
      // Stats are non-critical; the table is the source of truth.
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
      toast({ type: "error", title: "Cleanup failed", description: message });
    } finally {
      setCleaning(false);
    }
  };

  const handleExport = () => {
    const headers = [
      "ID",
      "Timestamp",
      "User",
      "Action",
      "Resource Type",
      "Resource ID",
      "Details",
    ];
    const rows = events.map((e) => [
      e.id,
      e.created_at,
      e.user_email || "Unknown",
      e.action,
      e.resource_type || "",
      e.resource_id || "",
      e.details || "",
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const uniqueActions = Array.from(new Set(events.map((e) => e.action))).sort();
  const uniqueResourceTypes = Array.from(
    new Set(events.map((e) => e.resource_type).filter((t): t is string => Boolean(t)))
  ).sort();

  const summaryRows: Array<{ label: string; primary: string; secondary: string }> = stats
    ? [
        {
          label: "Total events",
          primary: stats.total_events.toLocaleString(),
          secondary: `Last ${stats.period_days} days`,
        },
        {
          label: "Top action",
          primary: Object.entries(stats.events_by_action)[0]?.[0]?.replace(/_/g, " ") || "—",
          secondary: `${Object.entries(stats.events_by_action)[0]?.[1] ?? 0} events`,
        },
        {
          label: "Top resource",
          primary: Object.entries(stats.events_by_resource)[0]?.[0] || "—",
          secondary: `${Object.entries(stats.events_by_resource)[0]?.[1] ?? 0} events`,
        },
        {
          label: "Most active user",
          primary:
            Object.entries(stats.top_users)[0]?.[0]?.split("@")[0] || "—",
          secondary: `${Object.entries(stats.top_users)[0]?.[1] ?? 0} events`,
        },
      ]
    : [];

  return (
    <SettingsPageShell
      eyebrow="Governance"
      title="Audit"
      description="Who changed what, when. The configuration, access, and operational change log for this workspace."
      width="wide"
      status={
        stats ? (
          <SettingsStatusPill tone="muted">
            {stats.total_events.toLocaleString()} events
          </SettingsStatusPill>
        ) : null
      }
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={events.length === 0}
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      }
      banner={
        error ? (
          <SettingsBanner tone="danger" title="Could not load audit events">
            {error}
          </SettingsBanner>
        ) : undefined
      }
    >
      {summaryRows.length > 0 ? (
        <SettingsSection title="At a glance" stacked>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {summaryRows.map((row) => (
              <div
                key={row.label}
                className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-3"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                  {row.label}
                </p>
                <p className="mt-1 truncate text-lg font-semibold text-[var(--surface-card-foreground)]">
                  {row.primary}
                </p>
                <p className="text-xs text-[var(--surface-subtle-foreground)]">
                  {row.secondary}
                </p>
              </div>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Filters" stacked>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--surface-subtle-foreground)]" />
            <Input
              placeholder="Search details…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(0);
                  fetchEvents();
                }
              }}
              className="pl-9"
              aria-label="Search audit details"
            />
          </div>
          <Select
            value={actionFilter}
            onValueChange={(v: string) => {
              setActionFilter(v);
              setPage(0);
            }}
          >
            <SelectTrigger aria-label="Filter by action">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {uniqueActions.map((action) => (
                <SelectItem key={action} value={action}>
                  {action.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={resourceTypeFilter}
            onValueChange={(v: string) => {
              setResourceTypeFilter(v);
              setPage(0);
            }}
          >
            <SelectTrigger aria-label="Filter by resource">
              <SelectValue placeholder="All resources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All resources</SelectItem>
              {uniqueResourceTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={dateRange}
            onValueChange={(value: "7d" | "30d" | "90d" | "all") => {
              setDateRange(value);
              setPage(0);
            }}
          >
            <SelectTrigger aria-label="Filter by date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Change history"
        description={`Showing ${events.length} event${events.length === 1 ? "" : "s"}.`}
        stacked
      >
        {loading ? (
          <div className="overflow-hidden rounded-lg border border-[var(--stroke-soft)]">
            <Table>
              <TableBody>
                <SkeletonTableRows rows={6} columns={5} />
              </TableBody>
            </Table>
          </div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--stroke-soft)] bg-[var(--surface-elevated)] py-12 text-sm text-[var(--surface-subtle-foreground)]">
            <FileText className="h-5 w-5" />
            No audit events match your filters.
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 py-8 text-sm text-rose-700">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-[var(--stroke-soft)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => {
                    const ActionIcon = getActionIcon(event.action);
                    const ResourceIcon =
                      RESOURCE_ICONS[event.resource_type || ""] || Activity;

                    return (
                      <TableRow key={event.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 text-[var(--surface-subtle-foreground)]" />
                            <div>
                              <div className="text-sm">
                                {format(parseISO(event.created_at), "MMM d, yyyy")}
                              </div>
                              <div className="text-xs text-[var(--surface-subtle-foreground)]">
                                {format(parseISO(event.created_at), "h:mm:ss a")}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-3.5 w-3.5 text-[var(--surface-subtle-foreground)]" />
                            <span className="text-sm">{event.user_email || "Unknown"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Chip tone={ACTION_TONE[event.action] ?? "neutral"}>
                            <ActionIcon className="h-3 w-3" />
                            {event.action.replace(/_/g, " ")}
                          </Chip>
                        </TableCell>
                        <TableCell>
                          {event.resource_type ? (
                            <div className="flex items-center gap-2">
                              <ResourceIcon className="h-3.5 w-3.5 text-[var(--surface-subtle-foreground)]" />
                              <span className="text-sm">{event.resource_type}</span>
                              {event.resource_id && (
                                <span className="text-xs text-[var(--surface-subtle-foreground)]">
                                  #{event.resource_id.slice(0, 8)}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-[var(--surface-subtle-foreground)]">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-md truncate text-sm text-[var(--surface-subtle-foreground)]">
                          {event.details || "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-between pt-3 text-sm text-[var(--surface-subtle-foreground)]">
              <span>
                Page {page + 1} · {events.length} event{events.length === 1 ? "" : "s"}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={events.length < limit}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </SettingsSection>

      {isAdmin() ? (
        <SettingsSection
          title="Retention cleanup"
          description="Permanently remove records older than the chosen window. Use sparingly."
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={cleanupDays}
                onChange={(e) => setCleanupDays(Number(e.target.value))}
                className="w-24 text-center"
                aria-label="Audit cleanup days"
              />
              <span className="text-sm text-[var(--surface-subtle-foreground)]">
                days kept at minimum
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCleanup}
              disabled={cleaning}
              className={cn(cleaning && "opacity-70")}
            >
              {cleaning
                ? "Cleaning…"
                : `Delete records older than ${cleanupDays} day${cleanupDays === 1 ? "" : "s"}`}
            </Button>
          </div>
        </SettingsSection>
      ) : null}
    </SettingsPageShell>
  );
}
