"use client";

import { GitBranch, Database, PenLine, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SourceBadge — shows where a detection's source of truth lives.
 *
 * Four variants map 1:1 to ``Detection.source`` on the backend:
 *
 * * ``git``        — rule is managed via Detection-as-Code (Sprint 3)
 * * ``siem_sync``  — rule was imported from a SIEM connection
 * * ``manual``     — rule was authored in-product
 * * ``unknown``    — fallback for rows missing ``source`` (legacy)
 *
 * Kept intentionally small and text-light so the badge sits well inside
 * table cells + detail headers without dominating the layout.
 */
export type DetectionSourceKind = "git" | "siem_sync" | "manual" | string | null | undefined;

interface SourceBadgeProps {
  source?: DetectionSourceKind;
  className?: string;
  size?: "sm" | "md";
}

const META: Record<
  string,
  { label: string; icon: typeof GitBranch; cls: string }
> = {
  git: {
    label: "Git",
    icon: GitBranch,
    cls: "border-violet-500/40 bg-violet-500/10 text-violet-200",
  },
  siem_sync: {
    label: "SIEM",
    icon: Database,
    cls: "border-sky-500/40 bg-sky-500/10 text-sky-200",
  },
  manual: {
    label: "PurveX",
    icon: PenLine,
    cls: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  },
};

export function SourceBadge({
  source,
  className,
  size = "sm",
}: SourceBadgeProps) {
  const meta = (source && META[source]) || {
    label: "Unknown",
    icon: HelpCircle,
    cls: "border-slate-600/40 bg-slate-800/40 text-slate-400",
  };
  const Icon = meta.icon;
  const sizes =
    size === "md"
      ? "h-6 px-2.5 text-[11px]"
      : "h-5 px-2 text-[10px]";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wide",
        sizes,
        meta.cls,
        className,
      )}
      title={`Source of truth: ${meta.label}`}
    >
      <Icon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} strokeWidth={2} />
      {meta.label}
    </span>
  );
}
