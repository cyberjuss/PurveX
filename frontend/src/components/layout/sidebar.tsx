"use client";

import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Shield, Activity, Settings, Bot, LogOut, FlaskConical, Menu, FileText } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch, getDetections, type Detection } from "@/lib/api";

type SidebarProps = {
  open: boolean;
  onClose?: () => void;
  onToggle?: () => void;
};

const links = [
  { href: "/", label: "Home", icon: Activity },
  { href: "/detections", label: "Detections", icon: Shield },
  { href: "/tests", label: "Tests", icon: Activity },
  { href: "/lab", label: "Lab", icon: FlaskConical },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/agent", label: "Watchtower", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ open, onClose, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [inventoryScore, setInventoryScore] = useState<number | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const userName = "Administrator";
  const userRole = "Admin";
  const userInitials = userName
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    async function loadInventoryHealth() {
      try {
        const dets = await getDetections();

        const scores: number[] = dets
          .map((d: Detection) => {
            if (typeof d.last_score === "number") return d.last_score;
            switch ((d.last_result || "").toUpperCase()) {
              case "PASS":
                return 90;
              case "FAIL":
                return 30;
              case "INCONCLUSIVE":
                return 10;
              default:
                return 0;
            }
          });

        if (scores.length === 0) {
          setInventoryScore(null);
          return;
        }

        const avg = scores.reduce((sum, v) => sum + v, 0) / scores.length;
        setInventoryScore(Math.round(avg));
      } catch {
        // Silent failure – sidebar should never block the app.
        setInventoryScore(null);
      }
    }

    loadInventoryHealth();
  }, []);

  /**
   * Clear all local session state and route back to the login screen.
   * Backend JWT validation still protects APIs; this is purely a UX layer.
   */
    async function handleSignOut() {
      if (isLoggingOut) return;
      setIsLoggingOut(true);
      if (typeof window !== "undefined") {
        try {
          await apiFetch("/auth/logout", { method: "POST" });
        } catch {
          // Proceed with client-side cleanup even if the server call fails.
        }
        localStorage.removeItem("purvex_username");
        localStorage.removeItem("purvex_user_role");
        localStorage.removeItem("purvex_dev_offline_mode");
        localStorage.removeItem("purvex_seen_login");
      }
      onClose?.();
      setTimeout(() => {
        startTransition(() => {
          router.replace("/login");
          router.refresh();
        });
      }, 220);
    }

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[60] bg-[#050b17] transition-opacity duration-300 ease-out",
          isLoggingOut ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen flex-col overflow-hidden text-slate-100 transition-all duration-200 ease-out",
          "bg-gradient-to-b from-[#060d1b] via-[#08162f] to-[#050f1d] backdrop-blur-xl border-r border-slate-800/60 shadow-[8px_0_30px_-18px_rgba(5,15,29,0.75)]",
          open ? "translate-x-0 w-64" : "-translate-x-full w-64",
          isLoggingOut ? "opacity-0" : "opacity-100"
        )}
        aria-hidden={false}
      >
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between px-5 py-4 border-b border-slate-800/60">
        <Link
          href="/"
          aria-label="Go to PurveX home"
          className="flex items-center gap-3"
          onClick={onClose}
        >
          <Image src="/logo.png" alt="PurveX Logo" width={32} height={32} className="rounded-lg" />
          <span className="text-lg font-semibold font-display text-white tracking-tight">PurveX</span>
        </Link>
          <button
            type="button"
            onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/60 bg-slate-900/70 text-slate-200 hover:bg-slate-800 transition-colors"
            aria-label="Close sidebar"
          >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          </button>
      </div>

      {/* Desktop Header */}
      <div className="hidden md:flex items-center gap-3 h-16 px-5 border-b border-slate-800/60">
        <Link
          href="/"
          aria-label="Go to PurveX home"
          className="flex h-12 w-12 items-center justify-center rounded-lg"
        >
          <Image src="/logo.png" alt="PurveX Logo" width={36} height={36} className="rounded-lg" />
        </Link>
        <div className="flex items-center flex-1">
          <span className="text-lg font-semibold font-display text-white tracking-tight">PurveX</span>
        </div>
      </div>

      <nav className="flex-1 px-5 pt-5 pb-4 space-y-1.5 overflow-y-auto hide-scrollbar">
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500 px-1 pb-2">
          Navigation
        </div>
        {links.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href ||
          (href === "/settings" && pathname.startsWith("/settings")) ||
          (href === "/tests" && pathname.startsWith("/tests")) ||
          (href === "/detections" && pathname.startsWith("/detections"));
          
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-0 text-sm font-medium transition-all group relative h-12 border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7561f6]/40 focus-visible:ring-offset-0",
                active
                  ? "bg-[#7561f6]/14 text-white border-[#7561f6]/50 shadow-[0_12px_30px_-18px_rgba(117,97,246,0.65)]"
                  : "text-slate-200 border-transparent hover:text-white hover:bg-white/8 hover:border-white/10"
              )}
              aria-current={active ? "page" : undefined}
            >
              <div
                className={cn(
                  "absolute inset-y-2 left-0 w-[3px] rounded-full transition-all duration-200",
                  active ? "bg-gradient-to-b from-[#9fb2ff] via-[#7561f6] to-[#5a4fe0]" : "bg-transparent"
                )}
              />
              <Icon
                className={cn(
                  "h-5 w-5 flex-shrink-0 transition-colors duration-150",
                  active ? "text-[#c5d2ff]" : "text-slate-400 group-hover:text-white"
                )}
                strokeWidth={2}
              />
              <span className="tracking-tight">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-slate-800/60 mt-auto">
        <button
          type="button"
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-900/70 px-4 py-3 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 hover:border-slate-500"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white text-sm font-semibold">
            {userInitials}
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-semibold text-white leading-tight">{userName}</div>
            <div className="text-[11px] text-slate-400 leading-tight">{userRole}</div>
          </div>
          <LogOut className="h-4 w-4 text-slate-300" />
        </button>
      </div>
      </aside>
    </>
  );
}
