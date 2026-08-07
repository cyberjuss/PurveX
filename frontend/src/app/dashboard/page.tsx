"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { toneClasses, scoreToTone } from "@/lib/status-tone";
import Link from "next/link";
import {
  Detection,
  getTests,
  TestWithDetectionTitle,
  getDetections,
  getCoverageSummary,
  getSiemConnections,
  getEnvironmentRunners,
  CoverageSummary,
} from "@/lib/api";
import { formatRelative, format, subDays, startOfDay, eachDayOfInterval } from "date-fns";
import { 
  AlertCircle, Play, Shield, TrendingUp, CheckCircle2, Cpu, ScanLine, 
  ShieldCheck, Activity, AlertTriangle,
  Target, BarChart3, ArrowRight, Eye, Calendar, Grid3x3, Settings
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LifecycleProgress } from "@/components/lifecycle/LifecycleVisualizer";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonStatCard, SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import dynamic from "next/dynamic";

// Lazy-load chart bundles so the ~100KB recharts payload only ships when a
// user actually lands on /dashboard, not on every navigation that preloads
// layout-level code. ssr:false skips server rendering (charts need real DOM
// sizing to measure ResponsiveContainer).
const TestTrendChart = dynamic(
  () => import("@/components/charts/test-trend-chart"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[300px] items-center justify-center">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    ),
  },
);

const DetectionStatusPie = dynamic(
  () => import("@/components/charts/detection-status-pie"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[300px] items-center justify-center">
        <Skeleton className="h-[260px] w-[260px] rounded-full" />
      </div>
    ),
  },
);

const DASHBOARD_POLL_INTERVAL_MS = 30_000;
const DASHBOARD_ALL_TIME_TREND_DAYS = 90;
const DEFAULT_RERUN_ENV = "dev";

type DashboardSiemConnection = {
  status?: string | null;
};

type DashboardRunner = {
  status?: string | null;
  enabled?: boolean | null;
};

type DetectionReadinessKey = "ready" | "needs_tuning" | "telemetry_gap" | "needs_validation";

function detectionIsStale(detection: Detection) {
  if (!detection.last_tested_at) return false;
  const testedAt = new Date(detection.last_tested_at).getTime();
  if (!Number.isFinite(testedAt)) return false;
  return Date.now() - testedAt > 1000 * 60 * 60 * 24 * 21;
}

function getDetectionReadiness(detection: Detection): DetectionReadinessKey {
  const result = (detection.last_result || "").toUpperCase();
  const status = (detection.status || "").toUpperCase();
  if (result === "PASS" && !detectionIsStale(detection)) return "ready";
  if (result === "FAIL" || status === "NEEDS_IMPROVEMENT") return "needs_tuning";
  if (result === "INCONCLUSIVE") return "telemetry_gap";
  return "needs_validation";
}

function coveragePercentTone(percent: number): NonNullable<ChipProps["tone"]> {
  if (percent >= 75) return "success";
  if (percent >= 50) return "info";
  return "warning";
}

function coveragePercentLabel(percent: number): string {
  if (percent >= 75) return "Excellent";
  if (percent >= 50) return "Good";
  if (percent >= 25) return "Fair";
  return "Low coverage";
}

const READINESS_TONE: Record<DetectionReadinessKey, NonNullable<ChipProps["tone"]>> = {
  ready: "success",
  needs_tuning: "danger",
  telemetry_gap: "warning",
  needs_validation: "info",
};

function activityStatusTone(status?: string | null): NonNullable<ChipProps["tone"]> {
  const value = (status || "").toUpperCase();
  if (value === "FAIL") return "danger";
  if (value === "PASS") return "success";
  if (value === "INCONCLUSIVE") return "warning";
  return "muted";
}

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [timeFilter, setTimeFilter] = useState<"today" | "7days" | "30days" | "all">("today");

  // SWR-cached queries — navigation back to /dashboard renders from cache instantly
  // and revalidates in the background. Poll interval matches the previous 30s
  // behaviour but is paused automatically when the tab is hidden.
  const swrOptions = {
    refreshInterval: DASHBOARD_POLL_INTERVAL_MS,
    refreshWhenHidden: false,
  };
  const testsQ = useSWR<TestWithDetectionTitle[]>("dashboard:tests", getTests, swrOptions);
  const detectionsQ = useSWR<Detection[]>("dashboard:detections", getDetections, swrOptions);
  const coverageQ = useSWR<CoverageSummary>("dashboard:coverage", getCoverageSummary, swrOptions);
  const siemQ = useSWR("dashboard:siem", getSiemConnections, swrOptions);
  const runnersQ = useSWR("dashboard:runners", getEnvironmentRunners, swrOptions);

  const allTests = useMemo(() => testsQ.data ?? [], [testsQ.data]);
  const allDetections = useMemo(() => detectionsQ.data ?? [], [detectionsQ.data]);

  // First load of *any* query → show full skeleton. Subsequent navigations
  // return cached data immediately so `loading` stays false.
  const loading =
    (!testsQ.data && !testsQ.error) ||
    (!detectionsQ.data && !detectionsQ.error) ||
    (!coverageQ.data && !coverageQ.error) ||
    (!siemQ.data && !siemQ.error) ||
    (!runnersQ.data && !runnersQ.error);

  // Surface the first non-auth error. Auth failures are handled by the
  // session-enforcement effect in root-client.tsx, so we don't replicate
  // that logic here.
  const firstError =
    testsQ.error || detectionsQ.error || coverageQ.error || siemQ.error || runnersQ.error;
  const error = useMemo(() => {
    if (!firstError) return null;
    const msg = firstError instanceof Error ? firstError.message : String(firstError);
    const lower = msg.toLowerCase();
    if (lower.includes("not authenticated") || lower.includes("sign in again") || lower.includes("session has expired")) {
      return null;
    }
    return msg;
  }, [firstError]);

  const detectionsSummary = useMemo(() => {
    const total = allDetections.length;
    return {
      total,
      pass: allDetections.filter(d => d.last_result === "PASS").length,
      fail: allDetections.filter(d => d.last_result === "FAIL").length,
      inconclusive: allDetections.filter(d => d.last_result === "INCONCLUSIVE").length,
      untested: allDetections.filter(d => !d.last_result).length,
    };
  }, [allDetections]);

  const readinessSummary = useMemo(() => {
    const total = allDetections.length;
    const counts: Record<DetectionReadinessKey, number> = {
      ready: 0,
      needs_tuning: 0,
      telemetry_gap: 0,
      needs_validation: 0,
    };
    for (const detection of allDetections) {
      counts[getDetectionReadiness(detection)] += 1;
    }
    return {
      total,
      ...counts,
      progress: Math.round((counts.ready / (total || 1)) * 100),
    };
  }, [allDetections]);

  // MITRE coverage now comes from /mitre/coverage/summary (tiny payload)
  // instead of /mitre/techniques (691 rows). Server already computed the
  // counts so the dashboard does zero heavy work here.
  const mitreStats = useMemo(() => {
    const totals = coverageQ.data?.totals;
    const total = totals?.total_techniques ?? 0;
    const covered = totals?.mapped ?? 0;
    const rawPercent = coverageQ.data?.simple_coverage_percent ?? 0;
    const coveragePercent =
      covered > 0 && rawPercent > 0 && rawPercent < 1
        ? Math.round(rawPercent * 100) / 100
        : Math.round(rawPercent);
    return { total, covered, coveragePercent, rawPercent };
  }, [coverageQ.data]);

  const systemHealth = useMemo(() => {
    const siem = siemQ.data ?? [];
    const runners = runnersQ.data ?? [];
    return {
      siemConnected: siem.filter((s: DashboardSiemConnection) => s.status === "connected" || s.status === "active").length,
      siemTotal: siem.length,
      runnersActive: runners.filter((r: DashboardRunner) => r.status === "active" || r.enabled === true).length,
      runnersTotal: runners.length,
    };
  }, [siemQ.data, runnersQ.data]);

  const handleRefresh = useCallback(async () => {
    try {
      await Promise.all([
        testsQ.mutate(),
        detectionsQ.mutate(),
        coverageQ.mutate(),
        siemQ.mutate(),
        runnersQ.mutate(),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Refresh failed.";
      toast({
        type: "error",
        title: "Refresh failed",
        description: msg,
      });
    }
  }, [testsQ, detectionsQ, coverageQ, siemQ, runnersQ, toast]);

  // Filter tests based on time period
  const getFilteredTests = () => {
    const now = new Date();
    let cutoffDate: Date;

    switch (timeFilter) {
      case "today":
        cutoffDate = startOfDay(now);
        break;
      case "7days":
        cutoffDate = subDays(now, 7);
        break;
      case "30days":
        cutoffDate = subDays(now, 30);
        break;
      case "all":
      default:
        return allTests;
    }

    return allTests.filter(test => {
      const testDate = new Date(test.started_at);
      return testDate.getTime() >= cutoffDate.getTime();
    });
  };

  const filteredTests = getFilteredTests();
  const recentTests = filteredTests.slice(0, 10);

  const firstFailure = recentTests.find(test => test.result === "FAIL");
  const needsAttention = Boolean(firstFailure);
  const firstTelemetryGapDetection = allDetections.find((d) => (d.last_result || "").toUpperCase() === "INCONCLUSIVE");
  const criticalUntestedDetections = allDetections.filter((d) => {
    const criticality = (d.criticality || "").toUpperCase();
    return !d.last_result && (criticality === "HIGH" || criticality === "CRITICAL");
  });
  const activities = recentTests.slice(0, 5).map(test => ({
    id: test.id,
    status: test.result || test.status,
    title: test.detection_title || test.technique_id || `Test #${test.id}`,
    subtitle: `${test.technique_id || "Technique unavailable"} - ${(test.environment || "UNKNOWN").toUpperCase()}`,
    time: formatRelative(new Date(test.started_at), new Date()),
  }));

  // Prepare chart data for test trends over time
  const prepareTestTrendData = () => {
    const days = timeFilter === "today" ? 1 : timeFilter === "7days" ? 7 : timeFilter === "30days" ? 30 : DASHBOARD_ALL_TIME_TREND_DAYS;
    const startDate = subDays(new Date(), days);
    const dates = eachDayOfInterval({ start: startDate, end: new Date() });
    
    const dataByDate: Record<string, { pass: number; fail: number; inconclusive: number }> = {};
    dates.forEach(date => {
      const key = format(date, "yyyy-MM-dd");
      dataByDate[key] = { pass: 0, fail: 0, inconclusive: 0 };
    });

    filteredTests.forEach(test => {
      const testDate = format(new Date(test.started_at), "yyyy-MM-dd");
      if (dataByDate[testDate]) {
        const result = (test.result || test.status || "").toUpperCase();
        if (result === "PASS") dataByDate[testDate].pass++;
        else if (result === "FAIL") dataByDate[testDate].fail++;
        else if (result === "INCONCLUSIVE") dataByDate[testDate].inconclusive++;
      }
    });

    return dates.map(date => ({
      date: format(date, "MMM dd"),
      fullDate: format(date, "yyyy-MM-dd"),
      Pass: dataByDate[format(date, "yyyy-MM-dd")]?.pass || 0,
      Fail: dataByDate[format(date, "yyyy-MM-dd")]?.fail || 0,
      Inconclusive: dataByDate[format(date, "yyyy-MM-dd")]?.inconclusive || 0,
    }));
  };

  const testTrendData = prepareTestTrendData();

  // Prepare pie chart data for detection status
  const detectionStatusData = [
    { name: "Passed", value: detectionsSummary.pass, color: "var(--pvrx-success)" },
    { name: "Failed", value: detectionsSummary.fail, color: "var(--pvrx-danger)" },
    { name: "Blind Spot", value: detectionsSummary.inconclusive, color: "var(--pvrx-warning)" },
    { name: "Untested", value: detectionsSummary.untested, color: "var(--surface-subtle-foreground)" },
  ].filter(item => item.value > 0);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        router.push("/detections");
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        e.preventDefault();
        handleRefresh();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "t") {
        e.preventDefault();
        router.push("/run-test");
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [handleRefresh, router]);

  if (loading) {
    return (
      <PageContainer maxWidth="full" className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="mb-2 h-7 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
          <SkeletonStatCard />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState 
          title="Error loading dashboard"
          message={error}
          onRetry={() => void handleRefresh()}
        />
      </PageContainer>
    );
  }

  return (
      <PageContainer maxWidth="full" className="space-y-3">
            <PageHeader
              eyebrow="Validation workspace"
              title="Dashboard"
              subtitle="See which detections are trustworthy, which telemetry paths are broken, and what the team needs to fix next."
            />

          {/* System Health & MITRE Coverage Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* MITRE ATT&CK Coverage - Enhanced */}
            <Card>
              <CardHeader className="border-b border-[var(--stroke-soft)] pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--accent-line)] bg-[var(--surface-subtle)] shadow-sm">
                    <Target className="h-6 w-6 text-[var(--accent-strong)]" />
                  </div>
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl font-display font-bold text-[var(--surface-card-foreground)]">
                      MITRE ATT&CK Coverage
                    </CardTitle>
                    <CardDescription className="mt-1.5 font-body text-sm text-[var(--surface-subtle-foreground)]">
                      Comprehensive technique coverage analysis
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-4">
                  {/* Main Coverage Metrics */}
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1.5 flex-1">
                        <div className="flex items-baseline gap-2">
                          <p className="text-4xl font-display font-bold text-[var(--surface-card-foreground)]">
                            {mitreStats.coveragePercent < 1 && mitreStats.coveragePercent > 0
                              ? `${mitreStats.coveragePercent.toFixed(2)}%`
                              : `${mitreStats.coveragePercent}%`}
                          </p>
                          <Chip tone={coveragePercentTone(mitreStats.coveragePercent)}>
                            {coveragePercentLabel(mitreStats.coveragePercent)}
                          </Chip>
                        </div>
                        <p className="text-sm font-medium text-[var(--surface-subtle-foreground)]">Overall Coverage</p>
                      </div>
                      <div 
                        className="h-32 w-32 rounded-full flex items-center justify-center relative group cursor-help"
                        title="Coverage = covered techniques / total techniques"
                      >
                        <svg className="absolute inset-0 transform -rotate-90" width="128" height="128" viewBox="0 0 128 128">
                          {/* Background circle */}
                          <circle
                            cx="64"
                            cy="64"
                            r="58"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="5"
                            className="text-[var(--stroke-soft)]"
                          />
                          {/* Progress circle - using rawPercent for accurate visual representation */}
                          <circle
                            cx="64"
                            cy="64"
                            r="58"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="5"
                            strokeDasharray={`${2 * Math.PI * 58}`}
                            strokeDashoffset={`${2 * Math.PI * 58 * (1 - (mitreStats.rawPercent / 100))}`}
                            className="text-[var(--accent-strong)]"
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="text-center z-10">
                          <p className="text-2xl font-bold leading-tight text-[var(--surface-card-foreground)]">{mitreStats.covered}</p>
                          <p className="text-xs leading-tight text-[var(--surface-subtle-foreground)]">/ {mitreStats.total}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Detailed Stats Grid */}
                  <div className="grid grid-cols-2 gap-3 border-t border-[var(--stroke-soft)] pt-3">
                    <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 shadow-sm transition-colors hover:border-[var(--accent-line)]">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Covered</p>
                        <CheckCircle2 className={cn("h-3.5 w-3.5", toneClasses("success").icon)} />
                      </div>
                      <p className={cn("text-3xl font-display font-bold mb-0.5 leading-tight", toneClasses("success").text)}>{mitreStats.covered}</p>
                      <p className="text-xs font-medium text-[var(--surface-subtle-foreground)]">techniques covered</p>
                    </div>
                    <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 shadow-sm transition-colors hover:border-[var(--accent-line)]">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-medium uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Remaining</p>
                        <Target className={cn("h-3.5 w-3.5", toneClasses("warning").icon)} />
                      </div>
                      <p className={cn("text-3xl font-display font-bold mb-0.5 leading-tight", toneClasses("warning").text)}>{Math.max(0, mitreStats.total - mitreStats.covered)}</p>
                      <p className="text-xs font-medium text-[var(--surface-subtle-foreground)]">techniques remaining</p>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-8 border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-xs text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)]"
                      onClick={() => router.push("/mitre")}
                    >
                      <Grid3x3 className="h-3 w-3 mr-1.5" />
                      View Matrix
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* System Health - Enhanced */}
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-[var(--stroke-soft)] pb-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] shadow-sm">
                        <ShieldCheck className={cn("h-6 w-6", toneClasses("success").icon)} />
                      </div>
                      {systemHealth.siemConnected > 0 && systemHealth.runnersActive > 0 && (
                        <div className={cn("absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-[var(--surface-card)] animate-pulse", toneClasses("success").bg)} />
                      )}
                    </div>
                    <div>
                      <CardTitle className="flex items-center gap-2 text-xl font-display font-bold text-[var(--surface-card-foreground)]">
                        System Health
                      </CardTitle>
                      <CardDescription className="mt-1.5 font-body text-sm text-[var(--surface-subtle-foreground)]">
                        Integration and test runner status
                      </CardDescription>
                    </div>
                  </div>
                  {(() => {
                    const siemFullyConfigured = systemHealth.siemTotal > 0 && systemHealth.siemConnected === systemHealth.siemTotal;
                    const runnersFullyConfigured = systemHealth.runnersTotal > 0 && systemHealth.runnersActive === systemHealth.runnersTotal;
                    const allHealthy = siemFullyConfigured && runnersFullyConfigured;
                    
                    return allHealthy ? (
                      <Chip tone="success">
                        <CheckCircle2 className="h-3 w-3" />
                        All systems healthy
                      </Chip>
                    ) : (
                      <Chip tone="warning">
                        <AlertTriangle className="h-3 w-3" />
                        Action required
                      </Chip>
                    );
                  })()}
                </div>
              </CardHeader>
              <CardContent className="pt-1">
                <div className="space-y-4">
                  {/* SIEM Connections - Enhanced */}
                  {(() => {
                    const siemFullyConfigured = systemHealth.siemTotal > 0 && systemHealth.siemConnected === systemHealth.siemTotal;
                    return (
                      <div 
                        className={cn(
                          "group relative overflow-hidden rounded-xl border transition-all duration-300 shadow-md bg-[var(--surface-elevated)]",
                          systemHealth.siemConnected > 0
                            ? "border-[var(--accent-line)]"
                            : "border-[var(--stroke-soft)]"
                        )}
                      >
                        <div className="relative p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-4 flex-1 min-w-0">
                              {/* Enhanced Icon */}
                              <div className={cn(
                                "relative h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-300 flex-shrink-0",
                                systemHealth.siemConnected > 0
                                  ? "bg-[var(--surface-subtle)] border border-[var(--accent-line)] shadow-sm"
                                  : "bg-[var(--surface-subtle)] border border-[var(--stroke-soft)]"
                              )}>
                                <Shield className={cn(
                                  "h-6 w-6 transition-all duration-300",
                                  systemHealth.siemConnected > 0
                                    ? toneClasses("success").icon
                                    : toneClasses("muted").icon
                                )} />
                                {systemHealth.siemConnected > 0 && (
                                  <div className={cn("absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-[var(--surface-card)] animate-pulse", toneClasses("success").bg)} />
                                )}
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-base font-display font-bold text-[var(--surface-card-foreground)]">SIEM Connections</h3>
                                  {systemHealth.siemConnected > 0 && (
                                    <CheckCircle2 className={cn("h-4 w-4 flex-shrink-0", toneClasses("success").icon)} />
                                  )}
                                </div>
                                
                                {/* Status */}
                                <div>
                                  <p className="text-sm font-semibold text-[var(--surface-card-foreground)]">
                                    {systemHealth.siemConnected} of {systemHealth.siemTotal} connected
                                  </p>
                                </div>
                                
                                {/* Empty State Guidance */}
                                {systemHealth.siemConnected === 0 && (
                                  <p className="text-xs leading-relaxed text-[var(--surface-subtle-foreground)]">
                                    Connect your SIEM to enable detection validation and automated testing workflows.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          {!siemFullyConfigured && (
                            <div className="mt-3 border-t border-[var(--stroke-soft)] pt-3">
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full h-8 border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-xs text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)]"
                                onClick={() => router.push("/settings/siem")}
                              >
                                <Settings className="h-3 w-3 mr-1.5" />
                                Configure SIEM
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Test Runners - Enhanced */}
                  {(() => {
                    const runnersFullyConfigured = systemHealth.runnersTotal > 0 && systemHealth.runnersActive === systemHealth.runnersTotal;
                    return (
                      <div 
                        className={cn(
                          "group relative overflow-hidden rounded-xl border transition-all duration-300 shadow-md bg-[var(--surface-elevated)]",
                          systemHealth.runnersActive > 0
                            ? "border-[var(--accent-line)]"
                            : "border-[var(--stroke-soft)]"
                        )}
                      >
                        <div className="relative p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-4 flex-1 min-w-0">
                              {/* Enhanced Icon */}
                              <div className={cn(
                                "relative h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-300 flex-shrink-0",
                                systemHealth.runnersActive > 0
                                  ? "bg-[var(--surface-subtle)] border border-[var(--accent-line)] shadow-sm"
                                  : "bg-[var(--surface-subtle)] border border-[var(--stroke-soft)]"
                              )}>
                                <Cpu className={cn(
                                  "h-6 w-6 transition-all duration-300",
                                  systemHealth.runnersActive > 0
                                    ? toneClasses("success").icon
                                    : toneClasses("muted").icon
                                )} />
                                {systemHealth.runnersActive > 0 && (
                                  <div className={cn("absolute -top-1 -right-1 h-3 w-3 rounded-full border-2 border-[var(--surface-card)] animate-pulse", toneClasses("success").bg)} />
                                )}
                              </div>

                              {/* Content */}
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-base font-display font-bold text-[var(--surface-card-foreground)]">Agents</h3>
                                  {systemHealth.runnersActive > 0 && (
                                    <CheckCircle2 className={cn("h-4 w-4 flex-shrink-0", toneClasses("success").icon)} />
                                  )}
                                </div>

                                {/* Status */}
                                <div>
                                  <p className="text-sm font-semibold text-[var(--surface-card-foreground)]">
                                    {systemHealth.runnersTotal === 0
                                      ? "No agents connected"
                                      : runnersFullyConfigured
                                        ? `${systemHealth.runnersActive} of ${systemHealth.runnersTotal} completed`
                                        : `${systemHealth.runnersActive} of ${systemHealth.runnersTotal} active`}
                                  </p>
                                </div>
                                
                                {/* Empty State Guidance */}
                                {systemHealth.runnersActive === 0 && (
                                  <p className="text-xs leading-relaxed text-[var(--surface-subtle-foreground)]">
                                    Set up an agent to execute atomic tests and validate detection coverage.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          {!runnersFullyConfigured && (
                            <div className="mt-3 border-t border-[var(--stroke-soft)] pt-3">
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full h-8 border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-xs text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)]"
                                onClick={() => router.push("/lab")}
                              >
                                <Cpu className="h-3 w-3 mr-1.5" />
                                Setup Agent
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              </CardContent>
            </Card>
          </div>

          {/* Start Here */}
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-lg font-display font-semibold text-[var(--surface-card-foreground)]">
                  Start here
                </CardTitle>
                <CardDescription className="text-sm text-[var(--surface-subtle-foreground)]">
                  Start from trust, coverage, or validation. PurveX should route work, not act like a passive dashboard.
                </CardDescription>
              </div>
                <Chip tone="muted" appearance="outline">
                  4-step flow
                </Chip>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => router.push("/run-test?focus=validation&step=2")}
                className="group rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-left transition hover:border-[var(--accent-line)] hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)]">
                    <ShieldCheck className="h-5 w-5 text-[var(--surface-card-foreground)]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--surface-card-foreground)]">Validate a detection</p>
                    <p className="text-xs text-[var(--surface-subtle-foreground)]">Pick a rule and confirm it fires.</p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => router.push("/mitre?focus=uncovered")}
                className="group rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-left transition hover:border-[var(--accent-line)] hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)]">
                    <Target className="h-5 w-5 text-[var(--surface-card-foreground)]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--surface-card-foreground)]">Show coverage gaps</p>
                    <p className="text-xs text-[var(--surface-subtle-foreground)]">See what is unmapped or still unproven.</p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() =>
                  firstTelemetryGapDetection
                    ? router.push(`/run-test?detectionId=${firstTelemetryGapDetection.id}&environment=${DEFAULT_RERUN_ENV}&focus=telemetry&step=2`)
                    : router.push("/run-test?focus=telemetry&step=2")
                }
                className="group rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-left transition hover:border-[var(--accent-line)] hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)]">
                    <ScanLine className="h-5 w-5 text-[var(--surface-card-foreground)]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--surface-card-foreground)]">Investigate missing logs</p>
                    <p className="text-xs text-[var(--surface-subtle-foreground)]">Jump straight into a telemetry-first rerun.</p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => router.push(`/detections?view=queue&search=untested`)}
                className="group rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-left transition hover:border-[var(--accent-line)] hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)]">
                    <AlertCircle className="h-5 w-5 text-[var(--surface-card-foreground)]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--surface-card-foreground)]">Show untested critical detections</p>
                    <p className="text-xs text-[var(--surface-subtle-foreground)]">{criticalUntestedDetections.length} high-risk detections still need proof.</p>
                  </div>
                </div>
              </button>
            </CardContent>
          </Card>

          {/* Alert Banner */}
          {needsAttention && firstFailure && (
            <div className={cn("relative p-6 rounded-lg border", `${toneClasses("danger").bg}/10`, toneClasses("danger").border)}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={cn("h-12 w-12 rounded-lg flex items-center justify-center", `${toneClasses("danger").bg}/20`)}>
                    <AlertTriangle className={cn("h-6 w-6", toneClasses("danger").icon)} />
                  </div>
                  <div>
                    <p className={cn("font-display font-bold text-lg", toneClasses("danger").text)}>Action Required: Test #{firstFailure.id} Failed</p>
                    <p className="text-sm font-body text-[var(--surface-subtle-foreground)] mt-1">
                      {(firstFailure.detection_title || firstFailure.technique_id || `Test #${firstFailure.id}`)} - {(firstFailure.environment || "UNKNOWN").toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button 
                    variant="outline" 
                    asChild
                  >
                    <Link href={`/tests/${firstFailure.id}`} aria-label={`View details for test ${firstFailure.id}`}>
                      <Eye className="h-4 w-4 mr-2" aria-hidden="true" />
                      View Details
                    </Link>
                  </Button>
                  <Button 
                    onClick={() => router.push(`/run-test?detectionId=${firstFailure.detection_id || ""}&technique_id=${firstFailure.technique_id || ""}&environment=${firstFailure.environment || DEFAULT_RERUN_ENV}`)}
                    aria-label="Rerun the failed test"
                  >
                    <Play className="h-4 w-4 mr-2" aria-hidden="true" />
                    Rerun Test
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Validation posture and activity */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Validation trend */}
            <Card>
              <CardHeader className="border-b border-[var(--stroke-soft)] pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl font-display font-bold text-[var(--surface-card-foreground)]">
                      <TrendingUp className="h-5 w-5 text-[var(--accent-strong)]" />
                      Validation Trend
                    </CardTitle>
                    <CardDescription className="mt-1.5 font-body text-sm text-[var(--surface-subtle-foreground)]">
                      Validation outcomes over time
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select 
                      value={timeFilter} 
                      onValueChange={(value: "today" | "7days" | "30days" | "all") => setTimeFilter(value)}
                    >
                      <SelectTrigger 
                        className="h-8 w-[140px] border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-xs text-[var(--interactive-foreground)] focus:ring-2 focus:ring-[var(--accent-line)]/30 transition-all"
                        aria-label="Select time filter for chart data"
                      >
                        <Calendar className="mr-1.5 h-3.5 w-3.5 text-[var(--surface-subtle-foreground)]" aria-hidden="true" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-[var(--stroke-soft)] bg-[var(--surface-card)] text-[var(--surface-card-foreground)] shadow-lg">
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="7days">Last 7 days</SelectItem>
                        <SelectItem value="30days">Last 30 days</SelectItem>
                        <SelectItem value="all">All time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {testTrendData.length > 0 ? (
                  <TestTrendChart data={testTrendData} />
                ) : (
                  <div className="flex h-[300px] flex-col items-center justify-center text-[var(--surface-subtle-foreground)]">
                    <TrendingUp className="h-12 w-12 mb-3 opacity-30" />
                    <p className="text-sm mb-1">No validation activity yet</p>
                    <p className="mb-4 text-xs text-[var(--surface-subtle-foreground)]">for the selected period</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => router.push("/run-test")} 
                      className="border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)]"
                    >
                      <Play className="h-3.5 w-3.5 mr-2" />
                      Run validation
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Detection trust state */}
            <Card>
              <CardHeader className="border-b border-[var(--stroke-soft)] pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl font-display font-bold text-[var(--surface-card-foreground)]">
                      <BarChart3 className="h-5 w-5 text-[var(--accent-strong)]" />
                      Trust State
                    </CardTitle>
                    <CardDescription className="mt-1.5 font-body text-sm text-[var(--surface-subtle-foreground)]">
                      Distribution of trusted, blocked, and untested detections
                    </CardDescription>
                  </div>
                  <Button 
                    size="sm"
                    variant="outline" 
                    className="h-8 border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-xs text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)]"
                    onClick={() => router.push("/detections?view=library")}
                    aria-label="Open detections workspace"
                  >
                    <Eye className="h-3 w-3 mr-1.5" aria-hidden="true" />
                    Open Detections
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {detectionStatusData.length > 0 ? (
                  <div className="flex items-center justify-center">
                    <DetectionStatusPie data={detectionStatusData} />
                  </div>
                ) : (
                  <div className="flex h-[300px] flex-col items-center justify-center text-[var(--surface-subtle-foreground)]">
                    <BarChart3 className="h-12 w-12 mb-3 opacity-30" />
                    <p className="text-sm mb-1">No detections available</p>
                    <p className="mb-4 text-xs text-[var(--surface-subtle-foreground)]">Add detections and run validation to establish trust.</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => router.push("/detections?view=library")} 
                      className="h-8 border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-xs text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)]"
                    >
                      <Eye className="h-3 w-3 mr-1.5" />
                      Open Detections
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Main Content Grid - Enhanced Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Detection readiness */}
            <Card className="lg:col-span-3">
              <CardHeader className="border-b border-[var(--stroke-soft)] pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-xl font-display font-bold text-[var(--surface-card-foreground)]">
                      <Target className="h-5 w-5 text-[var(--accent-strong)]" />
                      Detection Readiness
                    </CardTitle>
                    <CardDescription className="mt-1.5 font-body text-sm text-[var(--surface-subtle-foreground)]">
                      Where detections stand before they can be trusted in steady-state operations
                    </CardDescription>
                  </div>
                  <Chip tone={scoreToTone(readinessSummary.progress)} size="md">
                    {readinessSummary.progress}% ready
                  </Chip>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4 mb-6">
                  {(
                    [
                      { key: "ready", label: "Ready", stat: readinessSummary.ready, icon: ShieldCheck },
                      { key: "needs_tuning", label: "Needs tuning", stat: readinessSummary.needs_tuning, icon: AlertTriangle },
                      { key: "telemetry_gap", label: "Blind Spot", stat: readinessSummary.telemetry_gap, icon: Activity },
                      { key: "needs_validation", label: "Needs validation", stat: readinessSummary.needs_validation, icon: Target },
                    ] as Array<{ key: DetectionReadinessKey; label: string; stat: number; icon: typeof ShieldCheck }>
                  ).map(entry => {
                    const Icon = entry.icon;
                    const tone = READINESS_TONE[entry.key];
                    return (
                      <div key={entry.key} className="flex items-center justify-between rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 shadow-sm">
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "inline-flex h-8 w-8 items-center justify-center rounded-full border",
                              toneClasses(tone).border,
                              `${toneClasses(tone).bg}/15`,
                              toneClasses(tone).text,
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="text-sm font-body text-[var(--surface-card-foreground)]">{entry.label}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-lg font-display font-bold text-[var(--surface-card-foreground)]">{entry.stat}</span>
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                            <div
                              className={cn("h-full transition-all", toneClasses(tone).bg)}
                              style={{ width: `${(entry.stat / (readinessSummary.total || 1)) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <LifecycleProgress progressPercent={readinessSummary.progress} />
              </CardContent>
            </Card>

            {/* Recent validation activity */}
            <Card className="lg:col-span-2 border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)]">
              <CardHeader className="border-b border-[var(--stroke-soft)] pb-4">
                <CardTitle className="flex items-center gap-2 text-xl font-display font-bold text-[var(--surface-card-foreground)]">
                  <Activity className="h-5 w-5 text-[var(--accent-strong)]" />
                  Recent Validation Activity
                </CardTitle>
                <CardDescription className="mt-1.5 font-body text-sm text-[var(--surface-subtle-foreground)]">Latest validation runs and trust updates</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {activities.length === 0 ? (
                  <div className="py-8">
                    <div className="flex justify-center mb-4">
                      <div className="inline-flex h-16 w-16 items-center justify-center rounded-lg bg-[var(--surface-subtle)]">
                        <Activity className="h-8 w-8 text-[var(--accent-strong)]" />
                      </div>
                    </div>
                    <p className="mb-1 text-center text-base font-semibold text-[var(--surface-card-foreground)]">No recent activity</p>
                    <p className="mx-auto mb-6 max-w-xs text-center text-sm text-[var(--surface-subtle-foreground)]">
                      Start validating your detections to generate trust evidence and next actions
                    </p>
                    <div className="flex justify-center">
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={() => router.push("/run-test")} 
                        className="h-8 border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-xs text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)]"
                      >
                        <Play className="h-3 w-3 mr-1.5" />
                        Run First Validation
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activities.map((activity, index) => (
                      <Link
                        key={activity.id}
                        href={`/tests/${activity.id}`}
                        className="group flex gap-3 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 shadow-sm transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--interactive-surface-hover)]"
                      >
                        <div className="flex flex-col items-center">
                          <div className={cn("h-2.5 w-2.5 rounded-full", toneClasses(activityStatusTone(activity.status)).bg)} />
                          {index < activities.length - 1 && (
                          <div className="mt-1 flex-1 w-px bg-[var(--stroke-soft)]" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="line-clamp-2 text-sm font-display font-semibold leading-snug text-[var(--surface-card-foreground)] transition-colors group-hover:text-[var(--accent-strong)]">
                          {activity.title}
                        </p>
                        <p className="mt-0.5 text-xs font-body text-[var(--surface-subtle-foreground)]">{activity.subtitle}</p>
                        <p className="mt-1 text-xs font-body text-[var(--surface-subtle-foreground)]">{activity.time}</p>
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 flex-shrink-0 text-[var(--surface-subtle-foreground)] transition-colors group-hover:text-[var(--surface-card-foreground)]" />
                    </Link>
                  ))}
                    <Button variant="outline" size="sm" className="mt-4 h-8 w-full border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-xs text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)]" asChild>
                      <Link href="/tests">
                        Open Tests
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
      </PageContainer>
  );
}
