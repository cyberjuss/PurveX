"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { z } from "zod";
import {
  getDetections,
  createTestSchedule,
  getMitreTechniques,
  getAtomicTests,
  getAtomicTest,
  getEnvironmentRunners,
  runTest as runTestApi,
  type Detection,
  type MitreTechnique,
  type AtomicTestDefinition,
  type TestScheduleType,
} from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { Loader2, Target } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { TestsHubTabs } from "@/components/tests/tests-hub-tabs";
import { isUpgradeRequiredError } from "@/components/ui/upgrade-banner";

import { useRunTest } from "./hooks/use-run-test";
import { parseRunTestParams, type RunTestMode } from "./lib/run-test-url";
import type {
  ExecutionLogEntry,
  ExecutionState,
  ExecutionStatus,
  RunnerTargetRecord,
  RunTestFieldErrors,
  UiTestType,
} from "./types";
import { uiToBackendMode } from "./types";
import { RunTestSummary } from "./components/run-test-summary";
import { ModePickerStep } from "./components/mode-picker-step";
import { DetectionPicker } from "./components/detection-picker";
import { TelemetryScenarioPicker } from "./components/telemetry-scenario-picker";
import { TechniquePicker } from "./components/technique-picker";
import { RunConfigStep } from "./components/run-config-step";
import { ValidationResultCard } from "./components/validation-result-card";
import { ProdConfirmDialog } from "./components/prod-confirm-dialog";
import { NewDetectionDialog } from "./components/new-detection-dialog";

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

const DEFAULT_SCHEDULE_INTERVAL_MINUTES = "60";

// Deterministic mapping from the short `mode` URL param (plus which of `d`/`t`
// are present) to the UI's validation mode. This is the single place that
// decides mode on arrival — replaces the 3 competing effects the old page
// had for this, and fixes the bug where `mode=telemetry` was silently
// ignored whenever a detection id was also present (dashboard's "Investigate
// missing logs" shortcut).
function resolveInitialMode(params: { d?: string; t?: string; mode?: RunTestMode }): UiTestType | null {
  if (params.d) {
    return params.mode === "telemetry" ? "telemetry_check" : "detection_validation";
  }
  if (params.t) {
    return "find_detection_coverage";
  }
  if (params.mode === "validation") return "detection_validation";
  if (params.mode === "coverage") return "find_detection_coverage";
  if (params.mode === "telemetry") return "telemetry_check";
  return null;
}

function RunTestPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Parsed exactly once on mount — after that, in-shell selections (e.g.
  // picking a technique from the grid) update state directly instead of
  // round-tripping through the URL, so there's nothing to re-parse.
  const [initialParams] = useState(() => parseRunTestParams(searchParams));
  const atomicIdFromUrl = initialParams.a;

  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedDetection, setSelectedDetection] = useState<string>(() =>
    initialParams.d && initialParams.mode !== "telemetry" ? initialParams.d : ""
  );
  const [selectedScenario, setSelectedScenario] = useState<string>(() =>
    initialParams.d && initialParams.mode === "telemetry" ? initialParams.d : ""
  );
  const [technique, setTechnique] = useState<string>(() => initialParams.t || "");
  const [environment, setEnvironment] = useState<"lab" | "dev" | "prod">(() => initialParams.env || "lab");
  const [targetHost, setTargetHost] = useState<string>(() => initialParams.host || "");
  const [testType, setTestType] = useState<UiTestType | null>(() => resolveInitialMode(initialParams));

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorIsUpgrade, setErrorIsUpgrade] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<RunTestFieldErrors>({});
  const [environmentRunners, setEnvironmentRunners] = useState<RunnerTargetRecord[]>([]);
  const [detectionSearch, setDetectionSearch] = useState<string>("");
  const [prodConfirmOpen, setProdConfirmOpen] = useState(false);
  const [prodConfirmReason, setProdConfirmReason] = useState("");
  const [prodConfirmError, setProdConfirmError] = useState<string | null>(null);
  const [newDetectionOpen, setNewDetectionOpen] = useState(false);
  const [lastRunType, setLastRunType] = useState<UiTestType | null>(null);
  const [labOs, setLabOs] = useState<"windows" | "linux" | "both">("windows");
  const [runMode, setRunMode] = useState<"now" | "schedule">("now");
  const [scheduleType, setScheduleType] = useState<TestScheduleType>("once");
  const [scheduleTime, setScheduleTime] = useState<string>("");
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState<string>(DEFAULT_SCHEDULE_INTERVAL_MINUTES);
  const [isScheduling, setIsScheduling] = useState(false);
  const [mitreTechniques, setMitreTechniques] = useState<MitreTechnique[]>([]);
  const [coverageScenarioConfirmed, setCoverageScenarioConfirmed] = useState<boolean>(
    () => resolveInitialMode(initialParams) === "find_detection_coverage" && !!initialParams.t
  );
  const [mitreLoadWarning, setMitreLoadWarning] = useState<string | null>(null);
  const [runnerLoadWarning, setRunnerLoadWarning] = useState<string | null>(null);
  const [selectedSubtechniqueId, setSelectedSubtechniqueId] = useState<string>("");
  const [execution, setExecution] = useState<ExecutionState | null>(null);
  const [logsExpanded, setLogsExpanded] = useState<boolean>(false);
  // Explicit atomic (from `a`) — carries id/name/number and is what actually
  // gets submitted to the backend as the chosen atomic test.
  const [resolvedAtomic, setResolvedAtomic] = useState<AtomicTestDefinition | null>(null);
  // Fuzzy "first atomic for this technique" — display-only fallback used
  // when we only have a technique in focus (`t`) and no explicit atomic (`a`).
  const [atomicScenarioHint, setAtomicScenarioHint] = useState<{ name: string; description?: string } | null>(null);

  const { run: runTest, isRunning, result, error: runError, errorIsUpgrade: runErrorIsUpgrade, stillProcessing, setResult } = useRunTest();
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

  useEffect(() => {
    async function loadDetections() {
      try {
        setLoading(true);
        const data = await getDetections();
        setDetections(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load detections.");
      } finally {
        setLoading(false);
      }
    }
    loadDetections();
  }, []);

  // Resolve the explicit atomic (`a`) into its full definition — this is
  // what replaces the fabricated/URL-carried atomic_name & atomic_number.
  useEffect(() => {
    if (!atomicIdFromUrl) {
      setResolvedAtomic(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const def = await getAtomicTest(atomicIdFromUrl);
        if (!cancelled) setResolvedAtomic(def);
      } catch {
        if (!cancelled) setResolvedAtomic(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [atomicIdFromUrl]);

  // Fuzzy display-only fallback — only when there's a technique in focus but
  // no explicit atomic was chosen.
  useEffect(() => {
    if (atomicIdFromUrl || !technique) {
      setAtomicScenarioHint(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const baseTechniqueId = technique.split(".")[0];
        const response = await getAtomicTests({ technique_id: baseTechniqueId, limit: 1 });
        if (cancelled) return;
        const first = response.items?.[0];
        setAtomicScenarioHint(first ? { name: first.name, description: first.description } : null);
      } catch {
        if (!cancelled) setAtomicScenarioHint(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [technique, atomicIdFromUrl]);

  // Coverage scenario is confirmed as soon as the user has a technique in focus.
  useEffect(() => {
    if (testType !== "find_detection_coverage") {
      setCoverageScenarioConfirmed(false);
      return;
    }
    setCoverageScenarioConfirmed(!!technique);
  }, [testType, technique]);

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
      technique
    ) {
      void loadMitre();
    }
  }, [testType, selectedDetection, technique, mitreTechniques.length]);

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
      setErrorIsUpgrade(runErrorIsUpgrade);
    }
  }, [runError, runErrorIsUpgrade]);

  const selectedAtomic = useMemo(() => {
    if (!atomicIdFromUrl) return undefined;
    const atomic: {
      atomic_test_id?: string;
      atomic_test_name?: string;
      atomic_test_number?: number;
    } = { atomic_test_id: atomicIdFromUrl };
    if (resolvedAtomic?.name) atomic.atomic_test_name = resolvedAtomic.name;
    if (typeof resolvedAtomic?.test_number === "number") atomic.atomic_test_number = resolvedAtomic.test_number;
    return atomic;
  }, [atomicIdFromUrl, resolvedAtomic]);

  async function handleRunTest(opts?: { prodOverride?: boolean; prodReason?: string }) {
    setErrorIsUpgrade(false);
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
      techniqueIdToUse = technique || null;
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
        setErrorIsUpgrade(isUpgradeRequiredError(err));
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
        setErrorIsUpgrade(isUpgradeRequiredError(err));
      }
      return;
    }

    const executionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
    const startTs = new Date().toISOString();
    const techniqueIdDisplay = techniqueIdToUse || technique || selectedSubtechniqueId || "Unknown";

    setExecution({
      id: executionId,
      status: "queued",
      started_at: startTs,
      // The real runner command isn't known yet — it's only reported once
      // the test artifact comes back. Never fabricate one client-side.
      atomic_command: undefined,
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
          // The runner reports the real command as part of the test
          // artifact — pick it up here instead of ever fabricating one.
          setExecution((prev) =>
            prev && final.artifact?.atomic_command
              ? { ...prev, atomic_command: final.artifact.atomic_command }
              : prev
          );
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

  function handleSelectMode(mode: UiTestType) {
    setTestType(mode);
    setSelectedDetection("");
    setSelectedScenario("");
    setTargetHost("");
    setTechnique("");
    setSelectedSubtechniqueId("");
    setResult(null);
    setError(null);
  }

  function handleDetectionCreated(created: Detection) {
    setDetections((prev) => [created, ...prev]);
    setSelectedDetection(created.id);
  }

  const detectionsForUi = detections.filter((det) => {
    if (technique && testType === "detection_validation") {
      return det.technique_id === technique;
    }
    return true;
  });

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
  }, [environment, selectedDetection, selectedScenario, technique, targetHost]);

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

  const scenarioNameFromExplore = resolvedAtomic?.name || atomicScenarioHint?.name || "";
  const scenarioDescriptionFromExplore = (resolvedAtomic?.description || atomicScenarioHint?.description || "").trim();
  const getTechniqueLabel = (techniqueId?: string | null) => {
    if (!techniqueId) return null;
    const exact = mitreTechniques.find((t) => t.id === techniqueId);
    if (exact) return `${exact.id} · ${exact.name}`;
    const base = techniqueId.split(".")[0];
    const baseMatch = mitreTechniques.find((t) => t.id === base);
    if (baseMatch) return `${techniqueId} · ${baseMatch.name}`;
    return techniqueId;
  };
  const techniqueLabelFromExplore = getTechniqueLabel(technique);
  const scenarioCardTitle =
    scenarioNameFromExplore ||
    (techniqueLabelFromExplore ? `Technique ${techniqueLabelFromExplore}` : "Selected scenario");

  const selectedDetectionRecord = detections.find((d) => d.id === selectedDetection);
  const summaryDetectionTitle =
    testType === "detection_validation"
      ? selectedDetectionRecord?.title
      : testType === "telemetry_check"
      ? telemetryScenarios.find((s) => s.id === selectedScenario)?.label
      : undefined;
  const summaryTechniqueId =
    testType === "find_detection_coverage"
      ? technique || null
      : selectedSubtechniqueId || selectedDetectionRecord?.technique_id || null;

  return (
    <PageContainer>
      <div className="mb-6">
        <TestsHubTabs />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* Left pane: pick what to test */}
        <div className="space-y-4">
          <ModePickerStep value={testType} onSelect={handleSelectMode} />

          {loading && (
            <div className="flex items-center gap-2 text-sm text-[var(--surface-subtle-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          )}

          {testType === "detection_validation" && (
            <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5">
              <DetectionPicker
                detections={detections}
                detectionsForUi={detectionsForUi}
                selectedDetection={selectedDetection}
                onSelectDetection={setSelectedDetection}
                detectionSearch={detectionSearch}
                onDetectionSearchChange={setDetectionSearch}
                isRunning={isRunning}
                canCreateDetection={hasPermission(Permission.DETECTIONS_CREATE)}
                onOpenNewDetection={() => setNewDetectionOpen(true)}
                techniqueFromExplore={technique || null}
                scenarioNameFromExplore={scenarioNameFromExplore}
                mitreTechniques={mitreTechniques}
                selectedSubtechniqueId={selectedSubtechniqueId}
                onSelectSubtechnique={setSelectedSubtechniqueId}
              />
            </div>
          )}

          {testType === "telemetry_check" && (
            <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5">
              <TelemetryScenarioPicker
                scenarios={telemetryScenarios}
                selectedScenario={selectedScenario}
                onSelectScenario={setSelectedScenario}
                detections={detections}
                isRunning={isRunning}
              />
            </div>
          )}

          {testType === "find_detection_coverage" && (
            <TechniquePicker
              mitreTechniques={mitreTechniques}
              detections={detections}
              techniqueFromExplore={technique || null}
              scenarioCardTitle={scenarioCardTitle}
              scenarioDescriptionFromExplore={scenarioDescriptionFromExplore}
              coverageScenarioConfirmed={coverageScenarioConfirmed}
              onConfirmScenario={() => setCoverageScenarioConfirmed(true)}
              onSelectTechnique={(id) => setTechnique(id)}
            />
          )}
        </div>

        {/* Right pane: run configuration, builds up live as selections are made */}
        <div className="xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-5.5rem)] xl:overflow-y-auto space-y-4">
          {!testType ? (
            <div className="rounded-2xl border border-dashed border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-8 text-center">
              <Target className="mx-auto h-8 w-8 text-[var(--surface-subtle-foreground)]" />
              <p className="mt-3 text-sm text-[var(--surface-subtle-foreground)]">
                Pick a detection, technique, or scenario on the left to start building this run.
              </p>
            </div>
          ) : (
            <>
              <RunTestSummary
                testType={testType}
                detectionTitle={summaryDetectionTitle}
                techniqueId={summaryTechniqueId}
                environment={targetHost ? environment : null}
                targetHost={targetHost || null}
              />
              <Card className="border border-[var(--stroke-soft)] shadow-[var(--shadow-soft)] rounded-2xl">
                <CardContent className="pt-6">
                  <RunConfigStep
                    environment={environment}
                    onEnvironmentChange={setEnvironment}
                    canRunInEnv={canRunTest}
                    targetHost={targetHost}
                    onTargetHostChange={setTargetHost}
                    runnerTargets={runnerTargets}
                    environmentRunnersCount={environmentRunners.length}
                    canSelectTargetHost={canSelectTargetHost}
                    fieldErrors={fieldErrors}
                    onClearFieldError={(field) => setFieldErrors((prev) => ({ ...prev, [field]: undefined }))}
                    isRunning={isRunning}
                    labOs={labOs}
                    onLabOsChange={setLabOs}
                    error={error}
                    errorIsUpgrade={errorIsUpgrade}
                    stillProcessing={stillProcessing}
                    mitreLoadWarning={mitreLoadWarning}
                    runnerLoadWarning={runnerLoadWarning}
                    execution={execution}
                    logsExpanded={logsExpanded}
                    onToggleLogs={() => setLogsExpanded((v) => !v)}
                    runMode={runMode}
                    onRunModeChange={setRunMode}
                    canScheduleInEnv={canScheduleTest}
                    scheduleType={scheduleType}
                    onScheduleTypeChange={setScheduleType}
                    scheduleTime={scheduleTime}
                    onScheduleTimeChange={setScheduleTime}
                    scheduleIntervalMinutes={scheduleIntervalMinutes}
                    onScheduleIntervalChange={setScheduleIntervalMinutes}
                    isScheduling={isScheduling}
                    canRun={canRun}
                    onRunTest={() => void handleRunTest()}
                  />
                </CardContent>
              </Card>
              {result && (
                <ValidationResultCard
                  result={result}
                  lastRunType={lastRunType}
                  canRun={canRun}
                  onRunAgain={() => void handleRunTest()}
                  onViewReport={() => router.push(`/tests/${result.run_id}`)}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ProdConfirmDialog
        open={prodConfirmOpen}
        onOpenChange={(open) => {
          setProdConfirmOpen(open);
          if (!open) setProdConfirmError(null);
        }}
        targetHost={targetHost}
        reason={prodConfirmReason}
        onReasonChange={(value) => {
          setProdConfirmReason(value);
          if (prodConfirmError) setProdConfirmError(null);
        }}
        error={prodConfirmError}
        onConfirm={(reason) => {
          const trimmed = reason.trim();
          if (trimmed.length < 10) {
            setProdConfirmError("Give a specific reason (at least 10 characters) so this run is traceable.");
            return;
          }
          setProdConfirmOpen(false);
          void handleRunTest({ prodOverride: true, prodReason: trimmed });
        }}
      />

      <NewDetectionDialog
        open={newDetectionOpen}
        onOpenChange={setNewDetectionOpen}
        onCreated={handleDetectionCreated}
      />
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
