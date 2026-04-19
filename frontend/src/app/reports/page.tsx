"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import { addDays, differenceInDays, format, subMonths } from "date-fns";
import {
  getDetections,
  getDetectionScoringSettings,
  getMitreTechniques,
  getOrganizationSettings,
  getTests,
  MitreTechnique,
} from "@/lib/api";
import {
  Activity,
  AlertTriangle,
  Check,
  Download,
  FileText,
  Minus,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

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
  status?: string;
  started_at?: string;
  finished_at?: string | null;
  environment?: string;
};

type ReportDetection = {
  id: string;
  technique_id: string;
  title: string;
  status?: string | null;
  last_result?: string | null;
  last_tested_at?: string | null;
};

type SectionKey = "coverageByTactic" | "actionItems" | "detectionHealth" | "activityTrend";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "coverageByTactic", label: "Coverage by tactic" },
  { key: "actionItems", label: "Action items" },
  { key: "detectionHealth", label: "Trust state" },
  { key: "activityTrend", label: "Activity trend" },
];

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
    format(subMonths(new Date(), 1), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>([...DEFAULT_ENVIRONMENTS]);
  const [sectionVisibility, setSectionVisibility] = useState<Record<SectionKey, boolean>>({
    coverageByTactic: true,
    actionItems: true,
    detectionHealth: true,
    activityTrend: true,
  });

  useEffect(() => {
    const loadReportData = async () => {
      try {
        setLoading(true);
        const [detectionsData, testsData, techniqueData, org, scoring] = await Promise.all([
          getDetections(),
          getTests(),
          getMitreTechniques(),
          getOrganizationSettings(),
          getDetectionScoringSettings(),
        ]);
        setDetections(detectionsData as ReportDetection[]);
        setTests(testsData as ReportTest[]);
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
    };

    loadReportData();
  }, []);

  const reportData = useMemo(() => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);
    const envSet = new Set(selectedEnvironments);
    const periodDays = Math.max(1, differenceInDays(end, start) + 1);
    const priorStart = addDays(start, -periodDays);
    const priorEnd = addDays(start, -1);

    const inEnv = (test: ReportTest) =>
      selectedEnvironments.length === 0 || !test.environment || envSet.has(test.environment);

    const filteredTests = tests.filter((test) => {
      if (!inEnv(test)) return false;
      const ts = test.finished_at || test.started_at;
      if (!ts) return true;
      const dt = new Date(ts);
      return dt >= start && dt <= end;
    });

    const priorTests = tests.filter((test) => {
      if (!inEnv(test)) return false;
      const ts = test.finished_at || test.started_at;
      if (!ts) return false;
      const dt = new Date(ts);
      return dt >= priorStart && dt <= priorEnd;
    });

    const passCount = filteredTests.filter((t) => t.status === "PASS").length;
    const failCount = filteredTests.filter((t) => t.status === "FAIL").length;
    const inconclusiveCount = filteredTests.filter((t) => t.status === "INCONCLUSIVE").length;
    const totalTests = filteredTests.length;
    const passRate = totalTests > 0 ? Math.round((passCount / totalTests) * 100) : 0;

    const coverageTechniqueIds = new Set(
      detections.map((d) => d.technique_id).filter((id) => Boolean(id))
    );
    const totalTechniques = techniques.length;
    const coveredTechniques = coverageTechniqueIds.size;
    const coveragePercent = totalTechniques > 0 ? (coveredTechniques / totalTechniques) * 100 : 0;

    const tacticCoverage = new Map<string, { total: number; covered: number }>();
    techniques.forEach((tech) => {
      (tech.tactics || []).forEach((tactic) => {
        const entry = tacticCoverage.get(tactic) || { total: 0, covered: 0 };
        entry.total += 1;
        if (coverageTechniqueIds.has(tech.id)) entry.covered += 1;
        tacticCoverage.set(tactic, entry);
      });
    });
    const coverageByTactic = Array.from(tacticCoverage.entries())
      .map(([key, v]) => ({
        key,
        label: TACTIC_LABELS[key] || key,
        total: v.total,
        covered: v.covered,
        percent: v.total > 0 ? (v.covered / v.total) * 100 : 0,
      }))
      .sort((a, b) => a.percent - b.percent);

    const score = totalTests > 0 ? Math.round((passCount / totalTests) * 100) : 0;
    const priorPass = priorTests.filter((t) => t.status === "PASS").length;
    const priorScore = priorTests.length > 0 ? Math.round((priorPass / priorTests.length) * 100) : null;
    const scoreDelta = priorScore == null ? null : score - priorScore;

    const detectionStatusCounts = detections.reduce(
      (acc, detection) => {
        const result = detection.last_result;
        if (result === "PASS") acc.healthy += 1;
        else if (result === "FAIL") acc.failed += 1;
        else if (result === "INCONCLUSIVE") acc.telemetryGap += 1;
        else acc.pending += 1;
        return acc;
      },
      { healthy: 0, failed: 0, telemetryGap: 0, pending: 0 }
    );

    const actionItems = detections
      .filter((d) => d.last_result === "FAIL" || d.last_result === "INCONCLUSIVE")
      .sort((a, b) => {
        const ar = a.last_result === "FAIL" ? 0 : 1;
        const br = b.last_result === "FAIL" ? 0 : 1;
        return ar - br;
      })
      .slice(0, 8);

    const totalDays = Math.min(periodDays, 30);
    const dayBuckets: { date: Date; pass: number; fail: number; inc: number }[] = [];
    for (let i = 0; i < totalDays; i += 1) {
      dayBuckets.push({ date: addDays(start, i), pass: 0, fail: 0, inc: 0 });
    }
    filteredTests.forEach((t) => {
      const ts = t.finished_at || t.started_at;
      if (!ts) return;
      const dt = new Date(ts);
      const idx = differenceInDays(dt, start);
      if (idx < 0 || idx >= dayBuckets.length) return;
      if (t.status === "PASS") dayBuckets[idx].pass += 1;
      else if (t.status === "FAIL") dayBuckets[idx].fail += 1;
      else if (t.status === "INCONCLUSIVE") dayBuckets[idx].inc += 1;
    });
    const dayMax = Math.max(1, ...dayBuckets.map((b) => b.pass + b.fail + b.inc));

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
    };
  }, [detections, tests, techniques, startDate, endDate, selectedEnvironments]);

  const scoreTone =
    reportData.score >= scoringThresholds.healthy
      ? { label: "Trusted posture", badge: "bg-emerald-100 text-emerald-700 border-emerald-200" }
      : reportData.score >= scoringThresholds.atRisk
        ? { label: "Attention needed", badge: "bg-amber-100 text-amber-700 border-amber-200" }
        : { label: "Critical blockers", badge: "bg-red-100 text-red-700 border-red-200" };

  const impactNarrative = useMemo(() => {
    const failing = reportData.detectionStatusCounts.failed;
    const gaps = reportData.detectionStatusCounts.telemetryGap;
    const uncovered = reportData.totalTechniques - reportData.coveredTechniques;
    const coveragePct = reportData.coveragePercent.toFixed(0);

    if (failing === 0 && gaps === 0 && uncovered === 0) {
      return "Detection posture is trusted across the selected scope. No detections need tuning, no telemetry gaps are blocking validation, and MITRE coverage is complete.";
    }
    const parts: string[] = [];
    parts.push(`${coveragePct}% MITRE coverage with ${uncovered} technique${uncovered === 1 ? "" : "s"} unaddressed`);
    if (failing > 0) parts.push(`${failing} detection${failing === 1 ? "" : "s"} need tuning`);
    if (gaps > 0) parts.push(`${gaps} telemetry gap${gaps === 1 ? "" : "s"} blocking validation`);
    return `${parts.join(" · ")}.`;
  }, [reportData]);

  const toggleEnv = (env: string) => {
    setSelectedEnvironments((prev) =>
      prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env]
    );
  };

  const toggleSection = (key: SectionKey) => {
    setSectionVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <PageContainer maxWidth="full" className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          eyebrow="Validation reporting"
          title="Reports"
          subtitle="Package validation posture, coverage, and what needs to be fixed next."
          icon={<FileText className="h-5 w-5" />}
        />
      </div>

      {/* Compact toolbar */}
      <div className="print:hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div className="flex items-end gap-2">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">From</p>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-10 w-[160px] border-slate-200 bg-white text-sm text-slate-900"
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">To</p>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-10 w-[160px] border-slate-200 bg-white text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="h-10 w-px bg-slate-200" />

          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Environments</p>
            <div className="flex gap-1.5">
              {DEFAULT_ENVIRONMENTS.map((env) => {
                const active = selectedEnvironments.includes(env);
                return (
                  <button
                    key={env}
                    onClick={() => toggleEnv(env)}
                    className={cn(
                      "h-10 rounded-lg border px-3 text-xs font-semibold uppercase tracking-wider transition",
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                    )}
                  >
                    {env}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ml-auto flex items-end">
            <Button
              className="h-10 bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => window.print()}
              disabled={loading}
            >
              <Download className="mr-2 h-4 w-4" />
              Export PDF
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Sections</span>
          {SECTIONS.map((item) => {
            const active = sectionVisibility[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => toggleSection(item.key)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                )}
              >
                {active && <Check className="h-3 w-3" />}
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Report preview */}
      <div
        data-report-export="true"
        className="rounded-3xl border border-slate-200 bg-white shadow-[0_30px_80px_-60px_rgba(15,23,42,0.35)] p-10 md:p-12 space-y-8 print:border-none print:shadow-none print:p-0 print:text-[12px] print:leading-snug print:space-y-6"
      >
        {/* Hero header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-8 print:pb-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500 print:text-[10px]">
              Detection effectiveness report
            </p>
            <h2 className="mt-2 text-4xl font-display font-bold text-slate-900 print:text-2xl print:mt-1">
              {orgName}
            </h2>
            <p className="mt-2 text-base text-slate-600 print:text-xs print:mt-1">
              {format(new Date(startDate), "MMM dd, yyyy")} – {format(new Date(endDate), "MMM dd, yyyy")} · {reportData.periodDays}-day window
            </p>
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs text-slate-500 print:text-[10px]">Generated</p>
            <p className="text-base font-semibold text-slate-900 print:text-xs">
              {format(new Date(), "MMM dd, yyyy HH:mm")}
            </p>
            <div className="flex flex-wrap justify-end gap-1 pt-1">
              {selectedEnvironments.map((env) => (
                <Badge
                  key={env}
                  className="border-slate-200 bg-slate-100 text-[10px] uppercase text-slate-700 print:text-[9px] print:py-0"
                >
                  {env}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Business Impact narrative */}
        <div className="rounded-2xl border border-slate-200 border-l-4 border-l-slate-900 bg-slate-50 p-5 print:break-inside-avoid">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Business impact</p>
          <p className="mt-2 text-base font-medium text-slate-900 print:text-sm">{impactNarrative}</p>
        </div>

        {/* KPI Strip — every tile answers a leadership question */}
        <div className="grid gap-4 md:grid-cols-5 print:gap-2 print:break-inside-avoid">
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 p-5 text-white print:bg-slate-900 print:p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Posture score
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <p className="text-4xl font-display font-bold print:text-2xl">
                {loading ? "–" : reportData.score}
              </p>
              <span className="text-sm text-slate-300">/100</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <Badge className={cn("text-[10px]", scoreTone.badge)}>{scoreTone.label}</Badge>
              {reportData.scoreDelta !== null && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 text-[11px] font-semibold",
                    reportData.scoreDelta > 0
                      ? "text-emerald-300"
                      : reportData.scoreDelta < 0
                        ? "text-red-300"
                        : "text-slate-300"
                  )}
                >
                  {reportData.scoreDelta > 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : reportData.scoreDelta < 0 ? (
                    <TrendingDown className="h-3 w-3" />
                  ) : (
                    <Minus className="h-3 w-3" />
                  )}
                  {reportData.scoreDelta > 0 ? "+" : ""}
                  {reportData.scoreDelta} pts
                </span>
              )}
            </div>
          </div>

          <KpiTile
            icon={<Target className="h-3.5 w-3.5" />}
            label="MITRE coverage"
            value={`${reportData.coveragePercent.toFixed(0)}%`}
            sub={`${reportData.coveredTechniques}/${reportData.totalTechniques} techniques`}
            tone="sky"
          />
          <KpiTile
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            label="Failing detections"
            value={reportData.detectionStatusCounts.failed}
            sub="need analyst action"
            tone="red"
          />
          <KpiTile
            label="Telemetry gaps"
            value={reportData.detectionStatusCounts.telemetryGap}
            sub="blocking validation"
            tone="amber"
          />
          <KpiTile
            icon={<Activity className="h-3.5 w-3.5" />}
            label="Tests run"
            value={reportData.totalTests}
            sub={`${reportData.passRate}% pass rate`}
            tone="emerald"
          />
        </div>

        {sectionVisibility.coverageByTactic && (
          <Card className="border border-slate-200 shadow-none print:break-inside-avoid">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-display font-semibold text-slate-900">
                <Target className="h-4 w-4 text-sky-500" />
                Coverage by ATT&amp;CK tactic
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Where the detection library is strong vs. where investment is needed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reportData.coverageByTactic.length === 0 ? (
                <p className="text-sm text-slate-600">No technique data available.</p>
              ) : (
                <div className="space-y-2">
                  {reportData.coverageByTactic.map((row) => {
                    const tone =
                      row.percent >= 75
                        ? "bg-emerald-500"
                        : row.percent >= 40
                          ? "bg-amber-500"
                          : "bg-red-500";
                    return (
                      <div
                        key={row.key}
                        className="grid grid-cols-[160px_1fr_96px] items-center gap-3 print:gap-2"
                      >
                        <span className="truncate text-xs font-medium text-slate-700 print:text-[10px]">
                          {row.label}
                        </span>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn("h-full rounded-full transition-all", tone)}
                            style={{ width: `${row.percent}%` }}
                          />
                        </div>
                        <span className="text-right font-mono text-xs text-slate-600 print:text-[10px]">
                          {row.covered}/{row.total} · {row.percent.toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {sectionVisibility.actionItems && (
          <Card className="border border-slate-200 shadow-none print:break-inside-avoid">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-display font-semibold text-slate-900">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                Action items
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Detections that need tuning and telemetry gaps that need an owner.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {reportData.actionItems.length === 0 ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                  No outstanding action items in scope. Detection library is currently trusted.
                </div>
              ) : (
                reportData.actionItems.map((det) => {
                  const isFail = det.last_result === "FAIL";
                  return (
                    <div
                      key={det.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-900">{det.title}</p>
                        <p className="text-xs text-slate-500">
                          {det.technique_id || "—"} · last tested{" "}
                          {det.last_tested_at ? format(new Date(det.last_tested_at), "MMM dd") : "—"}
                        </p>
                      </div>
                      <Badge
                        className={cn(
                          "text-[10px] uppercase",
                          isFail
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-amber-200 bg-amber-50 text-amber-700"
                        )}
                      >
                        {isFail ? "Needs tuning" : "Telemetry gap"}
                      </Badge>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        )}

        {sectionVisibility.detectionHealth && (
          <Card className="border border-slate-200 shadow-none print:break-inside-avoid">
            <CardHeader>
              <CardTitle className="text-base font-display font-semibold text-slate-900">
                Trust state
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Distribution across the detection library using the PurveX trust language.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-4 print:gap-2">
              {[
                { label: "Trusted", value: reportData.detectionStatusCounts.healthy, color: "text-emerald-600" },
                { label: "Needs tuning", value: reportData.detectionStatusCounts.failed, color: "text-red-600" },
                { label: "Telemetry gap", value: reportData.detectionStatusCounts.telemetryGap, color: "text-amber-600" },
                { label: "Untested", value: reportData.detectionStatusCounts.pending, color: "text-slate-600" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4 print:p-3"
                >
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className={cn("mt-1 text-3xl font-display font-bold print:text-xl", item.color)}>
                    {item.value}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {sectionVisibility.activityTrend && (
          <Card className="border border-slate-200 shadow-none print:break-inside-avoid">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-display font-semibold text-slate-900">
                <Activity className="h-4 w-4 text-sky-500" />
                Test activity trend
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Daily validation volume across the reporting window.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reportData.totalTests === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No tests captured in this window.
                </div>
              ) : (
                <div>
                  <div className="flex h-32 items-end gap-1 print:h-20">
                    {reportData.dayBuckets.map((bucket, i) => {
                      const total = bucket.pass + bucket.fail + bucket.inc;
                      const heightPct = total > 0 ? Math.max(2, (total / reportData.dayMax) * 100) : 0;
                      return (
                        <div
                          key={i}
                          className="flex flex-1 flex-col-reverse overflow-hidden rounded-sm"
                          title={`${format(bucket.date, "MMM dd")}: ${total} tests`}
                          style={{ height: `${heightPct}%` }}
                        >
                          {bucket.pass > 0 && (
                            <div className="bg-emerald-500" style={{ flex: bucket.pass }} />
                          )}
                          {bucket.fail > 0 && (
                            <div className="bg-red-500" style={{ flex: bucket.fail }} />
                          )}
                          {bucket.inc > 0 && (
                            <div className="bg-amber-500" style={{ flex: bucket.inc }} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
                    <span>{format(reportData.dayBuckets[0].date, "MMM dd")}</span>
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm bg-emerald-500" /> Pass {reportData.passCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm bg-red-500" /> Fail {reportData.failCount}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="h-2 w-2 rounded-sm bg-amber-500" /> Inconclusive {reportData.inconclusiveCount}
                      </span>
                    </div>
                    <span>
                      {format(
                        reportData.dayBuckets[reportData.dayBuckets.length - 1].date,
                        "MMM dd"
                      )}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="border-t border-slate-200 pt-6 text-center text-xs uppercase tracking-[0.3em] text-slate-400">
          PurveX LLC · {format(new Date(), "yyyy")}
        </div>
      </div>
    </PageContainer>
  );
}

function KpiTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  tone: "sky" | "emerald" | "red" | "amber";
}) {
  const toneMap = {
    sky: "text-sky-600",
    emerald: "text-emerald-600",
    red: "text-red-600",
    amber: "text-amber-600",
  } as const;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 print:p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </div>
      <p className={cn("mt-2 text-4xl font-display font-bold print:text-2xl", toneMap[tone])}>
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}
