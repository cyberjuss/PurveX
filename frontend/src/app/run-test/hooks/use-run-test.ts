import { useCallback, useState } from "react";
import {
  runTest as runTestApi,
  getTest,
  type TestDetailResponse,
  type TestRunMode,
} from "@/lib/api";
import { isUpgradeRequiredError } from "@/components/ui/upgrade-banner";
import type {
  ExecutionStatus,
  HighLevelResultType,
  RunCallbacks,
  RunTestResult,
} from "../types";

const RUN_TEST_MAX_POLL_ATTEMPTS = 300;
const RUN_TEST_POLL_INTERVAL_MS = 2_000;

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

export function useRunTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<RunTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorIsUpgrade, setErrorIsUpgrade] = useState(false);
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
      setErrorIsUpgrade(false);
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
            "This validation is taking longer than expected. It is still running on the backend — you can keep this page open or check the Tests page for the live record."
          );
          callbacks?.onStatus?.("ingesting");
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to start validation.");
        setErrorIsUpgrade(isUpgradeRequiredError(err));
        callbacks?.onStatus?.("failed", new Date().toISOString());
      } finally {
        setIsRunning(false);
      }
    },
    []
  );

  return { run, isRunning, result, error, errorIsUpgrade, stillProcessing, setResult };
}
