"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMitreCoverage, getMitreTechniques, type MitreTechnique } from "@/lib/api";
import { 
  Loader2, 
  Clock,
  Search,
  Target,
  Filter,
  ArrowRight,
  Shield,
  Grid3x3,
  List,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

interface MitreCoverageItem {
  technique_id: string;
  last_result?: string;
  last_score?: number;
  tactics?: string[];
  name?: string;
}

function getResultBadgeClass(result?: string) {
  switch (result) {
    case "PASS":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40";
    case "FAIL":
      return "bg-red-500/15 text-red-300 border border-red-500/40";
    case "INCONCLUSIVE":
      return "bg-orange-500/15 text-orange-300 border border-orange-500/40";
    default:
      return "bg-slate-700/40 text-slate-200 border border-slate-600/60";
  }
}


function MitreViewPageContent() {
  const [coverage, setCoverage] = useState<MitreCoverageItem[]>([]);
  const [mitreTechniques, setMitreTechniques] = useState<MitreTechnique[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "healthy" | "failed" | "missing" | "untested"
  >("all");
  const [tacticFilter, setTacticFilter] = useState<string>("all");
  const [techniqueFilter, setTechniqueFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"grid" | "heatmap">("grid");
  const [carouselPosition, setCarouselPosition] = useState(0);
  const [heatmapCarouselPosition, setHeatmapCarouselPosition] = useState(0);
  const searchParams = useSearchParams();
  const router = useRouter();
  const focus = searchParams.get("focus");

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [coverageData, techniquesData] = await Promise.all([
          getMitreCoverage().catch(() => []), // Return empty array if API not available
          getMitreTechniques(),
        ]);
        setCoverage(coverageData);
        setMitreTechniques(techniquesData);
      } catch (err: any) {
        setError(err.message || "Failed to load MITRE data.");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Reset carousel position when filters change
  useEffect(() => {
    setCarouselPosition(0);
    setHeatmapCarouselPosition(0);
  }, [searchQuery, statusFilter, tacticFilter, techniqueFilter, viewMode]);

  const getTechniqueStatus = (
    item: MitreCoverageItem,
  ): "healthy" | "failed" | "missing" | "untested" => {
    const res = (item.last_result || "").toUpperCase();
    if (!item.last_result) return "untested";
    if (res === "PASS") return "healthy";
    if (res === "FAIL") return "failed";
    return "missing";
  };

  const hasAnyRuns = coverage.some((c) => c.last_result);

  // Build coverage map for quick lookup
  const coverageMap = new Map<string, MitreCoverageItem>();
  coverage.forEach((item) => {
    coverageMap.set(item.technique_id, item);
  });

  // Get all unique tactics
  const allTactics = Array.from(
    new Set(mitreTechniques.flatMap((t) => t.tactics))
  ).sort();

  // Create enriched coverage from ALL techniques in catalog, not just those with coverage
  const enrichedCoverage = mitreTechniques.map((tech) => {
    const coverageItem = coverageMap.get(tech.id);
    return {
      technique_id: tech.id,
      last_result: coverageItem?.last_result,
      last_score: coverageItem?.last_score,
      tactics: tech.tactics || [],
      name: tech.name || tech.id,
    };
  });

  // Filter coverage based on focus, search, status, tactic, and technique
  let filteredCoverage = enrichedCoverage;
  
  if (focus === "uncovered") {
    filteredCoverage = filteredCoverage.filter(
      (item) => getTechniqueStatus(item) !== "healthy",
    );
  }

  if (statusFilter !== "all") {
    filteredCoverage = filteredCoverage.filter(
      (item) => getTechniqueStatus(item) === statusFilter,
    );
  }

  if (tacticFilter !== "all") {
    filteredCoverage = filteredCoverage.filter((item) =>
      item.tactics.includes(tacticFilter),
    );
  }

  if (techniqueFilter !== "all") {
    filteredCoverage = filteredCoverage.filter(
      (item) => item.technique_id === techniqueFilter,
    );
  }

  if (searchQuery.trim()) {
    const query = searchQuery.toLowerCase();
    filteredCoverage = filteredCoverage.filter(
      (item) =>
        item.technique_id.toLowerCase().includes(query) ||
        item.name.toLowerCase().includes(query),
    );
  }

  // Calculate stats from enriched coverage (all techniques)
  const totalTechniques = enrichedCoverage.length;
  const testedTechniques = enrichedCoverage.filter(
    (t) => getTechniqueStatus(t) !== "untested",
  ).length;
  const healthyTechniques = enrichedCoverage.filter(
    (t) => getTechniqueStatus(t) === "healthy",
  ).length;
  const untestedTechniques = enrichedCoverage.filter(
    (t) => getTechniqueStatus(t) === "untested",
  ).length;
  const coveragePercent = totalTechniques > 0 
    ? Math.round((healthyTechniques / totalTechniques) * 100)
    : 0;

  // Build heat map data by tactic
  const heatMapData = allTactics.map((tactic) => {
    const techniquesInTactic = enrichedCoverage.filter((item) =>
      item.tactics?.includes(tactic)
    );
    const healthy = techniquesInTactic.filter(
      (t) => getTechniqueStatus(t) === "healthy"
    ).length;
    const atRisk = techniquesInTactic.filter((t) => {
      const status = getTechniqueStatus(t);
      return status === "failed" || status === "missing";
    }).length;
    const untested = techniquesInTactic.filter(
      (t) => getTechniqueStatus(t) === "untested"
    ).length;
    const total = techniquesInTactic.length;
    const coverage = total > 0 ? Math.round((healthy / total) * 100) : 0;

    return {
      tactic,
      total,
      healthy,
      atRisk,
      untested,
      coverage,
      techniques: techniquesInTactic,
    };
  }).filter((item) => item.total > 0); // Only show tactics with techniques

  // Sort: untested first, then failed, then missing, then healthy
  const sortedCoverage = [...filteredCoverage].sort((a, b) => {
    const statusA = getTechniqueStatus(a);
    const statusB = getTechniqueStatus(b);
    const priority: Record<string, number> = {
      untested: 0,
      failed: 1,
      missing: 2,
      healthy: 3,
    };
    return priority[statusA] - priority[statusB];
  });

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="pt-6">
            <p className="text-red-400">Error loading MITRE coverage: {error}</p>
            <p className="mt-2 text-sm text-slate-400">
              Verify the PurveX API is running and try again.
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="full" className="p-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
          <PageHeader
            title="MITRE Coverage"
            subtitle="Track validated techniques, gaps, and test readiness across the ATT&CK catalog."
          />
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 mb-4">
            <Card className="border border-slate-200 bg-white shadow-sm">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Coverage</p>
                    <p className="text-3xl font-display font-bold mt-1.5 text-slate-900">
                      {hasAnyRuns ? `${coveragePercent}%` : "—"}
                    </p>
                    <p className="text-xs text-slate-600 mt-1.5">
                      {hasAnyRuns ? "Validated techniques" : "No tests run yet"}
                    </p>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
                    <Shield className="h-6 w-6 text-blue-500" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200 bg-white shadow-sm">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Untested</p>
                    <p className="text-3xl font-display font-bold mt-1.5 text-slate-900">
                      {untestedTechniques}
                    </p>
                    <p className="text-xs text-slate-600 mt-1.5">Awaiting validation</p>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                    <Clock className="h-6 w-6 text-slate-500" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

      {/* Filters and Search */}
      <Card className="mb-6 border border-slate-200 bg-white shadow-sm">
        <CardContent className="pt-6">
          <div className="space-y-4">
            {/* Search and View Mode */}
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search techniques (e.g., T1055, T1003)..."
                  className="pl-10 bg-white border-slate-200 text-slate-900 placeholder:text-slate-500"
                  aria-label="Search MITRE techniques"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === "grid" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("grid")}
                  className={cn(
                    "h-9",
                    viewMode === "grid"
                      ? "bg-white text-slate-900 border-slate-300 shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <List className="h-4 w-4 mr-2" />
                  Grid
                </Button>
                <Button
                  variant={viewMode === "heatmap" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("heatmap")}
                  className={cn(
                    "h-9",
                    viewMode === "heatmap"
                      ? "bg-white text-slate-900 border-slate-300 shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  <Grid3x3 className="h-4 w-4 mr-2" />
                  Heat Map
                </Button>
            </div>
            </div>

            {/* Filter Row */}
            <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-400">Status:</span>
                <Select
                  value={statusFilter}
                  onValueChange={(value: "all" | "healthy" | "failed" | "missing" | "untested") =>
                    setStatusFilter(value)
                  }
                >
                  <SelectTrigger className="w-[160px] h-8 bg-white border-slate-200 text-xs text-slate-800">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="healthy">Healthy</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="missing">Missing</SelectItem>
                    <SelectItem value="untested">Untested</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">Tactic:</span>
                <Select value={tacticFilter} onValueChange={setTacticFilter}>
                  <SelectTrigger className="w-[180px] h-8 bg-white border-slate-200 text-xs text-slate-800">
                    <SelectValue placeholder="All tactics" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200">
                    <SelectItem value="all">All tactics</SelectItem>
                    {allTactics.map((tactic) => (
                      <SelectItem key={tactic} value={tactic}>
                        {tactic}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-400">Technique:</span>
                <Select value={techniqueFilter} onValueChange={setTechniqueFilter}>
                  <SelectTrigger className="w-[180px] h-8 bg-white border-slate-200 text-xs text-slate-800">
                    <SelectValue placeholder="All techniques" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-slate-200 max-h-[300px]">
                    <SelectItem value="all">All techniques</SelectItem>
                    {mitreTechniques
                      .map((tech) => tech.id)
                      .sort()
                      .map((techId) => {
                        const tech = mitreTechniques.find((t) => t.id === techId);
                        return (
                          <SelectItem key={techId} value={techId}>
                            {techId} {tech?.name ? `- ${tech.name.substring(0, 40)}` : ""}
                          </SelectItem>
                        );
                      })}
                  </SelectContent>
                </Select>
          </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Heat Map or Grid View */}
      {viewMode === "heatmap" ? (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-200 pb-4">
            <CardTitle className="text-xl font-display font-bold text-slate-900">Coverage Heatmap by Tactic</CardTitle>
            <CardDescription className="mt-1.5 font-body text-sm text-slate-600">
              Visual overview of coverage across MITRE ATT&CK tactics
            </CardDescription>
          </CardHeader>
          <CardContent>
            {heatMapData.length === 0 ? (
              <div className="py-12 text-center">
                <Grid3x3 className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                <p className="text-slate-600">No tactic data available</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Legend */}
                <div className="flex items-center justify-center gap-6 flex-wrap pb-4 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-emerald-500/80 border border-emerald-300" />
                    <span className="text-xs text-slate-700">Healthy</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-amber-400/80 border border-amber-300" />
                    <span className="text-xs text-slate-700">At Risk</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded bg-slate-300/80 border border-slate-200" />
                    <span className="text-xs text-slate-700">Untested</span>
        </div>
      </div>

                {/* Heat Map Carousel */}
                <div className="relative">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {heatMapData
                      .slice(
                        heatmapCarouselPosition * 6,
                        heatmapCarouselPosition * 6 + 6
                      )
                      .map((cardTacticData) => (
                        <Card
                          key={cardTacticData.tactic}
                          className="cursor-pointer hover:border-indigo-200 hover:shadow-md transition-all group border border-slate-200 bg-white"
                          onClick={() => {
                            setTacticFilter(cardTacticData.tactic);
                            setViewMode("grid");
                          }}
                        >
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between gap-3">
                              <CardTitle className="text-lg font-semibold text-slate-900 font-display group-hover:text-indigo-700 transition-colors flex-1">
                                {cardTacticData.tactic}
              </CardTitle>
                              <div className="flex flex-col items-end gap-1">
                                <span className="text-2xl font-bold text-slate-900">
                                  {cardTacticData.coverage}%
              </span>
                                <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                                  Coverage
              </span>
            </div>
          </div>
        </CardHeader>
                          <CardContent className="space-y-4">
                            {/* Coverage Bar */}
                            <div className="space-y-2">
                              <div className="h-4 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                                <div
                                  className="h-full bg-emerald-500 transition-all"
                                  style={{ width: `${(cardTacticData.healthy / cardTacticData.total) * 100}%` }}
                                  title={`${cardTacticData.healthy} Healthy`}
                                />
                                <div
                                  className="h-full bg-amber-400 transition-all"
                                  style={{ width: `${(cardTacticData.atRisk / cardTacticData.total) * 100}%` }}
                                  title={`${cardTacticData.atRisk} At Risk`}
                                />
                                <div
                                  className="h-full bg-slate-300 transition-all"
                                  style={{ width: `${(cardTacticData.untested / cardTacticData.total) * 100}%` }}
                                  title={`${cardTacticData.untested} Untested`}
                          />
                        </div>
                              <div className="text-xs text-slate-600 text-center">
                                {cardTacticData.total} total techniques
                              </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200">
                              <div className="text-center p-2 rounded-lg bg-emerald-50 border border-emerald-100">
                                <div className="text-xl font-bold text-emerald-700 mb-1">
                                  {cardTacticData.healthy}
                                </div>
                                <div className="text-[10px] text-slate-600 uppercase tracking-wider">
                                  Healthy
                                </div>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-amber-50 border border-amber-100">
                                <div className="text-xl font-bold text-amber-700 mb-1">
                                  {cardTacticData.atRisk}
                                </div>
                                <div className="text-[10px] text-slate-600 uppercase tracking-wider">
                                  At Risk
                                </div>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-slate-50 border border-slate-200">
                                <div className="text-xl font-bold text-slate-700 mb-1">
                                  {cardTacticData.untested}
                                </div>
                                <div className="text-[10px] text-slate-600 uppercase tracking-wider">
                                  Untested
                                </div>
                              </div>
                            </div>

                            {/* Technique Preview */}
                            <div className="pt-3 border-t border-slate-200">
                              <div className="text-xs text-slate-600 mb-2 uppercase tracking-wider">
                                Technique Preview
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {cardTacticData.techniques.slice(0, 10).map((tech) => {
                                  const status = getTechniqueStatus(tech);
                                  const colorClass =
                                    status === "healthy"
                                      ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                                      : status === "failed" || status === "missing"
                                      ? "bg-amber-50 border-amber-100 text-amber-700"
                                      : "bg-slate-50 border-slate-200 text-slate-700";
                                  return (
                                    <span
                                      key={tech.technique_id}
                                      className={cn(
                                        "px-2 py-1 rounded-md border text-[11px] font-medium",
                                        colorClass
                                      )}
                                    >
                                      {tech.technique_id}
                                    </span>
                  );
                })}
                                {cardTacticData.techniques.length > 10 && (
                                  <div className="px-2.5 py-1 rounded-md text-[11px] border border-slate-200 text-slate-600 bg-slate-50">
                                    +{cardTacticData.techniques.length - 10}
                                  </div>
                                )}
              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
            </div>

                  {/* Heat Map Carousel Navigation */}
                  {heatMapData.length > 6 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-200">
                      <div className="text-sm text-slate-600">
                        Showing {Math.min(heatmapCarouselPosition * 6 + 1, heatMapData.length)}-{Math.min((heatmapCarouselPosition + 1) * 6, heatMapData.length)} of {heatMapData.length} tactics
                      </div>
                      <div className="flex items-center gap-2">
                  <button
                    type="button"
                          onClick={() => setHeatmapCarouselPosition((p) => Math.max(0, p - 1))}
                          disabled={heatmapCarouselPosition === 0}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                          aria-label="Previous tactics"
                  >
                          <ChevronLeft className="h-5 w-5" />
                  </button>
                        <div className="text-sm text-slate-600 px-3">
                          Page {heatmapCarouselPosition + 1} of {Math.ceil(heatMapData.length / 6)}
              </div>
                        <button
                    type="button"
                          onClick={() => setHeatmapCarouselPosition((p) => Math.min(Math.ceil(heatMapData.length / 6) - 1, p + 1))}
                          disabled={heatmapCarouselPosition >= Math.ceil(heatMapData.length / 6) - 1}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                          aria-label="Next tactics"
                  >
                          <ChevronRight className="h-5 w-5" />
                        </button>
                </div>
              </div>
                  )}
            </div>
          </div>
            )}
        </CardContent>
      </Card>
      ) : sortedCoverage.length === 0 ? (
        <Card>
          <CardContent className="pt-12 pb-12 text-center">
            <Target className="h-12 w-12 text-slate-500 mx-auto mb-4" />
            <p className="text-lg font-semibold text-slate-200 mb-2 font-display">
              {searchQuery || statusFilter !== "all" || tacticFilter !== "all" || techniqueFilter !== "all"
                ? "No techniques match your filters"
                : mitreTechniques.length === 0
                ? "Loading MITRE techniques..."
                : "No techniques to display"}
              </p>
            <p className="text-sm text-slate-400">
              {searchQuery || statusFilter !== "all" || tacticFilter !== "all" || techniqueFilter !== "all"
                ? "Try adjusting your search or filter criteria."
                : mitreTechniques.length === 0
                ? "Please wait while we load the MITRE ATT&CK catalog."
                : "Techniques will appear here once loaded."}
              </p>
            </CardContent>
          </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            {focus === "uncovered" && (
              <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/40">
                Showing gaps only
              </Badge>
            )}
          </div>

          {/* Carousel Container */}
          <div className="relative">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sortedCoverage
                .slice(
                  carouselPosition * 6,
                  carouselPosition * 6 + 6
                )
                .map((item) => {
                  const status = getTechniqueStatus(item);
                  const statusLabel =
                    status === "healthy"
                      ? "Healthy"
                      : status === "untested"
                      ? "Untested"
                      : "At Risk";
                  const statusClass =
                    status === "healthy"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : status === "untested"
                      ? "bg-slate-50 text-slate-700 border border-slate-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200";
                  
                  return (
            <Card
              key={item.technique_id}
                      className="border border-slate-200 bg-white transition-all cursor-pointer hover:shadow-md hover:-translate-y-[1px]"
                      onClick={() => router.push(`/tests/explore/${item.technique_id}`)}
            >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-sm font-semibold text-slate-900 font-display">
                              <span className="font-mono text-indigo-700">{item.technique_id}</span>
                            </CardTitle>
                            {item.name && item.name !== item.technique_id && (
                              <p className="text-base font-semibold text-slate-900 mt-1 line-clamp-2 font-body leading-snug">
                                {item.name}
                              </p>
                            )}
                            <p className="text-xs text-slate-600 mt-1">
                              Tactic: {(item.tactics && item.tactics[0]) || "Unknown"}
                            </p>
                          </div>
                          <span className={cn("px-3 py-1 rounded-full text-xs font-semibold", statusClass)}>
                            {statusLabel}
                          </span>
                        </div>
              </CardHeader>
                      <CardContent className="pt-1 space-y-3">
                        {item.last_score !== null && item.last_score !== undefined && (
                          <div className="flex items-center justify-between text-xs text-slate-600">
                            <span>Score</span>
                            <span className="text-sm font-semibold text-slate-900">{item.last_score}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 h-9 border-slate-300 bg-white text-black hover:bg-slate-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/run-test?technique_id=${item.technique_id}`);
                            }}
                          >
                            Run Test
                            <ArrowRight className="h-3 w-3 ml-2" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 text-indigo-700 hover:bg-indigo-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/tests/explore/${item.technique_id}`);
                            }}
                          >
                            Details
                          </Button>
                        </div>
              </CardContent>
            </Card>
                  );
                })}
            </div>

            {/* Carousel Navigation */}
            {sortedCoverage.length > 6 && (
              <div className="flex items-center justify-end mt-6 pt-4 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCarouselPosition((p) => Math.max(0, p - 1))}
                    disabled={carouselPosition === 0}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <div className="text-sm text-slate-600 px-3">
                    Page {carouselPosition + 1} of {Math.ceil(sortedCoverage.length / 6)}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCarouselPosition((p) => Math.min(Math.ceil(sortedCoverage.length / 6) - 1, p + 1))}
                    disabled={carouselPosition >= Math.ceil(sortedCoverage.length / 6) - 1}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
        )}
      </div>
        </div>
      )}
        </div>
      </PageContainer>
  );
}

export default function MitreViewPage() {
  return <MitreViewPageContent />;
}
