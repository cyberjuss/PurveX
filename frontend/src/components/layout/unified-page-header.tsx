"use client";

import { cn } from "@/lib/utils";

interface UnifiedPageHeaderProps {
  label?: string;
  title: string;
  subtitle?: string;
  className?: string;
}

export function UnifiedPageHeader({ label, title, subtitle, className }: UnifiedPageHeaderProps) {
  return (
    <header className={cn("space-y-2 pt-2", className)} aria-label="Page heading">
      {label ? (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {label}
        </p>
      ) : null}
      <h1 className="text-[30px] font-black text-slate-900 leading-tight tracking-tight drop-shadow-sm">
        {title}
      </h1>
      {subtitle ? (
        <p className="text-base text-slate-700 leading-snug max-w-4xl">
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}
