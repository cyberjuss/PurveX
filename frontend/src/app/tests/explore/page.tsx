"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getDetections, getMitreTechniques, type MitreTechnique } from "@/lib/api";
import { 
  Target, 
  Search, 
  Shield,
  Clock,
  Activity,
  ChevronLeft,
  Sparkles,
  X,
  Filter,
  SlidersHorizontal,
  CheckCircle2,
  XCircle,
  Zap,
  Grid3x3,
  List,
  ArrowRight,
  ChevronRight,
  TrendingUp,
  Eye,
  Layers
} from "lucide-react";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

const TACTIC_ORDER = [
  "Reconnaissance",
  "Resource Development",
  "Initial Access",
  "Execution",
  "Persistence",
  "Privilege Escalation",
  "Defense Evasion",
  "Credential Access",
  "Discovery",
  "Lateral Movement",
  "Collection",
  "Command and Control",
  "Exfiltration",
  "Impact",
];

type FilterState = {
  tactic: string;
  hasDetections: "all" | "yes" | "no";
  isSubtechnique: "all" | "yes" | "no";
};

export default function ExplorePage() {
  const router = useRouter();
  const { toast } = useToast();
  const [mitreTechniques, setMitreTechniques] = useState<MitreTechnique[]>([]);
  const [mappedTechniqueIds, setMappedTechniqueIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<FilterState>({
    tactic: "ALL",
    hasDetections: "all",
    isSubtechnique: "all",
  });
  const [tacticPage, setTacticPage] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const getBaseTechniqueId = useCallback((techniqueId: string) => techniqueId.split(".")[0], []);

  const hasDetectionMapped = useCallback(
    (techniqueId: string) => {
      const baseId = getBaseTechniqueId(techniqueId);
      return mappedTechniqueIds.has(techniqueId) || mappedTechniqueIds.has(baseId);
    },
    [getBaseTechniqueId, mappedTechniqueIds]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getMitreTechniques();
      const detections = await getDetections().catch(() => []);
      const mappedIds = new Set<string>();
      for (const detection of detections) {
        if (!detection.technique_id) continue;
        mappedIds.add(detection.technique_id);
        mappedIds.add(getBaseTechniqueId(detection.technique_id));
      }
      setMitreTechniques(data);
      setMappedTechniqueIds(mappedIds);
    } catch (err: any) {
      const errorMessage = err.message || "Failed to load MITRE techniques.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [getBaseTechniqueId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute filter counts
  const filterCounts = useMemo(() => {
    const counts = {
      tactics: {} as Record<string, number>,
      total: mitreTechniques.length,
      withDetections: 0,
      withoutDetections: 0,
      subtechniques: 0,
      parentTechniques: 0,
    };

    mitreTechniques.forEach((tech) => {
      // Count by tactic
      tech.tactics?.forEach((tactic) => {
        counts.tactics[tactic] = (counts.tactics[tactic] || 0) + 1;
      });

      // Count sub-techniques
      if (tech.is_subtechnique) {
        counts.subtechniques++;
      } else {
        counts.parentTechniques++;
      }
      if (hasDetectionMapped(tech.id)) {
        counts.withDetections++;
      } else {
        counts.withoutDetections++;
      }
    });

    return counts;
  }, [hasDetectionMapped, mitreTechniques]);

  // Filter techniques
  const filteredTechniques = useMemo(() => {
    return mitreTechniques.filter((tech) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          tech.id.toLowerCase().includes(query) ||
          (tech.name && tech.name.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      // Tactic filter
      if (filters.tactic !== "ALL") {
        if (!tech.tactics || !tech.tactics.includes(filters.tactic)) {
          return false;
        }
      }

      const hasMappedDetection = hasDetectionMapped(tech.id);
      if (filters.hasDetections === "yes") {
        if (!hasMappedDetection) return false;
      } else if (filters.hasDetections === "no") {
        if (hasMappedDetection) return false;
      }

      // Sub-technique filter
      if (filters.isSubtechnique === "yes") {
        if (!tech.is_subtechnique) return false;
      } else if (filters.isSubtechnique === "no") {
        if (tech.is_subtechnique) return false;
      }

      return true;
    });
  }, [hasDetectionMapped, mitreTechniques, searchQuery, filters]);

  // Organize techniques by tactic
  const visibleTactics =
    filters.tactic === "ALL" ? TACTIC_ORDER : TACTIC_ORDER.filter((t) => t === filters.tactic);

  const tacticsToTechniques: Record<string, MitreTechnique[]> = {};

  for (const tech of filteredTechniques) {
    for (const tacticName of tech.tactics || []) {
      if (!tacticsToTechniques[tacticName]) {
        tacticsToTechniques[tacticName] = [];
      }
      tacticsToTechniques[tacticName].push(tech);
    }
  }

  // Sort techniques within each tactic
  for (const key of Object.keys(tacticsToTechniques)) {
    tacticsToTechniques[key].sort((a, b) => a.id.localeCompare(b.id));
  }

  const tacticColumns = visibleTactics
    .map((tactic) => ({
      tactic,
      techniques: tacticsToTechniques[tactic] || [],
    }))
    .filter((col) => col.techniques.length > 0);

  // Carousel pagination
  const COLUMNS_PER_PAGE = 3;
  const totalPages = Math.max(1, Math.ceil(tacticColumns.length / COLUMNS_PER_PAGE));
  const currentPage = Math.min(tacticPage, totalPages - 1);
  const pageColumns = tacticColumns.slice(
    currentPage * COLUMNS_PER_PAGE,
    currentPage * COLUMNS_PER_PAGE + COLUMNS_PER_PAGE
  );

  // Reset page when filters change
  useEffect(() => {
    setTacticPage(0);
  }, [searchQuery, filters]);

  // Check if any filters are active
  const hasActiveFilters = 
    filters.tactic !== "ALL" || 
    filters.hasDetections !== "all" || 
    filters.isSubtechnique !== "all" ||
    searchQuery.length > 0;

  const clearAllFilters = () => {
    setSearchQuery("");
    setFilters({
      tactic: "ALL",
      hasDetections: "all",
      isSubtechnique: "all",
    });
  };

  // Drag to scroll functionality
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!carouselRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - carouselRef.current.offsetLeft);
    setScrollLeft(carouselRef.current.scrollLeft);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !carouselRef.current) return;
    e.preventDefault();
    const x = e.pageX - carouselRef.current.offsetLeft;
    const walk = (x - startX) * 2;
    carouselRef.current.scrollLeft = scrollLeft - walk;
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't interfere with input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      
      if (e.key === "ArrowLeft" && currentPage > 0) {
        e.preventDefault();
        setTacticPage((p) => Math.max(0, p - 1));
      } else if (e.key === "ArrowRight" && currentPage < totalPages - 1) {
        e.preventDefault();
        setTacticPage((p) => Math.min(totalPages - 1, p + 1));
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [currentPage, totalPages]);

  // Quick jump to tactic
  const jumpToTactic = (tactic: string) => {
    const index = tacticColumns.findIndex((col) => col.tactic === tactic);
    if (index !== -1) {
      setTacticPage(Math.floor(index / COLUMNS_PER_PAGE));
      setFilters({ ...filters, tactic });
      setShowFilters(false);
    }
  };

  // Calculate quick stats - MUST be before early returns to maintain hook order
  const quickStats = useMemo(() => {
    const totalTactics = tacticColumns.length;
    const totalTechniques = filteredTechniques.length;
    const coveragePercent = filterCounts.total > 0 ? Math.round((filterCounts.parentTechniques / filterCounts.total) * 100) : 0;
    return { totalTactics, totalTechniques, coveragePercent };
  }, [tacticColumns.length, filteredTechniques.length, filterCounts.total, filterCounts.parentTechniques]);

  if (loading) {
    return (
      <PageContainer maxWidth="full" className="p-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <PageHeader
            title="Explore MITRE Coverage"
            subtitle="Find the next test that will teach you something real and move your coverage forward."
          />
          <LoadingState message="Loading MITRE techniques..." size="lg" />
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer maxWidth="full" className="p-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
          <PageHeader
            title="Explore MITRE Coverage"
            subtitle="Find the next test that will teach you something real and move your coverage forward."
          />
          <ErrorState
            title="Failed to load techniques"
            message={error}
            onRetry={loadData}
          />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="full" className="p-0">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <PageHeader
          title="Explore MITRE Coverage"
          subtitle="Find the next test that will teach you something real and move your coverage forward."
        />
        {tacticColumns.length === 0 ? (
          <Card className="shadow-2xl">
            <CardContent className="pt-16 pb-16 text-center">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-white/20 border-2 border-indigo-500/30 mb-6">
                <Target className="h-8 w-8 text-indigo-400" />
                  </div>
              <p className="text-xl font-semibold text-[var(--foreground)] mb-2">No techniques found</p>
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
                {hasActiveFilters
                  ? "Try adjusting your search or filter criteria"
                  : "No MITRE techniques available. Please check your data source."}
              </p>
                      {hasActiveFilters && (
                        <Button
                  variant="outline"
                  onClick={() => {
                    clearAllFilters();
                    toast({
                      type: "info",
                      title: "Filters cleared",
                      description: "All filters have been reset.",
                    });
                  }}
                  className="mt-4 focus:outline-none focus:ring-2 focus:ring-sky-500/50 border-[var(--stroke-soft)] text-slate-700 dark:text-slate-200 hover:bg-[var(--surface-elevated)]"
                  aria-label="Clear all filters"
                >
                  Clear all filters
                        </Button>
                      )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Filter toolbar */}
            <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm">
              <CardContent className="px-4 py-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="flex-1 min-w-[200px] space-y-1">
                    <label className="text-xs font-semibold text-slate-600">Search</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <Input
                        placeholder="Search ID or name..."
                        value={searchQuery}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value.length <= 200) setSearchQuery(value);
                        }}
                        className="pl-9 pr-10 h-10 bg-[var(--surface-card)] border-[var(--stroke-soft)] !text-[var(--foreground)] placeholder:text-slate-500 dark:placeholder:text-slate-400"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  <div className="w-[180px] flex-shrink-0 space-y-1">
                    <label className="text-xs font-semibold text-slate-600">Tactic</label>
                    <Select
                      value={filters.tactic}
                      onValueChange={(value: string) => setFilters({ ...filters, tactic: value })}
                    >
                      <SelectTrigger className="h-10 bg-white border-slate-200 !text-black">
                          <SelectValue placeholder="All tactics" />
                        </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        <SelectItem value="ALL" className="!text-black">All tactics</SelectItem>
                          {TACTIC_ORDER.map((tactic) => (
                            <SelectItem key={tactic} value={tactic} className="!text-black">
                            {tactic} ({filterCounts.tactics[tactic] || 0})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                  <div className="w-[180px] flex-shrink-0 space-y-1">
                    <label className="text-xs font-semibold text-slate-600">Detection state</label>
                    <Select
                      value={filters.hasDetections}
                      onValueChange={(value: "all" | "yes" | "no") => setFilters({ ...filters, hasDetections: value })}
                    >
                      <SelectTrigger className="h-10 bg-white border-slate-200 !text-black">
                        <SelectValue placeholder="All detection states" />
                        </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        <SelectItem value="all" className="!text-black">All detection states</SelectItem>
                        <SelectItem value="yes" className="!text-black">Has detections</SelectItem>
                        <SelectItem value="no" className="!text-black">No detections</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                  <div className="w-[180px] flex-shrink-0 space-y-1">
                    <label className="text-xs font-semibold text-slate-600">Technique type</label>
                    <Select
                      value={filters.isSubtechnique}
                      onValueChange={(value: "all" | "yes" | "no") => setFilters({ ...filters, isSubtechnique: value })}
                    >
                      <SelectTrigger className="h-10 bg-white border-slate-200 !text-black">
                        <SelectValue placeholder="All types" />
                        </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                          <SelectItem value="all" className="!text-black">All types</SelectItem>
                        <SelectItem value="no" className="!text-black">Parent techniques</SelectItem>
                        <SelectItem value="yes" className="!text-black">Sub-techniques</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                <div className="flex flex-wrap gap-2">
                  {hasActiveFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearAllFilters}
                      className="h-9 border-slate-200 text-slate-700 hover:bg-slate-50"
                    >
                      Clear all filters
                    </Button>
                  )}
                </div>
                </CardContent>
              </Card>

              {/* Enhanced Technique Matrix Carousel */}
              <div 
                ref={carouselRef}
                className={cn(
                  "flex gap-6 overflow-x-auto pb-6 hide-scrollbar scroll-smooth",
                  isDragging && "cursor-grabbing"
                )}
                onMouseDown={handleMouseDown}
                onMouseLeave={handleMouseLeave}
                onMouseUp={handleMouseUp}
                onMouseMove={handleMouseMove}
              style={{ cursor: isDragging ? "grabbing" : "grab" }}
              >
                    {pageColumns.map((column) => {
                const parentIds = new Set(column.techniques.map((t) => t.id.split(".")[0]));
                      const parentCount = parentIds.size;

                      return (
                        <div
                          key={column.tactic}
                    className="flex-1 min-w-[320px] max-w-[380px] rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] flex flex-col shadow-md overflow-hidden"
                        >
                          {/* Enhanced Tactic Header */}
                    <div className="px-5 py-5 bg-[var(--surface-elevated)] border-b border-[var(--stroke-soft)]">
                            <div className="flex items-center justify-between mb-2">
                        <div className="text-sm uppercase tracking-wider text-[var(--foreground)] font-bold">
                                {column.tactic}
                              </div>
                        <div className="h-7 w-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                          <Target className="h-4 w-4 text-indigo-600" />
                              </div>
                            </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                        <span className="font-medium text-slate-700">
                          {parentCount} technique{parentCount === 1 ? "" : "s"}
                        </span>
                            </div>
                          </div>
                          
                          {/* Techniques List */}
                    <div className="flex-1 max-h-[42rem] overflow-y-auto hide-scrollbar p-3 bg-white">
                            {(() => {
                              // Group techniques by their top-level technique ID
                              const parents: MitreTechnique[] = [];
                              const byBase: Record<
                                string,
                                {
                                  parent?: MitreTechnique;
                                  subs: MitreTechnique[];
                                }
                              > = {};

                              for (const tech of column.techniques) {
                                const baseId = tech.id.split(".")[0];
                                if (!byBase[baseId]) {
                                  byBase[baseId] = { parent: undefined, subs: [] };
                                }
                                if (tech.is_subtechnique) {
                                  byBase[baseId].subs.push(tech);
                                } else {
                                  byBase[baseId].parent = tech;
                                }
                              }

                              for (const [baseId, value] of Object.entries(byBase)) {
                                let parent = value.parent;
                                if (!parent) {
                                  parent = {
                                    id: baseId,
                                    name: value.subs[0]?.name || baseId,
                                    tactics: value.subs[0]?.tactics || [],
                                    is_subtechnique: false,
                                  } as MitreTechnique;
                                }
                                parents.push(parent);
                              }

                              parents.sort((a, b) => a.id.localeCompare(b.id));

                              if (parents.length === 0) {
                                return (
                                  <div className="h-full flex items-center justify-center px-4 py-8 text-xs text-slate-500">
                                    No techniques in this tactic for the current view yet.
                                  </div>
                                );
                              }

                        return parents.map((parent) => (
                                <div
                                  key={parent.id}
                                  className={cn(
                                    "relative rounded-xl p-4 mb-2 group",
                              "bg-white",
                              "border border-[var(--stroke-soft)]",
                                    "cursor-pointer transition-all duration-200",
                              "hover:border-indigo-200 hover:shadow-md hover:-translate-y-[1px]"
                                  )}
                                  onClick={() => {
                                    // Validate technique ID format before navigation
                                    if (parent.id && /^T\d{4}(\.\d{3})?$/.test(parent.id)) {
                                      router.push(`/tests/explore/${encodeURIComponent(parent.id)}`);
                                    } else {
                                      toast({
                                        type: "error",
                                        title: "Invalid technique ID",
                                        description: "The technique ID format is invalid.",
                                      });
                                    }
                                  }}
                                >
                                  <div className="space-y-3">
                                    {/* Technique ID and Name */}
                                    <div className="space-y-1.5">
                                      <div className="flex items-center gap-2 mb-1.5">
                                  <div className="font-mono text-sm font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-md px-2 py-1">
                                          {parent.id}
                                        </div>
                                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-500/70" />
                                      </div>
                                      {parent.name && (
                                  <div className="text-sm font-medium text-[var(--foreground)] leading-snug font-body line-clamp-2">
                                          {parent.name}
                                        </div>
                                      )}
                                    </div>

                                    {/* Status Indicators */}
                              <div className="flex items-center gap-3 pt-1 text-xs">
                                <div
                                  className={cn(
                                    "inline-flex items-center gap-2 px-2 py-1 rounded-md border",
                                    hasDetectionMapped(parent.id)
                                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                      : "bg-slate-50 border-slate-200 text-slate-600"
                                  )}
                                >
                                  <Shield
                                    className={cn(
                                      "h-3.5 w-3.5",
                                      hasDetectionMapped(parent.id) ? "text-emerald-600" : "text-slate-500"
                                    )}
                                  />
                                  <span>{hasDetectionMapped(parent.id) ? "Detections mapped" : "No detections"}</span>
                                </div>
                                <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-slate-50 border border-[var(--stroke-soft)] text-slate-600">
                                  <Clock className="h-3.5 w-3.5 text-slate-500" />
                                  <span>Test status unavailable</span>
                                      </div>
                                    </div>

                                    {/* Enhanced Explore Button */}
                                    <div className="relative z-20 pt-1" onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="w-full h-9 border-slate-200 text-[var(--foreground)] hover:bg-slate-50"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                          // Validate technique ID format before navigation
                                          if (parent.id && /^T\d{4}(\.\d{3})?$/.test(parent.id)) {
                                            router.push(`/tests/explore/${encodeURIComponent(parent.id)}`);
                                          } else {
                                            toast({
                                              type: "error",
                                              title: "Invalid technique ID",
                                              description: "The technique ID format is invalid.",
                                            });
                                          }
                                        }}
                                      >
                                        <Eye className="h-3.5 w-3.5 mr-2" />
                                        Explore Technique
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      );
                    })}
              </div>

              {/* Enhanced Pagination Controls */}
            <div className="mt-8 pt-6 border-t border-slate-200">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-sm font-medium text-slate-700 text-center sm:text-left">
                  Showing <span className="text-[var(--foreground)] font-semibold">{pageColumns.length}</span> of{" "}
                  <span className="text-[var(--foreground)] font-semibold">{tacticColumns.length}</span> tactics
                  </div>
                  
                  {totalPages > 1 && (
                    <div className="flex items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTacticPage((p) => Math.max(0, p - 1))}
                        disabled={currentPage === 0}
                      className="h-10 px-4 border-slate-300 bg-white text-[var(--foreground)] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                      </Button>
                      
                      {/* Page Indicators */}
                      <div className="flex items-center gap-1.5">
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                          let pageNum;
                          if (totalPages <= 5) {
                            pageNum = i;
                          } else if (currentPage < 3) {
                            pageNum = i;
                          } else if (currentPage > totalPages - 4) {
                            pageNum = totalPages - 5 + i;
                          } else {
                            pageNum = currentPage - 2 + i;
                          }
                          return (
                            <button
                              key={pageNum}
                              onClick={() => setTacticPage(pageNum)}
                              className={cn(
                                "h-8 w-8 rounded-lg text-xs font-medium transition-all",
                                currentPage === pageNum
                                ? "bg-white text-[var(--foreground)] border border-slate-900 shadow-sm"
                                : "bg-white text-slate-700 border border-[var(--stroke-soft)] hover:bg-slate-50"
                              )}
                            >
                              {pageNum + 1}
                            </button>
                          );
                        })}
                      </div>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTacticPage((p) => Math.min(totalPages - 1, p + 1))}
                        disabled={currentPage >= totalPages - 1}
                      className="h-10 px-4 border-slate-300 bg-white text-[var(--foreground)] hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </PageContainer>
  );
}
