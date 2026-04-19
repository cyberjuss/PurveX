"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FlaskConical, ServerCog, AlertTriangle, Clock, Activity, Zap, Play, Terminal, Monitor, ChevronDown, ChevronRight, HardDrive, Eye, FileText as LogsIcon, Settings } from "lucide-react";
import { apiFetch, getTest, type TestDetailResponse } from "@/lib/api";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { useToast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type LabRunner = {
  id: number;
  hostname?: string | null;
  os?: string | null;
  ip_address?: string | null;
  status?: string | null;
  last_check_in?: string | null;
  agent_version?: string | null;
  environment_name?: string | null;
  runner_type?: string | null;
  port?: number | null;
  username?: string | null;
};

type LabTestSummary = {
  id: number;
  endpoint?: string | null;
  environment?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  finished_at?: string | null;
  technique_id?: string | null;
  detection_title?: string | null;
  status?: string | null;
};

type LabEndpoint = {
  id: number;
  hostname: string;
  os: string;
  ipAddress: string;
  status: string;
  lastCheckIn: string;
  lastTestRun: string;
  recentTests: LabTestSummary[];
  agentVersion: string;
  tags: string[];
  environment: string;
  runnerType?: string | null;
  port?: number | null;
  username?: string | null;
};

function LabPageContent() {
  const [currentTest, setCurrentTest] = useState<TestDetailResponse | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<LabEndpoint[]>([]);
  const [endpointsLoading, setEndpointsLoading] = useState(false);
  const [endpointsError, setEndpointsError] = useState<string | null>(null);
  const [deleteEndpoint, setDeleteEndpoint] = useState<{ id: number; name: string } | null>(null);
  const [pauseEndpoint, setPauseEndpoint] = useState<{ id: number; name: string } | null>(null);
  const [resumeEndpoint, setResumeEndpoint] = useState<{ id: number; name: string } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const searchParams = useSearchParams();
  const { toast } = useToast();

  useEffect(() => {
    const testIdParam = searchParams.get("testId");
    if (!testIdParam) return;

    let cancelled = false;

    async function pollTest() {
      try {
        setTestError(null);
        const id = Number(testIdParam);
        if (Number.isNaN(id)) return;

        let attempts = 0;
        while (!cancelled && attempts < 60) {
          const test = await getTest(id);
          if (!test) {
            // Test not found - stop polling
            break;
          }
          setCurrentTest(test);
          if (test.status !== "pending" && test.status !== "running") {
            break;
          }
          attempts += 1;
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setTestError(err instanceof Error ? err.message : "Failed to load lab run.");
        }
      }
    }

    pollTest();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);


  const handleDeleteEndpoint = async (endpointId: number) => {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}`, {
        method: "DELETE",
      });
      setEndpoints((prev) => prev.filter((endpoint) => endpoint.id !== endpointId));
    } catch (err) {
      toast({
        type: "error",
        title: "Failed to delete agent",
        description: err instanceof Error ? err.message : "Unable to delete agent.",
      });
    }
  };

  const handlePauseEndpoint = async (endpointId: number) => {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}/pause`, { method: "POST" });
      setEndpoints((prev) =>
        prev.map((endpoint) =>
          endpoint.id === endpointId ? { ...endpoint, status: "pausing" } : endpoint
        )
      );
      toast({
        type: "success",
        title: "Pause requested",
        description: "Agent pause command queued.",
      });
    } catch (err: unknown) {
      toast({
        type: "error",
        title: "Failed to pause agent",
        description: err instanceof Error ? err.message : "Unable to send pause command.",
      });
    }
  };

  const handleResumeEndpoint = async (endpointId: number) => {
    try {
      await apiFetch(`/settings/environment-runners/${endpointId}/resume`, { method: "POST" });
      setEndpoints((prev) =>
        prev.map((endpoint) =>
          endpoint.id === endpointId ? { ...endpoint, status: "resuming" } : endpoint
        )
      );
      toast({
        type: "success",
        title: "Resume requested",
        description: "Agent resume command queued.",
      });
    } catch (err: unknown) {
      toast({
        type: "error",
        title: "Failed to resume agent",
        description: err instanceof Error ? err.message : "Unable to send resume command.",
      });
    }
  };

  // Fetch environment runners/endpoints
  useEffect(() => {
    async function fetchEndpoints() {
      try {
        setEndpointsLoading(true);
        setEndpointsError(null);
        const runners = await apiFetch("/settings/environment-runners", {
          cache: "no-store",
        });
        const tests = await apiFetch("/tests/?limit=100", { cache: "no-store" }).catch(() => []);
        const latestByEndpoint = new Map<string, LabTestSummary>();
        const testsByEndpoint = new Map<string, LabTestSummary[]>();
        const testsByEnvironment = new Map<string, LabTestSummary[]>();
        if (Array.isArray(tests)) {
          tests.forEach((test: LabTestSummary) => {
            if (!test.endpoint) return;
            const existing = latestByEndpoint.get(test.endpoint);
            if (!existing || new Date(test.started_at ?? 0).getTime() > new Date(existing.started_at ?? 0).getTime()) {
              latestByEndpoint.set(test.endpoint, test);
            }
          });
          tests.forEach((test: LabTestSummary) => {
            if (test.endpoint) {
              const existing = testsByEndpoint.get(test.endpoint) || [];
              existing.push(test);
              testsByEndpoint.set(test.endpoint, existing);
            }
            if (test.environment) {
              const existingEnv = testsByEnvironment.get(test.environment) || [];
              existingEnv.push(test);
              testsByEnvironment.set(test.environment, existingEnv);
            }
          });
        }
        // Transform runners to endpoint format using only real data
        if (runners && Array.isArray(runners) && runners.length > 0) {
          const transformedEndpoints = runners.map((runner: LabRunner) => ({
            id: runner.id,
            hostname: runner.hostname || `endpoint-${runner.id}`,
            os: runner.os || "—",
            ipAddress: runner.ip_address || "—",
            status: runner.status || (runner.last_check_in ? "online" : "unknown"),
            lastCheckIn: runner.last_check_in ? new Date(runner.last_check_in).toLocaleString() : "—",
            lastTestRun: (() => {
              const latest = runner.hostname ? latestByEndpoint.get(runner.hostname) : undefined;
              if (!latest) return "—";
              return latest.technique_id || "—";
            })(),
            recentTests: (() => {
              const endpointKey = runner.hostname;
              const envKey = runner.environment_name;
              const source = (endpointKey && testsByEndpoint.get(endpointKey)) || (envKey && testsByEnvironment.get(envKey)) || [];
              return source
                .slice()
                .sort((a: LabTestSummary, b: LabTestSummary) => new Date(b.started_at || b.created_at || b.finished_at || 0).getTime() - new Date(a.started_at || a.created_at || a.finished_at || 0).getTime())
                .slice(0, 3);
            })(),
            agentVersion: runner.agent_version || "—",
            tags: [],
            environment: runner.environment_name || "lab",
            runnerType: runner.runner_type,
            port: runner.port,
            username: runner.username,
          }));
          setEndpoints(transformedEndpoints);
        } else {
          setEndpoints([]);
        }
      } catch (err) {
        setEndpointsError(err instanceof Error ? err.message : "Failed to load registered agents.");
        setEndpoints([]);
      } finally {
        setEndpointsLoading(false);
      }
    }
    fetchEndpoints();
  }, []);

  const labStatus = (currentTest?.status || "pending").toLowerCase();
  let labProgress = 0.2;
  if (labStatus === "running") {
    labProgress = 0.6;
  } else if (labStatus !== "pending") {
    labProgress = 1;
  }

  return (
    <PageContainer maxWidth="full">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
          <div className="w-full pl-0.5 pr-0 sm:pr-0">
            <PageHeader
              eyebrow="Controlled lab"
              title="Lab"
              subtitle="Practice without fear, iterate faster, and build the repetition that becomes real operating strength."
              icon={<FlaskConical className="h-5 w-5" />}
            />
          </div>

          {endpointsError && (
            <Card className="border border-red-200 bg-red-50 shadow-sm">
              <CardContent className="py-4">
                <p className="text-sm font-medium text-red-800">{endpointsError}</p>
                <p className="mt-1 text-xs text-red-700">
                  Agent inventory is unavailable right now. Retry after the API and runner settings endpoints recover.
                </p>
              </CardContent>
            </Card>
          )}


          {/* Agent Registration Scripts - Moved to Test Runner Settings */}

          {/* Endpoints / Agents Table */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-200 px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                    <HardDrive className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-display font-semibold text-slate-900">
                      Endpoints
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-600 mt-1">
                      {endpoints.length} {endpoints.length === 1 ? "endpoint" : "endpoints"} connected
                    </CardDescription>
                  </div>
                </div>
                <Link href="/settings/test-runner">
                  <Button
                    variant="default"
                    size="sm"
                    className="h-10 px-5 rounded-full bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm text-xs font-semibold tracking-wide"
                  >
                    <ServerCog className="h-4 w-4 mr-2" />
                    Install Agent
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="pt-6 pb-6 px-6">
              {endpointsLoading && endpoints.length === 0 ? (
                <LoadingState message="Loading endpoints..." size="sm" className="py-6" />
              ) : endpoints.length === 0 ? (
                <div className="text-center py-10">
                  <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-slate-100 border border-slate-200 mb-3">
                    <HardDrive className="h-6 w-6 text-slate-600" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mb-1">No endpoints registered</p>
                  <p className="text-xs text-slate-600">Use Install Agent to connect your first endpoint.</p>
                </div>
              ) : (
                <div className="overflow-x-auto -mx-2">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="text-left py-3 px-3 w-8"></th>
                        <th className="text-left py-3 px-3 min-w-[140px] font-semibold uppercase tracking-wider">Hostname</th>
                        <th className="text-left py-3 px-3 min-w-[110px] font-semibold uppercase tracking-wider">OS</th>
                        <th className="text-left py-3 px-3 min-w-[120px] font-semibold uppercase tracking-wider">IP</th>
                        <th className="text-left py-3 px-3 min-w-[110px] font-semibold uppercase tracking-wider">Status</th>
                        <th className="text-left py-3 px-3 min-w-[110px] font-semibold uppercase tracking-wider">Check-in</th>
                        <th className="text-left py-3 px-3 min-w-[150px] font-semibold uppercase tracking-wider">Last Test</th>
                        <th className="text-left py-3 px-3 min-w-[110px] font-semibold uppercase tracking-wider">Version</th>
                        <th className="text-left py-3 px-3 min-w-[120px] font-semibold uppercase tracking-wider">Tags</th>
                        <th className="text-right py-3 px-3 min-w-[120px] font-semibold uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                      {endpoints.map((endpoint) => (
                        <React.Fragment key={`endpoint-${endpoint.id}`}>
                          <tr
                            className="hover:bg-slate-50 transition-colors cursor-pointer group focus-within:bg-slate-50"
                            onClick={() => {
                              const newExpanded = new Set(expandedRows);
                              if (newExpanded.has(endpoint.id)) {
                                newExpanded.delete(endpoint.id);
                              } else {
                                newExpanded.add(endpoint.id);
                              }
                              setExpandedRows(newExpanded);
                            }}
                            role="button"
                            tabIndex={0}
                            aria-expanded={expandedRows.has(endpoint.id)}
                            aria-label={`${expandedRows.has(endpoint.id) ? "Collapse" : "Expand"} details for ${endpoint.hostname}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                const newExpanded = new Set(expandedRows);
                                if (newExpanded.has(endpoint.id)) {
                                  newExpanded.delete(endpoint.id);
                                } else {
                                  newExpanded.add(endpoint.id);
                                }
                                setExpandedRows(newExpanded);
                              }
                            }}
                          >
                            <td className="py-3 px-3">
                              {expandedRows.has(endpoint.id) ? (
                                <ChevronDown className="h-4 w-4 text-slate-500" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-slate-500" />
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                <HardDrive className="h-4 w-4 text-slate-500 flex-shrink-0" />
                                <span className="font-medium text-slate-900 truncate">{endpoint.hostname}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2">
                                {endpoint.os.includes("Windows") ? (
                                  <Monitor className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                ) : (
                                  <Terminal className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                                )}
                                <span className="text-slate-900 truncate">{endpoint.os}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <code className="text-xs font-mono text-slate-900">{endpoint.ipAddress}</code>
                            </td>
                            <td className="py-3 px-3">
                              <Badge
                                className={cn(
                                  endpoint.status === "online" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                                  endpoint.status === "degraded" && "bg-amber-50 text-amber-700 border-amber-200",
                                  endpoint.status === "idle" && "bg-blue-50 text-blue-700 border-blue-200",
                                  endpoint.status === "stopping" && "bg-amber-50 text-amber-700 border-amber-200",
                                  endpoint.status === "stopped" && "bg-slate-100 text-slate-700 border-slate-200",
                                  endpoint.status === "paused" && "bg-slate-100 text-slate-700 border-slate-200",
                                  endpoint.status === "pausing" && "bg-amber-50 text-amber-700 border-amber-200",
                                  endpoint.status === "resuming" && "bg-blue-50 text-blue-700 border-blue-200",
                                  endpoint.status === "unknown" && "bg-slate-100 text-slate-600 border-slate-200",
                                  "inline-flex items-center gap-2 border text-xs px-2.5 py-1 rounded-full"
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    endpoint.status === "online" && "bg-emerald-500",
                                    endpoint.status === "degraded" && "bg-amber-500",
                                    endpoint.status === "idle" && "bg-blue-500",
                                    endpoint.status === "stopping" && "bg-amber-500",
                                    endpoint.status === "stopped" && "bg-slate-500",
                                    endpoint.status === "paused" && "bg-slate-500",
                                    endpoint.status === "pausing" && "bg-amber-500",
                                    endpoint.status === "resuming" && "bg-blue-500",
                                    endpoint.status === "unknown" && "bg-slate-400",
                                    endpoint.status !== "online" &&
                                      endpoint.status !== "degraded" &&
                                      endpoint.status !== "idle" &&
                                      endpoint.status !== "stopping" &&
                                      endpoint.status !== "stopped" &&
                                      endpoint.status !== "paused" &&
                                      endpoint.status !== "pausing" &&
                                      endpoint.status !== "resuming" &&
                                      "bg-slate-400"
                                  )}
                                />
                                <span className="font-semibold capitalize">{endpoint.status === "unknown" ? "Unknown" : endpoint.status}</span>
                              </Badge>
                            </td>
                            <td className="py-3 px-3">
                              <span className="text-slate-900">{endpoint.lastCheckIn || "—"}</span>
                            </td>
                            <td className="py-3 px-3">
                              <span className="text-slate-900 truncate block">{endpoint.lastTestRun || "—"}</span>
                            </td>
                            <td className="py-3 px-3">
                              <Badge className="bg-slate-100 text-slate-800 border border-slate-200 text-xs px-2.5 py-1 rounded-full font-semibold">
                                {endpoint.agentVersion || "—"}
                              </Badge>
                            </td>
                            <td className="py-3 px-3">
                              <div className="flex items-center gap-2 flex-wrap">
                                {endpoint.tags.slice(0, 2).map((tag: string, idx: number) => (
                                  <Badge
                                    key={idx}
                                    className="bg-sky-50 text-sky-700 border border-sky-200 text-xs px-2.5 py-1 rounded-full font-semibold"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                                {endpoint.tags.length > 2 && (
                                  <span className="text-xs text-slate-500 font-semibold">+{endpoint.tags.length - 2}</span>
                                )}
                                {endpoint.tags.length === 0 && (
                                  <span className="text-xs text-slate-500 font-semibold">—</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right">
                              <div className="flex items-center justify-end gap-2">
                                {endpoint.status === "paused" || endpoint.status === "pausing" || endpoint.status === "stopped" ? (
                                  <button
                                    type="button"
                                    aria-label={`Resume ${endpoint.hostname}`}
                                    title={endpoint.status === "stopped" ? "Start agent" : "Resume agent"}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setResumeEndpoint({ id: endpoint.id, name: endpoint.hostname });
                                    }}
                                    className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-colors"
                                  >
                                    ▶
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    aria-label={`Pause ${endpoint.hostname}`}
                                    title="Pause agent"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPauseEndpoint({ id: endpoint.id, name: endpoint.hostname });
                                    }}
                                    className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-slate-800 hover:border-slate-300 hover:bg-slate-100 transition-colors"
                                  >
                                    ❚❚
                                  </button>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Remove ${endpoint.hostname}`}
                                  title="Remove endpoint"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteEndpoint({ id: endpoint.id, name: endpoint.hostname });
                                }}
                                className="h-8 w-8 inline-flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
                              >
                                ×
                              </button>
                              </div>
                            </td>
                          </tr>
                          {expandedRows.has(endpoint.id) && (
                            <tr className="bg-slate-50 animate-in fade-in slide-in-from-top-2 duration-300">
                              <td colSpan={10} className="py-4 px-4">
                                <div className="grid md:grid-cols-2 gap-5">
                                  {/* Telemetry Health */}
                                  <div className="p-4 rounded-lg bg-white border border-slate-200">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                                      <Activity className="h-4 w-4 text-emerald-600" />
                                      <h4 className="text-sm font-semibold text-slate-900">Telemetry Health</h4>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">SIEM Connectivity</span>
                                        <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs px-2 py-1 h-5">
                                          —
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Event Collection</span>
                                        <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs px-2 py-1 h-5">
                                          —
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Last Event</span>
                                        <span className="text-xs text-slate-900 font-mono">—</span>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Detection Visibility */}
                                  <div className="p-4 rounded-lg bg-white border border-slate-200">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                                      <Eye className="h-4 w-4 text-sky-600" />
                                      <h4 className="text-sm font-semibold text-slate-900">Detection Visibility</h4>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Detections Active</span>
                                        <span className="text-xs text-slate-900 font-semibold">—</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Last Detection</span>
                                        <span className="text-xs text-slate-900 font-mono">—</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Coverage Score</span>
                                        <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs px-2 py-1 h-5">
                                          —
                                        </Badge>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Test Run Logs */}
                                  <div className="p-4 rounded-lg bg-white border border-slate-200">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                                      <LogsIcon className="h-4 w-4 text-blue-600" />
                                      <h4 className="text-sm font-semibold text-slate-900">Recent Test Runs</h4>
                                    </div>
                                    <div className="space-y-2">
                                      {(endpoint.recentTests || []).length === 0 ? (
                                        <div className="p-2 rounded bg-slate-50 border border-slate-200">
                                          <div className="flex items-center justify-between mb-1.5">
                                            <span className="text-xs font-medium text-slate-900 truncate">No recent test data</span>
                                            <Badge className="bg-slate-100 text-slate-600 border-slate-200 text-xs px-2 py-1 h-5">
                                              —
                                            </Badge>
                                          </div>
                                          <p className="text-[10px] text-slate-600">—</p>
                                        </div>
                                      ) : (
                                        (endpoint.recentTests || []).map((test: LabTestSummary) => (
                                          <div key={test.id} className="p-2 rounded bg-slate-50 border border-slate-200">
                                            <div className="flex items-center justify-between mb-1.5">
                                              <span className="text-xs font-medium text-slate-900 truncate">
                                                {test.detection_title || test.technique_id || `Test #${test.id}`}
                                              </span>
                                              <Badge className={cn(
                                                "text-xs px-2 py-1 h-5 border",
                                                test.status === "PASS" && "bg-emerald-100 text-emerald-700 border-emerald-200",
                                                test.status === "FAIL" && "bg-red-100 text-red-700 border-red-200",
                                                test.status === "INCONCLUSIVE" && "bg-amber-100 text-amber-700 border-amber-200",
                                                !test.status && "bg-slate-100 text-slate-600 border-slate-200"
                                              )}>
                                                {test.status || "—"}
                                              </Badge>
                                            </div>
                                            <p className="text-[10px] text-slate-600">
                                              {test.started_at ? new Date(test.started_at).toLocaleString() : "—"}
                                            </p>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                  </div>

                                  {/* Configuration & Drift */}
                                  <div className="p-4 rounded-lg bg-white border border-slate-200">
                                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
                                      <Settings className="h-4 w-4 text-purple-600" />
                                      <h4 className="text-sm font-semibold text-slate-900">Configuration</h4>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Environment</span>
                                        <Badge className="bg-purple-100 text-purple-700 border-purple-300 text-xs px-2 py-1 h-5">
                                          {endpoint.environment || "—"}
                                        </Badge>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Runner Type</span>
                                        <span className="text-xs text-slate-900 font-mono">{endpoint.runnerType || "—"}</span>
                                      </div>
                                      <div className="flex items-center justify-between py-1.5">
                                        <span className="text-xs text-slate-600">Drift Status</span>
                                        <span className="text-xs text-slate-600">—</span>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Agent onboarding is canonical in /settings/test-runner */}

          <Dialog open={!!deleteEndpoint} onOpenChange={(open) => !open && setDeleteEndpoint(null)}>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold text-slate-900">
                  Remove endpoint
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-600 mt-2">
                  This will remove <span className="font-semibold text-slate-900">{deleteEndpoint?.name}</span> from your lab. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setDeleteEndpoint(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!deleteEndpoint) return;
                    handleDeleteEndpoint(deleteEndpoint.id);
                    setDeleteEndpoint(null);
                  }}
                >
                  Remove
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!pauseEndpoint} onOpenChange={(open) => !open && setPauseEndpoint(null)}>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold text-slate-900">
                  Pause agent
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-600 mt-2">
                  This will pause <span className="font-semibold text-slate-900">{pauseEndpoint?.name}</span>. The agent will stop running new tests until resumed.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setPauseEndpoint(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!pauseEndpoint) return;
                    handlePauseEndpoint(pauseEndpoint.id);
                    setPauseEndpoint(null);
                  }}
                >
                  Pause Agent
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={!!resumeEndpoint} onOpenChange={(open) => !open && setResumeEndpoint(null)}>
            <DialogContent className="sm:max-w-[420px]">
              <DialogHeader>
                <DialogTitle className="text-lg font-semibold text-slate-900">
                  Resume agent
                </DialogTitle>
                <DialogDescription className="text-sm text-slate-600 mt-2">
                  This will resume <span className="font-semibold text-slate-900">{resumeEndpoint?.name}</span> and allow tests to run again.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setResumeEndpoint(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (!resumeEndpoint) return;
                    handleResumeEndpoint(resumeEndpoint.id);
                    setResumeEndpoint(null);
                  }}
                >
                  Resume Agent
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {currentTest && (
            <Card className="transition-all duration-300 hover:border-slate-600/50">
              <CardHeader className="border-b border-slate-200 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg font-display font-bold text-white flex items-center gap-2">
                      <Play className="h-4 w-4 text-sky-400" />
                      Lab Run #{currentTest.id}
                    </CardTitle>
                    <CardDescription className="mt-1 text-xs text-slate-400">
                      View-only status of this lab execution and SIEM validation
                    </CardDescription>
                  </div>
                  <Badge className={cn(
                    currentTest.status === "completed" && "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
                    currentTest.status === "running" && "bg-sky-500/20 text-sky-300 border-sky-500/40",
                    currentTest.status === "error" && "bg-red-500/20 text-red-300 border-red-500/40",
                    "bg-slate-500/20 text-slate-300 border-slate-500/40 transition-all duration-300 hover:scale-105"
                  )}>
                    {currentTest.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4 text-xs font-body text-slate-700">
                {/* Timeline / progress strip */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-display font-semibold uppercase tracking-wider text-slate-400">Execution timeline</span>
                    <span className="text-[10px] font-body text-slate-300">
                      {labStatus === "pending" && "Queued in lab…"}
                      {labStatus === "running" && "Running atomic test in lab…"}
                      {labStatus !== "pending" && labStatus !== "running" && "Run completed."}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden border border-slate-200 transition-all duration-300">
                    <div
                      className="h-full bg-gradient-to-r from-sky-400 via-emerald-400 to-sky-500 transition-all duration-700 ease-out"
                      style={{ width: `${Math.round(labProgress * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] font-body text-slate-500">
                    <span>Queued</span>
                    <span>Executing</span>
                    <span>SIEM validation</span>
                    <span>Completed</span>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-1">
                    <p className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500">
                      Status
                    </p>
                    <p className="text-base font-display font-bold text-white">{currentTest.status}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500">
                      Environment
                    </p>
                    <p className="text-base font-display font-bold text-white">
                      {currentTest.environment
                        ? (currentTest.environment === "lab"
                          ? "Lab (PurveX)"
                          : currentTest.environment.toUpperCase())
                        : "UNKNOWN"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500">
                      Result
                    </p>
                    <p className="text-base font-display font-bold text-white">
                      {currentTest.result ?? "Pending"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="space-y-2">
                        <div className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                          <Activity className="h-3.5 w-3.5" />
                          Telemetry
                        </div>
                        <p className="text-sm font-body text-slate-700">
                          Logs present:{" "}
                          <span className="font-display font-semibold text-white">
                            {(() => {
                              try {
                                const raw = currentTest.artifact?.siem_sample_events || "[]";
                                const parsed = JSON.parse(raw);
                                return Array.isArray(parsed) ? (parsed.length > 0 ? "Yes" : "No") : "Yes";
                              } catch {
                                return "Unknown";
                              }
                            })()}
                          </span>
                        </p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4">
                      <div className="space-y-2">
                        <div className="text-xs font-display font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                          <Zap className="h-3.5 w-3.5" />
                          Detection
                        </div>
                        <p className="text-sm font-body text-slate-700">
                          Linked detection:{" "}
                          <span className="font-display font-semibold text-white">
                            {currentTest.detection?.title ?? "None (telemetry-only run)"}
                          </span>
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {testError && (
                  <div className="flex items-start gap-2 rounded-lg border-2 border-amber-500/40 bg-amber-500/5 px-3 py-2">
                    <AlertTriangle className="h-4 w-4 text-amber-300 mt-0.5" />
                    <p className="text-xs font-body text-amber-300">{testError}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </PageContainer>
  );
}

export default function LabPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LabPageContent />
    </Suspense>
  );
}
