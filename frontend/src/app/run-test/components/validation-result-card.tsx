import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Slash, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { toneClasses } from "@/lib/status-tone";
import { cn } from "@/lib/utils";
import type { HighLevelResultType, RunTestResult, UiTestType } from "../types";

export function ValidationResultCard({
  result,
  lastRunType,
  canRun,
  onRunAgain,
  onViewReport,
}: {
  result: RunTestResult;
  lastRunType: UiTestType | null;
  canRun: boolean;
  onRunAgain: () => void;
  onViewReport: () => void;
}) {
  const isTelemetryRun = lastRunType === "telemetry_check";

  const bannerByType: Record<
    HighLevelResultType,
    { tone: NonNullable<ChipProps["tone"]>; icon: ReactNode; title: string; sub: string }
  > = {
    PASS: isTelemetryRun
      ? {
          tone: "success",
          icon: <CheckCircle2 className={cn("h-4 w-4", toneClasses("success").icon)} />,
          title: "Telemetry confirmed",
          sub: "Matching events arrived in the SIEM. Detection rule was not evaluated.",
        }
      : {
          tone: "success",
          icon: <CheckCircle2 className={cn("h-4 w-4", toneClasses("success").icon)} />,
          title: "Detection validated",
          sub: "Evidence was ingested and the detection fired.",
        },
    FAIL_RULE_VISIBILITY: {
      tone: "warning",
      icon: <AlertTriangle className={cn("h-4 w-4", toneClasses("warning").icon)} />,
      title: "Detection needs tuning",
      sub: "Logs were ingested, but the detection rule did not fire.",
    },
    NO_LOGS: isTelemetryRun
      ? {
          tone: "danger",
          icon: <XCircle className={cn("h-4 w-4", toneClasses("danger").icon)} />,
          title: "Blind Spot",
          sub: "No matching events arrived in the SIEM. Check log sources, agents, and ingestion pipelines.",
        }
      : {
          tone: "danger",
          icon: <XCircle className={cn("h-4 w-4", toneClasses("danger").icon)} />,
          title: "No evidence found",
          sub: "No expected evidence was seen in your SIEM. This indicates a telemetry or ingestion issue.",
        },
    SYSTEM_ERROR: {
      tone: "muted",
      icon: <Slash className={cn("h-4 w-4", toneClasses("muted").icon)} />,
      title: "System error",
      sub: "PurveX could not evaluate this validation run due to a system or SIEM error.",
    },
  };

  const meta = bannerByType[result.result_type];

  return (
    <Card className="mt-6 border border-[var(--stroke-soft)] shadow-[var(--shadow-soft)] rounded-2xl bg-[var(--surface-card)]">
      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base font-semibold text-[var(--foreground)]">Validation result</CardTitle>
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
                <span className="font-semibold text-[var(--foreground)]">{result.detection_summary.alerts_found}</span>
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-1 justify-end">
          <Button
            size="sm"
            variant="outline"
            className="border-[var(--stroke-soft)] text-[11px] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)]"
            onClick={onRunAgain}
            disabled={!canRun}
          >
            Run validation again
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-[var(--stroke-soft)] text-[11px] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)]"
            onClick={onViewReport}
          >
            View validation report
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
