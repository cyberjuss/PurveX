"use client";

import { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getDetections, getDetectionAlerts, Detection, DetectionAlert, apiFetch } from "@/lib/api";
import { format, formatRelative, subDays, isAfter } from "date-fns";
import { Activity, AlertTriangle, Eye, Play, Shield, Sparkles, ArrowRight, Cpu, Download, CheckSquare, Square, ArrowUpDown, RefreshCw, Search, CheckCircle2, XCircle, Clock, TrendingUp, Zap, Target, X, PanelRightOpen, PanelRightClose, Filter, XCircle as XIcon, SlidersHorizontal, Database, ChevronLeft, ChevronRight } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { PageContainer } from "@/components/layout/page-container";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";

type HealthStateKey = "HEALTHY" | "DETECTION_FAILED" | "TELEMETRY_MISSING" | "UNKNOWN";

// Map backend results into the PurveX 4‑state health model.
function deriveHealthState(d: Detection): HealthStateKey {
  // Never tested → Unknown
  if (!d.last_tested_at) {
    return "UNKNOWN";
  }

  const result = (d.last_result || "").toUpperCase();

  // This mirrors the backend logic:
  // - PASS          → logs present + detection fired      → Healthy
  // - FAIL          → logs present, detection not fired   → Detection Failed
  // - INCONCLUSIVE  → typically no logs                   → Telemetry Missing
  switch (result) {
    case "PASS":
      return "HEALTHY";
    case "FAIL":
      return "DETECTION_FAILED";
    case "INCONCLUSIVE":
      return "TELEMETRY_MISSING";
    default:
      return "UNKNOWN";
  }
}

function getHealthBadgeClass(state: HealthStateKey) {
  switch (state) {
    case "HEALTHY":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40";
    case "DETECTION_FAILED":
      return "bg-red-500/15 text-red-300 border border-red-500/40";
    case "TELEMETRY_MISSING":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/40";
    case "UNKNOWN":
    default:
      return "bg-slate-700/40 text-slate-300 border border-slate-600/60";
  }
}

function getHealthLabel(state: HealthStateKey) {
  switch (state) {
    case "HEALTHY":
      return "Healthy";
    case "DETECTION_FAILED":
      return "Detection Failed";
    case "TELEMETRY_MISSING":
      return "Telemetry Missing";
    case "UNKNOWN":
    default:
      return "Unknown";
  }
}

function getHealthNarrative(state: HealthStateKey) {
  switch (state) {
    case "HEALTHY":
      return {
        headline: "Logs present and detection fired.",
        detail:
          "The atomic test reached your environment, telemetry landed in the SIEM, and the detection logic triggered on that signal. Both the pipeline and the rule are behaving as designed.",
        action:
          "No immediate tuning required. Keep this rule under normal lifecycle review and watch for drift over time.",
      };
    case "DETECTION_FAILED":
      return {
        headline: "Telemetry arrived, but the detection did not fire.",
        detail:
          "The atomic test reached the SIEM and logs containing the PurveX marker are present, but the rule never triggered. This usually points to field mismatches, over‑aggressive filtering, normalization gaps, or thresholds set too high.",
        action:
          "Open the relevant index/sourcetype, inspect events with the PurveX marker, and align your SPL/KQL fields, filters, and thresholds to those events. Re‑run a validation after tuning the detection.",
      };
    case "TELEMETRY_MISSING":
      return {
        headline: "Atomic test ran but no telemetry was observed.",
        detail:
          "Within the validation window, PurveX did not see any events containing the marker in the SIEM. This typically indicates an agent or collector problem, incorrect index/sourcetype routing, or that the test did not execute on a host that is sending telemetry.",
        action:
          "Confirm the atomic test executed on the expected host, then verify the endpoint agent, forwarder, and index/sourcetype configuration. Fix the telemetry path first, then re‑run the test.",
      };
    case "UNKNOWN":
    default:
      return {
        headline: "This detection has never been validated in PurveX.",
        detail:
          "No PurveX atomic tests have been run against this detection yet, so we cannot tell whether issues would come from the telemetry path or from the detection logic.",
        action:
          "Run a lab validation before treating this rule as trusted coverage or promoting it further in the lifecycle.",
      };
  }
}

function getStatusBadgeClass(status?: string) {
  switch ((status || "").toUpperCase()) {
    case "ACTIVE":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40";
    case "NEEDS_IMPROVEMENT":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/40";
    case "DRAFT":
      return "bg-slate-500/20 text-slate-200 border border-slate-400/40";
    case "RETIRED":
      return "bg-slate-700/40 text-slate-400 border border-slate-600/60";
    default:
      return "bg-slate-700/40 text-slate-200 border border-slate-600/60";
  }
}

function DetectionsPageContent() {
  const { hasPermission } = usePermissions();
  const searchParams = useSearchParams();
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alerts, setAlerts] = useState<DetectionAlert[]>([]);
  
  // Auto-open sidebar when detection is selected
  useEffect(() => {
    if (selectedDetection) {
      setSidebarOpen(true);
    }
  }, [selectedDetection]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<number | null>(null);
  const [searchTitle, setSearchTitle] = useState("");
  const [searchTechnique, setSearchTechnique] = useState("");
  const [searchSiem, setSearchSiem] = useState("");
  const [alertSearch, setAlertSearch] = useState("");
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterPriority, setFilterPriority] = useState<string>("all");
  const [filterHealthState, setFilterHealthState] = useState<string>("all");
  const [filterSiemType, setFilterSiemType] = useState<string>("all");
  const [testingFilter, setTestingFilter] = useState<"all" | "tested" | "untested">(
    "all"
  );
  const [lifecycleFilter, setLifecycleFilter] = useState<
    "all" | "DRAFT" | "ACTIVE" | "NEEDS_IMPROVEMENT" | "RETIRED" | "AT_RISK"
  >("all");
  const [selectedDetections, setSelectedDetections] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<"title" | "technique_id" | "last_tested_at" | "last_score" | "last_result" | "last_pass_at" | "last_fail_at" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [refreshing, setRefreshing] = useState(false);
  const [catalogPage, setCatalogPage] = useState(0);
  const [catalogTimeFilter, setCatalogTimeFilter] = useState<"24h" | "7d" | "30d" | "90d" | "all">("90d");
  // Client-side date state to avoid hydration mismatches
  const [now, setNow] = useState<Date | null>(null);

  const loadDetections = useCallback(async () => {
      try {
        setLoading(true);
      setRefreshing(true);
        const data = await getDetections();
        // Deduplicate by ID in case backend returns duplicates
        const uniqueDetections = Array.from(
          new Map(data.map((d) => [d.id, d])).values()
        );
        setDetections(uniqueDetections);
      setError(null);
      } catch (err: any) {
        setError(err.message || "Failed to load detections.");
      } finally {
        setLoading(false);
      setRefreshing(false);
      }
  }, []);

  useEffect(() => {
    loadDetections();
  }, []);

  useEffect(() => {
    const resultParam = (searchParams.get("result") || "").toUpperCase();
    if (resultParam === "PASS" || resultParam === "FAIL" || resultParam === "INCONCLUSIVE") {
      setFilterSeverity(resultParam);
    }
  }, [searchParams]);

  // Keyboard shortcuts - must be before early returns to follow Rules of Hooks
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ctrl/Cmd + R for refresh
      if ((e.ctrlKey || e.metaKey) && e.key === "r") {
        e.preventDefault();
        loadDetections();
      }
      // Ctrl/Cmd + A for select all (works on all detections, not just filtered)
      if ((e.ctrlKey || e.metaKey) && e.key === "a" && e.target instanceof HTMLInputElement === false) {
        e.preventDefault();
        if (detections.length > 0) {
          setSelectedDetections(new Set(detections.map(d => d.id)));
        }
      }
      // Escape to deselect all
      if (e.key === "Escape") {
        setSelectedDetections(new Set());
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [detections, loadDetections]);

  // Set client-side date to avoid hydration mismatches
  useEffect(() => {
    setNow(new Date());
  }, []);

  // Screen reader announcements for filter changes
  const [announcement, setAnnouncement] = useState<string>("");
  useEffect(() => {
    if (announcement) {
      const timer = setTimeout(() => setAnnouncement(""), 1000);
      return () => clearTimeout(timer);
    }
  }, [announcement]);

  async function loadAlertsForDetection(det: Detection) {
    try {
      setAlertsLoading(true);
      setAlertsError(null);
      const data = await getDetectionAlerts(det.id);
      // getDetectionAlerts now returns empty array for 404s instead of throwing
      setAlerts(data);
      setSelectedAlertId(data[0]?.id ?? null);
    } catch (err: any) {
      // Only set error for non-404 errors
      const is404 = (err as any)?.is404 || 
                    err?.message?.toLowerCase().includes("not found") || 
                    err?.message?.toLowerCase().includes("404");
      if (!is404) {
        setAlertsError(err.message || "Failed to load recent SIEM events for this detection.");
      }
      setAlerts([]);
      setSelectedAlertId(null);
    } finally {
      setAlertsLoading(false);
    }
  }

  async function handleCreateSampleDetection() {
    setError(null);
    setCreating(true);
    try {
      // Minimal, safe sample detection so you can exercise the test pipeline and Test Detail page.
      const payload = {
        technique_id: "T1003",
        title: "Sample LSASS credential dumping detection (PurveX demo)",
        description:
          "Sample detection rule for validating the PurveX Atomic → SIEM → Score → AI pipeline in a lab environment.",
        sigma_rule: null,
        siem_type: "splunk",
        siem_query: 'index=security_logs "purvex_"',
        scheduled: false,
      };

      const created = await apiFetch("/detections", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      // Prepend the new detection so it appears at the top, avoiding duplicates
      setDetections((prev) => {
        const newDetection = created as Detection;
        // Remove any existing detection with the same ID, then prepend
        const filtered = prev.filter((d) => d.id !== newDetection.id);
        return [newDetection, ...filtered];
      });
    } catch (err: any) {
      setError(err.message || "Failed to create sample detection.");
    } finally {
      setCreating(false);
    }
  }

  // Helper functions - must be defined before filteredDetections
  const statusNormalized = (status?: string) =>
    (status || "DRAFT").toUpperCase();

  const AT_RISK_THRESHOLD_DAYS = 30;
  function isAtRisk(det: Detection) {
    if (!det.last_tested_at) return true;
    const last = new Date(det.last_tested_at);
    if (Number.isNaN(last.getTime())) return true;
    const currentTime = nowRef;
    const diffMs = currentTime.getTime() - last.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= AT_RISK_THRESHOLD_DAYS;
  }

  function getPriorityLabel(score?: number | null): "High" | "Medium" | "Low" | null {
    if (score == null) return null;
    if (score >= 80) return "High";
    if (score >= 50) return "Medium";
    return "Low";
  }

  // Sorting function
  const sortDetections = (detections: Detection[]) => {
    if (!sortField) return detections;
    
    return [...detections].sort((a, b) => {
      let aVal: any;
      let bVal: any;
      
      switch (sortField) {
        case "title":
          aVal = a.title?.toLowerCase() || "";
          bVal = b.title?.toLowerCase() || "";
          break;
        case "technique_id":
          aVal = a.technique_id || "";
          bVal = b.technique_id || "";
          break;
        case "last_tested_at":
          aVal = a.last_tested_at ? new Date(a.last_tested_at).getTime() : 0;
          bVal = b.last_tested_at ? new Date(b.last_tested_at).getTime() : 0;
          break;
        case "last_score":
          aVal = a.last_score ?? 0;
          bVal = b.last_score ?? 0;
          break;
        case "last_result":
          aVal = (a.last_result || "").toUpperCase();
          bVal = (b.last_result || "").toUpperCase();
          break;
        case "last_pass_at":
          aVal = a.last_pass_at ? new Date(a.last_pass_at).getTime() : 0;
          bVal = b.last_pass_at ? new Date(b.last_pass_at).getTime() : 0;
          break;
        case "last_fail_at":
          aVal = a.last_fail_at ? new Date(a.last_fail_at).getTime() : 0;
          bVal = b.last_fail_at ? new Date(b.last_fail_at).getTime() : 0;
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  };

  // Compute filteredDetections - must be before hooks that depend on it
  const filteredDetections = sortDetections(detections.filter((d) => {
    const matchesTitle =
      !searchTitle ||
      d.title.toLowerCase().includes(searchTitle.toLowerCase().trim());

    const matchesTechnique =
      !searchTechnique ||
      (d.technique_id || "").toLowerCase().includes(searchTechnique.toLowerCase().trim());

    const matchesSiem =
      !searchSiem ||
      (d.siem_type || "").toLowerCase().includes(searchSiem.toLowerCase().trim());

    const matchesSeverity =
      filterSeverity === "all" ||
      (d.last_result || "N/A").toUpperCase() === filterSeverity.toUpperCase();

    const priorityLabel = getPriorityLabel(d.last_score);
    const matchesPriority =
      filterPriority === "all" ||
      (priorityLabel ? priorityLabel.toLowerCase() === filterPriority : false);

    const healthState = deriveHealthState(d);
    const matchesHealthState =
      filterHealthState === "all" ||
      healthState === filterHealthState;

    const matchesSiemType =
      filterSiemType === "all" ||
      (d.siem_type || "").toUpperCase() === filterSiemType.toUpperCase();

    const status = statusNormalized(d.status);
    const matchesLifecycle =
      lifecycleFilter === "all"
        ? true
        : lifecycleFilter === "AT_RISK"
        ? isAtRisk(d)
        : status === lifecycleFilter;
    const matchesTesting =
      testingFilter === "all"
        ? true
        : testingFilter === "tested"
        ? !!d.last_tested_at
        : !d.last_tested_at;

    return (
      matchesTitle &&
      matchesTechnique &&
      matchesSiem &&
      matchesSeverity &&
      matchesPriority &&
      matchesHealthState &&
      matchesSiemType &&
      matchesLifecycle &&
      matchesTesting
    );
  }));

  // Filter for Detection Catalog: filter by selected time period
  // MUST be after filteredDetections but before conditional returns to follow Rules of Hooks
  const catalogDetections = useMemo(() => {
    if (!now) return []; // Return empty array during SSR/initial render
    if (catalogTimeFilter === "all") return filteredDetections;
    
    let cutoffDate: Date;
    switch (catalogTimeFilter) {
      case "24h":
        cutoffDate = subDays(now, 1);
        break;
      case "7d":
        cutoffDate = subDays(now, 7);
        break;
      case "30d":
        cutoffDate = subDays(now, 30);
        break;
      case "90d":
        cutoffDate = subDays(now, 90);
        break;
      default:
        cutoffDate = subDays(now, 90);
    }
    
    return filteredDetections.filter((d) => {
      if (!d.last_tested_at) return false;
      const testedDate = new Date(d.last_tested_at);
      return isAfter(testedDate, cutoffDate);
    });
  }, [filteredDetections, now, catalogTimeFilter]);

  // Pagination for Detection Catalog (5 per page)
  const itemsPerPage = 5;
  const totalCatalogPages = Math.ceil(catalogDetections.length / itemsPerPage);
  const paginatedCatalogDetections = catalogDetections.slice(
    catalogPage * itemsPerPage,
    (catalogPage + 1) * itemsPerPage
  );

  // Reset to page 0 when filters change - MUST be before conditional returns
  useEffect(() => {
    setCatalogPage(0);
  }, [searchTitle, searchTechnique, searchSiem, filterSeverity, filterPriority, filterHealthState, filterSiemType, testingFilter, lifecycleFilter]);

  if (loading) {
    return (
      <PageContainer>
        <Card className="elite-card">
          <CardContent className="pt-6 text-slate-200">Loading detections…</CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Card className="elite-card">
          <CardContent className="pt-6">
            <p className="text-red-400">{error}</p>
            <p className="text-xs text-slate-500 mt-2">
              Verify the PurveX API is running and then refresh this page.
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const totalDetections = detections.length;
  const validatedDetections = detections.filter((d) => d.last_tested_at).length;
  const neverTestedCount = totalDetections - validatedDetections;

  const draftCount = detections.filter(
    (d) => statusNormalized(d.status) === "DRAFT"
  ).length;
  const activeCount = detections.filter(
    (d) => statusNormalized(d.status) === "ACTIVE"
  ).length;
  const needsImprovementCount = detections.filter(
    (d) => statusNormalized(d.status) === "NEEDS_IMPROVEMENT"
  ).length;
  const retiredCount = detections.filter(
    (d) => statusNormalized(d.status) === "RETIRED"
  ).length;
  const atRiskCount = detections.filter((d) => isAtRisk(d)).length;

  const nowRef = now ?? new Date();

  const lifecycleStages = [
    {
      id: "DRAFT",
      label: "Draft",
      description: "Authored, not yet validated.",
      accent: "sky",
    },
    {
      id: "NEEDS_IMPROVEMENT",
      label: "Staged / Monitor",
      description: "Monitor-only; watching FP/TP and noise.",
      accent: "amber",
    },
    {
      id: "ACTIVE",
      label: "Active",
      description: "Enforced with runbook/owner.",
      accent: "emerald",
    },
    {
      id: "RETIRED",
      label: "Retired / Superseded",
      description: "Disabled or replaced; rationale logged.",
      accent: "slate",
    },
  ];

  const accentMap: Record<
    string,
    {
      iconBg: string;
      iconText: string;
      borderActive: string;
      badge: string;
      badgeMuted: string;
      bar: string;
    }
  > = {
    sky: {
      iconBg: "bg-sky-50",
      iconText: "text-sky-700",
      borderActive: "border-sky-300 shadow-sky-100",
      badge: "bg-sky-50 text-sky-700 border-sky-200",
      badgeMuted: "bg-slate-100 text-slate-600 border-slate-200",
      bar: "bg-sky-400",
    },
    amber: {
      iconBg: "bg-amber-50",
      iconText: "text-amber-700",
      borderActive: "border-amber-300 shadow-amber-100",
      badge: "bg-amber-50 text-amber-800 border-amber-200",
      badgeMuted: "bg-slate-100 text-slate-600 border-slate-200",
      bar: "bg-amber-400",
    },
    emerald: {
      iconBg: "bg-emerald-50",
      iconText: "text-emerald-700",
      borderActive: "border-emerald-300 shadow-emerald-100",
      badge: "bg-emerald-50 text-emerald-800 border-emerald-200",
      badgeMuted: "bg-slate-100 text-slate-600 border-slate-200",
      bar: "bg-emerald-400",
    },
    slate: {
      iconBg: "bg-slate-50",
      iconText: "text-slate-700",
      borderActive: "border-slate-300 shadow-slate-100",
      badge: "bg-slate-100 text-slate-700 border-slate-200",
      badgeMuted: "bg-slate-100 text-slate-600 border-slate-200",
      bar: "bg-slate-400",
    },
  };

  const stageStats = lifecycleStages.map((stage) => {
    const stageItems = detections.filter(
      (d) => statusNormalized(d.status) === stage.id
    );

    const tested = stageItems.filter((d) => !!d.last_tested_at);
    const passed = tested.filter(
      (d) => (d.last_result || "").toUpperCase() === "PASS"
    ).length;
    const failed = tested.filter(
      (d) => (d.last_result || "").toUpperCase() === "FAIL"
    ).length;
    const lastValidatedTs = stageItems.reduce<number | null>((acc, d) => {
      if (!d.last_tested_at) return acc;
      const ts = new Date(d.last_tested_at).getTime();
      return acc === null || ts > acc ? ts : acc;
    }, null);

    // Avoid noisy percentages with very small samples.
    const passRate =
      tested.length >= 3 ? Math.round((passed / tested.length) * 100) : null;

    const stale =
      !!lastValidatedTs && !isAfter(new Date(lastValidatedTs), subDays(nowRef, 30));

    const needsAttention =
      stage.id !== "RETIRED" &&
      (failed > 0 || tested.length === 0 || stale);

    const certified =
      stage.id === "ACTIVE" &&
      stageItems.length > 0 &&
      failed === 0 &&
      tested.length > 0 &&
      !stale;

    return {
      ...stage,
      count:
        stage.id === "DRAFT"
          ? draftCount
          : stage.id === "ACTIVE"
          ? activeCount
          : stage.id === "NEEDS_IMPROVEMENT"
          ? needsImprovementCount
          : retiredCount,
      passRate,
      needsAttention,
      certified,
      lastValidatedLabel: lastValidatedTs
        ? formatRelative(new Date(lastValidatedTs), nowRef)
        : "Never",
      accent: accentMap[stage.accent] || accentMap.slate,
      icon:
        stage.id === "DRAFT"
          ? Activity
          : stage.id === "ACTIVE"
          ? CheckSquare
          : stage.id === "NEEDS_IMPROVEMENT"
          ? AlertTriangle
          : Square,
    };
  });
  const healthyCount = detections.filter((d) => {
    const healthState = deriveHealthState(d);
    return healthState === "HEALTHY";
  }).length;

  // Keep lifecycle logic in code for future reuse, but hide the UI block per request.
  const showLifecycleStages = false;

  const handleSort = (field: "title" | "technique_id" | "last_tested_at" | "last_score" | "last_result" | "last_pass_at" | "last_fail_at") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    const matchesText =
      !alertSearch ||
      a.name.toLowerCase().includes(alertSearch.toLowerCase().trim()) ||
      (a.host || "").toLowerCase().includes(alertSearch.toLowerCase().trim());

    const matchesSeverity =
      alertSeverityFilter === "all" ||
      (a.severity || "").toLowerCase() === alertSeverityFilter.toLowerCase();

    return matchesText && matchesSeverity;
  });

  const isLifecycleFiltered = lifecycleFilter !== "all";
  const isOtherFiltered =
    !!searchTitle ||
    !!searchTechnique ||
    !!searchSiem ||
    filterSeverity !== "all" ||
    filterPriority !== "all" ||
    filterHealthState !== "all" ||
    filterSiemType !== "all" ||
    testingFilter !== "all";

  const activeFilterCount = [
    searchTitle ? 1 : 0,
    searchTechnique ? 1 : 0,
    searchSiem ? 1 : 0,
    filterSeverity !== "all" ? 1 : 0,
    filterPriority !== "all" ? 1 : 0,
    filterHealthState !== "all" ? 1 : 0,
    filterSiemType !== "all" ? 1 : 0,
    testingFilter !== "all" ? 1 : 0,
    lifecycleFilter !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearAllFilters = () => {
    setSearchTitle("");
    setSearchTechnique("");
    setSearchSiem("");
    setFilterSeverity("all");
    setFilterPriority("all");
    setFilterHealthState("all");
    setFilterSiemType("all");
    setTestingFilter("all");
    setLifecycleFilter("all");
  };

  // Bulk actions
  const handleSelectAll = () => {
    if (selectedDetections.size === filteredDetections.length) {
      setSelectedDetections(new Set());
    } else {
      setSelectedDetections(new Set(filteredDetections.map(d => d.id)));
    }
  };

  const handleSelectDetection = (id: string) => {
    const newSelected = new Set(selectedDetections);
    const detection = detections.find(d => d.id === id);
    
    if (newSelected.has(id)) {
      newSelected.delete(id);
      // If this was the selected detection, clear it
      if (selectedDetection?.id === id) {
        setSelectedDetection(null);
        setAlerts([]);
        setSidebarOpen(false);
      }
    } else {
      newSelected.add(id);
      // Select this detection for details view
      if (detection) {
        setSelectedDetection(detection);
        setSidebarOpen(true);
        void loadAlertsForDetection(detection);
      }
    }
    setSelectedDetections(newSelected);
  };

  const handleExport = () => {
    const selected = filteredDetections.filter(d => selectedDetections.has(d.id));
    const dataToExport = selected.length > 0 ? selected : filteredDetections;
    
    const csv = [
      ["ID", "Title", "Technique ID", "SIEM Type", "Status", "Health Score", "Last Tested", "Last Result"].join(","),
      ...dataToExport.map(d => [
        d.id,
        `"${(d.title || "").replace(/"/g, '""')}"`,
        d.technique_id || "",
        d.siem_type || "",
        d.status || "",
        d.last_score?.toString() || "",
        d.last_tested_at || "",
        d.last_result || "",
      ].join(","))
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `detections-${format(now || new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allSelected = filteredDetections.length > 0 && selectedDetections.size === filteredDetections.length;
  const someSelected = selectedDetections.size > 0 && selectedDetections.size < filteredDetections.length;

  return (
    <div className="min-h-screen flex flex-col" role="main" aria-label="Detection Workspace">
      {/* Screen reader announcements */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
          </div>

      {/* Unified hero header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-1 pb-6">
        <PageHeader
          title="Detection Workspace"
          subtitle="Manage and validate your detection engineering portfolio"
        />
      </div>

      {/* Main Content Area - Dynamic Layout */}
      <div className="flex-1 w-full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="flex gap-6">
            <div className="flex-1 space-y-6">
              {/* Workspace Summary Section */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <Link href="/detections/inventory" className="block h-full">
                  <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                    <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-6">
                      <div className="space-y-1">
                        <p className="text-xs font-display font-semibold text-slate-500 uppercase tracking-wider">Inventory</p>
                        <p className="text-sm text-slate-600">Browse all detections</p>
                      </div>
                      <div className="h-12 w-12 rounded-xl bg-blue-50 border-2 border-blue-200 flex items-center justify-center shadow-sm">
                        <Shield className="h-6 w-6 text-blue-500" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/mitre" className="block h-full">
                  <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                    <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-6">
                      <div className="space-y-1">
                        <p className="text-xs font-display font-semibold text-slate-500 uppercase tracking-wider">MITRE Coverage</p>
                        <p className="text-sm text-slate-600">View ATT&CK coverage</p>
                      </div>
                      <div className="h-12 w-12 rounded-xl bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center shadow-sm">
                        <Target className="h-6 w-6 text-emerald-600" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                <Link href="/events" className="block h-full">
                  <Card className="h-full border border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm">
                    <CardContent className="h-full flex items-center justify-between gap-4 px-5 py-6">
                      <div className="space-y-1">
                        <p className="text-xs font-display font-semibold text-slate-500 uppercase tracking-wider">Events</p>
                        <p className="text-sm text-slate-600">Review events and related tests</p>
                      </div>
                      <div className="h-12 w-12 rounded-xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center shadow-sm">
                        <AlertTriangle className="h-6 w-6 text-amber-600" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </div>

              {/* Filter Banner - Show when filters are active */}
              {activeFilterCount > 0 && catalogDetections.length === 0 && (
                <div className="mb-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 backdrop-blur-sm flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                    <p className="text-sm text-amber-200">
                      Results filtered by {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""} — 
                      <button 
                        onClick={clearAllFilters}
                        className="ml-1 underline hover:text-amber-100 font-medium"
                      >
                        click to clear
                      </button>
                    </p>
                  </div>
                </div>
              )}

              {/* Filters Section - Unique Card Design */}
              <div className="grid grid-cols-1 gap-4 w-full flex-shrink-0">
                {showLifecycleStages && (
                  <Card
                    className="overflow-hidden border border-slate-200 bg-white shadow-sm w-full"
                    data-tour="lifecycle-filter"
                  >
                    <CardHeader className="pb-3 border-b border-slate-200">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <div className="h-9 w-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                            <Activity className="h-4 w-4 text-slate-700" />
                          </div>
                          <div>
                            <CardTitle className="text-base font-display font-semibold text-slate-900">
                              Lifecycle Stages
                            </CardTitle>
                            <p className="text-xs font-body text-slate-500 mt-0.5">
                              Track progress and tune detections by stage
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setLifecycleFilter("all")}
                          className="h-8 px-3 text-xs text-slate-700 hover:bg-slate-100"
                          aria-label="Show all lifecycle stages"
                        >
                          Show all
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {stageStats.map((stage, idx) => {
                          const Icon = stage.icon;
                          const isActive = lifecycleFilter === stage.id;
                          const accent = stage.accent;
                          return (
                            <div
                              key={stage.id}
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                setLifecycleFilter(
                                  stage.id as typeof lifecycleFilter
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setLifecycleFilter(
                                    stage.id as typeof lifecycleFilter
                                  );
                                }
                              }}
                              aria-label={`Filter by ${stage.label} (${stage.count} detections)`}
                              aria-pressed={isActive}
                              className={cn(
                                "group relative w-full text-left rounded-xl border transition-all duration-200 bg-white cursor-pointer",
                                "hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2",
                                isActive
                                  ? `border ${accent.borderActive} shadow-lg`
                                  : "border-slate-200"
                              )}
                              style={{ animationDelay: `${idx * 40}ms` }}
                            >
                              <div className="relative z-10 p-4 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div
                                    className={cn(
                                      "h-9 w-9 rounded-lg flex items-center justify-center border",
                                      accent.iconBg,
                                      isActive
                                        ? accent.borderActive
                                        : "border-slate-200"
                                    )}
                                  >
                                    <Icon
                                      className={cn(
                                        "h-4 w-4",
                                        accent.iconText,
                                        isActive && "opacity-90"
                                      )}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {stage.certified && (
                                      <Badge className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        Certified
                                      </Badge>
                                    )}
                                    {stage.needsAttention && (
                                      <Badge className="text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                                        Needs attention
                                      </Badge>
                                    )}
                                    <Badge
                                      className={cn(
                                        "text-[11px] font-bold px-2 py-0.5 border",
                                        isActive ? accent.badge : accent.badgeMuted
                                      )}
                                    >
                                      {stage.count}
                                    </Badge>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {stage.label}
                                  </p>
                                  <p className="text-xs text-slate-600 leading-relaxed">
                                    {stage.description}
                                  </p>
                                </div>
                                <div className="flex items-center justify-between text-xs text-slate-600">
                                  <div className="flex items-center gap-2">
                                    <Clock className="h-3.5 w-3.5 text-slate-400" />
                                    <span>
                                      Last validated: {stage.lastValidatedLabel}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
                                    <span>
                                      {stage.passRate !== null
                                        ? `Pass rate: ${stage.passRate}%`
                                        : "Pass rate: n/a"}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 pt-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 px-3 text-xs border-slate-200 text-slate-800 hover:border-slate-300"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setLifecycleFilter(
                                        stage.id as typeof lifecycleFilter
                                      );
                                    }}
                                  >
                                    View items
                                  </Button>
                                  <Link href="/tests">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 px-3 text-xs text-indigo-700 hover:bg-indigo-50"
                                    >
                                      Run validation
                                    </Button>
                                  </Link>
                                </div>
                              </div>
                              {isActive && (
                                <div className={cn("absolute bottom-0 left-0 right-0 h-1", accent.bar)} />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Detection Catalog - Enhanced & Seamless */}
              <div className="mt-2">
                  {/* Detection Catalog - Table Widget */}
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-3">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-indigo-300" />
                        <CardTitle className="text-base font-display font-semibold text-slate-100">
                          Detection Catalog
                        </CardTitle>
                        {catalogDetections.length > 0 && (
                          <Badge className="text-[10px] px-1.5 py-0 bg-slate-800/50 text-slate-400">
                            {catalogDetections.length}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedDetections.size > 0 && selectedDetection && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            className="h-7 px-2 text-xs"
                            title={sidebarOpen ? "Hide Details" : "Show Details"}
                          >
                            {sidebarOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                        {selectedDetections.size > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleExport}
                            className="h-7 px-2 text-xs"
                          >
                            <Download className="h-3.5 w-3.5 mr-1" />
                            Export ({selectedDetections.size})
                          </Button>
                        )}
                        <Select value={catalogTimeFilter} onValueChange={(value: "24h" | "7d" | "30d" | "90d" | "all") => setCatalogTimeFilter(value)}>
                          <SelectTrigger className="h-9 w-[140px] text-xs bg-white border-slate-200 text-slate-900 hover:border-indigo-200 hover:bg-indigo-50">
                            <Clock className="h-3.5 w-3.5 mr-1.5 text-slate-500" />
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white border border-slate-200 shadow-lg">
                            <SelectItem value="24h" className="text-xs">24h</SelectItem>
                            <SelectItem value="7d" className="text-xs">7d</SelectItem>
                            <SelectItem value="30d" className="text-xs">30d</SelectItem>
                            <SelectItem value="90d" className="text-xs">90d</SelectItem>
                            <SelectItem value="all" className="text-xs">All</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {catalogDetections.length === 0 ? (
                        <div className="p-12 text-center" role="status" aria-live="polite">
                          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted/30 mb-4">
                            <AlertTriangle className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                          </div>
                          <h3 className="text-lg font-semibold text-foreground mb-2">No detections found</h3>
                          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
                            {catalogTimeFilter === "all" 
                              ? "No detections have been tested yet." 
                              : `No detections tested ${catalogTimeFilter === "24h" ? "in the last 24 hours" : catalogTimeFilter === "7d" ? "in the last 7 days" : catalogTimeFilter === "30d" ? "in the last 30 days" : "in the last 90 days"}.`}
                          </p>
                          {activeFilterCount > 0 && (
                            <Button variant="outline" onClick={clearAllFilters} className="mt-2">
                              Clear Filters
                            </Button>
                          )}
                        </div>
                      ) : (
                    <>
                    <div className={cn(
                      "w-full transition-all duration-300 flex-1 overflow-y-auto overflow-x-hidden",
                      "hide-scrollbar"
                    )}>
                      <div className="overflow-y-auto overflow-x-hidden hide-scrollbar">
                      <Table className="w-full" data-tour="detection-table">
                    <TableHeader>
                          <TableRow className="border-slate-200 bg-slate-50">
                            <TableHead className="w-[40px] px-3 py-2">
                              <Checkbox
                                checked={paginatedCatalogDetections.length > 0 && paginatedCatalogDetections.every(d => selectedDetections.has(d.id))}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    const newSelected = new Set(selectedDetections);
                                    paginatedCatalogDetections.forEach(d => newSelected.add(d.id));
                                    setSelectedDetections(newSelected);
                                  } else {
                                    const newSelected = new Set(selectedDetections);
                                    paginatedCatalogDetections.forEach(d => newSelected.delete(d.id));
                                    setSelectedDetections(newSelected);
                                  }
                                }}
                                className="data-[state=checked]:bg-emerald-500"
                              />
                        </TableHead>
                            <TableHead className="text-xs font-display text-slate-400 font-semibold uppercase tracking-wider px-3 py-2 min-w-[180px]">Detection</TableHead>
                            <TableHead className="text-xs font-display text-slate-400 font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleSort("last_result")}
                                className="flex items-center gap-1.5 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded px-1 py-0.5"
                                aria-label={`Sort by Last Result ${sortField === "last_result" ? (sortDirection === "asc" ? "ascending" : "descending") : ""}`}
                                aria-sort={sortField === "last_result" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                              >
                                Last Result
                                <ArrowUpDown className="h-3.5 w-3.5" />
                              </button>
                        </TableHead>
                            <TableHead className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider px-2 py-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleSort("last_score")}
                                className="flex items-center gap-1.5 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded px-1 py-0.5"
                                aria-label={`Sort by Health Score ${sortField === "last_score" ? (sortDirection === "asc" ? "ascending" : "descending") : ""}`}
                                aria-sort={sortField === "last_score" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                              >
                                Health Score
                                <ArrowUpDown className="h-3.5 w-3.5" />
                              </button>
                            </TableHead>
                            <TableHead className="text-xs font-display text-slate-400 font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Health State</TableHead>
                            <TableHead className="text-xs font-display text-slate-400 font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleSort("last_tested_at")}
                                className="flex items-center gap-1.5 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded px-1 py-0.5"
                                aria-label={`Sort by Last Tested ${sortField === "last_tested_at" ? (sortDirection === "asc" ? "ascending" : "descending") : ""}`}
                                aria-sort={sortField === "last_tested_at" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                              >
                                Last Tested
                                <ArrowUpDown className="h-3.5 w-3.5" />
                              </button>
                            </TableHead>
                            <TableHead className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider px-2 py-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleSort("last_pass_at")}
                                className="flex items-center gap-1.5 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded px-1 py-0.5"
                                aria-label={`Sort by Last Pass ${sortField === "last_pass_at" ? (sortDirection === "asc" ? "ascending" : "descending") : ""}`}
                                aria-sort={sortField === "last_pass_at" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                              >
                                Last Pass
                                <ArrowUpDown className="h-3.5 w-3.5" />
                              </button>
                            </TableHead>
                            <TableHead className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider px-2 py-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => handleSort("last_fail_at")}
                                className="flex items-center gap-1.5 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 rounded px-1 py-0.5"
                                aria-label={`Sort by Last Fail ${sortField === "last_fail_at" ? (sortDirection === "asc" ? "ascending" : "descending") : ""}`}
                                aria-sort={sortField === "last_fail_at" ? (sortDirection === "asc" ? "ascending" : "descending") : "none"}
                              >
                                Last Fail
                                <ArrowUpDown className="h-3.5 w-3.5" />
                              </button>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedCatalogDetections.map((detection, index) => {
                        const isSelected = selectedDetection?.id === detection.id;
                        const healthState = deriveHealthState(detection);
                            
                        return (
                          <TableRow
                            key={detection.id}
                                className={cn(
                                  "border-slate-200 bg-white cursor-pointer transition-colors duration-150",
                                  "hover:bg-slate-50 focus-within:bg-slate-50 focus-within:ring-2 focus-within:ring-indigo-200",
                                  isSelected && "border-l-4 border-l-indigo-400 bg-indigo-50 shadow-sm",
                                  "animate-fade-in-scale"
                                )}
                                style={{ animationDelay: `${index * 30}ms` }}
                            onClick={() => {
                              // Toggle checkbox selection when clicking row
                              handleSelectDetection(detection.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleSelectDetection(detection.id);
                              }
                            }}
                            role="button"
                            tabIndex={0}
                            aria-label={`Select ${detection.title}, ${healthState} health state`}
                            aria-selected={isSelected}
                          >
                                <TableCell className="w-[40px] px-3 py-2">
                                  <Checkbox
                                    checked={selectedDetections.has(detection.id)}
                                    onCheckedChange={() => handleSelectDetection(detection.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="data-[state=checked]:bg-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/50 transition-all duration-200"
                                    aria-label={`Select ${detection.title}`}
                                  />
                                </TableCell>
                                <TableCell className="px-3 py-2.5">
                                  <div className="flex flex-col gap-1.5">
                                    <span className="font-semibold text-slate-900 text-sm leading-tight">{detection.title}</span>
                                    <div className="flex items-center gap-2 text-xs text-slate-600">
                                      {detection.technique_id && (
                                        <span className="font-mono text-slate-700">{detection.technique_id}</span>
                                      )}
                                      {detection.technique_id && detection.siem_type && (
                                        <span className="text-slate-500">·</span>
                                      )}
                                      {detection.siem_type && (
                                        <span className="uppercase text-slate-700">{detection.siem_type}</span>
                                )}
                                    </div>
                                  </div>
                            </TableCell>
                                <TableCell className="px-3 py-2.5 whitespace-nowrap">
                                  {detection.last_result ? (
                                    <Badge className={cn(
                                      "text-xs font-semibold px-2 py-0.5",
                                      detection.last_result === "PASS" && "bg-emerald-50 text-emerald-700 border border-emerald-200",
                                      detection.last_result === "FAIL" && "bg-red-50 text-red-700 border border-red-200",
                                      detection.last_result === "INCONCLUSIVE" && "bg-amber-50 text-amber-700 border border-amber-200",
                                      !["PASS", "FAIL", "INCONCLUSIVE"].includes(detection.last_result) && "bg-slate-100 text-slate-700 border border-slate-200"
                                    )}>
                                      {detection.last_result}
                                    </Badge>
                                  ) : (
                                    <span className="text-slate-500 text-xs font-medium">Never tested</span>
                                  )}
                            </TableCell>
                                <TableCell className="px-3 py-2.5 whitespace-nowrap">
                                  <div className="flex items-center gap-2">
                                    {typeof detection.last_score === "number" ? (
                                      <>
                                        <span className={cn(
                                          "text-sm font-bold",
                                          detection.last_score >= 80 && "text-emerald-400",
                                          detection.last_score >= 50 && detection.last_score < 80 && "text-amber-400",
                                          detection.last_score < 50 && "text-red-400"
                                        )}>
                                          {detection.last_score}
                                </span>
                                        <span className="text-xs text-slate-500">/100</span>
                                      </>
                                    ) : (
                                      <span className="text-slate-500 text-xs font-medium">N/A</span>
                                    )}
                              </div>
                            </TableCell>
                                <TableCell className="px-3 py-2.5 whitespace-nowrap">
                                  <Badge className={cn(getHealthBadgeClass(healthState), "text-xs font-semibold px-2 py-0.5")}>
                                    {getHealthLabel(healthState)}
                              </Badge>
                            </TableCell>
                                <TableCell className="text-slate-400 text-xs font-body px-3 py-2.5 font-medium whitespace-nowrap">
                              {detection.last_tested_at
                                    ? now ? formatRelative(new Date(detection.last_tested_at), now) : format(new Date(detection.last_tested_at), "MMM dd, yyyy")
                                : "Never"}
                            </TableCell>
                                <TableCell className="text-slate-400 text-xs font-body px-3 py-2.5 font-medium whitespace-nowrap">
                                  {detection.last_pass_at
                                    ? now ? formatRelative(new Date(detection.last_pass_at), now) : format(new Date(detection.last_pass_at), "MMM dd, yyyy")
                                    : "—"}
                                </TableCell>
                                <TableCell className="text-slate-400 text-xs font-body px-3 py-2.5 font-medium whitespace-nowrap">
                                  {detection.last_fail_at
                                    ? now ? formatRelative(new Date(detection.last_fail_at), now) : format(new Date(detection.last_fail_at), "MMM dd, yyyy")
                                    : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                      </div>
                </div>
                      {/* Pagination Controls */}
                      {catalogDetections.length > itemsPerPage && (
                        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-slate-800/50">
                          <div className="text-sm text-slate-400">
                            Showing {catalogPage * itemsPerPage + 1}-{Math.min((catalogPage + 1) * itemsPerPage, catalogDetections.length)} of {catalogDetections.length} detections
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCatalogPage((p) => Math.max(0, p - 1))}
                              disabled={catalogPage === 0}
                              className="h-8 w-8 p-0 focus-visible:ring-2 focus-visible:ring-indigo-500/50 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Previous page"
                              aria-label="Go to previous page"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <div className="text-sm text-slate-400 px-3">
                              Page {catalogPage + 1} of {totalCatalogPages}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCatalogPage((p) => Math.min(totalCatalogPages - 1, p + 1))}
                              disabled={catalogPage >= totalCatalogPages - 1}
                              className="h-8 w-8 p-0 focus-visible:ring-2 focus-visible:ring-indigo-500/50 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Next page"
                              aria-label="Go to next page"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          </div>

        {/* Backdrop overlay when panel is open */}
        {selectedDetection && sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300"
            onClick={() => {
              setSelectedDetection(null);
              setAlerts([]);
              setSidebarOpen(false);
            }}
          />
        )}

        {/* Right Panel - Detail View - Slide in from the right side */}
        <div className={cn(
          "fixed right-0 top-0 bottom-0 border-l border-slate-200 bg-white shadow-2xl overflow-hidden z-50",
          selectedDetection && sidebarOpen
            ? "w-[420px] opacity-100 visible flex flex-col min-h-0" 
            : "w-0 opacity-0 invisible pointer-events-none border-0"
        )}
        style={{
          transform: selectedDetection && sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1), width 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease-in-out',
        }}>
          {selectedDetection && sidebarOpen && (
            <div className="flex-1 overflow-y-auto overflow-x-hidden hide-scrollbar p-4 sm:p-5 lg:p-6 relative z-10 min-h-0">
              {(() => {
                const healthState = deriveHealthState(selectedDetection);
                const narrative = getHealthNarrative(healthState);
                const HealthIcon = healthState === "HEALTHY" ? CheckCircle2 : healthState === "DETECTION_FAILED" ? XCircle : healthState === "TELEMETRY_MISSING" ? AlertTriangle : Clock;
                
                return (
                  <div className="space-y-6">
                    {/* Close Button */}
                    <div className="flex justify-end mb-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedDetection(null);
                          setAlerts([]);
                          setSidebarOpen(false);
                        }}
                        className="h-8 w-8 p-0 hover:bg-slate-100 rounded-lg border border-slate-200"
                        title="Close"
                      >
                        <X className="h-4 w-4 text-slate-600" />
                      </Button>
                    </div>

                    {/* Header Section */}
                    <div className="pb-5 border-b border-slate-200">
                      <div className="flex items-start gap-4 mb-4">
                        <div className={cn(
                          "h-12 w-12 rounded-xl flex items-center justify-center shadow-lg transition-all",
                          getHealthBadgeClass(healthState)
                        )}>
                          <HealthIcon className="h-6 w-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="text-lg font-display font-bold text-slate-900 mb-2 leading-tight">
                            {selectedDetection.title}
                          </h3>
                          <div className="flex items-center gap-2.5 text-xs text-slate-600">
                            <span className="font-mono bg-slate-100 px-2 py-1 rounded border border-slate-200 text-slate-700">{selectedDetection.technique_id}</span>
                            <span className="text-slate-400">·</span>
                            <span className="uppercase bg-slate-100 px-2 py-1 rounded border border-slate-200 text-slate-700">{selectedDetection.siem_type}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors shadow-sm">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 font-semibold">Last Test</div>
                        <div className="text-base font-bold text-slate-900">
                          {selectedDetection.last_tested_at
                            ? now ? formatRelative(new Date(selectedDetection.last_tested_at), now) : format(new Date(selectedDetection.last_tested_at), "MMM dd, yyyy")
                            : "Never"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors shadow-sm">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 font-semibold">Score</div>
                        <div className="text-base font-bold text-slate-900">
                          {selectedDetection.last_score ?? "N/A"}
                        </div>
                      </div>
                    </div>

                    {/* Health Narrative */}
                    <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5 shadow-sm">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                          <Zap className="h-3 w-3" />
                          What This Means
                        </div>
                        <p className="text-sm font-semibold text-slate-900 mb-2">{narrative.headline}</p>
                        <p className="text-xs text-slate-600 leading-relaxed">{narrative.detail}</p>
                      </div>
                      <div className="pt-3 border-t border-slate-200">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Recommended Action</div>
                        <p className="text-xs text-slate-700 leading-relaxed">{narrative.action}</p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3 pt-2">
                      <Link href={`/detections/${selectedDetection.id}`}>
                        <Button variant="outline" className="w-full border-slate-200 text-slate-700 hover:bg-slate-50">
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                      </Button>
                    </Link>
                    <Link href={`/run-test?detectionId=${selectedDetection.id}`}>
                      <Button variant="outline" className="w-full border-slate-200 text-slate-700 hover:bg-slate-50">
                        <Play className="h-4 w-4 mr-2" />
                        Re-run Validation
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      className="w-full border-slate-200 text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          window.location.href = `/agent?detectionId=${selectedDetection.id}`;
                          }
                        }}
                      >
                        <Cpu className="h-4 w-4 mr-2" />
                        AI Insights
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DetectionsPage() {
  return <DetectionsPageContent />;
}
