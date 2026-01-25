"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import { format, subMonths } from "date-fns";
import {
  getDetections,
  getDetectionScoringSettings,
  getMitreTechniques,
  getOrganizationSettings,
  getTests,
  MitreTechnique,
} from "@/lib/api";
import {
  Calendar,
  Download,
  FileText,
  ShieldCheck,
  Target,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

const DEFAULT_ENVIRONMENTS = ["lab", "dev", "prod"] as const;

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

export default function ReportsPage() {
  const reportRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [detections, setDetections] = useState<ReportDetection[]>([]);
  const [tests, setTests] = useState<ReportTest[]>([]);
  const [techniques, setTechniques] = useState<MitreTechnique[]>([]);
  const [orgName, setOrgName] = useState("PurveX");
  const [scoringThresholds, setScoringThresholds] = useState({
    healthy: 80,
    atRisk: 50,
  });

  const [startDate, setStartDate] = useState<string>(() => {
    const date = subMonths(new Date(), 1);
    return format(date, "yyyy-MM-dd");
  });
  const [endDate, setEndDate] = useState<string>(() => format(new Date(), "yyyy-MM-dd"));
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>([...DEFAULT_ENVIRONMENTS]);
  const [sectionVisibility, setSectionVisibility] = useState<Record<string, boolean>>({
    summary: true,
    coverage: true,
    detectionStatus: true,
    detections: true,
    testActivity: true,
    topGaps: true,
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

    const filteredTests = tests.filter((test) => {
      if (selectedEnvironments.length > 0 && test.environment && !envSet.has(test.environment)) {
        return false;
      }
      const ts = test.finished_at || test.started_at;
      if (!ts) return true;
      const dt = new Date(ts);
      return dt >= start && dt <= end;
    });

    const passCount = filteredTests.filter((t) => t.status === "PASS").length;
    const failCount = filteredTests.filter((t) => t.status === "FAIL").length;
    const inconclusiveCount = filteredTests.filter((t) => t.status === "INCONCLUSIVE").length;
    const totalTests = filteredTests.length;

    const coverageTechniqueIds = new Set(
      detections.map((d) => d.technique_id).filter((id) => Boolean(id))
    );
    const totalTechniques = techniques.length;
    const coveredTechniques = coverageTechniqueIds.size;
    const coveragePercent = totalTechniques > 0 ? (coveredTechniques / totalTechniques) * 100 : 0;

    const missingTechniques = techniques
      .filter((tech) => !coverageTechniqueIds.has(tech.id))
      .slice(0, 3);

    const score = totalTests > 0 ? Math.round((passCount / totalTests) * 100) : 0;

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

    const detectionRows = detections.slice(0, 8);
    const testActivity = filteredTests.slice(0, 8);

    return {
      totalTests,
      passCount,
      failCount,
      inconclusiveCount,
      coveragePercent,
      coveredTechniques,
      totalTechniques,
      missingTechniques,
      score,
      detectionStatusCounts,
      detectionRows,
      testActivity,
    };
  }, [detections, tests, techniques, startDate, endDate, selectedEnvironments]);

  return (
    <PageContainer maxWidth="full" className="space-y-6">
      <div className="print:hidden">
        <PageHeader
          eyebrow="Executive reporting"
          title="Detection Effectiveness Report"
          subtitle="Live, on-screen reporting with export-ready visuals."
          icon={<FileText className="h-5 w-5" />}
        />
      </div>

      <Card className="border border-slate-200 bg-white shadow-sm print:hidden">
        <CardHeader className="border-b border-slate-200">
          <CardTitle className="text-lg font-display font-semibold text-slate-900">Report controls</CardTitle>
          <CardDescription className="text-sm text-slate-600">
            Tune the time range and environments. Export the report as a clean image.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_auto] items-end">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="start-date" className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  Start date
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-11 border-slate-200 bg-white text-slate-900"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date" className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  End date
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-11 border-slate-200 bg-white text-slate-900"
                />
              </div>
            </div>

            <div className="space-y-2 min-w-[240px]">
              <Label className="text-sm font-semibold text-slate-900">Environments</Label>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_ENVIRONMENTS.map((env) => (
                  <button
                    key={env}
                    onClick={() => {
                      if (selectedEnvironments.includes(env)) {
                        setSelectedEnvironments(selectedEnvironments.filter((item) => item !== env));
                      } else {
                        setSelectedEnvironments([...selectedEnvironments, env]);
                      }
                    }}
                    className={cn(
                      "h-9 min-w-[72px] rounded-full px-4 text-xs font-semibold transition border whitespace-nowrap",
                      selectedEnvironments.includes(env)
                        ? "bg-white text-slate-900 border-slate-900 shadow-sm"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    {env.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-10 border-slate-200 text-slate-700 hover:bg-slate-50"
              onClick={() => window.print()}
              disabled={loading}
            >
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Sections</p>
            <div className="flex flex-wrap gap-2">
              {[
                { key: "summary", label: "Executive summary" },
                { key: "coverage", label: "MITRE coverage" },
                { key: "detectionStatus", label: "Detection status" },
                { key: "detections", label: "Detections list" },
                { key: "testActivity", label: "Test activity" },
                { key: "topGaps", label: "Top gaps" },
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() =>
                    setSectionVisibility((prev) => ({
                      ...prev,
                      [item.key]: !prev[item.key],
                    }))
                  }
                  className={cn(
                    "h-9 flex items-center gap-2 rounded-full border px-3 text-xs font-semibold transition whitespace-nowrap",
                    sectionVisibility[item.key]
                      ? "border-slate-900 bg-white text-slate-900 shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:text-slate-800"
                  )}
                >
                  <span>{item.label}</span>
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      sectionVisibility[item.key] ? "bg-slate-900" : "bg-emerald-500"
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        ref={reportRef}
        data-report-export="true"
        className="rounded-3xl border border-slate-200 bg-white shadow-[0_30px_80px_-60px_rgba(15,23,42,0.35)] p-10 md:p-12 space-y-10 print:border-none print:shadow-none print:p-0 print:text-[12px] print:leading-snug print:space-y-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500 print:text-[10px]">Detection effectiveness report</p>
            <h2 className="mt-2 text-4xl font-display font-bold text-slate-900 print:text-2xl print:mt-1">{orgName}</h2>
            <p className="mt-2 text-base text-slate-600 print:text-xs print:mt-1">
              {format(new Date(startDate), "MMM dd, yyyy")} – {format(new Date(endDate), "MMM dd, yyyy")}
            </p>
          </div>
          <div className="text-right space-y-1">
            <p className="text-xs text-slate-500 print:text-[10px]">Generated</p>
            <p className="text-base font-semibold text-slate-900 print:text-xs">{format(new Date(), "MMM dd, yyyy HH:mm")}</p>
            <div className="flex flex-wrap gap-2 justify-end">
              {selectedEnvironments.map((env) => (
                <Badge key={env} className="bg-slate-100 text-slate-700 border-slate-200 text-xs uppercase print:text-[9px] print:py-0">
                  {env}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {(sectionVisibility.summary || sectionVisibility.coverage) && (
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            {sectionVisibility.summary && (
              <Card className="border border-slate-200 shadow-none print:shadow-none print:border-slate-300 print:break-inside-avoid">
                <CardHeader>
                  <CardTitle className="text-base font-display font-semibold text-slate-900 flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-500" />
                    Executive summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 print:space-y-2">
                  <div className="flex items-baseline gap-3">
                    <p className="text-5xl font-display font-bold text-slate-900">
                      {loading ? "–" : reportData.score}
                    </p>
                    <Badge
                      className={cn(
                        "text-xs",
                        reportData.score >= scoringThresholds.healthy
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : reportData.score >= scoringThresholds.atRisk
                            ? "bg-amber-100 text-amber-700 border-amber-200"
                            : "bg-red-100 text-red-700 border-red-200"
                      )}
                    >
                      {reportData.score >= scoringThresholds.healthy
                        ? "Healthy"
                        : reportData.score >= scoringThresholds.atRisk
                          ? "At risk"
                          : "Critical"}
                    </Badge>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3 print:gap-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 print:p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Pass</p>
                      <p className="mt-2 text-3xl font-display font-bold text-emerald-600 print:text-xl">{reportData.passCount}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 print:p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Fail</p>
                      <p className="mt-2 text-3xl font-display font-bold text-red-600 print:text-xl">{reportData.failCount}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 print:p-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Inconclusive</p>
                      <p className="mt-2 text-3xl font-display font-bold text-amber-600 print:text-xl">{reportData.inconclusiveCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {sectionVisibility.coverage && (
              <Card className="border border-slate-200 shadow-none print:shadow-none print:border-slate-300 print:break-inside-avoid">
                <CardHeader>
                  <CardTitle className="text-base font-display font-semibold text-slate-900 flex items-center gap-2">
                    <Target className="h-4 w-4 text-sky-500" />
                    MITRE coverage snapshot
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 print:space-y-2">
                  <div className="flex items-baseline gap-3">
                    <p className="text-4xl font-display font-bold text-slate-900 print:text-2xl">
                      {reportData.coveragePercent.toFixed(1)}%
                    </p>
                    <span className="text-xs text-slate-500 print:text-[10px]">
                      {reportData.coveredTechniques}/{reportData.totalTechniques} techniques covered
                    </span>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500 print:text-[10px]">Top missing techniques</p>
                    <div className="mt-3 space-y-2 print:mt-2 print:space-y-1">
                      {reportData.missingTechniques.length === 0 ? (
                        <p className="text-sm text-slate-600 print:text-xs">No missing techniques identified yet.</p>
                      ) : (
                        reportData.missingTechniques.map((tech) => (
                          <div
                            key={tech.id}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                          >
                            <span className="font-semibold text-slate-900">{tech.id}</span>
                            <span className="text-slate-600 truncate">{tech.name}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {sectionVisibility.detectionStatus && (
          <Card className="border border-slate-200 shadow-none print:break-inside-avoid">
            <CardHeader>
              <CardTitle className="text-base font-display font-semibold text-slate-900">Detection status</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-4 print:gap-2">
              {[
                { label: "Healthy", value: reportData.detectionStatusCounts.healthy, color: "text-emerald-600" },
                { label: "Failed", value: reportData.detectionStatusCounts.failed, color: "text-red-600" },
                { label: "Telemetry gap", value: reportData.detectionStatusCounts.telemetryGap, color: "text-amber-600" },
                { label: "Pending", value: reportData.detectionStatusCounts.pending, color: "text-slate-600" },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 print:p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
                  <p className={cn("mt-2 text-3xl font-display font-bold print:text-xl", item.color)}>{item.value}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {sectionVisibility.detections && (
          <Card className="border border-slate-200 shadow-none print:break-inside-avoid">
            <CardHeader>
              <CardTitle className="text-base font-display font-semibold text-slate-900">Detections</CardTitle>
              <CardDescription className="text-sm text-slate-600">Latest detections in scope.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {reportData.detectionRows.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No detections found for this workspace.
                </div>
              ) : (
                reportData.detectionRows.map((det) => (
                  <div key={det.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{det.title}</span>
                      <span className="text-xs text-slate-500">{det.technique_id || "—"}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Last tested: {det.last_tested_at ? format(new Date(det.last_tested_at), "MMM dd, yyyy") : "—"}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {sectionVisibility.testActivity && (
          <Card className="border border-slate-200 shadow-none print:break-inside-avoid">
            <CardHeader>
              <CardTitle className="text-base font-display font-semibold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Test activity
              </CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Recent tests captured in this reporting window.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reportData.testActivity.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No tests found for this range.
                </div>
              ) : (
                <div className="space-y-2">
                  {reportData.testActivity.map((test) => (
                    <div key={test.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[1.2fr_1fr_auto]">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {test.detection_title || test.technique_id || `Test #${test.id}`}
                        </p>
                        <p className="text-xs text-slate-500">Technique: {test.technique_id || "Not set"}</p>
                      </div>
                      <div className="text-sm text-slate-700">{test.status || "—"}</div>
                      <div className="text-right text-xs">
                        <Link href={test.id ? `/tests/${test.id}` : "#"} className="text-sky-700 hover:text-sky-800">
                          View details
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {sectionVisibility.topGaps && (
          <div className="grid gap-6 xl:grid-cols-2 print:gap-4">
            {sectionVisibility.topGaps && (
              <Card className="border border-slate-200 shadow-none print:break-inside-avoid">
                <CardHeader>
                  <CardTitle className="text-base font-display font-semibold text-slate-900">Top gaps</CardTitle>
                  <CardDescription className="text-sm text-slate-600">Where coverage is most likely missing.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {reportData.missingTechniques.length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      Coverage gaps will appear here once technique coverage is mapped.
                    </div>
                  ) : (
                    reportData.missingTechniques.map((tech) => (
                      <div key={tech.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                        <span className="font-semibold text-slate-900">{tech.id}</span>
                        <span className="text-slate-600"> · {tech.name}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <div className="border-t border-slate-200 pt-6 text-xs text-slate-400 text-center tracking-[0.3em] uppercase">
          PurveX LLC · 2025
        </div>
      </div>
    </PageContainer>
  );
}
