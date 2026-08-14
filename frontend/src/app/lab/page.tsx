"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  HardDrive,
  Monitor,
  PauseCircle,
  Play,
  PlayCircle,
  Search,
  ServerCog,
  Settings,
  Terminal,
  Trash2,
  Wifi,
  X,
} from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { RegisterAgentDialog } from "@/components/lab/register-agent-dialog";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PageSkeleton } from "@/components/ui/skeleton";
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
  is_stale?: boolean;
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
type OsFamily = "windows" | "linux" | "other";

type LabEndpoint = {
  id: number;
  hostname: string;
  os: string;
  osFamily: OsFamily;
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

// Small solid dot color for the reliability trend in the endpoint Sheet —
// same tone vocabulary as testTone/Chip, just rendered as a plain dot
// instead of a full pill so a run of them reads as a sparkline.
function toneDotColor(tone: NonNullable<ChipProps["tone"]>): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500";
    case "danger":
      return "bg-red-500";
    case "warning":
      return "bg-amber-500";
    case "info":
      return "bg-sky-500";
    default:
      return "bg-slate-400 dark:bg-slate-500";
  }
}

function mapOsFamily(os: string): OsFamily {
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
  if (value === "degraded" || value === "stale" || value === "stopping" || value === "pausing") {
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
  const [failingOnly, setFailingOnly] = useState(false);

  // Sheet inspector — selection is stored as an id (not the row object) so
  // it stays correct across refetches/local status updates instead of
  // holding a stale snapshot. `sheetMounted`/`sheetVisible` drive our own
  // open/close transition since Sheet's built-in animate-in/out classes are
  // dead code app-wide (no tailwindcss-animate plugin installed).
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(null);
  const [displayEndpoint, setDisplayEndpoint] = useState<LabEndpoint | null>(null);
  const [sheetMounted, setSheetMounted] = useState(false);
  const [sheetVisible, setSheetVisible] = useState(false);

  // Brief tone-tinted row background after a pause/resume succeeds.
  const [recentlyChanged, setRecentlyChanged] = useState<{
    id: number;
    tone: "success" | "warning";
  } | null>(null);

  const [autoOpenedTestId, setAutoOpenedTestId] = useState<number | null>(null);
  const [liveBannerDismissed, setLiveBannerDismissed] = useState(false);

  const [registerOpen, setRegisterOpen] = useState(false);
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
          const rawStatus = runner.status || (runner.last_check_in ? "online" : "unknown");
          // is_stale is computed server-side from last_check_in vs.
          // alert_offline_minutes — it can be true even while the stored
          // status still says "online" if the runner stopped heartbeating
          // without a clean pause/stop.
          const status = runner.is_stale ? "stale" : rawStatus;

          return {
            id: runner.id,
            hostname,
            os,
            osFamily: mapOsFamily(os),
            ipAddress: runner.ip_address || "--",
            status,
            statusBucket: runner.is_stale ? "degraded" : mapStatusBucket(rawStatus),
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

  const filteredEndpoints = useMemo(() => {
    const query = search.trim().toLowerCase();
    return endpoints.filter((endpoint) => {
      if (statusFilter !== "all" && endpoint.statusBucket !== statusFilter) return false;
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
  }, [endpoints, failingOnly, search, statusFilter]);

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

  const currentTestStatus = (currentTest?.status || "pending").toLowerCase();
  const currentTestProgress =
    currentTestStatus === "running" ? 62 : currentTestStatus === "pending" ? 24 : 100;
  const currentTestLive = currentTestStatus === "running" || currentTestStatus === "pending";

  // Reuse the same endpoint <-> test association the recent-runs cross
  // reference already relies on (hostname match first, environment as a
  // fallback) so the live-run panel and pulse indicator anchor to the same
  // row the "Recent validation" column would.
  const liveEndpointMatch = useMemo(() => {
    if (!currentTest) return null;
    return (
      endpoints.find((endpoint) => endpoint.hostname === currentTest.endpoint) ||
      endpoints.find((endpoint) => endpoint.environment === currentTest.environment) ||
      null
    );
  }, [currentTest, endpoints]);

  const selectedEndpoint = useMemo(() => {
    if (selectedEndpointId === null) return null;
    return endpoints.find((endpoint) => endpoint.id === selectedEndpointId) || null;
  }, [endpoints, selectedEndpointId]);

  // Keep rendering the last-known endpoint while the Sheet is fading out so
  // the panel doesn't go blank mid-transition (selectedEndpoint itself goes
  // null the instant the row/close action fires).
  useEffect(() => {
    if (selectedEndpoint) setDisplayEndpoint(selectedEndpoint);
  }, [selectedEndpoint]);

  // Hand-rolled open/close transition: `sheetMounted` keeps the Sheet's DOM
  // around long enough for the exit transition to play (Radix would
  // otherwise unmount instantly since there's no CSS *animation* — only a
  // transition — for it to wait on). `sheetVisible` is the actual
  // entered/exited flag the transform/opacity classes key off of.
  useEffect(() => {
    if (selectedEndpointId !== null) {
      setSheetMounted(true);
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setSheetVisible(true));
      });
      return () => {
        cancelAnimationFrame(raf1);
        cancelAnimationFrame(raf2);
      };
    }
    setSheetVisible(false);
    const timeout = setTimeout(() => setSheetMounted(false), 300);
    return () => clearTimeout(timeout);
  }, [selectedEndpointId]);

  // Auto-open the Sheet on the matching row the first time a given live run
  // is detected — guarded by autoOpenedTestId so it doesn't keep reopening
  // a Sheet the user deliberately closed on every 3s poll tick.
  useEffect(() => {
    if (!currentTest) return;
    if (autoOpenedTestId === currentTest.id) return;
    if (liveEndpointMatch) {
      setSelectedEndpointId(liveEndpointMatch.id);
      setAutoOpenedTestId(currentTest.id);
    }
  }, [currentTest, liveEndpointMatch, autoOpenedTestId]);

  useEffect(() => {
    setLiveBannerDismissed(false);
  }, [currentTest?.id]);

  function closeSheet() {
    setSelectedEndpointId(null);
  }

  async function handleDeleteEndpoint(endpointId: number) {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}`, {
        method: "DELETE",
      });
      setEndpoints((previous) =>
        previous.filter((endpoint) => endpoint.id !== endpointId),
      );
      setSelectedEndpointId((current) => (current === endpointId ? null : current));
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
      setRecentlyChanged({ id: endpointId, tone: "warning" });
      setTimeout(() => {
        setRecentlyChanged((previous) =>
          previous?.id === endpointId ? null : previous,
        );
      }, 1500);
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
      setRecentlyChanged({ id: endpointId, tone: "success" });
      setTimeout(() => {
        setRecentlyChanged((previous) =>
          previous?.id === endpointId ? null : previous,
        );
      }, 1500);
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

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setFailingOnly(false);
  }

  if (endpointsLoading && endpoints.length === 0) {
    return (
      <PageContainer maxWidth="full" className="space-y-6">
        <PageSkeleton variant="table" withActions rows={8} />
      </PageContainer>
    );
  }

  const isLiveMatch = Boolean(
    currentTest && liveEndpointMatch && displayEndpoint && liveEndpointMatch.id === displayEndpoint.id,
  );

  return (
    <PageContainer maxWidth="full" className="space-y-6">
      {/* Page header — title + primary actions only. No card. */}
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          Endpoints
        </h1>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setRegisterOpen(true)}>
            <ServerCog className="h-3.5 w-3.5" />
            Add runner
          </Button>
        </div>
      </header>

      {currentTest && !liveEndpointMatch && !liveBannerDismissed ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-500"
            />
            <span className="truncate text-[var(--foreground)]">
              Lab run #{currentTest.id} is live but isn&apos;t linked to a registered endpoint.
            </span>
            <Chip tone={testTone(currentTest.status)} size="sm">
              {currentTest.status || "pending"}
            </Chip>
          </div>
          <button
            type="button"
            onClick={() => setLiveBannerDismissed(true)}
            className="shrink-0 rounded-full p-1 text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Search + status tabs + triage toggle. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--surface-subtle-foreground)]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search host, IP, or profile…"
            className="w-full rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] py-2 pl-9 pr-3 text-sm text-[var(--foreground)] placeholder:text-[var(--surface-subtle-foreground)] shadow-sm focus:border-[var(--accent-line)] focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
            {STATUS_FILTERS.map((item) => {
              const active = statusFilter === item.key;
              const count = item.key === "all" ? endpoints.length : statusCounts[item.key];
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStatusFilter(item.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    active
                      ? "bg-[var(--surface-card)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]",
                  )}
                >
                  {item.label}
                  <span
                    className={cn(
                      "text-[10px]",
                      active ? "text-[var(--surface-subtle-foreground)]" : "text-slate-400 dark:text-slate-500",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setFailingOnly((value) => !value)}
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
          >
            <Chip
              tone={failingOnly ? "warning" : "muted"}
              appearance={failingOnly ? "subtle" : "outline"}
              className="cursor-pointer"
            >
              Needs triage
            </Chip>
          </button>
        </div>
      </div>

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

          {endpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <ServerCog className="h-8 w-8 text-[var(--surface-subtle-foreground)]" />
              <div>
                <p className="text-base font-semibold text-[var(--foreground)]">
                  No runners registered yet.
                </p>
                <p className="mt-1 max-w-lg text-sm text-[var(--surface-subtle-foreground)]">
                  A runner is an agent installed on a Windows or Linux endpoint that
                  executes atomic validation tests on PurveX&apos;s behalf. Register one
                  to start building your fleet.
                </p>
              </div>
              <Button size="sm" onClick={() => setRegisterOpen(true)}>
                <ServerCog className="h-3.5 w-3.5" />
                Add runner
              </Button>
            </div>
          ) : filteredEndpoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <HardDrive className="h-8 w-8 text-[var(--surface-subtle-foreground)]" />
              <div>
                <p className="text-base font-semibold text-[var(--foreground)]">
                  No runners match these filters.
                </p>
                <p className="mt-1 max-w-lg text-sm text-[var(--surface-subtle-foreground)]">
                  Clear filters to see the full fleet.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <div
              key={`${statusFilter}|${failingOnly}|${search}`}
              className={cn(
                "stagger-children divide-y divide-[var(--stroke-soft)] overflow-hidden rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] shadow-sm transition-opacity duration-200",
                refreshing && endpoints.length > 0 && "pointer-events-none opacity-60",
              )}
            >
              {filteredEndpoints.map((endpoint) => {
                const latestTest = endpoint.recentTests[0];
                const isSelected = selectedEndpointId === endpoint.id;
                const isLive =
                  currentTestLive &&
                  liveEndpointMatch !== null &&
                  liveEndpointMatch.id === endpoint.id;
                const tint = recentlyChanged?.id === endpoint.id ? recentlyChanged.tone : null;
                return (
                  <div
                    key={endpoint.id}
                    onClick={() => setSelectedEndpointId(endpoint.id)}
                    className={cn(
                      "group flex cursor-pointer flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 transition-colors hover:bg-[var(--surface-subtle)]",
                      isSelected && "bg-[var(--surface-subtle)]",
                      tint === "success" && "bg-emerald-500/10",
                      tint === "warning" && "bg-amber-500/10",
                    )}
                  >
                    <div className="min-w-[220px] flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
                        <span className="truncate font-medium text-[var(--foreground)]">
                          {endpoint.hostname}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="console-pill">{endpoint.environment}</span>
                        <span className="console-pill console-mono">
                          {endpoint.runnerType || "runner"}
                        </span>
                        {endpoint.username ? (
                          <span className="console-pill console-mono">{endpoint.username}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex w-28 shrink-0 items-center gap-2">
                      <Chip tone={endpointTone(endpoint.statusBucket)} dot>
                        {endpoint.status}
                      </Chip>
                      {isLive ? (
                        <span
                          aria-hidden
                          title="Live run in progress"
                          className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-500"
                        />
                      ) : null}
                    </div>

                    <div className="w-36 shrink-0 space-y-1 text-sm">
                      <div className="flex items-center gap-2 text-[var(--foreground)]">
                        {endpoint.osFamily === "windows" ? (
                          <Monitor className="h-4 w-4 shrink-0 text-sky-500" />
                        ) : (
                          <Terminal className="h-4 w-4 shrink-0 text-emerald-500" />
                        )}
                        <span>{endpoint.os}</span>
                      </div>
                      <p className="console-mono text-[11px] text-[var(--surface-subtle-foreground)]">
                        agent {endpoint.agentVersion}
                      </p>
                    </div>

                    <div className="flex w-40 shrink-0 items-center gap-2 text-sm text-[var(--foreground)]">
                      <Wifi className="h-4 w-4 shrink-0 text-[var(--accent-strong)]" />
                      <span className="console-mono text-[11px]">{endpoint.ipAddress}</span>
                    </div>

                    <div className="min-w-[160px] flex-1 text-sm">
                      {latestTest ? (
                        <div className="flex items-start gap-2">
                          <Chip tone={testTone(latestTest.status)} className="mt-0.5 shrink-0">
                            {latestTest.status || "--"}
                          </Chip>
                          <div className="min-w-0">
                            <p className="truncate text-[var(--foreground)]">
                              {latestTestLabel(latestTest)}
                            </p>
                            <p className="text-[11px] text-[var(--surface-subtle-foreground)]">
                              {formatRelativeTime(
                                latestTest.started_at ||
                                  latestTest.created_at ||
                                  latestTest.finished_at,
                              )}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-[var(--surface-subtle-foreground)]">
                          No runs captured
                        </p>
                      )}
                    </div>

                    <div
                      className="w-28 shrink-0 text-[11px] text-[var(--surface-subtle-foreground)]"
                      title={formatTimestamp(endpoint.lastCheckInAt)}
                    >
                      {formatRelativeTime(endpoint.lastCheckInAt)}
                    </div>

                    <div
                      className="flex shrink-0 items-center gap-2"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {endpoint.statusBucket === "paused" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setResumeEndpoint({ id: endpoint.id, name: endpoint.hostname })
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
                            setPauseEndpoint({ id: endpoint.id, name: endpoint.hostname })
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
                          setDeleteEndpoint({ id: endpoint.id, name: endpoint.hostname })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    </div>

                    <ChevronRight className="h-4 w-4 shrink-0 text-[var(--surface-subtle-foreground)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                  </div>
                );
              })}
            </div>
          )}
      </div>

      <Sheet
        open={sheetMounted}
        onOpenChange={(open) => {
          if (!open) closeSheet();
        }}
      >
        <SheetContent
          side="right"
          className={cn(
            "border-[var(--stroke-soft)] !bg-[var(--surface-card)] !text-[var(--foreground)]",
            "transition-transform transition-opacity duration-300 ease-out",
            sheetVisible ? "translate-x-0 opacity-100" : "translate-x-full opacity-0",
          )}
        >
          {displayEndpoint ? (
            <>
              <SheetHeader className="border-[var(--stroke-soft)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="console-pill">{displayEndpoint.environment}</span>
                  <span className="console-pill console-mono">
                    {displayEndpoint.runnerType || "runner"}
                  </span>
                  {displayEndpoint.username ? (
                    <span className="console-pill console-mono">
                      {displayEndpoint.username}
                    </span>
                  ) : null}
                </div>
                <SheetTitle className="flex items-center gap-2 text-[var(--foreground)]">
                  <HardDrive className="h-4 w-4 text-[var(--accent-strong)]" />
                  {displayEndpoint.hostname}
                </SheetTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--surface-subtle-foreground)]">
                  <Chip tone={endpointTone(displayEndpoint.statusBucket)} dot>
                    {displayEndpoint.status}
                  </Chip>
                  <span>Checked in {formatRelativeTime(displayEndpoint.lastCheckInAt)}</span>
                </div>
              </SheetHeader>

              <SheetBody>
                {isLiveMatch && currentTest ? (
                  <div className="mb-4 rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Activity className="h-4 w-4 text-emerald-500" />
                        <p className="console-label">Live run telemetry — #{currentTest.id}</p>
                      </div>
                      <Chip tone={testTone(currentTest.status)} dot>
                        {currentTest.status || "pending"}
                      </Chip>
                    </div>
                    <div className="mt-3 rounded-full bg-[var(--surface-subtle)] p-1">
                      <div
                        className="h-2 rounded-full bg-[var(--accent-strong)] transition-all duration-500"
                        style={{ width: `${currentTestProgress}%` }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
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
                      <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{testError}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
                  <p className="console-label">Reliability</p>
                  {displayEndpoint.recentTests.length === 0 ? (
                    <p className="mt-2 text-sm text-[var(--surface-subtle-foreground)]">
                      No recent validation runs to derive a trend from.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {displayEndpoint.recentTests
                        .slice()
                        .reverse()
                        .map((test) => (
                          <span
                            key={test.id}
                            title={`${latestTestLabel(test)} — ${test.status || "--"}`}
                            className={cn(
                              "h-2.5 w-2.5 rounded-full",
                              toneDotColor(testTone(test.status)),
                            )}
                          />
                        ))}
                      <span className="ml-2 text-[11px] text-[var(--surface-subtle-foreground)]">
                        last {displayEndpoint.recentTests.length} runs
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4">
                  <div className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-amber-500" />
                    <p className="console-label">Recent runs</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    {displayEndpoint.recentTests.length === 0 ? (
                      <p className="text-sm text-[var(--surface-subtle-foreground)]">
                        No recent validation runs for this endpoint.
                      </p>
                    ) : (
                      displayEndpoint.recentTests.map((test) => (
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
                                test.started_at || test.created_at || test.finished_at,
                              )}
                            </p>
                          </div>
                          <Chip tone={testTone(test.status)}>{test.status || "--"}</Chip>
                        </Link>
                      ))
                    )}
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
                  <div className="flex items-center gap-2">
                    <Settings className="h-4 w-4 text-sky-500" />
                    <p className="console-label">Diagnostics</p>
                  </div>
                  <div className="mt-3 space-y-2 text-sm">
                    <KeyValue label="Raw status" value={displayEndpoint.status} mono />
                    <KeyValue label="Bucket" value={displayEndpoint.statusBucket} mono />
                    <KeyValue
                      label="Port"
                      value={displayEndpoint.port ? String(displayEndpoint.port) : "--"}
                      mono
                    />
                  </div>
                </div>
              </SheetBody>

              <SheetFooter className="border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                {displayEndpoint.statusBucket === "paused" ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setResumeEndpoint({
                        id: displayEndpoint.id,
                        name: displayEndpoint.hostname,
                      })
                    }
                  >
                    <PlayCircle className="h-4 w-4" />
                    Resume
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setPauseEndpoint({
                        id: displayEndpoint.id,
                        name: displayEndpoint.hostname,
                      })
                    }
                  >
                    <PauseCircle className="h-4 w-4" />
                    Pause
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() =>
                    setDeleteEndpoint({
                      id: displayEndpoint.id,
                      name: displayEndpoint.hostname,
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

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

      <RegisterAgentDialog
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onRegistered={() => void fetchEndpoints()}
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
