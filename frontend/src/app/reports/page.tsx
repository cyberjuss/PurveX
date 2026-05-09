"use client";

import { useEffect, useMemo, useState } from "react";
import { addDays, differenceInDays, format, subMonths } from "date-fns";
import { Download, Printer } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getDetections,
  getDetectionScoringSettings,
  getMitreTechniques,
  getOrganizationSettings,
  getTests,
  type MitreTechnique,
} from "@/lib/api";

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
        }
      : reportData.score >= scoringThresholds.atRisk
        ? {
            label: "Attention needed",
            pill: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
          }
        : {
            label: "Critical blockers",
            pill: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
          };

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
        // Grid keeps all three rows on a shared baseline: labels in a
        // fixed left column, controls flowing in a flexible right column.
        // Without the grid, each row's flex-wrap caused the labels to
        // drift out of alignment whenever the values wrapped differently.
        <dl className="grid grid-cols-[7rem_1fr] items-baseline gap-x-5 gap-y-3 border-b border-[var(--stroke-soft)] pb-6 text-sm print:hidden">
          <dt className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Window
          </dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="border-b border-[var(--stroke-soft)] bg-transparent py-0.5 leading-none text-[var(--foreground)] focus:border-[var(--foreground)] focus:outline-none"
            />
            <span className="text-slate-400 dark:text-slate-500">→</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="border-b border-[var(--stroke-soft)] bg-transparent py-0.5 leading-none text-[var(--foreground)] focus:border-[var(--foreground)] focus:outline-none"
            />
          </dd>

          <dt className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Environments
          </dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {DEFAULT_ENVIRONMENTS.map((environment, idx) => {
              const active = selectedEnvironments.includes(environment);
              return (
                <span key={environment} className="flex items-baseline gap-x-3">
                  {idx > 0 ? (
                    <span aria-hidden className="text-slate-400 dark:text-slate-600">·</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => toggleEnvironment(environment)}
                    className={cn(
                      "transition-colors",
                      active
                        ? "font-semibold text-[var(--foreground)] underline underline-offset-4"
                        : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400",
                    )}
                  >
                    {environment}
                  </button>
                </span>
              );
            })}
          </dd>

          <dt className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Show
          </dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {SECTIONS.map((section, idx) => (
              <span key={section.key} className="flex items-baseline gap-x-3">
                {idx > 0 ? (
                  <span aria-hidden className="text-slate-400 dark:text-slate-600">·</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => toggleSection(section.key)}
                  className={cn(
                    "transition-colors",
                    sectionVisibility[section.key]
                      ? "font-semibold text-[var(--foreground)] underline underline-offset-4"
                      : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400",
                  )}
                >
                  {section.label}
                </button>
              </span>
            ))}
          </dd>
        </dl>
      ) : null}

      {/* Posture — single big number with delta. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Posture
          </p>
          {reportData.scoreDelta != null ? (
            <span
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
            </span>
          ) : null}
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-5xl font-semibold tracking-tight text-[var(--foreground)]">
            {loading ? "--" : reportData.score}
          </span>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            / 100 · {scoreTone.label}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              reportData.score >= scoringThresholds.healthy
                ? "bg-emerald-500"
                : reportData.score >= scoringThresholds.atRisk
                  ? "bg-amber-500"
                  : "bg-rose-500",
            )}
            style={{ width: `${Math.min(100, Math.max(0, reportData.score))}%` }}
          />
        </div>
      </section>

      {/* Metrics — five-line value list. The five we picked because they
          are exactly what PurveX can prove: validated coverage, validation
          activity, regressions caught by versioning, telemetry gaps, and
          stale rules. No vague counters. */}
      {sectionVisibility.metrics ? (
        <section className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Metrics
          </p>
          <ul className="space-y-2 text-sm">
            <MetricRow
              value={`${reportData.coveragePercent.toFixed(0)}%`}
              label="Proven ATT&CK Coverage"
              detail={`${reportData.coveredTechniques} / ${reportData.totalTechniques} Techniques Validated`}
            />
            <MetricRow
              value={`${reportData.totalTests}`}
              label="Validations Run"
              detail={
                reportData.scoreDelta == null
                  ? `${reportData.passRate}% Pass Rate`
                  : `${reportData.scoreDelta > 0 ? "▲" : reportData.scoreDelta < 0 ? "▼" : "—"} ${Math.abs(reportData.scoreDelta)} pt pass-rate vs prior period`
              }
            />
            <MetricRow
              value={`${reportData.regressedCount}`}
              label="Detections Regressed"
              detail="Since the Last Rule Edit"
              tone={reportData.regressedCount > 0 ? "rose" : undefined}
            />
            <MetricRow
              value={`${reportData.detectionStatusCounts.telemetryGap}`}
              label="Telemetry Gaps"
              detail="Blocking Validation"
              tone={
                reportData.detectionStatusCounts.telemetryGap > 0
                  ? "amber"
                  : undefined
              }
            />
            <MetricRow
              value={`${reportData.staleCount}`}
              label="Stale Rules"
              detail="No Validation > 30 Days"
              tone={reportData.staleCount > 0 ? "amber" : undefined}
            />
          </ul>
        </section>
      ) : null}

      {/* What matters — concrete, named items the user can act on. Pulls
          from the same data that drove the metrics line above; this is
          the receipts. Hidden when there's literally nothing. */}
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
              <ul className="space-y-1.5 text-sm">
                {reportData.regressedDetections.slice(0, 6).map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-baseline gap-x-3"
                  >
                    <span className="font-mono text-xs text-slate-400 dark:text-slate-500">
                      {item.currentLabel}
                    </span>
                    <span className="text-[var(--foreground)]">{item.title}</span>
                    <span className="font-medium text-rose-600 dark:text-rose-400">
                      ▼ {Math.abs(item.deltaPct)} pts vs {item.prevLabel}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {reportData.telemetryGapDetections.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--foreground)]">
                No logs ({reportData.telemetryGapDetections.length})
              </p>
              <ul className="space-y-1.5 text-sm">
                {reportData.telemetryGapDetections.slice(0, 6).map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-[var(--foreground)]">{d.title}</span>
                    <span className="text-amber-600 dark:text-amber-400">
                      {d.technique_id || "no technique mapped"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Trust trend — keeps the existing daily activity stack but loses
          the boxed wrapper. Hidden when there are no runs at all. */}
      {sectionVisibility.trustTrend && reportData.totalTests > 0 ? (
        <section className="space-y-4 border-t border-[var(--stroke-soft)] pt-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Trust trend ({reportData.periodDays} days)
          </p>
          <div className="flex h-32 items-end gap-1">
            {reportData.dayBuckets.map((bucket, index) => {
              const total = bucket.pass + bucket.fail + bucket.inc;
              const heightPercent =
                total > 0 ? Math.max(5, (total / reportData.dayMax) * 100) : 0;
              return (
                <div
                  key={index}
                  className="flex flex-1 flex-col-reverse overflow-hidden rounded-sm"
                  style={{ height: `${heightPercent}%` }}
                  title={`${format(bucket.date, "MMM dd")}: ${total} tests`}
                >
                  {bucket.pass > 0 ? (
                    <div className="bg-emerald-500" style={{ flex: bucket.pass }} />
                  ) : null}
                  {bucket.fail > 0 ? (
                    <div className="bg-rose-500" style={{ flex: bucket.fail }} />
                  ) : null}
                  {bucket.inc > 0 ? (
                    <div className="bg-amber-500" style={{ flex: bucket.inc }} />
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>{format(reportData.dayBuckets[0].date, "MMM dd")}</span>
            <div className="flex flex-wrap items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-emerald-500" />
                Pass {reportData.passCount}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-rose-500" />
                Fail {reportData.failCount}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-amber-500" />
                Inconclusive {reportData.inconclusiveCount}
              </span>
            </div>
            <span>
              {format(
                reportData.dayBuckets[reportData.dayBuckets.length - 1].date,
                "MMM dd",
              )}
            </span>
          </div>
        </section>
      ) : null}

      {/* Coverage by tactic — same data, hairline-thin progress bars. */}
      {sectionVisibility.coverageByTactic &&
      reportData.coverageByTactic.length > 0 ? (
        <section className="space-y-3 border-t border-[var(--stroke-soft)] pt-6">
          <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Coverage by tactic
          </p>
          <ul className="space-y-2 text-sm">
            {reportData.coverageByTactic.map((row) => (
              <li key={row.key} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[var(--foreground)]">{row.label}</span>
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
 * One row in the metrics block. Reads as a sentence:
 * "68%   Proven ATT&CK Coverage   47 / 69 Techniques Validated"
 *
 * The big number is value, the bold label is what it counts, and the
 * muted detail explains the context. No card wrapper — the row sits
 * inside an editorial list that gets its rhythm from spacing alone.
 */
function MetricRow({
  value,
  label,
  detail,
  tone,
}: {
  value: string;
  label: string;
  detail: string;
  tone?: "rose" | "amber";
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span
        className={cn(
          "min-w-[3.5rem] font-mono text-base font-semibold tabular-nums text-[var(--foreground)]",
          tone === "rose" && "text-rose-600 dark:text-rose-400",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </span>
      <span className="text-[var(--foreground)]">{label}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">{detail}</span>
    </li>
  );
}
