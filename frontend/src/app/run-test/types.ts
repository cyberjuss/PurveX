// Shared types for the /run-test page and its extracted step components.
// Kept in one place so `hooks/use-run-test.ts`, `components/*`, and the
// page shell don't have to duplicate or cross-import from each other.

import type { TestRunMode } from "@/lib/api";

export type UiTestType = "detection_validation" | "find_detection_coverage" | "telemetry_check";

export const uiToBackendMode: Record<UiTestType, TestRunMode> = {
  detection_validation: "DETECTION_VALIDATION",
  find_detection_coverage: "ALERT_CHECK",
  telemetry_check: "TELEMETRY_CHECK",
};

export type RunnerTargetRecord = {
  hostname?: string | null;
  environment_name?: string | null;
};

export type RunTestFieldErrors = Partial<Record<"targetHost" | "scheduleTime" | "scheduleInterval", string>>;

export type HighLevelResultType = "PASS" | "FAIL_RULE_VISIBILITY" | "NO_LOGS" | "SYSTEM_ERROR";

export interface RunTestResult {
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

export type ExecutionStatus = "queued" | "running" | "ingesting" | "validated" | "failed" | "partial";

export type ExecutionLogStatus = "running" | "success" | "warning" | "error";

export type ExecutionLogEntry = {
  id: string;
  timestamp: string;
  step: string;
  status: ExecutionLogStatus;
};

export type ExecutionState = {
  id: string;
  status: ExecutionStatus;
  started_at: string;
  completed_at?: string;
  // Empty/undefined until the runner reports the real command via the test
  // artifact — never fabricated client-side. See LiveExecutionPanel.
  atomic_command?: string;
  technique_id: string;
  environment: string;
  missing_signal?: string;
  logs: ExecutionLogEntry[];
};

export type RunCallbacks = {
  onStart?: (created: import("@/lib/api").TestDetailResponse) => void;
  onStatus?: (status: ExecutionStatus, completedAt?: string, missingSignal?: string) => void;
  onLog?: (entry: ExecutionLogEntry) => void;
  onComplete?: (final: import("@/lib/api").TestDetailResponse) => void;
};
