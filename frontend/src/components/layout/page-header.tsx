"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, eyebrow, icon, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "rounded-[28px] border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-6 py-6 shadow-[var(--shadow-soft)] flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="flex items-start gap-4 max-w-4xl">
        {icon ? (
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--accent-line)] bg-[var(--surface-elevated)] text-[var(--accent-strong)] shadow-sm">
            {icon}
          </span>
        ) : null}
        <div className="space-y-1.5">
          {eyebrow ? (
            <p className="text-xs uppercase tracking-[0.36em] text-[var(--surface-subtle-foreground)]">{eyebrow}</p>
          ) : null}
          <h1 className="text-[28px] font-display font-semibold tracking-tight text-[var(--surface-card-foreground)]">{title}</h1>
        {subtitle ? (
          <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">{subtitle}</p>
        ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div>
      ) : null}
    </div>
  );
}
