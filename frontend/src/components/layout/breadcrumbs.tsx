"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import { getDetection } from "@/lib/api";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbsProps = {
  items?: BreadcrumbItem[];
  variant?: "light" | "dark" | "header";
  className?: string;
};

export function Breadcrumbs({ items, variant = "light", className }: BreadcrumbsProps) {
  const pathname = usePathname();
  const [detectionLabels, setDetectionLabels] = useState<Record<string, string>>({});
  const detectionLabelsRef = useRef<Record<string, string>>({});

  // Auto-generate breadcrumbs from pathname if items not provided
  const breadcrumbItems: BreadcrumbItem[] =
    items ||
    (() => {
      const segments = pathname.split("/").filter(Boolean);
      const result: BreadcrumbItem[] = [{ label: "Dashboard", href: "/dashboard" }];

      let currentPath = "";
      segments.forEach((segment, index) => {
        currentPath += `/${segment}`;
        const isLast = index === segments.length - 1;

        // Format segment label
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
        const isNumeric = /^\d+$/.test(segment);
        const prevSegment = index > 0 ? segments[index - 1] : "";
        const label = isUuid
          ? prevSegment === "detections"
            ? detectionLabels[segment] || "Detection"
            : "Details"
          : isNumeric
          ? prevSegment === "tests"
            ? "Validation Run"
            : prevSegment === "events" || prevSegment === "alerts"
              ? "Event Record"
              : "Details"
          : segment
              .split("-")
              .map((word) => {
                const upper = word.toUpperCase();
                if (upper === "MITRE") return upper;
                if (upper === "SIEM") return upper;
                if (upper === "AGENT") return "Watchtower";
                if (upper === "RUN") return "Run";
                if (upper === "TESTS" && segment === "tests") return "Tests";
                if (upper === "DASHBOARD") return "Dashboard";
                if (upper === "ALERTS") return "Signals";
                if (upper === "EVENTS") return "Signals";
                return word.charAt(0).toUpperCase() + word.slice(1);
              })
              .join(" ");

        result.push({
          label,
          href: isLast ? undefined : currentPath,
        });
      });

      return result;
    })();

  useEffect(() => {
    detectionLabelsRef.current = detectionLabels;
  }, [detectionLabels]);

  useEffect(() => {
    if (items) return;
    const segments = pathname.split("/").filter(Boolean);
    const detectionId = segments.find((segment, index) => {
      const prev = index > 0 ? segments[index - 1] : "";
      return (
        prev === "detections" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)
      );
    });

    if (!detectionId) return;

    let cancelled = false;

    const load = async () => {
      try {
        if (detectionLabelsRef.current[detectionId]) return;
        const detection = await getDetection(detectionId);
        if (!cancelled && detection?.title) {
          setDetectionLabels((prev) => ({
            ...prev,
            [detectionId]: detection.title,
          }));
        }
      } catch {
        // Keep fallback label if detection lookup fails.
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [items, pathname]);

  if (breadcrumbItems.length <= 1) return null;

  const isLight = variant === "light";
  const isHeader = variant === "header";

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol
        className={cn(
          "flex flex-wrap items-center text-xs sm:text-sm",
          isHeader
            ? "gap-1 text-slate-500"
            : isLight
            ? "gap-2 text-slate-500"
            : "gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-200 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-md"
        )}
      >
        {breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1;

          return (
            <li key={index} className="flex items-center gap-2">
              {index === 0 ? (
                <Link
                  href={item.href || "/dashboard"}
                  className={cn(
                    "inline-flex items-center gap-1.5 border border-transparent font-medium transition-colors",
                    isHeader
                      ? "px-0 py-0 text-slate-500 hover:text-slate-200"
                      : isLight
                      ? "rounded-full px-2.5 py-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                      : "text-slate-200/85 hover:text-white hover:border-white/15 hover:bg-white/10"
                  )}
                >
                  <span>{item.label}</span>
                </Link>
              ) : isLast ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 font-semibold",
                    isHeader
                      ? "px-0 py-0 text-slate-200"
                      : isLight
                      ? "rounded-full px-2.5 py-1 text-slate-900"
                      : "border border-white/15 bg-white/10 text-white shadow-inner"
                  )}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href!}
                  className={cn(
                    "inline-flex items-center gap-1.5 border border-transparent font-medium transition-colors",
                    isHeader
                      ? "px-0 py-0 text-slate-500 hover:text-slate-200"
                      : isLight
                      ? "rounded-full px-2.5 py-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                      : "text-slate-200/85 hover:border-white/15 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {item.label}
                </Link>
              )}
              {!isLast && (
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5",
                    isHeader ? "text-slate-500" : isLight ? "text-slate-400" : "text-slate-500"
                  )}
                  strokeWidth={2.5}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
