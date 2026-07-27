"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useMemo, type ReactNode, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { toneClasses } from "@/lib/status-tone";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getDetections,
  createDetection,
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
  Plus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Slash,
  Target,
  Search,
  Waves,
  ChevronRight,
  ChevronLeft,
  Server,
  Settings,
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { TestsHubTabs } from "@/components/tests/tests-hub-tabs";
import { cn } from "@/lib/utils";
import { z } from "zod";
import { FieldError, FormError } from "@/components/ui/form-error";

// Validates the few free-form text inputs on /run-test. Precondition checks for
// button-driven fields (test type, detection, environment) remain in
// `handleRunTest` because Zod adds no value for "did the user click yet?".
const targetHostSchema = z
  .string()
  .trim()
  .min(1, "Enter the host where the scenario will run.")
  .max(255, "Host name is too long.")
  .regex(
    /^[A-Za-z0-9]([A-Za-z0-9.\-:_]*[A-Za-z0-9])?$/,
    "Use a hostname, FQDN, or IPv4/IPv6 address (no spaces).",
  );

const scheduleTimeSchema = z
  .string()
  .min(1, "Choose a date and time for the scheduled run.")
  .refine(
    (v) => !Number.isNaN(new Date(v).getTime()),
    "Pick a valid date and time.",
  )
  .refine(
    (v) => new Date(v).getTime() > Date.now() - 60_000,
    "Scheduled time must be in the future.",
  );

const scheduleIntervalSchema = z
  .string()
  .trim()
  .min(1, "Enter an interval in minutes.")
  .regex(/^\d+$/, "Interval must be a whole number of minutes.")
  .refine((v) => Number(v) >= 1, "Interval must be at least 1 minute.")
  .refine((v) => Number(v) <= 10_080, "Interval cannot exceed 10,080 minutes (7 days).");

type RunTestFieldErrors = Partial<Record<"targetHost" | "scheduleTime" | "scheduleInterval", string>>;

type UiTestType = "detection_validation" | "find_detection_coverage" | "telemetry_check";

type RunnerTargetRecord = {
  hostname?: string | null;
  environment_name?: string | null;
};

const RUN_TEST_MAX_POLL_ATTEMPTS = 300;
const RUN_TEST_POLL_INTERVAL_MS = 2_000;
const DEFAULT_SCHEDULE_INTERVAL_MINUTES = "60";
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
  final_status?: string;
}

type ExecutionStatus = "queued" | "running" | "ingesting" | "validated" | "failed" | "partial";

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

function parseSampleEvents(artifact?: { siem_sample_events?: string | null } | null): unknown[] {
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
  // The backend now persists the run intent on the row. Treat anything other
  // than DETECTION_VALIDATION as a "telemetry-only" interpretation so the
  // banner copy matches what the runner actually evaluated.
  const runMode = (test.mode || "DETECTION_VALIDATION").toUpperCase();
  const isTelemetryOnly = runMode === "TELEMETRY_CHECK" || !hasDetection;

  let result_type: HighLevelResultType = "SYSTEM_ERROR";
  let message =
    "PurveX could not evaluate this validation run due to a system or SIEM error. Check connections and try again.";

  if (test.status === "error") {
    result_type = "SYSTEM_ERROR";
  } else if (!hasLogs) {
    result_type = "NO_LOGS";
    message = isTelemetryOnly
      ? "No matching telemetry arrived in the SIEM for this scenario. This is an ingestion or log-source issue, not a rule problem."
      : "We could not find the expected evidence from this validation. This points to a telemetry or ingestion issue.";
  } else if (isTelemetryOnly) {
    // Telemetry‑mode run: rule logic was intentionally not evaluated.
    result_type = "PASS";
    message = hasDetection
      ? "Telemetry arrived in the SIEM for this scenario. The linked rule was not evaluated because this was a telemetry-readiness run."
      : "Evidence was ingested for this scenario. No specific detection was evaluated for this run.";
  } else if ((test.result || "").toUpperCase() === "PASS") {
    result_type = "PASS";
    message = "Evidence was ingested and the linked detection fired as expected.";
  } else if ((test.result || "").toUpperCase() === "FAIL") {
    result_type = "FAIL_RULE_VISIBILITY";
    message = "Evidence was ingested, but the detection did not fire. Check deployment, scope, and status.";
  }

  return {
    result_type,
    message,
    telemetry_summary: {
      has_logs: hasLogs,
      events_found: sampleEvents.length,
    },
    // Only surface a detection summary when the rule was actually evaluated.
    detection_summary: hasDetection && !isTelemetryOnly
      ? {
          rule_fired: (test.result || "").toUpperCase() === "PASS",
          alerts_found: 0,
        }
      : undefined,
    run_id: test.id,
    final_status: test.status,
  };
}

const EXEC_STATUS_META: Record<
  ExecutionStatus,
  { label: string; tone: NonNullable<ChipProps["tone"]>; text: string; icon: ReactNode; pulse?: boolean }
> = {
  queued: {
    label: "Queued",
    tone: "muted",
    text: "Waiting for the runner to pick up the job",
    icon: <Clock3 className="h-4 w-4" />,
  },
  running: {
    label: "Running",
    tone: "info",
    text: "Executing the test on the target runner",
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    pulse: true,
  },
  ingesting: {
    label: "Ingesting",
    tone: "accent",
    text: "Waiting for telemetry and validation results",
    icon: <Waves className="h-4 w-4" />,
    pulse: true,
  },
  validated: {
    label: "Validated",
    tone: "success",
    text: "Validation completed successfully",
    icon: <CheckCircle2 className="h-4 w-4" />,
  },
  failed: {
    label: "Failed",
    tone: "danger",
    text: "Validation run failed",
    icon: <XCircle className="h-4 w-4" />,
  },
  partial: {
    label: "Partial Telemetry",
    tone: "warning",
    text: "Validation finished with incomplete telemetry",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
};

function LogStatusIcon({ status }: { status: ExecutionLogStatus }) {
  if (status === "success") return <CheckCircle2 className={cn("h-4 w-4", toneClasses("success").icon)} />;
  if (status === "warning") return <AlertTriangle className={cn("h-4 w-4", toneClasses("warning").icon)} />;
  if (status === "error") return <XCircle className={cn("h-4 w-4", toneClasses("danger").icon)} />;
  return <Loader2 className={cn("h-4 w-4 animate-spin", toneClasses("info").icon)} />;
}

function useRunTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stillProcessing, setStillProcessing] = useState<string | null>(null);

    const run = useCallback(
    async (
      params: {
        detectionId?: string | null;
        techniqueId?: string | null;
        environment: "lab" | "dev" | "prod";
        mode: TestRunMode;
        endpoint?: string | null;
        atomic?: {
          atomic_test_id?: string;
          atomic_test_name?: string;
          atomic_test_number?: number;
        };
      },
      callbacks?: RunCallbacks
    ) => {
      setIsRunning(true);
      setError(null);
      setStillProcessing(null);
      setResult(null);
      callbacks?.onStatus?.("running");
      try {
        const created = await runTestApi({
          detectionId: params.detectionId,
          techniqueId: params.techniqueId ?? null,
          environment: params.environment,
          mode: params.mode,
          endpoint: params.endpoint,
          atomic: params.atomic,
        });

        callbacks?.onStart?.(created);
        callbacks?.onStatus?.("queued");
        callbacks?.onLog?.({
          id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
          timestamp: new Date().toISOString(),
          step: "Job accepted and queued",
          status: "running",
        });

        let attempts = 0;
        let final: TestDetailResponse | null = null;
        let runningPolls = 0;
        const maxAttempts = RUN_TEST_MAX_POLL_ATTEMPTS;
        const pollInterval = RUN_TEST_POLL_INTERVAL_MS;
        
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
            if (current.status === "pending") {
              callbacks?.onStatus?.("queued");
              callbacks?.onLog?.({
                id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${attempts}`,
                timestamp: new Date().toISOString(),
                step: "Waiting for runner pickup",
                status: "running",
              });
            } else {
              runningPolls += 1;
              const nextStatus: ExecutionStatus = runningPolls > 1 ? "ingesting" : "running";
              callbacks?.onStatus?.(nextStatus);
              callbacks?.onLog?.({
                id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${attempts}`,
                timestamp: new Date().toISOString(),
                step: nextStatus === "running" ? "Atomic test executing on runner" : "Waiting for telemetry and rule results",
                status: "running",
              });
            }
          } catch {
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
          await new Promise((resolve) => setTimeout(resolve, pollInterval));
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
            missingSignal ? "partial" : final.status === "error" ? "failed" : "validated";
          callbacks?.onStatus?.(resolvedStatus, final.finished_at || new Date().toISOString(), missingSignal);
          callbacks?.onLog?.({
            id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-done`,
            timestamp: new Date().toISOString(),
            step:
              resolvedStatus === "validated"
                ? "Validation completed"
                : resolvedStatus === "partial"
                ? "Validation finished with partial telemetry"
                : "Validation run failed",
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
          // Not a failure — the backend just hasn't reached a terminal status within
          // our poll window. Keep this out of the error state so it doesn't read as broken.
          setStillProcessing(
            "This validation is taking longer than expected. It's still running on the backend — you can keep this page open or check the Tests page for the live record."
          );
          callbacks?.onStatus?.("ingesting");
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to start validation.");
        callbacks?.onStatus?.("failed", new Date().toISOString());
      } finally {
        setIsRunning(false);
      }
    },
    []
  );

  return { run, isRunning, result, error, stillProcessing, setResult };
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
  const stages: Array<{ id: ExecutionStatus | "done"; label: string }> = [
    { id: "queued", label: "Queued" },
    { id: "running", label: "Running" },
    { id: "ingesting", label: "Ingesting" },
    { id: "validated", label: "Validated" },
  ];
  const currentStageIndex = (() => {
    if (execution.status === "failed" || execution.status === "partial") return 3;
    return stages.findIndex((stage) => stage.id === execution.status);
  })();

  return (
    <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Chip tone={meta.tone} size="md" className={meta.pulse ? "animate-pulse" : undefined}>
            {meta.icon}
            {meta.label}
          </Chip>
          <span className="text-xs text-[var(--surface-subtle-foreground)]">{meta.text}</span>
          {execution.status === "partial" && execution.missing_signal && (
            <Chip tone="warning" size="sm">
              {execution.missing_signal}
            </Chip>
          )}
        </div>
        <div className="text-[11px] text-[var(--surface-subtle-foreground)] text-right">
          <div>Started: {execution.started_at}</div>
          {execution.completed_at && <div>Finished: {execution.completed_at}</div>}
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        {stages.map((stage, index) => {
          const isDone = index < currentStageIndex;
          const isCurrent = index === currentStageIndex;
          const tone = isDone ? "success" : isCurrent ? "info" : "muted";
          return (
            <div
              key={stage.label}
              className={cn(
                "rounded-lg border px-3 py-2 text-xs font-semibold",
                toneClasses(tone).border,
                `${toneClasses(tone).bg}/10`,
                toneClasses(tone).text,
              )}
            >
              {stage.label}
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--surface-subtle-foreground)]">Validation ID</div>
          <div className="text-sm font-mono text-[var(--foreground)] break-all">{execution.id}</div>
        </div>
        <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--surface-subtle-foreground)]">Technique</div>
          <div className="text-sm font-semibold text-[var(--foreground)]">{execution.technique_id}</div>
        </div>
        <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--surface-subtle-foreground)]">Environment</div>
          <div className="text-sm font-semibold text-[var(--foreground)]">{execution.environment}</div>
        </div>
        <div className="md:col-span-2 lg:col-span-3 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--surface-subtle-foreground)]">Runner command</div>
          <div className="text-sm font-mono text-[var(--foreground)] whitespace-pre-wrap break-words">
            {execution.atomic_command}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--stroke-soft)] pt-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-[var(--foreground)]">Run log</div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-xs"
            onClick={onToggleLogs}
          >
            {logsExpanded ? "Hide run details" : "View run details"}
          </Button>
        </div>
        {logsExpanded && (
          <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
            {execution.logs.length === 0 && (
              <div className="px-3 py-2 text-xs text-[var(--surface-subtle-foreground)]">Waiting for run updates...</div>
            )}
            {execution.logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 border-b border-[var(--stroke-soft)] last:border-0 px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-200"
              >
                <div className="text-[var(--surface-subtle-foreground)] whitespace-nowrap">{log.timestamp}</div>
                <div className="flex items-center gap-2">
                  <LogStatusIcon status={log.status} />
                  <span className="text-[var(--foreground)]">{log.step}</span>
                </div>
              </div>
            ))}
          </div>
        )}
        {!logsExpanded && isRunning && (
          <div className="mt-2 text-xs text-[var(--surface-subtle-foreground)]">Live updates are streaming. Expand to view details.</div>
        )}
      </div>
    </div>
  );
}

type TestModeMeta = {
  id: UiTestType;
  title: string;
  question: string;
  icon: React.ComponentType<{ className?: string }>;
  step2Label: string;
};

const TEST_MODES: TestModeMeta[] = [
  {
    id: "detection_validation",
    title: "Validate a Detection",
    question: "I already have a rule — does it work?",
    icon: Target,
    step2Label: "Pick Detection",
  },
  {
    id: "find_detection_coverage",
    title: "Explore Coverage",
    question: "What should detect this ATT&CK technique?",
    icon: Search,
    step2Label: "Pick Technique",
  },
  {
    id: "telemetry_check",
    title: "Verify Telemetry Readiness",
    question: "Are logs even arriving?",
    icon: Waves,
    step2Label: "Pick Scenario",
  },
];

function RunTestPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedDetectionId = searchParams.get("detectionId");
  const focus = searchParams.get("focus");
  const techniqueFromExplore = searchParams.get("technique_id");
  const atomicIdFromExplore = searchParams.get("atomic_id");
  const atomicNameFromExplore = searchParams.get("atomic_name");
  const atomicNumberFromExplore = searchParams.get("atomic_number");
  const desiredStepRaw = searchParams.get("step");
  const preselectedEnvironment = searchParams.get("environment");
  const preselectedTargetHost = searchParams.get("targetHost");

  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedDetection, setSelectedDetection] = useState<string>("");
  const [selectedScenario, setSelectedScenario] = useState<string>("");
  const [environment, setEnvironment] = useState<"lab" | "dev" | "prod">("lab");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RunTestFieldErrors>({});
  const [testType, setTestType] = useState<UiTestType | null>(null);
  const [targetHost, setTargetHost] = useState<string>("");
  const [environmentRunners, setEnvironmentRunners] = useState<RunnerTargetRecord[]>([]);
  const [detectionSearch, setDetectionSearch] = useState<string>("");
  const [prodConfirmOpen, setProdConfirmOpen] = useState(false);
  const [prodConfirmReason, setProdConfirmReason] = useState("");
  const [prodConfirmError, setProdConfirmError] = useState<string | null>(null);
  const [newDetectionOpen, setNewDetectionOpen] = useState(false);
  const [newDetectionSaving, setNewDetectionSaving] = useState(false);
  const [newDetectionError, setNewDetectionError] = useState<string | null>(null);
  const [newDetectionTitle, setNewDetectionTitle] = useState("");
  const [newDetectionTechnique, setNewDetectionTechnique] = useState("");
  const [newDetectionSiemType, setNewDetectionSiemType] = useState("");
  const [newDetectionQuery, setNewDetectionQuery] = useState("");
  const [lastRunType, setLastRunType] = useState<UiTestType | null>(null);
  const [labOs, setLabOs] = useState<"windows" | "linux" | "both">("windows");
  const [runMode, setRunMode] = useState<"now" | "schedule">("now");
  const [scheduleType, setScheduleType] = useState<TestScheduleType>("once");
  const [scheduleTime, setScheduleTime] = useState<string>("");
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState<string>(DEFAULT_SCHEDULE_INTERVAL_MINUTES);
  const [isScheduling, setIsScheduling] = useState(false);
  const [mitreTechniques, setMitreTechniques] = useState<MitreTechnique[]>([]);
  const [coverageScenarioConfirmed, setCoverageScenarioConfirmed] = useState<boolean>(false);
  const [mitreLoadWarning, setMitreLoadWarning] = useState<string | null>(null);
  const [runnerLoadWarning, setRunnerLoadWarning] = useState<string | null>(null);
  const [selectedSubtechniqueId, setSelectedSubtechniqueId] = useState<string>("");
  const [currentStep, setCurrentStep] = useState<number>(1); // Step navigation state
  const [execution, setExecution] = useState<ExecutionState | null>(null);
  const [logsExpanded, setLogsExpanded] = useState<boolean>(false);
  const [atomicScenarioHint, setAtomicScenarioHint] = useState<{ name: string; description?: string } | null>(null);
  const [techniquePickerSearch, setTechniquePickerSearch] = useState<string>("");
  const [techniquePickerTactic, setTechniquePickerTactic] = useState<string>("all");
  const [techniquePickerPage, setTechniquePickerPage] = useState<number>(0);

  const { run: runTest, isRunning, result, error: runError, stillProcessing, setResult } = useRunTest();
  const { canRunTest, canScheduleTest, hasPermission, loading: permissionsLoading } = usePermissions();
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
    if (preselectedDetectionId || techniqueFromExplore || !focus) return;
    if (focus === "coverage") {
      setTestType("find_detection_coverage");
      setCurrentStep(2);
      return;
    }
    if (focus === "telemetry") {
      setTestType("telemetry_check");
      setCurrentStep(2);
      return;
    }
    if (focus === "validation") {
      setTestType("detection_validation");
      setCurrentStep(2);
    }
  }, [focus, preselectedDetectionId, techniqueFromExplore]);

  useEffect(() => {
    if (preselectedEnvironment === "lab" || preselectedEnvironment === "dev" || preselectedEnvironment === "prod") {
      setEnvironment(preselectedEnvironment);
    }
  }, [preselectedEnvironment]);

  useEffect(() => {
    if (preselectedTargetHost) {
      setTargetHost(preselectedTargetHost);
    }
  }, [preselectedTargetHost]);

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
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load detections.");
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
        const baseTechniqueId = (techniqueFromExplore || "").split(".")[0];
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

  // Coverage scenario is confirmed as soon as the user has a technique in focus.
  useEffect(() => {
    if (testType !== "find_detection_coverage") {
      setCoverageScenarioConfirmed(false);
      return;
    }
    setCoverageScenarioConfirmed(!!techniqueFromExplore);
  }, [testType, techniqueFromExplore]);

  // Load MITRE techniques lazily when needed for validation mode or explore coverage
  useEffect(() => {
    async function loadMitre() {
      if (mitreTechniques.length > 0) return;
      try {
        const data = await getMitreTechniques();
        setMitreTechniques(data);
        setMitreLoadWarning(null);
      } catch {
        setMitreLoadWarning("MITRE techniques could not be loaded. Technique labels and subtechnique selection may be incomplete.");
      }
    }

    if (
      (testType === "detection_validation" && selectedDetection) ||
      testType === "find_detection_coverage" ||
      testType === "telemetry_check" ||
      techniqueFromExplore
    ) {
      void loadMitre();
    }
  }, [testType, selectedDetection, techniqueFromExplore, mitreTechniques.length]);

  useEffect(() => {
    let cancelled = false;
    async function loadRunners() {
      try {
        const runners = await getEnvironmentRunners();
        if (cancelled) return;
        if (Array.isArray(runners)) {
          const withHostnames = (runners as RunnerTargetRecord[]).filter(
            (runner): runner is RunnerTargetRecord & { hostname: string } =>
              typeof runner.hostname === "string" && runner.hostname.trim().length > 0
          );
          setEnvironmentRunners(withHostnames);
        }
        setRunnerLoadWarning(null);
      } catch {
        if (!cancelled) {
          setRunnerLoadWarning("Runner targets could not be loaded. Enter the host manually or retry later.");
        }
      }
    }
    void loadRunners();
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

  const selectedAtomic = useMemo(() => {
    const parsedNumber = atomicNumberFromExplore ? Number.parseInt(atomicNumberFromExplore, 10) : undefined;
    const atomic: {
      atomic_test_id?: string;
      atomic_test_name?: string;
      atomic_test_number?: number;
    } = {};
    if (atomicIdFromExplore) atomic.atomic_test_id = atomicIdFromExplore;
    if (atomicNameFromExplore) atomic.atomic_test_name = atomicNameFromExplore;
    if (Number.isInteger(parsedNumber) && parsedNumber && parsedNumber > 0) {
      atomic.atomic_test_number = parsedNumber;
    }
    return Object.keys(atomic).length > 0 ? atomic : undefined;
  }, [atomicIdFromExplore, atomicNameFromExplore, atomicNumberFromExplore]);

  async function handleCreateDetection(e: React.FormEvent) {
    e.preventDefault();
    const title = newDetectionTitle.trim();
    const technique = newDetectionTechnique.trim().toUpperCase();
    const siemType = newDetectionSiemType.trim();
    const query = newDetectionQuery.trim();

    if (!title || !technique || !siemType || !query) {
      setNewDetectionError("Fill in title, technique, SIEM type, and query.");
      return;
    }

    setNewDetectionSaving(true);
    setNewDetectionError(null);
    try {
      const created = await createDetection({
        technique_id: technique,
        title,
        siem_type: siemType,
        siem_query: query,
      });
      setDetections((prev) => [created, ...prev]);
      setSelectedDetection(created.id);
      setNewDetectionOpen(false);
      setNewDetectionTitle("");
      setNewDetectionTechnique("");
      setNewDetectionSiemType("");
      setNewDetectionQuery("");
    } catch (err) {
      setNewDetectionError(err instanceof Error ? err.message : "Failed to create detection.");
    } finally {
      setNewDetectionSaving(false);
    }
  }

  async function handleRunTest(opts?: { prodOverride?: boolean; prodReason?: string }) {
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
    const targetHostCheck = targetHostSchema.safeParse(targetHost);
    if (!targetHostCheck.success) {
      const msg = targetHostCheck.error.issues[0]?.message || "Invalid host.";
      setFieldErrors((prev) => ({ ...prev, targetHost: msg }));
      setError(msg);
      return;
    }
    setFieldErrors((prev) => ({ ...prev, targetHost: undefined }));

    if (!environment) {
      setError("Select an environment for this run.");
      return;
    }

    // Production runs execute a real payload against a real production host.
    // Require an explicit, named confirmation before anything is submitted —
    // permission alone isn't the same as "approved for this specific run."
    if (environment === "prod" && !opts?.prodOverride) {
      setProdConfirmOpen(true);
      return;
    }

    setLastRunType(testType);

    // If the user chooses "schedule", create a schedule instead of running immediately.
    if (runMode === "schedule") {
      if (!canScheduleTest(environment)) {
        setError("You do not have permission to schedule tests in this environment.");
        return;
      }
      try {
        setIsScheduling(true);
        setError(null);

        const mode = uiToBackendMode[testType];

        if (scheduleType === "once") {
          const scheduleCheck = scheduleTimeSchema.safeParse(scheduleTime);
          if (!scheduleCheck.success) {
            const msg = scheduleCheck.error.issues[0]?.message || "Pick a valid date and time.";
            setFieldErrors((prev) => ({ ...prev, scheduleTime: msg }));
            setError(msg);
            return;
          }
          setFieldErrors((prev) => ({ ...prev, scheduleTime: undefined }));
        } else if (scheduleType === "interval") {
          const intervalCheck = scheduleIntervalSchema.safeParse(scheduleIntervalMinutes);
          if (!intervalCheck.success) {
            const msg = intervalCheck.error.issues[0]?.message || "Enter a valid interval.";
            setFieldErrors((prev) => ({ ...prev, scheduleInterval: msg }));
            setError(msg);
            return;
          }
          setFieldErrors((prev) => ({ ...prev, scheduleInterval: undefined }));
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
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create schedule.");
      } finally {
        setIsScheduling(false);
      }
      return;
    }

    // Start the run and move straight into the validation record.
    if (environment === "lab") {
      try {
        const created = await runTestApi({
          detectionId: detectionIdToUse,
          techniqueId: techniqueIdToUse,
          environment: "lab",
          mode: uiToBackendMode[testType],
          labOs,
          endpoint: targetHost.trim() || null,
          atomic: selectedAtomic,
        });
        router.push(`/tests/${created.id}`);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to start lab run.");
      }
      return;
    }

    const executionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
    const startTs = new Date().toISOString();
    const techniqueIdDisplay = techniqueIdToUse || techniqueFromExplore || selectedSubtechniqueId || "Unknown";
    const atomicSelector = selectedAtomic?.atomic_test_number
      ? ` -TestNumbers ${selectedAtomic.atomic_test_number}`
      : selectedAtomic?.atomic_test_name
        ? ` -TestNames "${selectedAtomic.atomic_test_name}"`
        : "";
    const atomicCommand = `Invoke-AtomicTest ${techniqueIdDisplay}${atomicSelector} -ComputerName ${targetHost || "target-host"}`;

    setExecution({
      id: executionId,
      status: "queued",
      started_at: startTs,
      atomic_command: atomicCommand,
      technique_id: techniqueIdDisplay,
      environment: environment.toUpperCase(),
      logs: [
        ...(environment === "prod" && opts?.prodReason
          ? [
              {
                id: `${executionId}-prod-confirm`,
                timestamp: startTs,
                step: `Production run confirmed. Reason: ${opts.prodReason}`,
                status: "success" as const,
              },
            ]
          : []),
        {
          id: `${executionId}-start`,
          timestamp: startTs,
          step: "Job queued for execution",
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
        atomic: selectedAtomic,
      },
      {
        onStart: (created) => {
          setExecution((prev) =>
            prev
              ? {
                  ...prev,
                  id: created.id ? String(created.id) : prev.id,
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

  const techniquePickerAllTactics = useMemo(
    () => Array.from(new Set(mitreTechniques.flatMap((t) => t.tactics || []))).sort(),
    [mitreTechniques]
  );

  const techniquePickerEnriched = useMemo(() => {
    const byTechnique = new Map<string, Detection[]>();
    for (const det of detections) {
      if (!det.technique_id) continue;
      const list = byTechnique.get(det.technique_id) || [];
      list.push(det);
      byTechnique.set(det.technique_id, list);
    }
    return mitreTechniques.map((t) => {
      const mapped = byTechnique.get(t.id) || [];
      const tested = mapped.filter((d) => Boolean(d.last_result));
      const validated = mapped.filter((d) => (d.last_result || "").toUpperCase() === "PASS");
      const highestScore = mapped.reduce<number | undefined>((best, d) => {
        if (typeof d.last_score !== "number") return best;
        if (typeof best !== "number") return d.last_score;
        return Math.max(best, d.last_score);
      }, undefined);
      let status: "validated" | "at_risk" | "mapped" | "unmapped";
      if (validated.length > 0) status = "validated";
      else if (tested.length > 0) status = "at_risk";
      else if (mapped.length > 0) status = "mapped";
      else status = "unmapped";
      return {
        id: t.id,
        name: t.name || t.id,
        tactics: t.tactics || [],
        mappedCount: mapped.length,
        validatedCount: validated.length,
        highestScore,
        status,
      };
    });
  }, [detections, mitreTechniques]);

  const techniquePickerFiltered = useMemo(() => {
    const q = techniquePickerSearch.toLowerCase().trim();
    const list = techniquePickerEnriched.filter((item) => {
      if (techniquePickerTactic !== "all" && !item.tactics.includes(techniquePickerTactic)) return false;
      if (q && !item.id.toLowerCase().includes(q) && !item.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const priority = { unmapped: 0, mapped: 1, at_risk: 2, validated: 3 } as const;
    list.sort((a, b) => priority[a.status] - priority[b.status]);
    return list;
  }, [techniquePickerEnriched, techniquePickerSearch, techniquePickerTactic]);

  const TECHNIQUE_PICKER_PAGE_SIZE = 12;
  const techniquePickerTotalPages = Math.max(
    1,
    Math.ceil(techniquePickerFiltered.length / TECHNIQUE_PICKER_PAGE_SIZE)
  );
  const techniquePickerPageSlice = techniquePickerFiltered.slice(
    techniquePickerPage * TECHNIQUE_PICKER_PAGE_SIZE,
    (techniquePickerPage + 1) * TECHNIQUE_PICKER_PAGE_SIZE
  );

  const TECHNIQUE_STATUS_META: Record<
    "validated" | "at_risk" | "mapped" | "unmapped",
    { label: string; tone: NonNullable<ChipProps["tone"]> }
  > = {
    validated: { label: "Validated", tone: "success" },
    at_risk: { label: "At risk", tone: "warning" },
    mapped: { label: "Mapped only", tone: "info" },
    unmapped: { label: "Unmapped", tone: "muted" },
  };

  // Only offer runners actually registered for the environment that's selected —
  // a lab-only runner must never show up as a selectable target while Prod is chosen.
  const runnerTargets = useMemo(() => {
    const hosts = environmentRunners
      .filter((runner) => !environment || runner.environment_name === environment)
      .map((runner) => runner.hostname as string);
    return Array.from(new Set(hosts));
  }, [environmentRunners, environment]);

  useEffect(() => {
    if (targetHost && runnerTargets.length > 0 && !runnerTargets.includes(targetHost)) {
      setTargetHost("");
    }
  }, [environment, runnerTargets, targetHost]);

  // A prod confirmation is only valid for the run config it was given for —
  // if the target changes underneath it, make the operator confirm again.
  useEffect(() => {
    setProdConfirmReason("");
    setProdConfirmError(null);
  }, [environment, selectedDetection, selectedScenario, techniqueFromExplore, targetHost]);

  const canSelectTargetHost =
    !!testType &&
    ((testType === "telemetry_check" && !!selectedScenario) ||
      (testType === "find_detection_coverage" && coverageScenarioConfirmed) ||
      (testType === "detection_validation" && !!selectedDetection));

  const canRun =
    !!testType &&
    !!environment &&
    !!targetHost.trim() &&
    ((testType === "telemetry_check" && !!selectedScenario) ||
      (testType === "detection_validation" && !!selectedDetection) ||
      (testType === "find_detection_coverage" && coverageScenarioConfirmed)) &&
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
      (testType === "find_detection_coverage" && coverageScenarioConfirmed));
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

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <PageContainer>
      <div className="mb-6">
        <TestsHubTabs />
      </div>

      {/* Main Configuration Card */}
      <Card className="border border-[var(--stroke-soft)] shadow-[var(--shadow-soft)] rounded-2xl">
        <CardContent className="pt-6">
          <div className="space-y-8">
            {/* Step 1: Validation Mode Selection */}
            <div className={cn("space-y-4", currentStep < 1 && "opacity-50")}>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <h2 className="text-xl font-display font-semibold text-[var(--foreground)] flex items-center gap-2">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-strong)] border border-[var(--accent-line)] text-[18px] font-bold">
                      1
                    </span>
                    Select Validation Mode
                  </h2>
                  <p className="text-sm text-[var(--surface-subtle-foreground)] ml-9">
                    Choose the kind of validation you need
                  </p>
                    </div>
                  </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 ml-9 pt-3 border-t border-[var(--stroke-soft)]">
                {TEST_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const isActive = testType === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        setTestType(mode.id);
                        setSelectedDetection("");
                        setSelectedScenario("");
                        setTargetHost("");
                        setResult(null);
                        setError(null);
                        setCurrentStep(2);
                      }}
                      className={cn(
                        "relative overflow-hidden p-4 rounded-xl border-2 transition-all text-left group bg-[var(--surface-card)]",
                        isActive
                          ? "border-[var(--accent-strong)] shadow-sm"
                          : "border-[var(--stroke-soft)] hover:border-[var(--accent-line)]"
                      )}
                    >
                      <div
                        className={cn(
                          "absolute inset-x-0 top-0 h-1 transition-all",
                          isActive ? "bg-[var(--accent-strong)]" : "bg-transparent"
                        )}
                      />
                      <div className="flex items-start gap-3">
                        <div
                          className={cn(
                            "h-10 w-10 rounded-lg flex items-center justify-center transition-colors",
                            isActive
                              ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                              : "bg-[var(--surface-subtle)] text-[var(--surface-subtle-foreground)]"
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <h3 className="font-display font-semibold text-[var(--foreground)]">{mode.title}</h3>
                          <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">{mode.question}</p>
                        </div>
                        {isActive && (
                          <CheckCircle2 className="h-5 w-5 text-[var(--accent-strong)] flex-shrink-0" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 2: Detection/Scenario Selection */}
              {currentStep >= 2 && (
            <div className={cn("space-y-4 border-t border-[var(--stroke-soft)] pt-8", currentStep < 2 && "opacity-50")}>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h2 className="text-xl font-display font-semibold text-[var(--foreground)] flex items-center gap-2">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-strong)] border border-[var(--accent-line)] text-[18px] font-bold">
                      2
                    </span>
                        {testType === "telemetry_check"
                        ? "Choose Attack Scenario"
                          : testType === "detection_validation"
                        ? "Select Detection to Validate"
                        : "Choose ATT&CK Technique"}
                    </h2>
                    <p className="text-sm text-[var(--surface-subtle-foreground)] ml-9">
                      {testType === "detection_validation"
                        ? "Select the detection rule you want to validate"
                        : testType === "find_detection_coverage"
                        ? "Choose an attack scenario to test coverage"
                        : "Select a scenario to verify telemetry"}
                    </p>
                  </div>
                {loading && (
                  <div className="flex items-center gap-2 text-sm text-[var(--surface-subtle-foreground)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                )}
              </div>

              {!testType && (
                <div className="ml-9 p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                  <p className="text-sm text-[var(--surface-subtle-foreground)]">
                    Select a validation mode in Step 1 to continue
                  </p>
                  </div>
                )}

                {testType && testType === "detection_validation" && (
                    <div className="ml-9 space-y-4">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--surface-subtle-foreground)]" />
                          <Input
                            type="text"
                            value={detectionSearch}
                            onChange={(e) => setDetectionSearch(e.target.value)}
                            placeholder="Search detections by name, MITRE technique, or SIEM type..."
                          className="pl-10 h-10 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-sm text-[var(--foreground)] placeholder:text-[var(--surface-subtle-foreground)]"
                            disabled={isRunning}
                          />
                        </div>
                        {hasPermission(Permission.DETECTIONS_CREATE) && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-10 shrink-0"
                            onClick={() => setNewDetectionOpen(true)}
                            disabled={isRunning}
                          >
                            <Plus className="mr-1.5 h-4 w-4" />
                            New detection
                          </Button>
                        )}
                      </div>
                    <div className="max-h-64 overflow-y-auto overflow-x-hidden hide-scrollbar space-y-2 border border-[var(--stroke-soft)] rounded-lg p-2 bg-[var(--surface-card)]">
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
                                  "w-full text-left px-4 py-3 rounded-lg border-2 transition-all bg-[var(--surface-card)]",
                                  isRunning
                                    ? "border-[var(--stroke-soft)] text-[var(--surface-subtle-foreground)] cursor-not-allowed"
                                    : isSelected
                                    ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--foreground)] shadow-sm"
                                    : "border-[var(--stroke-soft)] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] cursor-pointer"
                                )}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-sm truncate text-[var(--foreground)]">{det.title}</div>
                                    <div className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
                                    {det.technique_id} · {det.siem_type?.toUpperCase() || "SIEM"}
                                    </div>
                                  </div>
                                  {isSelected && (
                                    <CheckCircle2 className="h-5 w-5 text-[var(--accent-strong)] flex-shrink-0 ml-2" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        {detectionsForUi.length === 0 && (
                          <div className="p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] text-center space-y-2">
                            <p className="text-sm text-[var(--surface-subtle-foreground)]">
                              No detections yet.
                            </p>
                            {hasPermission(Permission.DETECTIONS_CREATE) ? (
                              <Button type="button" variant="outline" size="sm" onClick={() => setNewDetectionOpen(true)}>
                                <Plus className="mr-1.5 h-3.5 w-3.5" />
                                Add a detection
                              </Button>
                            ) : (
                              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                                Ask an admin to add one, or sync detections from git in Settings.
                              </p>
                            )}
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
                          <p className="text-xs text-[var(--surface-subtle-foreground)] mt-2">
                            Showing <span className="font-semibold text-[var(--foreground)]">{visibleCount}</span> of{" "}
                            <span className="font-semibold text-[var(--foreground)]">{detections.length}</span> detections
                          </p>
                        );
                      })()}
                      {techniqueFromExplore && scenarioNameFromExplore && (
                        <p className="mt-1 text-[11px] text-[var(--surface-subtle-foreground)]">
                          Scenario from Explore:{" "}
                          <span className="font-semibold text-[var(--foreground)]">
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
                          <div className="mt-4 space-y-2 border-t border-[var(--stroke-soft)] pt-4">
                            <div>
                              <p className="text-sm font-semibold text-[var(--foreground)]">
                                Optional: Choose Subtechnique
                            </p>
                              <p className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
                                Select a specific ATT&CK subtechnique, or skip to use the detection&apos;s primary technique
                            </p>
                            </div>
                            <div className="max-h-40 overflow-y-auto overflow-x-hidden hide-scrollbar space-y-2 border border-[var(--stroke-soft)] rounded-lg p-2 bg-[var(--surface-card)]">
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
                                      "w-full text-left px-4 py-2 rounded-lg border-2 transition-all bg-[var(--surface-card)]",
                                      isSelected
                                        ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--foreground)] shadow-sm"
                                        : "border-[var(--stroke-soft)] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] cursor-pointer"
                                    )}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate text-[var(--foreground)]">
                                        {t.id} · {t.name}
                                        </div>
                                        <div className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
                                        {t.tactics.join(", ")}
                                        </div>
                                      </div>
                                      {isSelected && (
                                        <CheckCircle2 className="h-5 w-5 text-[var(--accent-strong)] flex-shrink-0 ml-2" />
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
                      <SelectTrigger className="w-full h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]">
                        <SelectValue placeholder="Select a test scenario template" />
              </SelectTrigger>
                      <SelectContent className="bg-[var(--surface-card)] border-[var(--stroke-soft)]">
                        {telemetryScenarios.map((scenario) => (
                          <SelectItem key={scenario.id} value={scenario.id}>
                            <div className="flex flex-col">
                              <span className="font-medium text-[var(--foreground)]">{scenario.label}</span>
                              <span className="text-xs text-[var(--surface-subtle-foreground)]">{scenario.subtitle}</span>
                            </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
                    {selectedScenario && (() => {
                      const selectedScenarioData = telemetryScenarios.find((s) => s.id === selectedScenario);
                      const selectedDetectionData = detections.find((d) => d.id === selectedScenario);
                      return selectedScenarioData ? (
                        <div className="space-y-3 p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                          <div>
                            <div className="text-sm font-medium text-[var(--foreground)] flex flex-col gap-0.5">
                              <span>Scenario:</span>
                              <span>{selectedScenarioData.label}</span>
                              {selectedScenarioData.subtitle && (
                                <span className="text-xs text-[var(--surface-subtle-foreground)]">{selectedScenarioData.subtitle}</span>
                              )}
                            </div>
                            {selectedDetectionData?.technique_id && (
                              <p className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
                                Technique: {selectedDetectionData.technique_id}
                              </p>
                            )}
                          </div>
                            <p className="text-sm text-[var(--foreground)]">
                              {selectedScenarioData.subtitle
                                ? selectedScenarioData.subtitle
                                : "PurveX will run this scenario and look for telemetry and evidence in your SIEM, even without an onboarded detection rule."}
                            </p>
                        </div>
                      ) : null;
                    })()}
                    {telemetryScenarios.length === 0 && (
                      <div className="p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                        <p className="text-sm text-[var(--surface-subtle-foreground)]">
                          No validation scenarios are available yet. Add at least one detection or scenario template first.
                      </p>
                      </div>
                    )}
                  </div>
                )}

                {testType === "find_detection_coverage" && (
                    <div className="ml-9 space-y-3">
                      {techniqueFromExplore ? (
                        <div className="space-y-3 p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                        <div>
                            <p className="text-sm font-medium text-[var(--foreground)]">
                              Scenario: {scenarioCardTitle}
                          </p>
                            <p className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
                              Technique ID: {techniqueFromExplore}
                              {scenarioNameFromExplore && (
                                <span className="ml-2 text-[var(--foreground)]">
                                  • {scenarioNameFromExplore}
                                </span>
                              )}
                            </p>
                        </div>
                        <p className="text-sm text-[var(--foreground)]">
                          {scenarioDescriptionFromExplore ||
                            "PurveX will run this scenario and look for telemetry and evidence in your SIEM, even without an onboarded detection rule."}
                        </p>
                          <div className="flex items-center gap-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9 px-3"
                              onClick={() => setCoverageScenarioConfirmed(true)}
                              disabled={coverageScenarioConfirmed}
                            >
                              {coverageScenarioConfirmed ? "Scenario selected" : "Use this scenario"}
                            </Button>
                            {coverageScenarioConfirmed && (
                              <Chip tone="success">Ready for Step 3</Chip>
                            )}
                          </div>
                        {detections.filter((d) => d.technique_id === techniqueFromExplore).length === 0 && (
                          <div className={cn("p-3 rounded-lg border", toneClasses("warning").border, `${toneClasses("warning").bg}/10`)}>
                            <p className={cn("text-sm", toneClasses("warning").text)}>
                              No detection rules match {techniqueFromExplore}. You can still run this test to verify telemetry and discover gaps.
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
                        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--stroke-soft)]/60 p-4">
                          <div className="relative min-w-[240px] flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--surface-subtle-foreground)]" />
                            <Input
                              value={techniquePickerSearch}
                              onChange={(e) => {
                                setTechniquePickerSearch(e.target.value);
                                setTechniquePickerPage(0);
                              }}
                              placeholder="Search techniques by ID or name"
                              className="h-10 border-[var(--stroke-soft)] bg-[var(--surface-card)] pl-9 text-sm"
                            />
                          </div>
                          <Select
                            value={techniquePickerTactic}
                            onValueChange={(v) => {
                              setTechniquePickerTactic(v);
                              setTechniquePickerPage(0);
                            }}
                          >
                            <SelectTrigger className="h-10 w-[200px] border-[var(--stroke-soft)] bg-[var(--surface-card)] text-sm">
                              <SelectValue placeholder="All tactics" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All tactics</SelectItem>
                              {techniquePickerAllTactics.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            asChild
                            className="border-[var(--stroke-soft)] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)]"
                          >
                            <Link href="/tests/explore">
                              Open full explore view
                            </Link>
                          </Button>
                        </div>

                        {mitreTechniques.length === 0 ? (
                          <div className="flex items-center justify-center p-12 text-sm text-[var(--surface-subtle-foreground)]">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading techniques...
                          </div>
                        ) : techniquePickerPageSlice.length === 0 ? (
                          <div className="p-12 text-center">
                            <p className="text-sm font-semibold text-[var(--foreground)]">No techniques match your filters</p>
                            <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">Try broadening your search or clearing filters.</p>
                          </div>
                        ) : (
                          <>
                            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                              {techniquePickerPageSlice.map((item) => {
                                const meta = TECHNIQUE_STATUS_META[item.status];
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                      router.push(
                                        `/run-test?technique_id=${encodeURIComponent(item.id)}&focus=validation&step=2`
                                      );
                                    }}
                                    className="group flex flex-col rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4 text-left transition hover:border-[var(--accent-line)]"
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-mono text-xs font-bold text-[var(--accent-strong)]">{item.id}</span>
                                      <Chip tone={meta.tone} dot>
                                        {meta.label}
                                      </Chip>
                                    </div>
                                    <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm font-semibold text-[var(--foreground)]">
                                      {item.name}
                                    </p>
                                    <p className="mt-1 truncate text-xs text-[var(--surface-subtle-foreground)]">
                                      {item.tactics[0] || "No tactic"}
                                    </p>
                                    <div className="mt-3 flex items-center justify-between border-t border-[var(--stroke-soft)]/60 pt-3 text-xs text-[var(--surface-subtle-foreground)]">
                                      <div>
                                        <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Mapped</p>
                                        <p className="font-semibold text-[var(--foreground)]">{item.mappedCount}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Passing</p>
                                        <p className="font-semibold text-[var(--foreground)]">{item.validatedCount}</p>
                                      </div>
                                      <div>
                                        <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Best</p>
                                        <p className="font-semibold text-[var(--foreground)]">
                                          {typeof item.highestScore === "number" ? item.highestScore : "—"}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] py-1.5 text-xs font-semibold text-[var(--foreground)] transition group-hover:border-[var(--accent-line)] group-hover:bg-[var(--accent-soft)] group-hover:text-[var(--accent-strong)]">
                                      <Play className="h-3 w-3" />
                                      Select technique
                                    </div>
                                  </button>
                                );
                              })}
                            </div>

                            {techniquePickerTotalPages > 1 && (
                              <div className="flex items-center justify-between border-t border-[var(--stroke-soft)]/60 px-4 py-3">
                                <p className="text-xs text-[var(--surface-subtle-foreground)]">
                                  Showing {techniquePickerPage * TECHNIQUE_PICKER_PAGE_SIZE + 1}–
                                  {Math.min(
                                    (techniquePickerPage + 1) * TECHNIQUE_PICKER_PAGE_SIZE,
                                    techniquePickerFiltered.length
                                  )}{" "}
                                  of {techniquePickerFiltered.length}
                                </p>
                                <div className="flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() => setTechniquePickerPage(Math.max(0, techniquePickerPage - 1))}
                                    disabled={techniquePickerPage === 0}
                                  >
                                    <ChevronLeft className="h-4 w-4" />
                                  </Button>
                                  <span className="text-xs text-[var(--surface-subtle-foreground)]">
                                    {techniquePickerPage + 1} / {techniquePickerTotalPages}
                                  </span>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={() =>
                                      setTechniquePickerPage(
                                        Math.min(techniquePickerTotalPages - 1, techniquePickerPage + 1)
                                      )
                                    }
                                    disabled={techniquePickerPage >= techniquePickerTotalPages - 1}
                                  >
                                    <ChevronRight className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

            {/* Step 3: Environment Configuration */}
            {step2Done && (
            <div className="space-y-8 border-t border-[var(--stroke-soft)] pt-8">
                <div className="space-y-2">
                  <h2 className="text-xl font-display font-semibold text-[var(--foreground)] flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-strong)] border border-[var(--accent-line)] text-[18px] font-bold">
                      3
                    </span>
                    Environment & Target
                  </h2>
                  <p className="text-sm text-[var(--surface-subtle-foreground)] pl-11">
                    Configure where and how to run this validation
                  </p>
                </div>

                {/* Configuration Summary */}
                {step2Done && (
                  <div className="p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] space-y-3">
                    <p className="text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)] font-medium">Configuration Summary</p>
                    <div className="flex flex-wrap gap-2">
                      <Chip tone="accent">
                        Mode: {testType === "detection_validation"
                          ? "Validate a Detection"
                          : testType === "find_detection_coverage"
                          ? "Explore Coverage"
                          : "Verify Telemetry Readiness"}
                      </Chip>
                      {techniqueFromExplore && (
                        <Chip tone="accent">{techniqueFromExplore}</Chip>
                      )}
                      {environment && (
                        <Chip tone="neutral">
                          {environment === "lab" ? "Lab" : environment === "dev" ? "Dev" : "Prod"}
                        </Chip>
                      )}
                      {targetHost && (
                        <Chip tone="neutral">{targetHost}</Chip>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-3">
                    <Label htmlFor="environment-select" className="text-[var(--foreground)] text-sm font-medium flex items-center gap-2">
                      <Server className="h-4 w-4 text-[var(--surface-subtle-foreground)]" />
                      Environment
                    </Label>
                    <Select
                      onValueChange={(value: "lab" | "dev" | "prod") => setEnvironment(value)}
                      value={environment}
                      disabled={isRunning || !testType}
                    >
                      <SelectTrigger
                        id="environment-select"
                        className="w-full h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]"
                      >
                        <SelectValue placeholder="Select environment" />
                      </SelectTrigger>
                      <SelectContent className="bg-[var(--surface-card)] border-[var(--stroke-soft)]">
                        {canRunTest("lab") && <SelectItem value="lab">Lab (PurveX)</SelectItem>}
                        {canRunTest("dev") && <SelectItem value="dev">Dev</SelectItem>}
                        {canRunTest("prod") && <SelectItem value="prod">Prod (restricted)</SelectItem>}
                        {!canRunTest("lab") && !canRunTest("dev") && !canRunTest("prod") && (
                          <SelectItem value="lab" disabled>No permissions</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">
                      Choose the environment where this validation will run
                    </p>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="target-host" className="text-[var(--foreground)] text-sm font-medium flex items-center gap-2">
                      <Settings className="h-4 w-4 text-[var(--surface-subtle-foreground)]" />
                      Target Host
                    </Label>
                    {runnerTargets.length > 0 ? (
                      <Select
                        value={targetHost}
                        onValueChange={(value) => {
                          setTargetHost(value);
                          if (fieldErrors.targetHost) {
                            setFieldErrors((prev) => ({ ...prev, targetHost: undefined }));
                          }
                        }}
                        disabled={isRunning || !canSelectTargetHost}
                      >
                        <SelectTrigger
                          id="target-host"
                          aria-invalid={!!fieldErrors.targetHost}
                          aria-describedby="target-host-error"
                          className="w-full h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]"
                        >
                          <SelectValue placeholder="Select a runner" />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--surface-card)] border-[var(--stroke-soft)]">
                          {runnerTargets.map((host) => (
                            <SelectItem key={host} value={host}>{host}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="target-host"
                        value={targetHost}
                        onChange={(e) => {
                          setTargetHost(e.target.value);
                          if (fieldErrors.targetHost) {
                            setFieldErrors((prev) => ({ ...prev, targetHost: undefined }));
                          }
                        }}
                        aria-invalid={!!fieldErrors.targetHost}
                        aria-describedby="target-host-error"
                        placeholder="e.g. win-lab-01 or 10.0.0.5"
                        className="h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)] placeholder:text-[var(--surface-subtle-foreground)]"
                        disabled={isRunning || !canSelectTargetHost}
                      />
                    )}
                    <FieldError id="target-host-error" message={fieldErrors.targetHost} />
                    <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">
                      {runnerTargets.length === 0 && environmentRunners.length > 0
                        ? `No runners are registered for ${environment}. Double-check this hostname belongs to that environment before running.`
                        : "The specific host where the scenario will run. Telemetry and validation evidence will be tied to this host."}
                    </p>
                  </div>
                </div>

                {environment === "lab" && (
                  <div className="mt-6 space-y-3">
                    <div className="space-y-3">
                      <Label className="text-[var(--foreground)] text-sm font-medium">
                        Lab Operating System
                      </Label>
                      <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">
                        Choose which lab VMs this scenario should exercise
                      </p>
                      <div className="inline-flex rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
                        <button
                          type="button"
                          className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium transition-all border",
                            labOs === "windows"
                              ? "bg-[var(--surface-card)] text-[var(--foreground)] border-[var(--stroke-soft)] shadow-sm"
                              : "text-[var(--surface-subtle-foreground)] border-transparent hover:text-[var(--foreground)] hover:bg-[var(--surface-card)]"
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
                              ? "bg-[var(--surface-card)] text-[var(--foreground)] border-[var(--stroke-soft)] shadow-sm"
                              : "text-[var(--surface-subtle-foreground)] border-transparent hover:text-[var(--foreground)] hover:bg-[var(--surface-card)]"
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
                              ? "bg-[var(--surface-card)] text-[var(--foreground)] border-[var(--stroke-soft)] shadow-sm"
                              : "text-[var(--surface-subtle-foreground)] border-transparent hover:text-[var(--foreground)] hover:bg-[var(--surface-card)]"
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
        {!error && stillProcessing && (
                  <div className={cn("p-4 rounded-lg border", toneClasses("info").border, `${toneClasses("info").bg}/10`)}>
                    <div className="flex items-center gap-2">
                      <Loader2 className={cn("h-5 w-5 animate-spin", toneClasses("info").icon)} />
                      <p className={cn("text-sm", toneClasses("info").text)}>{stillProcessing}</p>
                    </div>
                  </div>
                )}
        {(mitreLoadWarning || runnerLoadWarning) && (
                  <div className="p-4 rounded-lg border border-amber-300 bg-amber-50">
                    <div className="space-y-2 text-sm text-amber-900">
                      {mitreLoadWarning && (
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
                          <p>{mitreLoadWarning}</p>
                        </div>
                      )}
                      {runnerLoadWarning && (
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
                          <p>{runnerLoadWarning}</p>
                        </div>
                      )}
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
                <div className="space-y-4 pt-6 border-t border-[var(--stroke-soft)]">
                  <div className="space-y-3">
                    <Label className="text-[var(--foreground)] text-sm font-medium">Run Mode</Label>
                    <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">
                      Choose to run immediately or set a schedule.
                    </p>
                    <div className="inline-flex rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
                        <button
                          type="button"
                          className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium transition-all border",
                            runMode === "now"
                              ? "bg-[var(--surface-card)] text-[var(--foreground)] border-[var(--stroke-soft)] shadow-sm"
                              : "text-[var(--surface-subtle-foreground)] border-transparent hover:text-[var(--foreground)] hover:bg-[var(--surface-card)]"
                          )}
                          onClick={() => setRunMode("now")}
                          disabled={isRunning || isScheduling}
                        >
                        Run now
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "px-4 py-2 rounded-md text-sm font-medium transition-all border",
                            runMode === "schedule"
                              ? "bg-[var(--surface-card)] text-[var(--foreground)] border-[var(--stroke-soft)] shadow-sm"
                              : "text-[var(--surface-subtle-foreground)] border-transparent hover:text-[var(--foreground)] hover:bg-[var(--surface-card)]"
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
                    <div className="mt-4 space-y-4 p-5 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                      <p className="text-sm font-medium text-[var(--foreground)]">Schedule Configuration</p>
                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-3">
                          <Label htmlFor="schedule-type" className="text-sm text-[var(--foreground)] font-medium">
                            Schedule Type
                              </Label>
                              <Select
                                value={scheduleType}
                                onValueChange={(v: string) => setScheduleType(v as TestScheduleType)}
                              >
                            <SelectTrigger id="schedule-type" className="h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]">
                                  <SelectValue placeholder="Select schedule type" />
                                </SelectTrigger>
                            <SelectContent className="bg-[var(--surface-card)] border-[var(--stroke-soft)]">
                                  <SelectItem value="once">Run once at specific time</SelectItem>
                                  <SelectItem value="interval">Repeat at regular intervals</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-3">
                              {scheduleType === "once" ? (
                                <>
                              <Label htmlFor="schedule-time" className="text-sm text-[var(--foreground)] font-medium">
                                Date & Time
                                  </Label>
                                  <Input
                                    id="schedule-time"
                                    type="datetime-local"
                                    value={scheduleTime}
                                    onChange={(e) => {
                                      setScheduleTime(e.target.value);
                                      if (fieldErrors.scheduleTime) {
                                        setFieldErrors((prev) => ({ ...prev, scheduleTime: undefined }));
                                      }
                                    }}
                                    aria-invalid={!!fieldErrors.scheduleTime}
                                    aria-describedby="schedule-time-error"
                                className="h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]"
                                    placeholder="Select date and time"
                                  />
                                  <FieldError id="schedule-time-error" message={fieldErrors.scheduleTime} />
                                </>
                              ) : (
                                <>
                              <Label htmlFor="schedule-interval" className="text-sm text-[var(--foreground)] font-medium">
                                Interval (minutes)
                                  </Label>
                                    <Input
                                      id="schedule-interval"
                                      type="number"
                                      min={1}
                                      value={scheduleIntervalMinutes}
                                      onChange={(e) => {
                                        setScheduleIntervalMinutes(e.target.value);
                                        if (fieldErrors.scheduleInterval) {
                                          setFieldErrors((prev) => ({ ...prev, scheduleInterval: undefined }));
                                        }
                                      }}
                                      aria-invalid={!!fieldErrors.scheduleInterval}
                                      aria-describedby="schedule-interval-error"
                                className="h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]"
                                      placeholder="60"
                                    />
                                  <FieldError id="schedule-interval-error" message={fieldErrors.scheduleInterval} />
                                </>
                              )}
                            </div>
                          </div>
                      <div className="p-3 rounded-lg bg-[var(--surface-subtle)] border border-[var(--stroke-soft)]">
                        <p className="text-xs text-[var(--foreground)]">
                          Scheduling is permission-scoped by environment. Production scheduling requires explicit production scheduling permission.
                        </p>
                      </div>
                      </div>
                    )}

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between gap-4 pt-6 border-t border-[var(--stroke-soft)]">
                    {currentStep > 1 && (
                      <Button
                        onClick={handlePrevious}
                        variant="outline"
                        className="h-11 px-4"
                      >
                        <ChevronLeft className="h-4 w-4 mr-2" />
                        Previous
                      </Button>
                    )}
                  <Button
                    onClick={() => void handleRunTest()}
                    disabled={!canRun}
                    className={cn(
                      "flex-1 h-12 text-base font-semibold border transition-all",
                      canRun
                        ? "border-transparent bg-[var(--accent-strong)] text-white hover:opacity-90 shadow-sm focus-visible:ring-[var(--accent-line)]"
                        : "border-[var(--stroke-soft)] bg-[var(--surface-subtle)] text-[var(--surface-subtle-foreground)] cursor-not-allowed"
                    )}
                    aria-label={isRunning ? "Validation is running" : canRun ? "Run the validation" : "Complete all steps to run validation"}
                  >
                    {isRunning ? (
                      <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Running validation...
                      </>
                    ) : (
                      <>
                          <Play className="mr-2 h-5 w-5" />
                          {runMode === "schedule" ? "Save schedule" : "Run validation"}
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

      {/* Validation Result */}
      {result && (
        <Card className="mt-6 border border-[var(--stroke-soft)] shadow-[var(--shadow-soft)] rounded-2xl bg-[var(--surface-card)]">
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base font-semibold text-[var(--foreground)]">
              Validation result
            </CardTitle>
            {lastRunType && (
              <Chip tone="accent" className="uppercase tracking-[0.18em]">
                Mode
                <span className="font-semibold normal-case tracking-normal">
                  {lastRunType === "detection_validation"
                    ? "Detection validation"
                    : lastRunType === "find_detection_coverage"
                    ? "Find detections"
                    : "Telemetry check"}
                </span>
              </Chip>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-[var(--foreground)]">
            {(() => {
              const isTelemetryRun = lastRunType === "telemetry_check";
              const bannerByType: Record<
                HighLevelResultType,
                { tone: NonNullable<ChipProps["tone"]>; icon: ReactNode; title: string; sub: string }
              > = {
                PASS: isTelemetryRun
                  ? {
                      tone: "success" as const,
                      icon: <CheckCircle2 className={cn("h-4 w-4", toneClasses("success").icon)} />,
                      title: "Telemetry confirmed",
                      sub: "Matching events arrived in the SIEM. Detection rule was not evaluated.",
                    }
                  : {
                      tone: "success" as const,
                      icon: <CheckCircle2 className={cn("h-4 w-4", toneClasses("success").icon)} />,
                      title: "Detection validated",
                      sub: "Evidence was ingested and the detection fired.",
                    },
                FAIL_RULE_VISIBILITY: {
                  tone: "warning" as const,
                  icon: <AlertTriangle className={cn("h-4 w-4", toneClasses("warning").icon)} />,
                  title: "Detection needs tuning",
                  sub: "Logs were ingested, but the detection rule did not fire.",
                },
                NO_LOGS: isTelemetryRun
                  ? {
                      tone: "danger" as const,
                      icon: <XCircle className={cn("h-4 w-4", toneClasses("danger").icon)} />,
                      title: "No logs",
                      sub: "No matching events arrived in the SIEM. Check log sources, agents, and ingestion pipelines.",
                    }
                  : {
                      tone: "danger" as const,
                      icon: <XCircle className={cn("h-4 w-4", toneClasses("danger").icon)} />,
                      title: "No evidence found",
                      sub: "No expected evidence was seen in your SIEM. This indicates a telemetry or ingestion issue.",
                    },
                SYSTEM_ERROR: {
                  tone: "muted" as const,
                  icon: <Slash className={cn("h-4 w-4", toneClasses("muted").icon)} />,
                  title: "System error",
                  sub: "PurveX could not evaluate this validation run due to a system or SIEM error.",
                },
              };

              const meta = bannerByType[result.result_type];

              return (
                <>
                  <div
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-3 py-3 text-xs",
                      toneClasses(meta.tone).border,
                      `${toneClasses(meta.tone).bg}/10`,
                      toneClasses(meta.tone).text,
                    )}
                  >
                    <div className="mt-0.5">{meta.icon}</div>
                    <div className="space-y-0.5">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--surface-subtle-foreground)]">
                        {result.result_type}
                      </div>
                      <p className="text-[var(--foreground)] text-sm">{meta.title}</p>
                      <p className="text-[11px] text-[var(--surface-subtle-foreground)]">{meta.sub}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-3 space-y-1.5">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--surface-subtle-foreground)]">
                        Telemetry
                      </div>
                      <p className="text-[11px] text-[var(--foreground)]">
                        Evidence present:{" "}
                        <span className="font-semibold text-[var(--foreground)]">
                          {result.telemetry_summary.has_logs ? "Yes" : "No"}
                        </span>
                      </p>
                      <p className="text-[11px] text-[var(--foreground)]">
                        Records found:{" "}
                        <span className="font-semibold text-[var(--foreground)]">{result.telemetry_summary.events_found}</span>
                      </p>
                    </div>

                    {lastRunType !== "telemetry_check" && result.detection_summary && (
                      <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-3 space-y-1.5">
                        <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--surface-subtle-foreground)]">
                          Detection
                        </div>
                        <p className="text-[11px] text-[var(--foreground)]">
                          Detection fired:{" "}
                          <span className="font-semibold text-[var(--foreground)]">
                            {result.detection_summary.rule_fired ? "Yes" : "No"}
                          </span>
                        </p>
                        <p className="text-[11px] text-[var(--foreground)]">
                          Matches found:{" "}
                          <span className="font-semibold text-[var(--foreground)]">
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
                      className="border-[var(--stroke-soft)] text-[11px] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)]"
                      onClick={() => void handleRunTest()}
                      disabled={!canRun}
                    >
                      Run validation again
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-[var(--stroke-soft)] text-[11px] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)]"
                      onClick={() => router.push(`/tests/${result.run_id}`)}
                    >
                      View validation report
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

      <Dialog
        open={prodConfirmOpen}
        onOpenChange={(open) => {
          setProdConfirmOpen(open);
          if (!open) setProdConfirmError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className={cn("h-5 w-5", toneClasses("danger").icon)} />
              Confirm production run
            </DialogTitle>
            <DialogDescription>
              This executes a real payload against a real production host. Name the reason so there's a record of who
              approved this run and why.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--surface-subtle-foreground)] space-y-1">
              <p>
                <span className="font-medium text-[var(--foreground)]">Target host:</span> {targetHost || "—"}
              </p>
              <p>
                <span className="font-medium text-[var(--foreground)]">Environment:</span> Production
              </p>
            </div>
            <div>
              <Label htmlFor="prod-confirm-reason">Reason for this run</Label>
              <Textarea
                id="prod-confirm-reason"
                value={prodConfirmReason}
                onChange={(e) => {
                  setProdConfirmReason(e.target.value);
                  if (prodConfirmError) setProdConfirmError(null);
                }}
                placeholder="e.g. Validating T1059.001 coverage ahead of the Q3 audit — ticket SEC-482"
                rows={3}
              />
            </div>
            <FormError message={prodConfirmError} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setProdConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const reason = prodConfirmReason.trim();
                if (reason.length < 10) {
                  setProdConfirmError("Give a specific reason (at least 10 characters) so this run is traceable.");
                  return;
                }
                setProdConfirmOpen(false);
                void handleRunTest({ prodOverride: true, prodReason: reason });
              }}
            >
              Run in production
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={newDetectionOpen}
        onOpenChange={(open) => {
          setNewDetectionOpen(open);
          if (!open) setNewDetectionError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New detection</DialogTitle>
            <DialogDescription>
              Add a minimal detection record so you can validate it right away, without leaving this flow.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateDetection} className="space-y-4">
            <div>
              <Label htmlFor="new-detection-title">Title</Label>
              <Input
                id="new-detection-title"
                value={newDetectionTitle}
                onChange={(e) => setNewDetectionTitle(e.target.value)}
                placeholder="e.g. Suspicious PowerShell Execution"
                disabled={newDetectionSaving}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-detection-technique">MITRE technique</Label>
                <Input
                  id="new-detection-technique"
                  value={newDetectionTechnique}
                  onChange={(e) => setNewDetectionTechnique(e.target.value)}
                  placeholder="T1059.001"
                  disabled={newDetectionSaving}
                />
              </div>
              <div>
                <Label htmlFor="new-detection-siem">SIEM type</Label>
                <Input
                  id="new-detection-siem"
                  value={newDetectionSiemType}
                  onChange={(e) => setNewDetectionSiemType(e.target.value)}
                  placeholder="splunk"
                  disabled={newDetectionSaving}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="new-detection-query">SIEM query</Label>
              <Textarea
                id="new-detection-query"
                value={newDetectionQuery}
                onChange={(e) => setNewDetectionQuery(e.target.value)}
                placeholder="index=main sourcetype=powershell ..."
                rows={4}
                disabled={newDetectionSaving}
              />
            </div>
            <FormError message={newDetectionError} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewDetectionOpen(false)}
                disabled={newDetectionSaving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={newDetectionSaving}>
                {newDetectionSaving ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Creating
                  </>
                ) : (
                  "Create detection"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      </PageContainer>
  );
}

export default function RunTestPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--background)]" />}>
      <RunTestPageContent />
    </Suspense>
  );
}
