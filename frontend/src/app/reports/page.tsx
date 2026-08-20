"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, differenceInDays, format, subMonths } from "date-fns";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  ArrowRight,
  Clock3,
  Download,
  Printer,
  ScanLine,
  Target,
  TrendingDown,
} from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toneClasses, type Tone } from "@/lib/status-tone";
import { cn } from "@/lib/utils";
import { buildRunTestHref } from "@/app/run-test/lib/run-test-url";
import {
  getDetections,
  getDetectionScoringSettings,
  getMitreTechniques,
  getOrganizationSettings,
  getTests,
  type MitreTechnique,
} from "@/lib/api";
import type { TestTrendDatum } from "@/components/charts/test-trend-chart";

// Lazy-load chart bundles the same way dashboard/page.tsx does — ssr:false
// skips server rendering (charts need real DOM sizing to measure
// ResponsiveContainer), and this keeps the recharts payload out of pages
// that don't render it.
const TestTrendChart = dynamic(
  () => import("@/components/charts/test-trend-chart"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[280px] items-center justify-center">
        <Skeleton className="h-full w-full rounded-lg" />
      </div>
    ),
  },
);

const PostureGauge = dynamic(
  () => import("@/components/charts/posture-gauge"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[180px] w-[180px] items-center justify-center">
        <Skeleton className="h-full w-full rounded-full" />
      </div>
    ),
  },
);

const DEFAULT_ENVIRONMENTS = ["lab", "dev", "prod"] as const;

const TACTIC_LABELS: Record<string, string> = {
  "initial-access": "Initial Access",
  execution: "Execution",
  persistence: "Persistence",
  "privilege-escalation": "Privilege Escalation",
  "defense-evasion": "Defense Evasion",
  "credential-access": "Credential Access",
  discovery: "Discovery",
  "lateral-movement": "Lateral Movement",
  collection: "Collection",
  "command-and-control": "Command & Control",
  exfiltration: "Exfiltration",
  impact: "Impact",
  reconnaissance: "Reconnaissance",
  "resource-development": "Resource Development",
};

type ReportTest = {
  id: number;
  technique_id?: string | null;
  detection_id?: string | null;
  detection_title?: string | null;
  status?: string | null;
  result?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  environment?: string | null;
  // Snapshot of the detection's rule hash at the moment the test ran.
  // Drives the "regressed detections" count — we group tests by this
  // value to compare current-version pass rate against the predecessor.
  detection_version_hash?: string | null;
};

type ReportDetection = {
  id: string;
  technique_id: string;
  title: string;
  status?: string | null;
  last_result?: string | null;
  last_tested_at?: string | null;
};

type SectionKey =
  | "metrics"
  | "actionItems"
  | "trustTrend"
  | "coverageByTactic";

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: "metrics", label: "Metrics" },
  { key: "actionItems", label: "What matters" },
  { key: "trustTrend", label: "Trust trend" },
  { key: "coverageByTactic", label: "Coverage by tactic" },
];

/**
 * Tiny CSV download helper. Avoids pulling a CSV library for what is
 * effectively a one-shot client-side export. Quotes any value containing
 * a comma, quote, or newline; doubles internal quotes per RFC 4180.
 */
function downloadCsv(rows: ReportTest[], filename: string) {
  const headers = [
    "test_id",
    "detection_id",
    "detection_title",
    "technique_id",
    "environment",
    "status",
    "result",
    "started_at",
    "finished_at",
    "detection_version_hash",
  ] as const;
  const escape = (value: unknown): string => {
    const str = value == null ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines: string[] = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.detection_id ?? "",
        row.detection_title ?? "",
        row.technique_id ?? "",
        row.environment ?? "",
        row.status ?? "",
        row.result ?? "",
        row.started_at ?? "",
        row.finished_at ?? "",
        row.detection_version_hash ?? "",
      ]
        .map(escape)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [detections, setDetections] = useState<ReportDetection[]>([]);
  const [tests, setTests] = useState<ReportTest[]>([]);
  const [techniques, setTechniques] = useState<MitreTechnique[]>([]);
  const [orgName, setOrgName] = useState("PurveX");
  const [scoringThresholds, setScoringThresholds] = useState({
    healthy: 80,
    atRisk: 50,
  });

  const [startDate, setStartDate] = useState<string>(() =>
    format(subMonths(new Date(), 1), "yyyy-MM-dd"),
  );
  const [endDate, setEndDate] = useState<string>(() =>
    format(new Date(), "yyyy-MM-dd"),
  );
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>([
    ...DEFAULT_ENVIRONMENTS,
  ]);
  const [sectionVisibility, setSectionVisibility] = useState<
    Record<SectionKey, boolean>
  >({
    metrics: true,
    actionItems: true,
    trustTrend: true,
    coverageByTactic: true,
  });
  const [adjustOpen, setAdjustOpen] = useState(false);

  useEffect(() => {
    async function loadReportData() {
      try {
        setLoading(true);
        const [detectionData, testData, techniqueData, org, scoring] =
          await Promise.all([
            getDetections(),
            getTests(),
            getMitreTechniques(),
            getOrganizationSettings(),
            getDetectionScoringSettings(),
          ]);

        setDetections(detectionData as ReportDetection[]);
        setTests(testData as ReportTest[]);
        setTechniques(techniqueData || []);

        if (org?.name) setOrgName(org.name);
        if (scoring) {
          setScoringThresholds({
            healthy: Number(scoring.health_threshold_healthy ?? 80),
            atRisk: Number(scoring.health_threshold_at_risk ?? 50),
          });
        }
      } finally {
        setLoading(false);
      }
    }

    void loadReportData();
  }, []);

  const reportData = useMemo(() => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    const envSet = new Set(selectedEnvironments);
    const periodDays = Math.max(1, differenceInDays(end, start) + 1);
    const priorStart = addDays(start, -periodDays);
    const priorEnd = addDays(start, -1);

    const inEnvironment = (test: ReportTest) =>
      selectedEnvironments.length === 0 ||
      !test.environment ||
      envSet.has(test.environment);

    const filteredTests = tests.filter((test) => {
      if (!inEnvironment(test)) return false;
      const timestamp = test.finished_at || test.started_at;
      if (!timestamp) return true;
      const date = new Date(timestamp);
      return date >= start && date <= end;
    });

    const priorTests = tests.filter((test) => {
      if (!inEnvironment(test)) return false;
      const timestamp = test.finished_at || test.started_at;
      if (!timestamp) return false;
      const date = new Date(timestamp);
      return date >= priorStart && date <= priorEnd;
    });

    const totalTests = filteredTests.length;
    const passCount = filteredTests.filter((test) => test.status === "PASS").length;
    const failCount = filteredTests.filter((test) => test.status === "FAIL").length;
    const inconclusiveCount = filteredTests.filter(
      (test) => test.status === "INCONCLUSIVE",
    ).length;
    const passRate = totalTests > 0 ? Math.round((passCount / totalTests) * 100) : 0;

    const coverageTechniqueIds = new Set(
      detections.map((detection) => detection.technique_id).filter(Boolean),
    );
    const totalTechniques = techniques.length;
    const coveredTechniques = coverageTechniqueIds.size;
    const coveragePercent =
      totalTechniques > 0 ? (coveredTechniques / totalTechniques) * 100 : 0;

    const tacticCoverage = new Map<string, { total: number; covered: number }>();
    techniques.forEach((technique) => {
      (technique.tactics || []).forEach((tactic) => {
        const current = tacticCoverage.get(tactic) || { total: 0, covered: 0 };
        current.total += 1;
        if (coverageTechniqueIds.has(technique.id)) current.covered += 1;
        tacticCoverage.set(tactic, current);
      });
    });

    const coverageByTactic = Array.from(tacticCoverage.entries())
      .map(([key, value]) => ({
        key,
        label: TACTIC_LABELS[key] || key,
        total: value.total,
        covered: value.covered,
        percent: value.total > 0 ? (value.covered / value.total) * 100 : 0,
      }))
      .sort((left, right) => left.percent - right.percent);

    const score = totalTests > 0 ? Math.round((passCount / totalTests) * 100) : 0;
    const priorPass = priorTests.filter((test) => test.status === "PASS").length;
    const priorScore =
      priorTests.length > 0 ? Math.round((priorPass / priorTests.length) * 100) : null;
    const scoreDelta = priorScore == null ? null : score - priorScore;

    const detectionStatusCounts = detections.reduce(
      (counts, detection) => {
        if (detection.last_result === "PASS") counts.healthy += 1;
        else if (detection.last_result === "FAIL") counts.failed += 1;
        else if (detection.last_result === "INCONCLUSIVE") counts.telemetryGap += 1;
        else counts.pending += 1;
        return counts;
      },
      { healthy: 0, failed: 0, telemetryGap: 0, pending: 0 },
    );

    const actionItems = detections
      .filter(
        (detection) =>
          detection.last_result === "FAIL" ||
          detection.last_result === "INCONCLUSIVE",
      )
      .sort((left, right) => {
        const leftRank = left.last_result === "FAIL" ? 0 : 1;
        const rightRank = right.last_result === "FAIL" ? 0 : 1;
        return leftRank - rightRank;
      })
      .slice(0, 8);

    const bucketCount = Math.min(periodDays, 30);
    const dayBuckets: Array<{ date: Date; pass: number; fail: number; inc: number }> = [];
    for (let index = 0; index < bucketCount; index += 1) {
      dayBuckets.push({
        date: addDays(start, index),
        pass: 0,
        fail: 0,
        inc: 0,
      });
    }

    filteredTests.forEach((test) => {
      const timestamp = test.finished_at || test.started_at;
      if (!timestamp) return;
      const date = new Date(timestamp);
      const index = differenceInDays(date, start);
      if (index < 0 || index >= dayBuckets.length) return;
      if (test.status === "PASS") dayBuckets[index].pass += 1;
      else if (test.status === "FAIL") dayBuckets[index].fail += 1;
      else if (test.status === "INCONCLUSIVE") dayBuckets[index].inc += 1;
    });

    const dayMax = Math.max(
      1,
      ...dayBuckets.map((bucket) => bucket.pass + bucket.fail + bucket.inc),
    );

    // ── Regressed detections (Feature 1's payoff) ─────────────────────────
    // For each detection, group its tests by detection_version_hash and
    // order by first_seen ASC. Treat the most-recent version with runs as
    // "current"; compare its pass-rate to the predecessor. A regression
    // exists when the current pass-rate is strictly lower than the
    // predecessor's, and BOTH have at least one run (zero-run buckets are
    // statistically meaningless).
    type VersionStats = {
      hash: string;
      runs: number;
      passes: number;
      firstSeen: number; // ms epoch
    };
    const isPass = (test: ReportTest) =>
      (test.result || "").toLowerCase() === "pass" || test.status === "PASS";
    const detectionsById = new Map(detections.map((d) => [d.id, d]));
    const versionsByDetection = new Map<string, VersionStats[]>();
    for (const test of filteredTests) {
      if (!test.detection_id || !test.detection_version_hash) continue;
      const ts = test.finished_at || test.started_at;
      if (!ts) continue;
      const epoch = new Date(ts).getTime();
      const list = versionsByDetection.get(test.detection_id) ?? [];
      const existing = list.find((v) => v.hash === test.detection_version_hash);
      if (existing) {
        existing.runs += 1;
        if (isPass(test)) existing.passes += 1;
        if (epoch < existing.firstSeen) existing.firstSeen = epoch;
      } else {
        list.push({
          hash: test.detection_version_hash,
          runs: 1,
          passes: isPass(test) ? 1 : 0,
          firstSeen: epoch,
        });
      }
      versionsByDetection.set(test.detection_id, list);
    }
    const regressedDetections: Array<{
      id: string;
      title: string;
      deltaPct: number; // negative
      currentLabel: string;
      prevLabel: string;
    }> = [];
    for (const [detectionId, versions] of versionsByDetection) {
      if (versions.length < 2) continue;
      versions.sort((a, b) => a.firstSeen - b.firstSeen);
      const current = versions[versions.length - 1];
      const prev = versions[versions.length - 2];
      if (current.runs === 0 || prev.runs === 0) continue;
      const currentRate = current.passes / current.runs;
      const prevRate = prev.passes / prev.runs;
      const deltaPct = Math.round((currentRate - prevRate) * 100);
      if (deltaPct >= 0) continue;
      const detection = detectionsById.get(detectionId);
      if (!detection) continue;
      regressedDetections.push({
        id: detectionId,
        title: detection.title,
        deltaPct,
        currentLabel: `v${versions.length}`,
        prevLabel: `v${versions.length - 1}`,
      });
    }
    regressedDetections.sort((a, b) => a.deltaPct - b.deltaPct); // worst drops first
    const regressedCount = regressedDetections.length;

    // ── Stale rules ───────────────────────────────────────────────────────
    // Detections with no validation in the last 30 days (or never tested).
    // The most defensible "we're actively testing" metric for an auditor.
    const STALE_DAY_THRESHOLD = 30;
    const now = Date.now();
    const staleDetections = detections.filter((detection) => {
      if (!detection.last_tested_at) return true;
      const tested = new Date(detection.last_tested_at).getTime();
      if (Number.isNaN(tested)) return true;
      const daysSince = (now - tested) / (1000 * 60 * 60 * 24);
      return daysSince > STALE_DAY_THRESHOLD;
    });
    const staleCount = staleDetections.length;

    // ── Telemetry-gap details (for the "What matters" section) ────────────
    const telemetryGapDetections = detections.filter(
      (detection) => detection.last_result === "INCONCLUSIVE",
    );

    return {
      totalTests,
      passCount,
      failCount,
      inconclusiveCount,
      passRate,
      coveragePercent,
      coveredTechniques,
      totalTechniques,
      coverageByTactic,
      score,
      scoreDelta,
      detectionStatusCounts,
      actionItems,
      dayBuckets,
      dayMax,
      periodDays,
      regressedDetections,
      regressedCount,
      staleDetections,
      staleCount,
      telemetryGapDetections,
      filteredTests,
    };
  }, [detections, endDate, selectedEnvironments, startDate, techniques, tests]);

  const scoreTone =
    reportData.score >= scoringThresholds.healthy
      ? {
          label: "Trusted posture",
          pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
          gauge: "#10b981",
        }
      : reportData.score >= scoringThresholds.atRisk
        ? {
            label: "Attention needed",
            pill: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
            gauge: "#f59e0b",
          }
        : {
            label: "Critical blockers",
            pill: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
            gauge: "#f43f5e",
          };

  // Trust-trend data shaped for TestTrendChart — reuses the same date-fns
  // `format` already imported for the rest of this page's date display.
  const trendData: TestTrendDatum[] = reportData.dayBuckets.map((bucket) => ({
    date: format(bucket.date, "MMM d"),
    Pass: bucket.pass,
    Fail: bucket.fail,
    Inconclusive: bucket.inc,
  }));

  // Keys the stagger-children animation on the lists/grids below so
  // changing the adjust-bar filters (date range, environments) replays the
  // rise-in animation as "the data just changed" feedback.
  const filterKey = `${startDate}|${endDate}|${selectedEnvironments.join(",")}`;

  function toggleEnvironment(environment: string) {
    setSelectedEnvironments((previous) =>
      previous.includes(environment)
        ? previous.filter((value) => value !== environment)
        : [...previous, environment],
    );
  }

  function toggleSection(section: SectionKey) {
    setSectionVisibility((previous) => ({
      ...previous,
      [section]: !previous[section],
    }));
  }

  const showAdjustControls = !loading;
  const exportFilename = `purvex-validations-${format(new Date(), "yyyy-MM-dd")}.csv`;
  const dateRangeLabel = `${format(new Date(`${startDate}T00:00:00`), "MMM d")} – ${format(new Date(`${endDate}T00:00:00`), "MMM d, yyyy")}`;
  const envSummary =
    selectedEnvironments.length === DEFAULT_ENVIRONMENTS.length
      ? "All environments"
      : selectedEnvironments.join(", ") || "no environments";

  return (
    <PageContainer maxWidth="full" className="space-y-6 print:space-y-4">
      {/* Header — title + actions. No card, no eyebrow. */}
      <header className="flex flex-wrap items-center justify-between gap-3 print:gap-1">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            Validation report
          </h1>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {orgName} · generated {format(new Date(), "MMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            disabled={loading}
          >
            <Printer className="h-3.5 w-3.5" />
            Print
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(reportData.filteredTests, exportFilename)
            }
            disabled={loading || reportData.filteredTests.length === 0}
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>
      </header>

      {/* Adjust bar — current scope summary on the left, expand toggle on
          the right. Hidden by default; one click reveals the date / env /
          tile pickers inline. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--stroke-soft)] pb-3 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-x-3">
          <span>{dateRangeLabel}</span>
          <span aria-hidden>·</span>
          <span>{envSummary}</span>
        </div>
        {showAdjustControls ? (
          <button
            type="button"
            onClick={() => setAdjustOpen((value) => !value)}
            className="text-slate-500 transition-colors hover:text-[var(--foreground)] dark:text-slate-400 print:hidden"
          >
            {adjustOpen ? "− adjust" : "⋯ adjust"}
          </button>
        ) : null}
      </div>

      {adjustOpen ? (
        <Card className="print:hidden">
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <Label>Window</Label>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-sm text-[var(--foreground)] focus:border-[var(--accent-line)] focus:outline-none"
                />
                <span className="text-slate-400 dark:text-slate-500">→</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2.5 py-1.5 text-sm text-[var(--foreground)] focus:border-[var(--accent-line)] focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-3">
              <Label>Environments</Label>
              <div className="inline-flex rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
                {DEFAULT_ENVIRONMENTS.map((environment) => {
                  const active = selectedEnvironments.includes(environment);
                  return (
                    <button
                      key={environment}
                      type="button"
                      onClick={() => toggleEnvironment(environment)}
                      className={cn(
                        "rounded-md border px-4 py-1.5 text-sm font-medium capitalize transition-all",
                        active
                          ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-strong)] shadow-sm"
                          : "border-transparent text-[var(--surface-subtle-foreground)] hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)]",
                      )}
                    >
                      {environment}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <Label>Show</Label>
              <div className="flex flex-wrap gap-2">
                {SECTIONS.map((section) => {
                  const visible = sectionVisibility[section.key];
                  return (
                    <button
                      key={section.key}
                      type="button"
                      onClick={() => toggleSection(section.key)}
                      className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
                    >
                      <Chip
                        tone={visible ? "accent" : "muted"}
                        appearance={visible ? "solid" : "outline"}
                        className="cursor-pointer"
                      >
                        {section.label}
                      </Chip>
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Posture — radial gauge with delta. */}
      <Card>
        <CardContent className="flex flex-col items-center gap-5 sm:flex-row">
          <div className="relative h-[180px] w-[180px] shrink-0">
            <PostureGauge score={reportData.score} color={scoreTone.gauge} height={180} />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-4xl font-semibold tracking-tight text-[var(--foreground)]">
                {loading ? "--" : reportData.score}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">/ 100</span>
            </div>
          </div>
          <div className="flex-1 space-y-2 text-center sm:text-left">
            <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              Posture
            </p>
            <p className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium", scoreTone.pill)}>
              {scoreTone.label}
            </p>
            {reportData.scoreDelta != null ? (
              <p
                className={cn(
                  "text-xs font-medium",
                  reportData.scoreDelta > 0 && "text-emerald-600 dark:text-emerald-400",
                  reportData.scoreDelta < 0 && "text-rose-600 dark:text-rose-400",
                  reportData.scoreDelta === 0 && "text-slate-500 dark:text-slate-400",
                )}
              >
                {reportData.scoreDelta > 0
                  ? "▲"
                  : reportData.scoreDelta < 0
                    ? "▼"
                    : "—"}{" "}
                {Math.abs(reportData.scoreDelta)} pts vs prior {reportData.periodDays}d
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Metrics — the five things PurveX can prove: validated coverage,
          validation activity, regressions caught by versioning, telemetry
          gaps, and stale rules. No vague counters. */}
      {sectionVisibility.metrics ? (
        <section className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Metrics
          </p>
          <div
            key={filterKey}
            className="stagger-children grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5"
          >
            <StatTile
              icon={Target}
              tone="muted"
              value={`${reportData.coveragePercent.toFixed(0)}%`}
              label="Proven ATT&CK Coverage"
              caption={`${reportData.coveredTechniques} / ${reportData.totalTechniques} techniques validated`}
            />
            <StatTile
              icon={Activity}
              tone="muted"
              value={`${reportData.totalTests}`}
              label="Validations Run"
              caption={
                reportData.scoreDelta == null
                  ? `${reportData.passRate}% pass rate`
                  : `${reportData.scoreDelta > 0 ? "▲" : reportData.scoreDelta < 0 ? "▼" : "—"} ${Math.abs(reportData.scoreDelta)} pt pass-rate vs prior period`
              }
            />
            <StatTile
              icon={TrendingDown}
              tone={reportData.regressedCount > 0 ? "danger" : "muted"}
              value={`${reportData.regressedCount}`}
              label="Detections Regressed"
              caption="Since the last rule edit"
            />
            <StatTile
              icon={ScanLine}
              tone={reportData.detectionStatusCounts.telemetryGap > 0 ? "warning" : "muted"}
              value={`${reportData.detectionStatusCounts.telemetryGap}`}
              label="Blind Spots"
              caption="Blocking validation"
            />
            <StatTile
              icon={Clock3}
              tone={reportData.staleCount > 0 ? "warning" : "muted"}
              value={`${reportData.staleCount}`}
              label="Stale Rules"
              caption="No validation > 30 days"
            />
          </div>
        </section>
      ) : null}

      {/* What matters — concrete, named items the user can act on, each
          linking to the receipts (the detection's history, or a prefilled
          telemetry check). Hidden when there's literally nothing. */}
      {sectionVisibility.actionItems &&
      (reportData.regressedDetections.length > 0 ||
        reportData.telemetryGapDetections.length > 0) ? (
        <section className="space-y-5 border-t border-[var(--stroke-soft)] pt-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            What matters
          </p>

          {reportData.regressedDetections.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Regressed detections ({reportData.regressedDetections.length})
              </p>
              <ul key={filterKey} className="stagger-children space-y-1.5 text-sm">
                {reportData.regressedDetections.slice(0, 6).map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/detections/${item.id}`}
                      className="group flex items-center gap-3 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 shadow-sm transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--interactive-surface-hover)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          <span className="font-mono text-xs text-slate-400 dark:text-slate-500">
                            {item.currentLabel}
                          </span>
                          <span className="truncate text-[var(--foreground)] transition-colors group-hover:text-[var(--accent-strong)]">
                            {item.title}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                          ▼ {Math.abs(item.deltaPct)} pts vs {item.prevLabel}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 flex-shrink-0 text-[var(--surface-subtle-foreground)] transition-colors group-hover:text-[var(--surface-card-foreground)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {reportData.telemetryGapDetections.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--foreground)]">
                Blind spots ({reportData.telemetryGapDetections.length})
              </p>
              <ul key={filterKey} className="stagger-children space-y-1.5 text-sm">
                {reportData.telemetryGapDetections.slice(0, 6).map((d) => (
                  <li key={d.id}>
                    <Link
                      href={buildRunTestHref({
                        d: d.id,
                        t: d.technique_id ?? undefined,
                        env: "dev",
                        mode: "telemetry",
                      })}
                      className="group flex items-center gap-3 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 shadow-sm transition-colors hover:border-[var(--accent-line)] hover:bg-[var(--interactive-surface-hover)]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[var(--foreground)] transition-colors group-hover:text-[var(--accent-strong)]">
                          {d.title}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                          {d.technique_id || "no technique mapped"}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 flex-shrink-0 text-[var(--surface-subtle-foreground)] transition-colors group-hover:text-[var(--surface-card-foreground)]" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Trust trend — real stacked area chart of daily pass/fail/blind-spot
          activity. Hidden when there are no runs at all. */}
      {sectionVisibility.trustTrend && reportData.totalTests > 0 ? (
        <Card>
          <CardHeader className="border-b border-[var(--stroke-soft)] pb-4">
            <CardTitle className="text-base font-semibold text-[var(--foreground)]">
              Trust trend
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 dark:text-slate-400">
              {reportData.periodDays}-day validation activity · Pass {reportData.passCount} · Fail {reportData.failCount} · Blind spot {reportData.inconclusiveCount}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <TestTrendChart data={trendData} height={280} />
          </CardContent>
        </Card>
      ) : null}

      {/* Coverage by tactic — same data, hairline-thin progress bars, now
          clickable through to that tactic's lane in the MITRE matrix. */}
      {sectionVisibility.coverageByTactic &&
      reportData.coverageByTactic.length > 0 ? (
        <section className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Coverage by tactic
          </p>
          <ul key={filterKey} className="stagger-children space-y-2 text-sm">
            {reportData.coverageByTactic.map((row) => (
              <li key={row.key}>
                <Link
                  href={`/mitre?tactic=${encodeURIComponent(row.key)}`}
                  title={`${row.covered} of ${row.total} techniques covered (${row.percent.toFixed(1)}%)`}
                  className="group -mx-1.5 block space-y-1 rounded-md p-1.5 transition-colors hover:bg-[var(--interactive-surface-hover)]"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[var(--foreground)] transition-colors group-hover:text-[var(--accent-strong)]">
                      {row.label}
                    </span>
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                      {row.covered}/{row.total} · {row.percent.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        row.percent >= 75
                          ? "bg-emerald-500"
                          : row.percent >= 40
                            ? "bg-amber-500"
                            : "bg-rose-500",
                      )}
                      style={{ width: `${row.percent}%` }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Empty state — only when there's truly nothing in the entire
          selected scope, not per-section. */}
      {!loading &&
      reportData.totalTests === 0 &&
      reportData.coverageByTactic.length === 0 &&
      reportData.regressedCount === 0 &&
      reportData.staleCount === 0 ? (
        <section className="border-t border-[var(--stroke-soft)] py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          No validation data in the selected scope. Widen the date range or add
          environments.
        </section>
      ) : null}
    </PageContainer>
  );
}

/**
 * One tile in the metrics grid. Mirrors the stat-tile recipe established in
 * dashboard/page.tsx's "Detailed Stats Grid": eyebrow label + icon, a large
 * toned value, and a muted caption underneath.
 */
function StatTile({
  icon: Icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  caption: string;
  tone: Tone;
}) {
  return (
    <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 shadow-sm transition-colors hover:border-[var(--accent-line)]">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
          {label}
        </p>
        <Icon className={cn("h-3.5 w-3.5", toneClasses(tone).icon)} />
      </div>
      <p className={cn("mb-0.5 text-3xl font-display font-bold leading-tight", toneClasses(tone).text)}>
        {value}
      </p>
      <p className="text-xs font-medium text-[var(--surface-subtle-foreground)]">{caption}</p>
    </div>
  );
}
