import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Detection } from "@/lib/api";

export type TelemetryScenario = {
  id: string;
  label: string;
  subtitle: string;
};

export function TelemetryScenarioPicker({
  scenarios,
  selectedScenario,
  onSelectScenario,
  detections,
  isRunning,
}: {
  scenarios: TelemetryScenario[];
  selectedScenario: string;
  onSelectScenario: (id: string) => void;
  detections: Detection[];
  isRunning: boolean;
}) {
  const selectedScenarioData = scenarios.find((s) => s.id === selectedScenario);
  const selectedDetectionData = detections.find((d) => d.id === selectedScenario);

  return (
    <div className="space-y-3">
      <Select
        value={selectedScenario || undefined}
        onValueChange={(value: string) => onSelectScenario(value)}
        disabled={isRunning || scenarios.length === 0}
      >
        <SelectTrigger className="w-full h-11 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)]">
          <SelectValue placeholder="Select a test scenario template" />
        </SelectTrigger>
        <SelectContent className="bg-[var(--surface-card)] border-[var(--stroke-soft)]">
          {scenarios.map((scenario) => (
            <SelectItem key={scenario.id} value={scenario.id}>
              <div className="flex flex-col">
                <span className="font-medium text-[var(--foreground)]">{scenario.label}</span>
                <span className="text-xs text-[var(--surface-subtle-foreground)]">{scenario.subtitle}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectedScenarioData && (
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
      )}
      {scenarios.length === 0 && (
        <div className="p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
          <p className="text-sm text-[var(--surface-subtle-foreground)]">
            No validation scenarios are available yet. Add at least one detection or scenario template first.
          </p>
        </div>
      )}
    </div>
  );
}
