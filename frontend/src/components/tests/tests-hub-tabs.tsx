"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, Play, Compass } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/tests", label: "History", icon: History, match: (p: string) => p === "/tests" },
  { href: "/run-test", label: "Run New", icon: Play, match: (p: string) => p.startsWith("/run-test") },
  { href: "/tests/explore", label: "Explore", icon: Compass, match: (p: string) => p.startsWith("/tests/explore") },
];

/**
 * Shared tab bar rendered at the top of /tests, /run-test, and
 * /tests/explore. These are three separate routes (each too large/complex
 * to safely fold into one file), but they're really one hub — run a test,
 * see its history, or browse by MITRE technique. This tab bar is what
 * makes that legible instead of three disconnected nav destinations.
 */
export function TestsHubTabs() {
  const pathname = usePathname() || "";
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium transition",
              active
                ? "bg-[var(--surface-card)] text-[var(--foreground)] shadow-sm"
                : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
