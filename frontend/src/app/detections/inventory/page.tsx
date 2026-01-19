"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDetections, Detection } from "@/lib/api";
import { formatRelative } from "date-fns";
import { ArrowLeft, Activity, CheckCircle2, AlertTriangle, HelpCircle, XCircle, Clock, User, X, Eye, Play, Cpu, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";

type HealthStateKey = "HEALTHY" | "DETECTION_FAILED" | "TELEMETRY_MISSING" | "UNKNOWN";

function deriveHealthState(d: Detection): HealthStateKey {
  // Never tested → Unknown
  if (!d.last_tested_at) {
    return "UNKNOWN";
  }

  const result = (d.last_result || "").toUpperCase();

  // These map directly from the scoring logic in the backend:
  // - PASS  → logs present + detection fired      → Healthy
  // - FAIL  → logs present, detection not fired   → Detection Failed
  // - INCONCLUSIVE (no logs)                      → Telemetry Missing
  switch (result) {
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

function getHealthBadgeClass(state: HealthStateKey) {
  switch (state) {
    case "HEALTHY":
      return "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40";
    case "DETECTION_FAILED":
      return "bg-red-500/15 text-red-300 border border-red-500/40";
    case "TELEMETRY_MISSING":
      return "bg-amber-500/15 text-amber-300 border border-amber-500/40";
    case "UNKNOWN":
    default:
      return "bg-slate-700/40 text-slate-300 border border-slate-600/60";
  }
}

function getHealthLabel(state: HealthStateKey) {
  switch (state) {
    case "HEALTHY":
      return "Healthy";
    case "DETECTION_FAILED":
      return "Detection Failed";
    case "TELEMETRY_MISSING":
      return "Telemetry Missing";
    case "UNKNOWN":
    default:
      return "Unknown";
  }
}

function getHealthNarrative(state: HealthStateKey) {
  switch (state) {
    case "HEALTHY":
      return {
        headline: "Logs present and detection fired.",
        detail:
          "The atomic test reached your environment, telemetry landed in the SIEM, and the detection logic triggered on that signal. Both the pipeline and the rule are behaving as designed.",
        action:
          "No immediate tuning required. Keep this rule under normal lifecycle review and watch for drift over time.",
      };
    case "DETECTION_FAILED":
      return {
        headline: "Telemetry arrived, but the detection did not fire.",
        detail:
          "The atomic test reached the SIEM and logs containing the PurveX marker are present, but the rule never triggered. This usually points to field mismatches, over‑aggressive filtering, normalization gaps, or thresholds set too high.",
        action:
          "Open the relevant index/sourcetype, inspect events with the PurveX marker, and align your SPL/KQL fields, filters, and thresholds to those events. Re‑run a validation after tuning the detection.",
      };
    case "TELEMETRY_MISSING":
      return {
        headline: "Atomic test ran but no telemetry was observed.",
        detail:
          "Within the validation window, PurveX did not see any events containing the marker in the SIEM. This typically indicates an agent or collector problem, incorrect index/sourcetype routing, or that the test did not execute on a host that is sending telemetry.",
        action:
          "Confirm the atomic test executed on the expected host, then verify the endpoint agent, forwarder, and index/sourcetype configuration. Fix the telemetry path first, then re‑run the test.",
      };
    case "UNKNOWN":
    default:
      return {
        headline: "This detection has never been validated in PurveX.",
        detail:
          "No PurveX atomic tests have been run against this detection yet, so we cannot tell whether issues would come from the telemetry path or from the detection logic.",
        action:
          "Run a lab validation before treating this rule as trusted coverage or promoting it further in the lifecycle.",
      };
  }
}

export default function DetectionInventoryPage() {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  // Set client-side date to avoid hydration mismatches
  useEffect(() => {
    setNow(new Date());
  }, []);

  // Auto-open sidebar when detection is selected
  useEffect(() => {
    if (selectedDetection) {
      setSidebarOpen(true);
    }
  }, [selectedDetection]);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await getDetections();
        setDetections(data);
      } catch (err: any) {
        setError(err.message || "Failed to load detection inventory.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const testedDetectionsCount = detections.filter((d) => d.last_tested_at).length;

  // Map detections into the 4-state PurveX health model.
  const healthBuckets = detections.reduce(
    (acc, det) => {
      const state = deriveHealthState(det);
      acc[state] += 1;
      return acc;
    },
    {
      HEALTHY: 0,
      DETECTION_FAILED: 0,
      TELEMETRY_MISSING: 0,
      UNKNOWN: 0,
    } as Record<HealthStateKey, number>
  );

  // Derive an overall health score for the inventory based on the last
  // score / result for each detection. This is a simple frontend‑only
  // heuristic for the MVP so we can show a single health number.
  const effectiveScores: number[] = detections
    .map((d) => {
      if (typeof d.last_score === "number") return d.last_score;
      switch ((d.last_result || "").toUpperCase()) {
        case "PASS":
          return 90;
        case "FAIL":
          return 30;
        case "INCONCLUSIVE":
          // Represents cases where logs were missing or incomplete.
          return 10;
        default:
          // Never tested – treat as unknown / low confidence.
          return 0;
      }
    })
    // Keep all scores so untested detections still influence the average.
    .filter((s) => typeof s === "number");

  const overallHealthScore =
    effectiveScores.length > 0
      ? Math.round(
          effectiveScores.reduce((sum, v) => sum + v, 0) / effectiveScores.length
        )
      : null;

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-slate-400 text-sm">Loading detection inventory…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive text-sm">
          Error loading detection inventory: {error}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">
      <div className="w-full pl-0.5 pr-0 sm:pr-0">
        <PageHeader
          title="Detection inventory"
          subtitle="Detection metadata, lifecycle stages, recent events, and when detections were last updated."
          actions={
            overallHealthScore !== null ? (
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 mb-1">Overall inventory health</div>
                </div>
                {/* Circular Progress Indicator */}
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg className="transform -rotate-90 w-20 h-20">
                    <circle
                      cx="40"
                      cy="40"
                      r="36"
                      stroke="currentColor"
                      strokeWidth="6"
                      fill="none"
                      className="text-slate-200"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r="36"
                      stroke="currentColor"
                      strokeWidth="6"
                      fill="none"
                      strokeDasharray={`${(overallHealthScore / 100) * 226} 226`}
                      className={cn(
                        "transition-all duration-500",
                        overallHealthScore >= 80 ? "text-emerald-500" :
                        overallHealthScore >= 60 ? "text-amber-500" :
                        "text-red-500"
                      )}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className={cn(
                        "text-xl font-display font-bold",
                        overallHealthScore >= 80 ? "text-emerald-600" :
                        overallHealthScore >= 60 ? "text-amber-600" :
                        "text-red-600"
                      )}>
                        {overallHealthScore}%
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null
          }
        />
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-emerald-700">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Healthy
            </span>
            <span className="text-sm font-semibold">{healthBuckets.HEALTHY}</span>
          </div>
          <p className="text-[11px] text-emerald-700/90">
            Logs present and detection fired.
          </p>
        </div>

        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-red-700">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <XCircle className="h-3.5 w-3.5" />
              Detection Failed
            </span>
            <span className="text-sm font-semibold">{healthBuckets.DETECTION_FAILED}</span>
          </div>
          <p className="text-[11px] text-red-700/90">
            Telemetry is there, but the detection did not fire.
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-amber-700">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Telemetry Missing
            </span>
            <span className="text-sm font-semibold">{healthBuckets.TELEMETRY_MISSING}</span>
          </div>
          <p className="text-[11px] text-amber-700/90">
            Atomic test ran, but no logs returned to the SIEM.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-slate-700">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <HelpCircle className="h-3.5 w-3.5" />
              Unknown
            </span>
            <span className="text-sm font-semibold">{healthBuckets.UNKNOWN}</span>
          </div>
          <p className="text-[11px] text-slate-700/90">
            Detection has never been tested in PurveX.
          </p>
        </div>
      </div>

      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-200">
                <Activity className="h-4 w-4" />
              </span>
              <span>Detections</span>
            </CardTitle>
            <CardDescription className="mt-1 text-slate-600">
              Detection definitions, lifecycle phases, event activity, and modification history.
            </CardDescription>
          </div>
          <div className="text-right text-xs text-slate-600">
            <div>
              <span className="font-semibold text-slate-900">{detections.length}</span> detections onboarded ·{" "}
              <span className="font-semibold text-emerald-700">{testedDetectionsCount}</span> validated at least once
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {detections.length === 0 ? (
            <p className="text-sm text-slate-600">
              No detections have been onboarded yet. Use the Detection workspace to create or sync detections from your SIEM.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200">
                    <TableHead className="text-[11px] text-slate-500 uppercase tracking-wide">Detection</TableHead>
                    <TableHead className="text-[11px] text-slate-500 uppercase tracking-wide">Lifecycle Stage</TableHead>
                    <TableHead className="text-[11px] text-slate-500 uppercase tracking-wide">Last Updated</TableHead>
                    <TableHead className="text-[11px] text-slate-500 uppercase tracking-wide">Created</TableHead>
                    <TableHead className="text-[11px] text-slate-500 uppercase tracking-wide">Last Event</TableHead>
                    <TableHead className="text-[11px] text-slate-500 uppercase tracking-wide">Owner</TableHead>
                    <TableHead className="text-[11px] text-slate-500 uppercase tracking-wide w-[140px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detections.map((d) => {
                    const lifecycleStage = d.status || d.lifecycle_stage || "DRAFT";
                    const getLifecycleBadgeClass = (stage: string) => {
                      const normalized = (stage || "DRAFT").toUpperCase();
                      if (normalized === "ACTIVE") return "bg-emerald-50 text-emerald-700 border border-emerald-200";
                      if (normalized === "DRAFT") return "bg-sky-50 text-sky-700 border border-sky-200";
                      if (normalized === "NEEDS_IMPROVEMENT") return "bg-amber-50 text-amber-700 border border-amber-200";
                      if (normalized === "RETIRED") return "bg-slate-100 text-slate-700 border border-slate-200";
                      return "bg-slate-100 text-slate-700 border border-slate-200";
                    };
                    return (
                      <TableRow
                        key={d.id}
                        className="border-slate-100"
                      >
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="font-medium text-slate-900 text-sm">{d.title}</span>
                            <div className="flex items-center gap-2 text-xs text-slate-600">
                              <span className="font-mono">{d.technique_id}</span>
                              <span>·</span>
                              <span className="uppercase text-slate-600">{d.siem_type}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={getLifecycleBadgeClass(lifecycleStage)}>
                            {lifecycleStage || "DRAFT"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-700 text-xs">
                          {d.last_updated_at ? formatRelative(new Date(d.last_updated_at), new Date()) : "—"}
                        </TableCell>
                        <TableCell className="text-slate-700 text-xs">
                          {d.created_at ? formatRelative(new Date(d.created_at), new Date()) : "—"}
                        </TableCell>
                        <TableCell className="text-slate-700 text-xs">
                          {d.last_alert_at ? (
                            <div className="flex items-center gap-1.5 text-slate-700">
                              <Clock className="h-3 w-3 text-amber-600" />
                                <span>{formatRelative(new Date(d.last_alert_at), new Date())}</span>
                              </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-slate-700 text-xs">
                          {d.owner ? (
                            <div className="flex items-center gap-1.5">
                              <User className="h-3 w-3 text-slate-500" />
                              <span>{d.owner}</span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <Link href={`/detections/${d.id}/events`} onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-full px-3 text-[11px] border-slate-200 text-slate-700 hover:bg-slate-100"
                              >
                                Events
                              </Button>
                            </Link>
                            <Link href={`/detections/${d.id}`} onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 w-full px-3 text-[11px] border-slate-200 text-slate-700 hover:bg-slate-100"
                              >
                                Details
                              </Button>
                            </Link>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Backdrop overlay when panel is open */}
      {selectedDetection && sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity duration-300"
          onClick={() => {
            setSelectedDetection(null);
            setSidebarOpen(false);
          }}
        />
      )}

      {/* Right Panel - Detail View - Slide in from the right side */}
      <div className={cn(
        "fixed right-0 top-0 bottom-0 border-l border-slate-200 bg-white shadow-2xl overflow-hidden z-50",
        selectedDetection && sidebarOpen
          ? "w-[420px] opacity-100 visible flex flex-col min-h-0" 
          : "w-0 opacity-0 invisible pointer-events-none border-0"
      )}
      style={{
        transform: selectedDetection && sidebarOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1), width 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 200ms ease-in-out',
      }}>
        {selectedDetection && sidebarOpen && (
          <div className="flex-1 overflow-y-auto overflow-x-hidden hide-scrollbar p-4 sm:p-5 lg:p-6 relative z-10 min-h-0">
            {(() => {
              const healthState = deriveHealthState(selectedDetection);
              const narrative = getHealthNarrative(healthState);
              const HealthIcon = healthState === "HEALTHY" ? CheckCircle2 : healthState === "DETECTION_FAILED" ? XCircle : healthState === "TELEMETRY_MISSING" ? AlertTriangle : Clock;
              
              return (
                <div className="space-y-6">
                  {/* Close Button */}
                  <div className="flex justify-end mb-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedDetection(null);
                        setSidebarOpen(false);
                      }}
                      className="h-8 w-8 p-0 hover:bg-slate-100 rounded-lg border border-slate-200"
                      title="Close"
                    >
                      <X className="h-4 w-4 text-slate-600" />
                    </Button>
                  </div>

                  {/* Header Section */}
                  <div className="pb-5 border-b border-slate-200">
                    <div className="flex items-start gap-4 mb-4">
                      <div className={cn(
                        "h-12 w-12 rounded-xl flex items-center justify-center shadow-lg transition-all",
                        getHealthBadgeClass(healthState)
                      )}>
                        <HealthIcon className="h-6 w-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-display font-bold text-slate-900 mb-2 leading-tight">
                          {selectedDetection.title}
                        </h3>
                        <div className="flex items-center gap-2.5 text-xs text-slate-600">
                          <span className="font-mono bg-slate-100 px-2 py-1 rounded border border-slate-200 text-slate-700">{selectedDetection.technique_id}</span>
                          <span className="text-slate-400">·</span>
                          <span className="uppercase bg-slate-100 px-2 py-1 rounded border border-slate-200 text-slate-700">{selectedDetection.siem_type}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors shadow-sm">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 font-semibold">Last Test</div>
                      <div className="text-base font-bold text-slate-900">
                        {selectedDetection.last_tested_at
                          ? formatRelative(new Date(selectedDetection.last_tested_at), now || new Date())
                          : "Never"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300 transition-colors shadow-sm">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 font-semibold">Score</div>
                      <div className="text-base font-bold text-slate-900">
                        {selectedDetection.last_score ?? "N/A"}
                      </div>
                    </div>
                  </div>

                  {/* Health Narrative */}
                  <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5 shadow-sm">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 flex items-center gap-2">
                        <Zap className="h-3 w-3" />
                        What This Means
                      </div>
                      <p className="text-sm font-semibold text-slate-900 mb-2">{narrative.headline}</p>
                      <p className="text-xs text-slate-600 leading-relaxed">{narrative.detail}</p>
                    </div>
                    <div className="pt-3 border-t border-slate-200">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Recommended Action</div>
                      <p className="text-xs text-slate-700 leading-relaxed">{narrative.action}</p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-3 pt-2">
                    <Link href={`/detections/${selectedDetection.id}`}>
                      <Button variant="outline" className="w-full border-slate-200 text-slate-700 hover:bg-slate-50">
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                    </Button>
                  </Link>
                  <Link href={`/run-test?detectionId=${selectedDetection.id}`}>
                      <Button variant="outline" className="w-full border-slate-200 text-slate-700 hover:bg-slate-50">
                        <Play className="h-4 w-4 mr-2" />
                        Re-run Validation
                      </Button>
                    </Link>
                    <Button
                      variant="outline"
                      className="w-full border-slate-200 text-slate-700 hover:bg-slate-50"
                      onClick={() => {
                        if (typeof window !== "undefined") {
                          window.location.href = `/agent?detectionId=${selectedDetection.id}`;
                        }
                      }}
                    >
                      <Cpu className="h-4 w-4 mr-2" />
                      AI Insights
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
