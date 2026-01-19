"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "rounded-[28px] bg-white shadow-[0_4px_20px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.1)] border border-slate-100 px-6 py-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between",
        className
      )}
    >
      <div className="space-y-1.5 max-w-4xl">
        <h1 className="text-[26px] font-display font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? (
          <p className="text-sm text-slate-600 leading-relaxed">{subtitle}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div>
      ) : null}
    </div>
  );
}
