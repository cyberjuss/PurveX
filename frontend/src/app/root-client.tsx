"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { ToastProvider } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { getApiBaseCandidates } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-header";
import { ThemeProvider } from "@/contexts/theme-context";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

export default function RootClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const maxIdleMs = 60 * 60 * 1000;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0] || "login";
  const heroMeta: Record<string, { label: string; title: string; subtitle?: string }> = {
    dashboard: {
      label: "DASHBOARD",
      title: "Security Operations",
      subtitle: "Work with more certainty, move faster, and stop carrying the stress of not knowing whether your detections actually hold up.",
    },
    detections: {
      label: "DETECTIONS",
      title: "Detection Workspace",
      subtitle: "Turn a messy backlog into a body of work you can trust, improve, and be proud to stand behind.",
    },
    tests: {
      label: "TESTS",
      title: "Tests",
      subtitle: "Build the habit of proving your work, learning faster, and steadily raising your level as an operator.",
    },
    lab: {
      label: "LAB",
      title: "Lab",
      subtitle: "Experiment without fear, validate quickly, and create the kind of repetition that compounds into real mastery.",
    },
    settings: {
      label: "SETTINGS",
      title: "Settings",
      subtitle: "Set up the systems that remove friction now so your future work feels calmer, cleaner, and more scalable.",
    },
    notifications: {
      label: "NOTIFICATIONS",
      title: "Notifications",
      subtitle: "See what needs your attention early, before uncertainty turns into drift, missed coverage, or lost time.",
    },
    reports: {
      label: "REPORTS",
      title: "Detection Effectiveness Reports",
      subtitle: "Show progress clearly, prove impact decisively, and make your future opportunities easier to earn.",
    },
    about: {
      label: "ABOUT",
      title: "About PurveX",
      subtitle: "This work is about changing the operator's life: less doubt, more control, stronger judgment, and a bigger future than burnout ever allows.",
    },
    contact: {
      label: "CONTACT",
      title: "Contact PurveX",
      subtitle: "Reach out if you want this platform to help create a measurable shift in how your team works, improves, and grows.",
    },
    creators: {
      label: "CREATORS",
      title: "Creators",
      subtitle: "We build with people who care about elevating practitioners, not just shipping software.",
    },
    developers: {
      label: "DEVELOPERS",
      title: "Developers",
      subtitle: "Build the integrations and workflows that help security teams become sharper, faster, and more effective over time.",
    },
    press: {
      label: "PRESS",
      title: "Press",
      subtitle: "The story is not the product itself. The story is what happens to people when better validation changes how they work and what they can become.",
    },
    "run-test": {
      label: "RUN TEST",
      title: "Run test",
      subtitle: "Create proof, remove guesswork, and turn each run into a step toward a stronger future operating posture.",
    },
    legal: {
      label: "LEGAL",
      title: "Legal",
      subtitle: "The guardrails behind a platform built to create trust, safety, and durable long-term value for the people using it.",
    },
  };
  const localHeaderSegments = new Set(["detections", "tests", "run-test", "notifications", "settings", "lab", "reports"]);
  const hero =
    firstSegment === "agent" ||
    firstSegment === "dashboard" ||
    localHeaderSegments.has(firstSegment) ||
    (firstSegment === "legal" && segments.length > 1)
      ? null
      : heroMeta[firstSegment] || null;
  // Ensure the sidebar is visible by default after hydration; user can toggle to full-screen content.
  useEffect(() => {
    setSidebarOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.getElementById("main-content");
    if (!root) return;
    const elements = Array.from(root.querySelectorAll(".reveal-on-scroll"));
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pathname, children]);
  const isLoginPage = pathname === "/login";
  const isFullBleedPage = ["/agent"].some((route) => pathname.startsWith(route));
  const isTopLevelRoute = segments.length <= 1;
  const hideBreadcrumbsForRoutes: string[] = [];
  const breadcrumbHidden = new Set([
    "dashboard",
    "detections",
    "tests",
    "lab",
    "reports",
    "agent",
    "settings",
  ]);
  const showBreadcrumbs =
    !isFullBleedPage &&
    !isLoginPage &&
    !hideBreadcrumbsForRoutes.some((route) => pathname.startsWith(route)) &&
    !(breadcrumbHidden.has(firstSegment) && isTopLevelRoute);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const getRouteTitle = () => {
      if (pathname.startsWith("/settings/organization")) return "PurveX | Settings | Organization";
      if (pathname.startsWith("/settings/siem")) return "PurveX | Settings | SIEM";
      if (pathname.startsWith("/settings/test-runner")) return "PurveX | Settings | Agents";
      if (pathname.startsWith("/settings/testing-policy")) return "PurveX | Settings | Testing Policy";
      if (pathname.startsWith("/settings/ai-assistant")) return "PurveX | Settings | AI Assistant";
      if (pathname.startsWith("/settings/users")) return "PurveX | Settings | Users";
      if (pathname.startsWith("/settings/audit")) return "PurveX | Settings | Audit";
      if (pathname.startsWith("/tests/schedules")) return "PurveX | Tests | Schedules";
      if (pathname.startsWith("/tests/audit")) return "PurveX | Tests | Audit";
      if (pathname.startsWith("/tests/")) return "PurveX | Tests | Validation Run";
      if (pathname.startsWith("/detections/") && pathname.endsWith("/events")) return "PurveX | Detections | Events";
      if (pathname.startsWith("/detections/")) return "PurveX | Detections | Record";
      return null;
    };

    const titleMap: Record<string, string> = {
      "/": "PurveX | Login",
      "/login": "PurveX | Login",
      "/dashboard": "PurveX | Dashboard",
      "/detections": "PurveX | Detections",
      "/tests": "PurveX | Tests",
      "/lab": "PurveX | Lab",
      "/settings": "PurveX | Settings",
      "/reports": "PurveX | Reports",
      "/run-test": "PurveX | Run Validation",
      "/agent": "PurveX | Watchtower",
      "/about": "PurveX | About",
      "/contact": "PurveX | Contact",
      "/creators": "PurveX | Creators",
      "/developers": "PurveX | Developers",
      "/press": "PurveX | Press",
      "/mitre": "PurveX | MITRE",
      "/notifications": "PurveX | Notifications",
      "/legal": "PurveX | Legal",
    };

    const fallback = firstSegment ? `PurveX | ${firstSegment.charAt(0).toUpperCase()}${firstSegment.slice(1)}` : "PurveX";
    document.title = getRouteTitle() || titleMap[pathname] || fallback;
  }, [pathname, firstSegment]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isLoginPage) return;
    if (!localStorage.getItem("purvex_seen_login") && !localStorage.getItem("purvex_username")) {
      return;
    }

    const lastAuthKey = "purvex_last_auth_check";
    const now = Date.now();
    const last = Number(localStorage.getItem(lastAuthKey) || "0");
    if (last && now - last > maxIdleMs) {
      try {
        localStorage.removeItem(lastAuthKey);
        localStorage.removeItem("purvex_access_token");
        localStorage.removeItem("purvex_username");
        localStorage.removeItem("purvex_user_role");
        localStorage.removeItem("purvex_dev_offline_mode");
        localStorage.removeItem("purvex_seen_login");
      } finally {
        if (window.location.pathname !== "/login") {
          window.location.replace("/login?reason=expired");
        }
      }
      return;
    }

    const enforceSession = async () => {
      try {
        const apiBases = getApiBaseCandidates();
        const base = apiBases[0];
        if (!base) return;
        const res = await fetch(`${base}/auth/me`, {
          credentials: "include",
        });
        if (res.status === 401 || res.status === 403) {
          if (window.location.pathname !== "/login") {
            window.location.replace("/login?reason=expired");
          }
          return;
        }
        localStorage.setItem(lastAuthKey, String(Date.now()));
      } catch {
        // Network or transient errors should not force a logout.
      }
    };

    void enforceSession();
    const handlePageShow = () => {
      void enforceSession();
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [isLoginPage, maxIdleMs, pathname]);


  // Ensure sidebar starts open post-hydration and handle splash/scroll restoration without inline scripts.
  useEffect(() => {
    setSidebarOpen(true);

    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    const hideSplash = () => {
      const splash = document.getElementById("immediate-splash");
      if (splash) splash.style.display = "none";
      htmlEl.style.overflow = "";
      bodyEl.style.overflow = "";
    };

    // Hide scrollbar during initial splash
    htmlEl.style.overflow = "hidden";
    bodyEl.style.overflow = "hidden";

    const safetyTimer = window.setTimeout(() => {
      htmlEl.style.overflow = "";
      bodyEl.style.overflow = "";
    }, 4000);

    const splashTimer = window.setTimeout(hideSplash, 50);

    return () => {
      window.clearTimeout(safetyTimer);
      window.clearTimeout(splashTimer);
      htmlEl.style.overflow = "";
      bodyEl.style.overflow = "";
    };
  }, []);

  // If it's the login page, render without authentication UI
  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="ambient-overlay" aria-hidden />
      <div
          id="immediate-splash"
          suppressHydrationWarning
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "linear-gradient(135deg, #0f172a 0%, #1e293b 25%, #0f172a 50%, #1e293b 75%, #0f172a 100%)",
            backgroundSize: "400% 400%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "2rem",
            }}
          >
            <div
              style={{
                width: "11rem",
                height: "11rem",
                backgroundColor: "white",
                borderRadius: "22%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 25px 50px -12px rgba(59, 130, 246, 0.3)",
              }}
            >
              <Image
                src="/logo.png"
                alt="PurveX"
                width={120}
                height={120}
                priority
                style={{
                  width: "7.5rem",
                  height: "7.5rem",
                  objectFit: "contain",
                }}
              />
            </div>
          </div>
      </div>
      <ThemeProvider>
          <ToastProvider>
          <div className="flex min-h-screen w-screen bg-[var(--surface-shell)] text-[var(--surface-shell-foreground)]">
            <Sidebar
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              onToggle={() => setSidebarOpen((prev) => !prev)}
            />
            {sidebarOpen && (
              <div
                className="fixed inset-0 z-40 bg-black/40 md:hidden transition-opacity duration-200"
                onClick={() => setSidebarOpen(false)}
                aria-hidden
              />
            )}
          <div
            className={cn(
              "relative z-10 flex flex-1 min-w-0 flex-col transition-[padding] duration-200 ease-out",
              sidebarOpen ? "md:pl-64" : "md:pl-0"
            )}
          >
            <TopHeader
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
              breadcrumbs={
                showBreadcrumbs ? <Breadcrumbs variant="header" className="text-xs" /> : null
              }
            />
            <a
              href="#main-content"
              className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-slate-900 focus:text-white focus:px-4 focus:py-2 focus:rounded"
            >
                Skip to main content
              </a>
              <main
                id="main-content"
                className="flex-1 min-w-0 flex flex-col bg-[var(--surface-page)] text-[var(--foreground)]"
              >
                <div className="flex flex-col gap-5 px-6 pb-10 pt-8 sm:px-10 lg:px-14">
                  <div className="w-full max-w-7xl min-w-0 mx-auto flex flex-col gap-3">
                    {!isFullBleedPage && hero && firstSegment !== "login" && firstSegment !== "dashboard" && (
                      <PageHeader
                        title={hero.title}
                        subtitle={hero.subtitle}
                        className="mt-0.5 mb-2 pl-0.5"
                      />
                    )}
                    <div className="min-h-0 flex flex-col">
                      <div className="stagger-children">{children}</div>
                    </div>
                  </div>
                </div>
              </main>
              <footer className="border-t border-[var(--stroke-soft)] bg-[var(--surface-elevated)] text-[var(--surface-elevated-foreground)]">
                <div className="flex h-24 w-full flex-col items-center justify-center gap-1 px-4 text-[11px] leading-tight text-slate-600 dark:text-slate-400 sm:px-6 lg:px-10">
                  <span className="text-center font-semibold text-slate-800">© 2025 PurveX</span>
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
                    <Link href="/about" className="hover:text-indigo-600 hover:underline underline-offset-4">About</Link>
                    <Link href="/press" className="hover:text-indigo-600 hover:underline underline-offset-4">Press</Link>
                    <Link href="/legal/copyright" className="hover:text-indigo-600 hover:underline underline-offset-4">Copyright</Link>
                    <Link href="/contact" className="hover:text-indigo-600 hover:underline underline-offset-4">Contact</Link>
                    <Link href="/creators" className="hover:text-indigo-600 hover:underline underline-offset-4">Creators</Link>
                    <Link href="/legal/ads" className="hover:text-indigo-600 hover:underline underline-offset-4">Advertise</Link>
                    <Link href="/developers" className="hover:text-indigo-600 hover:underline underline-offset-4">Developers</Link>
                    <span className="text-slate-400">•</span>
                    <Link href="/legal/terms" className="hover:text-indigo-600 hover:underline underline-offset-4">Terms</Link>
                    <Link href="/legal/privacy" className="hover:text-indigo-600 hover:underline underline-offset-4">Privacy</Link>
                    <Link href="/legal/safety" className="hover:text-indigo-600 hover:underline underline-offset-4">Safety</Link>
                    <Link href="/legal/how-it-works" className="hover:text-indigo-600 hover:underline underline-offset-4">How PurveX works</Link>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-x-2 text-[10px] text-slate-500">
                    <Link href="/legal/attribution" className="hover:text-indigo-600 hover:underline underline-offset-4">Attribution &amp; Licenses</Link>
                    <span className="text-slate-400">•</span>
                    <span>All rights reserved.</span>
                  </div>
                </div>
              </footer>
          </div>
        </div>
          </ToastProvider>
        </ThemeProvider>
    </>
  );
}
