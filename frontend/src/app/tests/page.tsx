"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getTests, TestWithDetectionTitle, getDetections, getMitreTechniques, type Detection, type MitreTechnique } from "@/lib/api";
import { format, subDays } from "date-fns";
import { Activity, Play, Target, History, Loader2, Clock, Shield, AlertCircle, RefreshCw, Eye, ArrowUpDown, CheckCircle2, XCircle, AlertTriangle, Zap, TrendingUp, FileText, TestTube, ArrowUpRight, Edit, FileCode, Network, Globe, ChevronRight, ClipboardList, AlertCircle as AlertCircleIcon, Info, Filter, Search, Crosshair, Package, Server, KeyRound, Radar, FlagTriangleRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";

// Helper to determine badge color based on test result
function getResultBadgeClass(result?: string) {
  switch (result) {
    case "PASS":
      return "bg-emerald-100 text-emerald-700 border border-emerald-200";
    case "FAIL":
      return "bg-red-100 text-red-700 border border-red-200";
    case "INCONCLUSIVE":
      return "bg-orange-100 text-orange-700 border border-orange-200";
    case "PENDING":
      return "bg-blue-100 text-blue-700 border border-blue-200";
    case "RUNNING":
      return "bg-yellow-100 text-yellow-700 border border-yellow-200";
    case "ERROR":
      return "bg-red-100 text-red-700 border border-red-200";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-200";
  }
}

type KillChainKey = "recon" | "weaponize" | "deliver" | "exploit" | "install" | "c2" | "actions";

const KILL_CHAIN_STAGES: Array<{
  key: KillChainKey;
  label: string;
  detail: string;
  icon: any;
  accent: string;
}> = [
  { key: "recon", label: "Reconnaissance", detail: "Profile targets & surface", icon: Search, accent: "from-sky-500/20 to-sky-400/10" },
  { key: "weaponize", label: "Weaponization", detail: "Build payload & lure", icon: Package, accent: "from-indigo-500/20 to-indigo-400/10" },
  { key: "deliver", label: "Delivery", detail: "Send the exploit", icon: Crosshair, accent: "from-amber-500/20 to-amber-400/10" },
  { key: "exploit", label: "Exploitation", detail: "Trigger execution", icon: Zap, accent: "from-rose-500/20 to-rose-400/10" },
  { key: "install", label: "Installation", detail: "Persist foothold", icon: Server, accent: "from-emerald-500/20 to-emerald-400/10" },
  { key: "c2", label: "Command & Control", detail: "Establish beacon", icon: Radar, accent: "from-violet-500/20 to-violet-400/10" },
  { key: "actions", label: "Actions on Objectives", detail: "Impact & exfiltrate", icon: FlagTriangleRight, accent: "from-slate-500/20 to-slate-400/10" },
];

const TACTIC_TO_KILL_CHAIN: Record<string, KillChainKey> = {
  Reconnaissance: "recon",
  "Resource Development": "weaponize",
  "Initial Access": "deliver",
  Execution: "exploit",
  Persistence: "install",
  "Command and Control": "c2",
  "Privilege Escalation": "actions",
  "Defense Evasion": "actions",
  "Credential Access": "actions",
  Discovery: "actions",
  "Lateral Movement": "actions",
  Collection: "actions",
  Exfiltration: "actions",
  Impact: "actions",
};

export default function TestsHistoryPage() {
  const router = useRouter();
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [mitreTechniques, setMitreTechniques] = useState<MitreTechnique[]>([]);
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
  const [expandedStage, setExpandedStage] = useState<KillChainKey | null>(null);

  const loadData = async () => {
      try {
        setLoading(true);
      setRefreshing(true);
      const [testsData, detectionsData, mitreData] = await Promise.all([
        getTests(),
        getDetections().catch(() => []),
        getMitreTechniques().catch(() => []),
      ]);
        setTests(testsData);
        setDetections(detectionsData);
        setMitreTechniques(mitreData);
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

  const techniqueTacticsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    mitreTechniques.forEach((tech) => {
      map.set(tech.id, tech.tactics || []);
    });
    return map;
  }, [mitreTechniques]);

  const detectionTechniqueMap = useMemo(() => {
    const map = new Map<string, string>();
    detections.forEach((det) => {
      if (det.id && det.technique_id) {
        map.set(det.id, det.technique_id);
      }
    });
    return map;
  }, [detections]);

  const getStagesForTechnique = useCallback(
    (techniqueId?: string | null) => {
      if (!techniqueId) return new Set<KillChainKey>();
      const direct = techniqueTacticsMap.get(techniqueId);
      const base = techniqueId.includes(".") ? techniqueId.split(".")[0] : techniqueId;
      const tactics = direct && direct.length ? direct : techniqueTacticsMap.get(base) || [];
      const stages = new Set<KillChainKey>();
      tactics.forEach((tactic) => {
        const mapped = TACTIC_TO_KILL_CHAIN[tactic];
        if (mapped) stages.add(mapped);
      });
      return stages;
    },
    [techniqueTacticsMap]
  );

  const testStagesMap = useMemo(() => {
    const map = new Map<number, Set<KillChainKey>>();
    tests.forEach((test) => {
      const techniqueId = test.technique_id || detectionTechniqueMap.get(test.detection_id || "");
      map.set(test.id, getStagesForTechnique(techniqueId));
    });
    return map;
  }, [tests, detectionTechniqueMap, getStagesForTechnique]);

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
  }, [
    tests,
    searchQuery,
    resultFilter,
    envFilter,
    timeFilter,
    extensionFilter,
    sortField,
    sortDirection,
  ]);

  const stageCounts = useMemo(() => {
    const counts: Record<KillChainKey, number> = {
      recon: 0,
      weaponize: 0,
      deliver: 0,
      exploit: 0,
      install: 0,
      c2: 0,
      actions: 0,
    };
    filteredAndSortedTests.forEach((test) => {
      const stages = testStagesMap.get(test.id);
      if (!stages) return;
      stages.forEach((stage) => {
        counts[stage] += 1;
      });
    });
    return counts;
  }, [filteredAndSortedTests, testStagesMap]);

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
      <div className="w-full pl-0.5 pr-0 sm:pr-0">
        <PageHeader
          eyebrow="Attack testing"
          title="Tests"
          subtitle="Run adversary simulations and verify detection coverage"
          icon={<TestTube className="h-5 w-5" />}
        />
      </div>
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
              <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg transition-all shadow-md">
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
                <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg transition-all shadow-md">
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

              <Link href="/tests/audit" className="block h-full">
                <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:shadow-lg transition-all shadow-md">
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

            {/* Global Filters */}
            <Card className="border border-slate-200 bg-white shadow-sm">
              <CardContent className="p-6">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex items-center gap-2 text-sm text-slate-700">
                      <Clock className="h-4 w-4 text-slate-500" />
                      Global filters
                    </div>
                  </div>
                  <div className="flex items-center gap-3 overflow-x-auto">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search by detection, technique, ID, or command"
                      className="h-11 flex-1 min-w-[200px] rounded-lg border-slate-200 bg-white text-slate-900 placeholder:text-slate-500 focus-visible:ring-indigo-200"
                    />
                    <Select value={resultFilter} onValueChange={(v: any) => setResultFilter(v)}>
                      <SelectTrigger className="h-11 w-[140px] rounded-lg border-slate-200 bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 text-sm flex-shrink-0">
                        <SelectValue className="text-slate-900" placeholder="Result" />
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
                      <SelectTrigger className="h-11 w-[160px] rounded-lg border-slate-200 bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 text-sm flex-shrink-0">
                        <SelectValue className="text-slate-900" placeholder="Environment" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-slate-200 shadow-lg">
                        <SelectItem value="all">All Environments</SelectItem>
                        <SelectItem value="lab">Lab</SelectItem>
                        <SelectItem value="dev">Dev</SelectItem>
                        <SelectItem value="prod">Prod</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={timeFilter} onValueChange={(v: any) => setTimeFilter(v)}>
                      <SelectTrigger className="h-11 w-[120px] rounded-lg border-slate-200 bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 text-sm flex-shrink-0">
                        <SelectValue className="text-slate-900" placeholder="Time range" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-slate-200 shadow-lg">
                        <SelectItem value="all">All time</SelectItem>
                        <SelectItem value="24h">Last 24h</SelectItem>
                        <SelectItem value="7d">Last 7 days</SelectItem>
                        <SelectItem value="30d">Last 30 days</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={extensionFilter} onValueChange={(v: any) => setExtensionFilter(v)}>
                      <SelectTrigger className="h-11 w-[140px] rounded-lg border-slate-200 bg-white text-slate-900 hover:border-indigo-200 hover:bg-indigo-50 text-sm flex-shrink-0">
                        <SelectValue className="text-slate-900" placeholder="File/Technique marker" />
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
              </CardContent>
            </Card>

            {/* Cyber Kill Chain */}
            <Card className="border border-slate-200 bg-white shadow-sm">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-base font-semibold text-slate-900">Cyber Kill Chain</CardTitle>
                  <CardDescription className="text-sm text-slate-600">
                    Map test coverage across the adversary lifecycle to spot weak stages fast.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge className="w-fit bg-slate-100 text-slate-600 border border-slate-200">
                    Auto-mapped from ATT&CK tactics
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pb-6">
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7">
                  {KILL_CHAIN_STAGES.map((stage, index) => {
                    const Icon = stage.icon;
                    const isSelected = expandedStage === stage.key;
                    const count = stageCounts[stage.key] || 0;
                    return (
                      <div key={stage.key} className="flex flex-col gap-3">
                        <button
                          type="button"
                          onClick={() => setExpandedStage(isSelected ? null : stage.key)}
                          className={cn(
                            "rounded-2xl border p-5 shadow-sm text-left transition-all",
                            isSelected
                              ? "border-indigo-300 bg-indigo-50/50 shadow-[0_12px_32px_rgba(79,70,229,0.18)]"
                              : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${stage.accent} flex items-center justify-center`}>
                              <Icon className="h-4 w-4 text-slate-700" />
                            </div>
                          </div>
                          <div className="mt-4 space-y-2">
                            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Stage {index + 1}</p>
                            <p className="text-sm font-semibold text-slate-900">{stage.label}</p>
                            <span className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                              {count} tests
                            </span>
                            <p className="text-xs text-slate-600">{stage.detail}</p>
                          </div>
                        </button>
                        {isSelected && (
                          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Stage detail
                              </p>
                              <Badge className="bg-slate-100 text-slate-600 border border-slate-200">
                                {stageCounts[stage.key] || 0} tests
                              </Badge>
                            </div>
                            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                              <div className="grid grid-cols-1 gap-2 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                <span>Tests</span>
                              </div>
                              <div className="divide-y divide-slate-200">
                                {filteredAndSortedTests
                                  .filter((test) => {
                                    const stages = testStagesMap.get(test.id);
                                    return stages ? stages.has(stage.key) : false;
                                  })
                                  .slice(0, 6)
                                  .map((test) => (
                                    <button
                                      key={`stage-${stage.key}-${test.id}`}
                                      type="button"
                                      onClick={() => router.push(`/tests/${test.id}`)}
                                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-indigo-50 transition-colors"
                                    >
                                      <span className="truncate font-medium text-slate-900">
                                        {test.detection_title || "No Detection"}
                                      </span>
                                      <Badge className={getResultBadgeClass(test.result || test.status)}>
                                        {test.result || test.status || "N/A"}
                                      </Badge>
                                    </button>
                                  ))}
                                {filteredAndSortedTests.filter((test) => {
                                  const stages = testStagesMap.get(test.id);
                                  return stages ? stages.has(stage.key) : false;
                                }).length === 0 && (
                                  <div className="px-3 py-4 text-center text-xs text-slate-500">
                                    No tests for this stage yet.
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Badge className="bg-blue-50 text-blue-600 border border-blue-100">
                    Click a stage to view its tests
                  </Badge>
                  <span>Coverage uses ATT&CK tactic mapping; adjust detections to refine.</span>
                </div>
              </CardContent>
            </Card>

            {/* Test Results Card */}
            <Card className="border border-slate-200 bg-white shadow-sm">
              <CardContent className="p-6">

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
