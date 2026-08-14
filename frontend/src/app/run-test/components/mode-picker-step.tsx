import type { ComponentType } from "react";
import { CheckCircle2, Search, Target, Waves } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UiTestType } from "../types";

export type TestModeMeta = {
  id: UiTestType;
  title: string;
  question: string;
  icon: ComponentType<{ className?: string }>;
  step2Label: string;
};

export const TEST_MODES: TestModeMeta[] = [
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

export function ModePickerStep({
  value,
  onSelect,
}: {
  value: UiTestType | null;
  onSelect: (mode: UiTestType) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {TEST_MODES.map((mode) => {
        const Icon = mode.icon;
        const isActive = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onSelect(mode.id)}
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
  );
}
