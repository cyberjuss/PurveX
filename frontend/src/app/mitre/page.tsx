"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/page-container";
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
  type Detection,
  type MitreTechnique,
  type AtomicTestDefinition,
} from "@/lib/api";
import { Loader2, Search, Play, Target, X, FlaskConical, ChevronRight } from "lucide-react";

type CoverageStatus = "validated" | "at_risk" | "mapped" | "unmapped";

type TechniqueCoverage = {
  id: string;
  name: string;
  tactics: string[];
  mappedCount: number;
  testedCount: number;
  validatedCount: number;
  highestScore?: number;
};

function getStatus(item: TechniqueCoverage): CoverageStatus {
  if (item.validatedCount > 0) return "validated";
  if (item.testedCount > 0) return "at_risk";
  if (item.mappedCount > 0) return "mapped";
  return "unmapped";
}

const STATUS_META: Record<CoverageStatus, { label: string; cell: string; dot: string; ring: string }> = {
  validated: {
    label: "Validated",
    cell: "bg-emerald-500 hover:bg-emerald-600 text-white",
    dot: "bg-emerald-500",
    ring: "ring-emerald-400",
  },
  at_risk: {
    label: "At risk",
    cell: "bg-amber-400 hover:bg-amber-500 text-white",
    dot: "bg-amber-400",
    ring: "ring-amber-400",
  },
  mapped: {
    label: "Linked — Not tested",
    cell: "bg-sky-300 hover:bg-sky-400 text-slate-900",
    dot: "bg-sky-400",
    ring: "ring-sky-400",
  },
  unmapped: {
    label: "Unmapped",
    cell: "bg-slate-100 hover:bg-slate-200 text-slate-500",
    dot: "bg-slate-300",
    ring: "ring-slate-300",
  },
};

function MitreViewPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");

  const [detections, setDetections] = useState<Detection[]>([]);
  const [techniques, setTechniques] = useState<MitreTechnique[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CoverageStatus>("all");
  const [atomicOnly, setAtomicOnly] = useState(false);
  const [atomicTechniqueIds, setAtomicTechniqueIds] = useState<Set<string>>(new Set());
  const [atomicCatalogAvailable, setAtomicCatalogAvailable] = useState<boolean | null>(null);
  const [selectedTactic, setSelectedTactic] = useState<string | null>(null);
  const [selectedTechnique, setSelectedTechnique] = useState<TechniqueCoverage | null>(null);

  const [sheetAtomicTests, setSheetAtomicTests] = useState<AtomicTestDefinition[]>([]);
  const [sheetLoading, setSheetLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [dets, techs] = await Promise.all([getDetections(), getMitreTechniques()]);
        setDetections(dets);
        setTechniques(techs);

        // Build set of technique IDs that have atomic tests
        try {
          const catalog = await getAtomicTests({ limit: 5000, silent: true });
          const ids = new Set<string>();
          for (const t of catalog.items || []) {
            if (t.technique_id) ids.add(t.technique_id);
          }
          setAtomicTechniqueIds(ids);
          setAtomicCatalogAvailable(true);
        } catch {
          // Atomic catalog may not be installed — silently skip
          setAtomicCatalogAvailable(false);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load MITRE data.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  useEffect(() => {
    if (focus === "uncovered") setStatusFilter("unmapped");
  }, [focus]);

  const loadAtomicTestsForTechnique = useCallback(async (techniqueId: string) => {
    setSheetLoading(true);
    setSheetAtomicTests([]);
    try {
      const result = await getAtomicTests({ technique_id: techniqueId, limit: 50 });
      setSheetAtomicTests(result.items || []);
    } catch {
      setSheetAtomicTests([]);
    } finally {
      setSheetLoading(false);
    }
  }, []);

  const handleSelectTechnique = useCallback((item: TechniqueCoverage) => {
    setSelectedTechnique(item);
    loadAtomicTestsForTechnique(item.id);
  }, [loadAtomicTestsForTechnique]);

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
    return allTactics.map((tactic) => {
      const techniques = enriched
        .filter((item) => item.tactics.includes(tactic))
        .filter((item) => {
          if (statusFilter !== "all" && getStatus(item) !== statusFilter) return false;
          if (atomicOnly && !atomicTechniqueIds.has(item.id)) return false;
          if (q && !item.id.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
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
  }, [allTactics, enriched, search, statusFilter, atomicOnly, atomicTechniqueIds]);

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

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Card><CardContent className="pt-6"><p className="text-red-600">{error}</p></CardContent></Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="full" className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10">
            <Target className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">MITRE ATT&amp;CK</p>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Coverage Matrix</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {counts.total} techniques · {validatedPercent}% validated · {matrix.length} tactics in view
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-3 dark:border-white/10 dark:bg-white/5">
          <StatInline label="Validated" value={counts.validated} color="text-emerald-600" />
          <Divider />
          <StatInline label="At risk" value={counts.at_risk} color="text-amber-600" />
          <Divider />
          <StatInline label="Linked" value={counts.mapped} color="text-sky-600" />
          <Divider />
          <StatInline label="Unmapped" value={counts.unmapped} color="text-slate-500" />
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by technique ID or name..."
            className="h-10 border-slate-200 bg-white pl-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-white/5">
          {(["all", "validated", "at_risk", "mapped", "unmapped"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                statusFilter === s ? "bg-slate-900 text-white dark:bg-white dark:text-black" : "text-slate-600 hover:text-slate-900 dark:text-slate-300"
              )}
            >
              {s !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[s].dot)} />}
              {s === "all" ? "All" : STATUS_META[s].label}
            </button>
          ))}
        </div>

        {atomicTechniqueIds.size > 0 && (
          <button
            type="button"
            onClick={() => setAtomicOnly(!atomicOnly)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition",
              atomicOnly
                ? "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-300"
                : "border-slate-200 bg-white text-slate-600 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
            )}
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Has Atomic Tests
          </button>
        )}
        {atomicCatalogAvailable === false && (
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Atomic catalog not installed. Install it to enable Atomic test filters.
          </span>
        )}
      </div>

      {/* Matrix */}
      {matrix.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-12 text-center">
          <Target className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No techniques match your filters</p>
          <p className="mt-1 text-xs text-slate-500">Try clearing filters or broadening your search.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex gap-2.5 min-w-max">
            {matrix.map((col) => (
              <div key={col.tactic} className="flex w-[220px] flex-col gap-2">
                {/* Tactic header */}
                <button
                  type="button"
                  onClick={() => setSelectedTactic(selectedTactic === col.tactic ? null : col.tactic)}
                  className={cn(
                    "rounded-lg border px-3.5 py-3 text-left transition",
                    selectedTactic === col.tactic
                      ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-black"
                      : "border-slate-200 bg-slate-50 hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                  )}
                >
                  <p className="text-xs font-bold uppercase tracking-wider truncate">{col.tactic}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[11px] opacity-70">{col.validated}/{col.total}</span>
                    <span className={cn(
                      "text-sm font-bold",
                      col.coverage >= 75 ? "text-emerald-500" : col.coverage >= 40 ? "text-amber-500" : "text-rose-500"
                    )}>
                      {col.coverage}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        col.coverage >= 75 ? "bg-emerald-500" : col.coverage >= 40 ? "bg-amber-400" : "bg-rose-400"
                      )}
                      style={{ width: `${col.coverage}%` }}
                    />
                  </div>
                </button>

                {/* Technique cells */}
                <div className="space-y-1.5">
                  {col.techniques.map((item) => {
                    const status = getStatus(item);
                    const meta = STATUS_META[status];
                    return (
                      <button
                        key={`${col.tactic}-${item.id}`}
                        type="button"
                        onClick={() => handleSelectTechnique(item)}
                        className={cn(
                          "group w-full rounded-lg px-3 py-2 text-left text-xs transition ring-0 hover:ring-2",
                          meta.cell,
                          meta.ring
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
        </div>
      )}

      {/* Focused tactic drill-down */}
      {focusedColumn && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-600">Tactic focus</p>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">{focusedColumn.tactic}</h3>
            </div>
            <button onClick={() => setSelectedTactic(null)} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {focusedColumn.techniques.map((item) => {
              const status = getStatus(item);
              const meta = STATUS_META[status];
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectTechnique(item)}
                  className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-left hover:bg-slate-100 dark:border-white/10 dark:bg-white/5"
                >
                  <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", meta.dot)} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-bold text-indigo-600">{item.id}</p>
                    <p className="truncate text-sm text-slate-700 dark:text-slate-200">{item.name}</p>
                    <p className="text-[11px] text-slate-400">{meta.label} · {item.mappedCount} linked</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Technique detail — right Sheet slide-in */}
      <Sheet open={!!selectedTechnique} onOpenChange={(open) => { if (!open) setSelectedTechnique(null); }}>
        <SheetContent side="right">
          {selectedTechnique && (
            <>
              <SheetHeader>
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn("h-2.5 w-2.5 rounded-full", STATUS_META[getStatus(selectedTechnique)].dot)} />
                  <span className="font-mono text-sm font-bold text-indigo-600">{selectedTechnique.id}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-white/5 dark:text-slate-300">
                    {STATUS_META[getStatus(selectedTechnique)].label}
                  </span>
                </div>
                <SheetTitle>{selectedTechnique.name}</SheetTitle>
                <SheetDescription>
                  {selectedTechnique.tactics.join(", ")}
                </SheetDescription>
              </SheetHeader>

              <SheetBody>
                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mb-6">
                  <StatBlock label="Linked" value={selectedTechnique.mappedCount} />
                  <StatBlock label="Tested" value={selectedTechnique.testedCount} />
                  <StatBlock label="Passing" value={selectedTechnique.validatedCount} />
                </div>

                {/* Atomic tests */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                    Atomic Red Team Tests
                  </h4>

                  {sheetLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  ) : sheetAtomicTests.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center">
                      <FlaskConical className="mx-auto h-8 w-8 text-slate-300" />
                      <p className="mt-2 text-sm text-slate-500">No atomic tests found for this technique.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sheetAtomicTests.map((test, i) => (
                        <AtomicTestCard key={test.id || i} test={test} />
                      ))}
                    </div>
                  )}
                </div>
              </SheetBody>

              <SheetFooter>
                <Button variant="outline" onClick={() => router.push(`/tests/explore/${selectedTechnique.id}`)}>
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

function AtomicTestCard({ test }: { test: AtomicTestDefinition }) {
  const [expanded, setExpanded] = useState(false);
  const name = test.name || test.test_name || `Test ${test.auto_generated_guid || ""}`;
  const description = test.description || "";
  const platforms = test.supported_platforms || [];
  const primaryCommand = test.command || test.executor?.command || "";
  const cleanupCommand = test.cleanup_command || test.executor?.cleanup_command || "";
  const executorName = test.executor_name || test.executor?.name || "Command";

  return (
    <div className="rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/5 transition"
      >
        <ChevronRight className={cn("h-4 w-4 text-slate-400 shrink-0 transition-transform", expanded && "rotate-90")} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{name}</p>
          {platforms.length > 0 && (
            <div className="flex gap-1 mt-1">
              {platforms.map((p: string) => (
                <span key={p} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  {p}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-700 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 line-clamp-2">
            {primaryCommand || "No executable command published for this atomic test."}
          </p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-white/5">
          {description && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-3 whitespace-pre-wrap">{description}</p>
          )}
          {primaryCommand && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                {executorName}
              </p>
              <pre className="rounded-lg bg-slate-900 p-3 text-xs text-slate-100 overflow-x-auto whitespace-pre-wrap">
                {primaryCommand}
              </pre>
            </div>
          )}
          {cleanupCommand && (
            <div className="mt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Cleanup command
              </p>
              <pre className="rounded-lg bg-slate-900 p-3 text-xs text-slate-100 overflow-x-auto whitespace-pre-wrap">
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
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <span className={cn("text-xl font-bold", color)}>{value}</span>
    </div>
  );
}

function Divider() {
  return <span className="h-8 w-px bg-slate-200 dark:bg-white/10" />;
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center dark:bg-white/5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
    </div>
  );
}

export default function MitreViewPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <MitreViewPageContent />
    </Suspense>
  );
}
