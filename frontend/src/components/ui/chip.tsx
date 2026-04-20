import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Chip — the canonical inline status/label primitive.
 *
 * Before this, pages were hand-rolling badges with mismatched Tailwind
 * combos (e.g. `bg-emerald-100 text-emerald-700 border-emerald-200` in some
 * places, `bg-emerald-500/20 text-emerald-400 border-emerald-500/30` in
 * others), which meant dark-mode coverage and hover behaviour drifted
 * constantly. Route all "inline status indicator" needs through this
 * component so tone adjustments only have to happen in one place.
 *
 * Variants:
 *  - `tone`: semantic intent (neutral / success / warning / danger / info / accent / muted).
 *  - `appearance`: visual treatment.
 *      - `subtle` (default): tinted background + on-tone foreground. Works
 *        on both light and dark surfaces.
 *      - `solid`: fully saturated pill. Use sparingly — reserve for
 *        "must-notice" states (e.g. Failed, Critical).
 *      - `outline`: border only, transparent background.
 *  - `size`: `sm` (compact, default) or `md` (more padding, larger text).
 *  - `dot`: render a leading status dot in the same tone.
 */
const chipVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors [&>svg]:size-3 [&>svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "",
        success: "",
        warning: "",
        danger: "",
        info: "",
        accent: "",
        muted: "",
      },
      appearance: {
        subtle: "",
        solid: "",
        outline: "",
      },
      size: {
        sm: "px-2 py-0.5 text-[11px]",
        md: "px-2.5 py-1 text-xs",
      },
    },
    compoundVariants: [
      // --- subtle (default) -------------------------------------------------
      {
        appearance: "subtle",
        tone: "neutral",
        class:
          "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
      },
      {
        appearance: "subtle",
        tone: "muted",
        class:
          "border-[var(--stroke-soft)] bg-[var(--surface-elevated)] text-slate-600 dark:text-slate-300",
      },
      {
        appearance: "subtle",
        tone: "success",
        class:
          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
      },
      {
        appearance: "subtle",
        tone: "warning",
        class:
          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
      },
      {
        appearance: "subtle",
        tone: "danger",
        class:
          "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
      },
      {
        appearance: "subtle",
        tone: "info",
        class:
          "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
      },
      {
        appearance: "subtle",
        tone: "accent",
        class:
          "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300",
      },
      // --- solid ------------------------------------------------------------
      {
        appearance: "solid",
        tone: "neutral",
        class: "border-transparent bg-slate-900 text-white dark:bg-white dark:text-slate-900",
      },
      {
        appearance: "solid",
        tone: "muted",
        class: "border-transparent bg-slate-500 text-white",
      },
      {
        appearance: "solid",
        tone: "success",
        class: "border-transparent bg-emerald-600 text-white",
      },
      {
        appearance: "solid",
        tone: "warning",
        class: "border-transparent bg-amber-500 text-white",
      },
      {
        appearance: "solid",
        tone: "danger",
        class: "border-transparent bg-red-600 text-white",
      },
      {
        appearance: "solid",
        tone: "info",
        class: "border-transparent bg-sky-600 text-white",
      },
      {
        appearance: "solid",
        tone: "accent",
        class: "border-transparent bg-indigo-600 text-white",
      },
      // --- outline ----------------------------------------------------------
      {
        appearance: "outline",
        tone: "neutral",
        class:
          "border-[var(--stroke-soft)] bg-transparent text-slate-700 dark:text-slate-200",
      },
      {
        appearance: "outline",
        tone: "muted",
        class:
          "border-[var(--stroke-soft)] bg-transparent text-slate-500 dark:text-slate-400",
      },
      {
        appearance: "outline",
        tone: "success",
        class: "border-emerald-400/60 bg-transparent text-emerald-700 dark:text-emerald-300",
      },
      {
        appearance: "outline",
        tone: "warning",
        class: "border-amber-400/60 bg-transparent text-amber-700 dark:text-amber-300",
      },
      {
        appearance: "outline",
        tone: "danger",
        class: "border-red-400/60 bg-transparent text-red-700 dark:text-red-300",
      },
      {
        appearance: "outline",
        tone: "info",
        class: "border-sky-400/60 bg-transparent text-sky-700 dark:text-sky-300",
      },
      {
        appearance: "outline",
        tone: "accent",
        class: "border-indigo-400/60 bg-transparent text-indigo-700 dark:text-indigo-300",
      },
    ],
    defaultVariants: {
      tone: "neutral",
      appearance: "subtle",
      size: "sm",
    },
  },
);

const dotVariants = cva("inline-block rounded-full", {
  variants: {
    tone: {
      neutral: "bg-slate-500",
      muted: "bg-slate-400",
      success: "bg-emerald-500",
      warning: "bg-amber-500",
      danger: "bg-red-500",
      info: "bg-sky-500",
      accent: "bg-indigo-500",
    },
    size: {
      sm: "h-1.5 w-1.5",
      md: "h-2 w-2",
    },
  },
  defaultVariants: { tone: "neutral", size: "sm" },
});

export interface ChipProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof chipVariants> {
  /** Optional leading status dot. */
  dot?: boolean;
}

/**
 * Canonical status pill. See file header for variant guidance.
 *
 * @example
 *   <Chip tone="success">Passed</Chip>
 *   <Chip tone="danger" appearance="solid">Failed</Chip>
 *   <Chip tone="warning" dot size="md">Degraded</Chip>
 */
export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, tone, appearance, size, dot, children, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(chipVariants({ tone, appearance, size }), className)}
        {...props}
      >
        {dot ? (
          <span
            aria-hidden="true"
            className={dotVariants({ tone: tone ?? "neutral", size: size ?? "sm" })}
          />
        ) : null}
        {children}
      </span>
    );
  },
);
Chip.displayName = "Chip";

export { chipVariants };
