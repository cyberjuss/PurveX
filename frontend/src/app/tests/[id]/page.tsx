"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { Card, CardContent } from "@/components/ui/card";
import {
  TestDetailResponse,
  TestArtifact,
  Detection,
  getTest,
  getDetectionAlerts,
  type DetectionAlert,
} from "@/lib/api";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock,
  Play,
  Target,
  Terminal,
} from "lucide-react";

function fmtDate(value?: string | null) {
  if (!value) return "—";
  try {
    return format(new Date(value), "MMM dd, yyyy HH:mm");
  } catch {
    return value;
  }
}

function relative(value?: string | null) {
  if (!value) return "—";
  try {
    return `${formatDistanceToNow(new Date(value))} ago`;
  } catch {
    return "—";
  }
}

function resultBadge(result?: string) {
  switch (result) {
    case "PASS":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "FAIL":
      return "border-red-200 bg-red-50 text-red-700";
    case "INCONCLUSIVE":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "RUNNING":
      return "border-blue-200 bg-blue-50 text-blue-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

function scoreTone(score?: number | null) {
  if (typeof score !== "number") return "text-slate-500";
  if (score >= 80) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

function parseSampleEvents(artifact?: TestArtifact): unknown[] {
  if (!artifact?.siem_sample_events) return [];
  try {
    const parsed = JSON.parse(artifact.siem_sample_events);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export default function TestDetailPage() {
  const params = useParams();
  const testId = Number((params as { id?: string }).id);

  const [data, setData] = useState<TestDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testEvents, setTestEvents] = useState<DetectionAlert[]>([]);
  const [showSigma, setShowSigma] = useState(false);
  const [showSample, setShowSample] = useState(false);

  useEffect(() => {
    if (!testId || Number.isNaN(testId)) return;

    async function loadDetail() {
      try {
        setLoading(true);
        const result = await getTest(testId);
        if (result) {
          setData(result);
          if (result.detection?.id) {
            const events = await getDetectionAlerts(result.detection.id).catch(() => []);
            setTestEvents(events.filter((e) => e.test_id === result.id));
          }
        } else {
          setError("Test not found");
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load test details.");
      } finally {
        setLoading(false);
      }
    }

    loadDetail();
  }, [testId]);

  if (!testId || Number.isNaN(testId)) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="pt-6 text-sm text-red-600">Invalid test id.</CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="pt-6 text-sm text-slate-600">Loading test details...</CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (error || !data) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-semibold text-red-600">{error || "Test not found."}</p>
            <Link href="/tests">
              <Button variant="outline">Back to tests</Button>
            </Link>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const { detection, artifact } = data as {
    detection?: Detection | null;
    artifact?: TestArtifact;
  };
  const sampleEvents = parseSampleEvents(artifact);
  const result = data.result || data.status || "UNKNOWN";
  const hasAnalysis = !!(artifact?.ai_explanation || artifact?.ai_suggested_rule);

  return (
    <PageContainer maxWidth="xl" className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/tests"
            className="text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            ← Tests
          </Link>
          <h1 className="mt-2 text-2xl font-display font-semibold text-slate-900">
            Validation run #{data.id}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge className={resultBadge(result)}>{result}</Badge>
            {typeof data.score === "number" && (
              <span className={cn("font-semibold", scoreTone(data.score))}>
                {data.score}/100
              </span>
            )}
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-slate-700">
              {data.technique_id || "—"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 uppercase text-slate-600">
              {data.environment || "—"}
            </span>
            {data.endpoint && (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
                {data.endpoint}
              </span>
            )}
          </div>
        </div>
        {detection && (
          <Link href={`/run-test?detectionId=${detection.id}`}>
            <Button className="h-10 bg-slate-900 text-white hover:bg-slate-800">
              <Play className="mr-2 h-4 w-4" />
              Revalidate
            </Button>
          </Link>
        )}
      </div>

      {/* Timing strip */}
      <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm">
        <Fact label="Started" value={fmtDate(data.started_at)} />
        <div className="hidden h-8 w-px bg-slate-200 sm:block" />
        <Fact label="Finished" value={fmtDate(data.finished_at)} />
        <div className="hidden h-8 w-px bg-slate-200 sm:block" />
        <Fact label="Marker" value={data.marker || "—"} mono />
        {detection && (
          <>
            <div className="hidden h-8 w-px bg-slate-200 sm:block" />
            <Fact label="Last alert" value={relative(detection.last_alert_at as string)} />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Watchtower analysis — the highest-value section */}
          <section className="rounded-2xl border border-slate-200 bg-white">
            <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <Brain className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">Watchtower analysis</h2>
            </header>
            <div className="p-5">
              {!hasAnalysis ? (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Analysis not available. Configure the AI integration and rerun the validation.
                </div>
              ) : (
                <div className="space-y-4">
                  {artifact?.ai_explanation && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                      {artifact.ai_explanation}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {artifact?.ai_root_cause_category && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Root cause{" "}
                        </span>
                        <Badge className="border-slate-200 bg-slate-100 text-slate-700">
                          {artifact.ai_root_cause_category}
                        </Badge>
                      </div>
                    )}
                    {typeof artifact?.ai_confidence_score === "number" && (
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          Confidence{" "}
                        </span>
                        <span className="text-sm font-semibold text-slate-900">
                          {artifact.ai_confidence_score}/100
                        </span>
                      </div>
                    )}
                  </div>

                  {artifact?.ai_suggested_rule && (
                    <div>
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                        Suggested rule
                      </p>
                      <pre className="max-h-40 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
{artifact.ai_suggested_rule}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Execution artifacts */}
          <section className="rounded-2xl border border-slate-200 bg-white">
            <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <Terminal className="h-4 w-4 text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-900">Execution artifacts</h2>
            </header>
            <div className="space-y-4 p-5">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Command
                </p>
                <pre className="max-h-32 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
{artifact?.atomic_command || "No command recorded."}
                </pre>
              </div>

              {sampleEvents.length > 0 && (
                <div>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-900"
                    onClick={() => setShowSample((v) => !v)}
                  >
                    {showSample ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    Sample SIEM events ({sampleEvents.length})
                  </button>
                  {showSample && (
                    <pre className="mt-2 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
{JSON.stringify(sampleEvents, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Detection info */}
          {detection ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Detection</h2>
                <Link
                  href={`/detections/${detection.id}`}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  View detail →
                </Link>
              </div>
              <p className="mt-2 truncate text-sm font-medium text-slate-800">
                {detection.title}
              </p>
              <dl className="mt-3 space-y-2.5 text-sm">
                <FactRow label="Owner" value={detection.owner || "Unassigned"} />
                <FactRow label="SIEM" value={(detection.siem_type || "—").toUpperCase()} />
                <FactRow
                  label="Status"
                  value={(detection.status || "Draft").replaceAll("_", " ").toLowerCase()}
                />
                <FactRow label="Last pass" value={fmtDate(detection.last_pass_at as string)} />
                <FactRow label="Last fail" value={fmtDate(detection.last_fail_at as string)} />
              </dl>

              {/* SIEM query */}
              <div className="mt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  Query
                </p>
                <pre className="max-h-32 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
{detection.siem_query || "—"}
                </pre>
              </div>

              {detection.sigma_rule && (
                <div className="mt-3">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-900"
                    onClick={() => setShowSigma((v) => !v)}
                  >
                    {showSigma ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    Sigma rule
                  </button>
                  {showSigma && (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
{detection.sigma_rule}
                    </pre>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">Detection</h2>
              <p className="mt-2 text-sm text-slate-600">
                No detection is linked to this run.
              </p>
            </section>
          )}

          {/* Evidence events */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Evidence</h2>
              {detection && testEvents.length > 0 && (
                <Link
                  href={`/detections/${detection.id}/events`}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  All events
                </Link>
              )}
            </div>
            {testEvents.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No evidence captured for this run.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {testEvents.slice(0, 5).map((event) => (
                  <li
                    key={event.id}
                    className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
                  >
                    <p className="truncate text-sm font-medium text-slate-900">
                      {event.name || event.message || "Evidence event"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {relative(event.time || event.created_at)}
                      {event.host ? ` · ${event.host}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </PageContainer>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn("mt-0.5 text-sm text-slate-800", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="truncate text-sm font-medium capitalize text-slate-800">{value}</dd>
    </div>
  );
}
