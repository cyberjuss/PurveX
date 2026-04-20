"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { format, formatRelative } from "date-fns";
import { Activity, AlertTriangle, ChevronRight, Clock3, Cpu, Search, Shield, Target } from "lucide-react";
import { getDetection, getDetectionAlerts, getTest, type Detection, type DetectionAlert, type TestDetailResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type SeverityFilter = "all" | "critical" | "high" | "medium" | "low";
type StatusFilter = "all" | "active" | "resolved";

function getSeverityBadge(severity?: string | null) {
  switch ((severity || "").toLowerCase()) {
    case "critical":
    case "high":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300";
    case "medium":
      return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300";
  }
}

function getStatusBadge(status?: string | null) {
  const value = (status || "active").toLowerCase();
  if (value === "resolved" || value === "closed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
  }
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
}

function getRelativeDate(value?: string | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? "Unknown" : formatRelative(parsed, new Date());
}

export default function DetectionEventsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const detectionId = (params as { id?: string }).id;

  const [detection, setDetection] = useState<Detection | null>(null);
  const [events, setEvents] = useState<DetectionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [host, setHost] = useState("all");
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [linkedTest, setLinkedTest] = useState<TestDetailResponse | null>(null);
  const [linkedTestLoading, setLinkedTestLoading] = useState(false);
  const hasActiveFilters = query.trim().length > 0 || severity !== "all" || status !== "all" || host !== "all";

  useEffect(() => {
    const openEventRaw = searchParams.get("openEvent");
    if (!openEventRaw) return;
    const parsed = Number(openEventRaw);
    if (!Number.isNaN(parsed)) setSelectedEventId(parsed);
  }, [searchParams]);

  useEffect(() => {
    if (!detectionId) return;
    const id = detectionId;

    async function load() {
      try {
        setError(null);
        const [detail, alertData] = await Promise.all([
          getDetection(id),
          getDetectionAlerts(id),
        ]);
        setDetection(detail);
        setEvents(
          [...alertData].sort((left, right) => {
            const leftTime = new Date(left.time || left.created_at || 0).getTime();
            const rightTime = new Date(right.time || right.created_at || 0).getTime();
            return rightTime - leftTime;
          })
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to load event records.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [detectionId]);

  const hosts = useMemo(
    () =>
      Array.from(new Set(events.map((event) => event.host).filter((value): value is string => Boolean(value)))).sort(
        (left, right) => left.localeCompare(right)
      ),
    [events]
  );

  const filteredEvents = useMemo(() => {
    const normalizedQuery = query.toLowerCase().trim();
    return events.filter((event) => {
      if (severity !== "all" && (event.severity || "").toLowerCase() !== severity) return false;
      if (status !== "all") {
        const eventStatus = (event.status || "active").toLowerCase();
        if (status === "active" && !(eventStatus === "active" || eventStatus === "open")) return false;
        if (status === "resolved" && !(eventStatus === "resolved" || eventStatus === "closed")) return false;
      }
      if (host !== "all" && event.host !== host) return false;
      if (normalizedQuery) {
        const haystack = [event.name, event.message, event.host, event.severity, event.source]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(normalizedQuery)) return false;
      }
      return true;
    });
  }, [events, host, query, severity, status]);

  const activeCount = useMemo(
    () =>
      events.filter((event) => {
        const value = (event.status || "active").toLowerCase();
        return value === "active" || value === "open";
      }).length,
    [events]
  );

  const selectedEvent = useMemo(
    () => (selectedEventId == null ? null : events.find((event) => event.id === selectedEventId) || null),
    [events, selectedEventId]
  );

  function clearFilters() {
    setQuery("");
    setSeverity("all");
    setStatus("all");
    setHost("all");
  }

  useEffect(() => {
    const selectedTestId = selectedEvent?.test_id;
    if (typeof selectedTestId !== "number") {
      setLinkedTest(null);
      setLinkedTestLoading(false);
      return;
    }
    const testId = selectedTestId;
    let cancelled = false;
    async function loadTest() {
      try {
        setLinkedTestLoading(true);
        const test = await getTest(testId);
        if (!cancelled) setLinkedTest(test);
      } catch {
        if (!cancelled) setLinkedTest(null);
      } finally {
        if (!cancelled) setLinkedTestLoading(false);
      }
    }
    void loadTest();
    return () => {
      cancelled = true;
    };
  }, [selectedEvent?.test_id]);

  if (loading) {
    return (
      <PageContainer>
        <LoadingState message="Loading event records..." size="lg" />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="md" className="space-y-6">
      <PageHeader
        eyebrow="Detection events"
        title={detection?.title || "Event records"}
        subtitle="Investigate validation events inline, preserve context, and decide trust faster."
        icon={<Activity className="h-5 w-5" />}
        actions={
          <Link href={`/run-test?detectionId=${detectionId}`}>
            <Button>Revalidate detection</Button>
          </Link>
        }
      />

      <Card className="border-[var(--stroke-soft)] bg-[var(--surface-card)]">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Investigation workspace</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {events.length} events total · {activeCount} open · {hosts.length} hosts
              </p>
            </div>
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              {filteredEvents.length} in view
            </Badge>
          </div>
          <div className="grid gap-3 md:grid-cols-[1.4fr_0.8fr_0.8fr_1fr]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, message, host, severity, or source"
                className="pl-10"
              />
            </div>
            <Select value={severity} onValueChange={(value) => setSeverity(value as SeverityFilter)}>
              <SelectTrigger>
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <Select value={host} onValueChange={setHost}>
              <SelectTrigger>
                <SelectValue placeholder="Host" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All hosts</SelectItem>
                {hosts.map((hostOption) => (
                  <SelectItem key={hostOption} value={hostOption}>
                    {hostOption}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-h-8 flex-wrap items-center gap-2">
            {hasActiveFilters ? (
              <>
                {query.trim().length > 0 && (
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                    Query: {query.trim()}
                  </Badge>
                )}
                {severity !== "all" && (
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                    Severity: {severity}
                  </Badge>
                )}
                {status !== "all" && (
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                    Status: {status}
                  </Badge>
                )}
                {host !== "all" && (
                  <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                    Host: {host}
                  </Badge>
                )}
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearFilters}>
                  Clear filters
                </Button>
              </>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">Tip: click an event to open the investigation panel.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {filteredEvents.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-10 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-500" />
            <p className="text-lg font-semibold text-[var(--foreground)]">
              {query || severity !== "all" || status !== "all" || host !== "all"
                ? "No events match these filters"
                : "No events captured yet"}
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {query || severity !== "all" || status !== "all" || host !== "all"
                ? "Clear or adjust the filters to widen the events view."
                : "Run a validation and return here to inspect the resulting events."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredEvents.map((event, index) => (
            <button
              key={event.id}
              type="button"
              onClick={() => setSelectedEventId(event.id)}
              className="group w-full text-left"
              style={{ animationDelay: `${Math.min(index * 35, 180)}ms` }}
            >
              <Card
                className={cn(
                  "animate-in fade-in slide-in-from-bottom-1 transition-all duration-300 ease-out group-hover:-translate-y-[1px] group-hover:border-slate-400/50 group-hover:shadow-[var(--shadow-soft)]",
                  selectedEventId === event.id && "border-slate-900/20 shadow-[var(--shadow-soft)] ring-1 ring-slate-900/10 dark:border-white/20 dark:ring-white/15"
                )}
              >
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-semibold text-[var(--foreground)]">
                          {event.name || event.message || `Event #${event.id}`}
                        </p>
                        <Badge className={getSeverityBadge(event.severity)}>{event.severity || "info"}</Badge>
                        <Badge className={getStatusBadge(event.status)}>{event.status || "active"}</Badge>
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        {event.message || "Open the event record to inspect the full context."}
                      </p>
                      <div className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {getRelativeDate(event.time || event.created_at)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Shield className="h-3.5 w-3.5" />
                          {event.source || "SIEM"}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Target className="h-3.5 w-3.5" />
                          {event.host || "Unknown host"}
                        </span>
                        <span>Test {event.test_id ? `#${event.test_id}` : "not linked"}</span>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 transition-transform duration-300 group-hover:translate-x-0.5 dark:text-slate-300">
                      Investigate
                      <ChevronRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Sheet open={selectedEvent != null} onOpenChange={(open) => !open && setSelectedEventId(null)}>
        <SheetContent
          side="right"
          style={{ width: "50vw", maxWidth: "720px", minWidth: "480px" }}
          className="!w-[50vw] !max-w-[720px] !min-w-[480px] data-[state=open]:duration-500 data-[state=closed]:duration-300"
        >
          <SheetHeader className="sticky top-0 z-20 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75 dark:bg-slate-950/90 dark:supports-[backdrop-filter]:bg-slate-950/75">
            <SheetTitle>{selectedEvent?.name || selectedEvent?.message || "Event detail"}</SheetTitle>
            <SheetDescription>
              Analyze full event context without leaving the events list.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            {selectedEvent ? (
              <>
                <div className="animate-in fade-in slide-in-from-bottom-1 flex flex-wrap gap-2">
                  <Badge className={getSeverityBadge(selectedEvent.severity)}>{selectedEvent.severity || "info"}</Badge>
                  <Badge className={getStatusBadge(selectedEvent.status)}>{selectedEvent.status || "active"}</Badge>
                  <Badge variant="outline">ID #{selectedEvent.id}</Badge>
                </div>
                <div className="animate-in fade-in slide-in-from-bottom-1 rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-sm text-slate-700 dark:text-slate-300">
                  {selectedEvent.message || "No message text was captured for this event."}
                </div>
                <div className="animate-in fade-in slide-in-from-bottom-1 grid gap-3 md:grid-cols-2">
                  <DetailStat label="Observed" value={formatDate(selectedEvent.time || selectedEvent.created_at)} />
                  <DetailStat label="Relative" value={getRelativeDate(selectedEvent.time || selectedEvent.created_at)} />
                  <DetailStat label="Host" value={selectedEvent.host || "Unknown host"} />
                  <DetailStat label="Source" value={selectedEvent.source || "SIEM"} />
                  <DetailStat label="Linked test" value={selectedEvent.test_id ? `#${selectedEvent.test_id}` : "Not linked"} />
                  <DetailStat label="Detection" value={detection?.title || "Unknown detection"} />
                </div>
                {linkedTestLoading && (
                  <div className="space-y-2">
                    <div className="h-4 w-40 animate-pulse rounded bg-slate-200/80 dark:bg-slate-700/60" />
                    <div className="grid gap-2 md:grid-cols-3">
                      <div className="h-16 animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-700/60" />
                      <div className="h-16 animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-700/60" />
                      <div className="h-16 animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-700/60" />
                    </div>
                  </div>
                )}
                {linkedTest && (
                  <div className="animate-in fade-in slide-in-from-bottom-1 rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Linked validation</p>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                      <DetailStat label="Result" value={linkedTest.result || linkedTest.status || "Unknown"} />
                      <DetailStat label="Score" value={typeof linkedTest.score === "number" ? `${linkedTest.score}/100` : "N/A"} />
                      <DetailStat label="Environment" value={linkedTest.environment || "Unknown"} />
                    </div>
                  </div>
                )}
                <div className="animate-in fade-in slide-in-from-bottom-1 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Query context</p>
                  <pre className="max-h-44 overflow-auto rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--foreground)]">
{selectedEvent.query || "--"}
                  </pre>
                </div>
                <div className="animate-in fade-in slide-in-from-bottom-1 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Raw payload</p>
                  <pre className="max-h-[24rem] overflow-auto rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--foreground)]">
{formatRawEvent(selectedEvent.raw_event)}
                  </pre>
                </div>
                <div className="animate-in fade-in slide-in-from-bottom-1 flex flex-wrap gap-2">
                  <Link href={`/run-test?detectionId=${detectionId}`}>
                    <Button size="sm">Revalidate</Button>
                  </Link>
                  <Link href={`/agent?detectionId=${detectionId}&alertId=${selectedEvent.id}`}>
                    <Button size="sm" variant="outline" className="inline-flex items-center gap-2">
                      <Cpu className="h-4 w-4" />
                      Ask Watchtower
                    </Button>
                  </Link>
                </div>
              </>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Unknown" : format(parsed, "MMM dd, yyyy HH:mm");
}

function formatRawEvent(rawEvent?: string) {
  if (!rawEvent) return "No raw payload stored for this event.";
  try {
    return JSON.stringify(JSON.parse(rawEvent), null, 2);
  } catch {
    return rawEvent;
  }
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{label}</p>
      <p className={cn("mt-1 text-sm font-medium text-[var(--foreground)]")}>{value}</p>
    </div>
  );
}
