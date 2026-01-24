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
        "rounded-[28px] border border-slate-200/80 bg-white/85 backdrop-blur shadow-[0_20px_48px_-36px_rgba(15,23,42,0.55)] px-6 py-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="flex items-start gap-4 max-w-4xl">
        {icon ? (
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-900/20">
            {icon}
          </span>
        ) : null}
        <div className="space-y-1.5">
          {eyebrow ? (
            <p className="text-xs uppercase tracking-[0.36em] text-slate-500">{eyebrow}</p>
          ) : null}
          <h1 className="text-[28px] font-display font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? (
          <p className="text-sm text-slate-600 leading-relaxed">{subtitle}</p>
        ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div>
      ) : null}
    </div>
  );
}
