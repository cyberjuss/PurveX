import type { ChipProps } from "@/components/ui/chip";

export type Tone = NonNullable<ChipProps["tone"]>;

interface ToneClasses {
  /** Text color, for labels/headlines. Includes a dark-mode variant. */
  text: string;
  /** Solid fill, for dots/bars/progress fills. */
  bg: string;
  /** Border color, for card/badge outlines. Includes a dark-mode variant. */
  border: string;
  /** Icon color — same as `text`, named separately for call-site clarity. */
  icon: string;
}

/**
 * Single source of truth for what each semantic `Chip` tone actually looks
 * like outside the Chip component itself — dots, progress bars, card
 * borders, bare icons, anywhere a page needs the *same* status color as a
 * Chip but can't use a Chip directly.
 *
 * Before this existed, pages that needed "the emerald that means success"
 * outside a Chip just retyped `text-emerald-600 dark:text-emerald-300` (or
 * a slightly different shade) locally. Two files landing on two different
 * greens for the same semantic state is exactly the kind of drift this
 * fixes — derive from here instead of hand-picking a shade per call site.
 */
export const TONE_CLASSES: Record<Tone, ToneClasses> = {
  success: {
    text: "text-emerald-600 dark:text-emerald-300",
    bg: "bg-emerald-500",
    border: "border-emerald-200 dark:border-emerald-500/30",
    icon: "text-emerald-600 dark:text-emerald-300",
  },
  danger: {
    text: "text-rose-600 dark:text-rose-300",
    bg: "bg-rose-500",
    border: "border-rose-200 dark:border-rose-500/30",
    icon: "text-rose-600 dark:text-rose-300",
  },
  warning: {
    text: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-400",
    border: "border-amber-200 dark:border-amber-500/30",
    icon: "text-amber-600 dark:text-amber-300",
  },
  info: {
    text: "text-sky-600 dark:text-sky-300",
    bg: "bg-sky-500",
    border: "border-sky-200 dark:border-sky-500/30",
    icon: "text-sky-600 dark:text-sky-300",
  },
  accent: {
    text: "text-[var(--accent-strong)]",
    bg: "bg-[var(--accent-strong)]",
    border: "border-[var(--accent-line)]",
    icon: "text-[var(--accent-strong)]",
  },
  neutral: {
    text: "text-slate-600 dark:text-slate-300",
    bg: "bg-slate-300 dark:bg-slate-600",
    border: "border-slate-200 dark:border-white/10",
    icon: "text-slate-500 dark:text-slate-400",
  },
  muted: {
    text: "text-slate-500 dark:text-slate-400",
    bg: "bg-slate-400",
    border: "border-[var(--stroke-soft)]",
    icon: "text-slate-400",
  },
};

export function toneClasses(tone: Tone): ToneClasses {
  return TONE_CLASSES[tone];
}

/** Bucket a 0-100 score into the tone that matches how `tests-workspace`
 * and `detections-workspace` both grade "good/ok/bad" thresholds. */
export function scoreToTone(score?: number | null): Tone {
  if (typeof score !== "number") return "muted";
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "danger";
}
