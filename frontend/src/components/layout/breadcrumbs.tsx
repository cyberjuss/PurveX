"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getDetection } from "@/lib/api";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbsProps = {
  items?: BreadcrumbItem[];
  className?: string;
};

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
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
              ? "Validation Evidence"
              : "Details"
          : segment
              .split("-")
              .map((word) => {
                const upper = word.toUpperCase();
                if (upper === "MITRE") return upper;
                if (upper === "SIEM") return upper;
                if (upper === "AGENT") return "AI Assistant";
                if (upper === "RUN") return "Run";
                if (upper === "LAB") return "Endpoints";
                if (upper === "TESTS" && segment === "tests") return "Tests";
                if (upper === "DASHBOARD") return "Dashboard";
                if (upper === "ALERTS") return "Validation Evidence";
                if (upper === "EVENTS") return "Validation Evidence";
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

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-[var(--surface-subtle-foreground)] sm:text-sm">
        {breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1;

          return (
            <li key={index} className="flex items-center gap-2">
              {index === 0 ? (
                <Link
                  href={item.href || "/dashboard"}
                  className="inline-flex items-center gap-1.5 border border-transparent px-0 py-0 font-medium text-[var(--surface-subtle-foreground)] transition-colors hover:text-[var(--surface-shell-foreground)]"
                >
                  <span>{item.label}</span>
                </Link>
              ) : isLast ? (
                <span className="inline-flex items-center gap-1.5 px-0 py-0 font-semibold text-[var(--surface-shell-foreground)]">
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href!}
                  className="inline-flex items-center gap-1.5 border border-transparent px-0 py-0 font-medium text-[var(--surface-subtle-foreground)] transition-colors hover:text-[var(--surface-shell-foreground)]"
                >
                  {item.label}
                </Link>
              )}
              {!isLast && (
                <ChevronRight className="h-3.5 w-3.5 text-[var(--surface-subtle-foreground)]" strokeWidth={2.5} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
