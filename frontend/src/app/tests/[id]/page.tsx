"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  TestDetailResponse,
  TestArtifact,
  Detection,
  getTest,
  getDetectionAlerts,
  type DetectionAlert,
} from "@/lib/api";
import { format } from "date-fns";
import {
  ArrowLeft,
  Activity,
  Target,
  TerminalSquare,
  FileJson,
  Brain,
  AlertTriangle,
  Clock,
  ShieldCheck,
} from "lucide-react";

function formatDate(value?: string) {
  if (!value) return "N/A";
  try {
    return format(new Date(value), "yyyy-MM-dd HH:mm:ss 'UTC'");
  } catch {
    return value;
  }
}

function getResultBadgeClass(result?: string) {
  switch (result) {
    case "PASS":
      return "bg-emerald-100 text-emerald-700 border border-emerald-200";
    case "FAIL":
      return "bg-red-100 text-red-700 border border-red-200";
    case "INCONCLUSIVE":
      return "bg-orange-100 text-orange-700 border border-orange-200";
    case "PENDING":
      return "bg-blue-100 text-blue-700 border border-blue-200";
    case "RUNNING":
      return "bg-yellow-100 text-yellow-700 border border-yellow-200";
    case "ERROR":
      return "bg-red-100 text-red-700 border border-red-200";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-200";
  }
}

function getSeverityBadgeClass(severity?: string) {
  switch ((severity || "").toLowerCase()) {
    case "critical":
    case "high":
      return "bg-red-500/15 text-red-300 border border-red-500/40";
    case "medium":
      return "bg-orange-500/15 text-orange-300 border border-orange-500/40";
    case "low":
      return "bg-sky-500/15 text-sky-300 border border-sky-500/40";
    default:
      return "bg-slate-700/40 text-slate-200 border border-slate-600/60";
  }
}

function parseSampleEvents(artifact?: TestArtifact): unknown[] {
  if (!artifact?.siem_sample_events) return [];
  try {
    const parsed = JSON.parse(artifact.siem_sample_events);
    if (Array.isArray(parsed)) return parsed;
    return [parsed];
  } catch {
    return [];
  }
}

function getTargetHostFromCommand(command?: string | null): string | null {
  if (!command) return null;
  const match = command.match(/-ComputerName\s+([^\s"]+|"[^"]+")/i);
  if (!match) return null;
  return match[1].replace(/^"|"$/g, "");
}

export default function TestDetailPage() {
  const params = useParams();
  const testId = Number((params as { id?: string }).id);

  const [data, setData] = useState<TestDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSigma, setShowSigma] = useState(false);
  const [testEvents, setTestEvents] = useState<DetectionAlert[]>([]);

  useEffect(() => {
    if (!testId || Number.isNaN(testId)) return;

    async function loadDetail() {
      try {
        setLoading(true);
        const result = await getTest(testId);
        // getTest now returns null for 404s instead of throwing
        if (result) {
          setData(result);
          if (result.detection?.id) {
            const detectionEvents = await getDetectionAlerts(result.detection.id).catch(() => []);
            const matching = detectionEvents.filter((event) => event.test_id === result.id);
            setTestEvents(matching);
          } else {
            setTestEvents([]);
          }
        } else {
          // Test not found - handle gracefully
          setError("Test not found");
        }
      } catch (err: any) {
        // Only catch non-404 errors (network errors, auth errors, etc.)
        // 404s are now handled by getTest returning null, so this catch should rarely trigger
        setError(err.message || "Failed to load test details.");
      } finally {
        setLoading(false);
      }
    }

    loadDetail();
  }, [testId]);

  if (!testId || Number.isNaN(testId)) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive text-sm">Invalid test id.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-slate-400 text-sm">Loading test details...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Error loading test details: {error || "No data returned."}
        </div>
      </div>
    );
  }

  const { detection, artifact } = data as { detection?: Detection | null; artifact?: TestArtifact };
  const sampleEvents = parseSampleEvents(artifact);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Test #{data.id}</h1>
            <p className="text-xs text-slate-600">
              {detection?.title || "No Detection"} | {data.technique_id || "Unknown"} | {data.environment.toUpperCase()}
            </p>
        </div>
        <Badge className={getResultBadgeClass(data.result || data.status)}>
          {data.result || data.status}
        </Badge>
      </div>

      {/* Section A - Test Summary */}
      <Card className="elite-card ">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                <Activity className="h-4 w-4" />
              </span>
              <span>Test Summary</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Result, score, technique, marker, and when this validation ran.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4 text-sm text-slate-200">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Result</div>
              <div className="mt-1 flex items-center gap-2">
                <Badge className={getResultBadgeClass(data.result || data.status)}>
                  {data.result || data.status}
                </Badge>
                {typeof data.score === "number" && (
                  <span className="text-xs text-slate-300">
                    Score <span className="font-semibold">{data.score}</span>/100
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Technique</div>
              <div className="mt-1 flex items-center gap-1">
                <Target className="h-3 w-3 text-slate-400" />
                <span>{data.technique_id || "Unknown"}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Marker</div>
              <div className="mt-1 font-mono text-xs break-all text-slate-200">{data.marker}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Environment</div>
              <div className="mt-1 text-slate-200">{data.environment.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Endpoint</div>
              <div className="mt-1 text-slate-200">
                {data.endpoint || getTargetHostFromCommand(artifact?.atomic_command) || "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Started</div>
              <div className="mt-1 flex items-center gap-1 text-slate-200">
                <Clock className="h-3 w-3 text-slate-400" />
                <span>{formatDate(data.started_at)}</span>
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Finished</div>
              <div className="mt-1 flex items-center gap-1 text-slate-200">
                <Clock className="h-3 w-3 text-slate-400" />
                <span>{formatDate(data.finished_at)}</span>
              </div>
            </div>
            {detection && (
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">
                  Last Alert Fired (PurveX)
                </div>
                <div className="mt-1 flex items-center gap-1 text-slate-200">
                  <ShieldCheck className="h-3 w-3 text-slate-400" />
                  <span>{formatDate(detection.last_alert_at as unknown as string)}</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Test events */}
      <Card className="elite-card ">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300 border border-sky-500/40">
                <Activity className="h-4 w-4" />
              </span>
              <span>Test events</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Events generated by this test run.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {testEvents.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              No events were captured for this test run.
            </div>
          ) : (
            <div className="space-y-4">
              {testEvents.map((event) => (
                <div key={event.id} className="flex gap-3">
                  <div className="mt-2 h-2 w-2 rounded-full bg-sky-400" />
                  <div className="flex-1 rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge className={getSeverityBadgeClass(event.severity)}>
                        {event.severity || "medium"}
                      </Badge>
                      <span className="text-slate-400">
                        {new Date(event.time || event.created_at || new Date()).toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-slate-100">
                      {event.name || event.message || "Event"}
                    </div>
                    {event.host && (
                      <div className="mt-1 text-xs text-slate-400">
                        Host: {event.host}
                      </div>
                    )}
                    {detection?.id && (
                      <Link
                        href={`/detections/${detection.id}/events/${event.id}`}
                        className="mt-3 inline-flex text-xs text-sky-300 hover:text-sky-200"
                      >
                        View event details
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section B - Detection Info */}
      {detection ? (
        <Card className="elite-card ">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 border border-blue-500/40">
                  <Target className="h-4 w-4" />
                </span>
                <span>Detection Info</span>
              </CardTitle>
              <CardDescription className="mt-1">
                The rule, query, and lifecycle metadata for this detection.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">
                  Detection Owner
                </div>
                <div className="mt-1 text-slate-200">{detection.owner || "Unassigned"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">
                  Lifecycle Status
                </div>
                <div className="mt-1">
                  <Badge className="bg-slate-700/40 text-slate-100 border border-slate-500/60">
                    {detection.status || "DRAFT"}
                  </Badge>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">
                  SIEM Type
                </div>
                <div className="mt-1 text-slate-200 uppercase">{detection.siem_type || "Unknown"}</div>
              </div>
            </div>

            <Separator className="my-2 border-slate-800" />

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-slate-400" />
                  <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    SPL Query
                  </span>
                </div>
              </div>
              <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-slate-950/70 p-3 text-xs text-slate-100 border border-slate-800">
{detection.siem_query || "No query available"}
              </pre>
            </div>

            {detection.sigma_rule && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileJson className="h-4 w-4 text-slate-400" />
                    <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                      Sigma Rule (YAML)
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-slate-300 hover:text-white"
                    onClick={() => setShowSigma(v => !v)}
                  >
                    {showSigma ? "Hide" : "Show"}
                  </Button>
                </div>
                {showSigma && (
                  <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-slate-950/70 p-3 text-xs text-slate-100 border border-slate-800">
{detection.sigma_rule}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="elite-card ">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300 border border-sky-500/40">
                <Target className="h-4 w-4" />
              </span>
              <span>Detection Info</span>
            </CardTitle>
            <CardDescription className="mt-1">
              No detection associated with this test.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* Section C - Logs & Evidence */}
      <Card className="elite-card ">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 border border-blue-500/40">
                <TerminalSquare className="h-4 w-4" />
              </span>
              <span>Logs &amp; Evidence</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Sample SIEM events and the atomic command that was executed.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-1">
              Atomic Command
            </div>
            <pre className="max-h-32 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 border border-slate-200">
{artifact?.atomic_command || "Not recorded (pipeline stubbed or not yet run)."}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <FileJson className="h-4 w-4 text-slate-400" />
                <span className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  Sample SIEM Events
                </span>
              </div>
              <span className="text-[10px] text-slate-500">
                Showing up to 3 events for evidence; full logs stay in your SIEM.
              </span>
            </div>
            {sampleEvents.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                No sample events were captured for this test run.
              </div>
            ) : (
              <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 border border-slate-200">
{JSON.stringify(sampleEvents, null, 2)}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Section D - AI Analysis */}
      <Card className="elite-card ">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                <Brain className="h-4 w-4" />
              </span>
              <span>AI Analysis (PurveX-AI)</span>
            </CardTitle>
            <CardDescription className="mt-1">
              Summary, context, and tuning suggestions generated by Llama 3.1.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!artifact?.ai_explanation && !artifact?.ai_suggested_rule ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>
                AI analysis is not yet available for this run. Ensure the local Ollama service is
                running with the Llama 3.1 model and re-run the test.
              </span>
            </div>
          ) : (
            <>
              <div>
                <div className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-1">
                  AI Summary
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                  {artifact?.ai_explanation}
                </div>
              </div>

              <Separator className="border-slate-200" />

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-1">
                    Query / Rule Suggestion
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 border border-slate-200">
{artifact?.ai_suggested_rule || "No explicit rule suggestion was generated."}
                  </pre>
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-1">
                      Root Cause Category
                    </div>
                    <div className="flex items-center gap-2 text-slate-700">
                      <Badge className="bg-slate-100 text-slate-700 border border-slate-200">
                        {artifact?.ai_root_cause_category || "OTHER"}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 uppercase tracking-[0.2em] mb-1">
                      AI Confidence
                    </div>
                    <div className="text-slate-700">
                      {typeof artifact?.ai_confidence_score === "number"
                        ? `${artifact.ai_confidence_score}/100`
                        : "N/A"}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section E - Detection Lifecycle Snapshot */}
      {detection && (
        <Card className="elite-card ">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-500/15 text-slate-200 border border-slate-500/40">
                <Clock className="h-4 w-4" />
              </span>
              <span>Detection Lifecycle Summary</span>
            </CardTitle>
            <CardDescription className="mt-1">
              When this rule was created, last tested, and how it has behaved over time.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3 text-sm text-slate-200">
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Created</div>
              <div className="mt-1">{formatDate(detection.created_at as unknown as string)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Last Updated</div>
              <div className="mt-1">{formatDate(detection.last_updated_at as unknown as string)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Last Tested</div>
              <div className="mt-1">{formatDate(detection.last_tested_at as unknown as string)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Last Passed</div>
              <div className="mt-1">{formatDate(detection.last_pass_at as unknown as string)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Last Failed</div>
              <div className="mt-1">{formatDate(detection.last_fail_at as unknown as string)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">
                Last Alert Fired (PurveX)
              </div>
              <div className="mt-1">{formatDate(detection.last_alert_at as unknown as string)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Last Reviewed</div>
              <div className="mt-1">{formatDate(detection.last_reviewed_at as unknown as string)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Owner</div>
              <div className="mt-1">{detection.owner || "Unassigned"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400 uppercase tracking-[0.2em]">Rule Version</div>
              <div className="mt-1">v1 (MVP - DAC versioning coming soon)</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
