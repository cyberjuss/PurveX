import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { toneClasses } from "@/lib/status-tone";
import { cn } from "@/lib/utils";
import type { Detection, MitreTechnique } from "@/lib/api";

const TECHNIQUE_PICKER_PAGE_SIZE = 12;

const TECHNIQUE_STATUS_META: Record<
  "validated" | "at_risk" | "mapped" | "unmapped",
  { label: string; tone: NonNullable<ChipProps["tone"]> }
> = {
  validated: { label: "Validated", tone: "success" },
  at_risk: { label: "At risk", tone: "warning" },
  mapped: { label: "Mapped only", tone: "info" },
  unmapped: { label: "Unmapped", tone: "muted" },
};

export function TechniquePicker({
  mitreTechniques,
  detections,
  techniqueFromExplore,
  scenarioCardTitle,
  scenarioDescriptionFromExplore,
  coverageScenarioConfirmed,
  onConfirmScenario,
  onSelectTechnique,
}: {
  mitreTechniques: MitreTechnique[];
  detections: Detection[];
  techniqueFromExplore: string | null;
  scenarioCardTitle: string;
  scenarioDescriptionFromExplore: string;
  coverageScenarioConfirmed: boolean;
  onConfirmScenario: () => void;
  onSelectTechnique: (techniqueId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [tactic, setTactic] = useState("all");
  const [page, setPage] = useState(0);

  const allTactics = useMemo(
    () => Array.from(new Set(mitreTechniques.flatMap((t) => t.tactics || []))).sort(),
    [mitreTechniques]
  );

  const enriched = useMemo(() => {
    const byTechnique = new Map<string, Detection[]>();
    for (const det of detections) {
      if (!det.technique_id) continue;
      const list = byTechnique.get(det.technique_id) || [];
      list.push(det);
      byTechnique.set(det.technique_id, list);
    }
    return mitreTechniques.map((t) => {
      const mapped = byTechnique.get(t.id) || [];
      const tested = mapped.filter((d) => Boolean(d.last_result));
      const validated = mapped.filter((d) => (d.last_result || "").toUpperCase() === "PASS");
      const highestScore = mapped.reduce<number | undefined>((best, d) => {
        if (typeof d.last_score !== "number") return best;
        if (typeof best !== "number") return d.last_score;
        return Math.max(best, d.last_score);
      }, undefined);
      let status: "validated" | "at_risk" | "mapped" | "unmapped";
      if (validated.length > 0) status = "validated";
      else if (tested.length > 0) status = "at_risk";
      else if (mapped.length > 0) status = "mapped";
      else status = "unmapped";
      return {
        id: t.id,
        name: t.name || t.id,
        tactics: t.tactics || [],
        mappedCount: mapped.length,
        validatedCount: validated.length,
        highestScore,
        status,
      };
    });
  }, [detections, mitreTechniques]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = enriched.filter((item) => {
      if (tactic !== "all" && !item.tactics.includes(tactic)) return false;
      if (q && !item.id.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const priority = { unmapped: 0, mapped: 1, at_risk: 2, validated: 3 } as const;
    list.sort((a, b) => priority[a.status] - priority[b.status]);
    return list;
  }, [enriched, search, tactic]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / TECHNIQUE_PICKER_PAGE_SIZE));
  const pageSlice = filtered.slice(page * TECHNIQUE_PICKER_PAGE_SIZE, (page + 1) * TECHNIQUE_PICKER_PAGE_SIZE);

  if (techniqueFromExplore) {
    const hasMatchingDetections = detections.filter((d) => d.technique_id === techniqueFromExplore).length > 0;
    return (
      <div className="space-y-3 p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
        <div>
          <p className="text-sm font-medium text-[var(--foreground)]">Scenario: {scenarioCardTitle}</p>
          <p className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
            Technique ID: {techniqueFromExplore}
          </p>
        </div>
        <p className="text-sm text-[var(--foreground)]">
          {scenarioDescriptionFromExplore ||
            "PurveX will run this scenario and look for telemetry and evidence in your SIEM, even without an onboarded detection rule."}
        </p>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="h-9 px-3"
            onClick={onConfirmScenario}
            disabled={coverageScenarioConfirmed}
          >
            {coverageScenarioConfirmed ? "Scenario selected" : "Use this scenario"}
          </Button>
          {coverageScenarioConfirmed && <Chip tone="success">Ready for Step 3</Chip>}
        </div>
        {!hasMatchingDetections && (
          <div className={cn("p-3 rounded-lg border", toneClasses("warning").border, `${toneClasses("warning").bg}/10`)}>
            <p className={cn("text-sm", toneClasses("warning").text)}>
              No detection rules match {techniqueFromExplore}. You can still run this test to verify telemetry and
              discover gaps.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--stroke-soft)]/60 p-4">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--surface-subtle-foreground)]" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search techniques by ID or name"
            className="h-10 border-[var(--stroke-soft)] bg-[var(--surface-card)] pl-9 text-sm"
          />
        </div>
        <Select
          value={tactic}
          onValueChange={(v) => {
            setTactic(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="h-10 w-[200px] border-[var(--stroke-soft)] bg-[var(--surface-card)] text-sm">
            <SelectValue placeholder="All tactics" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tactics</SelectItem>
            {allTactics.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          asChild
          className="border-[var(--stroke-soft)] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)]"
        >
          <Link href="/tests/explore">Open full explore view</Link>
        </Button>
      </div>

      {mitreTechniques.length === 0 ? (
        <div className="flex items-center justify-center p-12 text-sm text-[var(--surface-subtle-foreground)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading techniques...
        </div>
      ) : pageSlice.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-sm font-semibold text-[var(--foreground)]">No techniques match your filters</p>
          <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">Try broadening your search or clearing filters.</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pageSlice.map((item) => {
              const meta = TECHNIQUE_STATUS_META[item.status];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTechnique(item.id)}
                  className="group flex flex-col rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4 text-left transition hover:border-[var(--accent-line)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-[var(--accent-strong)]">{item.id}</span>
                    <Chip tone={meta.tone} dot>
                      {meta.label}
                    </Chip>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-[var(--foreground)]">
                    {item.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--surface-subtle-foreground)]">
                    {item.tactics[0] || "No tactic"}
                  </p>
                  <div className="mt-3 flex items-center justify-between border-t border-[var(--stroke-soft)]/60 pt-3 text-xs text-[var(--surface-subtle-foreground)]">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Mapped</p>
                      <p className="font-semibold text-[var(--foreground)]">{item.mappedCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Passing</p>
                      <p className="font-semibold text-[var(--foreground)]">{item.validatedCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Best</p>
                      <p className="font-semibold text-[var(--foreground)]">
                        {typeof item.highestScore === "number" ? item.highestScore : "—"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] py-1.5 text-xs font-semibold text-[var(--foreground)] transition group-hover:border-[var(--accent-line)] group-hover:bg-[var(--accent-soft)] group-hover:text-[var(--accent-strong)]">
                    <Play className="h-3 w-3" />
                    Select technique
                  </div>
                </button>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-[var(--stroke-soft)]/60 px-4 py-3">
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                Showing {page * TECHNIQUE_PICKER_PAGE_SIZE + 1}–
                {Math.min((page + 1) * TECHNIQUE_PICKER_PAGE_SIZE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-[var(--surface-subtle-foreground)]">
                  {page + 1} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
