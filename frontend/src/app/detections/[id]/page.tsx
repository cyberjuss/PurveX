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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Detection,
  type DetectionAlert,
  TestWithDetectionTitle,
  getDetection,
  getDetectionAlerts,
  getTests,
  getUsers,
  apiFetch,
} from "@/lib/api";
import { format, formatRelative } from "date-fns";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import {
  ArrowLeft,
  Target,
  Activity,
  Shield,
  Clock,
  FileText,
  Sparkles,
  UserPlus,
  Loader2,
  Crown,
  Users,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";

function formatDate(value?: string | null) {
  if (!value) return "N/A";
  try {
    return format(new Date(value), "yyyy-MM-dd HH:mm:ss 'UTC'");
  } catch {
    return value;
  }
}

function getStatusBadgeClass(status?: string | null) {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-100 text-emerald-700 border border-emerald-300";
    case "NEEDS_IMPROVEMENT":
      return "bg-amber-100 text-amber-700 border border-amber-300";
    case "DRAFT":
      return "bg-slate-100 text-slate-700 border border-slate-300";
    case "RETIRED":
      return "bg-slate-200 text-slate-800 border border-slate-400";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-300";
  }
}

function getResultBadgeClass(result?: string) {
  switch (result) {
    case "PASS":
      return "bg-emerald-100 text-emerald-700 border border-emerald-300";
    case "FAIL":
      return "bg-red-100 text-red-700 border border-red-300";
    case "INCONCLUSIVE":
      return "bg-orange-100 text-orange-700 border border-orange-300";
    default:
      return "bg-slate-100 text-slate-700 border border-slate-300";
  }
}

export default function DetectionDetailPage() {
  const params = useParams();
  const detectionId = (params as { id?: string }).id;
  const evidenceComingSoon = true;

  const [detection, setDetection] = useState<Detection | null>(null);
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [events, setEvents] = useState<DetectionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignOwnerOpen, setAssignOwnerOpen] = useState(false);
  const [users, setUsers] = useState<Array<{ id: number; email: string; is_admin: boolean; is_active: boolean; created_at: string }>>([]);
  const [selectedOwner, setSelectedOwner] = useState<string>("unassigned");
  const [assigningOwner, setAssigningOwner] = useState(false);
  const [siemConnections, setSiemConnections] = useState<Array<{ id: number; name: string; siem_type: string }>>([]);
  const [selectedSiemId, setSelectedSiemId] = useState<number | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceData, setEvidenceData] = useState<{ count: number; items: any[]; deep_link?: string } | null>(null);
  const [evidenceFilters, setEvidenceFilters] = useState({
    earliest: "-2m",
    latest: "now",
    host: "",
    user: "",
    dest: "",
    src: "",
    limit: "50",
  });
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const { toast } = useToast();
  
  // Check if user has permission to update detections (least privilege)
  const canAssignOwner = hasPermission(Permission.DETECTIONS_UPDATE);

  useEffect(() => {
    if (!detectionId) return;

    async function load() {
      if (!detectionId) return; // Type guard
      try {
        setLoading(true);
        const [det, allTests, detectionEvents] = await Promise.all([
          getDetection(detectionId),
          getTests(),
          getDetectionAlerts(detectionId).catch(() => []),
        ]);
        // getDetection now returns null for 404s instead of throwing
        if (det) {
          setDetection(det);
          setError(null);
        } else {
          // Detection not found (404)
          setDetection(null);
          setError("Detection not found.");
        }
        setTests(
          allTests.filter((t) => t.detection_id === detectionId)
        );
        setEvents(detectionEvents || []);
        if (!evidenceFilters.host && (detectionEvents || []).length > 0) {
          const latestEvent = [...(detectionEvents || [])].sort((a, b) => {
            const dateA = new Date(a.time || a.created_at || 0).getTime();
            const dateB = new Date(b.time || b.created_at || 0).getTime();
            return dateB - dateA;
          })[0];
          if (latestEvent?.host) {
            setEvidenceFilters((prev) => ({ ...prev, host: latestEvent.host || "" }));
          }
        }
        try {
          const siemData = await apiFetch("/settings/siem-connections");
          const validConnections = Array.isArray(siemData) ? siemData : [];
          setSiemConnections(validConnections);
          if (!selectedSiemId && validConnections.length > 0) {
            setSelectedSiemId(validConnections[0].id);
            setEvidenceData(null);
            setEvidenceError(null);
          }
        } catch {
          setSiemConnections([]);
        }
      } catch (err: any) {
        // Only set error for non-404 errors
        const is404 = (err as any)?.is404 || 
                      err?.message?.toLowerCase().includes("not found") || 
                      err?.message?.toLowerCase().includes("404");
        if (!is404) {
          setError(err.message || "Failed to load detection details.");
        } else {
          setDetection(null);
          setError("Detection not found.");
        }
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [detectionId]);

  // Load users when assign owner dialog opens
  useEffect(() => {
    if (assignOwnerOpen && canAssignOwner) {
      async function loadUsers() {
        try {
          const usersData = await getUsers();
          setUsers(usersData);
          // Set initial value to current owner or "unassigned"
          setSelectedOwner(detection?.owner || "unassigned");
        } catch (err: any) {
          console.error("Failed to load users:", err);
          toast({
            type: "error",
            title: "Error",
            description: "Failed to load users. Please try again.",
          });
        }
      }
      loadUsers();
    }
  }, [assignOwnerOpen, canAssignOwner, detection?.owner]);

  const fetchEvidence = async () => {
    if (!selectedSiemId) {
      setEvidenceError("No SIEM connection configured.");
      return;
    }
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const params = new URLSearchParams();
      if (evidenceFilters.earliest) params.set("earliest", evidenceFilters.earliest);
      if (evidenceFilters.latest) params.set("latest", evidenceFilters.latest);
      if (evidenceFilters.host) params.set("host", evidenceFilters.host);
      if (evidenceFilters.user) params.set("user", evidenceFilters.user);
      if (evidenceFilters.dest) params.set("dest", evidenceFilters.dest);
      if (evidenceFilters.src) params.set("src", evidenceFilters.src);
      if (evidenceFilters.limit) params.set("limit", evidenceFilters.limit);
      const data = await apiFetch(`/settings/siem-connections/${selectedSiemId}/evidence?${params.toString()}`);
      setEvidenceData(data);
    } catch (err: any) {
      setEvidenceError(err.message || "Failed to fetch evidence.");
    } finally {
      setEvidenceLoading(false);
    }
  };


  const handleAssignOwner = async () => {
    if (!detectionId || !canAssignOwner) return;
    
    try {
      setAssigningOwner(true);
      
      // Convert "unassigned" to null for the API
      const ownerValue = selectedOwner === "unassigned" ? null : selectedOwner;
      
      await apiFetch(`/detections/${detectionId}`, {
        method: "PATCH",
        body: JSON.stringify({ owner: ownerValue }),
      });
      
      // Reload detection to get updated owner
      const updatedDetection = await getDetection(detectionId);
      // getDetection now returns null for 404s instead of throwing
      if (updatedDetection) {
        setDetection(updatedDetection);
      }
      setAssignOwnerOpen(false);
      setSelectedOwner("unassigned");
      
      toast({
        type: "success",
        title: "Owner assigned",
        description: ownerValue 
          ? `Detection owner has been updated to ${ownerValue}.`
          : "Detection owner has been unassigned.",
      });
    } catch (err: any) {
      const errorMessage = err.message || "Failed to assign owner. The backend may not support this operation yet.";
      toast({
        type: "error",
        title: "Error",
        description: errorMessage,
      });
      console.error("Failed to assign owner:", err);
    } finally {
      setAssigningOwner(false);
    }
  };

  if (!detectionId) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive text-sm">Invalid detection id.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-slate-600 text-sm">Loading detection details...</p>
      </div>
    );
  }

  if (error || !detection) {
    return (
      <div className="p-6 space-y-4">
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Error loading detection details: {error || "No data returned."}
        </div>
      </div>
    );
  }

  const testsForDetection = tests.sort((a, b) => {
    return (
      new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
    );
  });
  const lastTest = testsForDetection[0];
  const lastResult = lastTest?.result || lastTest?.status;

  const lifecycleStages = [
    { key: "DRAFT", label: "Draft" },
    { key: "ACTIVE", label: "Active" },
    { key: "NEEDS_IMPROVEMENT", label: "Needs improvement" },
    { key: "RETIRED", label: "Retired" },
  ];
  const normalizedStatus = (detection.status || "DRAFT").toUpperCase();
  let currentStageIndex = lifecycleStages.findIndex(
    (s) => s.key === normalizedStatus
  );
  if (currentStageIndex === -1) currentStageIndex = 0;

  const recentEvents = [...events]
    .sort((a, b) => {
      const dateA = new Date(a.time || a.created_at || 0).getTime();
      const dateB = new Date(b.time || b.created_at || 0).getTime();
      return dateB - dateA;
    })
    .slice(0, 5);

  const getEventSeverityClass = (severity?: string) => {
    switch ((severity || "").toLowerCase()) {
      case "critical":
      case "high":
        return "bg-red-100 text-red-700 border border-red-300";
      case "medium":
        return "bg-amber-100 text-amber-700 border border-amber-300";
      case "low":
        return "bg-sky-100 text-sky-700 border border-sky-300";
      default:
        return "bg-slate-100 text-slate-700 border border-slate-300";
    }
  };

  return (
    <PageContainer maxWidth="xl">
      <PageHeader
        eyebrow="Detection detail"
        title={detection.title}
        subtitle={`${detection.technique_id} · ${detection.siem_type} · ${detection.siem_query}`}
        icon={<Target className="h-5 w-5" />}
        actions={
          <div className="flex flex-col items-end gap-2">
            <Badge className={getStatusBadgeClass(detection.status)}>
              {detection.status || "UNSET"}
            </Badge>
            {lastTest && (
              <div className="flex items-center gap-2 text-[11px] text-slate-700">
                <span className="uppercase tracking-[0.18em] text-slate-500">
                  Last test
                </span>
                <Badge className={getResultBadgeClass(lastResult)}>
                  {lastResult}
                </Badge>
                <span className="text-slate-700">
                  {formatRelative(new Date(lastTest.started_at), new Date())}
                </span>
              </div>
            )}
          </div>
        }
      />
      <div className="space-y-6">

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="bg-white border border-slate-200 text-black">
          <TabsTrigger value="overview" className="text-xs md:text-sm text-black data-[state=active]:text-black data-[state=active]:bg-slate-50">
            Overview
          </TabsTrigger>
          <TabsTrigger value="tests" className="text-xs md:text-sm text-black data-[state=active]:text-black data-[state=active]:bg-slate-50">
            Test runs
          </TabsTrigger>
          <TabsTrigger value="lifecycle" className="text-xs md:text-sm text-black data-[state=active]:text-black data-[state=active]:bg-slate-50">
            Lifecycle
          </TabsTrigger>
          <TabsTrigger value="ownership" className="text-xs md:text-sm text-black data-[state=active]:text-black data-[state=active]:bg-slate-50">
            Ownership
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Detection Overview */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-slate-900">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-600 border border-sky-200">
                    <Target className="h-4 w-4" />
                  </span>
                  <span>Detection Overview</span>
                </CardTitle>
                <CardDescription className="mt-1 text-slate-700">
                  Core metadata, query, and how this rule participates in PurveX tests.
                </CardDescription>
              </div>
              <Button
                asChild
                size="sm"
                className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm inline-flex items-center gap-2"
              >
                <Link href={`/run-test?detectionId=${detection.id}`}>
                  <Activity className="h-4 w-4" />
                  Launch test
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-900">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-slate-700">
                    Technique
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <Target className="h-3 w-3 text-slate-700" />
                    <span>{detection.technique_id}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-slate-700">
                    SIEM
                  </div>
                  <div className="mt-1 flex items-center gap-1">
                    <Shield className="h-3 w-3 text-slate-700" />
                    <span className="uppercase">{detection.siem_type}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.25em] text-slate-700">
                  Detection description
                </div>
                <p className="text-sm text-slate-900">
                  {detection.description || "No description provided yet."}
                </p>
              </div>

              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.25em] text-slate-700">
                  SIEM query (read-only)
                </div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-900 border border-slate-200">
{detection.siem_query}
                </pre>
              </div>

              {detection.sigma_rule && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-700">
                      Sigma rule (lab demo)
                    </div>
                  </div>
                  <pre className="max-h-60 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-900 border border-slate-200">
{detection.sigma_rule}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Events */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-slate-900">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 border border-emerald-200">
                    <Activity className="h-4 w-4" />
                  </span>
                  <span>Recent events</span>
                </CardTitle>
                <CardDescription className="mt-1 text-slate-700">
                  Latest events tied to this detection's validation runs.
                </CardDescription>
              </div>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"
              >
                <Link href={`/detections/${detection.id}/events`}>
                  View all events
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentEvents.length === 0 ? (
                <p className="text-sm text-slate-700">
                  No events have been recorded for this detection yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {recentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="text-sm text-slate-900 truncate">
                          {event.name || event.message || "Event"}
                        </div>
                        <div className="text-xs text-slate-600">
                          {new Date(event.time || event.created_at || new Date()).toLocaleString()}
                          {event.host ? ` | ${event.host}` : ""}
                        </div>
                      </div>
                      <Badge className={getEventSeverityClass(event.severity)}>
                        {event.severity || "medium"}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* SIEM Evidence */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-slate-900">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 border border-indigo-200">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span>Splunk ES evidence</span>
                </CardTitle>
                <CardDescription className="mt-1 text-slate-700">
                  Pull a minimal evidence bundle from notables (no raw logs).
                </CardDescription>
              </div>
              <Badge className="bg-slate-100 text-slate-700 border border-slate-200">
                Coming soon
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {evidenceComingSoon ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
                  Evidence collection is coming soon. Connect your SIEM and run a test to enable evidence bundles.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tests">
          {/* Recent tests for this detection */}
          <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-600 border border-sky-200">
                <Activity className="h-4 w-4" />
              </span>
              <span>Validation history for this detection</span>
            </CardTitle>
            <CardDescription className="mt-1 text-slate-700">
              Latest runs, results, and environments for this rule.
            </CardDescription>
          </div>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"
          >
            <Link href="/tests">
              <Clock className="h-4 w-4" />
              View all tests
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {testsForDetection.length === 0 ? (
            <p className="text-sm text-slate-700">
              No tests have been run for this detection yet. Use{" "}
              <span className="font-semibold text-slate-900">
                Launch test for this detection
              </span>{" "}
              above to kick off the first validation.
            </p>
          ) : (
            <div className="space-y-3">
              {/* Compact metrics row */}
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-900">
                <div className="flex items-baseline gap-2">
                  <span className="uppercase tracking-[0.22em] text-slate-700">
                    Total runs
                  </span>
                  <span className="text-base font-semibold text-slate-900">
                    {testsForDetection.length}
                  </span>
                </div>
                {lastTest && (
                  <div className="flex items-center gap-2">
                    <span className="uppercase tracking-[0.22em] text-slate-700">
                      Latest result
                    </span>
                    <Badge className={getResultBadgeClass(lastResult)}>
                      {lastResult}
                    </Badge>
                    <span className="text-slate-900">
                      {formatRelative(new Date(lastTest.started_at), new Date())}
                    </span>
                  </div>
                )}
              </div>

              {/* Full-width scrollable table */}
              <div className="overflow-x-hidden max-h-[19rem] overflow-y-auto hide-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200">
                      <TableHead className="text-[11px] text-slate-700">
                        Started
                      </TableHead>
                      <TableHead className="text-[11px] text-slate-700">
                        Result
                      </TableHead>
                      <TableHead className="text-[11px] text-slate-700">
                        Score
                      </TableHead>
                      <TableHead className="text-[11px] text-slate-700">
                        Environment
                      </TableHead>
                      <TableHead className="text-[11px] text-slate-700">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {testsForDetection.map((t) => (
                      <TableRow
                        key={t.id}
                        className="border-slate-200 hover:bg-slate-50"
                      >
                        <TableCell className="text-slate-700">
                          {formatRelative(new Date(t.started_at), new Date())}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={getResultBadgeClass(t.result || t.status)}
                          >
                            {t.result || t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-700">
                          {typeof t.score === "number" ? t.score : "N/A"}
                        </TableCell>
                        <TableCell className="text-slate-600 uppercase">
                          {t.environment}
                        </TableCell>
                        <TableCell>
                          <Button
                            asChild
                            size="sm"
                            className="min-w-[96px] justify-center bg-transparent text-[11px] text-slate-700 border border-slate-200 hover:bg-slate-50"
                          >
                            <Link href={`/tests/${t.id}`}>
                              View report
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="lifecycle">
          {/* Lifecycle Summary */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base text-slate-900">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 border border-emerald-200">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span>Detection Lifecycle Summary</span>
                </CardTitle>
                <CardDescription className="mt-1 text-slate-600">
                  When this rule was created, last tested, and who owns it today.
                </CardDescription>
              </div>
              {!permissionsLoading && canAssignOwner && (
                <Dialog open={assignOwnerOpen} onOpenChange={setAssignOwnerOpen}>
                  <DialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2"
                    >
                      <UserPlus className="h-4 w-4" />
                      Assign Owner
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-[400px] h-[400px] mx-4 p-6 flex flex-col">
                    <DialogHeader className="text-left flex-shrink-0">
                      <DialogTitle className="text-xl font-display font-semibold text-slate-900 mb-2">Assign Owner</DialogTitle>
                      <DialogDescription className="text-sm text-slate-600 leading-relaxed">
                        Select a user to assign as the owner of this detection.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5 py-4 flex-1 flex flex-col justify-center">
                      <div className="space-y-2.5">
                        <label className="text-sm font-medium text-slate-900">Owner</label>
                        <Select value={selectedOwner} onValueChange={setSelectedOwner}>
                          <SelectTrigger className="bg-white border-slate-200 text-slate-900 h-11 rounded-lg hover:border-indigo-300 focus:ring-2 focus:ring-indigo-200">
                            <SelectValue placeholder="Select a user" />
                          </SelectTrigger>
                          <SelectContent className="bg-white border-slate-200 shadow-lg rounded-lg text-slate-900">
                            <SelectItem value="unassigned" className="text-slate-900">
                              Unassigned
                            </SelectItem>
                            {users
                              .filter((u) => u.is_active)
                              .map((user) => (
                                <SelectItem
                                  key={user.id}
                                  value={user.email}
                                  className="rounded-md text-slate-900"
                                >
                                  {user.email} {user.is_admin && "(Admin)"}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {users.length === 0 && (
                          <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1.5">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading users...
                          </p>
                        )}
                      </div>
                    </div>
                    <DialogFooter className="flex-row justify-end gap-3 mt-auto pt-4 flex-shrink-0">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setAssignOwnerOpen(false);
                          setSelectedOwner(detection?.owner || "unassigned");
                        }}
                        disabled={assigningOwner}
                        className="border-slate-200 text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleAssignOwner}
                        disabled={assigningOwner || !selectedOwner}
                      >
                        {assigningOwner ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Assigning...
                          </>
                        ) : (
                          "Assign Owner"
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-900">
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                {lifecycleStages.map((stage, index) => {
                  const isActiveOrPast = index <= currentStageIndex;
                  const isCurrent = index === currentStageIndex;
                  return (
                    <div key={stage.key} className="flex items-center gap-2">
                      <div
                        className={`h-2.5 w-2.5 rounded-full border ${
                          isActiveOrPast
                            ? "border-emerald-400 bg-emerald-500/60"
                            : "border-slate-600 bg-slate-900"
                        }`}
                      />
                      <span
                        className={`uppercase tracking-[0.22em] ${
                          isCurrent ? "text-emerald-600" : "text-slate-600"
                        }`}
                      >
                        {stage.label}
                      </span>
                      {index < lifecycleStages.length - 1 && (
                        <div
                          className={`mx-2 h-px w-6 ${
                            isActiveOrPast
                              ? "bg-emerald-500/60"
                              : "bg-slate-700"
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Status
                    </div>
                    <div className="mt-1">
                      <Badge className={getStatusBadgeClass(detection.status)}>
                        {detection.status || "UNSET"}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Owner
                    </div>
                    <div className="mt-1 text-slate-900">
                      {detection.owner || "Unassigned"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Created
                    </div>
                    <div className="mt-1 text-slate-900">
                      {formatDate(detection.created_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Last updated
                    </div>
                    <div className="mt-1 text-slate-900">
                      {formatDate(detection.last_updated_at)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Last tested
                    </div>
                    <div className="mt-1 text-slate-900">
                      {formatDate(detection.last_tested_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Last alert fired (PurveX)
                    </div>
                    <div className="mt-1 text-slate-900">
                      {formatDate(detection.last_alert_at)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Last PASS
                    </div>
                    <div className="mt-1 text-slate-900">
                      {formatDate(detection.last_pass_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Last FAIL
                    </div>
                    <div className="mt-1 text-slate-900">
                      {formatDate(detection.last_fail_at)}
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Last reviewed
                    </div>
                    <div className="mt-1 text-slate-900">
                      {formatDate(detection.last_reviewed_at)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.25em] text-slate-600">
                      Notes
                    </div>
                    <p className="mt-1 text-slate-900 text-sm">
                      {detection.notes || "No review notes captured yet."}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                  <Sparkles className="h-3 w-3 text-sky-400" />
                  <span>
                    Rule versioning and full DAC history will appear here in a future release.
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

        </TabsContent>

        <TabsContent value="ownership" className="space-y-4">
          <Card className="relative overflow-hidden border border-slate-200 bg-white text-slate-900 shadow-[0_24px_60px_-46px_rgba(15,23,42,0.22)]">
            <div className="pointer-events-none absolute -top-20 -right-12 h-56 w-56 rounded-full bg-sky-200/30 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-16 h-52 w-52 rounded-full bg-indigo-200/20 blur-3xl" />
            <CardHeader className="relative">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-3 text-base text-slate-900">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-slate-700 border border-slate-200">
                      <Crown className="h-4 w-4" />
                    </span>
                    <span>Asset Ownership Map</span>
                  </CardTitle>
                  <CardDescription className="mt-1 text-sm text-slate-600">
                    Premium ownership context to make gaps instantly actionable.
                  </CardDescription>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] uppercase tracking-[0.35em] text-slate-600">
                  Premium
                </span>
              </div>
            </CardHeader>
            <CardContent className="relative">
              <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">
                      <Users className="h-3.5 w-3.5 text-slate-600" />
                      Runner ownership
                    </div>
                    <p className="mt-2 text-sm text-slate-700">
                      Who owns the endpoint where tests execute?
                    </p>
                    <div className="mt-4 grid gap-3 text-sm text-slate-900">
                      <div>
                        <Label className="text-slate-500">Runner endpoint</Label>
                        <Input
                          placeholder="e.g., lab-runner-01"
                          className="mt-2 border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"
                        />
                      </div>
                      <div>
                        <Label className="text-slate-500">Owning team</Label>
                        <Input
                          placeholder="SOC Platform, SecEng, IT Ops"
                          className="mt-2 border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"
                        />
                      </div>
                      <div>
                        <Label className="text-slate-500">Escalation path (optional)</Label>
                        <Input
                          placeholder="SOC L2 → On-call → Security Eng"
                          className="mt-2 border-slate-200 bg-white text-slate-900 placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-slate-500">
                      Use this to route runner outages or test failures to the correct team.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">
                      <MapPin className="h-3.5 w-3.5 text-sky-500" />
                      Coverage & telemetry
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-800">
                      {["DC-01", "VDI-Cluster", "Identity Core", "Cloud IAM", "Prod Apps"].map((item) => (
                        <span
                          key={item}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-slate-900">
                      {[
                        "SIEM: Splunk (prod-security)",
                        "EDR: CrowdStrike (east)",
                        "Telemetry: Windows Event + Sysmon",
                      ].map((item) => (
                        <div key={item} className="flex items-center justify-between">
                          <span>{item}</span>
                          <span className="text-[11px] text-emerald-600">Live</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 text-xs text-slate-500">
                      Last verified: 2 days ago · SLA: 4h response
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                      Recommended owner actions
                    </div>
                    <div className="mt-3 space-y-3 text-sm text-slate-900">
                      {[
                        "Confirm logs for T1021 coverage in staging.",
                        "Re-run latest tests after patch window.",
                        "Review field mappings for authentication logs.",
                      ].map((item) => (
                        <div key={item} className="flex items-start gap-2">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-sky-500" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </PageContainer>
  );
}
