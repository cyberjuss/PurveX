import { Globe, Server, Target, Waves } from "lucide-react";
import { Chip } from "@/components/ui/chip";
import type { UiTestType } from "../types";

const MODE_LABELS: Record<UiTestType, string> = {
  detection_validation: "Validate a Detection",
  find_detection_coverage: "Explore Coverage",
  telemetry_check: "Verify Telemetry Readiness",
};

export function RunTestSummary({
  testType,
  detectionTitle,
  techniqueId,
  environment,
  targetHost,
}: {
  testType: UiTestType | null;
  detectionTitle?: string | null;
  techniqueId?: string | null;
  environment?: "lab" | "dev" | "prod" | null;
  targetHost?: string | null;
}) {
  if (!testType) return null;

  return (
    <div className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--surface-subtle-foreground)]">
        This run
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent" size="md">
          <Target className="h-3.5 w-3.5" />
          {MODE_LABELS[testType]}
        </Chip>
        {detectionTitle && (
          <Chip tone="neutral" size="md">
            {detectionTitle}
          </Chip>
        )}
        {techniqueId && (
          <Chip tone="neutral" size="md" className="font-mono">
            {techniqueId}
          </Chip>
        )}
        {environment && (
          <Chip tone="muted" size="md">
            <Globe className="h-3.5 w-3.5" />
            {environment === "lab" ? "Lab" : environment === "dev" ? "Dev" : "Prod"}
          </Chip>
        )}
        {targetHost && (
          <Chip tone="muted" size="md">
            <Server className="h-3.5 w-3.5" />
            {targetHost}
          </Chip>
        )}
        {!detectionTitle && !techniqueId && (
          <span className="flex items-center gap-1.5 text-xs text-[var(--surface-subtle-foreground)]">
            <Waves className="h-3.5 w-3.5" />
            Waiting on a selection...
          </span>
        )}
      </div>
    </div>
  );
}
