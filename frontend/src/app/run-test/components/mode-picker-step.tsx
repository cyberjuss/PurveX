import { cn } from "@/lib/utils";
import type { UiTestType } from "../types";

export type TestModeMeta = {
  id: UiTestType;
  title: string;
  question: string;
};

export const TEST_MODES: TestModeMeta[] = [
  {
    id: "detection_validation",
    title: "Validate a Detection",
    question: "I already have a rule — does it work?",
  },
  {
    id: "find_detection_coverage",
    title: "Explore Coverage",
    question: "What should detect this ATT&CK technique?",
  },
  {
    id: "telemetry_check",
    title: "Verify Telemetry Readiness",
    question: "Are logs even arriving?",
  },
];

// Pill tab bar — same toggle pattern already used for labOs/runMode in
// RunConfigStep, kept consistent rather than introducing the shadcn Tabs
// primitive (used once elsewhere in the app with non-matching tokens).
export function ModePickerStep({
  value,
  onSelect,
}: {
  value: UiTestType | null;
  onSelect: (mode: UiTestType) => void;
}) {
  const activeMode = TEST_MODES.find((m) => m.id === value);
  return (
    <div className="space-y-2">
      <div className="inline-flex flex-wrap rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
        {TEST_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode.id)}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-all border",
              value === mode.id
                ? "bg-[var(--surface-card)] text-[var(--foreground)] border-[var(--stroke-soft)] shadow-sm"
                : "text-[var(--surface-subtle-foreground)] border-transparent hover:text-[var(--foreground)] hover:bg-[var(--surface-card)]"
            )}
          >
            {mode.title}
          </button>
        ))}
      </div>
      {activeMode && (
        <p className="text-xs text-[var(--surface-subtle-foreground)] leading-relaxed">{activeMode.question}</p>
      )}
    </div>
  );
}
