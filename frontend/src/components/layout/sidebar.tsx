"use client";

import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Shield, Activity, Settings, Bot, LogOut, FileText } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";

type SidebarProps = {
  open: boolean;
  onClose?: () => void;
  onToggle?: () => void;
};

const links = [
  { href: "/dashboard", label: "Dashboard", icon: Activity },
  { href: "/detections", label: "Detections", icon: Shield },
  { href: "/tests", label: "Tests", icon: Activity },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/agent", label: "Watchtower", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ open, onClose, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [userName, setUserName] = useState("User");
  const [userRole, setUserRole] = useState("Member");
  void onToggle;

  const userInitials = userName
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const user = await apiFetch("/auth/me", { cache: "no-store" });
        if (cancelled) return;
        const resolvedName =
          user.username?.trim() ||
          user.email?.split("@")[0]?.trim() ||
          "User";
        setUserName(resolvedName);
        setUserRole(user.is_admin ? "Administrator" : "Member");
      } catch {
        if (!cancelled) {
          setUserName("User");
          setUserRole("Member");
        }
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

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
    startTransition(() => {
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[60] bg-black/60 transition-opacity duration-300 ease-out",
          isLoggingOut ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen flex-col overflow-hidden text-slate-100 transition-all duration-200 ease-out",
          "bg-[var(--surface-shell)] backdrop-blur-xl border-r border-[var(--stroke-soft)] shadow-[8px_0_30px_-18px_rgba(0,0,0,0.55)]",
          open ? "translate-x-0 w-64" : "-translate-x-full w-64",
          isLoggingOut ? "opacity-0" : "opacity-100"
        )}
        aria-hidden={false}
      >
        <div className="md:hidden flex items-center justify-between px-5 py-4 border-b border-[var(--stroke-soft)]">
          <Link
            href="/dashboard"
            aria-label="Go to PurveX home"
            className="flex items-center gap-3"
            onClick={onClose}
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--surface-elevated)] ring-1 ring-[var(--stroke-soft)]">
              <Image src="/logo.png" alt="PurveX Logo" width={30} height={30} className="h-[30px] w-[30px] object-contain" />
            </div>
            <span className="text-[21px] font-semibold font-display text-[var(--surface-shell-foreground)] tracking-tight">PurveX</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--interactive-border)] bg-[var(--interactive-surface)] text-[var(--interactive-foreground)] hover:bg-[var(--interactive-surface-hover)] transition-colors"
            aria-label="Close sidebar"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="hidden md:flex items-center gap-3 h-16 px-5 border-b border-[var(--stroke-soft)]">
          <Link
            href="/dashboard"
            aria-label="Go to PurveX home"
            className="flex h-[52px] w-[52px] items-center justify-center rounded-xl bg-[var(--surface-elevated)] ring-1 ring-[var(--stroke-soft)]"
          >
            <Image src="/logo.png" alt="PurveX Logo" width={34} height={34} className="h-[34px] w-[34px] object-contain" />
          </Link>
          <div className="flex items-center flex-1">
            <span className="text-[22px] font-semibold font-display text-[var(--surface-shell-foreground)] tracking-tight">PurveX</span>
          </div>
        </div>

        <nav className="flex-1 px-5 pt-5 pb-4 space-y-1.5 overflow-y-auto hide-scrollbar">
          <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--surface-subtle-foreground)] px-1 pb-2">
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
                  "flex items-center gap-3 rounded-lg px-4 py-0 text-sm font-medium transition-all group relative h-12 border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)] focus-visible:ring-offset-0",
                  active
                    ? "bg-[var(--accent-soft)] text-[var(--surface-shell-foreground)] border-[var(--accent-line)] shadow-[0_12px_28px_-18px_rgba(0,0,0,0.45)]"
                    : "text-[var(--surface-subtle-foreground)] border-transparent hover:text-[var(--surface-shell-foreground)] hover:bg-[var(--surface-elevated)] hover:border-[var(--stroke-soft)]"
                )}
                aria-current={active ? "page" : undefined}
              >
                <div
                  className={cn(
                    "absolute inset-y-2 left-0 w-[3px] rounded-full transition-all duration-200",
                    active ? "bg-[var(--accent-strong)]" : "bg-transparent"
                  )}
                />
                <Icon
                  className={cn(
                    "h-5 w-5 flex-shrink-0 transition-colors duration-150",
                    active ? "text-[var(--accent-strong)]" : "text-slate-400 group-hover:text-[var(--surface-shell-foreground)]"
                  )}
                  strokeWidth={2}
                />
                <span className="tracking-tight">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-[var(--stroke-soft)] mt-auto">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center gap-3 rounded-xl border border-[var(--interactive-border)] bg-[var(--interactive-surface)] px-4 py-3 text-sm font-medium text-[var(--interactive-foreground)] transition-colors hover:bg-[var(--interactive-surface-hover)] hover:border-[var(--accent-line)]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--surface-shell-foreground)] text-sm font-semibold">
              {userInitials}
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold text-[var(--surface-shell-foreground)] leading-tight">{userName}</div>
              <div className="text-[11px] text-[var(--surface-subtle-foreground)] leading-tight">{userRole}</div>
            </div>
            <LogOut className="h-4 w-4 text-[var(--surface-subtle-foreground)]" />
          </button>
        </div>
      </aside>
    </>
  );
}
