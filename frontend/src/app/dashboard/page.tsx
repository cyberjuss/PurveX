"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { getTests, TestWithDetectionTitle, getDetections, getMyRoles, getMitreTechniques, getSiemConnections, getEnvironmentRunners } from "@/lib/api";
import { formatRelative, format, subDays, startOfDay, isAfter, eachDayOfInterval } from "date-fns";
import { 
  AlertCircle, Play, Shield, TrendingUp, CheckCircle2, Cpu, ScanLine, 
  ShieldCheck, Bell, Activity, AlertTriangle, HelpCircle, Clock, Loader2,
  Users, Target, Zap, BarChart3, ArrowRight, RefreshCw, Eye, Filter, Calendar,
  Download, Search, Keyboard, Sparkles, TrendingDown, Grid3x3, Settings
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LifecycleBadge, LifecycleProgress, LifecycleStage } from "@/components/lifecycle/LifecycleVisualizer";
import { CheckCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { useToast } from "@/components/ui/toast";
import { 
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { FirstRunOnboarding } from "@/components/onboarding/first-run";

// Helper to determine badge color based on test result
function getResultBadgeClass(result?: string) {
  switch (result) {
    case "PASS":
      return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
    case "FAIL":
      return "bg-red-500/20 text-red-300 border border-red-500/40";
    case "INCONCLUSIVE":
      return "bg-amber-500/20 text-amber-300 border border-amber-500/40";
    case "PENDING":
      return "bg-blue-500/20 text-blue-300 border border-blue-500/40";
    case "RUNNING":
      return "bg-orange-500/20 text-orange-300 border border-orange-500/40";
    case "ERROR":
      return "bg-red-500/40 text-red-200 border border-red-500/60";
    default:
      return "bg-slate-500/20 text-slate-300 border border-slate-500/40";
  }
}

// Helper to get icon for test result
function getResultIcon(result?: string) {
  switch (result) {
    case "PASS":
      return <CheckCircle className="h-4 w-4 text-emerald-400" />;
    case "FAIL":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "INCONCLUSIVE":
      return <HelpCircle className="h-4 w-4 text-amber-400" />;
    case "PENDING":
      return <Clock className="h-4 w-4 text-blue-400" />;
    case "RUNNING":
      return <Loader2 className="h-4 w-4 animate-spin text-orange-400" />;
    case "ERROR":
      return <AlertTriangle className="h-4 w-4 text-red-400" />;
    default:
      return <Shield className="h-4 w-4 text-slate-400" />;
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [detectionsSummary, setDetectionsSummary] = useState({
    total: 0,
    pass: 0,
    fail: 0,
    inconclusive: 0,
    untested: 0,
  });
  const [lifecycleSummary, setLifecycleSummary] = useState({
    total: 0,
    identify: 0,
    design: 0,
    develop: 0,
    test: 0,
    deploy: 0,
    maintain: 0,
    progress: 0,
  });
  const [userContext, setUserContext] = useState<{ username?: string; roles?: string[] }>({});
  const [timeFilter, setTimeFilter] = useState<"today" | "7days" | "30days" | "all">("today");
  const [allTests, setAllTests] = useState<TestWithDetectionTitle[]>([]);
  const [mitreStats, setMitreStats] = useState({ total: 0, covered: 0, coveragePercent: 0, rawPercent: 0 });
  const [systemHealth, setSystemHealth] = useState({ siemConnected: 0, siemTotal: 0, runnersActive: 0, runnersTotal: 0 });
  const [hideOnboarding, setHideOnboarding] = useState(false);

  const fetchData = useCallback(async (showToast = false) => {
    try {
      setError(null);
      const [tests, allDetections, mitreTechniques, siemConnections, runners] = await Promise.all([
        getTests().catch(() => []),
        getDetections().catch(() => []),
        getMitreTechniques().catch(() => []),
        getSiemConnections().catch(() => []),
        getEnvironmentRunners().catch(() => []),
      ]);
      
      setAllTests(tests);

      const totalDetections = allDetections.length;
      const passedDetections = allDetections.filter(d => d.last_result === "PASS").length;
      const failedDetections = allDetections.filter(d => d.last_result === "FAIL").length;
      const inconclusiveDetections = allDetections.filter(d => d.last_result === "INCONCLUSIVE").length;
      const untestedDetections = allDetections.filter(d => !d.last_result).length;

      setDetectionsSummary({
        total: totalDetections,
        pass: passedDetections,
        fail: failedDetections,
        inconclusive: inconclusiveDetections,
        untested: untestedDetections,
      });

      setLifecycleSummary({
        total: totalDetections,
        identify: allDetections.filter(d => d["lifecycle_stage"] === "identify").length,
        design: allDetections.filter(d => d["lifecycle_stage"] === "design").length,
        develop: allDetections.filter(d => d["lifecycle_stage"] === "develop").length,
        test: allDetections.filter(d => d["lifecycle_stage"] === "test").length,
        deploy: allDetections.filter(d => d["lifecycle_stage"] === "deploy").length,
        maintain: allDetections.filter(d => d["lifecycle_stage"] === "maintain").length,
        progress: Math.round(
          (
            allDetections.filter(
              d => d["lifecycle_stage"] === "deploy" || d["lifecycle_stage"] === "maintain"
            ).length / (totalDetections || 1)
          ) * 100
        ),
      });

      // Calculate MITRE coverage stats
      const totalTechniques = mitreTechniques.length;
      const coveredTechniques = allDetections.filter(d => d.technique_id).length;
      const uniqueCoveredTechniques = new Set(allDetections.map(d => d.technique_id).filter(Boolean)).size;
      // Calculate accurate percentage with proper precision (1/691 ≈ 0.1447%)
      const rawPercent = totalTechniques > 0 ? (uniqueCoveredTechniques / totalTechniques) * 100 : 0;
      // For display: show 2 decimal places if < 1%, otherwise round to whole number
      const coveragePercent = uniqueCoveredTechniques > 0 && rawPercent < 1 
        ? Math.round(rawPercent * 100) / 100 
        : Math.round(rawPercent);
      setMitreStats({
        total: totalTechniques,
        covered: uniqueCoveredTechniques,
        coveragePercent: coveragePercent,
        rawPercent: rawPercent, // Store raw percent for accurate circle visualization
      });

      // System health
      setSystemHealth({
        siemConnected: siemConnections.filter((s: any) => s.status === "connected" || s.status === "active").length,
        siemTotal: siemConnections.length,
        runnersActive: runners.filter((r: any) =>
          r.status === "active" || r.enabled === true || (r.status === undefined && r.enabled === undefined)
        ).length,
        runnersTotal: runners.length,
      });
    } catch (err: any) {
      const errorMessage = err?.message || "Failed to load dashboard data.";
      setError(errorMessage);
      if (showToast) {
        toast({
          type: "error",
          title: "Refresh failed",
          description: errorMessage,
          action: {
            label: "Retry",
            onClick: () => fetchData(true),
          },
        });
      } else {
        toast({
          type: "error",
          title: "Failed to load dashboard",
          description: errorMessage,
          action: {
            label: "Retry",
            onClick: () => fetchData(false),
          },
        });
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const username = localStorage.getItem("purvex_username") || undefined;
    
    // Fetch user roles from API
    const fetchUserRoles = async () => {
      try {
        const roles = await getMyRoles();
        setUserContext({ username, roles });
      } catch (err) {
        // Fallback to localStorage if API fails
        const role = localStorage.getItem("purvex_user_role") || undefined;
        setUserContext({ username, roles: role ? [role] : [] });
      }
    };
    
    fetchUserRoles();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData(true);
  };

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
      return isAfter(testDate, cutoffDate);
    });
  };

  const filteredTests = getFilteredTests();
  const recentTests = filteredTests.slice(0, 10);

  const recommendation = "Continuously validating, tuning, and prioritizing your defensive coverage.";
  const firstFailure = recentTests.find(test => test.result === "FAIL");
  const needsAttention = Boolean(firstFailure);
  const activities = recentTests.slice(0, 5).map(test => ({
    id: test.id,
    status: test.result || test.status,
    title: `${test.detection_title}`,
    subtitle: `${test.technique_id} · ${test.environment.toUpperCase()}`,
    time: formatRelative(new Date(test.started_at), new Date()),
  }));

  const healthScore = detectionsSummary.total > 0
    ? Math.round(
        ((detectionsSummary.pass / detectionsSummary.total) * 100)
      )
    : 0;

  const passRate = allTests.length > 0 
    ? Math.round((allTests.filter(t => (t.result || "").toUpperCase() === "PASS").length / allTests.length) * 100)
    : 0;

  // Prepare chart data for test trends over time
  const prepareTestTrendData = () => {
    const days = timeFilter === "today" ? 1 : timeFilter === "7days" ? 7 : timeFilter === "30days" ? 30 : 90;
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
    { name: "Passed", value: detectionsSummary.pass, color: "#10b981" },
    { name: "Failed", value: detectionsSummary.fail, color: "#ef4444" },
    { name: "Inconclusive", value: detectionsSummary.inconclusive, color: "#f59e0b" },
    { name: "Untested", value: detectionsSummary.untested, color: "#64748b" },
  ].filter(item => item.value > 0);

  // Prepare lifecycle distribution data
  const lifecycleData = [
    { name: "Deploy", value: lifecycleSummary.deploy, color: "#10b981" },
    { name: "Maintain", value: lifecycleSummary.maintain, color: "#3b82f6" },
    { name: "Develop", value: lifecycleSummary.develop, color: "#6366f1" },
    { name: "Test", value: lifecycleSummary.test, color: "#f59e0b" },
    { name: "Design", value: lifecycleSummary.design, color: "#8b5cf6" },
    { name: "Identify", value: lifecycleSummary.identify, color: "#ec4899" },
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
  }, [router]);

  if (loading) {
    return (
      <PageContainer>
        <LoadingState message="Loading dashboard..." size="lg" />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState 
          title="Error loading dashboard"
          message={error}
          onRetry={() => fetchData(false)}
        />
      </PageContainer>
    );
  }

  const showOnboarding = !hideOnboarding && detectionsSummary.total === 0 && allTests.length === 0;

  return (
      <PageContainer maxWidth="full" className="space-y-3">
            <PageHeader
              title="Security Operations"
              subtitle="Validate detections, run atomic tests, and monitor posture across your environments."
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  className="border-slate-300 bg-white text-black hover:bg-slate-50"
                  onClick={() => router.push("/tests/run")}
                >
                  <Play className="h-4 w-4 mr-1.5" />
                  Run test
                </Button>
              }
            />

            {showOnboarding && (
              <FirstRunOnboarding onDismiss={() => setHideOnboarding(true)} />
            )}

            {/* Quick Actions Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link href="/settings/test-runner" className="block h-full">
              <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center">
                      <Play className="h-4 w-4 text-sky-500" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-slate-900">Install Agent</p>
                      <p className="text-xs text-slate-500">Connect a new endpoint</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </CardContent>
              </Card>
            </Link>

            <Link href="/detections/inventory" className="block h-full">
              <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-6">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-indigo-50 border-2 border-indigo-200 flex items-center justify-center shadow-sm">
                      <Shield className="h-5 w-5 text-indigo-600" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-slate-900">Manage Detections</p>
                      <p className="text-xs text-slate-600">View and create detections</p>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-500" />
                </CardContent>
              </Card>
            </Link>

            <Link href="/tests/explore" className="block h-full">
              <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-6">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-xl bg-cyan-50 border-2 border-cyan-200 flex items-center justify-center shadow-sm">
                      <Target className="h-5 w-5 text-cyan-600" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-slate-900">Explore Techniques</p>
                      <p className="text-xs text-slate-600">Browse MITRE ATT&CK matrix</p>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-500" />
                </CardContent>
              </Card>
            </Link>
          </div>

          {/* System Health & MITRE Coverage Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* MITRE ATT&CK Coverage - Enhanced */}
            <Card>
              <CardHeader className="border-b border-slate-200 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center shadow-sm">
                    <Target className="h-6 w-6 text-blue-500" />
                  </div>
                  <div>
                    <CardTitle className="text-xl font-display font-bold text-black flex items-center gap-2">
                      MITRE ATT&CK Coverage
                    </CardTitle>
                    <CardDescription className="mt-1.5 font-body text-sm text-slate-600">
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
                          <p className="text-4xl font-display font-bold text-black">
                            {mitreStats.coveragePercent < 1 && mitreStats.coveragePercent > 0 
                              ? mitreStats.coveragePercent.toFixed(2) 
                              : mitreStats.coveragePercent}%
                          </p>
                          <Badge className={cn(
                            "text-xs",
                            mitreStats.coveragePercent >= 75 ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" :
                            mitreStats.coveragePercent >= 50 ? "bg-blue-500/20 text-blue-300 border-blue-500/40" :
                            mitreStats.coveragePercent >= 25 ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
                            mitreStats.coveragePercent >= 5 ? "bg-amber-500/20 text-amber-300 border-amber-500/40" :
                            "bg-amber-500/20 text-amber-300 border-amber-500/40"
                          )}>
                            {mitreStats.coveragePercent >= 75 ? "Excellent" :
                             mitreStats.coveragePercent >= 50 ? "Good" :
                             mitreStats.coveragePercent >= 25 ? "Fair" : 
                             mitreStats.coveragePercent >= 5 ? "Low Coverage" : "Low Coverage"}
                          </Badge>
                        </div>
                        <p className="text-sm text-slate-600 font-medium">Overall Coverage</p>
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
                            className="text-slate-800"
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
                            className="text-sky-500"
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="text-center z-10">
                          <p className="text-2xl font-bold text-black leading-tight">{mitreStats.covered}</p>
                          <p className="text-xs text-slate-600 leading-tight">/ {mitreStats.total}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Detailed Stats Grid */}
                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                    <div className="p-3 rounded-lg bg-white border border-slate-200 hover:border-sky-300 transition-colors shadow-sm">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs text-slate-600 uppercase tracking-wider font-medium">Covered</p>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      </div>
                      <p className="text-3xl font-display font-bold text-emerald-600 mb-0.5 leading-tight">{mitreStats.covered}</p>
                      <p className="text-xs text-slate-600 font-medium">techniques covered</p>
                    </div>
                    <div className="p-3 rounded-lg bg-white border border-slate-200 hover:border-sky-300 transition-colors shadow-sm">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs text-slate-600 uppercase tracking-wider font-medium">Remaining</p>
                        <Target className="h-3.5 w-3.5 text-amber-500" />
                      </div>
                      <p className="text-3xl font-display font-bold text-amber-600 mb-0.5 leading-tight">{Math.max(0, mitreStats.total - mitreStats.covered)}</p>
                      <p className="text-xs text-slate-600 font-medium">techniques remaining</p>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
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
              <CardHeader className="border-b border-slate-200 pb-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="h-12 w-12 rounded-xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center shadow-sm">
                        <ShieldCheck className="h-6 w-6 text-emerald-500" />
                      </div>
                      {systemHealth.siemConnected > 0 && systemHealth.runnersActive > 0 && (
                        <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
                      )}
                    </div>
                    <div>
                      <CardTitle className="text-xl font-display font-bold text-black flex items-center gap-2">
                        System Health
                      </CardTitle>
                      <CardDescription className="mt-1.5 font-body text-sm text-slate-600">
                        Integration and test runner status
                      </CardDescription>
                    </div>
                  </div>
                  {(() => {
                    const siemFullyConfigured = systemHealth.siemTotal > 0 && systemHealth.siemConnected === systemHealth.siemTotal;
                    const runnersFullyConfigured = systemHealth.runnersTotal > 0 && systemHealth.runnersActive === systemHealth.runnersTotal;
                    const allHealthy = siemFullyConfigured && runnersFullyConfigured;
                    
                    return allHealthy ? (
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm">
                        <CheckCircle2 className="h-3 w-3 mr-1.5" />
                        All Systems Healthy
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-700 border-amber-200 animate-pulse shadow-sm">
                        <AlertTriangle className="h-3 w-3 mr-1.5" />
                        Action Required
                      </Badge>
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
                          "group relative overflow-hidden rounded-xl border-2 transition-all duration-300 shadow-md bg-white",
                          systemHealth.siemConnected > 0
                            ? "border-emerald-200 shadow-emerald-100"
                            : "border-slate-200"
                        )}
                      >
                        <div className="relative p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-4 flex-1 min-w-0">
                              {/* Enhanced Icon */}
                              <div className={cn(
                                "relative h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-300 flex-shrink-0",
                                systemHealth.siemConnected > 0
                                  ? "bg-emerald-50 border-2 border-emerald-200 shadow-sm"
                                  : "bg-slate-50 border-2 border-slate-200"
                              )}>
                                <Shield className={cn(
                                  "h-6 w-6 transition-all duration-300",
                                  systemHealth.siemConnected > 0 
                                    ? "text-emerald-600" 
                                    : "text-slate-500"
                                )} />
                                {systemHealth.siemConnected > 0 && (
                                  <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
                                )}
                              </div>
                              
                              {/* Content */}
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-base font-display font-bold text-black">SIEM Connections</h3>
                                  {systemHealth.siemConnected > 0 && (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                                  )}
                                </div>
                                
                                {/* Status */}
                                <div>
                                  <p className="text-sm font-semibold text-slate-700">
                                    {systemHealth.siemConnected} of {systemHealth.siemTotal || 1} connected
                                  </p>
                                </div>
                                
                                {/* Empty State Guidance */}
                                {systemHealth.siemConnected === 0 && (
                                  <p className="text-xs text-slate-600 leading-relaxed">
                                    Connect your SIEM to enable detection validation and automated testing workflows.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          {!siemFullyConfigured && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
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
                          "group relative overflow-hidden rounded-xl border-2 transition-all duration-300 shadow-md bg-white",
                          systemHealth.runnersActive > 0
                            ? "border-emerald-200 shadow-emerald-100"
                            : "border-slate-200"
                        )}
                      >
                        <div className="relative p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-4 flex-1 min-w-0">
                              {/* Enhanced Icon */}
                              <div className={cn(
                                "relative h-12 w-12 rounded-xl flex items-center justify-center transition-all duration-300 flex-shrink-0",
                                systemHealth.runnersActive > 0
                                  ? "bg-emerald-50 border-2 border-emerald-200 shadow-sm"
                                  : "bg-slate-50 border-2 border-slate-200"
                              )}>
                                <Cpu className={cn(
                                  "h-6 w-6 transition-all duration-300",
                                  systemHealth.runnersActive > 0 
                                    ? "text-emerald-600" 
                                    : "text-slate-500"
                                )} />
                                {systemHealth.runnersActive > 0 && (
                                  <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 border-2 border-white animate-pulse" />
                                )}
                              </div>
                              
                              {/* Content */}
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-base font-display font-bold text-black">Agent</h3>
                                  {systemHealth.runnersActive > 0 && (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                                  )}
                                </div>
                                
                                {/* Status */}
                                <div>
                                  <p className="text-sm font-semibold text-slate-700">
                                    {systemHealth.runnersTotal === 0
                                      ? "No agents connected"
                                      : runnersFullyConfigured
                                        ? `${systemHealth.runnersActive} of ${systemHealth.runnersTotal} completed`
                                        : `${systemHealth.runnersActive} of ${systemHealth.runnersTotal} active`}
                                  </p>
                                </div>
                                
                                {/* Empty State Guidance */}
                                {systemHealth.runnersActive === 0 && (
                                  <p className="text-xs text-slate-600 leading-relaxed">
                                    Set up an agent to execute atomic tests and validate detection coverage.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          {!runnersFullyConfigured && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                                onClick={() => router.push("/settings/test-runner")}
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

          {/* AI Watchtower Hero */}
          <div className="relative p-8 rounded-lg bg-white border border-slate-200 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                <div className="space-y-4 flex-1">
                  <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-lg bg-sky-50 flex items-center justify-center">
                    <Cpu className="h-7 w-7 text-sky-500" />
                    </div>
                    <div>
                      <div className="flex items-center gap-3">
                      <h2 className="text-2xl font-display font-bold text-black">PurveX AI Watchtower</h2>
                      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                        <div className="h-2 w-2 rounded-full bg-emerald-500 mr-2" />
                          Live
                        </Badge>
                      </div>
                    <p className="text-sm font-body text-slate-600 mt-1">Continuously monitoring your security posture</p>
                    </div>
                  </div>
                <p className="text-base font-body text-slate-700 leading-relaxed max-w-2xl">
                    {recommendation}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                  className="text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={() => router.push("/agent")}
                    aria-label="Open AI Watchtower for insights"
                  >
                    <Cpu className="h-3 w-3 mr-1.5" aria-hidden="true" />
                    Get AI Insights
                  </Button>
              </div>
            </div>
          </div>

          {/* Alert Banner */}
          {needsAttention && firstFailure && (
            <div className="relative p-6 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <AlertTriangle className="h-6 w-6 text-amber-300" />
                  </div>
                  <div>
                    <p className="font-display font-bold text-amber-200 text-lg">Action Required: Test #{firstFailure.id} Failed</p>
                    <p className="text-sm font-body text-amber-300/80 mt-1">
                      {firstFailure.detection_title} · {firstFailure.environment.toUpperCase()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button 
                    variant="outline" 
                    className="border-amber-500/50 text-amber-200 hover:bg-amber-500/20" 
                    asChild
                  >
                    <Link href={`/tests/${firstFailure.id}`} aria-label={`View details for test ${firstFailure.id}`}>
                      <Eye className="h-4 w-4 mr-2" aria-hidden="true" />
                      View Details
                    </Link>
                  </Button>
                  <Button 
                    className="bg-sky-600 text-white hover:bg-sky-500 font-semibold" 
                    onClick={() => router.push("/run-test")}
                    aria-label="Rerun the failed test"
                  >
                    <Play className="h-4 w-4 mr-2" aria-hidden="true" />
                    Rerun Test
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Charts Section - Enhanced Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Test Results Trend Chart */}
            <Card>
              <CardHeader className="border-b border-slate-200 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl font-display font-bold text-black flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-blue-500" />
                      Test Results Trend
                    </CardTitle>
                    <CardDescription className="mt-1.5 font-body text-sm text-slate-600">
                      Test execution results over time
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select 
                      value={timeFilter} 
                      onValueChange={(value: "today" | "7days" | "30days" | "all") => setTimeFilter(value)}
                    >
                      <SelectTrigger 
                        className="w-[140px] h-8 bg-white border border-slate-300 text-xs text-slate-700 focus:ring-2 focus:ring-blue-500/30 transition-all"
                        aria-label="Select time filter for chart data"
                      >
                        <Calendar className="h-3.5 w-3.5 mr-1.5 text-slate-500" aria-hidden="true" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-slate-300 text-slate-700 shadow-lg">
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
                  <ResponsiveContainer width="100%" height={300}>
                    <AreaChart data={testTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorPass" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorFail" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorInconclusive" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#94a3b8" 
                        style={{ fontSize: "11px" }}
                        tick={{ fill: "#94a3b8" }}
                      />
                      <YAxis 
                        stroke="#94a3b8" 
                        style={{ fontSize: "11px" }}
                        tick={{ fill: "#94a3b8" }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "rgba(15, 23, 42, 0.95)",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                          borderRadius: "8px",
                          color: "#e2e8f0",
                        }}
                        labelStyle={{ color: "#cbd5e1" }}
                      />
                      <Legend 
                        wrapperStyle={{ fontSize: "12px", color: "#94a3b8" }}
                        iconType="circle"
                      />
                      <Area
                        type="monotone"
                        dataKey="Pass"
                        stackId="1"
                        stroke="#10b981"
                        fill="url(#colorPass)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="Fail"
                        stackId="1"
                        stroke="#ef4444"
                        fill="url(#colorFail)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="Inconclusive"
                        stackId="1"
                        stroke="#f59e0b"
                        fill="url(#colorInconclusive)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[300px] flex flex-col items-center justify-center text-slate-500">
                    <TrendingUp className="h-12 w-12 mb-3 opacity-30" />
                    <p className="text-sm mb-1">No test data available</p>
                    <p className="text-xs text-slate-600 mb-4">for the selected period</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => router.push("/run-test")} 
                      className="border-slate-300 bg-white text-black hover:bg-slate-50"
                    >
                      <Play className="h-3.5 w-3.5 mr-2" />
                      Run Test
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Detection Status Distribution */}
            <Card>
              <CardHeader className="border-b border-slate-200 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl font-display font-bold text-black flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-blue-500" />
                      Detection Status
                    </CardTitle>
                    <CardDescription className="mt-1.5 font-body text-sm text-slate-600">
                      Distribution of detection validation results
                    </CardDescription>
                  </div>
                  <Button 
                    size="sm"
                    variant="outline" 
                    className="text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    onClick={() => router.push("/detections/inventory")}
                    aria-label="View detection inventory"
                  >
                    <Eye className="h-3 w-3 mr-1.5" aria-hidden="true" />
                    View Detections
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {detectionStatusData.length > 0 ? (
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie
                          data={detectionStatusData}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={(props: any) => {
                            const { name, percent } = props;
                            if (!name || percent === undefined) return '';
                            return `${name}: ${(percent * 100).toFixed(0)}%`;
                          }}
                          outerRadius={100}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {detectionStatusData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "rgba(15, 23, 42, 0.95)",
                            border: "1px solid rgba(59, 130, 246, 0.3)",
                            borderRadius: "8px",
                            color: "#e2e8f0",
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[300px] flex flex-col items-center justify-center text-slate-500">
                    <BarChart3 className="h-12 w-12 mb-3 opacity-30" />
                    <p className="text-sm mb-1">No detection data available</p>
                    <p className="text-xs text-slate-600 mb-4">Create your first detection to get started</p>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => router.push("/detections/inventory")} 
                      className="text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      <Eye className="h-3 w-3 mr-1.5" />
                      View Detections
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Main Content Grid - Enhanced Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Detection Lifecycle Summary */}
            <Card className="lg:col-span-3">
              <CardHeader className="border-b border-slate-800/50 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl font-display font-bold text-white flex items-center gap-2">
                      <Target className="h-5 w-5 text-blue-400" />
                      Detection Lifecycle
                    </CardTitle>
                    <CardDescription className="mt-1.5 font-body text-sm text-slate-400">
                      Progress through the detection engineering lifecycle
                    </CardDescription>
                  </div>
                  <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/40 font-semibold">
                    {lifecycleSummary.progress}% Complete
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="space-y-4 mb-6">
                  {[
                    { stage: "deploy", label: "Deployed", stat: lifecycleSummary.deploy, color: "emerald" },
                    { stage: "maintain", label: "Maintained", stat: lifecycleSummary.maintain, color: "blue" },
                    { stage: "develop", label: "In Development", stat: lifecycleSummary.develop, color: "indigo" },
                    { stage: "test", label: "Testing", stat: lifecycleSummary.test, color: "amber" },
                  ].map(entry => (
                    <div key={entry.stage} className="flex items-center justify-between p-3 rounded-xl bg-white border border-slate-200 shadow-sm">
                      <div className="flex items-center gap-3">
                        <LifecycleBadge stage={entry.stage as LifecycleStage} />
                        <span className="text-sm font-body text-slate-700">{entry.label}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-display font-bold text-black">{entry.stat}</span>
                        <div className="h-2 w-32 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={cn(
                              "h-full transition-all",
                              entry.color === "emerald" && "bg-emerald-500",
                              entry.color === "blue" && "bg-blue-500",
                              entry.color === "indigo" && "bg-blue-500",
                              entry.color === "amber" && "bg-amber-500"
                            )}
                            style={{ width: `${(entry.stat / (lifecycleSummary.total || 1)) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <LifecycleProgress progressPercent={lifecycleSummary.progress} />
              </CardContent>
            </Card>

            {/* Recent Activity - Enhanced */}
            <Card className="lg:col-span-2 border border-white/60 bg-white/85 backdrop-blur shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
              <CardHeader className="border-b border-slate-200 pb-4">
                <CardTitle className="text-xl font-display font-bold text-slate-900 flex items-center gap-2">
                  <Activity className="h-5 w-5 text-sky-600" />
                  Recent Activity
                </CardTitle>
                <CardDescription className="mt-1.5 font-body text-sm text-slate-600">Latest test runs and validations</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                {activities.length === 0 ? (
                  <div className="py-8">
                    <div className="flex justify-center mb-4">
                      <div className="inline-flex items-center justify-center h-16 w-16 rounded-lg bg-sky-500/10">
                        <Activity className="h-8 w-8 text-sky-400" />
                      </div>
                    </div>
                    <p className="text-center text-base font-semibold text-slate-900 mb-1">No recent activity</p>
                    <p className="text-center text-sm text-slate-600 mb-6 max-w-xs mx-auto">
                      Start validating your detections by running your first atomic red team test
                    </p>
                    <div className="flex justify-center">
                      <Button 
                        variant="outline"
                        size="sm"
                        onClick={() => router.push("/run-test")} 
                        className="text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      >
                        <Play className="h-3 w-3 mr-1.5" />
                        Run First Test
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {activities.map((activity, index) => (
                      <Link
                        key={activity.id}
                        href={`/tests/${activity.id}`}
                        className="group flex gap-3 p-3 rounded-lg bg-white/80 border border-slate-200 hover:border-sky-200 hover:bg-white transition-colors shadow-sm"
                      >
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            "h-2.5 w-2.5 rounded-full",
                            activity.status === "FAIL" && "bg-red-400",
                            activity.status === "PASS" && "bg-emerald-400",
                            activity.status === "INCONCLUSIVE" && "bg-amber-400",
                            "bg-slate-400"
                          )} />
                          {index < activities.length - 1 && (
                            <div className="flex-1 w-px bg-slate-200 mt-1" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-display font-semibold text-slate-900 line-clamp-2 leading-snug group-hover:text-sky-600 transition-colors">
                            {activity.title}
                          </p>
                          <p className="text-xs font-body text-slate-600 mt-0.5">{activity.subtitle}</p>
                          <p className="text-xs font-body text-slate-500 mt-1">{activity.time}</p>
                        </div>
                        <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors flex-shrink-0 mt-1" />
                      </Link>
                    ))}
                    <Button variant="outline" size="sm" className="w-full mt-4 text-xs h-8 border-slate-300 bg-white text-slate-700 hover:bg-slate-50" asChild>
                      <Link href="/tests">
                        View All Tests
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
