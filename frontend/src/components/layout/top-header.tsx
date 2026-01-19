"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bell, Menu, X } from "lucide-react";
import { ReactNode } from "react";

type TopHeaderProps = {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  breadcrumbs?: ReactNode;
};

export function TopHeader({ sidebarOpen, onToggleSidebar, breadcrumbs }: TopHeaderProps) {
  const [unreadCount, setUnreadCount] = useState(0);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateFromStorage = () => {
      const raw = window.localStorage.getItem("purvex_unread_test_notification") || "0";
      const parsed = Number.isNaN(Number(raw)) ? 0 : parseInt(raw, 10);
      setUnreadCount(Math.max(0, parsed));
    };

    updateFromStorage();

    const handleCustom = () => updateFromStorage();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "purvex_unread_test_notification") {
        updateFromStorage();
      }
    };

    window.addEventListener("purvex:test-notification", handleCustom as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("purvex:test-notification", handleCustom as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-[#050f1d] text-white shadow-[0_8px_18px_-16px_rgba(0,0,0,0.45)] border-b border-slate-900/70">
        <div className="flex h-16 w-full items-center justify-between px-4 sm:px-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label={sidebarOpen ? "Hide navigation" : "Show navigation"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-[#050f1d] text-white hover:bg-white/10 hover:border-white/30 transition-colors"
            >
              {sidebarOpen ? (
                <X className="h-5 w-5" strokeWidth={2.2} />
              ) : (
                <Menu className="h-5 w-5" strokeWidth={2.2} />
              )}
            </button>
            {/* Removed live posture pill per request */}
            {breadcrumbs ? <div className="ml-1">{breadcrumbs}</div> : null}
          </div>

          <div className="flex items-center gap-2.5 pr-1 sm:pr-2">
            <button
              type="button"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/20 bg-[#050f1d] text-white transition-colors hover:bg-white/10 hover:border-white/30"
              aria-label="View notifications"
              title="View notifications"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.localStorage.removeItem("purvex_unread_test_notification");
                }
                setUnreadCount(0);
                router.push("/notifications");
              }}
            >
              <Bell className="h-4 w-4" strokeWidth={2.2} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-sky-500 text-[10px] font-semibold text-white px-1">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>
    </>
  );
}
