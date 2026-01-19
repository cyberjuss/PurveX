"use client";

import { useState, useEffect, useMemo } from "react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getTests, TestWithDetectionTitle, getDetections, type Detection } from "@/lib/api";
import { format, subDays } from "date-fns";
import { Activity, Play, Target, History, Loader2, Clock, Shield, AlertCircle, RefreshCw, Eye, ArrowUpDown, CheckCircle2, XCircle, AlertTriangle, Zap, TrendingUp, FileText, TestTube, ArrowUpRight, Edit, FileCode, Network, Globe, ChevronRight, ClipboardList, AlertCircle as AlertCircleIcon, Info, Filter } from "lucide-react";

// Helper to determine badge color based on test result
function getResultBadgeClass(result?: string) {
  switch (result) {
    case "PASS":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40";
    case "FAIL":
      return "bg-red-500/15 text-red-300 border border-red-500/40";
    case "INCONCLUSIVE":
      return "bg-orange-500/15 text-orange-300 border border-orange-500/40";
    case "PENDING":
      return "bg-blue-500/15 text-blue-300 border border-blue-500/40";
    case "RUNNING":
      return "bg-yellow-500/15 text-yellow-300 border border-yellow-500/40";
    case "ERROR":
      return "bg-red-700/15 text-red-500 border border-red-700/40";
    default:
      return "bg-slate-700/40 text-slate-200 border border-slate-600/60";
  }
}

export default function TestsHistoryPage() {
  const router = useRouter();
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<"all" | "PASS" | "FAIL" | "INCONCLUSIVE" | "PENDING" | "RUNNING" | "ERROR">("all");
  const [envFilter, setEnvFilter] = useState<"all" | "lab" | "dev" | "prod">("all");
  const [timeFilter, setTimeFilter] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [extensionFilter, setExtensionFilter] = useState<"all" | ".ps1" | ".sh" | ".bat" | ".py" | ".exe" | ".dll" | ".js" | ".vbs">("all");
  const [sortField, setSortField] = useState<"started_at" | "result" | "score" | "detection_title">("started_at");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const loadData = async () => {
      try {
        setLoading(true);
      setRefreshing(true);
      const [testsData, detectionsData] = await Promise.all([
          getTests(),
        getDetections().catch(() => []),
        ]);
        setTests(testsData);
        setDetections(detectionsData);
      setError(null);
      } catch (err: any) {
      setError(err?.message || "Failed to load test data.");
      } finally {
        setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Detection Engineering Metrics
  const detectionMetrics = useMemo(() => {
    const totalDetections = detections.length;
    const testedDetections = new Set(tests.map(t => t.detection_id).filter(Boolean)).size;
    const untestedDetections = totalDetections - testedDetections;
    const coveragePercentage = totalDetections > 0 ? Math.round((testedDetections / totalDetections) * 100) : 0;
    
    // Pass rate calculation
    const totalTests = tests.length;
    const passedTests = tests.filter(t => (t.result || "").toUpperCase() === "PASS").length;
    const passRate = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;
    
    // Detections needing validation (never tested or stale)
    const thirtyDaysAgo = subDays(new Date(), 30);
    const detectionsNeedingTest = detections.filter(d => {
      if (!d.last_tested_at) return true;
      return new Date(d.last_tested_at) < thirtyDaysAgo;
    }).length;

    // Active test executions (last 24 hours)
    const twentyFourHoursAgo = subDays(new Date(), 1).getTime();
    const runningTests = tests.filter(t => {
      if ((t.status || "").toUpperCase() !== "RUNNING") return false;
      const started = new Date(t.started_at).getTime();
      return started >= twentyFourHoursAgo;
    }).length;
    const pendingTests = tests.filter(t => {
      if ((t.status || "").toUpperCase() !== "PENDING") return false;
      const started = new Date(t.started_at).getTime();
      return started >= twentyFourHoursAgo;
    }).length;

    // Failed tests requiring attention (last 24 hours)
    const failedTests = tests.filter(t => (t.result || "").toUpperCase() === "FAIL").length;
    const recentFailures = tests.filter(t => {
      if ((t.result || "").toUpperCase() !== "FAIL") return false;
      const started = new Date(t.started_at).getTime();
      return started >= twentyFourHoursAgo;
    }).length;

    return {
      totalDetections,
      testedDetections,
      untestedDetections,
      coveragePercentage,
      passRate,
      totalTests,
      passedTests,
      detectionsNeedingTest,
      runningTests,
      pendingTests,
      failedTests,
      recentFailures,
    };
  }, [tests, detections]);

  // Filter and sort tests
  const filteredAndSortedTests = useMemo(() => {
    let filtered = [...tests];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(t => 
        (t.detection_title || "").toLowerCase().includes(query) ||
        (t.technique_id || "").toLowerCase().includes(query) ||
        t.id.toString().includes(query)
      );
    }

    if (resultFilter !== "all") {
      filtered = filtered.filter(t => 
        (t.result || t.status || "").toUpperCase() === resultFilter
      );
    }

    if (envFilter !== "all") {
      filtered = filtered.filter(t => 
        (t.environment || "").toLowerCase() === envFilter
      );
    }

    if (timeFilter !== "all") {
      const now = Date.now();
      const cutoff = timeFilter === "24h" ? now - 24 * 60 * 60 * 1000 :
                     timeFilter === "7d" ? now - 7 * 24 * 60 * 60 * 1000 :
                     now - 30 * 24 * 60 * 60 * 1000;
      filtered = filtered.filter(t => {
        const started = new Date(t.started_at).getTime();
        return started >= cutoff;
      });
    }

    if (extensionFilter !== "all") {
      filtered = filtered.filter(t => {
        // Check if marker or technique_id contains the extension
        const marker = (t.marker || "").toLowerCase();
        const techniqueId = (t.technique_id || "").toLowerCase();
        const extension = extensionFilter.toLowerCase();
        return marker.includes(extension) || techniqueId.includes(extension);
      });
    }

    filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortField) {
        case "started_at":
          aVal = new Date(a.started_at).getTime();
          bVal = new Date(b.started_at).getTime();
          break;
        case "result":
          aVal = (a.result || a.status || "").toUpperCase();
          bVal = (b.result || b.status || "").toUpperCase();
          break;
        case "score":
          aVal = a.score ?? 0;
          bVal = b.score ?? 0;
          break;
        case "detection_title":
          aVal = (a.detection_title || "").toLowerCase();
          bVal = (b.detection_title || "").toLowerCase();
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [tests, searchQuery, resultFilter, envFilter, timeFilter, extensionFilter, sortField, sortDirection]);

  // Get recent runs (last 10)
  const recentRuns = [...tests]
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    .slice(0, 10);

  // Test Controls Panel Data
  const testControls = useMemo(() => {
    const latestTest = tests.length > 0 
      ? tests.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0]
      : null;
    
    const lastTestStatus = latestTest 
      ? (latestTest.result || latestTest.status || "NOT RUN").toUpperCase()
      : "NOT RUN";
    
    const lastTestDate = latestTest ? new Date(latestTest.started_at) : null;
    const daysSinceLastTest = lastTestDate 
      ? Math.floor((Date.now() - lastTestDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    
    const testFreshness = daysSinceLastTest === null 
      ? "Never tested"
      : daysSinceLastTest === 0 
        ? "Today"
        : daysSinceLastTest === 1
          ? "1 day ago"
          : `${daysSinceLastTest} days ago`;

    return {
      lastTestStatus,
      testFreshness,
      daysSinceLastTest,
      latestTest,
    };
  }, [tests]);

  // Drift Monitoring Data (stubbed for now - would come from backend)
  const driftMonitoring = useMemo(() => {
    // Logic Drift: Detection logic changed since last test
    const logicDrift = detections.filter(d => {
      if (!d.last_tested_at) return false;
      // Stub: Would check if detection logic/query changed since last test
      return false; // Placeholder
    }).length;

    // Telemetry Drift: Required data sources missing or mismatched
    const telemetryDrift = detections.filter(d => {
      // Stub: Would check if required log sources are available
      return false; // Placeholder
    }).length;

    // Threat Drift: MITRE technique updated or new behaviors
    const threatDrift = tests.filter(t => {
      // Stub: Would check if technique has updates since test
      return false; // Placeholder
    }).length;

    // Environment Drift: Testing host/config changed
    const environmentDrift = tests.filter(t => {
      // Stub: Would check if environment config changed
      return false; // Placeholder
    }).length;

    return {
      logicDrift,
      telemetryDrift,
      threatDrift,
      environmentDrift,
      hasAnyDrift: logicDrift > 0 || telemetryDrift > 0 || threatDrift > 0 || environmentDrift > 0,
    };
  }, [detections, tests]);

  // Latest Test Result Summary
  const latestTestSummary = useMemo(() => {
    if (tests.length === 0) return null;
    
    const latest = tests.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
    
    // Get drift status at time of test (stubbed)
    const driftStatus = driftMonitoring.hasAnyDrift ? "Drift detected" : "No drift";
    
    return {
      ...latest,
      driftStatus,
      evidenceLink: latest.id ? `/tests/${latest.id}` : null,
      tester: "System", // Would come from test.created_by or similar
    };
  }, [tests, driftMonitoring]);

  // Export functionality
  const handleExport = () => {
    const csv = [
      ["ID", "Detection", "Technique", "Environment", "Result", "Score", "Started", "Finished"].join(","),
      ...filteredAndSortedTests.map(t => [
        t.id,
        `"${(t.detection_title || "").replace(/"/g, '""')}"`,
        t.technique_id || "",
        t.environment || "",
        t.result || t.status || "",
        t.score?.toString() || "",
        t.started_at || "",
        t.finished_at || "",
      ].join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tests-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  return (
    <PageContainer maxWidth="full" className="space-y-6 pt-2 pb-10">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6">
          <p className="text-red-400">{error}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Quick Actions aligned to detections card style */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Link href="/tests/explore" className="block h-full">
              <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-6">
                  <div className="space-y-1">
                    <p className="text-xs font-display font-semibold text-slate-500 uppercase tracking-wider">Atomic tests</p>
                    <p className="text-sm text-slate-600">Browse and launch atomic techniques.</p>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center shadow-sm">
                    <Target className="h-6 w-6 text-blue-500" />
                  </div>
                </CardContent>
              </Card>
            </Link>

              <Link href="/run-test" className="block h-full">
                <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                  <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-6">
                    <div className="space-y-1">
                      <p className="text-xs font-display font-semibold text-slate-500 uppercase tracking-wider">Launch test</p>
                      <p className="text-sm text-slate-600">Start a guided run in three steps.</p>
                    </div>
                    <div className="h-12 w-12 rounded-xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center shadow-sm">
                      <Play className="h-6 w-6 text-emerald-500" />
                    </div>
                  </CardContent>
                </Card>
              </Link>

              <Link href="#audit" className="block h-full">
                <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                  <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-6">
                    <div className="space-y-1">
                      <p className="text-xs font-display font-semibold text-slate-500 uppercase tracking-wider">Audit</p>
                      <p className="text-sm text-slate-600">
                        Execution context and traceability for every test run.
                      </p>
                    </div>
                    <div className="h-12 w-12 rounded-xl bg-indigo-50 border-2 border-indigo-200 flex items-center justify-center shadow-sm">
                      <ClipboardList className="h-6 w-6 text-indigo-600" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>

            {/* Test Runs - Unified */}
                        <Card className="overflow-hidden border border-slate-100 shadow-lg bg-white" id="audit">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shadow-sm">
                      <History className="h-5 w-5 text-slate-700" />
                    </div>
                    <div className="space-y-1">
                      <CardTitle className="text-[22px] font-bold text-slate-900">Test Runs</CardTitle>
                      <CardDescription className="text-xs text-slate-600">
                        All tests are scoped and reversible on approved environments.
                      </CardDescription>
                      <p className="text-sm text-slate-700">
                        Track recent executions and quickly rerun when ready.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-slate-100 text-slate-800 border border-slate-200 font-semibold">
                      {filteredAndSortedTests.length} {filteredAndSortedTests.length === 1 ? "test" : "tests"}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-4 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <Clock className="h-4 w-4 text-slate-500" />
                      Recent activity
                    </div>
                  <div className="text-xs text-slate-500">
                    {filteredAndSortedTests.length} results - sorted by {sortField === "started_at" ? "Start time" : "Custom"}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                  <div className="col-span-1 sm:col-span-2">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by detection, technique, ID, or command"
                      className="h-11 rounded-lg border-slate-200 focus-visible:ring-indigo-200"
                    />
                  </div>
                  <Select value={resultFilter} onValueChange={(v: any) => setResultFilter(v)}>
                    <SelectTrigger className="h-11 min-w-[150px] rounded-lg border-slate-200 bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 text-sm">
                      <SelectValue placeholder="Result" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-slate-200 shadow-lg">
                      <SelectItem value="all">All Results</SelectItem>
                      <SelectItem value="PASS">Pass</SelectItem>
                      <SelectItem value="FAIL">Fail</SelectItem>
                      <SelectItem value="INCONCLUSIVE">Inconclusive</SelectItem>
                      <SelectItem value="PENDING">Pending</SelectItem>
                      <SelectItem value="RUNNING">Running</SelectItem>
                      <SelectItem value="ERROR">Error</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={envFilter} onValueChange={(v: any) => setEnvFilter(v)}>
                    <SelectTrigger className="h-11 min-w-[150px] rounded-lg border-slate-200 bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 text-sm">
                      <SelectValue placeholder="Environment" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-slate-200 shadow-lg">
                      <SelectItem value="all">All Environments</SelectItem>
                      <SelectItem value="lab">Lab</SelectItem>
                      <SelectItem value="dev">Dev</SelectItem>
                      <SelectItem value="prod">Prod</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={timeFilter} onValueChange={(v: any) => setTimeFilter(v)}>
                    <SelectTrigger className="h-11 rounded-lg border-slate-200 bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 text-sm">
                      <SelectValue placeholder="Time range" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-slate-200 shadow-lg">
                      <SelectItem value="all">All time</SelectItem>
                      <SelectItem value="24h">Last 24h</SelectItem>
                      <SelectItem value="7d">Last 7 days</SelectItem>
                      <SelectItem value="30d">Last 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={extensionFilter} onValueChange={(v: any) => setExtensionFilter(v)}>
                    <SelectTrigger className="h-11 rounded-lg border-slate-200 bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 text-sm">
                      <SelectValue placeholder="File/Technique marker" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-slate-200 shadow-lg">
                      <SelectItem value="all">Any marker</SelectItem>
                      <SelectItem value=".ps1">PowerShell</SelectItem>
                      <SelectItem value=".sh">Shell</SelectItem>
                      <SelectItem value=".bat">Batch</SelectItem>
                      <SelectItem value=".py">Python</SelectItem>
                      <SelectItem value=".exe">Executable</SelectItem>
                      <SelectItem value=".dll">DLL</SelectItem>
                      <SelectItem value=".js">JavaScript</SelectItem>
                      <SelectItem value=".vbs">VBScript</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                </div>

                {/* Test List or Empty State */}
                {filteredAndSortedTests.length === 0 ? (
                  <div className="text-center py-14 rounded-2xl border border-dashed border-slate-200 bg-slate-50">
                    <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-indigo-50 border-2 border-indigo-100 mb-4 shadow-sm">
                      <Info className="h-8 w-8 text-slate-700" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">No test runs yet</h3>
                    <p className="text-sm text-slate-600 mb-6 max-w-2xl mx-auto">
                      Start your first run to see telemetry and detection outcomes here.
                    </p>
                    <Link href="/run-test">
                      <Button
                        variant="default"
                        size="lg"
                        className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm text-sm px-5"
                      >
                        Run your first test
                      </Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredAndSortedTests.map((test) => (
                      <div
                        key={test.id}
                        onClick={() => router.push(`/tests/${test.id}`)}
                        className="group relative overflow-hidden rounded-xl hover:bg-indigo-50 border border-slate-200 p-4 cursor-pointer transition-all duration-200 bg-white"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="flex-shrink-0">
                              <Badge className={getResultBadgeClass(test.result || test.status)}>
                                {test.result || test.status || "N/A"}
                              </Badge>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-900 group-hover:text-indigo-700 mb-1 truncate transition-colors">
                                {test.detection_title || "No Detection"}
                              </p>
                              <div className="flex items-center gap-3 text-xs text-slate-600 group-hover:text-slate-700 transition-colors flex-wrap">
                                <span className="font-mono">{test.technique_id || "Unknown technique"}</span>
                                <span className="text-slate-400">|</span>
                                <span className="uppercase">{test.environment || "N/A"}</span>
                                <span className="text-slate-400">|</span>
                                <span>{format(new Date(test.started_at), "MMM dd, yyyy HH:mm")}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 flex-shrink-0">
                            {typeof test.score === "number" && (
                              <div className="text-right">
                                <p className="text-xl font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">
                                  {test.score}
                                </p>
                                <p className="text-xs text-slate-500 group-hover:text-slate-600 transition-colors">/100</p>
                              </div>
                            )}
                            <ChevronRight className="h-5 w-5 text-slate-500 group-hover:text-slate-900 group-hover:translate-x-1 transition-all" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
    </PageContainer>
  );
}
