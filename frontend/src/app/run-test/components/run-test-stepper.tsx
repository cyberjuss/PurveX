import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type RunTestStep = 1 | 2 | 3;

export function RunTestStepper({
  currentStep,
  maxUnlockedStep,
  step2Label,
  onStepClick,
}: {
  currentStep: RunTestStep;
  maxUnlockedStep: RunTestStep;
  step2Label: string;
  onStepClick: (step: RunTestStep) => void;
}) {
  const steps: Array<{ id: RunTestStep; title: string; subtitle: string }> = [
    { id: 1, title: "Validation mode", subtitle: "What are you testing for?" },
    { id: 2, title: step2Label, subtitle: "Choose the target" },
    { id: 3, title: "Environment & run", subtitle: "Where and how to run it" },
  ];

  return (
    <ol className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-0">
      {steps.map((step, index) => {
        const isCompleted = step.id < maxUnlockedStep || (step.id < currentStep && step.id <= maxUnlockedStep);
        const isCurrent = step.id === currentStep;
        const isLocked = step.id > maxUnlockedStep;

        return (
          <li key={step.id} className="flex flex-1 items-stretch">
            <button
              type="button"
              onClick={() => !isLocked && onStepClick(step.id)}
              disabled={isLocked}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex flex-1 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                isCurrent
                  ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] shadow-sm"
                  : isCompleted
                  ? "border-[var(--stroke-soft)] bg-[var(--surface-card)] hover:border-[var(--accent-line)]"
                  : "border-[var(--stroke-soft)] bg-[var(--surface-subtle)] opacity-60",
                isLocked ? "cursor-not-allowed" : "cursor-pointer"
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold",
                  isCurrent
                    ? "border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white"
                    : isCompleted
                    ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                    : "border-[var(--stroke-soft)] bg-[var(--surface-card)] text-[var(--surface-subtle-foreground)]"
                )}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : step.id}
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate text-sm font-semibold",
                    isCurrent || isCompleted ? "text-[var(--foreground)]" : "text-[var(--surface-subtle-foreground)]"
                  )}
                >
                  {step.title}
                </span>
                <span className="block truncate text-xs text-[var(--surface-subtle-foreground)]">{step.subtitle}</span>
              </span>
            </button>
            {index < steps.length - 1 && (
              <div className="hidden w-6 shrink-0 items-center justify-center sm:flex" aria-hidden="true">
                <div className="h-px w-full bg-[var(--stroke-soft)]" />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
