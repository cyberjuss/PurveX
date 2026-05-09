"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { format, formatRelative } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  Play,
  Radar,
  Search,
  Shield,
  XCircle,
} from "lucide-react";
import { getDetections, type Detection } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SourceBadge } from "@/components/detections/source-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { PageContainer } from "@/components/layout/page-container";
import { Skeleton, SkeletonTableRows } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

type WorkspaceView = "queue" | "library";
type HealthStateKey = "HEALTHY" | "DETECTION_FAILED" | "TELEMETRY_MISSING" | "UNKNOWN";
type LifecycleStage = "DRAFT" | "ACTIVE" | "NEEDS_IMPROVEMENT" | "RETIRED";

const WORKSPACE_VIEWS: WorkspaceView[] = ["queue", "library"];

// Map trust-state → Chip tone. Route all trust-state labels through the Chip
// primitive so tone adjustments only have to happen in one place.
const HEALTH_TONE: Record<HealthStateKey, NonNullable<ChipProps["tone"]>> = {
  HEALTHY: "success",
  DETECTION_FAILED: "danger",
  TELEMETRY_MISSING: "warning",
  UNKNOWN: "neutral",
};

const HEALTH_META: Record<
  HealthStateKey,
  {
    label: string;
    tone: string;
    bg: string;
    border: string;
    headline: string;
    detail: string;
  }
> = {
  HEALTHY: {
    label: "Ready",
    tone: "text-emerald-600 dark:text-emerald-300",
    bg: "bg-emerald-500",
    border: "border-emerald-200 dark:border-emerald-500/30",
    headline: "Detection is ready for steady-state operations.",
    detail: "Telemetry arrived, the rule fired, and PurveX has current evidence for trust.",
  },
  DETECTION_FAILED: {
    label: "Needs tuning",
    tone: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-500",
    border: "border-rose-200 dark:border-rose-500/30",
    headline: "Telemetry exists, but the detection did not trigger.",
    detail: "This usually points to rule logic drift, bad field mappings, or thresholds that now miss the signal.",
  },
  TELEMETRY_MISSING: {
    label: "No logs",
    tone: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-400",
    border: "border-amber-200 dark:border-amber-500/30",
    headline: "The test ran, but no usable telemetry reached the SIEM.",
    detail: "Treat this as a pipeline problem first. Validation cannot prove trust while data is missing.",
  },
  UNKNOWN: {
    label: "Untested",
    tone: "text-slate-600 dark:text-slate-300",
    bg: "bg-slate-300 dark:bg-slate-600",
    border: "border-slate-200 dark:border-white/10",
    headline: "PurveX has no validation evidence yet.",
    detail: "This detection may be important, but it is still a claim until it has passed a real validation flow.",
  },
};

function deriveHealthState(detection: Detection): HealthStateKey {
  if (!detection.last_tested_at) return "UNKNOWN";
  switch ((detection.last_result || "").toUpperCase()) {
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

function normalizeStage(stage?: string | null): LifecycleStage {
  const value = (stage || "DRAFT").toUpperCase();
  if (value === "ACTIVE" || value === "NEEDS_IMPROVEMENT" || value === "RETIRED") return value;
  return "DRAFT";
}

function formatLifecycleStage(detection: Detection) {
  const lifecycleStage = detection.lifecycle_stage?.replaceAll("_", " ").trim();
  if (lifecycleStage) return lifecycleStage.toLowerCase();
  return normalizeStage(detection.status).replaceAll("_", " ").toLowerCase();
}

function isStaleDetection(detection: Detection) {
  if (!detection.last_tested_at) return false;
  return Date.now() - new Date(detection.last_tested_at).getTime() > 1000 * 60 * 60 * 24 * 21;
}

function getNextAction(detection: Detection) {
  const health = deriveHealthState(detection);
  if (health === "TELEMETRY_MISSING") return "Fix telemetry path";
  if (health === "DETECTION_FAILED") return "Tune detection logic";
  if (health === "UNKNOWN") return "Run first validation";
  if (isStaleDetection(detection)) return "Revalidate for drift";
  return "Monitor normally";
}

function getPriorityRank(detection: Detection) {
  const health = deriveHealthState(detection);
  if (health === "TELEMETRY_MISSING") return 0;
  if (health === "DETECTION_FAILED") return 1;
  if (health === "UNKNOWN") return 2;
  if (isStaleDetection(detection)) return 3;
  return 4;
}

function hasTechniqueMapping(detection: Detection) {
  return Boolean(detection.technique_id && detection.technique_id.trim().length > 0);
}

function getRelativeDate(value?: string | null) {
  if (!value) return "Never";
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? "Never" : formatRelative(parsed, new Date());
}

function getShortDate(value?: string | null) {
  if (!value) return "Never";
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? "Never" : format(parsed, "MMM dd, yyyy");
}

/**
 * `initialDetections` is optional SSR-fetched data plumbed through from the
 * RSC shell. When present, the detections library renders immediately with
 * real content; when absent (server fetch failed, session expired, etc.)
 * SWR handles loading on mount as before.
 */
type DetectionsWorkspaceProps = {
  initialDetections?: Detection[] | null;
};

export function DetectionsWorkspace({ initialDetections }: DetectionsWorkspaceProps = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [opened, setOpened] = useState<Detection | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);

  const requestedView = (searchParams.get("view") || "queue").toLowerCase() as WorkspaceView;
  const activeView = WORKSPACE_VIEWS.includes(requestedView) ? requestedView : "queue";
  const requestedSearch = (searchParams.get("search") || "").trim();

  useEffect(() => {
    setSearch(requestedSearch);
  }, [requestedSearch]);

  // SWR cache — bouncing between detections and other routes no longer refetches.
  const detectionsQ = useSWR<Detection[]>("detections:list", getDetections, {
    fallbackData: initialDetections ?? undefined,
    revalidateOnMount: true,
  });
  const detections = useMemo(() => {
    const raw = detectionsQ.data ?? [];
    return Array.from(new Map(raw.map((item) => [item.id, item])).values());
  }, [detectionsQ.data]);
  const loading = !detectionsQ.data && !detectionsQ.error;
  const error = detectionsQ.error
    ? detectionsQ.error instanceof Error
      ? detectionsQ.error.message
      : "Failed to load detections."
    : null;

  const filteredDetections = useMemo(() => {
    const query = search.toLowerCase().trim();
    return detections
      .filter((detection) => {
        if (!query) return true;
        const haystack = [
          detection.title,
          detection.technique_id,
          detection.siem_type,
          detection.owner,
          detection.status,
          detection.lifecycle_stage,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => {
        const rank = getPriorityRank(left) - getPriorityRank(right);
        if (rank !== 0) return rank;
        const leftTime = left.last_tested_at ? new Date(left.last_tested_at).getTime() : 0;
        const rightTime = right.last_tested_at ? new Date(right.last_tested_at).getTime() : 0;
        return rightTime - leftTime;
      });
  }, [detections, search]);

  const buckets = useMemo(() => {
    const b: Record<HealthStateKey, Detection[]> = {
      TELEMETRY_MISSING: [],
      DETECTION_FAILED: [],
      UNKNOWN: [],
      HEALTHY: [],
    };
    for (const d of filteredDetections) {
      b[deriveHealthState(d)].push(d);
    }
    return b;
  }, [filteredDetections]);

  const counts = useMemo(() => {
    const total = detections.length;
    const trusted = detections.filter((d) => deriveHealthState(d) === "HEALTHY" && !isStaleDetection(d)).length;
    const needsTuning = detections.filter((d) => deriveHealthState(d) === "DETECTION_FAILED").length;
    const telemetryGap = detections.filter((d) => deriveHealthState(d) === "TELEMETRY_MISSING").length;
    const untested = detections.filter((d) => deriveHealthState(d) === "UNKNOWN").length;
    const stale = detections.filter((d) => deriveHealthState(d) === "HEALTHY" && isStaleDetection(d)).length;
    return { total, trusted, needsTuning, telemetryGap, untested, stale };
  }, [detections]);

  const workspaceGaps = useMemo(() => {
    const unassigned = detections.filter((d) => !d.owner).length;
    const unmapped = detections.filter((d) => !hasTechniqueMapping(d)).length;
    const activeBlockers = detections.filter((d) => {
      const health = deriveHealthState(d);
      return health === "TELEMETRY_MISSING" || health === "DETECTION_FAILED";
    }).length;
    return { unassigned, unmapped, activeBlockers };
  }, [detections]);

  function setView(view: WorkspaceView) {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "queue") params.delete("view");
    else params.set("view", view);
    router.replace(params.toString() ? `/detections?${params.toString()}` : "/detections");
  }

  useEffect(() => {
    const normalizedSearch = search.trim();
    if (normalizedSearch === requestedSearch) return;

    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (normalizedSearch) params.set("search", normalizedSearch);
      else params.delete("search");
      router.replace(params.toString() ? `/detections?${params.toString()}` : "/detections");
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [router, search, searchParams, requestedSearch]);

  if (loading) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Skeleton className="mb-2 h-6 w-48" />
              <Skeleton className="h-3 w-72" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--stroke-soft)]">
                    {["Name", "Severity", "Status", "Updated", ""].map((h) => (
                      <th key={h} className="px-4 py-3 text-left">
                        <Skeleton className="h-3 w-20" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <SkeletonTableRows rows={8} columns={5} />
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">{error}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Verify the PurveX API is running and refresh this page.</p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const trustPercent = counts.total > 0 ? Math.round((counts.trusted / counts.total) * 100) : 0;

  return (
    <PageContainer maxWidth="full" className="space-y-5">
      {/* ── Trust posture hero ── */}
      <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-soft)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 dark:bg-white/5">
              <Shield className="h-6 w-6 text-slate-700 dark:text-slate-200" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--foreground)]">Detections</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {counts.total} detections &middot; {trustPercent}% trusted posture
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/run-test">
              <Button className="h-10 rounded-full px-5">
                <Play className="mr-2 h-4 w-4" />
                Start validation
              </Button>
            </Link>
          </div>
        </div>

        {/* Segmented trust bar */}
        {counts.total > 0 && (
          <div className="mt-5">
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
              {counts.trusted > 0 && (
                <div className="bg-emerald-500 transition-all" style={{ width: `${(counts.trusted / counts.total) * 100}%` }} />
              )}
              {counts.stale > 0 && (
                <div className="bg-emerald-300 transition-all" style={{ width: `${(counts.stale / counts.total) * 100}%` }} />
              )}
              {counts.needsTuning > 0 && (
                <div className="bg-rose-400 transition-all" style={{ width: `${(counts.needsTuning / counts.total) * 100}%` }} />
              )}
              {counts.telemetryGap > 0 && (
                <div className="bg-amber-400 transition-all" style={{ width: `${(counts.telemetryGap / counts.total) * 100}%` }} />
              )}
              {counts.untested > 0 && (
                <div className="bg-slate-300 dark:bg-slate-600 transition-all" style={{ width: `${(counts.untested / counts.total) * 100}%` }} />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <LegendDot color="bg-emerald-500" label="Trusted" />
              {counts.stale > 0 && <LegendDot color="bg-emerald-300" label="Stale" />}
              <LegendDot color="bg-rose-400" label="Needs tuning" />
              <LegendDot color="bg-amber-400" label="No logs" />
              <LegendDot color="bg-slate-300 dark:bg-slate-600" label="Untested" />
            </div>
          </div>
        )}
      </div>

      {/* ── View switcher + search ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
            {(["queue", "library"] as WorkspaceView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-4 py-2 text-sm font-medium transition",
                  activeView === v
                    ? "bg-[var(--surface-card)] text-[var(--foreground)] shadow-sm"
                    : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400"
                )}
              >
                {v === "queue" ? "Review" : "Library"}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search detections..."
              className="h-10 border-[var(--stroke-soft)] bg-[var(--surface-card)] pl-9"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCoverageOpen(!coverageOpen)}
          className={cn(
            "inline-flex h-10 items-center gap-3 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-4 text-left shadow-[var(--shadow-soft)] transition hover:bg-[var(--surface-elevated)]",
            coverageOpen && "border-[var(--accent-line)]"
          )}
          aria-expanded={coverageOpen}
        >
          <Radar className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <span className="text-sm font-semibold text-[var(--foreground)]">Coverage summary</span>
          <Chip tone={workspaceGaps.activeBlockers > 0 ? "warning" : "success"}>
            {workspaceGaps.activeBlockers} active blocker{workspaceGaps.activeBlockers === 1 ? "" : "s"}
          </Chip>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-slate-400 transition-transform",
              coverageOpen && "rotate-180"
            )}
          />
        </button>
      </div>

      {/* ── Coverage summary (expandable) ── */}
      {coverageOpen && (
        <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-5 py-5 shadow-[var(--shadow-soft)]">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Readiness blockers</h4>
              <CoverageRow label="Untested" count={counts.untested} total={counts.total} color="bg-slate-400" />
              <CoverageRow label="No logs" count={counts.telemetryGap} total={counts.total} color="bg-amber-400" />
              <CoverageRow label="Needs tuning" count={counts.needsTuning} total={counts.total} color="bg-rose-400" />
              <CoverageRow label="Stale readiness" count={counts.stale} total={counts.total} color="bg-emerald-300" />
            </div>
            <div className="space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Operational gaps</h4>
              <GapRow label="Unassigned owners" value={workspaceGaps.unassigned} detail="Detections without someone accountable for tuning." />
              <GapRow label="Unmapped technique" value={workspaceGaps.unmapped} detail="Missing a MITRE technique mapping." />
            </div>
          </div>
        </div>
      )}

      {activeView === "queue" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-soft)]">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Detection queue</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Start with the items blocking trust, then work through first validations and stale records.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
          {(["TELEMETRY_MISSING", "DETECTION_FAILED", "UNKNOWN", "HEALTHY"] as HealthStateKey[]).map((key) => {
            const meta = HEALTH_META[key];
            const items = buckets[key];
            return (
              <div key={key} className="flex flex-col rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                <div className="flex items-center gap-2 border-b border-[var(--stroke-soft)] px-4 py-3">
                  <span className={cn("h-2.5 w-2.5 rounded-full", meta.bg)} />
                  <span className="text-sm font-semibold text-[var(--foreground)]">{meta.label}</span>
                  <span className="ml-auto rounded-full bg-[var(--surface-card)] px-2 py-0.5 text-xs font-semibold text-slate-500">
                    {items.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto p-3" style={{ maxHeight: "520px" }}>
                  {items.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                      {key === "HEALTHY" ? "No ready detections yet" : "No items in queue"}
                    </p>
                  ) : (
                    items.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setOpened(d)}
                        className="group w-full cursor-pointer rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-3.5 text-left transition hover:border-slate-400 hover:shadow-[var(--shadow-soft)] dark:hover:border-white/20"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-[var(--foreground)] line-clamp-2">{d.title}</p>
                          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400" />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {d.technique_id && (
                            <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">{d.technique_id}</span>
                          )}
                          {d.siem_type && (
                            <span className="text-[11px] text-slate-400">{d.siem_type.toUpperCase()}</span>
                          )}
                          <SourceBadge source={d.source} />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{getNextAction(d)}</span>
                          <span>{d.owner || "Unassigned"}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* ── Library (table) view ── */}
      {activeView === "library" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-soft)]">
            <h2 className="text-base font-semibold text-[var(--foreground)]">Detection library</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Browse the full set by readiness, lifecycle, ownership, and latest validation evidence.
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)] overflow-hidden">
            <Table>
            <TableHeader>
              <TableRow className="border-[var(--stroke-soft)]">
                <TableHead>Detection</TableHead>
                <TableHead>Readiness</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Next action</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Last validated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDetections.map((detection) => {
                const health = deriveHealthState(detection);
                const meta = HEALTH_META[health];
                return (
                  <TableRow
                    key={detection.id}
                    className="group cursor-pointer border-[var(--stroke-soft)] transition hover:bg-[var(--surface-elevated)]"
                    onClick={() => setOpened(detection)}
                  >
                    <TableCell className="min-w-[260px]">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-[var(--foreground)]">{detection.title}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {detection.technique_id || "No technique mapped"}
                            {detection.siem_type ? ` · ${detection.siem_type.toUpperCase()}` : ""}
                          </p>
                        </div>
                        <SourceBadge source={detection.source} className="mt-0.5" />
                      </div>
                    </TableCell>
                    <TableCell><Chip tone={HEALTH_TONE[health]}>{meta.label}</Chip></TableCell>
                    <TableCell className="text-sm text-slate-600 dark:text-slate-300">
                      {formatLifecycleStage(detection)}
                    </TableCell>
                    <TableCell className="text-sm text-slate-600 dark:text-slate-300">{getNextAction(detection)}</TableCell>
                    <TableCell className="text-sm text-slate-600 dark:text-slate-300">{detection.owner || "Unassigned"}</TableCell>
                    <TableCell className="text-sm text-slate-600 dark:text-slate-300">{getShortDate(detection.last_tested_at)}</TableCell>
                    <TableCell className="w-8">
                      <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            </Table>
          </div>
        </div>
      )}

      <Sheet open={!!opened} onOpenChange={(open) => { if (!open) setOpened(null); }}>
        <SheetContent
          side="right"
          className="border-[var(--stroke-soft)] bg-[var(--surface-card)] text-[var(--foreground)]"
        >
          {opened && <DetailPanel detection={opened} />}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
      <span className={cn("h-2 w-2 rounded-full", color)} />
      {label}
    </span>
  );
}

function CoverageRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-4">
      <span className="w-28 text-sm text-slate-600 dark:text-slate-300">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 text-right text-sm font-semibold text-[var(--foreground)]">{count}</span>
    </div>
  );
}

function GapRow({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-xl bg-[var(--surface-elevated)] px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>
        <span className="text-lg font-semibold text-[var(--foreground)]">{value}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{detail}</p>
    </div>
  );
}

function DetailPanel({ detection }: { detection: Detection }) {
  const health = deriveHealthState(detection);
  const meta = HEALTH_META[health];
  const Icon =
    health === "HEALTHY"
      ? CheckCircle2
      : health === "DETECTION_FAILED"
        ? XCircle
        : health === "TELEMETRY_MISSING"
          ? AlertTriangle
          : Clock3;

  return (
    <>
      <SheetHeader className="border-[var(--stroke-soft)]">
        <div className="flex items-start gap-3 pr-8">
          <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl border bg-[var(--surface-elevated)]", meta.border, meta.tone)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <SheetTitle className="text-[var(--foreground)]">{detection.title}</SheetTitle>
            <SheetDescription>{meta.headline}</SheetDescription>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip tone={HEALTH_TONE[health]}>{meta.label}</Chip>
          {detection.technique_id && <Badge variant="outline">{detection.technique_id}</Badge>}
          {detection.siem_type && <Badge variant="outline">{detection.siem_type.toUpperCase()}</Badge>}
          <SourceBadge source={detection.source} size="md" />
        </div>
      </SheetHeader>

      <SheetBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <DetailStat label="Readiness" value={meta.label} />
          <DetailStat label="Next action" value={getNextAction(detection)} />
          <DetailStat label="Owner" value={detection.owner || "Unassigned"} />
          <DetailStat label="Last validated" value={getRelativeDate(detection.last_tested_at)} />
          <DetailStat label="Last alert seen" value={getRelativeDate(detection.last_alert_at)} />
          <DetailStat label="Lifecycle stage" value={formatLifecycleStage(detection)} />
        </div>
        <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Why it matters</p>
          <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{meta.detail}</p>
        </div>
      </SheetBody>

      <SheetFooter className="border-[var(--stroke-soft)]">
        <Link href={`/detections/${detection.id}`} className="w-full">
          <Button variant="outline" className="w-full">
            <Eye className="mr-2 h-4 w-4" />
            Open trust record
          </Button>
        </Link>
      </SheetFooter>
    </>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-sm font-medium text-[var(--foreground)]">{value}</p>
    </div>
  );
}
