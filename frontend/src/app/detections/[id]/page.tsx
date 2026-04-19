"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { format, formatDistanceToNow } from "date-fns";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Play,
  Shield,
  UserPlus,
  XCircle,
} from "lucide-react";
import {
  type Detection,
  type DetectionAlert,
  type TestWithDetectionTitle,
  apiFetch,
  getDetection,
  getDetectionAlerts,
  getTests,
  getUsers,
} from "@/lib/api";
import { Permission } from "@/lib/permissions";
import { usePermissions } from "@/hooks/usePermissions";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

type HealthState = "HEALTHY" | "FAILED" | "TELEMETRY_GAP" | "UNTESTED";

type UserOption = {
  id: number;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
};

const HEALTH_META: Record<
  HealthState,
  {
    label: string;
    headline: string;
    nextAction: string;
    icon: typeof CheckCircle2;
    accent: string;
    bar: string;
  }
> = {
  HEALTHY: {
    label: "Trusted",
    headline: "Rule fired and telemetry was present in the last validation.",
    nextAction: "Revalidate on schedule before events data becomes stale.",
    icon: CheckCircle2,
    accent: "border-emerald-200 bg-emerald-50 text-emerald-700",
    bar: "bg-emerald-500",
  },
  FAILED: {
    label: "Needs tuning",
    headline: "Telemetry arrived but the rule did not fire.",
    nextAction: "Inspect events, tune the rule, then rerun the validation.",
    icon: XCircle,
    accent: "border-rose-200 bg-rose-50 text-rose-700",
    bar: "bg-rose-500",
  },
  TELEMETRY_GAP: {
    label: "Telemetry gap",
    headline: "Validation ran without usable telemetry in the SIEM.",
    nextAction: "Fix the telemetry path before retesting the rule.",
    icon: AlertTriangle,
    accent: "border-amber-200 bg-amber-50 text-amber-700",
    bar: "bg-amber-500",
  },
  UNTESTED: {
    label: "Untested",
    headline: "No validation events exist for this detection yet.",
    nextAction: "Run the first validation to establish a trust baseline.",
    icon: Clock3,
    accent: "border-slate-200 bg-slate-100 text-slate-700",
    bar: "bg-slate-400",
  },
};

function deriveHealth(detection: Detection, tests: TestWithDetectionTitle[]): HealthState {
  const lastResult = (detection.last_result || tests[0]?.result || "").toUpperCase();
  if (!detection.last_tested_at && !tests[0]) return "UNTESTED";
  if (lastResult === "PASS") return "HEALTHY";
  if (lastResult === "FAIL") return "FAILED";
  if (lastResult === "INCONCLUSIVE") return "TELEMETRY_GAP";
  return "UNTESTED";
}

function relative(value?: string | null) {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return "Never";
  return `${formatDistanceToNow(parsed)} ago`;
}

function absolute(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? "-" : format(parsed, "MMM dd, yyyy");
}

function resultBadgeClass(result?: string | null) {
  const value = (result || "").toUpperCase();
  if (value === "PASS") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "FAIL") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "INCONCLUSIVE") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function scoreTone(score?: number | null) {
  if (typeof score !== "number") return "text-slate-500";
  if (score >= 80) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-rose-600";
}

export default function DetectionDetailPage() {
  const params = useParams();
  const detectionId = (params as { id?: string }).id;
  const { hasPermission } = usePermissions();
  const { toast } = useToast();

  const [detection, setDetection] = useState<Detection | null>(null);
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [events, setEvents] = useState<DetectionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignOwnerOpen, setAssignOwnerOpen] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedOwner, setSelectedOwner] = useState("unassigned");
  const [assigningOwner, setAssigningOwner] = useState(false);

  const canAssignOwner = hasPermission(Permission.DETECTIONS_UPDATE);

  useEffect(() => {
    if (!detectionId) return;
    const id = detectionId;

    async function load() {
      try {
        setLoading(true);
        const [detail, allTests, detailEvents] = await Promise.all([
          getDetection(id),
          getTests(),
          getDetectionAlerts(id).catch(() => []),
        ]);

        if (!detail) {
          setDetection(null);
          setError("Detection not found.");
          return;
        }

        setDetection(detail);
        setTests(
          allTests
            .filter((test) => test.detection_id === id)
            .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
        );
        setEvents(
          [...(detailEvents || [])]
            .sort((a, b) => {
              const at = new Date(a.time || a.created_at || 0).getTime();
              const bt = new Date(b.time || b.created_at || 0).getTime();
              return bt - at;
            })
            .slice(0, 3)
        );
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load detection details.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [detectionId]);

  useEffect(() => {
    if (!assignOwnerOpen || !canAssignOwner) return;
    async function loadUsersForAssignment() {
      try {
        const data = await getUsers();
        setUsers(data);
        setSelectedOwner(detection?.owner || "unassigned");
      } catch {
        toast({ type: "error", title: "Error", description: "Failed to load users." });
      }
    }
    void loadUsersForAssignment();
  }, [assignOwnerOpen, canAssignOwner, detection?.owner, toast]);

  const health = useMemo(() => {
    if (!detection) return "UNTESTED" as HealthState;
    return deriveHealth(detection, tests);
  }, [detection, tests]);

  const meta = HEALTH_META[health];
  async function handleAssignOwner() {
    if (!detectionId || !canAssignOwner) return;
    try {
      setAssigningOwner(true);
      const owner = selectedOwner === "unassigned" ? null : selectedOwner;
      await apiFetch(`/detections/${detectionId}`, {
        method: "PATCH",
        body: JSON.stringify({ owner }),
      });
      const updated = await getDetection(detectionId);
      if (updated) setDetection(updated);
      setAssignOwnerOpen(false);
      toast({
        type: "success",
        title: "Owner updated",
        description: owner ? `Assigned to ${owner}.` : "Detection owner removed.",
      });
    } catch (err: unknown) {
      toast({
        type: "error",
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update owner.",
      });
    } finally {
      setAssigningOwner(false);
    }
  }

  if (!detectionId) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="pt-6 text-sm text-rose-600">Invalid detection id.</CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (loading) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="pt-6 text-sm text-slate-600">Loading detection record...</CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (error || !detection) {
    return (
      <PageContainer>
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm font-semibold text-rose-600">{error || "Detection not found."}</p>
            <Link href="/detections">
              <Button variant="outline">Back to detections</Button>
            </Link>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const HealthIcon = meta.icon;
  const lifecycle = (detection.status || detection.lifecycle_stage || "draft").replaceAll("_", " ").toLowerCase();

  return (
    <PageContainer maxWidth="xl" className="space-y-6">
      {/* Header strip Ã¢â‚¬â€ title, identity chips, primary action */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link href="/detections" className="text-xs font-medium text-slate-500 hover:text-slate-900">
            Back to detections
          </Link>
          <h1 className="mt-2 truncate text-2xl font-display font-semibold text-slate-900">
            {detection.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-mono text-slate-700">
              {detection.technique_id || "Unmapped"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium uppercase tracking-wide text-slate-600">
              {detection.siem_type}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-slate-600">
              Owner: {detection.owner || "Unassigned"}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 capitalize text-slate-600">
              {lifecycle}
            </span>
          </div>
        </div>
        <Link href={`/run-test?detectionId=${detection.id}`}>
          <Button className="h-10 bg-slate-900 text-white hover:bg-slate-800">
            <Play className="mr-2 h-4 w-4" />
            Validate now
          </Button>
        </Link>
      </div>

      {/* Hero status Ã¢â‚¬â€ replaces 4 KPI cards + trust card + 3 mini cards */}
      <div className={cn("rounded-2xl border-l-4 border bg-white p-6 shadow-sm", meta.accent.replace("bg-", "border-l-").split(" ").find((c) => c.startsWith("border-l-")))}>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <span className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border", meta.accent)}>
              <HealthIcon className="h-6 w-6" />
            </span>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge className={meta.accent}>{meta.label}</Badge>
                {detection.last_tested_at && (
                  <span className="text-xs text-slate-500">
                    Last validated {relative(detection.last_tested_at)}
                  </span>
                )}
              </div>
              <p className="max-w-xl text-sm font-medium text-slate-900">{meta.headline}</p>
              <p className="max-w-xl text-xs text-slate-600">Next action: {meta.nextAction}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-6 text-right">
            <Stat
              label="Score"
              value={typeof detection.last_score === "number" ? `${detection.last_score}` : "-"}
              valueClassName={scoreTone(detection.last_score)}
            />
            <Stat label="Validations" value={String(tests.length)} />
            <Stat label="Events" value={String(events.length)} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Left column: history + source */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white">
            <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Validation history</h2>
              <Link
                href={`/tests?detectionId=${detection.id}`}
                className="text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                View all
              </Link>
            </header>
            {tests.length === 0 ? (
              <div className="px-5 py-8 text-sm text-slate-600">
                No validation events exist for this detection yet. Run the first validation to establish trust.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-100">
                    <TableHead className="text-xs uppercase tracking-wider text-slate-500">When</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-slate-500">Result</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-slate-500">Score</TableHead>
                    <TableHead className="text-xs uppercase tracking-wider text-slate-500">Env</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tests.slice(0, 8).map((test) => (
                    <TableRow key={test.id} className="border-slate-100">
                      <TableCell className="text-sm text-slate-700">{relative(test.started_at)}</TableCell>
                      <TableCell>
                        <Badge className={resultBadgeClass(test.result || test.status)}>
                          {test.result || test.status || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn("text-sm font-medium", scoreTone(test.score))}>
                        {typeof test.score === "number" ? test.score : "-"}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">{test.environment || "-"}</TableCell>
                      <TableCell className="text-right">
                        <Link href={`/tests/${test.id}`}>
                          <Button variant="outline" size="sm">
                            Report
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-sm font-semibold text-slate-900">Detection source</h2>
            <p className="mt-2 text-sm text-slate-600">
              {detection.description || "No description has been added yet."}
            </p>
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">SIEM query</p>
              <pre className="max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
{detection.siem_query || "-"}
              </pre>
            </div>
            {detection.sigma_rule && (
              <div className="mt-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Sigma rule</p>
                <pre className="max-h-64 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-800">
{detection.sigma_rule}
                </pre>
              </div>
            )}
          </section>
        </div>

        {/* Right column: sidebar Ã¢â‚¬â€ facts, owner, links */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Trust decision</p>
                <div className="mt-3 flex items-center gap-2">
                  <Badge className={meta.accent}>{meta.label}</Badge>
                  <span className="text-xs text-slate-500">{meta.headline}</span>
                </div>
                <p className="mt-3 text-sm font-medium text-slate-900">{meta.nextAction}</p>
                <p className="mt-1 text-xs text-slate-500">
                  This is the current recommendation based on the latest validation events and trust state.
                </p>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h2 className="text-sm font-semibold text-slate-900">Ownership and freshness</h2>
                <dl className="mt-3 space-y-2.5 text-sm">
                  <FactRow label="Owner" value={detection.owner || "Unassigned"} />
                  <FactRow label="Last validated" value={absolute(detection.last_tested_at)} />
                  <FactRow label="Last pass" value={absolute(detection.last_pass_at)} />
                  <FactRow label="Last fail" value={absolute(detection.last_fail_at)} />
                  <FactRow label="Last event" value={relative(detection.last_alert_at)} />
                  <FactRow label="Updated" value={absolute(detection.last_updated_at)} />
                </dl>
              </div>
            </div>
            {canAssignOwner && (
              <Dialog open={assignOwnerOpen} onOpenChange={setAssignOwnerOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="mt-4 w-full">
                    <UserPlus className="mr-2 h-4 w-4" />
                    {detection.owner ? "Reassign owner" : "Assign owner"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Assign owner</DialogTitle>
                    <DialogDescription>Select who is accountable for this detection.</DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Select value={selectedOwner} onValueChange={setSelectedOwner}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select owner" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {users
                          .filter((u) => u.is_active)
                          .map((u) => (
                            <SelectItem key={u.id} value={u.email}>
                              {u.email}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAssignOwnerOpen(false)} disabled={assigningOwner}>
                      Cancel
                    </Button>
                    <Button onClick={handleAssignOwner} disabled={assigningOwner}>
                      {assigningOwner ? "Saving..." : "Save"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </section>

          {events.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Recent events</h2>
                <Link
                  href={`/detections/${detection.id}/events`}
                  className="text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  Open queue
                </Link>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Review the latest event records that support or challenge this trust state.
              </p>
              <ul className="mt-3 space-y-2.5">
                {events.map((event) => (
                  <li key={event.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {event.name || event.message || "Detection event"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {relative(event.time || event.created_at)}
                      {event.host ? ` · ${event.host}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-2xl border border-slate-200 bg-white p-2">
            <div className="px-3 pt-3">
              <h2 className="text-sm font-semibold text-slate-900">Next steps</h2>
              <p className="mt-1 text-xs text-slate-500">
                Use the trust record, events queue, and validation history to resolve the next blocker.
              </p>
            </div>
            <SidebarLink href={`/agent?detectionId=${detection.id}`} icon={Shield}>
              Ask Watchtower
            </SidebarLink>
            <SidebarLink href={`/detections/${detection.id}/events`} icon={Activity}>
              Review events queue
            </SidebarLink>
            <SidebarLink href={`/tests?detectionId=${detection.id}`} icon={Clock3}>
              Open validation history
            </SidebarLink>
          </section>
        </div>
      </div>
    </PageContainer>
  );
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-display font-bold text-slate-900", valueClassName)}>{value}</p>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="truncate text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function SidebarLink({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
    >
      <span className="inline-flex items-center gap-2">
        <Icon className="h-4 w-4 text-slate-500" />
        {children}
      </span>
      <ArrowRight className="h-4 w-4 text-slate-400" />
    </Link>
  );
}
