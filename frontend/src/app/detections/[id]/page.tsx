"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Play,
  Shield,
  UserPlus,
  XCircle,
} from "lucide-react";
import {
  type Detection,
  type DetectionAlert,
  type DetectionLifecycleStage,
  type DetectionVersionKPIResponse,
  type TestWithDetectionTitle,
  DETECTION_LIFECYCLE_STAGES,
  apiFetch,
  getDetection,
  getDetectionAlerts,
  getDetectionVersionKPIs,
  getTests,
  getUsers,
  updateDetection,
} from "@/lib/api";
import { Permission } from "@/lib/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { SourceBadge } from "@/components/detections/source-badge";
import { ExportYamlButton } from "@/components/detections/export-yaml-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type HealthState = "HEALTHY" | "FAILED" | "TELEMETRY_GAP" | "UNTESTED";

type UserOption = {
  id: number;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
};

type ChipTone = NonNullable<ChipProps["tone"]>;

/**
 * HEALTH_META is the single source of truth for trust-state copy and colour
 * on the detection detail page. Each entry resolves to:
 *
 *   - `tone`: the semantic Chip tone used for pill badges. All dark-mode /
 *     hover behaviour lives inside `<Chip>` so this file never needs to
 *     know about it.
 *   - `borderLeftClass`: the hero card's left edge. It's split out from
 *     `tone` because Tailwind's `border-l-<color>` utility can't be inferred
 *     from a data-driven tone string.
 *   - `iconWrapperClass`: subtle-tinted background + ring for the circular
 *     icon badge next to the headline. Same palette as the `subtle` Chip
 *     appearance so the hero reads as one composed block.
 *   - `bar`: the thin progress-bar accent used in the coverage legend.
 */
const HEALTH_META: Record<
  HealthState,
  {
    label: string;
    headline: string;
    nextAction: string;
    icon: typeof CheckCircle2;
    tone: ChipTone;
    borderLeftClass: string;
    iconWrapperClass: string;
    bar: string;
  }
> = {
  HEALTHY: {
    label: "Trusted",
    headline: "Rule fired and telemetry was present in the last validation.",
    nextAction: "Revalidate on schedule before evidence becomes stale.",
    icon: CheckCircle2,
    tone: "success",
    borderLeftClass: "border-l-emerald-500",
    iconWrapperClass:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
    bar: "bg-emerald-500",
  },
  FAILED: {
    label: "Needs tuning",
    headline: "Telemetry arrived but the rule did not fire.",
    nextAction: "Review the captured evidence, tune the rule, then rerun the validation.",
    icon: XCircle,
    tone: "danger",
    borderLeftClass: "border-l-rose-500",
    iconWrapperClass:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
    bar: "bg-rose-500",
  },
  TELEMETRY_GAP: {
    label: "Blind Spot",
    headline: "Validation ran without usable telemetry in the SIEM.",
    nextAction: "Fix the telemetry path before retesting the rule.",
    icon: AlertTriangle,
    tone: "warning",
    borderLeftClass: "border-l-amber-500",
    iconWrapperClass:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
    bar: "bg-amber-500",
  },
  UNTESTED: {
    label: "Untested",
    headline: "No validation evidence exists for this detection yet.",
    nextAction: "Run the first validation to establish a trust baseline.",
    icon: Clock3,
    tone: "neutral",
    borderLeftClass: "border-l-slate-400 dark:border-l-slate-600",
    iconWrapperClass:
      "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
    bar: "bg-slate-400",
  },
};

function deriveHealth(detection: Detection, tests: TestWithDetectionTitle[]): HealthState {
  const lastResult = (detection.last_result || tests[0]?.result || "").toUpperCase();
  if (!detection.last_tested_at && !tests[0]) return "UNTESTED";
  if (lastResult === "PASS") return "HEALTHY";
  if (lastResult === "FAIL") return "FAILED";
  if (lastResult === "INCONCLUSIVE") return "TELEMETRY_GAP";
  return "UNTESTED";
}

function relative(value?: string | null) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return "Never";
  return `${formatDistanceToNow(parsed)} ago`;
}

function absolute(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? "-" : format(parsed, "MMM dd, yyyy");
}

// Validation result → Chip tone mapping. Previously this returned a string
// of Tailwind classes; callers now let `<Chip>` own the styling.
function resultTone(result?: string | null): ChipTone {
  const value = (result || "").toUpperCase();
  if (value === "PASS") return "success";
  if (value === "FAIL") return "danger";
  if (value === "INCONCLUSIVE") return "warning";
  return "neutral";
}

function scoreTone(score?: number | null) {
  if (typeof score !== "number") return "text-slate-500 dark:text-slate-400";
  if (score >= 80) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-rose-600";
}

export default function DetectionDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const detectionId = (params as { id?: string }).id;
  const { hasPermission } = usePermissions();
  const { toast } = useToast();

  const [detection, setDetection] = useState<Detection | null>(null);
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [events, setEvents] = useState<DetectionAlert[]>([]);
  const [versionKpis, setVersionKpis] = useState<DetectionVersionKPIResponse | null>(null);
  const [showLegacyVersions, setShowLegacyVersions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignOwnerOpen, setAssignOwnerOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedOwner, setSelectedOwner] = useState("unassigned");
  const [assigningOwner, setAssigningOwner] = useState(false);
  const [updatingLifecycle, setUpdatingLifecycle] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<number | null>(null);

  const canAssignOwner = hasPermission(Permission.DETECTIONS_UPDATE);
  const canUpdateLifecycle = hasPermission(Permission.DETECTIONS_UPDATE);

  useEffect(() => {
    if (!detectionId) return;
    const id = detectionId;

    async function load() {
      try {
        setLoading(true);
        const [detail, allTests, detailEvents, kpis] = await Promise.all([
          getDetection(id),
          getTests(),
          getDetectionAlerts(id).catch(() => []),
          getDetectionVersionKPIs(id).catch(() => null),
        ]);

        if (!detail) {
          setDetection(null);
          setError("Detection not found.");
          return;
        }

        setDetection(detail);
        setTests(
          allTests
            .filter((test) => test.detection_id === id)
            .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        );
        setEvents(
          [...(detailEvents || [])]
            .sort((a, b) => {
              const at = new Date(a.time || a.created_at || 0).getTime();
              const bt = new Date(b.time || b.created_at || 0).getTime();
              return bt - at;
            })
        );
        setVersionKpis(kpis);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load detection details.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [detectionId]);

  useEffect(() => {
    const evidenceId = Number(searchParams.get("evidence"));
    if (!Number.isNaN(evidenceId) && evidenceId > 0) {
      setSelectedEvidenceId(evidenceId);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!assignOwnerOpen || !canAssignOwner) return;
    async function loadUsersForAssignment() {
      try {
        const data = await getUsers();
        setUsers(data);
        setSelectedOwner(detection?.owner || "unassigned");
      } catch {
        toast({ type: "error", title: "Error", description: "Failed to load users." });
      }
    }
    void loadUsersForAssignment();
  }, [assignOwnerOpen, canAssignOwner, detection?.owner, toast]);

  const health = useMemo(() => {
    if (!detection) return "UNTESTED" as HealthState;
    return deriveHealth(detection, tests);
  }, [detection, tests]);

  const meta = HEALTH_META[health];
  const selectedEvidence = useMemo(
    () => (selectedEvidenceId == null ? null : events.find((event) => event.id === selectedEvidenceId) || null),
    [events, selectedEvidenceId]
  );
  async function handleAssignOwner() {
    if (!detectionId || !canAssignOwner) return;
    try {
      setAssigningOwner(true);
      const owner = selectedOwner === "unassigned" ? null : selectedOwner;
      await apiFetch(`/detections/${detectionId}`, {
        method: "PATCH",
        body: JSON.stringify({ owner }),
      });
      const updated = await getDetection(detectionId);
      if (updated) setDetection(updated);
      setAssignOwnerOpen(false);
      toast({
        type: "success",
        title: "Owner updated",
        description: owner ? `Assigned to ${owner}.` : "Detection owner removed.",
      });
    } catch (err: unknown) {
      toast({
        type: "error",
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update owner.",
      });
    } finally {
      setAssigningOwner(false);
    }
  }

  async function handleLifecycleChange(nextStage: DetectionLifecycleStage) {
    if (!detectionId || !canUpdateLifecycle) return;
    if (detection?.lifecycle_stage === nextStage) return;
    try {
      setUpdatingLifecycle(true);
      const updated = await updateDetection(detectionId, {
        lifecycle_stage: nextStage,
      });
      setDetection(updated);
      toast({
        type: "success",
        title: "Lifecycle stage updated",
        description: `Moved to ${nextStage}.`,
      });
    } catch (err: unknown) {
      toast({
        type: "error",
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update lifecycle stage.",
      });
    } finally {
      setUpdatingLifecycle(false);
    }
  }

  if (!detectionId) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="pt-6 text-sm text-rose-600">Invalid detection id.</CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer>
        <PageSkeleton variant="detail" withActions />
      </PageContainer>
    );
  }

  if (error || !detection) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-semibold text-rose-600">{error || "Detection not found."}</p>
            <Link href="/detections">
              <Button variant="outline">Back to detections</Button>
            </Link>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const HealthIcon = meta.icon;
  const lifecycleStageRaw = (detection.lifecycle_stage || "").toLowerCase();
  const activeLifecycleStage: DetectionLifecycleStage | null =
    DETECTION_LIFECYCLE_STAGES.includes(lifecycleStageRaw as DetectionLifecycleStage)
      ? (lifecycleStageRaw as DetectionLifecycleStage)
      : null;
  const lifecycleFallback = (detection.status || "draft").replaceAll("_", " ").toLowerCase();

  return (
    <PageContainer maxWidth="xl" className="space-y-6">
      {/* Header strip: title, identity chips, primary action */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-display font-semibold text-[var(--foreground)]">
            {detection.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-2.5 py-1 font-mono text-slate-700 dark:text-slate-200">
              {detection.technique_id || "Unmapped"}
            </span>
            <span className="rounded-full border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-2.5 py-1 font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300">
              {detection.siem_type}
            </span>
            <span className="rounded-full border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-2.5 py-1 text-slate-600 dark:text-slate-300">
              Owner: {detection.owner || "Unassigned"}
            </span>
            {canUpdateLifecycle ? (
              <div className="inline-flex items-center overflow-hidden rounded-full border border-[var(--stroke-soft)] bg-[var(--surface-card)] text-slate-600 dark:text-slate-300">
                <span className="pl-2.5 pr-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Stage
                </span>
                <Select
                  // Radix Select treats empty-string values as malformed
                  // and silently drops onValueChange events. When the
                  // stored stage isn't one of the enum values (legacy
                  // "active", etc.), we want "no selection" — and the
                  // sentinel for that is `undefined`, not `""`.
                  value={activeLifecycleStage ?? undefined}
                  onValueChange={(value) =>
                    void handleLifecycleChange(value as DetectionLifecycleStage)
                  }
                  disabled={updatingLifecycle}
                >
                  <SelectTrigger
                    className="h-7 min-h-0 border-0 bg-transparent px-2 py-0 text-xs font-medium capitalize text-slate-700 shadow-none focus:ring-0 focus:ring-offset-0 dark:text-slate-200"
                  >
                    <SelectValue placeholder={activeLifecycleStage ?? lifecycleFallback} />
                  </SelectTrigger>
                  <SelectContent>
                    {DETECTION_LIFECYCLE_STAGES.map((stage) => (
                      <SelectItem key={stage} value={stage} className="capitalize">
                        {stage}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <span className="rounded-full border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-2.5 py-1 capitalize text-slate-600 dark:text-slate-300">
                {activeLifecycleStage ?? lifecycleFallback}
              </span>
            )}
            <SourceBadge source={detection.source} size="md" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportYamlButton
            detectionId={detection.id}
            detectionTitle={detection.title}
          />
          <Link href={`/run-test?detectionId=${detection.id}`}>
            <Button className="h-10">
              <Play className="mr-2 h-4 w-4" />
              Validate now
            </Button>
          </Link>
        </div>
      </div>

      {/* Hero status */}
      <div className={cn("rounded-2xl border-l-4 border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-soft)]", meta.borderLeftClass)}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border", meta.iconWrapperClass)}>
              <HealthIcon className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Chip tone={meta.tone}>{meta.label}</Chip>
                {detection.last_tested_at && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Last validated {relative(detection.last_tested_at)}
                  </span>
                )}
              </div>
              <p className="max-w-xl text-sm font-medium text-[var(--foreground)]">{meta.headline}</p>
              <p className="max-w-xl text-xs text-slate-600 dark:text-slate-300">Next action: {meta.nextAction}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 text-right">
            <Stat
              label="Score"
              value={typeof detection.last_score === "number" ? `${detection.last_score}` : "-"}
              valueClassName={scoreTone(detection.last_score)}
            />
            <Stat label="Validations" value={String(tests.length)} />
            <Stat label="Evidence" value={String(events.length)} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left column: history + source */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
            <header className="border-b border-[var(--stroke-soft)]/60 px-5 py-4">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Version history</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Pass / fail rates grouped by rule version. A new version starts whenever the SIEM query, sigma rule, technique, or SIEM type changes.
              </p>
            </header>
            {!versionKpis || (versionKpis.versions.length === 0 && !versionKpis.legacy) ? (
              <div className="px-5 py-6 text-sm text-slate-600 dark:text-slate-300">
                No version data yet. Run a validation to start a version trail.
              </div>
            ) : (
              <>
                <ul className="divide-y divide-[var(--stroke-soft)]/60">
                  {[...versionKpis.versions].reverse().map((v) => {
                    const isEmptyCurrent = v.is_current && v.runs === 0;
                    return (
                      <li
                        key={v.version_hash ?? v.version_label}
                        className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-[var(--foreground)]">
                              {v.version_label}
                            </span>
                            {v.is_current ? (
                              <span className="rounded-full border border-[var(--stroke-soft)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                current
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {v.first_seen
                              ? `first seen ${formatDistanceToNow(new Date(v.first_seen))} ago · last seen ${v.last_seen ? formatDistanceToNow(new Date(v.last_seen)) : "—"} ago`
                              : "no validation runs on this version yet"}
                          </p>
                        </div>
                        {isEmptyCurrent ? (
                          // The whole point of landing here after editing a
                          // rule is to ask "is my edit OK?" — silence is
                          // the wrong answer. Give the user the next move.
                          <Link href={`/run-test?detection_id=${detection.id}`}>
                            <Button size="sm" variant="outline">
                              <Play className="mr-1.5 h-3.5 w-3.5" />
                              Run a validation
                            </Button>
                          </Link>
                        ) : v.runs > 0 ? (
                          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                            <span className="text-slate-600 dark:text-slate-300">
                              <span className="font-semibold text-[var(--foreground)]">{v.runs}</span>{" "}
                              {v.runs === 1 ? "run" : "runs"}
                            </span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              pass {Math.round(v.pass_rate * 100)}%
                            </span>
                            <span className="text-rose-600 dark:text-rose-400">
                              fail {Math.round(v.fail_rate * 100)}%
                            </span>
                            {v.inconclusive_rate > 0 ? (
                              <span className="text-amber-600 dark:text-amber-400">
                                blind spot {Math.round(v.inconclusive_rate * 100)}%
                              </span>
                            ) : null}
                            {/* The delta line — the panel's whole value
                                prop. Server pre-computes, signed integer,
                                already null-guarded for v1 and zero-run
                                cases so a "▼ 0 pts" never shows up. */}
                            {v.delta_pass_pct !== null && v.compared_to_label ? (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs font-medium",
                                  v.delta_pass_pct < 0 &&
                                    "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                                  v.delta_pass_pct > 0 &&
                                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                                  v.delta_pass_pct === 0 &&
                                    "border-[var(--stroke-soft)] text-slate-500 dark:text-slate-400",
                                )}
                                title={`Pass rate compared to ${v.compared_to_label}`}
                              >
                                {v.delta_pass_pct < 0
                                  ? `▼ ${Math.abs(v.delta_pass_pct)} pts`
                                  : v.delta_pass_pct > 0
                                    ? `▲ ${v.delta_pass_pct} pts`
                                    : "no change"}
                                <span className="opacity-70">vs {v.compared_to_label}</span>
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {versionKpis.legacy ? (
                  <div className="border-t border-[var(--stroke-soft)]/60 px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setShowLegacyVersions((v) => !v)}
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-[var(--foreground)]"
                    >
                      {showLegacyVersions ? "− Hide" : "+ Show"} {versionKpis.legacy.runs} earlier untracked{" "}
                      {versionKpis.legacy.runs === 1 ? "run" : "runs"}
                    </button>
                    {showLegacyVersions ? (
                      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                        <span>
                          <span className="font-semibold text-[var(--foreground)]">
                            {versionKpis.legacy.runs}
                          </span>{" "}
                          {versionKpis.legacy.runs === 1 ? "run" : "runs"} ran before version tracking was enabled
                        </span>
                        <span>pass {Math.round(versionKpis.legacy.pass_rate * 100)}%</span>
                        <span>fail {Math.round(versionKpis.legacy.fail_rate * 100)}%</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
            <header className="flex items-center justify-between border-b border-[var(--stroke-soft)]/60 px-5 py-4">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Validation history</h2>
              <Link
                href={`/tests?detectionId=${detection.id}`}
                className="text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-[var(--foreground)]"
              >
                View all
              </Link>
            </header>
            {tests.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-600 dark:text-slate-300">
                No validation evidence exists for this detection yet. Run the first validation to establish trust.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-[var(--stroke-soft)]/60">
                    <TableHead className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">When</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Result</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Score</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">Env</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tests.slice(0, 8).map((test) => (
                    <TableRow key={test.id} className="border-[var(--stroke-soft)]/60">
                      <TableCell className="text-sm text-slate-700 dark:text-slate-200">{relative(test.started_at)}</TableCell>
                      <TableCell>
                        <Chip tone={resultTone(test.result || test.status)}>
                          {test.result || test.status || "-"}
                        </Chip>
                      </TableCell>
                      <TableCell className={cn("text-sm font-medium", scoreTone(test.score))}>
                        {typeof test.score === "number" ? test.score : "-"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600 dark:text-slate-300">{test.environment || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/tests/${test.id}`}>
                          <Button variant="outline" size="sm">
                            Report
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6">
            <h2 className="text-sm font-semibold text-[var(--foreground)]">Detection source</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {detection.description || "No description has been added yet."}
            </p>
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">SIEM query</p>
              <pre className="max-h-64 overflow-auto rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-xs text-slate-800 dark:text-slate-200">
{detection.siem_query || "-"}
              </pre>
            </div>
            {detection.sigma_rule && (
              <div className="mt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Sigma rule</p>
                <pre className="max-h-64 overflow-auto rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-xs text-slate-800 dark:text-slate-200">
{detection.sigma_rule}
                </pre>
              </div>
            )}
          </section>
        </div>

        {/* Right column: facts, owner, links */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Trust decision</p>
                <div className="mt-3 flex items-center gap-2">
                  <Chip tone={meta.tone}>{meta.label}</Chip>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{meta.headline}</span>
                </div>
                <p className="mt-3 text-sm font-medium text-[var(--foreground)]">{meta.nextAction}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  This is the current recommendation based on the latest validation evidence and trust state.
                </p>
              </div>

              <div className="border-t border-[var(--stroke-soft)] pt-4">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Ownership and freshness</h2>
                <dl className="mt-3 space-y-2.5 text-sm">
                  <FactRow label="Owner" value={detection.owner || "Unassigned"} />
                  <FactRow label="Last validated" value={absolute(detection.last_tested_at)} />
                  <FactRow label="Last pass" value={absolute(detection.last_pass_at)} />
                  <FactRow label="Last fail" value={absolute(detection.last_fail_at)} />
                  <FactRow label="Last evidence" value={relative(detection.last_alert_at)} />
                  <FactRow label="Updated" value={absolute(detection.last_updated_at)} />
                </dl>
              </div>
            </div>
            {canAssignOwner && (
              <Dialog open={assignOwnerOpen} onOpenChange={setAssignOwnerOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="mt-4 w-full">
                    <UserPlus className="mr-2 h-4 w-4" />
                    {detection.owner ? "Reassign owner" : "Assign owner"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Assign owner</DialogTitle>
                    <DialogDescription>Select who is accountable for this detection.</DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Select value={selectedOwner} onValueChange={setSelectedOwner}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select owner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users
                          .filter((u) => u.is_active)
                          .map((u) => (
                            <SelectItem key={u.id} value={u.email}>
                              {u.email}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAssignOwnerOpen(false)} disabled={assigningOwner}>
                      Cancel
                    </Button>
                    <Button onClick={handleAssignOwner} disabled={assigningOwner}>
                      {assigningOwner ? "Saving..." : "Save"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </section>

          <section id="validation-evidence" className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--foreground)]">Validation evidence</h2>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Latest {Math.min(3, events.length)} of {events.length}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Representative SIEM records from validation runs. Use them to support the trust decision while the SIEM remains the system of record.
              </p>
              {events.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-4 text-xs text-slate-500 dark:text-slate-400">
                  No validation evidence has been captured yet. Run a validation to attach representative SIEM records to this trust decision.
                </div>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {events.slice(0, 3).map((event) => (
                  <li key={event.id} className="rounded-xl border border-[var(--stroke-soft)]/60 bg-[var(--surface-elevated)] px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--foreground)]">
                      {event.name || event.message || "Captured evidence"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                      {relative(event.time || event.created_at)}
                      {event.host ? ` · ${event.host}` : ""}
                    </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={() => setSelectedEvidenceId(event.id)}
                      >
                        Raw
                      </Button>
                    </div>
                  </li>
                  ))}
                </ul>
              )}
          </section>

          <section className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-2">
            <div className="px-3 pt-3">
              <h2 className="text-sm font-semibold text-[var(--foreground)]">Next steps</h2>
            </div>
            <SidebarLink href={`/agent?detectionId=${detection.id}`} icon={Shield}>
              Ask Watchtower
            </SidebarLink>
            <SidebarLink href={`/tests?detectionId=${detection.id}`} icon={Clock3}>
              Open validation history
            </SidebarLink>
          </section>
        </div>
      </div>

      <Sheet open={selectedEvidence != null} onOpenChange={(open) => !open && setSelectedEvidenceId(null)}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{selectedEvidence?.name || selectedEvidence?.message || "Validation evidence"}</SheetTitle>
            <SheetDescription>
              Raw evidence captured during validation. The SIEM remains the system of record.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            {selectedEvidence && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <EvidenceFact label="Observed" value={absolute(selectedEvidence.time || selectedEvidence.created_at)} />
                  <EvidenceFact label="Host" value={selectedEvidence.host || "Unknown host"} />
                  <EvidenceFact label="Source" value={selectedEvidence.source || "SIEM"} />
                  <EvidenceFact label="Linked test" value={selectedEvidence.test_id ? `#${selectedEvidence.test_id}` : "Not linked"} />
                </div>
                <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-sm text-slate-700 dark:text-slate-300">
                  {selectedEvidence.message || "No message text was captured for this evidence record."}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Query context</p>
                  <pre className="max-h-44 overflow-auto rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--foreground)]">
{selectedEvidence.query || "--"}
                  </pre>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Raw payload</p>
                  <pre className="max-h-[24rem] overflow-auto rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--foreground)]">
{formatRawEvidence(selectedEvidence.raw_event)}
                  </pre>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/run-test?detectionId=${detection.id}`}>
                    <Button size="sm">Revalidate</Button>
                  </Link>
                  <Link href={`/agent?detectionId=${detection.id}&alertId=${selectedEvidence.id}`}>
                    <Button size="sm" variant="outline">
                      Ask Watchtower
                    </Button>
                  </Link>
                </div>
              </>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("mt-1 text-2xl font-display font-bold text-[var(--foreground)]", valueClassName)}>{value}</p>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  );
}

function EvidenceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-[var(--foreground)]">{value}</p>
    </div>
  );
}

function formatRawEvidence(rawEvent?: string) {
  if (!rawEvent) return "No raw payload stored for this validation evidence.";
  try {
    return JSON.stringify(JSON.parse(rawEvent), null, 2);
  } catch {
    return rawEvent;
  }
}

function SidebarLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-[var(--surface-elevated)] dark:text-slate-200"
    >
      <span className="inline-flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
        {children}
      </span>
      <ArrowRight className="h-4 w-4 text-slate-400 dark:text-slate-500" />
    </Link>
  );
}
