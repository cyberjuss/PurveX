"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { toneClasses } from "@/lib/status-tone";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/page-container";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  getDetections,
  getMitreTechniques,
  getAtomicTests,
  getAtomicCatalogStatus,
  downloadAtomicCatalog,
  getCoverageSummary,
  getCoverageTrend,
  type CoverageSummary,
  type CoverageTrend,
  type Detection,
  type MitreTechnique,
  type AtomicTestDefinition,
} from "@/lib/api";
import {
  Loader2,
  Search,
  Play,
  Target,
  X,
  FlaskConical,
  ChevronRight,
  Download,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type CoverageStatus = "validated" | "at_risk" | "mapped" | "unmapped";

type TechniqueCoverage = {
  id: string;
  name: string;
  tactics: string[];
  platforms: string[];
  mappedCount: number;
  testedCount: number;
  validatedCount: number;
  highestScore?: number;
};

// Canonical ATT&CK Enterprise platforms worth exposing as filters. ATT&CK
// actually defines ~14 platforms including SaaS subtypes; we surface the six
// that a SOC buyer typically cares about. Anything else still shows up in
// the raw technique data for the sheet — it's just not a filter chip.
const PLATFORM_FILTER_OPTIONS = [
  "Windows",
  "Linux",
  "macOS",
  "Containers",
  "Cloud",
  "Network",
] as const;
type PlatformFilter = (typeof PLATFORM_FILTER_OPTIONS)[number];

// ATT&CK sometimes uses "IaaS", "SaaS", "Azure AD", etc. instead of the
// single umbrella term. Normalize to our filter chips so a user clicking
// "Cloud" includes IaaS+SaaS+etc.
function platformMatches(techniquePlatforms: string[], filter: PlatformFilter): boolean {
  const lower = techniquePlatforms.map((p) => p.toLowerCase());
  if (filter === "Cloud") {
    return lower.some(
      (p) =>
        p.includes("cloud") || p === "iaas" || p === "saas" || p.includes("office 365") ||
        p.includes("azure") || p.includes("google workspace") || p.includes("identity provider")
    );
  }
  if (filter === "Network") {
    return lower.some((p) => p === "network" || p.includes("network devices"));
  }
  if (filter === "Containers") {
    return lower.some((p) => p.includes("container"));
  }
  return lower.some((p) => p === filter.toLowerCase());
}

function coverageTone(percent: number): NonNullable<ChipProps["tone"]> {
  if (percent >= 75) return "success";
  if (percent >= 40) return "warning";
  return "danger";
}

function getStatus(item: TechniqueCoverage): CoverageStatus {
  if (item.validatedCount > 0) return "validated";
  if (item.testedCount > 0) return "at_risk";
  if (item.mappedCount > 0) return "mapped";
  return "unmapped";
}

const STATUS_TONE: Record<CoverageStatus, NonNullable<ChipProps["tone"]>> = {
  validated: "success",
  at_risk: "warning",
  mapped: "info",
  unmapped: "muted",
};

const STATUS_LABEL: Record<CoverageStatus, string> = {
  validated: "Validated",
  at_risk: "At risk",
  mapped: "Untested",
  unmapped: "Unmapped",
};

function MitreViewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CoverageStatus>("all");
  const [platformFilters, setPlatformFilters] = useState<Set<PlatformFilter>>(new Set());
  const [atomicTestsByTechnique, setAtomicTestsByTechnique] = useState<Record<string, AtomicTestDefinition[]>>({});
  const [selectedTactic, setSelectedTactic] = useState<string | null>(null);
  const [selectedTechnique, setSelectedTechnique] = useState<TechniqueCoverage | null>(null);

  const [sheetAtomicTests, setSheetAtomicTests] = useState<AtomicTestDefinition[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);

  // Core data: detections + the MITRE catalog unblock the matrix.
  // SWR caches across navigations, so bouncing back to /mitre is instant.
  const detectionsQ = useSWR<Detection[]>("mitre:detections", getDetections);
  const techniquesQ = useSWR<MitreTechnique[]>("mitre:techniques", getMitreTechniques);
  const catalogQ = useSWR("mitre:atomic-catalog", () => getAtomicCatalogStatus().catch(() => null));
  const [installingCatalog, setInstallingCatalog] = useState(false);

  const handleInstallCatalog = useCallback(async () => {
    setInstallingCatalog(true);
    try {
      await downloadAtomicCatalog();
      await catalogQ.mutate();
    } catch {
      // catalogQ stays "not installed"; the button just reverts to retry.
    } finally {
      setInstallingCatalog(false);
    }
  }, [catalogQ]);

  const detections = useMemo(() => detectionsQ.data ?? [], [detectionsQ.data]);
  const techniques = useMemo(() => techniquesQ.data ?? [], [techniquesQ.data]);
  const atomicCatalogAvailable = catalogQ.data ? catalogQ.data.installed : catalogQ.data === null ? false : null;
  const loading =
    (!detectionsQ.data && !detectionsQ.error) || (!techniquesQ.data && !techniquesQ.error);
  const error = (() => {
    const e = detectionsQ.error || techniquesQ.error;
    if (!e) return null;
    return e instanceof Error ? e.message : "Failed to load MITRE data.";
  })();

  // Executive card (summary + trend). Failures stay null — the card just
  // hides. Key scoped separately so a hiccup here can't block the grid.
  const summaryQ = useSWR<CoverageSummary | null>("mitre:coverage-summary", () =>
    getCoverageSummary().catch(() => null)
  );
  const trendQ = useSWR<CoverageTrend | null>("mitre:coverage-trend-30", () =>
    getCoverageTrend(30).catch(() => null)
  );
  const coverageSummary = summaryQ.data ?? null;
  const coverageTrend = trendQ.data ?? null;
  const summaryLoading =
    (!summaryQ.data && !summaryQ.error) || (!trendQ.data && !trendQ.error);

  useEffect(() => {
    if (focus === "uncovered") setStatusFilter("unmapped");
  }, [focus]);

  const loadAtomicTestsForTechnique = useCallback(async (techniqueId: string) => {
    if (atomicCatalogAvailable === false) {
      setSheetAtomicTests([]);
      setSheetLoading(false);
      return;
    }

    const cached = atomicTestsByTechnique[techniqueId];
    if (cached) {
      setSheetAtomicTests(cached);
      setSheetLoading(false);
      return;
    }

    setSheetLoading(true);
    setSheetAtomicTests([]);
    try {
      const result = await getAtomicTests({ technique_id: techniqueId, limit: 100, silent: true });
      const items = result.items || [];
      setSheetAtomicTests(items);
      setAtomicTestsByTechnique((prev) => ({ ...prev, [techniqueId]: items }));
    } catch {
      setSheetAtomicTests([]);
    } finally {
      setSheetLoading(false);
    }
  }, [atomicCatalogAvailable, atomicTestsByTechnique]);

  const handleSelectTechnique = useCallback((item: TechniqueCoverage) => {
    setSelectedTechnique(item);
    loadAtomicTestsForTechnique(item.id);
  }, [loadAtomicTestsForTechnique]);

  const handleSelectTactic = useCallback((tactic: string) => {
    setSelectedTechnique(null);
    setSelectedTactic(tactic);
  }, []);

  const handleSelectTechniqueFromTactic = useCallback((item: TechniqueCoverage) => {
    setSelectedTactic(null);
    setSelectedTechnique(item);
    loadAtomicTestsForTechnique(item.id);
  }, [loadAtomicTestsForTechnique]);

  const togglePlatform = useCallback((p: PlatformFilter) => {
    setPlatformFilters((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const enriched = useMemo<TechniqueCoverage[]>(() => {
    const byTechnique = new Map<string, Detection[]>();
    for (const det of detections) {
      if (!det.technique_id) continue;
      const list = byTechnique.get(det.technique_id) || [];
      list.push(det);
      byTechnique.set(det.technique_id, list);
    }

    return techniques.map((t) => {
      const mapped = byTechnique.get(t.id) || [];
      const tested = mapped.filter((d) => Boolean(d.last_result));
      const validated = mapped.filter((d) => (d.last_result || "").toUpperCase() === "PASS");
      const highestScore = mapped.reduce<number | undefined>((best, d) => {
        if (typeof d.last_score !== "number") return best;
        if (typeof best !== "number") return d.last_score;
        return Math.max(best, d.last_score);
      }, undefined);

      return {
        id: t.id,
        name: t.name || t.id,
        tactics: t.tactics || [],
        platforms: t.platforms || [],
        mappedCount: mapped.length,
        testedCount: tested.length,
        validatedCount: validated.length,
        highestScore,
      };
    });
  }, [detections, techniques]);

  const allTactics = useMemo(
    () => Array.from(new Set(enriched.flatMap((t) => t.tactics))).sort(),
    [enriched]
  );

  const matrix = useMemo(() => {
    const q = search.toLowerCase().trim();
    const activePlatforms = Array.from(platformFilters);
    return allTactics.map((tactic) => {
      const techniques = enriched
        .filter((item) => item.tactics.includes(tactic))
        .filter((item) => {
          if (statusFilter !== "all" && getStatus(item) !== statusFilter) return false;
          if (q && !item.id.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
          if (activePlatforms.length > 0) {
            // OR across selected platforms — "show me anything that runs on
            // Windows OR Linux" is more useful than requiring both.
            const anyMatch = activePlatforms.some((p) => platformMatches(item.platforms, p));
            if (!anyMatch) return false;
          }
          return true;
        })
        .sort((a, b) => {
          const priority: Record<CoverageStatus, number> = { unmapped: 0, mapped: 1, at_risk: 2, validated: 3 };
          return priority[getStatus(a)] - priority[getStatus(b)];
        });

      const validated = techniques.filter((t) => getStatus(t) === "validated").length;
      const total = techniques.length;

      return {
        tactic,
        techniques,
        total,
        validated,
        coverage: total > 0 ? Math.round((validated / total) * 100) : 0,
      };
    }).filter((col) => col.total > 0);
  }, [allTactics, enriched, search, statusFilter, platformFilters]);

  const counts = useMemo(() => {
    const c = { total: enriched.length, validated: 0, at_risk: 0, mapped: 0, unmapped: 0 };
    for (const item of enriched) {
      const s = getStatus(item);
      if (s === "validated") c.validated++;
      else if (s === "at_risk") c.at_risk++;
      else if (s === "mapped") c.mapped++;
      else c.unmapped++;
    }
    return c;
  }, [enriched]);

  const validatedPercent = counts.total > 0 ? Math.round((counts.validated / counts.total) * 100) : 0;

  const focusedColumn = selectedTactic ? matrix.find((c) => c.tactic === selectedTactic) : null;

  // CSV export — reflects the currently-filtered matrix so "export what I'm
  // looking at" is the obvious mental model. RFC-4180-ish quoting is good
  // enough for Excel/Sheets round-trip.
  const handleExportCsv = useCallback(() => {
    const header = [
      "tactic",
      "technique_id",
      "technique_name",
      "status",
      "detections_linked",
      "detections_tested",
      "detections_validated",
      "platforms",
    ];
    const escape = (v: string | number) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines: string[] = [header.join(",")];
    for (const col of matrix) {
      for (const t of col.techniques) {
        lines.push([
          escape(col.tactic),
          escape(t.id),
          escape(t.name),
          escape(STATUS_LABEL[getStatus(t)]),
          escape(t.mappedCount),
          escape(t.testedCount),
          escape(t.validatedCount),
          escape(t.platforms.join("|")),
        ].join(","));
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `purvex-mitre-coverage-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Delay revoke so Safari finishes the download before the blob is GC'd.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [matrix]);

  if (loading) {
    return (
      <PageContainer maxWidth="full">
        <PageSkeleton stats={3} withEyebrow withActions variant="cards" rows={6} />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Card><CardContent className="pt-6"><p className={toneClasses("danger").text}>{error}</p></CardContent></Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="full" className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 border-b border-[var(--stroke-soft)] pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--surface-subtle-foreground)]">MITRE ATT&amp;CK</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--foreground)]">Coverage Matrix</h1>
          <p className="mt-1 text-sm text-[var(--surface-subtle-foreground)]">
            {counts.total} techniques · {validatedPercent}% validated · {matrix.length} tactics in view
          </p>
        </div>

        <div className="flex items-center gap-4 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-5 py-3">
          <StatInline label="Validated" value={counts.validated} color={toneClasses("success").text} />
          <Divider />
          <StatInline label="At risk" value={counts.at_risk} color={toneClasses("warning").text} />
          <Divider />
          <StatInline label="Linked" value={counts.mapped} color={toneClasses("info").text} />
          <Divider />
          <StatInline label="Unmapped" value={counts.unmapped} color={toneClasses("muted").text} />
        </div>
      </div>

      {coverageSummary ? (
        <ExecutiveSummary
          summary={coverageSummary}
          trend={coverageTrend}
          onTechniqueClick={(id) => {
            const found = enriched.find((t) => t.id === id);
            if (found) handleSelectTechnique(found);
            else router.push(`/detections?search=${encodeURIComponent(id)}`);
          }}
        />
      ) : summaryLoading ? (
        <ExecutiveSummarySkeleton />
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--surface-subtle-foreground)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by technique ID or name..."
            className="h-10 border-[var(--stroke-soft)] bg-[var(--surface-card)] pl-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-1">
          {(["all", "validated", "at_risk", "mapped", "unmapped"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                statusFilter === s
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {s !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", toneClasses(STATUS_TONE[s]).bg)} />}
              {s === "all" ? "All" : STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-1">
          {PLATFORM_FILTER_OPTIONS.map((p) => {
            const active = platformFilters.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                aria-pressed={active}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition",
                  active
                    ? "bg-[var(--accent-strong)] text-white"
                    : "text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]"
                )}
              >
                {p}
              </button>
            );
          })}
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          className="h-9 gap-1.5 text-xs"
          aria-label="Export matrix as CSV"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>

        {atomicCatalogAvailable && (
          <Chip tone="accent" size="md">
            <FlaskConical className="h-3.5 w-3.5" />
            Atomic tests load on selection
          </Chip>
        )}
        {atomicCatalogAvailable === false && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleInstallCatalog}
            disabled={installingCatalog}
            className="h-9 gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            {installingCatalog ? "Installing catalog..." : "Install Atomic Red Team catalog"}
          </Button>
        )}
      </div>

      {/* Matrix */}
      {matrix.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-12 text-center">
          <Target className="mx-auto h-10 w-10 text-[var(--surface-subtle-foreground)]" />
          <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">No techniques match your filters</p>
          <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">Try clearing filters or broadening your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {matrix.map((col) => (
              <div key={col.tactic} className="flex flex-col gap-2">
                {/* Tactic header */}
                <button
                  type="button"
                  onClick={() =>
                    selectedTactic === col.tactic
                      ? setSelectedTactic(null)
                      : handleSelectTactic(col.tactic)
                  }
                  className={cn(
                    "rounded-lg border px-3.5 py-3 text-left transition",
                    selectedTactic === col.tactic
                      ? "border-transparent bg-[var(--foreground)] text-[var(--background)]"
                      : "border-[var(--stroke-soft)] bg-[var(--surface-elevated)] hover:border-[var(--accent-line)]"
                  )}
                >
                  <p className="text-xs font-bold uppercase tracking-wider truncate">{col.tactic}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[11px] opacity-70">{col.validated}/{col.total}</span>
                    <span className={cn("text-sm font-bold", toneClasses(coverageTone(col.coverage)).text)}>
                      {col.coverage}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-subtle)] overflow-hidden">
                    <div
                      className={cn("h-full rounded-full", toneClasses(coverageTone(col.coverage)).bg)}
                      style={{ width: `${col.coverage}%` }}
                    />
                  </div>
                </button>

                {/* Technique cells */}
                <div className="space-y-1.5">
                  {col.techniques.map((item) => {
                    const status = getStatus(item);
                    const tone = STATUS_TONE[status];
                    return (
                      <button
                        key={`${col.tactic}-${item.id}`}
                        type="button"
                        onClick={() => handleSelectTechnique(item)}
                        className={cn(
                          "group w-full rounded-lg border px-3 py-2 text-left text-xs transition hover:opacity-80",
                          toneClasses(tone).border,
                          `${toneClasses(tone).bg}/15`,
                          toneClasses(tone).text,
                        )}
                      >
                        <p className="font-mono font-bold truncate">{item.id}</p>
                        <p className="truncate text-[11px] opacity-90 mt-0.5">{item.name}</p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Focused tactic drill-down */}
      {focusedColumn && (
        <div className="hidden rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-strong)]">Tactic focus</p>
              <h3 className="text-lg font-bold text-[var(--foreground)] dark:text-white">{focusedColumn.tactic}</h3>
            </div>
            <button onClick={() => setSelectedTactic(null)} className="text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {focusedColumn.techniques.map((item) => {
              const status = getStatus(item);
              const tone = STATUS_TONE[status];
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectTechnique(item)}
                  className="flex items-start gap-3 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-left transition hover:bg-[var(--surface-subtle)]"
                >
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", toneClasses(tone).bg)} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-bold text-[var(--accent-strong)]">{item.id}</p>
                    <p className="truncate text-sm text-[var(--foreground)]">{item.name}</p>
                    <p className="text-[11px] text-[var(--surface-subtle-foreground)]">{STATUS_LABEL[status]} · {item.mappedCount} linked</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Technique detail — right Sheet slide-in */}
      <Sheet open={!!selectedTactic} onOpenChange={(open) => { if (!open) setSelectedTactic(null); }}>
        <SheetContent
          side="right"
          className="border-[var(--stroke-soft)] bg-[var(--surface-card)] text-[var(--foreground)]"
        >
          {focusedColumn && (
            <>
              <SheetHeader className="border-[var(--stroke-soft)]">
                <div className="flex items-center gap-2 mb-1">
                  <Chip tone="muted" size="sm">Tactic lane</Chip>
                </div>
                <SheetTitle className="pr-8 text-[var(--foreground)]">{focusedColumn.tactic}</SheetTitle>
                <SheetDescription className="text-[var(--surface-subtle-foreground)]">
                  {focusedColumn.validated} of {focusedColumn.total} techniques validated across this lane.
                </SheetDescription>
              </SheetHeader>

              <SheetBody className="px-5">
                <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-[var(--surface-subtle-foreground)]">
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">{focusedColumn.total}</span> techniques in scope
                  </span>
                  <Divider />
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">{focusedColumn.validated}</span> validated
                  </span>
                  <Divider />
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">{focusedColumn.coverage}%</span> coverage
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {focusedColumn.techniques.map((item) => {
                    const status = getStatus(item);
                    const tone = STATUS_TONE[status];
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleSelectTechniqueFromTactic(item)}
                        className="flex items-start gap-3 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-left transition hover:bg-[var(--surface-subtle)]"
                      >
                        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", toneClasses(tone).bg)} />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-xs font-bold text-[var(--accent-strong)]">{item.id}</p>
                          <p className="truncate text-sm text-[var(--foreground)]">{item.name}</p>
                          <p className="text-[11px] text-[var(--surface-subtle-foreground)]">{STATUS_LABEL[status]} · {item.mappedCount} linked</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </SheetBody>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!selectedTechnique} onOpenChange={(open) => { if (!open) setSelectedTechnique(null); }}>
        <SheetContent
          side="right"
          className="border-[var(--stroke-soft)] bg-[var(--surface-card)] text-[var(--foreground)]"
        >
          {selectedTechnique && (
            <>
              <SheetHeader className="border-[var(--stroke-soft)]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm font-bold text-[var(--accent-strong)]">{selectedTechnique.id}</span>
                  <Chip tone={STATUS_TONE[getStatus(selectedTechnique)]} dot size="sm">
                    {STATUS_LABEL[getStatus(selectedTechnique)]}
                  </Chip>
                </div>
                <SheetTitle className="pr-8 text-[var(--foreground)]">{selectedTechnique.name}</SheetTitle>
                <SheetDescription className="text-[var(--surface-subtle-foreground)]">
                  {selectedTechnique.tactics.join(", ")}
                </SheetDescription>
              </SheetHeader>

              <SheetBody className="px-5">
                <div className="mb-6 flex flex-wrap items-center gap-4 text-sm text-[var(--surface-subtle-foreground)]">
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">{selectedTechnique.mappedCount}</span> linked
                  </span>
                  <Divider />
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">{selectedTechnique.testedCount}</span> tested
                  </span>
                  <Divider />
                  <span>
                    <span className="font-semibold text-[var(--foreground)]">{selectedTechnique.validatedCount}</span> passing
                  </span>
                </div>

                {/* Atomic tests */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--surface-subtle-foreground)] mb-3">
                    Atomic Red Team Tests
                  </h4>

                  {sheetLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-[var(--surface-subtle-foreground)]" />
                    </div>
                  ) : sheetAtomicTests.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-6 text-center">
                      <FlaskConical className="mx-auto h-8 w-8 text-[var(--surface-subtle-foreground)]" />
                      <p className="mt-2 text-sm text-[var(--surface-subtle-foreground)]">No atomic tests found for this technique.</p>
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-[var(--stroke-soft)] divide-y divide-[var(--stroke-soft)]">
                      {sheetAtomicTests.map((test, i) => (
                        <AtomicTestCard
                          key={test.id || i}
                          test={test}
                          onRun={() => {
                            const params = new URLSearchParams({
                              step: "3",
                              focus: "stale",
                              technique_id: test.technique_id || selectedTechnique.id,
                            });
                            if (test.id) params.set("atomic_id", String(test.id));
                            if (test.name) params.set("atomic_name", String(test.name));
                            if (test.test_number) params.set("atomic_number", String(test.test_number));
                            router.push(`/run-test?${params.toString()}`);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </SheetBody>

              <SheetFooter className="border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(`/detections?search=${encodeURIComponent(selectedTechnique.id)}`)
                  }
                >
                  Explore detections
                </Button>
                <Button onClick={() => router.push(`/run-test?technique_id=${selectedTechnique.id}`)}>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Run test
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function AtomicTestCard({ test, onRun }: { test: AtomicTestDefinition; onRun: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const name = test.name || test.test_name || `Test ${test.auto_generated_guid || ""}`;
  const description = test.description || "";
  const platforms = test.supported_platforms || [];
  const primaryCommand = test.command || test.executor?.command || "";
  const cleanupCommand = test.cleanup_command || test.executor?.cleanup_command || "";
  const executorName = test.executor_name || test.executor?.name || "Command";

  return (
    <div className="bg-[var(--surface-elevated)]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[var(--surface-subtle)]"
      >
        <ChevronRight className={cn("h-4 w-4 text-[var(--surface-subtle-foreground)] shrink-0 transition-transform", expanded && "rotate-90")} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--foreground)]">{name}</p>
          {platforms.length > 0 && (
            <div className="flex gap-1 mt-1">
              {platforms.map((p: string) => (
                <span key={p} className="rounded bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--surface-subtle-foreground)]">
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0"
          onClick={(event) => {
            event.stopPropagation();
            onRun();
          }}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" />
          Run
        </Button>
      </button>

      {expanded && (
        <div className="border-t border-[var(--stroke-soft)] px-4 py-3">
          {description && (
            <p className="mb-3 whitespace-pre-wrap text-xs text-[var(--surface-subtle-foreground)]">{description}</p>
          )}
          {primaryCommand && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--surface-subtle-foreground)] mb-1">
                {executorName}
              </p>
              <pre className="rounded-lg bg-slate-900 p-3 text-xs text-slate-100 overflow-x-auto whitespace-pre-wrap dark:bg-slate-950">
                {primaryCommand}
              </pre>
            </div>
          )}
          {cleanupCommand && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--surface-subtle-foreground)] mb-1">
                Cleanup command
              </p>
              <pre className="rounded-lg bg-slate-900 p-3 text-xs text-slate-100 overflow-x-auto whitespace-pre-wrap dark:bg-slate-950">
                {cleanupCommand}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatInline({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)]">{label}</span>
      <span className={cn("text-xl font-bold", color)}>{value}</span>
    </div>
  );
}

function Divider() {
  return <span className="h-8 w-px bg-[var(--stroke-soft)]" />;
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--surface-subtle-foreground)]">{label}</p>
      <p className="mt-1 text-xl font-bold text-[var(--foreground)]">{value}</p>
    </div>
  );
}

/**
 * Zero-dependency SVG sparkline. Intentionally tiny — ~60 lines of markup
 * with no ResizeObserver, no animation loop, no chart framework. A 30-point
 * trend renders in well under 1ms and never triggers layout thrash, which
 * matters here because the /mitre page has ~700 other buttons competing for
 * the main thread on first paint.
 */
function Sparkline({
  values,
  labels,
  width = 240,
  height = 48,
}: {
  values: number[];
  labels: string[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padX = 2;
  const padY = 4;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const toX = (i: number) => padX + (i / (values.length - 1)) * innerW;
  const toY = (v: number) => padY + innerH - ((v - min) / range) * innerH;

  const pathD = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(v).toFixed(1)}`)
    .join(" ");
  const areaD = `${pathD} L ${toX(values.length - 1).toFixed(1)} ${(height - padY).toFixed(1)} L ${toX(0).toFixed(1)} ${(height - padY).toFixed(1)} Z`;

  const lastIdx = values.length - 1;
  const lastDate = labels[lastIdx] ? new Date(labels[lastIdx]).toLocaleDateString() : "";
  const firstDate = labels[0] ? new Date(labels[0]).toLocaleDateString() : "";

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="overflow-visible"
        role="img"
        aria-label={`Validated techniques trend: ${values[0]} on ${firstDate} to ${values[lastIdx]} on ${lastDate}`}
      >
        <path d={areaD} fill="var(--accent-soft)" />
        <path d={pathD} fill="none" stroke="var(--accent-strong)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={toX(lastIdx)} cy={toY(values[lastIdx])} r={2.5} fill="var(--accent-strong)" />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--surface-subtle-foreground)]">
        <span>{firstDate}</span>
        <span>{lastDate}</span>
      </div>
    </div>
  );
}

function ExecutiveSummarySkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 dark:border-white/10 dark:bg-white/5 lg:col-span-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-9 w-28" />
        <Skeleton className="mt-3 h-14 w-full" />
      </div>
      <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 dark:border-white/10 dark:bg-white/5 lg:col-span-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-4 w-40" />
        <div className="mt-4 space-y-2.5">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      </div>
    </div>
  );
}

// Color the "next actions" chips by severity so the eye lands on CRITICAL first.
const CRITICALITY_TONE: Record<string, NonNullable<ChipProps["tone"]>> = {
  CRITICAL: "danger",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "muted",
};

function ExecutiveSummary({
  summary,
  trend,
  onTechniqueClick,
}: {
  summary: CoverageSummary;
  trend: CoverageTrend | null;
  onTechniqueClick: (techniqueId: string) => void;
}) {
  // Merge failing + untested into a single prioritized action list. Failing
  // rules come first because "your rule is broken" is a higher-urgency signal
  // than "you haven't tested this yet".
  const topActions = [
    ...summary.top_failing_high_value.map((g) => ({ ...g, reason: "failing" as const })),
    ...summary.top_untested_high_value.map((g) => ({ ...g, reason: "untested" as const })),
  ].slice(0, 5);

  const trendPoints = trend?.points.map((p) => ({ day: p.day, validated: p.validated })) || [];
  const trendDelta = (() => {
    if (trendPoints.length < 2) return 0;
    const first = trendPoints[0].validated;
    const last = trendPoints[trendPoints.length - 1].validated;
    return last - first;
  })();

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Weighted coverage + sparkline */}
      <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 dark:border-white/10 dark:bg-white/5 lg:col-span-1">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-strong)]">
              Weighted coverage
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums text-[var(--foreground)]">
              {summary.weighted_coverage_percent.toFixed(1)}
              <span className="ml-1 text-lg font-semibold text-[var(--surface-subtle-foreground)]">%</span>
            </p>
            <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">
              Of instrumented techniques, weighted by severity.
            </p>
          </div>
          {trendDelta !== 0 && (
            <Chip
              tone={trendDelta > 0 ? "success" : "danger"}
              title="Change in validated techniques over the last 30 days"
            >
              <TrendingUp className={cn("h-3 w-3", trendDelta < 0 && "rotate-180")} />
              {trendDelta > 0 ? "+" : ""}{trendDelta}
            </Chip>
          )}
        </div>

        {trendPoints.length > 1 && (
          <div className="mt-3">
            <Sparkline
              values={trendPoints.map((p) => p.validated)}
              labels={trendPoints.map((p) => p.day)}
            />
          </div>
        )}

        <div className="mt-3 flex items-center gap-4 text-[11px] text-[var(--surface-subtle-foreground)]">
          <span>
            Simple:{" "}
            <span className="font-semibold text-[var(--foreground)]">
              {summary.simple_coverage_percent.toFixed(1)}%
            </span>
          </span>
          <span>·</span>
          <span>
            {summary.totals.validated} of {summary.totals.total_techniques} techniques validated
          </span>
        </div>
      </div>

      {/* Next actions */}
      <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 dark:border-white/10 dark:bg-white/5 lg:col-span-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--accent-strong)]">
              Next actions
            </p>
            <p className="text-sm font-semibold text-[var(--foreground)] dark:text-white">
              Top high-value gaps
            </p>
          </div>
          <span className="text-[11px] text-[var(--surface-subtle-foreground)]">Sorted by severity</span>
        </div>

        {topActions.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--surface-subtle-foreground)]">
            No high-value gaps — every HIGH and CRITICAL detection is validated. Nicely done.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-200 dark:divide-white/10">
            {topActions.map((action) => (
              <li key={`${action.reason}-${action.technique_id}`}>
                <button
                  type="button"
                  onClick={() => onTechniqueClick(action.technique_id)}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition hover:bg-[var(--surface-subtle)]"
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      `${toneClasses(action.reason === "failing" ? "danger" : "warning").bg}/15`,
                      toneClasses(action.reason === "failing" ? "danger" : "warning").text,
                    )}
                    title={action.reason === "failing" ? "Detection is failing" : "Never tested"}
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-bold text-[var(--accent-strong)]">
                        {action.technique_id}
                      </span>
                      <Chip tone={CRITICALITY_TONE[action.max_criticality] || CRITICALITY_TONE.MEDIUM} size="sm">
                        {action.max_criticality}
                      </Chip>
                      <span className="text-[11px] text-[var(--surface-subtle-foreground)]">
                        {action.reason === "failing" ? "Failing" : "Never tested"}
                      </span>
                    </div>
                    <p className="truncate text-sm text-[var(--foreground)]">
                      {action.technique_name}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[var(--surface-subtle-foreground)]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function MitreViewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface-page)]" />}>
      <MitreViewPageContent />
    </Suspense>
  );
}
