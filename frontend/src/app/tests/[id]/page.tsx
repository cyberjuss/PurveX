"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  TestDetailResponse,
  TestArtifact,
  Detection,
  getTest,
  getDetectionAlerts,
  type DetectionAlert,
} from "@/lib/api";
import { format, formatDistanceToNow, intervalToDuration } from "date-fns";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  ChevronDown,
  ChevronRight,
  Database,
  FlaskConical,
  Play,
  Radar,
  Terminal,
  TestTube,
  User,
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

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return "—";
  try {
    const dur = intervalToDuration({
      start: new Date(start),
      end: new Date(end),
    });
    const parts: string[] = [];
    if (dur.hours) parts.push(`${dur.hours}h`);
    if (dur.minutes) parts.push(`${dur.minutes}m`);
    if (dur.seconds || parts.length === 0) parts.push(`${dur.seconds ?? 0}s`);
    return parts.join(" ");
  } catch {
    return "—";
  }
}

function resultBadge(result?: string) {
  // Dark-mode aware tone classes. The base color stays the same; opacity is
  // tuned per-mode so the badge reads against either surface.
  switch (result) {
    case "PASS":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "FAIL":
      return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    case "INCONCLUSIVE":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "RUNNING":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    default:
      return "border-[var(--stroke-soft)] bg-[var(--surface-subtle)] text-[var(--surface-subtle-foreground)]";
  }
}

function scoreTone(score?: number | null) {
  if (typeof score !== "number") return "text-[var(--surface-subtle-foreground)]";
  if (score >= 80) return "text-emerald-600 dark:text-emerald-300";
  if (score >= 50) return "text-amber-600 dark:text-amber-300";
  return "text-rose-600 dark:text-rose-300";
}

function modeMeta(mode?: string | null): {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
} {
  switch ((mode || "").toUpperCase()) {
    case "TELEMETRY_CHECK":
      return {
        label: "Verify Telemetry",
        description: "Confirms logs landed in the SIEM. The detection rule itself was not evaluated.",
        icon: Radar,
      };
    case "ALERT_CHECK":
      return {
        label: "Explore Coverage",
        description: "Surveys whether any alert was raised across all configured detections.",
        icon: FlaskConical,
      };
    case "DETECTION_VALIDATION":
    default:
      return {
        label: "Detection Validation",
        description: "Full end-to-end check: telemetry arrival plus rule evaluation against the SIEM.",
        icon: TestTube,
      };
  }
}

function parseSampleEvents(artifact?: TestArtifact | null): unknown[] {
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

    let cancelled = false;
    async function loadDetail() {
      try {
        setLoading(true);
        const result = await getTest(testId);
        if (cancelled) return;
        if (result) {
          setData(result);
          if (result.detection?.id) {
            const events = await getDetectionAlerts(result.detection.id).catch(() => []);
            if (!cancelled) {
              setTestEvents(events.filter((e) => e.test_id === result.id));
            }
          }
        } else {
          setError("Test not found");
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load test details.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDetail();
    return () => {
      cancelled = true;
    };
  }, [testId]);

  const sampleEvents = useMemo(
    () => parseSampleEvents(data?.artifact ?? null),
    [data],
  );

  if (!testId || Number.isNaN(testId)) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="pt-6 text-sm text-rose-600 dark:text-rose-300">
            Invalid test id.
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer maxWidth="xl">
        <PageSkeleton variant="detail" withActions />
      </PageContainer>
    );
  }

  if (error || !data) {
    return (
      <PageContainer maxWidth="xl">
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">
              {error || "Test not found."}
            </p>
            <Link href="/tests">
              <Button variant="outline">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to tests
              </Button>
            </Link>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const { detection, artifact } = data as {
    detection?: Detection | null;
    artifact?: TestArtifact | null;
  };
  const result = data.result || data.status || "UNKNOWN";
  const mode = modeMeta(data.mode);
  const ModeIcon = mode.icon;
  const hasAnalysis = !!(artifact?.ai_explanation || artifact?.ai_suggested_rule);
  const isTelemetryOnly = (data.mode || "").toUpperCase() === "TELEMETRY_CHECK";
  const duration = formatDuration(data.started_at, data.finished_at);

  const telemetrySummary = data.telemetry_summary;
  const detectionSummary = data.detection_summary;

  return (
    <PageContainer maxWidth="xl" className="space-y-6">
      <Link
        href="/tests"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to tests
      </Link>

      <PageHeader
        eyebrow={`Run #${data.id}`}
        title={
          detection?.title || data.atomic_test_name || `Validation run #${data.id}`
        }
        subtitle={mode.description}
        icon={<ModeIcon className="h-5 w-5" />}
        actions={
          detection ? (
            <Link href={`/run-test?detectionId=${detection.id}`}>
              <Button className="h-10">
                <Play className="mr-2 h-4 w-4" />
                Revalidate
              </Button>
            </Link>
          ) : undefined
        }
      />

      {/* Identity chips + result */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge className={cn("border", resultBadge(result))}>{result}</Badge>
        <Badge className="border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] text-[var(--surface-subtle-foreground)]">
          {mode.label}
        </Badge>
        {typeof data.score === "number" && (
          <span className={cn("font-semibold", scoreTone(data.score))}>
            {data.score}/100
          </span>
        )}
        <Chip>{data.technique_id || "Unmapped"}</Chip>
        <Chip uppercase>{data.environment || "—"}</Chip>
        {data.endpoint && <Chip>{data.endpoint}</Chip>}
        {data.initiated_by_username && (
          <Chip>
            <User className="mr-1 inline h-3 w-3" />
            {data.initiated_by_username}
          </Chip>
        )}
      </div>

      {/* Timing strip */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-5 py-4">
        <Fact label="Started" value={fmtDate(data.started_at)} />
        <Divider />
        <Fact label="Finished" value={fmtDate(data.finished_at)} />
        <Divider />
        <Fact label="Duration" value={duration} />
        <Divider />
        <Fact label="Marker" value={data.marker || "—"} mono />
        {detection && (
          <>
            <Divider />
            <Fact label="Last alert" value={relative(detection.last_alert_at as string)} />
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Per-mode evidence summary */}
          {(telemetrySummary || detectionSummary) && (
            <Section
              title="Evidence summary"
              icon={<Database className="h-4 w-4" />}
            >
              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <SummaryStat
                  label="Telemetry in SIEM"
                  value={
                    telemetrySummary?.has_logs == null
                      ? "Not checked"
                      : telemetrySummary.has_logs
                        ? "Logs received"
                        : "No logs"
                  }
                  tone={
                    telemetrySummary?.has_logs == null
                      ? "neutral"
                      : telemetrySummary.has_logs
                        ? "good"
                        : "bad"
                  }
                  hint={
                    typeof telemetrySummary?.events_found === "number"
                      ? `${telemetrySummary.events_found} matching event${telemetrySummary.events_found === 1 ? "" : "s"}`
                      : undefined
                  }
                />
                {!isTelemetryOnly && (
                  <SummaryStat
                    label="Detection rule"
                    value={
                      detectionSummary?.rule_fired == null
                        ? "Not evaluated"
                        : detectionSummary.rule_fired
                          ? "Fired"
                          : "Did not fire"
                    }
                    tone={
                      detectionSummary?.rule_fired == null
                        ? "neutral"
                        : detectionSummary.rule_fired
                          ? "good"
                          : "bad"
                    }
                    hint={
                      typeof detectionSummary?.alerts_found === "number"
                        ? `${detectionSummary.alerts_found} alert${detectionSummary.alerts_found === 1 ? "" : "s"} raised`
                        : undefined
                    }
                  />
                )}
              </div>
            </Section>
          )}

          {/* Watchtower analysis — only meaningful for full validations */}
          {!isTelemetryOnly && (
            <Section title="Watchtower analysis" icon={<Brain className="h-4 w-4" />}>
              <div className="p-5">
                {!hasAnalysis ? (
                  <EmptyHint>
                    Analysis is not available for this run. Configure the AI assistant in
                    Settings → AI Assistant and rerun the validation to get a triage summary
                    and a suggested rule fix.
                  </EmptyHint>
                ) : (
                  <div className="space-y-4">
                    {artifact?.ai_explanation && (
                      <div className="whitespace-pre-wrap rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-4 text-sm leading-relaxed text-[var(--surface-card-foreground)]">
                        {artifact.ai_explanation}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-4">
                      {artifact?.ai_root_cause_category && (
                        <div>
                          <Eyebrow>Root cause</Eyebrow>
                          <Badge className="mt-1 border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] text-[var(--surface-card-foreground)]">
                            {artifact.ai_root_cause_category}
                          </Badge>
                        </div>
                      )}
                      {typeof artifact?.ai_confidence_score === "number" && (
                        <div>
                          <Eyebrow>Confidence</Eyebrow>
                          <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                            {artifact.ai_confidence_score}/100
                          </p>
                        </div>
                      )}
                    </div>

                    {artifact?.ai_suggested_rule && (
                      <div>
                        <Eyebrow className="mb-2">Suggested rule</Eyebrow>
                        <pre className="max-h-48 overflow-auto rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-4 text-xs text-[var(--surface-card-foreground)]">
{artifact.ai_suggested_rule}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Execution artifacts */}
          <Section title="Execution artifacts" icon={<Terminal className="h-4 w-4" />}>
            <div className="space-y-5 p-5">
              {(data.atomic_test_name || data.atomic_test_id) && (
                <div>
                  <Eyebrow className="mb-2">Atomic test</Eyebrow>
                  <p className="text-sm text-[var(--foreground)]">
                    {data.atomic_test_name || data.atomic_test_id}
                    {typeof data.atomic_test_number === "number" && (
                      <span className="ml-2 rounded border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[11px] font-mono text-[var(--surface-subtle-foreground)]">
                        #{data.atomic_test_number}
                      </span>
                    )}
                  </p>
                </div>
              )}

              <div>
                <Eyebrow className="mb-2">Command</Eyebrow>
                <pre className="max-h-40 overflow-auto rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-4 text-xs text-[var(--surface-card-foreground)]">
{artifact?.atomic_command || "No command recorded."}
                </pre>
              </div>

              {sampleEvents.length > 0 && (
                <div>
                  <Toggle
                    open={showSample}
                    onClick={() => setShowSample((v) => !v)}
                    label={`Sample SIEM events (${sampleEvents.length})`}
                  />
                  {showSample && (
                    <pre className="mt-2 max-h-72 overflow-auto rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-4 text-xs text-[var(--surface-card-foreground)]">
{JSON.stringify(sampleEvents, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </Section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {detection ? (
            <Section title="Detection">
              <div className="space-y-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {detection.title}
                  </p>
                  <Link
                    href={`/detections/${detection.id}`}
                    className="shrink-0 text-xs font-medium text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]"
                  >
                    Detail →
                  </Link>
                </div>
                <dl className="space-y-2.5 text-sm">
                  <FactRow label="Owner" value={detection.owner || "Unassigned"} />
                  <FactRow
                    label="SIEM"
                    value={(detection.siem_type || "—").toUpperCase()}
                  />
                  <FactRow
                    label="Status"
                    value={(detection.status || "Draft")
                      .replaceAll("_", " ")
                      .toLowerCase()}
                  />
                  <FactRow
                    label="Last pass"
                    value={fmtDate(detection.last_pass_at as string)}
                  />
                  <FactRow
                    label="Last fail"
                    value={fmtDate(detection.last_fail_at as string)}
                  />
                </dl>

                <div>
                  <Eyebrow className="mb-2">Query</Eyebrow>
                  <pre className="max-h-40 overflow-auto rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-3 text-xs text-[var(--surface-card-foreground)]">
{detection.siem_query || "—"}
                  </pre>
                </div>

                {detection.sigma_rule && (
                  <div>
                    <Toggle
                      open={showSigma}
                      onClick={() => setShowSigma((v) => !v)}
                      label="Sigma rule"
                    />
                    {showSigma && (
                      <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-3 text-xs text-[var(--surface-card-foreground)]">
{detection.sigma_rule}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </Section>
          ) : (
            <Section title="Detection">
              <div className="p-5">
                <EmptyHint>No detection is linked to this run.</EmptyHint>
              </div>
            </Section>
          )}

          {/* Evidence events */}
          <Section title="Evidence events">
            <div className="p-5">
              {testEvents.length === 0 ? (
                <EmptyHint>
                  No evidence events captured for this run.
                  {detection && (
                    <>
                      {" "}
                      <Link
                        href={`/detections/${detection.id}/events`}
                        className="font-medium text-[var(--accent-strong)] hover:underline"
                      >
                        View all events for this detection
                      </Link>
                      .
                    </>
                  )}
                </EmptyHint>
              ) : (
                <>
                  <ul className="space-y-2">
                    {testEvents.slice(0, 5).map((event) => (
                      <li
                        key={event.id}
                        className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] px-3 py-2.5"
                      >
                        <p className="truncate text-sm font-medium text-[var(--foreground)]">
                          {event.name || event.message || "Evidence event"}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--surface-subtle-foreground)]">
                          {relative(event.time || event.created_at)}
                          {event.host ? ` · ${event.host}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {detection && testEvents.length > 5 && (
                    <Link
                      href={`/detections/${detection.id}/events`}
                      className="mt-3 inline-block text-xs font-medium text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]"
                    >
                      View all {testEvents.length} events →
                    </Link>
                  )}
                </>
              )}
            </div>
          </Section>
        </div>
      </div>
    </PageContainer>
  );
}

/* ---------- presentational helpers ---------- */

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
      <header className="flex items-center gap-2 border-b border-[var(--stroke-soft)] px-5 py-4">
        {icon ? (
          <span className="text-[var(--surface-subtle-foreground)]">{icon}</span>
        ) : null}
        <h2 className="text-sm font-semibold text-[var(--foreground)]">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function Chip({
  children,
  uppercase,
}: {
  children: React.ReactNode;
  uppercase?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded-full border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-2.5 py-1 font-mono text-[var(--surface-subtle-foreground)]",
        uppercase && "uppercase font-sans tracking-wide",
      )}
    >
      {children}
    </span>
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
      <Eyebrow>{label}</Eyebrow>
      <p
        className={cn(
          "mt-0.5 text-sm text-[var(--foreground)]",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs font-medium uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
        {label}
      </dt>
      <dd className="truncate text-sm font-medium capitalize text-[var(--foreground)]">
        {value}
      </dd>
    </div>
  );
}

function Eyebrow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)]",
        className,
      )}
    >
      {children}
    </p>
  );
}

function Divider() {
  return <div className="hidden h-8 w-px bg-[var(--stroke-soft)] sm:block" />;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] px-4 py-3 text-xs leading-relaxed text-[var(--surface-subtle-foreground)]">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
      <div>{children}</div>
    </div>
  );
}

function Toggle({
  open,
  onClick,
  label,
}: {
  open: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)] transition hover:text-[var(--foreground)]"
      onClick={onClick}
      aria-expanded={open}
    >
      {open ? (
        <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronRight className="h-3 w-3" />
      )}
      {label}
    </button>
  );
}

function SummaryStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "good" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300"
      : tone === "bad"
        ? "border-rose-500/30 bg-rose-500/[0.06] text-rose-700 dark:text-rose-300"
        : "border-[var(--stroke-soft)] bg-[var(--surface-subtle)] text-[var(--surface-subtle-foreground)]";
  return (
    <div className={cn("rounded-xl border px-4 py-3", toneClass)}>
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1 text-base font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs opacity-80">{hint}</p>}
    </div>
  );
}
