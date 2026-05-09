"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Monitor,
  PauseCircle,
  Play,
  PlayCircle,
  RefreshCw,
  Search,
  ServerCog,
  Settings,
  Terminal,
  Trash2,
  Wifi,
} from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/loading-state";
import { useToast } from "@/components/ui/toast";
import { apiFetch, getTest, type TestDetailResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

type LabRunner = {
  id: number;
  hostname?: string | null;
  os?: string | null;
  ip_address?: string | null;
  status?: string | null;
  last_check_in?: string | null;
  agent_version?: string | null;
  environment_name?: string | null;
  runner_type?: string | null;
  port?: number | null;
  username?: string | null;
};

type LabTestSummary = {
  id: number;
  endpoint?: string | null;
  environment?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
  technique_id?: string | null;
  detection_title?: string | null;
  status?: string | null;
};

type EndpointBucket = "online" | "degraded" | "paused" | "unknown";
type StatusFilter = "all" | EndpointBucket;
type OsFilter = "all" | "windows" | "linux" | "other";

type LabEndpoint = {
  id: number;
  hostname: string;
  os: string;
  osFamily: OsFilter;
  ipAddress: string;
  status: string;
  statusBucket: EndpointBucket;
  lastCheckInAt: string | null;
  recentTests: LabTestSummary[];
  agentVersion: string;
  environment: string;
  runnerType?: string | null;
  port?: number | null;
  username?: string | null;
};

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All runners" },
  { key: "online", label: "Ready" },
  { key: "degraded", label: "Needs review" },
  { key: "paused", label: "Paused" },
  { key: "unknown", label: "Silent" },
];

const PLATFORM_FILTERS: Array<{ key: OsFilter; label: string }> = [
  { key: "all", label: "All surfaces" },
  { key: "windows", label: "Windows" },
  { key: "linux", label: "Linux" },
  { key: "other", label: "Other" },
];

function endpointTone(bucket: EndpointBucket): NonNullable<ChipProps["tone"]> {
  if (bucket === "online") return "success";
  if (bucket === "degraded") return "warning";
  if (bucket === "paused") return "muted";
  return "neutral";
}

function testTone(status?: string | null): NonNullable<ChipProps["tone"]> {
  const value = (status || "").toUpperCase();
  if (value === "PASS" || value === "COMPLETED") return "success";
  if (value === "FAIL" || value === "ERROR") return "danger";
  if (value === "INCONCLUSIVE") return "warning";
  if (value === "RUNNING" || value === "PENDING") return "info";
  return "muted";
}

function mapOsFamily(os: string): OsFilter {
  const value = os.toLowerCase();
  if (value.includes("windows")) return "windows";
  if (value.includes("linux") || value.includes("ubuntu") || value.includes("debian")) {
    return "linux";
  }
  return "other";
}

function mapStatusBucket(status?: string | null): EndpointBucket {
  const value = (status || "").toLowerCase();
  if (value === "online" || value === "idle" || value === "resuming") return "online";
  if (value === "degraded" || value === "stopping" || value === "pausing") {
    return "degraded";
  }
  if (value === "paused" || value === "stopped") return "paused";
  return "unknown";
}

function formatRelativeTime(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  const delta = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatTimestamp(value?: string | null): string {
  return value ? new Date(value).toLocaleString() : "--";
}

function latestTestLabel(test?: LabTestSummary): string {
  if (!test) return "No tests";
  return test.detection_title || test.technique_id || `Test #${test.id}`;
}

function LabPageContent() {
  const [currentTest, setCurrentTest] = useState<TestDetailResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<LabEndpoint[]>([]);
  const [endpointsLoading, setEndpointsLoading] = useState(false);
  const [endpointsError, setEndpointsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [environmentFilter, setEnvironmentFilter] = useState<string>("all");
  const [osFilter, setOsFilter] = useState<OsFilter>("all");
  const [failingOnly, setFailingOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const [deleteEndpoint, setDeleteEndpoint] = useState<{ id: number; name: string } | null>(null);
  const [pauseEndpoint, setPauseEndpoint] = useState<{ id: number; name: string } | null>(null);
  const [resumeEndpoint, setResumeEndpoint] = useState<{ id: number; name: string } | null>(null);

  const searchParams = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    const testIdParam = searchParams.get("testId");
    if (!testIdParam) return;

    let cancelled = false;

    async function pollTest() {
      try {
        setTestError(null);
        const id = Number(testIdParam);
        if (Number.isNaN(id)) return;

        let attempts = 0;
        while (!cancelled && attempts < 60) {
          const test = await getTest(id);
          if (!test) break;
          setCurrentTest(test);
          if (test.status !== "pending" && test.status !== "running") break;
          attempts += 1;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (error) {
        if (!cancelled) {
          setTestError(
            error instanceof Error ? error.message : "Failed to load lab run.",
          );
        }
      }
    }

    void pollTest();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  const fetchEndpoints = async () => {
    try {
      setEndpointsLoading(true);
      setEndpointsError(null);
      setRefreshing(true);

      const [runners, tests] = await Promise.all([
        apiFetch("/settings/environment-runners", { cache: "no-store" }),
        apiFetch("/tests/?limit=100", { cache: "no-store" }).catch(() => []),
      ]);

      const testsByEndpoint = new Map<string, LabTestSummary[]>();
      const testsByEnvironment = new Map<string, LabTestSummary[]>();

      if (Array.isArray(tests)) {
        tests.forEach((test: LabTestSummary) => {
          if (test.endpoint) {
            const existing = testsByEndpoint.get(test.endpoint) || [];
            existing.push(test);
            testsByEndpoint.set(test.endpoint, existing);
          }
          if (test.environment) {
            const existing = testsByEnvironment.get(test.environment) || [];
            existing.push(test);
            testsByEnvironment.set(test.environment, existing);
          }
        });
      }

      if (Array.isArray(runners)) {
        const nextEndpoints: LabEndpoint[] = runners.map((runner: LabRunner) => {
          const hostname = runner.hostname || `endpoint-${runner.id}`;
          const environment = runner.environment_name || "lab";
          const recentTests = (
            testsByEndpoint.get(hostname) || testsByEnvironment.get(environment) || []
          )
            .slice()
            .sort((left, right) => {
              const leftTime = new Date(
                left.started_at || left.created_at || left.finished_at || 0,
              ).getTime();
              const rightTime = new Date(
                right.started_at || right.created_at || right.finished_at || 0,
              ).getTime();
              return rightTime - leftTime;
            })
            .slice(0, 4);

          const os = runner.os || "Unknown";
          const status = runner.status || (runner.last_check_in ? "online" : "unknown");

          return {
            id: runner.id,
            hostname,
            os,
            osFamily: mapOsFamily(os),
            ipAddress: runner.ip_address || "--",
            status,
            statusBucket: mapStatusBucket(status),
            lastCheckInAt: runner.last_check_in || null,
            recentTests,
            agentVersion: runner.agent_version || "--",
            environment,
            runnerType: runner.runner_type,
            port: runner.port,
            username: runner.username,
          };
        });
        setEndpoints(nextEndpoints);
      } else {
        setEndpoints([]);
      }
    } catch (error) {
      setEndpointsError(
        error instanceof Error
          ? error.message
          : "Failed to load registered agents.",
      );
      setEndpoints([]);
    } finally {
      setEndpointsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchEndpoints();
  }, []);

  const environmentOptions = useMemo(() => {
    return ["all", ...new Set(endpoints.map((endpoint) => endpoint.environment))];
  }, [endpoints]);

  const filteredEndpoints = useMemo(() => {
    const query = search.trim().toLowerCase();
    return endpoints.filter((endpoint) => {
      if (statusFilter !== "all" && endpoint.statusBucket !== statusFilter) return false;
      if (environmentFilter !== "all" && endpoint.environment !== environmentFilter) {
        return false;
      }
      if (osFilter !== "all" && endpoint.osFamily !== osFilter) return false;
      if (
        failingOnly &&
        !endpoint.recentTests.some((test) => {
          const status = (test.status || "").toUpperCase();
          return status === "FAIL" || status === "ERROR" || status === "INCONCLUSIVE";
        })
      ) {
        return false;
      }
      if (!query) return true;
      return [
        endpoint.hostname,
        endpoint.environment,
        endpoint.os,
        endpoint.ipAddress,
        endpoint.username || "",
        endpoint.runnerType || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [endpoints, environmentFilter, failingOnly, osFilter, search, statusFilter]);

  const statusCounts = useMemo(() => {
    return endpoints.reduce<Record<EndpointBucket, number>>(
      (counts, endpoint) => {
        counts[endpoint.statusBucket] += 1;
        return counts;
      },
      { online: 0, degraded: 0, paused: 0, unknown: 0 },
    );
  }, [endpoints]);

  const recentFailureCount = useMemo(() => {
    return endpoints.filter((endpoint) =>
      endpoint.recentTests.some((test) => {
        const status = (test.status || "").toUpperCase();
        return status === "FAIL" || status === "ERROR" || status === "INCONCLUSIVE";
      }),
    ).length;
  }, [endpoints]);

  const latestCheckInCount = useMemo(() => {
    return endpoints.filter((endpoint) => {
      if (!endpoint.lastCheckInAt) return false;
      return Date.now() - new Date(endpoint.lastCheckInAt).getTime() <= 15 * 60 * 1000;
    }).length;
  }, [endpoints]);

  const attentionCount = statusCounts.degraded + statusCounts.unknown;

  const currentTestStatus = (currentTest?.status || "pending").toLowerCase();
  const currentTestProgress =
    currentTestStatus === "running" ? 62 : currentTestStatus === "pending" ? 24 : 100;

  async function handleDeleteEndpoint(endpointId: number) {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}`, {
        method: "DELETE",
      });
      setEndpoints((previous) =>
        previous.filter((endpoint) => endpoint.id !== endpointId),
      );
      toast({
        type: "success",
        title: "Endpoint removed",
        description: "The endpoint was removed from the operations console.",
      });
    } catch (error) {
      toast({
        type: "error",
        title: "Failed to delete agent",
        description:
          error instanceof Error ? error.message : "Unable to delete agent.",
      });
    }
  }

  async function handlePauseEndpoint(endpointId: number) {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}/pause`, {
        method: "POST",
      });
      setEndpoints((previous) =>
        previous.map((endpoint) =>
          endpoint.id === endpointId
            ? { ...endpoint, status: "pausing", statusBucket: "degraded" }
            : endpoint,
        ),
      );
      toast({
        type: "success",
        title: "Pause requested",
        description: "Agent pause command queued.",
      });
    } catch (error) {
      toast({
        type: "error",
        title: "Failed to pause agent",
        description:
          error instanceof Error
            ? error.message
            : "Unable to send pause command.",
      });
    }
  }

  async function handleResumeEndpoint(endpointId: number) {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}/resume`, {
        method: "POST",
      });
      setEndpoints((previous) =>
        previous.map((endpoint) =>
          endpoint.id === endpointId
            ? { ...endpoint, status: "resuming", statusBucket: "online" }
            : endpoint,
        ),
      );
      toast({
        type: "success",
        title: "Resume requested",
        description: "Agent resume command queued.",
      });
    } catch (error) {
      toast({
        type: "error",
        title: "Failed to resume agent",
        description:
          error instanceof Error
            ? error.message
            : "Unable to send resume command.",
      });
    }
  }

  // Build counts for the secondary filter rows. Computed inline so the
  // component stays simple — no preprocessing in useMemo since this is
  // already O(n) over endpoints and the row only renders when expanded.
  const environmentCounts: Record<string, number> = environmentOptions.reduce(
    (acc, env) => {
      acc[env] = env === "all"
        ? endpoints.length
        : endpoints.filter((e) => e.environment === env).length;
      return acc;
    },
    {} as Record<string, number>,
  );
  const osCounts: Record<string, number> = PLATFORM_FILTERS.reduce(
    (acc, item) => {
      acc[item.key] = item.key === "all"
        ? endpoints.length
        : endpoints.filter((e) => e.osFamily === item.key).length;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <PageContainer maxWidth="full" className="space-y-6">
      {/* Page header — title + primary actions only. No card. */}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          Endpoints
        </h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchEndpoints()}
            disabled={refreshing}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Sync board
          </Button>
          <Button asChild size="sm">
            <Link href="/settings/test-runner">
              <ServerCog className="h-3.5 w-3.5" />
              Add runner
            </Link>
          </Button>
        </div>
      </header>

      {/* Search — single hairline underline, no border box. */}
      <div className="relative border-b border-[var(--stroke-soft)] pb-2">
        <Search className="pointer-events-none absolute left-1 top-1 h-4 w-4 text-[var(--surface-subtle-foreground)]" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search host, lane, IP, runner profile, or operator…"
          className="w-full bg-transparent pl-7 text-sm text-[var(--foreground)] placeholder:text-[var(--surface-subtle-foreground)] focus:outline-none"
        />
      </div>

      {/* Primary filter row — text-led, underline on active. */}
      <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {STATUS_FILTERS.map((item) => {
          const active = statusFilter === item.key;
          const count = item.key === "all" ? endpoints.length : statusCounts[item.key];
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              className={cn(
                "inline-flex items-baseline gap-1.5 pb-1 transition-colors",
                active
                  ? "border-b-2 border-[var(--foreground)] font-semibold text-[var(--foreground)]"
                  : "border-b-2 border-transparent text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400",
              )}
            >
              <span>{item.label}</span>
              <span className={cn("text-xs", active ? "text-[var(--foreground)]" : "text-slate-400 dark:text-slate-500")}>
                {count}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Stat line + inline toggles + filters expander. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-x-3">
          <span>
            <span className="font-medium text-[var(--foreground)]">{filteredEndpoints.length}</span> in scope
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-medium text-[var(--foreground)]">{latestCheckInCount}</span> live heartbeat
          </span>
          <span aria-hidden>·</span>
          <span>
            <span className="font-medium text-[var(--foreground)]">{attentionCount}</span> needs eyes
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4">
          <button
            type="button"
            onClick={() => setFailingOnly((value) => !value)}
            className={cn(
              "transition-colors",
              failingOnly
                ? "font-semibold text-[var(--foreground)] underline underline-offset-4"
                : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400",
            )}
          >
            Needs triage
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen((value) => !value)}
            className="text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400"
          >
            {filtersOpen ? "− filters" : "+ filters"}
          </button>
        </div>
      </div>

      {/* Secondary filters — only on demand. Reads as a sentence. */}
      {filtersOpen ? (
        <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
          <SecondaryFilterRow
            label="Terrain"
            options={environmentOptions.map((env) => ({
              key: env,
              label: env === "all" ? "Any" : env,
            }))}
            active={environmentFilter}
            onChange={(value) => setEnvironmentFilter(value)}
            counts={environmentCounts}
          />
          <SecondaryFilterRow
            label="Footprint"
            options={PLATFORM_FILTERS.map((item) => ({ key: item.key, label: item.label }))}
            active={osFilter}
            onChange={(value) => setOsFilter(value as OsFilter)}
            counts={osCounts}
          />
        </div>
      ) : null}

      {/* Content — no outer card, just spacing. */}
      <div className="min-w-0">
          {endpointsError ? (
            <div className="mx-4 mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{endpointsError}</span>
              </div>
            </div>
          ) : null}

          {endpointsLoading && endpoints.length === 0 ? (
            <div className="py-14">
              <LoadingState message="Loading endpoint inventory..." size="sm" />
            </div>
          ) : filteredEndpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <HardDrive className="h-8 w-8 text-[var(--surface-subtle-foreground)]" />
              <div>
                <p className="text-base font-semibold text-[var(--foreground)]">
                  No runners match these filters.
                </p>
                <p className="mt-1 max-w-lg text-sm text-[var(--surface-subtle-foreground)]">
                  Clear filters or add a runner to see results.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="console-table text-sm">
                <thead>
                  <tr>
                    <th className="w-10" />
                    <th>Endpoint</th>
                    <th>State</th>
                    <th>Platform</th>
                    <th>Network</th>
                    <th>Recent validation</th>
                    <th>Check-in</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEndpoints.map((endpoint) => {
                    const expanded = expandedRows.has(endpoint.id);
                    const latestTest = endpoint.recentTests[0];
                    return (
                      <Fragment key={endpoint.id}>
                        <tr
                          className={cn(expanded && "bg-[var(--surface-subtle)]")}
                        >
                          <td>
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] text-[var(--surface-subtle-foreground)]"
                              onClick={() =>
                                setExpandedRows((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(endpoint.id)) next.delete(endpoint.id);
                                  else next.add(endpoint.id);
                                  return next;
                                })
                              }
                              aria-label={`${expanded ? "Collapse" : "Expand"} ${endpoint.hostname}`}
                            >
                              {expanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          <td>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-4 w-4 text-[var(--accent-strong)]" />
                                <span className="font-medium text-[var(--foreground)]">
                                  {endpoint.hostname}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--surface-subtle-foreground)]">
                                <span className="console-pill">{endpoint.environment}</span>
                                <span className="console-pill console-mono">
                                  {endpoint.runnerType || "runner"}
                                </span>
                                {endpoint.username ? (
                                  <span className="console-pill console-mono">
                                    {endpoint.username}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="space-y-2">
                              <Chip tone={endpointTone(endpoint.statusBucket)} dot>
                                {endpoint.status}
                              </Chip>
                              <p className="text-[11px] text-[var(--surface-subtle-foreground)]">
                                bucket: {endpoint.statusBucket}
                              </p>
                            </div>
                          </td>
                          <td>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-[var(--foreground)]">
                                {endpoint.osFamily === "windows" ? (
                                  <Monitor className="h-4 w-4 text-sky-500" />
                                ) : (
                                  <Terminal className="h-4 w-4 text-emerald-500" />
                                )}
                                <span>{endpoint.os}</span>
                              </div>
                              <p className="console-mono text-[11px] text-[var(--surface-subtle-foreground)]">
                                agent {endpoint.agentVersion}
                              </p>
                            </div>
                          </td>
                          <td>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 text-[var(--foreground)]">
                                <Wifi className="h-4 w-4 text-[var(--accent-strong)]" />
                                <span className="console-mono text-[11px]">
                                  {endpoint.ipAddress}
                                </span>
                              </div>
                              <p className="console-mono text-[11px] text-[var(--surface-subtle-foreground)]">
                                port {endpoint.port ?? "--"}
                              </p>
                            </div>
                          </td>
                          <td>
                            {latestTest ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Chip tone={testTone(latestTest.status)}>
                                    {latestTest.status || "--"}
                                  </Chip>
                                  <span className="truncate text-[var(--foreground)]">
                                    {latestTestLabel(latestTest)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-[var(--surface-subtle-foreground)]">
                                  {formatRelativeTime(
                                    latestTest.started_at ||
                                      latestTest.created_at ||
                                      latestTest.finished_at,
                                  )}
                                </p>
                              </div>
                            ) : (
                              <span className="text-[11px] text-[var(--surface-subtle-foreground)]">
                                No runs captured
                              </span>
                            )}
                          </td>
                          <td title={formatTimestamp(endpoint.lastCheckInAt)}>
                            <div className="space-y-1">
                              <p className="text-[var(--foreground)]">
                                {formatRelativeTime(endpoint.lastCheckInAt)}
                              </p>
                              <p className="text-[11px] text-[var(--surface-subtle-foreground)]">
                                {formatTimestamp(endpoint.lastCheckInAt)}
                              </p>
                            </div>
                          </td>
                          <td>
                            <div className="flex justify-end gap-2">
                              {endpoint.statusBucket === "paused" ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setResumeEndpoint({
                                      id: endpoint.id,
                                      name: endpoint.hostname,
                                    })
                                  }
                                >
                                  <PlayCircle className="h-3.5 w-3.5" />
                                  Resume
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setPauseEndpoint({
                                      id: endpoint.id,
                                      name: endpoint.hostname,
                                    })
                                  }
                                >
                                  <PauseCircle className="h-3.5 w-3.5" />
                                  Pause
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setDeleteEndpoint({
                                    id: endpoint.id,
                                    name: endpoint.hostname,
                                  })
                                }
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Remove
                              </Button>
                            </div>
                          </td>
                        </tr>

                        {expanded ? (
                          <tr>
                            <td colSpan={8} className="bg-[var(--surface-subtle)]">
                              <div className="grid gap-3 py-2 lg:grid-cols-3">
                                <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4">
                                  <div className="flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-emerald-500" />
                                    <p className="console-label">Runner telemetry</p>
                                  </div>
                                  <div className="mt-3 space-y-2 text-sm">
                                    <KeyValue
                                      label="Last check-in"
                                      value={formatTimestamp(endpoint.lastCheckInAt)}
                                    />
                                    <KeyValue label="Version" value={endpoint.agentVersion} mono />
                                    <KeyValue
                                      label="Environment"
                                      value={endpoint.environment}
                                      mono
                                    />
                                    <KeyValue
                                      label="Runner"
                                      value={endpoint.runnerType || "--"}
                                      mono
                                    />
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4">
                                  <div className="flex items-center gap-2">
                                    <Settings className="h-4 w-4 text-sky-500" />
                                    <p className="console-label">Control plane</p>
                                  </div>
                                  <div className="mt-3 space-y-2 text-sm">
                                    <KeyValue label="Hostname" value={endpoint.hostname} mono />
                                    <KeyValue label="IP" value={endpoint.ipAddress} mono />
                                    <KeyValue
                                      label="User"
                                      value={endpoint.username || "--"}
                                      mono
                                    />
                                    <KeyValue
                                      label="Port"
                                      value={endpoint.port ? String(endpoint.port) : "--"}
                                      mono
                                    />
                                  </div>
                                </div>

                                <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4">
                                  <div className="flex items-center gap-2">
                                    <Play className="h-4 w-4 text-amber-500" />
                                    <p className="console-label">Recent runs</p>
                                  </div>
                                  <div className="mt-3 space-y-2">
                                    {endpoint.recentTests.length === 0 ? (
                                      <p className="text-sm text-[var(--surface-subtle-foreground)]">
                                        No recent validation runs for this endpoint.
                                      </p>
                                    ) : (
                                      endpoint.recentTests.map((test) => (
                                        <Link
                                          key={test.id}
                                          href={`/tests/${test.id}`}
                                          className="flex items-start justify-between gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-2 hover:border-[var(--accent-line)]"
                                        >
                                          <div className="min-w-0">
                                            <p className="truncate text-sm font-medium text-[var(--foreground)]">
                                              {latestTestLabel(test)}
                                            </p>
                                            <p className="text-[11px] text-[var(--surface-subtle-foreground)]">
                                              {formatTimestamp(
                                                test.started_at ||
                                                  test.created_at ||
                                                  test.finished_at,
                                              )}
                                            </p>
                                          </div>
                                          <Chip tone={testTone(test.status)}>
                                            {test.status || "--"}
                                          </Chip>
                                        </Link>
                                      ))
                                    )}
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {currentTest ? (
        <section className="console-panel overflow-hidden">
          <div className="console-toolbar flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div>
              <p className="console-label">Active run telemetry</p>
              <h2 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                Lab run #{currentTest.id}
              </h2>
              <p className="mt-1 text-sm text-[var(--surface-subtle-foreground)]">
                Live status for the currently selected validation execution.
              </p>
            </div>
            <Chip tone={testTone(currentTest.status)} size="md" dot>
              {currentTest.status || "pending"}
            </Chip>
          </div>

          <div className="space-y-5 px-5 py-5">
            <div className="rounded-full bg-[var(--surface-subtle)] p-1">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-sky-500 via-emerald-500 to-sky-500 transition-all duration-500"
                style={{ width: `${currentTestProgress}%` }}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              <MetricTile label="Status" value={String(currentTest.status || "--")} />
              <MetricTile
                label="Environment"
                value={String(currentTest.environment || "lab")}
              />
              <MetricTile
                label="Result"
                value={String(currentTest.result || "Pending")}
              />
              <MetricTile
                label="Detection"
                value={String(
                  currentTest.detection?.title || currentTest.detection_title || "--",
                )}
              />
            </div>

            {testError ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{testError}</span>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteEndpoint)}
        title="Remove endpoint"
        description={`Remove ${deleteEndpoint?.name || "this endpoint"} from the lab inventory. This cannot be undone.`}
        confirmLabel="Remove endpoint"
        onCancel={() => setDeleteEndpoint(null)}
        onConfirm={() => {
          if (!deleteEndpoint) return;
          void handleDeleteEndpoint(deleteEndpoint.id);
          setDeleteEndpoint(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pauseEndpoint)}
        title="Pause endpoint"
        description={`Pause ${pauseEndpoint?.name || "this endpoint"} and stop new validation runs until it is resumed.`}
        confirmLabel="Pause agent"
        onCancel={() => setPauseEndpoint(null)}
        onConfirm={() => {
          if (!pauseEndpoint) return;
          void handlePauseEndpoint(pauseEndpoint.id);
          setPauseEndpoint(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(resumeEndpoint)}
        title="Resume endpoint"
        description={`Resume ${resumeEndpoint?.name || "this endpoint"} and allow validation runs again.`}
        confirmLabel="Resume agent"
        onCancel={() => setResumeEndpoint(null)}
        onConfirm={() => {
          if (!resumeEndpoint) return;
          void handleResumeEndpoint(resumeEndpoint.id);
          setResumeEndpoint(null);
        }}
      />
    </PageContainer>
  );
}

export default function LabPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--background)]" />}>
      <LabPageContent />
    </Suspense>
  );
}

/**
 * Secondary filter row — reads as a sentence: "Terrain: Any · lab · prod".
 * Active option is bold + underlined; inactive options are muted text.
 * Same component as the proposals page so the two redesigned pages
 * present a consistent vocabulary.
 */
function SecondaryFilterRow<T extends string>({
  label,
  options,
  active,
  onChange,
  counts,
}: {
  label: string;
  options: Array<{ key: T; label: string }>;
  active: T;
  onChange: (value: T) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
        {label}
      </span>
      {options.map((option, idx) => {
        const isActive = option.key === active;
        return (
          <span key={option.key} className="flex items-baseline gap-x-3">
            {idx > 0 ? <span aria-hidden className="text-slate-400 dark:text-slate-600">·</span> : null}
            <button
              type="button"
              onClick={() => onChange(option.key)}
              className={cn(
                "transition-colors",
                isActive
                  ? "font-semibold text-[var(--foreground)] underline underline-offset-4"
                  : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400",
              )}
            >
              {option.label}
              {option.key === "all" ? null : (
                <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">
                  {counts[option.key] ?? 0}
                </span>
              )}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function KeyValue({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--surface-subtle-foreground)]">
        {label}
      </span>
      <span className={cn("text-right text-[var(--foreground)]", mono && "console-mono text-[11px]")}>
        {value}
      </span>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
      <p className="console-label">{label}</p>
      <p className="mt-2 text-sm font-medium text-[var(--foreground)]">{value}</p>
    </div>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="w-[min(calc(100vw-2rem),26rem)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
