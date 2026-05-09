"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format, subDays } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MoreHorizontal,
  Play,
  Search,
  ShieldAlert,
  TestTube,
  XCircle,
  Zap,
  ClipboardList,
  TrendingUp,
} from "lucide-react";
import { getTests, type TestWithDetectionTitle } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TestsView = "feed" | "log" | "insights";
type ResultKey = "PASS" | "FAIL" | "INCONCLUSIVE" | "PENDING" | "RUNNING" | "ERROR" | "UNKNOWN";

function normalizeResult(test: TestWithDetectionTitle): ResultKey {
  const value = (test.result || test.status || "UNKNOWN").toUpperCase();
  if (
    value === "PASS" ||
    value === "FAIL" ||
    value === "INCONCLUSIVE" ||
    value === "PENDING" ||
    value === "RUNNING" ||
    value === "ERROR"
  ) return value;
  return "UNKNOWN";
}

function getIssueLabel(test: TestWithDetectionTitle) {
  const result = normalizeResult(test);
  if (result === "FAIL") return "Detection missed";
  if (result === "INCONCLUSIVE") return "No logs";
  if (result === "ERROR") return "Execution error";
  if (result === "RUNNING" || result === "PENDING") return "In flight";
  if (result === "PASS") return "Validated";
  return "Unknown";
}

function getTrustImpact(test: TestWithDetectionTitle) {
  const result = normalizeResult(test);
  if (result === "PASS") return "Established trust";
  if (result === "FAIL") return "Blocked trust";
  if (result === "INCONCLUSIVE") return "Blocked by telemetry";
  if (result === "ERROR") return "Infrastructure blocked trust";
  if (result === "RUNNING" || result === "PENDING") return "Trust pending";
  return "Needs review";
}

function getNextAction(test: TestWithDetectionTitle) {
  const result = normalizeResult(test);
  if (result === "FAIL") return "Tune detection logic";
  if (result === "INCONCLUSIVE") return "Fix telemetry path";
  if (result === "ERROR") return "Inspect runner or environment";
  if (result === "RUNNING" || result === "PENDING") return "Wait for result";
  if (result === "PASS") {
    return (test.environment || "").toLowerCase() === "prod" ? "Monitor normally" : "Promote to next environment";
  }
  return "Review details";
}

function getPriorityRank(test: TestWithDetectionTitle) {
  const result = normalizeResult(test);
  if (result === "INCONCLUSIVE") return 0;
  if (result === "FAIL") return 1;
  if (result === "ERROR") return 2;
  if (result === "RUNNING" || result === "PENDING") return 3;
  return 4;
}

// Map validation outcome → Chip tone. The Chip primitive owns all the
// tinted/dark-mode class combos so this stays purely semantic.
const RESULT_TONE: Record<ResultKey, NonNullable<ChipProps["tone"]>> = {
  PASS: "success",
  FAIL: "danger",
  ERROR: "danger",
  INCONCLUSIVE: "warning",
  RUNNING: "info",
  PENDING: "info",
  UNKNOWN: "neutral",
};

const RESULT_ICON: Record<ResultKey, { icon: typeof CheckCircle2; color: string }> = {
  PASS: { icon: CheckCircle2, color: "text-emerald-500" },
  FAIL: { icon: XCircle, color: "text-rose-500" },
  ERROR: { icon: Zap, color: "text-rose-500" },
  INCONCLUSIVE: { icon: AlertTriangle, color: "text-amber-500" },
  RUNNING: { icon: Clock3, color: "text-sky-500" },
  PENDING: { icon: Clock3, color: "text-sky-500" },
  UNKNOWN: { icon: ShieldAlert, color: "text-slate-400" },
};

function scoreTone(score?: number | null) {
  if (typeof score !== "number") return "text-slate-500 dark:text-slate-400";
  if (score >= 80) return "text-emerald-600 dark:text-emerald-300";
  if (score >= 50) return "text-amber-600 dark:text-amber-300";
  return "text-rose-600 dark:text-rose-300";
}

/**
 * The RSC shell (`page.tsx`) may have pre-fetched the initial tests list on
 * the server using forwarded auth cookies. When present, it's plumbed in as
 * `initialTests` so SWR can hydrate with real data and skip the loading
 * skeleton. When absent (SSR fetch failed, cookie missing, etc.) SWR falls
 * back to its normal client-side fetch on mount.
 */
type TestsWorkspaceProps = {
  initialTests?: TestWithDetectionTitle[] | null;
};

export function TestsWorkspace({ initialTests }: TestsWorkspaceProps = {}) {
  const router = useRouter();

  const [view, setView] = useState<TestsView>("feed");
  const [search, setSearch] = useState("");
  const [envFilter, setEnvFilter] = useState<"all" | "lab" | "dev" | "prod">("all");
  const [timeFilter, setTimeFilter] = useState<"all" | "24h" | "7d" | "30d">("7d");

  const testsQ = useSWR<TestWithDetectionTitle[]>("tests:list", getTests, {
    fallbackData: initialTests ?? undefined,
    revalidateOnMount: true,
  });
  const tests = useMemo(() => {
    const raw = testsQ.data ?? [];
    return [...raw].sort(
      (left, right) => new Date(right.started_at).getTime() - new Date(left.started_at).getTime()
    );
  }, [testsQ.data]);
  const loading = !testsQ.data && !testsQ.error;
  const error = testsQ.error
    ? testsQ.error instanceof Error
      ? testsQ.error.message
      : "Failed to load validation runs."
    : null;

  const filteredTests = useMemo(() => {
    const query = search.toLowerCase().trim();
    const cutoff =
      timeFilter === "24h" ? subDays(new Date(), 1).getTime()
        : timeFilter === "7d" ? subDays(new Date(), 7).getTime()
          : timeFilter === "30d" ? subDays(new Date(), 30).getTime()
            : 0;

    return tests.filter((test) => {
      if (envFilter !== "all" && (test.environment || "").toLowerCase() !== envFilter) return false;
      if (cutoff > 0 && new Date(test.started_at).getTime() < cutoff) return false;
      if (query) {
        const haystack = [test.detection_title, test.technique_id, test.environment, test.id, normalizeResult(test), getIssueLabel(test)]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [envFilter, search, tests, timeFilter]);

  const attentionRuns = useMemo(
    () => filteredTests.filter((t) => getPriorityRank(t) < 4).sort((a, b) => {
      const rank = getPriorityRank(a) - getPriorityRank(b);
      return rank !== 0 ? rank : new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
    }),
    [filteredTests]
  );

  const statusCounts = useMemo(() => {
    const c = { attention: 0, telemetry: 0, inFlight: 0, trusted: 0 };
    for (const t of tests) {
      const r = normalizeResult(t);
      if (r === "INCONCLUSIVE") c.telemetry++;
      else if (r === "FAIL" || r === "ERROR") c.attention++;
      else if (r === "RUNNING" || r === "PENDING") c.inFlight++;
      else if (r === "PASS") c.trusted++;
    }
    return c;
  }, [tests]);

  const repeatedOffenders = useMemo(() => {
    const counts = new Map<string, { title: string; count: number }>();
    for (const test of filteredTests) {
      const result = normalizeResult(test);
      if (result !== "FAIL" && result !== "INCONCLUSIVE" && result !== "ERROR") continue;
      const key = test.detection_id || test.detection_title || `run-${test.id}`;
      const title = test.detection_title || `Detection ${test.detection_id || "Unknown"}`;
      const current = counts.get(key);
      counts.set(key, { title, count: (current?.count || 0) + 1 });
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 6);
  }, [filteredTests]);

  const environmentBreakdown = useMemo(() => {
    return ["lab", "dev", "prod"].map((env) => {
      const envTests = filteredTests.filter((t) => (t.environment || "").toLowerCase() === env);
      const pass = envTests.filter((t) => normalizeResult(t) === "PASS").length;
      const fail = envTests.filter((t) => ["FAIL", "INCONCLUSIVE", "ERROR"].includes(normalizeResult(t))).length;
      return { env: env.toUpperCase(), total: envTests.length, pass, fail };
    });
  }, [filteredTests]);

  if (loading) {
    return (
      <PageContainer maxWidth="full">
        <PageSkeleton stats={4} withActions variant="table" rows={8} />
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

  return (
    <PageContainer maxWidth="full" className="space-y-5">
      {/* ── Compact header with inline status pills ── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 dark:bg-indigo-500/10">
            <TestTube className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Tests</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Validation operations and trust evidence</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <MoreMenu />
          <Link href="/run-test">
            <Button size="sm" className="h-9">
              <Play className="mr-1.5 h-3.5 w-3.5" />Run validation
            </Button>
          </Link>
        </div>
      </div>

      {/* Inline status strip */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill label="Needs action" count={statusCounts.attention} tone="danger" />
        <StatusPill label="No logs" count={statusCounts.telemetry} tone="warning" />
        <StatusPill label="In flight" count={statusCounts.inFlight} tone="info" />
        <StatusPill label="Trusted" count={statusCounts.trusted} tone="success" />
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">{tests.length} total runs</span>
        <Chip
          tone="muted"
          size="md"
          className="ml-auto"
          title="Runs older than the configured retention period are automatically purged. Configure in Settings > Testing Policy."
        >
          Auto-purge active
        </Chip>
      </div>

      {/* ── View switcher + filters ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
          {([["feed", "Feed"], ["log", "Run log"], ["insights", "Insights"]] as [TestsView, string][]).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "rounded-md px-4 py-2 text-sm font-medium transition",
                view === v
                  ? "bg-[var(--surface-card)] text-[var(--foreground)] shadow-sm"
                  : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-9 w-52 border-[var(--stroke-soft)] bg-[var(--surface-card)] pl-9 text-sm"
            />
          </div>
          <Select value={envFilter} onValueChange={(v) => setEnvFilter(v as typeof envFilter)}>
            <SelectTrigger className="h-9 w-32 border-[var(--stroke-soft)] bg-[var(--surface-card)] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All envs</SelectItem>
              <SelectItem value="lab">Lab</SelectItem>
              <SelectItem value="dev">Dev</SelectItem>
              <SelectItem value="prod">Prod</SelectItem>
            </SelectContent>
          </Select>
          <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as typeof timeFilter)}>
            <SelectTrigger className="h-9 w-32 border-[var(--stroke-soft)] bg-[var(--surface-card)] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="24h">24 hours</SelectItem>
              <SelectItem value="7d">7 days</SelectItem>
              <SelectItem value="30d">30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Feed view (timeline) ── */}
      {view === "feed" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="relative">
            {/* Timeline vertical line */}
            <div className="absolute left-[19px] top-6 bottom-6 w-px bg-[var(--stroke-soft)]" />

            <div className="space-y-1">
              {(attentionRuns.length > 0 ? attentionRuns : filteredTests).slice(0, 15).map((test) => {
                const result = normalizeResult(test);
                const iconConfig = RESULT_ICON[result];
                const Icon = iconConfig.icon;
                return (
                  <button
                    key={test.id}
                    type="button"
                    onClick={() => router.push(`/tests/${test.id}`)}
                    className="group relative flex w-full gap-4 rounded-xl p-3 text-left transition hover:bg-[var(--surface-elevated)]"
                  >
                    {/* Timeline node */}
                    <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--surface-card)] bg-[var(--surface-elevated)]">
                      <Icon className={cn("h-4 w-4", iconConfig.color)} />
                    </div>

                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[var(--foreground)] truncate">
                          {test.detection_title || "Unknown detection"}
                        </span>
                        <Chip tone={RESULT_TONE[result]}>{getIssueLabel(test)}</Chip>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
                        <span>{getTrustImpact(test)}</span>
                        <span>{(test.environment || "unknown").toUpperCase()}</span>
                        {test.technique_id && <span className="font-mono">{test.technique_id}</span>}
                        <span>{format(new Date(test.started_at), "MMM dd, HH:mm")}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                        Next: {getNextAction(test)}
                      </p>
                    </div>

                    {typeof test.score === "number" && (
                      <div className="text-right pt-1">
                        <p className={cn("text-xl font-bold", scoreTone(test.score))}>{test.score}</p>
                        <p className="text-[10px] uppercase tracking-wider text-slate-400">score</p>
                      </div>
                    )}
                  </button>
                );
              })}

              {filteredTests.length === 0 && (
                <div className="ml-14 rounded-2xl border border-dashed border-[var(--stroke-soft)] p-8 text-center">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {tests.length === 0 ? "No validations yet" : "No runs match filters"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {tests.length === 0 ? "Run your first validation to start building evidence." : "Clear or widen filters."}
                  </p>
                  {tests.length === 0 && (
                    <Link href="/run-test" className="mt-3 inline-block">
                      <Button size="sm"><Play className="mr-1.5 h-3.5 w-3.5" />Run first validation</Button>
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar summary */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-soft)]">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">Repeated blockers</h3>
              {repeatedOffenders.length === 0 ? (
                <p className="text-xs text-slate-500">No repeated failures.</p>
              ) : (
                <div className="space-y-2">
                  {repeatedOffenders.map((item) => (
                    <div key={item.title} className="flex items-center justify-between rounded-lg bg-[var(--surface-elevated)] px-3 py-2">
                      <span className="text-xs text-slate-600 dark:text-slate-300 truncate mr-2">{item.title}</span>
                      <span className="text-sm font-bold text-rose-600 dark:text-rose-400">{item.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-soft)]">
              <h3 className="text-sm font-semibold text-[var(--foreground)] mb-3">By environment</h3>
              <div className="space-y-2">
                {environmentBreakdown.map((row) => (
                  <div key={row.env} className="flex items-center gap-3">
                    <span className="w-10 text-xs font-semibold text-slate-600 dark:text-slate-300">{row.env}</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                      {row.total > 0 && (
                        <>
                          <div
                            className="h-full bg-emerald-500 float-left rounded-l-full"
                            style={{ width: `${(row.pass / row.total) * 100}%` }}
                          />
                          <div
                            className="h-full bg-rose-400 float-left"
                            style={{ width: `${(row.fail / row.total) * 100}%` }}
                          />
                        </>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 w-6 text-right">{row.total}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Log view (dense table) ── */}
      {view === "log" && (
        <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)] overflow-hidden">
          {filteredTests.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {tests.length === 0 ? "No validations yet" : "No runs match filters"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--stroke-soft)]">
              {/* Dense header */}
              <div className="grid grid-cols-[100px_1fr_140px_120px_80px] gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <span>Result</span>
                <span>Detection</span>
                <span>Trust impact</span>
                <span>Environment</span>
                <span>Score</span>
              </div>
              {filteredTests.map((test) => {
                const result = normalizeResult(test);
                return (
                  <button
                    key={test.id}
                    type="button"
                    onClick={() => router.push(`/tests/${test.id}`)}
                    className="grid w-full grid-cols-[100px_1fr_140px_120px_80px] gap-4 items-center px-5 py-3 text-left transition hover:bg-[var(--surface-elevated)]"
                  >
                    <Chip tone={RESULT_TONE[result]} className="justify-center">
                      {getIssueLabel(test)}
                    </Chip>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--foreground)] truncate">{test.detection_title || "Unknown"}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {test.technique_id || "—"} · {format(new Date(test.started_at), "MMM dd, HH:mm")}
                      </p>
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-300">{getTrustImpact(test)}</span>
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{(test.environment || "unknown").toUpperCase()}</span>
                    <span className={cn("text-sm font-bold", scoreTone(test.score))}>
                      {typeof test.score === "number" ? test.score : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Insights view ── */}
      {view === "insights" && (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {/* Issue mix */}
          <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Outcome distribution</h3>
            </div>
            <div className="space-y-3">
              {[
                { label: "Validated", count: filteredTests.filter((t) => normalizeResult(t) === "PASS").length, color: "bg-emerald-500" },
                { label: "Detection missed", count: filteredTests.filter((t) => normalizeResult(t) === "FAIL").length, color: "bg-rose-500" },
                { label: "No logs", count: filteredTests.filter((t) => normalizeResult(t) === "INCONCLUSIVE").length, color: "bg-amber-400" },
                { label: "Execution error", count: filteredTests.filter((t) => normalizeResult(t) === "ERROR").length, color: "bg-red-400" },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className={cn("h-2.5 w-2.5 rounded-full", row.color)} />
                  <span className="flex-1 text-sm text-slate-600 dark:text-slate-300">{row.label}</span>
                  <span className="text-lg font-bold text-[var(--foreground)]">{row.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Environment breakdown */}
          <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Environment blockers</h3>
            </div>
            <div className="space-y-4">
              {environmentBreakdown.map((row) => (
                <div key={row.env}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{row.env}</span>
                    <span className="text-xs text-slate-500">{row.fail} blocked / {row.total} total</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                    {row.total > 0 && (
                      <div className="h-full bg-rose-400 rounded-full" style={{ width: `${(row.fail / row.total) * 100}%` }} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Repeated offenders */}
          <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6 shadow-[var(--shadow-soft)]">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert className="h-4 w-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Repeated offenders</h3>
            </div>
            {repeatedOffenders.length === 0 ? (
              <p className="text-sm text-slate-500">No repeated blockers in the current filter set.</p>
            ) : (
              <div className="space-y-2">
                {repeatedOffenders.map((item, i) => (
                  <div key={item.title} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface-elevated)] text-[11px] font-bold text-slate-500">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-sm text-slate-600 dark:text-slate-300 truncate">{item.title}</span>
                    <span className="text-sm font-bold text-rose-600 dark:text-rose-400">{item.count}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function MoreMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" size="sm" className="h-9" onClick={() => setOpen(!open)}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] py-1 shadow-lg">
            <Link href="/tests/schedules" className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition" onClick={() => setOpen(false)}>
              <Clock3 className="h-3.5 w-3.5 text-slate-500" />
              Schedules
            </Link>
            <Link href="/tests/audit" className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--foreground)] hover:bg-[var(--surface-elevated)] transition" onClick={() => setOpen(false)}>
              <ClipboardList className="h-3.5 w-3.5 text-slate-500" />
              Audit
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: NonNullable<ChipProps["tone"]>;
}) {
  return (
    <Chip tone={tone} size="md" className="gap-2">
      {label}
      <span className="font-bold">{count}</span>
    </Chip>
  );
}
