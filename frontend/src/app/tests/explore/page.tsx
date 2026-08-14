"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chip } from "@/components/ui/chip";
import { getDetections, getMitreTechniques, type MitreTechnique } from "@/lib/api";
import { 
  Target,
  Search,
  Shield,
  Clock,
  Activity,
  X,
  Filter,
  SlidersHorizontal,
  CheckCircle2,
  XCircle,
  Zap,
  Grid3x3,
  List,
  ArrowRight,
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
import { TestsHubTabs } from "@/components/tests/tests-hub-tabs";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { useToast } from "@/components/ui/toast";

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
          <TestsHubTabs />
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
          <TestsHubTabs />
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
        <TestsHubTabs />
        <PageHeader
          title="Explore MITRE Coverage"
          subtitle="Find the next test that will teach you something real and move your coverage forward."
        />
        {tacticColumns.length === 0 ? (
          <Card>
            <CardContent className="pt-16 pb-16 text-center">
              <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-[var(--accent-soft)] border border-[var(--accent-line)] mb-6">
                <Target className="h-8 w-8 text-[var(--accent-strong)]" />
              </div>
              <p className="text-xl font-semibold text-[var(--foreground)] mb-2">No techniques found</p>
              <p className="text-sm text-[var(--surface-subtle-foreground)] mb-4">
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
                  className="mt-4"
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
                    <label className="text-xs font-semibold text-[var(--surface-subtle-foreground)]">Search</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--surface-subtle-foreground)]" />
                      <Input
                        placeholder="Search ID or name..."
                        value={searchQuery}
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value.length <= 200) setSearchQuery(value);
                        }}
                        className="pl-9 pr-10 h-10 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)] placeholder:text-[var(--surface-subtle-foreground)]"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]"
                          aria-label="Clear search"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="w-[180px] flex-shrink-0 space-y-1">
                    <label className="text-xs font-semibold text-[var(--surface-subtle-foreground)]">Tactic</label>
                    <Select
                      value={filters.tactic}
                      onValueChange={(value: string) => setFilters({ ...filters, tactic: value })}
                    >
                      <SelectTrigger className="h-10">
                          <SelectValue placeholder="All tactics" />
                        </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL">All tactics</SelectItem>
                          {TACTIC_ORDER.map((tactic) => (
                            <SelectItem key={tactic} value={tactic}>
                            {tactic} ({filterCounts.tactics[tactic] || 0})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                  <div className="w-[180px] flex-shrink-0 space-y-1">
                    <label className="text-xs font-semibold text-[var(--surface-subtle-foreground)]">Detection state</label>
                    <Select
                      value={filters.hasDetections}
                      onValueChange={(value: "all" | "yes" | "no") => setFilters({ ...filters, hasDetections: value })}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="All detection states" />
                        </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All detection states</SelectItem>
                        <SelectItem value="yes">Has detections</SelectItem>
                        <SelectItem value="no">No detections</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                  <div className="w-[180px] flex-shrink-0 space-y-1">
                    <label className="text-xs font-semibold text-[var(--surface-subtle-foreground)]">Technique type</label>
                    <Select
                      value={filters.isSubtechnique}
                      onValueChange={(value: "all" | "yes" | "no") => setFilters({ ...filters, isSubtechnique: value })}
                    >
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="All types" />
                        </SelectTrigger>
                      <SelectContent>
                          <SelectItem value="all">All types</SelectItem>
                        <SelectItem value="no">Parent techniques</SelectItem>
                        <SelectItem value="yes">Sub-techniques</SelectItem>
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
                      className="h-9"
                    >
                      Clear all filters
                    </Button>
                  )}
                </div>
                </CardContent>
              </Card>

              {/* Technique matrix — responsive grid, no horizontal scroll */}
              <p className="text-sm font-medium text-[var(--surface-subtle-foreground)]">
                Showing <span className="text-[var(--foreground)] font-semibold">{tacticColumns.length}</span> tactics ·{" "}
                <span className="text-[var(--foreground)] font-semibold">{filteredTechniques.length}</span> techniques
              </p>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {tacticColumns.map((column) => {
                const parentIds = new Set(column.techniques.map((t) => t.id.split(".")[0]));
                      const parentCount = parentIds.size;

                      return (
                        <div
                          key={column.tactic}
                    className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] flex flex-col overflow-hidden"
                        >
                          {/* Tactic header */}
                    <div className="px-5 py-4 bg-[var(--surface-elevated)] border-b border-[var(--stroke-soft)]">
                            <div className="flex items-center justify-between mb-1">
                        <div className="text-sm uppercase tracking-wider text-[var(--foreground)] font-bold">
                                {column.tactic}
                              </div>
                        <div className="h-7 w-7 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-line)] flex items-center justify-center">
                          <Target className="h-4 w-4 text-[var(--accent-strong)]" />
                              </div>
                            </div>
                      <span className="text-xs font-medium text-[var(--surface-subtle-foreground)]">
                        {parentCount} technique{parentCount === 1 ? "" : "s"}
                      </span>
                          </div>

                          {/* Techniques list */}
                    <div className="flex-1 max-h-[36rem] overflow-y-auto p-3 space-y-2">
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
                                  <div className="h-full flex items-center justify-center px-4 py-8 text-xs text-[var(--surface-subtle-foreground)]">
                                    No techniques in this tactic for the current view yet.
                                  </div>
                                );
                              }

                        return parents.map((parent) => (
                                <div
                                  key={parent.id}
                                  className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 cursor-pointer transition hover:border-[var(--accent-line)]"
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
                                  <div className="space-y-2.5">
                                    {/* Technique ID and Name */}
                                    <div className="space-y-1">
                                      <span className="font-mono text-xs font-bold text-[var(--accent-strong)] bg-[var(--accent-soft)] border border-[var(--accent-line)] rounded-md px-2 py-1 inline-block">
                                        {parent.id}
                                      </span>
                                      {parent.name && (
                                  <div className="text-sm font-medium text-[var(--foreground)] leading-snug line-clamp-2">
                                          {parent.name}
                                        </div>
                                      )}
                                    </div>

                                    {/* Status indicators */}
                              <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                                <Chip tone={hasDetectionMapped(parent.id) ? "success" : "muted"} size="sm">
                                  <Shield className="h-3 w-3" />
                                  {hasDetectionMapped(parent.id) ? "Detections mapped" : "No detections"}
                                </Chip>
                                <Chip tone="muted" size="sm">
                                  <Clock className="h-3 w-3" />
                                  Test status unavailable
                                </Chip>
                                    </div>

                                    {/* Explore button */}
                                    <div onClick={(e) => e.stopPropagation()}>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="w-full h-9"
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
          </div>
          )}
        </div>
      </PageContainer>
  );
}
