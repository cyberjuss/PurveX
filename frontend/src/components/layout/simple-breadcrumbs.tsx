"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type SimpleBreadcrumbsProps = {
  items: BreadcrumbItem[];
  variant?: "light" | "dark";
  className?: string;
};

export function SimpleBreadcrumbs({ 
  items, 
  variant = "light",
  className 
}: SimpleBreadcrumbsProps) {
  if (items.length === 0) return null;

  const isDark = variant === "dark";
  const linkClass = isDark
    ? "hover:text-slate-200 transition-colors text-slate-400"
    : "hover:text-slate-900 transition-colors text-slate-600";
  const currentClass = isDark
    ? "text-slate-200 font-medium"
    : "text-slate-900 font-medium";
  const chevronClass = isDark
    ? "h-4 w-4 text-slate-500"
    : "h-4 w-4 text-slate-400";

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <div key={index} className="flex items-center gap-2">
              {isLast ? (
                <span className={currentClass}>{item.label}</span>
              ) : item.href ? (
                <Link href={item.href} className={linkClass}>
                  {item.label}
                </Link>
              ) : (
                <span className={linkClass}>{item.label}</span>
              )}
              {!isLast && <ChevronRight className={chevronClass} />}
            </div>
          );
        })}
      </div>
    </nav>
  );
}









