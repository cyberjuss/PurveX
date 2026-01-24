"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, type ReactNode, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getDetections,
  runTest as runTestApi,
  Detection,
  TestRunMode,
  getTest,
  TestDetailResponse,
  createTestSchedule,
  type TestScheduleType,
  getMitreTechniques,
  type MitreTechnique,
  getAtomicTests,
  getEnvironmentRunners,
} from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import {
  Clock3,
  Loader2,
  Play,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Slash,
  Circle,
  CircleDot,
  ShieldCheck,
  Info,
  Target,
  Search,
  Waves,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  Server,
  Settings,
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";

type UiTestType = "detection_validation" | "find_detection_coverage" | "telemetry_check";

type HighLevelResultType = "PASS" | "FAIL_RULE_VISIBILITY" | "NO_LOGS" | "SYSTEM_ERROR";

interface RunTestResult {
  result_type: HighLevelResultType;
  message: string;
  telemetry_summary: {
    has_logs: boolean;
    events_found: number;
  };
  detection_summary?: {
    rule_fired: boolean;
    alerts_found: number;
  };
  run_id: number;
}

type ExecutionStatus = "running" | "completed" | "failed" | "partial";

type ExecutionLogStatus = "running" | "success" | "warning" | "error";

type ExecutionLogEntry = {
  id: string;
  timestamp: string;
  step: string;
  status: ExecutionLogStatus;
};

type ExecutionState = {
  id: string;
  status: ExecutionStatus;
  started_at: string;
  completed_at?: string;
  atomic_command: string;
  technique_id: string;
  environment: string;
  missing_signal?: string;
  logs: ExecutionLogEntry[];
};

type RunCallbacks = {
  onStart?: (created: TestDetailResponse) => void;
  onStatus?: (status: ExecutionStatus, completedAt?: string, missingSignal?: string) => void;
  onLog?: (entry: ExecutionLogEntry) => void;
  onComplete?: (final: TestDetailResponse) => void;
};

const uiToBackendMode: Record<UiTestType, TestRunMode> = {
  detection_validation: "DETECTION_VALIDATION",
  find_detection_coverage: "ALERT_CHECK",
  telemetry_check: "TELEMETRY_CHECK",
};

function parseSampleEvents(artifact?: { siem_sample_events?: string }): unknown[] {
  if (!artifact?.siem_sample_events) return [];
  try {
    const parsed = JSON.parse(artifact.siem_sample_events);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function buildHighLevelResult(test: TestDetailResponse): RunTestResult {
  const sampleEvents = parseSampleEvents(test.artifact);
  const hasLogs = sampleEvents.length > 0;
  const hasDetection = !!test.detection;

  let result_type: HighLevelResultType = "SYSTEM_ERROR";
  let message =
    "PurveX could not evaluate this test run due to a system or SIEM error. Check connections and try again.";

  if (test.status === "error") {
    result_type = "SYSTEM_ERROR";
  } else if (!hasLogs) {
    result_type = "NO_LOGS";
    message =
      "We could not find any of the expected events from this test. This points to a telemetry or ingestion issue.";
  } else if (hasDetection && (test.result || "").toUpperCase() === "PASS") {
    result_type = "PASS";
    message = "Logs were ingested and the linked detection rule fired as expected.";
  } else if (hasDetection && (test.result || "").toUpperCase() === "FAIL") {
    result_type = "FAIL_RULE_VISIBILITY";
    message = "Logs were ingested, but the detection rule did not fire. Check deployment, scope, and status.";
  } else if (!hasDetection && hasLogs) {
    // Telemetry‑only run – we saw logs, but no specific rule was evaluated.
    result_type = "PASS";
    message = "Logs were ingested for this scenario. No specific detection rule was evaluated for this run.";
  }

  return {
    result_type,
    message,
    telemetry_summary: {
      has_logs: hasLogs,
      events_found: sampleEvents.length,
    },
    detection_summary: hasDetection
      ? {
          rule_fired: (test.result || "").toUpperCase() === "PASS",
          alerts_found: 0,
        }
      : undefined,
    run_id: test.id,
  };
}

const EXEC_STATUS_META: Record<
  ExecutionStatus,
  { label: string; tone: string; text: string; icon: ReactNode; pulse?: boolean }
> = {
  running: {
    label: "Running",
    tone: "bg-sky-50 text-sky-800 ring-1 ring-sky-100",
    text: "Execution in progress",
    icon: <Loader2 className="h-4 w-4 animate-spin text-sky-600" />,
    pulse: true,
  },
  completed: {
    label: "Completed",
    tone: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100",
    text: "Execution finished successfully",
    icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  },
  failed: {
    label: "Failed",
    tone: "bg-rose-50 text-rose-800 ring-1 ring-rose-100",
    text: "Execution failed",
    icon: <XCircle className="h-4 w-4 text-rose-600" />,
  },
  partial: {
    label: "Partial Telemetry",
    tone: "bg-amber-50 text-amber-800 ring-1 ring-amber-100",
    text: "Execution finished with incomplete telemetry",
    icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
  },
};

function LogStatusIcon({ status }: { status: ExecutionLogStatus }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-rose-500" />;
  return <Loader2 className="h-4 w-4 text-sky-500 animate-spin" />;
}

function useRunTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

    const run = useCallback(
    async (
      params: {
        detectionId?: string | null;
        techniqueId?: string | null;
        environment: "lab" | "dev" | "prod";
        mode: TestRunMode;
      },
      callbacks?: RunCallbacks
    ) => {
      setIsRunning(true);
      setError(null);
      setResult(null);
      callbacks?.onStatus?.("running");
      try {
        const created = await runTestApi({
          detectionId: params.detectionId,
          techniqueId: params.techniqueId ?? null,
          environment: params.environment,
          mode: params.mode,
        });

        callbacks?.onStart?.(created);
        callbacks?.onLog?.({
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          timestamp: new Date().toISOString(),
          step: "Execution started",
          status: "running",
        });

        let attempts = 0;
        let final: TestDetailResponse | null = null;
        const maxAttempts = 30;
        const pollInterval = 2000; // 2 seconds
        
        while (attempts < maxAttempts) {
          try {
            const current = await getTest(created.id);
            if (!current) {
              // Test not found - stop polling
              break;
            }
            if (current.status !== "pending" && current.status !== "running") {
              final = current;
              break;
            }
            callbacks?.onLog?.({
              id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${attempts}`,
              timestamp: new Date().toISOString(),
              step: "Waiting for telemetry and rule results",
              status: "running",
            });
          } catch (pollError: any) {
            console.warn(`Poll attempt ${attempts + 1} failed:`, pollError);
            callbacks?.onLog?.({
              id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-err-${attempts}`,
              timestamp: new Date().toISOString(),
              step: "Temporary polling error; retrying",
              status: "warning",
            });
            if (attempts === maxAttempts - 1) {
              break;
            }
          }
          
          attempts += 1;
          /* eslint-disable no-await-in-loop */
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
          /* eslint-enable no-await-in-loop */
        }

        if (final) {
          const highLevel = buildHighLevelResult(final);
          setResult(highLevel);
          callbacks?.onComplete?.(final);

          const missingSignal =
            final.telemetry_summary && final.telemetry_summary.has_logs === false
              ? "Telemetry logs not found"
              : undefined;
          const resolvedStatus: ExecutionStatus =
            missingSignal ? "partial" : final.status === "failed" ? "failed" : "completed";
          callbacks?.onStatus?.(resolvedStatus, final.finished_at || new Date().toISOString(), missingSignal);
          callbacks?.onLog?.({
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-done`,
            timestamp: new Date().toISOString(),
            step:
              resolvedStatus === "completed"
                ? "Execution finished"
                : resolvedStatus === "partial"
                ? "Execution finished with partial telemetry"
                : "Execution failed",
            status: resolvedStatus === "failed" ? "error" : resolvedStatus === "partial" ? "warning" : "success",
          });

          if (typeof window !== "undefined") {
            const raw = window.localStorage.getItem("purvex_unread_test_notification") || "0";
            const current = Number.isNaN(Number(raw)) ? 0 : parseInt(raw, 10);
            const next = Math.max(0, current) + 1;
            window.localStorage.setItem("purvex_unread_test_notification", String(next));
            window.dispatchEvent(new Event("purvex:test-notification"));
          }
        } else {
          setError("The test is still running in the background. Check the Tests page for full details.");
          callbacks?.onStatus?.("partial", new Date().toISOString(), "Final status not returned yet");
        }
      } catch (err: any) {
        setError(err.message || "Failed to run test.");
        callbacks?.onStatus?.("failed", new Date().toISOString());
      } finally {
        setIsRunning(false);
      }
    },
    []
  );

  return { run, isRunning, result, error, setResult };
}

function LiveExecutionPanel({
  execution,
  logsExpanded,
  onToggleLogs,
  isRunning,
}: {
  execution: ExecutionState;
  logsExpanded: boolean;
  onToggleLogs: () => void;
  isRunning: boolean;
}) {
  const meta = EXEC_STATUS_META[execution.status];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
              meta.tone,
              meta.pulse ? "animate-pulse" : ""
            )}
          >
            {meta.icon}
            {meta.label}
          </span>
          <span className="text-xs text-slate-600">{meta.text}</span>
          {execution.status === "partial" && execution.missing_signal && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              {execution.missing_signal}
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 text-right">
          <div>Started: {execution.started_at}</div>
          {execution.completed_at && <div>Finished: {execution.completed_at}</div>}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Execution ID</div>
          <div className="text-sm font-mono text-slate-900 break-all">{execution.id}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Technique</div>
          <div className="text-sm font-semibold text-slate-900">{execution.technique_id}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Environment</div>
          <div className="text-sm font-semibold text-slate-900">{execution.environment}</div>
        </div>
        <div className="md:col-span-2 lg:col-span-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Atomic command</div>
          <div className="text-sm font-mono text-slate-900 whitespace-pre-wrap break-words">
            {execution.atomic_command}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">Execution log</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={onToggleLogs}
          >
            {logsExpanded ? "Hide execution details" : "View execution details"}
          </Button>
        </div>
        {logsExpanded && (
          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50">
            {execution.logs.length === 0 && (
              <div className="px-3 py-2 text-xs text-slate-500">Waiting for execution events...</div>
            )}
            {execution.logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 border-b border-slate-200 last:border-0 px-3 py-2 text-xs font-mono text-slate-800"
              >
                <div className="text-slate-500 whitespace-nowrap">{log.timestamp}</div>
                <div className="flex items-center gap-2">
                  <LogStatusIcon status={log.status} />
                  <span className="text-slate-900">{log.step}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {!logsExpanded && isRunning && (
          <div className="mt-2 text-xs text-slate-600">Live updates are streaming. Expand to view details.</div>
        )}
      </div>
    </div>
  );
}

function RunTestPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedDetectionId = searchParams.get("detectionId");
  const focus = searchParams.get("focus");
  const techniqueFromExplore = searchParams.get("technique_id");
  const atomicNameFromExplore = searchParams.get("atomic_name");
  const desiredStepRaw = searchParams.get("step");

  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedDetection, setSelectedDetection] = useState<string>("");
  const [selectedScenario, setSelectedScenario] = useState<string>("");
  const [environment, setEnvironment] = useState<"lab" | "dev" | "prod">("lab");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testType, setTestType] = useState<UiTestType | null>(null);
  const [targetHost, setTargetHost] = useState<string>("");
  const [runnerTargets, setRunnerTargets] = useState<string[]>([]);
  const [detectionSearch, setDetectionSearch] = useState<string>("");
  const [lastRunType, setLastRunType] = useState<UiTestType | null>(null);
  const [labOs, setLabOs] = useState<"windows" | "linux" | "both">("windows");
  const [runMode, setRunMode] = useState<"now" | "schedule">("now");
  const [scheduleType, setScheduleType] = useState<TestScheduleType>("once");
  const [scheduleTime, setScheduleTime] = useState<string>("");
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState<string>("60");
  const [isScheduling, setIsScheduling] = useState(false);
  const [mitreTechniques, setMitreTechniques] = useState<MitreTechnique[]>([]);
  const [coverageScenarioConfirmed, setCoverageScenarioConfirmed] = useState<boolean>(false);
  const [loadingMitre, setLoadingMitre] = useState(false);
  const [selectedSubtechniqueId, setSelectedSubtechniqueId] = useState<string>("");
  const [currentStep, setCurrentStep] = useState<number>(1); // Step navigation state
  const [execution, setExecution] = useState<ExecutionState | null>(null);
  const [logsExpanded, setLogsExpanded] = useState<boolean>(false);
  const [atomicScenarioHint, setAtomicScenarioHint] = useState<{ name: string; description?: string } | null>(null);

  const { run: runTest, isRunning, result, error: runError, setResult } = useRunTest();
  const { hasPermission, canRunTest, canScheduleTest, loading: permissionsLoading } = usePermissions();
  const addExecutionLog = useCallback((entry: ExecutionLogEntry) => {
    setExecution((prev) => {
      if (!prev) return prev;
      return { ...prev, logs: [entry, ...(prev.logs || [])] };
    });
  }, []);

  const updateExecutionStatus = useCallback(
    (status: ExecutionStatus, completedAt?: string, missingSignal?: string) => {
      setExecution((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status,
          completed_at: completedAt || prev.completed_at,
          missing_signal: missingSignal || prev.missing_signal,
        };
      });
    },
    []
  );

  // If we arrive from Explore with a technique in focus, default to coverage mode (Find mode).
  useEffect(() => {
    if (techniqueFromExplore && !preselectedDetectionId) {
      setTestType("find_detection_coverage");
      setCurrentStep(2); // Auto-advance to step 2 (technique selection)
    }
  }, [techniqueFromExplore, preselectedDetectionId]);

  useEffect(() => {
    async function loadDetections() {
      try {
        setLoading(true);
        const data = await getDetections();
        setDetections(data);

        if (preselectedDetectionId) {
          setSelectedDetection(preselectedDetectionId);
          if (!testType) {
            setTestType("detection_validation");
            setCurrentStep(2); // Show step 2 when coming from detection page
          }
        }
      } catch (err: any) {
        setError(err.message || "Failed to load detections.");
      } finally {
        setLoading(false);
      }
    }
    loadDetections();
  }, [preselectedDetectionId, focus, techniqueFromExplore, testType]);

  useEffect(() => {
    if (!techniqueFromExplore || atomicNameFromExplore) {
      setAtomicScenarioHint(null);
      return;
    }

    let cancelled = false;

    async function loadAtomicScenarioHint() {
      try {
        const baseTechniqueId = techniqueFromExplore.split(".")[0];
        const response = await getAtomicTests({ technique_id: baseTechniqueId, limit: 1 });
        if (cancelled) return;
        const first = response.items?.[0];
        if (first) {
          setAtomicScenarioHint({
            name: first.name,
            description: first.description,
          });
        } else {
          setAtomicScenarioHint(null);
        }
      } catch {
        if (!cancelled) {
          setAtomicScenarioHint(null);
        }
      }
    }

    loadAtomicScenarioHint();
    return () => {
      cancelled = true;
    };
  }, [techniqueFromExplore, atomicNameFromExplore]);

  // Always start on step 1, even if URL params are present
  // But if we have a technique_id, we should be on step 2 with Find mode
  useEffect(() => {
    // Reset to step 1 on mount or when test type is cleared
    // But don't reset if we're coming from a technique (Find mode)
    if (!testType && !techniqueFromExplore) {
      setCurrentStep(1);
    }
  }, [testType, techniqueFromExplore]);

  // Reset coverage confirmation when mode/selection changes
  useEffect(() => {
    if (testType !== "find_detection_coverage") {
      setCoverageScenarioConfirmed(false);
    } else if (!techniqueFromExplore && !selectedDetection) {
      setCoverageScenarioConfirmed(false);
    }
  }, [testType, techniqueFromExplore, selectedDetection]);

  // Auto-confirm if a detection is explicitly selected in coverage mode
  useEffect(() => {
    if (testType === "find_detection_coverage" && selectedDetection) {
      setCoverageScenarioConfirmed(true);
    }
  }, [testType, selectedDetection]);

  // Auto-confirm coverage when coming from Atomic Explore with a chosen test.
  useEffect(() => {
    if (testType === "find_detection_coverage" && techniqueFromExplore && atomicNameFromExplore) {
      setCoverageScenarioConfirmed(true);
    }
  }, [testType, techniqueFromExplore, atomicNameFromExplore]);

  // Load MITRE techniques lazily when needed for validation mode or explore coverage
  useEffect(() => {
    async function loadMitre() {
      if (mitreTechniques.length > 0) return;
      try {
        setLoadingMitre(true);
        const data = await getMitreTechniques();
        setMitreTechniques(data);
      } catch (err) {
        console.error("Failed to load MITRE techniques for subtechnique picker:", err);
      } finally {
        setLoadingMitre(false);
      }
    }

    if ((testType === "detection_validation" && selectedDetection) || techniqueFromExplore) {
      loadMitre();
    }
  }, [testType, selectedDetection, mitreTechniques.length]);

  useEffect(() => {
    let cancelled = false;
    async function loadRunners() {
      try {
        const runners = await getEnvironmentRunners();
        if (cancelled) return;
        if (Array.isArray(runners)) {
          const hosts = runners
            .map((runner: any) => runner.hostname)
            .filter((hostname: any) => typeof hostname === "string" && hostname.trim().length > 0);
          setRunnerTargets(Array.from(new Set(hosts)));
        }
      } catch {
        // Ignore runner load errors for now.
      }
    }
    loadRunners();
    return () => {
      cancelled = true;
    };
  }, []);

  // Whenever the high-level run hook reports an error, surface it in the main banner.
  useEffect(() => {
    if (runError) {
      setError(runError);
    }
  }, [runError]);

  async function handleRunTest() {
    if (!testType) {
      setError("Choose what you want to test first.");
      return;
    }

    let detectionIdToUse: string | null = null;
    let techniqueIdToUse: string | null = null;

    if (testType === "telemetry_check") {
      detectionIdToUse = selectedScenario || null;
    } else if (testType === "detection_validation") {
      detectionIdToUse = selectedDetection || null;
      // Optional: if a specific subtechnique is selected, use it for the run
      if (selectedSubtechniqueId) {
        techniqueIdToUse = selectedSubtechniqueId;
      }
    } else if (testType === "find_detection_coverage") {
      detectionIdToUse = selectedDetection || null;
      techniqueIdToUse = techniqueFromExplore || null;
    }

    if (!detectionIdToUse && !techniqueIdToUse) {
      if (testType === "telemetry_check") {
        setError("Please select a test scenario for your telemetry check.");
      } else if (testType === "detection_validation") {
        setError("Please select a detection to run.");
      } else {
        setError(
          "Select a detection or arrive from Explore with a technique in focus before running coverage.",
        );
      }
      return;
    }
    if (!targetHost.trim()) {
      setError("Enter the host you plan to run this scenario on.");
      return;
    }
    if (!environment) {
      setError("Select an environment for this run.");
      return;
    }

    setLastRunType(testType);

    // If the user chooses "schedule", create a schedule instead of running immediately.
    if (runMode === "schedule") {
      try {
        setIsScheduling(true);
        setError(null);

        const mode = uiToBackendMode[testType];

        if (scheduleType === "once") {
          if (!scheduleTime) {
            setError("Choose a date and time for the scheduled run.");
            return;
          }
        } else if (scheduleType === "interval") {
          const minutes = parseInt(scheduleIntervalMinutes, 10);
          if (!minutes || minutes <= 0) {
            setError("Enter a valid interval in minutes for the schedule.");
            return;
          }
        }

        await createTestSchedule({
          detectionId: detectionIdToUse,
          techniqueId: techniqueIdToUse,
          environment,
          mode,
          scheduleType,
          runAt: scheduleType === "once" ? scheduleTime : null,
          intervalMinutes:
            scheduleType === "interval" ? parseInt(scheduleIntervalMinutes, 10) : null,
          cronExpression: null,
        });

        setResult(null);
      } catch (err: any) {
        setError(err.message || "Failed to create schedule.");
      } finally {
        setIsScheduling(false);
      }
      return;
    }

    // Special Lab flow: start run and redirect to Lab screen.
    if (environment === "lab") {
      try {
        const created = await runTestApi({
          detectionId: detectionIdToUse,
          techniqueId: techniqueIdToUse,
          environment: "lab",
          mode: uiToBackendMode[testType],
          labOs,
          endpoint: targetHost.trim() || null,
        });
        router.push(`/lab?testId=${created.id}`);
      } catch (err: any) {
        setError(err.message || "Failed to start lab run.");
      }
      return;
    }

    const executionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
    const startTs = new Date().toISOString();
    const techniqueIdDisplay = techniqueIdToUse || techniqueFromExplore || selectedSubtechniqueId || "Unknown";
    const atomicCommand = `Invoke-AtomicTest -TestId ${techniqueIdDisplay} -ComputerName ${targetHost || "target-host"}`;

    setExecution({
      id: executionId,
      status: "running",
      started_at: startTs,
      atomic_command: atomicCommand,
      technique_id: techniqueIdDisplay,
      environment: environment.toUpperCase(),
      logs: [
        {
          id: `${executionId}-start`,
          timestamp: startTs,
          step: "Test dispatched to runner",
          status: "running",
        },
      ],
    });
    setLogsExpanded(false);

    await runTest(
      {
        detectionId: detectionIdToUse,
        techniqueId: techniqueIdToUse,
        environment,
        mode: uiToBackendMode[testType],
        endpoint: targetHost.trim() || null,
      },
      {
        onStart: (created) => {
          setExecution((prev) =>
            prev
              ? {
                  ...prev,
                  id: created.id || prev.id,
                }
              : prev
          );
          addExecutionLog({
            id: `${executionId}-created`,
            timestamp: new Date().toISOString(),
            step: "Execution started",
            status: "success",
          });
        },
        onLog: addExecutionLog,
        onStatus: updateExecutionStatus,
        onComplete: (final) => {
          addExecutionLog({
            id: `${executionId}-final`,
            timestamp: new Date().toISOString(),
            step: "Final result received",
            status: "success",
          });
          if (final.telemetry_summary && final.telemetry_summary.has_logs === false) {
            addExecutionLog({
              id: `${executionId}-partial`,
              timestamp: new Date().toISOString(),
              step: "Process creation logs not found",
              status: "warning",
            });
          }
        },
      }
    );
  }

  const detectionsForUi = detections.filter((det) => {
    if (techniqueFromExplore && testType === "detection_validation") {
      return det.technique_id === techniqueFromExplore;
    }
    return true;
  });

  const hasScenarioForCoverage = !!techniqueFromExplore;

  const canSelectTargetHost =
    !!testType &&
    ((testType === "telemetry_check" && !!selectedScenario) ||
      (testType === "find_detection_coverage" && (coverageScenarioConfirmed || !!selectedDetection)) ||
      (testType === "detection_validation" && !!selectedDetection));

  const canRun =
    !!testType &&
    !!environment &&
    !!targetHost.trim() &&
    ((testType === "telemetry_check" && !!selectedScenario) ||
      (testType === "detection_validation" && !!selectedDetection) ||
      (testType === "find_detection_coverage" &&
        (coverageScenarioConfirmed || !!selectedDetection))) &&
    !isRunning &&
    !isScheduling &&
    !permissionsLoading &&
    canRunTest(environment); // RBAC: Check permission for environment

  const telemetryScenarios = detections.map((det) => ({
    id: det.id,
    label: det.title,
    subtitle: `${det.technique_id} · ${det.siem_type?.toUpperCase() || "SIEM"}`,
  }));

  const scenarioNameFromExplore = atomicNameFromExplore || atomicScenarioHint?.name || "";
  const scenarioDescriptionFromExplore = atomicScenarioHint?.description?.trim() || "";
  const getTechniqueLabel = (techniqueId?: string | null) => {
    if (!techniqueId) return null;
    const exact = mitreTechniques.find((t) => t.id === techniqueId);
    if (exact) return `${exact.id} · ${exact.name}`;
    const base = techniqueId.split(".")[0];
    const baseMatch = mitreTechniques.find((t) => t.id === base);
    if (baseMatch) return `${techniqueId} · ${baseMatch.name}`;
    return techniqueId;
  };
  const techniqueLabelFromExplore = getTechniqueLabel(techniqueFromExplore);
  const scenarioCardTitle =
    scenarioNameFromExplore ||
    (techniqueLabelFromExplore ? `Technique ${techniqueLabelFromExplore}` : "Selected scenario");

  const step1Done = !!testType;
  const step2Done =
    step1Done &&
    ((testType === "telemetry_check" && !!selectedScenario) ||
      (testType === "detection_validation" && !!selectedDetection) ||
      (testType === "find_detection_coverage" && (coverageScenarioConfirmed || !!selectedDetection)));
  const step3Done = step2Done && !!environment && !!targetHost.trim();

  // Prevent the stepper from advancing beyond what’s actually completed
  const maxUnlockedStep = step3Done ? 3 : step2Done ? 2 : step1Done ? 1 : 1;
  useEffect(() => {
    setCurrentStep((prev) => Math.min(prev, maxUnlockedStep));
  }, [maxUnlockedStep]);

  useEffect(() => {
    const desiredStep = desiredStepRaw ? Number(desiredStepRaw) : NaN;
    if (!desiredStep || Number.isNaN(desiredStep)) return;
    if (desiredStep <= 1) {
      setCurrentStep(1);
      return;
    }
    if (desiredStep === 2 && step1Done) {
      setCurrentStep(2);
      return;
    }
    if (desiredStep >= 3 && step2Done) {
      setCurrentStep(3);
    }
  }, [desiredStepRaw, step1Done, step2Done]);

  const canGoToStep2 = step1Done;
  const canGoToStep3 = step2Done;
  const canGoToStep4 = step3Done;

  const handleNext = () => {
    if (currentStep === 1 && canGoToStep2) {
      setCurrentStep(2);
    } else if (currentStep === 2 && canGoToStep3) {
      setCurrentStep(3);
    } else if (currentStep === 3 && canGoToStep4) {
      // Step 4 is the execution step, already visible
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Test orchestration"
        title="Run Test"
        subtitle="Choose a validation goal, map a technique, and launch a controlled run against your lab environment."
        icon={<Target className="h-5 w-5" />}
        actions={null}
      />

      {/* Step Progress Indicator */}
      <div className="mb-8 flex justify-center">
        <div className="relative w-full max-w-4xl px-6">
          {/* Base connectors */}
          <div className="absolute top-[28px] left-[16.6667%] w-[33.3333%] h-[3px] rounded-full bg-slate-200" />
          <div className="absolute top-[28px] left-[50%] w-[33.3333%] h-[3px] rounded-full bg-slate-200" />
          {/* Active connectors */}
          <div
            className={cn(
              "absolute top-[28px] left-[16.6667%] w-[33.3333%] h-[3px] rounded-full transition-colors",
              currentStep > 1 ? "bg-indigo-200" : "bg-slate-200"
            )}
          />
          <div
            className={cn(
              "absolute top-[28px] left-[50%] w-[33.3333%] h-[3px] rounded-full transition-colors",
              currentStep > 2 ? "bg-indigo-200" : "bg-slate-200"
            )}
          />

          <div className="relative z-10 grid grid-cols-3 items-start text-center">
            {[1, 2, 3].map((step) => {
              const isActive = currentStep === step;
              const isCompleted = currentStep > step;
              return (
                <div key={step} className="flex flex-col items-center gap-2">
                  <div
                    className={cn(
                      "flex items-center justify-center w-14 h-14 rounded-full border-2 transition-all bg-white shadow-sm",
                      isCompleted
                        ? "border-indigo-400 text-indigo-500 bg-indigo-50"
                        : isActive
                        ? "border-[#5b7bff] text-[#4d6dff] shadow-[0_0_0_4px_rgba(91,123,255,0.18)]"
                        : "border-slate-200 text-slate-400"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="h-6 w-6" />
                    ) : (
                      <span className="text-xl font-display font-bold">{step}</span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      isActive ? "text-[#4d6dff]" : "text-slate-500"
                    )}
                  >
                    {step === 1
                      ? "Test Mode"
                      : step === 2
                      ? "Detection / Scenario"
                      : "Environment"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Configuration Card */}
      <Card className="border border-slate-200 shadow-lg shadow-slate-200/50 rounded-2xl">
        <CardContent className="pt-6">
          <div className="space-y-8">
            {/* Step 1: Test Mode Selection */}
            <div className={cn("space-y-4", currentStep < 1 && "opacity-50")}>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 text-sm font-bold">
                      1
                    </span>
                    Select Test Mode
                  </h2>
                  <p className="text-sm text-slate-600 ml-9">
                    Choose what you want this test run to accomplish
                  </p>
                    </div>
                  </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 ml-9">
                  <button
                    type="button"
                    onClick={() => {
                      setTestType("detection_validation");
                      setSelectedDetection("");
                      setSelectedScenario("");
                      setTargetHost("");
                      setResult(null);
                      setError(null);
                    setCurrentStep(2);
                  }}
                  className={cn(
                    "relative overflow-hidden p-4 rounded-xl border-2 transition-all text-left group bg-white",
                    testType === "detection_validation"
                      ? "border-[#5b7bff] shadow-[0_12px_32px_rgba(77,109,255,0.18)] ring-1 ring-[#4d6dff]/30"
                      : "border-slate-200 hover:border-[#5b7bff] hover:shadow-[0_10px_24px_rgba(91,123,255,0.12)]"
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-x-0 top-0 h-1 transition-all",
                      testType === "detection_validation" ? "bg-[#4d6dff]" : "bg-transparent"
                    )}
                  />
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                        testType === "detection_validation"
                          ? "bg-indigo-50 text-indigo-700"
                          : "bg-slate-100 text-slate-500"
                      )}
                    >
                      <Target className="h-5 w-5" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h3 className="font-display font-semibold text-slate-900">Validate a Detection</h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        I already have a rule — does it work?
                      </p>
                    </div>
                    {testType === "detection_validation" && (
                      <CheckCircle2 className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                    )}
                  </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTestType("find_detection_coverage");
                      setSelectedDetection("");
                      setSelectedScenario("");
                      setTargetHost("");
                      setResult(null);
                      setError(null);
                    setCurrentStep(2);
                  }}
                  className={cn(
                    "relative overflow-hidden p-4 rounded-xl border-2 transition-all text-left group bg-white",
                    testType === "find_detection_coverage"
                      ? "border-[#5b7bff] shadow-[0_12px_32px_rgba(77,109,255,0.18)] ring-1 ring-[#4d6dff]/30"
                      : "border-slate-200 hover:border-[#5b7bff] hover:shadow-[0_10px_24px_rgba(91,123,255,0.12)]"
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-x-0 top-0 h-1 transition-all",
                      testType === "find_detection_coverage" ? "bg-[#4d6dff]" : "bg-transparent"
                    )}
                  />
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                        testType === "find_detection_coverage"
                          ? "bg-indigo-50 text-indigo-700"
                          : "bg-slate-100 text-slate-500"
                      )}
                    >
                      <Search className="h-5 w-5" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <h3 className="font-display font-semibold text-slate-900">Explore Coverage Gaps</h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        What should detect this ATT&amp;CK technique?
                      </p>
                    </div>
                    {testType === "find_detection_coverage" && (
                      <CheckCircle2 className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                    )}
                  </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTestType("telemetry_check");
                      setSelectedDetection("");
                      setSelectedScenario("");
                      setTargetHost("");
                      setResult(null);
                      setError(null);
                    setCurrentStep(2);
                    }}
                  className={cn(
                    "relative overflow-hidden p-4 rounded-xl border-2 transition-all text-left group bg-white",
                    testType === "telemetry_check"
                      ? "border-[#5b7bff] shadow-[0_12px_32px_rgba(77,109,255,0.18)] ring-1 ring-[#4d6dff]/30"
                      : "border-slate-200 hover:border-[#5b7bff] hover:shadow-[0_10px_24px_rgba(91,123,255,0.12)]"
                  )}
                >
                  <div
                    className={cn(
                      "absolute inset-x-0 top-0 h-1 transition-all",
                      testType === "telemetry_check" ? "bg-[#4d6dff]" : "bg-transparent"
                    )}
                  />
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                        testType === "telemetry_check"
                          ? "bg-indigo-50 text-indigo-700"
                          : "bg-slate-100 text-slate-500"
                      )}
                    >
                      <Waves className="h-5 w-5" />
                </div>
                    <div className="flex-1 space-y-1">
                      <h3 className="font-display font-semibold text-slate-900">Verify Telemetry Health</h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Are logs even arriving?
                </p>
                </div>
                    {testType === "telemetry_check" && (
                      <CheckCircle2 className="h-5 w-5 text-indigo-500 flex-shrink-0" />
                    )}
                  </div>
                </button>
                  </div>
              </div>

            {/* Step 2: Detection/Scenario Selection */}
              {currentStep >= 2 && (
            <div className={cn("space-y-4 border-t border-slate-200 pt-8", currentStep < 2 && "opacity-50")}>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 text-sm font-bold">
                      2
                    </span>
                        {testType === "telemetry_check"
                        ? "Choose Attack Scenario"
                          : testType === "detection_validation"
                        ? "Select Detection to Validate"
                        : "Choose ATT&CK Technique"}
                    </h2>
                    <p className="text-sm text-slate-600 ml-9">
                      {testType === "detection_validation"
                        ? "Select the detection rule you want to validate"
                        : testType === "find_detection_coverage"
                        ? "Choose an attack scenario to test coverage"
                        : "Select a scenario to verify telemetry"}
                    </p>
                  </div>
                  {loading && (
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </div>
                  )}
                </div>

                {!testType && (
                  <div className="ml-9 p-4 rounded-lg border border-slate-200 bg-slate-50">
                    <p className="text-sm text-slate-600">
                      Select a test mode in Step 1 to continue
                  </p>
                  </div>
                )}

                {testType && testType === "detection_validation" && (
                    <div className="ml-9 space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                          type="text"
                          value={detectionSearch}
                          onChange={(e) => setDetectionSearch(e.target.value)}
                          placeholder="Search detections by name, MITRE technique, or SIEM type…"
                        className="pl-10 h-10 bg-white border-slate-200 text-sm text-slate-900 placeholder:text-slate-500"
                          disabled={isRunning}
                        />
                      </div>
                    <div className="max-h-64 overflow-y-auto overflow-x-hidden hide-scrollbar space-y-2 border border-slate-200 rounded-lg p-2 bg-white">
                        {detectionsForUi
                          .filter((det) => {
                            if (!detectionSearch.trim()) return true;
                            const q = detectionSearch.toLowerCase();
                            return (
                              det.title.toLowerCase().includes(q) ||
                              det.technique_id.toLowerCase().includes(q) ||
                              (det.siem_type || "").toLowerCase().includes(q)
                            );
                          })
                          .map((det) => {
                            const tooltipParts = [
                              det.description || "No description provided",
                              `SIEM: ${det.siem_type || "N/A"}`,
                              `Last tested: ${
                                det.last_tested_at
                                  ? new Date(det.last_tested_at)
                                      .toISOString()
                                      .slice(0, 19)
                                      .replace("T", " ")
                                  : "Never"
                              }`,
                              `Last score: ${typeof det.last_score === "number" ? det.last_score : "N/A"}`,
                            ];
                            const isSelected = selectedDetection === det.id;
                            return (
                              <button
                                key={det.id}
                                type="button"
                                onClick={() => setSelectedDetection(det.id)}
                                title={tooltipParts.join(" • ")}
                                disabled={isRunning}
                                className={cn(
                                  "w-full text-left px-4 py-3 rounded-lg border-2 transition-all bg-white",
                                  isRunning
                                    ? "border-slate-200 text-slate-400 cursor-not-allowed"
                                    : isSelected
                                    ? "border-indigo-400 bg-indigo-50 text-slate-900 shadow-sm"
                                    : "border-slate-200 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 cursor-pointer"
                                )}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm truncate text-slate-900">{det.title}</div>
                                    <div className="text-xs text-slate-600 mt-0.5">
                                    {det.technique_id} · {det.siem_type?.toUpperCase() || "SIEM"}
                                    </div>
                                  </div>
                                  {isSelected && (
                                    <CheckCircle2 className="h-5 w-5 text-indigo-500 flex-shrink-0 ml-2" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        {detectionsForUi.length === 0 && (
                          <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 text-center">
                            <p className="text-sm text-slate-600">
                              No detections found. Add a detection on the{" "}
                              <Link href="/detections" className="text-indigo-600 hover:text-indigo-700 underline">
                                Detections page
                              </Link>{" "}
                              first.
                          </p>
                          </div>
                        )}
                      </div>
                      {detections.length > 0 && (() => {
                        const visibleCount =
                          detectionsForUi.filter((det) => {
                            if (!detectionSearch.trim()) return true;
                            const q = detectionSearch.toLowerCase();
                            return (
                              det.title.toLowerCase().includes(q) ||
                              det.technique_id.toLowerCase().includes(q) ||
                              (det.siem_type || "").toLowerCase().includes(q)
                            );
                          }).length;
                        return (
                          <p className="text-xs text-slate-600 mt-2">
                            Showing <span className="font-semibold text-slate-900">{visibleCount}</span> of{" "}
                            <span className="font-semibold text-slate-900">{detections.length}</span> detections
                          </p>
                        );
                      })()}
                      {techniqueFromExplore && scenarioNameFromExplore && (
                        <p className="mt-1 text-[11px] text-slate-600">
                          Scenario from Explore:{" "}
                          <span className="font-semibold text-slate-900">
                            {scenarioNameFromExplore}
                          </span>{" "}
                          ({techniqueFromExplore})
                        </p>
                      )}
                      {techniqueFromExplore &&
                        detections.filter((d) => d.technique_id === techniqueFromExplore).length ===
                          0 && (
                          <p className="mt-1 text-[11px] text-amber-600">
                            No detection rules currently match technique {techniqueFromExplore}. Go to the
                            Tests page to design one.
                          </p>
                        )}

                      {/* Subtechnique picker: only if the detection has a MITRE technique */}
                      {(() => {
                        const det = detections.find((d) => d.id === selectedDetection);
                        const techniqueId = det?.technique_id;
                        if (!techniqueId || mitreTechniques.length === 0) return null;

                        const parentId = techniqueId.split(".")[0];
                        const relatedSubtechniques = mitreTechniques.filter(
                          (t) =>
                            t.is_subtechnique &&
                            t.id.startsWith(parentId + ".")
                        );
                        if (relatedSubtechniques.length === 0) return null;

                        return (
                          <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                Optional: Choose Subtechnique
                            </p>
                              <p className="text-xs text-slate-600 mt-0.5">
                                Select a specific ATT&CK subtechnique, or skip to use the detection's primary technique
                            </p>
                            </div>
                            <div className="max-h-40 overflow-y-auto overflow-x-hidden hide-scrollbar space-y-2 border border-slate-200 rounded-lg p-2 bg-white">
                              {relatedSubtechniques.map((t) => {
                                const isSelected = selectedSubtechniqueId === t.id;
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() =>
                                      setSelectedSubtechniqueId(
                                        isSelected ? "" : t.id,
                                      )
                                    }
                                    className={cn(
                                      "w-full text-left px-4 py-2 rounded-lg border-2 transition-all bg-white",
                                      isSelected
                                        ? "border-indigo-400 bg-indigo-50 text-slate-900 shadow-sm"
                                        : "border-slate-200 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 cursor-pointer"
                                    )}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate text-slate-900">
                                        {t.id} · {t.name}
                                        </div>
                                        <div className="text-xs text-slate-600 mt-0.5">
                                        {t.tactics.join(", ")}
                                        </div>
                                      </div>
                                      {isSelected && (
                                        <CheckCircle2 className="h-5 w-5 text-indigo-500 flex-shrink-0 ml-2" />
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                {testType === "telemetry_check" && (
                  <div className="ml-9 space-y-3">
            <Select
              value={selectedScenario || undefined}
              onValueChange={(value: string) => setSelectedScenario(value)}
                      disabled={isRunning || telemetryScenarios.length === 0}
                    >
                      <SelectTrigger className="w-full h-11 bg-white border-slate-200 text-slate-900">
                        <SelectValue placeholder="Select a test scenario template" />
              </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        {telemetryScenarios.map((scenario) => (
                          <SelectItem key={scenario.id} value={scenario.id}>
                            <div className="flex flex-col">
                              <span className="font-medium text-slate-900">{scenario.label}</span>
                              <span className="text-xs text-slate-600">{scenario.subtitle}</span>
                            </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
                    {selectedScenario && (() => {
                      const selectedScenarioData = telemetryScenarios.find((s) => s.id === selectedScenario);
                      const selectedDetectionData = detections.find((d) => d.id === selectedScenario);
                      return selectedScenarioData ? (
                        <div className="space-y-3 p-4 rounded-lg border border-slate-200 bg-slate-50">
                          <div>
                            <div className="text-sm font-medium text-slate-900 flex flex-col gap-0.5">
                              <span>Scenario:</span>
                              <span>{selectedScenarioData.label}</span>
                              {selectedScenarioData.subtitle && (
                                <span className="text-xs text-slate-600">{selectedScenarioData.subtitle}</span>
                              )}
                            </div>
                            {selectedDetectionData?.technique_id && (
                              <p className="text-xs text-slate-600 mt-0.5">
                                Technique: {selectedDetectionData.technique_id}
                              </p>
                            )}
                          </div>
                            <p className="text-sm text-slate-700">
                              {selectedScenarioData.subtitle
                                ? selectedScenarioData.subtitle
                                : "PurveX will run this scenario and look for telemetry and events in your SIEM – even without an onboarded detection rule."}
                            </p>
                        </div>
                      ) : null;
                    })()}
                    {telemetryScenarios.length === 0 && (
                      <div className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                        <p className="text-sm text-slate-600">
                          No test scenarios available. Add at least one detection or atomic test template first.
                      </p>
                      </div>
                    )}
                  </div>
                )}

                {testType === "find_detection_coverage" && (
                    <div className="ml-9 space-y-3">
                      {techniqueFromExplore ? (
                        <div className="space-y-3 p-4 rounded-lg border border-slate-200 bg-slate-50">
                        <div>
                            <p className="text-sm font-medium text-slate-900">
                              Scenario: {scenarioCardTitle}
                          </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              Technique ID: {techniqueFromExplore}
                              {scenarioNameFromExplore && (
                                <span className="ml-2 text-slate-700">
                                  • {scenarioNameFromExplore}
                                </span>
                              )}
                            </p>
                        </div>
                        <p className="text-sm text-slate-700">
                          {scenarioDescriptionFromExplore ||
                            "PurveX will run this scenario and look for telemetry and events in your SIEM – even without an onboarded detection rule."}
                        </p>
                          <div className="flex items-center gap-3">
                            <Button
                              size="sm"
                              className="h-9 px-3 bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm"
                              onClick={() => setCoverageScenarioConfirmed(true)}
                              disabled={coverageScenarioConfirmed}
                            >
                              {coverageScenarioConfirmed ? "Scenario selected" : "Use this scenario"}
                            </Button>
                            {coverageScenarioConfirmed && (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                                Ready for Step 3
                              </Badge>
                            )}
                          </div>
                        {detections.filter((d) => d.technique_id === techniqueFromExplore).length === 0 && (
                          <div className="p-3 rounded-lg border border-amber-200 bg-amber-50">
                            <p className="text-sm text-amber-700">
                              No detection rules match {techniqueFromExplore}. You can still run this test to verify telemetry and discover gaps.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                        <p className="text-sm text-slate-700 mb-3">
                        Start from the{" "}
                        <Link
                          href="/tests"
                            className="text-indigo-600 hover:text-indigo-700 underline font-medium"
                        >
                          Explore techniques view
                        </Link>{" "}
                          to choose an attack scenario first.
                        </p>
                    <Button
                      variant="outline"
                          size="sm"
                          asChild
                      className="border-slate-200 text-slate-900 hover:border-indigo-200 hover:bg-indigo-50"
                    >
                          <Link href="/tests">
                            <Search className="h-4 w-4 mr-2" />
                            Explore Techniques
                          </Link>
                    </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

            {/* Step 3: Environment Configuration */}
            {step2Done && (
            <div className="space-y-8 border-t border-slate-200 pt-8">
                <div className="space-y-2">
                  <h2 className="text-xl font-display font-semibold text-slate-900 flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200 text-sm font-bold">
                      3
                    </span>
                    Environment & Target
                  </h2>
                  <p className="text-sm text-slate-600 pl-11">
                    Configure where and how to execute the test
                  </p>
                </div>

                {/* Configuration Summary */}
                {step2Done && (
                  <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 space-y-3">
                    <p className="text-xs uppercase tracking-wider text-slate-600 font-medium">Configuration Summary</p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                        Mode: {testType === "detection_validation"
                          ? "Validate a Detection"
                          : testType === "find_detection_coverage"
                          ? "Explore Coverage Gaps"
                          : "Verify Telemetry Health"}
                      </Badge>
                    {techniqueFromExplore && (
                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
                          {techniqueFromExplore}
                        </Badge>
                    )}
                    {environment && (
                        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200">
                          {environment === "lab" ? "Lab" : environment === "dev" ? "Dev" : "Prod"}
                        </Badge>
                    )}
                    {targetHost && (
                        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200">
                          {targetHost}
                        </Badge>
                    )}
                    </div>
                  </div>
                )}

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <Label htmlFor="environment-select" className="text-slate-900 text-sm font-medium flex items-center gap-2">
                      <Server className="h-4 w-4 text-slate-500" />
                      Environment
                    </Label>
                    <Select
                      onValueChange={(value: "lab" | "dev" | "prod") => setEnvironment(value)}
                      value={environment}
                      disabled={isRunning || !testType}
                    >
                      <SelectTrigger
                        id="environment-select"
                        className="w-full h-11 bg-white border-slate-200 text-slate-900"
                      >
                        <SelectValue placeholder="Select environment" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        {canRunTest("lab") && <SelectItem value="lab">Lab (PurveX)</SelectItem>}
                        {canRunTest("dev") && <SelectItem value="dev">Dev</SelectItem>}
                        {canRunTest("prod") && <SelectItem value="prod">Prod (restricted)</SelectItem>}
                        {!canRunTest("lab") && !canRunTest("dev") && !canRunTest("prod") && (
                          <SelectItem value="lab" disabled>No permissions</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Choose the environment where the test will execute
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="target-host" className="text-slate-900 text-sm font-medium flex items-center gap-2">
                      <Settings className="h-4 w-4 text-slate-500" />
                      Target Host
                    </Label>
                    {runnerTargets.length > 0 ? (
                      <Select
                        value={targetHost}
                        onValueChange={(value) => setTargetHost(value)}
                        disabled={isRunning || !canSelectTargetHost}
                      >
                        <SelectTrigger
                          id="target-host"
                          className="w-full h-11 bg-white border-slate-200 text-slate-900"
                        >
                          <SelectValue placeholder="Select a runner" />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200">
                          {runnerTargets.map((host) => (
                            <SelectItem key={host} value={host}>{host}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="target-host"
                        value={targetHost}
                        onChange={(e) => setTargetHost(e.target.value)}
                        placeholder="e.g. win-lab-01 or 10.0.0.5"
                        className="h-11 bg-white border-slate-200 text-slate-900 placeholder:text-slate-500"
                        disabled={isRunning || !canSelectTargetHost}
                      />
                    )}
                    <p className="text-xs text-slate-600 leading-relaxed">
                      The specific host where the attack will run. Telemetry and detections will be tied to this host.
                    </p>
                  </div>
                </div>

                {environment === "lab" && (
                  <div className="mt-6 space-y-3">
                    <div className="space-y-3">
                      <Label className="text-slate-900 text-sm font-medium">
                        Lab Operating System
                      </Label>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Choose which lab VMs this scenario should exercise
                      </p>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                        <button
                          type="button"
                          className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium transition-all border",
                            labOs === "windows"
                              ? "bg-white text-slate-900 border-slate-200 shadow-sm"
                              : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-white"
                          )}
                          onClick={() => setLabOs("windows")}
                          disabled={isRunning}
                        >
                          Windows
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium transition-all border",
                            labOs === "linux"
                              ? "bg-white text-slate-900 border-slate-200 shadow-sm"
                              : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-white"
                          )}
                          onClick={() => setLabOs("linux")}
                          disabled={isRunning}
                        >
                          Linux
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium transition-all border",
                            labOs === "both"
                              ? "bg-white text-slate-900 border-slate-200 shadow-sm"
                              : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-white"
                          )}
                          onClick={() => setLabOs("both")}
                          disabled={isRunning}
                        >
                          Both
                        </button>
                      </div>
                    </div>
                  </div>
                )}

          {error && (
                  <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10">
                    <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <p className="text-sm text-red-200">{error}</p>
        </div>
      </div>
    )}
        {execution && (
          <LiveExecutionPanel
            execution={execution}
            logsExpanded={logsExpanded}
            onToggleLogs={() => setLogsExpanded((v) => !v)}
            isRunning={isRunning}
          />
        )}

                {/* Execution Options */}
                <div className="space-y-4 pt-6 border-t border-slate-200">
                  <div className="space-y-3">
                    <Label className="text-slate-900 text-sm font-medium">Execution Mode</Label>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Choose to run immediately or set a schedule.
                    </p>
                    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                        <button
                          type="button"
                          className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium transition-all border",
                            runMode === "now"
                              ? "bg-white text-slate-900 border-slate-200 shadow-sm"
                              : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-white"
                          )}
                          onClick={() => setRunMode("now")}
                          disabled={isRunning || isScheduling}
                        >
                        Run Now
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium transition-all border",
                            runMode === "schedule"
                              ? "bg-white text-slate-900 border-slate-200 shadow-sm"
                              : "text-slate-600 border-transparent hover:text-slate-900 hover:bg-white"
                          )}
                          onClick={() => setRunMode("schedule")}
                          disabled={isRunning || isScheduling || !canScheduleTest(environment)}
                          title={!canScheduleTest(environment) ? "You don't have permission to schedule tests in this environment" : ""}
                        >
                          Schedule
                        </button>
                      </div>
                    </div>

                    {runMode === "schedule" && (
                    <div className="mt-4 space-y-4 p-5 rounded-lg border border-slate-200 bg-slate-50">
                      <p className="text-sm font-medium text-slate-900">Schedule Configuration</p>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-3">
                          <Label htmlFor="schedule-type" className="text-sm text-slate-700 font-medium">
                            Schedule Type
                              </Label>
                              <Select
                                value={scheduleType}
                                onValueChange={(v: string) => setScheduleType(v as TestScheduleType)}
                              >
                            <SelectTrigger id="schedule-type" className="h-11 bg-white border-slate-200 text-slate-900">
                                  <SelectValue placeholder="Select schedule type" />
                                </SelectTrigger>
                            <SelectContent className="bg-white border-slate-200">
                                  <SelectItem value="once">Run once at specific time</SelectItem>
                                  <SelectItem value="interval">Repeat at regular intervals</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-3">
                              {scheduleType === "once" ? (
                                <>
                              <Label htmlFor="schedule-time" className="text-sm text-slate-700 font-medium">
                                Date & Time
                                  </Label>
                                  <Input
                                    id="schedule-time"
                                    type="datetime-local"
                                    value={scheduleTime}
                                    onChange={(e) => setScheduleTime(e.target.value)}
                                className="h-11 bg-white border-slate-200 text-slate-900"
                                    placeholder="Select date and time"
                                  />
                                </>
                              ) : (
                                <>
                              <Label htmlFor="schedule-interval" className="text-sm text-slate-700 font-medium">
                                Interval (minutes)
                                  </Label>
                                    <Input
                                      id="schedule-interval"
                                      type="number"
                                      min={1}
                                      value={scheduleIntervalMinutes}
                                      onChange={(e) => setScheduleIntervalMinutes(e.target.value)}
                                className="h-11 bg-white border-slate-200 text-slate-900"
                                      placeholder="60"
                                    />
                                </>
                              )}
                            </div>
                          </div>
                      <div className="p-3 rounded-lg bg-slate-100 border border-slate-200">
                        <p className="text-xs text-slate-700">
                          <span className="font-medium text-slate-900">Admin-only:</span> Only administrators can assign users to run a test.
                          </p>
                        </div>
                      </div>
                    )}

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between gap-4 pt-6 border-t border-slate-200">
                    {currentStep > 1 && (
                      <Button
                        onClick={handlePrevious}
                        variant="outline"
                        className="border-slate-200 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 h-11 px-4"
                      >
                        <ChevronLeft className="h-4 w-4 mr-2" />
                        Previous
                      </Button>
                    )}
                  <Button
                    onClick={handleRunTest}
                    disabled={!canRun}
                    className={cn(
                      "flex-1 h-12 text-base font-semibold border focus-visible:ring-2 focus-visible:ring-slate-200 transition-all",
                      canRun
                        ? "border-slate-300 bg-white text-black hover:bg-slate-50 shadow-sm"
                        : "border-slate-200 bg-slate-200 text-slate-500 cursor-not-allowed"
                    )}
                    aria-label={isRunning ? "Test is running" : canRun ? "Run the detection test" : "Complete all steps to run test"}
                  >
                    {isRunning ? (
                      <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Running Test...
                      </>
                    ) : (
                      <>
                          <Play className="mr-2 h-5 w-5" />
                          {runMode === "schedule" ? "Save Schedule" : "Run Test"}
                      </>
                    )}
                  </Button>
                </div>
                </div>
              </div>
              )}
            </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      {result && (
        <Card className="mt-6 border border-slate-200 shadow-lg shadow-slate-200/40 rounded-2xl bg-white">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base font-semibold text-slate-900">
              Test Result
            </CardTitle>
            {lastRunType && (
              <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-indigo-700">
                Mode
                <span className="font-semibold text-indigo-700 normal-case tracking-normal">
                  {lastRunType === "detection_validation"
                    ? "Detection validation"
                    : lastRunType === "find_detection_coverage"
                    ? "Find detections"
                    : "Telemetry check"}
                </span>
              </span>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-700">
            {(() => {
              const bannerByType: Record<
                HighLevelResultType,
                { color: string; icon: ReactNode; title: string; sub: string }
              > = {
                PASS: {
                  color: "bg-emerald-50 border-emerald-200 text-emerald-800",
                  icon: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
                  title: "Detection validated",
                  sub: "Logs were ingested and the detection rule fired.",
                },
                FAIL_RULE_VISIBILITY: {
                  color: "bg-amber-50 border-amber-200 text-amber-800",
                  icon: <AlertTriangle className="h-4 w-4 text-amber-600" />,
                  title: "Rule visibility issue",
                  sub: "Logs were ingested, but the detection rule did not fire.",
                },
                NO_LOGS: {
                  color: "bg-red-50 border-red-200 text-red-800",
                  icon: <XCircle className="h-4 w-4 text-red-600" />,
                  title: "No logs found",
                  sub: "No expected events were seen in your SIEM. This indicates a telemetry or ingestion issue.",
                },
                SYSTEM_ERROR: {
                  color: "bg-slate-100 border-slate-200 text-slate-800",
                  icon: <Slash className="h-4 w-4 text-slate-500" />,
                  title: "System error",
                  sub: "PurveX could not evaluate this test run due to a system or SIEM error.",
                },
              };

              const meta = bannerByType[result.result_type];

              return (
                <>
                  <div
                    className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-xs ${meta.color}`}
                  >
                    <div className="mt-0.5">{meta.icon}</div>
                    <div className="space-y-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                        {result.result_type}
                      </div>
                      <p className="text-slate-900 text-sm">{meta.title}</p>
                      <p className="text-[11px] text-slate-600">{meta.sub}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        Telemetry
                      </div>
                      <p className="text-[11px] text-slate-700">
                        Logs present:{" "}
                        <span className="font-semibold text-slate-900">
                          {result.telemetry_summary.has_logs ? "Yes" : "No"}
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-700">
                        Events found:{" "}
                        <span className="font-semibold text-slate-900">{result.telemetry_summary.events_found}</span>
                      </p>
                    </div>

                    {lastRunType !== "telemetry_check" && result.detection_summary && (
                      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                          Detection
                        </div>
                        <p className="text-[11px] text-slate-700">
                          Rule fired:{" "}
                          <span className="font-semibold text-slate-900">
                            {result.detection_summary.rule_fired ? "Yes" : "No"}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-700">
                          Events found:{" "}
                          <span className="font-semibold text-slate-900">
                            {result.detection_summary.alerts_found}
                          </span>
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1 justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-200 text-[11px] text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
                      onClick={handleRunTest}
                      disabled={!canRun}
                    >
                      Run again
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-200 text-[11px] text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
                      onClick={() => router.push(`/tests/${result.run_id}`)}
                    >
                      View full test report
                    </Button>
                  </div>
                </>
              );
            })()}
        </CardContent>
      </Card>
      )}
      {/* 
        RunTestPage summary (MVP)
        - Implements a three‑mode, stepwise flow for running detection tests:
          Detection validation, Find detections (scenario‑driven coverage), and Telemetry / log ingestion check.
        - Uses useRunTest + /tests/run to execute and poll tests, mapping backend outcomes into
          PASS / FAIL_RULE_VISIBILITY / NO_LOGS / SYSTEM_ERROR for a simple result card.
        - Designed to keep the UI deterministic and safe while remaining flexible enough to grow
          with future execution backends and richer SIEM integrations.
      */}
      </PageContainer>
  );
}

export default function RunTestPage() {
  return <RunTestPageContent />;
}
