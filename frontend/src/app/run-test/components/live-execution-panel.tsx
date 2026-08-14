import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { toneClasses } from "@/lib/status-tone";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  Waves,
  XCircle,
} from "lucide-react";
import type { ExecutionLogStatus, ExecutionState, ExecutionStatus } from "../types";

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

export function LiveExecutionPanel({
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
          {execution.atomic_command ? (
            <div className="text-sm font-mono text-[var(--foreground)] whitespace-pre-wrap break-words">
              {execution.atomic_command}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-[var(--surface-subtle-foreground)] italic">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Waiting for the runner to report the command...
            </div>
          )}
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
