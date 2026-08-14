import { AlertTriangle, Loader2, Play, Server, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldError } from "@/components/ui/form-error";
import { UpgradeBanner } from "@/components/ui/upgrade-banner";
import { toneClasses } from "@/lib/status-tone";
import { cn } from "@/lib/utils";
import type { TestScheduleType } from "@/lib/api";
import { LiveExecutionPanel } from "./live-execution-panel";
import type { ExecutionState, RunTestFieldErrors } from "../types";

export function RunConfigStep({
  environment,
  onEnvironmentChange,
  canRunInEnv,
  targetHost,
  onTargetHostChange,
  runnerTargets,
  environmentRunnersCount,
  canSelectTargetHost,
  fieldErrors,
  onClearFieldError,
  isRunning,
  labOs,
  onLabOsChange,
  error,
  errorIsUpgrade,
  stillProcessing,
  mitreLoadWarning,
  runnerLoadWarning,
  execution,
  logsExpanded,
  onToggleLogs,
  runMode,
  onRunModeChange,
  canScheduleInEnv,
  scheduleType,
  onScheduleTypeChange,
  scheduleTime,
  onScheduleTimeChange,
  scheduleIntervalMinutes,
  onScheduleIntervalChange,
  isScheduling,
  canRun,
  onRunTest,
}: {
  environment: "lab" | "dev" | "prod";
  onEnvironmentChange: (env: "lab" | "dev" | "prod") => void;
  canRunInEnv: (env: "lab" | "dev" | "prod") => boolean;
  targetHost: string;
  onTargetHostChange: (host: string) => void;
  runnerTargets: string[];
  environmentRunnersCount: number;
  canSelectTargetHost: boolean;
  fieldErrors: RunTestFieldErrors;
  onClearFieldError: (field: keyof RunTestFieldErrors) => void;
  isRunning: boolean;
  labOs: "windows" | "linux" | "both";
  onLabOsChange: (os: "windows" | "linux" | "both") => void;
  error: string | null;
  errorIsUpgrade: boolean;
  stillProcessing: string | null;
  mitreLoadWarning: string | null;
  runnerLoadWarning: string | null;
  execution: ExecutionState | null;
  logsExpanded: boolean;
  onToggleLogs: () => void;
  runMode: "now" | "schedule";
  onRunModeChange: (mode: "now" | "schedule") => void;
  canScheduleInEnv: (env: "lab" | "dev" | "prod") => boolean;
  scheduleType: TestScheduleType;
  onScheduleTypeChange: (type: TestScheduleType) => void;
  scheduleTime: string;
  onScheduleTimeChange: (value: string) => void;
  scheduleIntervalMinutes: string;
  onScheduleIntervalChange: (value: string) => void;
  isScheduling: boolean;
  canRun: boolean;
  onRunTest: () => void;
}) {
  return (
    <div className="space-y-8">
      {!canSelectTargetHost && (
        <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">
          Pick a target on the left to configure environment and host.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <Label htmlFor="environment-select" className="text-[var(--foreground)] text-sm font-medium flex items-center gap-2">
            <Server className="h-4 w-4 text-[var(--surface-subtle-foreground)]" />
            Environment
          </Label>
          <Select
            onValueChange={(value: "lab" | "dev" | "prod") => onEnvironmentChange(value)}
            value={environment}
            disabled={isRunning}
          >
            <SelectTrigger
              id="environment-select"
              className="w-full h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]"
            >
              <SelectValue placeholder="Select environment" />
            </SelectTrigger>
            <SelectContent className="bg-[var(--surface-card)] border-[var(--stroke-soft)]">
              {canRunInEnv("lab") && <SelectItem value="lab">Lab (PurveX)</SelectItem>}
              {canRunInEnv("dev") && <SelectItem value="dev">Dev</SelectItem>}
              {canRunInEnv("prod") && <SelectItem value="prod">Prod (restricted)</SelectItem>}
              {!canRunInEnv("lab") && !canRunInEnv("dev") && !canRunInEnv("prod") && (
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
                onTargetHostChange(value);
                onClearFieldError("targetHost");
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
                onTargetHostChange(e.target.value);
                onClearFieldError("targetHost");
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
            {runnerTargets.length === 0 && environmentRunnersCount > 0
              ? `No runners are registered for ${environment}. Double-check this hostname belongs to that environment before running.`
              : "The specific host where the scenario will run. Telemetry and validation evidence will be tied to this host."}
          </p>
        </div>
      </div>

      {environment === "lab" && (
        <div className="space-y-3">
          <Label className="text-[var(--foreground)] text-sm font-medium">Lab Operating System</Label>
          <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">
            Choose which lab VMs this scenario should exercise
          </p>
          <div className="inline-flex rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
            {(["windows", "linux", "both"] as const).map((os) => (
              <button
                key={os}
                type="button"
                className={cn(
                  "px-4 py-2 rounded-md text-sm font-medium transition-all border capitalize",
                  labOs === os
                    ? "bg-[var(--surface-card)] text-[var(--foreground)] border-[var(--stroke-soft)] shadow-sm"
                    : "text-[var(--surface-subtle-foreground)] border-transparent hover:text-[var(--foreground)] hover:bg-[var(--surface-card)]"
                )}
                onClick={() => onLabOsChange(os)}
                disabled={isRunning}
              >
                {os}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && errorIsUpgrade ? (
        <UpgradeBanner message={error} />
      ) : error ? (
        <div className="p-4 rounded-lg border border-red-500/40 bg-red-500/10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <p className="text-sm text-red-200">{error}</p>
          </div>
        </div>
      ) : null}
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
          onToggleLogs={onToggleLogs}
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
              onClick={() => onRunModeChange("now")}
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
              onClick={() => onRunModeChange("schedule")}
              disabled={isRunning || isScheduling || !canScheduleInEnv(environment)}
              title={!canScheduleInEnv(environment) ? "You do not have permission to schedule tests in this environment" : ""}
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
                <Select value={scheduleType} onValueChange={(v: string) => onScheduleTypeChange(v as TestScheduleType)}>
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
                      Date &amp; Time
                    </Label>
                    <Input
                      id="schedule-time"
                      type="datetime-local"
                      value={scheduleTime}
                      onChange={(e) => {
                        onScheduleTimeChange(e.target.value);
                        onClearFieldError("scheduleTime");
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
                        onScheduleIntervalChange(e.target.value);
                        onClearFieldError("scheduleInterval");
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
                Scheduling is permission-scoped by environment. Production scheduling requires explicit production
                scheduling permission.
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-4 pt-6 border-t border-[var(--stroke-soft)]">
          <Button
            onClick={onRunTest}
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
  );
}
