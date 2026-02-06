"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuditEvents, getAuditStats, cleanupAuditEvents, AuditEvent, AuditStats } from "@/lib/api";
import { 
  Search, Filter, Download, RefreshCw, Calendar, User, Activity, 
  Shield, Settings, TestTube, Key, Server, TrendingUp, Clock,
  FileText, AlertCircle, CheckCircle2, XCircle
} from "lucide-react";
import { format, formatRelative, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/components/ui/toast";

const ACTION_COLORS: Record<string, string> = {
  "LOGIN_SUCCESS": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "LOGIN_FAILED": "bg-red-500/20 text-red-400 border-red-500/30",
  "CREATE_DETECTION": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "UPDATE_DETECTION": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "DELETE_DETECTION": "bg-red-500/20 text-red-400 border-red-500/30",
  "RUN_TEST": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "SCHEDULE_TEST": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  "CREATE_SIEM_CONNECTION": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "UPDATE_SIEM_CONNECTION": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "DELETE_SIEM_CONNECTION": "bg-red-500/20 text-red-400 border-red-500/30",
  "SET_USER_PASSWORD": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "UPDATE_SETTINGS_ORGANIZATION": "bg-slate-500/20 text-slate-400 border-slate-500/30",
  "PROVISION_SANDBOX": "bg-green-500/20 text-green-400 border-green-500/30",
  "RESET_SANDBOX": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
};

const RESOURCE_ICONS: Record<string, any> = {
  "detection": FileText,
  "test": TestTube,
  "settings": Settings,
  "auth": Shield,
  "user": User,
  "sandbox": Server,
};

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
  const [refreshing, setRefreshing] = useState(false);
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

  const fetchEvents = async () => {
    try {
      setError(null);
      const params: any = {
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
    } catch (err: any) {
      setError(err.message || "Failed to load audit events");
      console.error("Error fetching audit events:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchStats = async () => {
    try {
      const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : dateRange === "90d" ? 90 : 7;
      const data = await getAuditStats(days);
      setStats(data);
    } catch (err: any) {
      console.error("Error fetching audit stats:", err);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchEvents();
    fetchStats();
  }, [page, actionFilter, resourceTypeFilter, dateRange]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchEvents();
    fetchStats();
  };

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
    } catch (err: any) {
      setError(err?.message || "Failed to clean audit events");
      toast({
        type: "error",
        title: "Cleanup failed",
        description: err?.message || "Failed to clean audit events",
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
          title="Audit Log"
          subtitle="View and analyze all security-sensitive actions and administrative changes"
          icon={<FileText className="h-5 w-5" />}
          actions={
            <div className="flex items-center justify-end">
              <div className="flex flex-nowrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                {isAdmin() && (
                  <div className="flex flex-nowrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1 shadow-inner">
                    <Input
                      type="number"
                      min={1}
                      value={cleanupDays}
                      onChange={(e) => setCleanupDays(Number(e.target.value))}
                      className="h-9 w-20 text-center border-slate-200 bg-slate-50 text-slate-900 font-semibold"
                      aria-label="Audit cleanup days"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCleanup}
                      disabled={cleaning}
                      className="h-9 whitespace-nowrap bg-white border-slate-200 text-slate-900 hover:bg-slate-50 shadow-sm"
                    >
                      <Filter className={cn("h-4 w-4 mr-2", cleaning && "animate-spin")} />
                      Clean {cleanupDays}+ days
                    </Button>
                  </div>
                )}
                <div className="flex flex-nowrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExport}
                    disabled={events.length === 0}
                    className="h-9 whitespace-nowrap bg-white border-slate-200 text-slate-900 hover:bg-slate-50 shadow-sm"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                </div>
              </div>
            </div>
          }
        />
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4 mb-6">
          <Card className="elite-card ">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-400">Total Events</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-100">{stats.total_events.toLocaleString()}</div>
              <p className="text-xs text-slate-500 mt-1">Last {stats.period_days} days</p>
            </CardContent>
          </Card>

          <Card className="elite-card ">
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

          <Card className="elite-card ">
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

          <Card className="elite-card ">
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

      {/* Filters */}
      <Card className="elite-card  mb-6">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
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
                  className="pl-9 h-9 bg-white border-slate-200 text-slate-900 placeholder:text-slate-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="action" className="text-xs text-slate-400">Action</Label>
              <Select value={actionFilter} onValueChange={(v: string) => { setActionFilter(v); setPage(0); }}>
                <SelectTrigger id="action" className="h-9 bg-white border-slate-200 text-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-slate-200 shadow-lg">
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
                <SelectTrigger id="resource" className="h-9 bg-white border-slate-200 text-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-slate-200 shadow-lg">
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
              <Select value={dateRange} onValueChange={(v: any) => { setDateRange(v); setPage(0); }}>
                <SelectTrigger id="dateRange" className="h-9 bg-white border-slate-200 text-slate-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-slate-200 shadow-lg">
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

      {/* Events Table */}
      <Card className="elite-card ">
        <CardHeader>
          <CardTitle className="text-base">Audit Events</CardTitle>
          <CardDescription className="text-slate-500">
            Showing {events.length} event{events.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
            </div>
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
              <div className="rounded-lg border border-slate-200 overflow-hidden">
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
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs font-medium",
                                ACTION_COLORS[event.action] || "bg-slate-500/20 text-slate-400 border-slate-500/30"
                              )}
                            >
                              <ActionIcon className="h-3 w-3 mr-1.5" />
                              {event.action.replace(/_/g, " ")}
                            </Badge>
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
                              <span className="text-sm text-slate-500">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-slate-400 text-sm max-w-md truncate">
                            {event.details || "—"}
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
                  Page {page + 1} • {events.length} events
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
