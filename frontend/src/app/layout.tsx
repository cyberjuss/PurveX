"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { Sidebar } from "@/components/layout/sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { ToastProvider } from "@/components/ui/toast";
import { LoadingSplash } from "@/components/loading-splash";
import { Geist, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";
import { getApiBaseCandidates } from "@/lib/api";
import { UnifiedPageHeader } from "@/components/layout/unified-page-header";
import { ThemeProvider } from "@/contexts/theme-context";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";

const formatSegmentTitle = (value: string) => {
  if (!value) return "Home";
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

// Configure Geist for body text - modern SaaS clarity
const inter = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

// Configure Space Grotesk for headings - futuristic, confident
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
  weight: ["400", "500", "600", "700"],
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const maxIdleMs = 60 * 60 * 1000;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [prevRoute, setPrevRoute] = useState<string | null>(null);
  const [prevChildren, setPrevChildren] = useState<React.ReactNode | null>(null);
  const lastChildrenRef = useRef<React.ReactNode | null>(null);
  const prevPathRef = useRef<string | null>(null);
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0] || "dashboard";
  const heroMeta: Record<string, { label: string; title: string; subtitle?: string }> = {
    dashboard: {
      label: "DASHBOARD",
      title: "Security Operations",
      subtitle: "Real-time visibility into your detection engineering",
    },
    detections: {
      label: "DETECTIONS",
      title: "Detection Workspace",
      subtitle: "Manage and validate your detection engineering portfolio",
    },
    tests: {
      label: "TESTS",
      title: "Tests",
      subtitle: "Run, review, and tune detection tests",
    },
    lab: {
      label: "LAB",
      title: "Lab",
      subtitle: "Experiment safely and validate detection changes",
    },
    settings: {
      label: "SETTINGS",
      title: "Settings",
      subtitle: "Control data sources, runners, and platform policies",
    },
    notifications: {
      label: "NOTIFICATIONS",
      title: "Notifications",
      subtitle: "Recent activity across tests and detections",
    },
    reports: {
      label: "REPORTS",
      title: "Detection Effectiveness Reports",
      subtitle: "Generate comprehensive PDF reports proving detection effectiveness",
    },
    about: {
      label: "ABOUT",
      title: "About PurveX",
      subtitle: "PurveX is built for detection engineering teams that need clarity, speed, and confidence when validating security controls.",
    },
    contact: {
      label: "CONTACT",
      title: "Contact PurveX",
      subtitle: "We would love to hear from you. Reach out for product questions, partnerships, or feedback.",
    },
    creators: {
      label: "CREATORS",
      title: "Creators",
      subtitle: "We collaborate with practitioners and open communities to improve detection engineering.",
    },
    developers: {
      label: "DEVELOPERS",
      title: "Developers",
      subtitle: "Extend PurveX through integrations, automations, and telemetry pipelines that keep detections current.",
    },
    press: {
      label: "PRESS",
      title: "Press",
      subtitle: "Media inquiries, demos, and product background for the PurveX platform.",
    },
    "run-test": {
      label: "RUN TEST",
      title: "Run test",
      subtitle: "Launch and monitor scoped validation runs with live status and telemetry.",
    },
    legal: {
      label: "LEGAL",
      title: "Legal",
      subtitle: "Policies, terms, and disclosures for the PurveX platform.",
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
    if (prevRoute === null) {
      setPrevRoute(pathname);
      prevPathRef.current = pathname;
      lastChildrenRef.current = children;
      return;
    }
    if (prevPathRef.current !== pathname) {
      setPrevChildren(lastChildrenRef.current);
      const timeout = setTimeout(() => {
        setPrevChildren(null);
      }, 240);
      prevPathRef.current = pathname;
      setPrevRoute(pathname);
      lastChildrenRef.current = children;
      return () => clearTimeout(timeout);
    }
    lastChildrenRef.current = children;
  }, [pathname, prevRoute]);

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
  const lastSegment = segments[segments.length - 1] || firstSegment;
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

    const titleMap: Record<string, string> = {
      "/login": "PurveX | Login",
      "/dashboard": "PurveX | Dashboard",
      "/detections": "PurveX | Detections",
      "/alerts": "PurveX | Events",
      "/events": "PurveX | Events",
      "/tests": "PurveX | Tests",
      "/lab": "PurveX | Lab",
      "/settings": "PurveX | Settings",
      "/reports": "PurveX | Reports",
      "/run-test": "PurveX | Run Test",
      "/agent": "PurveX | Agent",
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
    document.title = titleMap[pathname] || fallback;
  }, [pathname, firstSegment]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isLoginPage) return;

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
      } catch (err) {
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
  }, [isLoginPage, pathname]);


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
    return (
      <html
        lang="en"
        className={`${inter.variable} ${spaceGrotesk.variable} bg-background`}
        suppressHydrationWarning
      >
        <head>
          <link rel="icon" href="/purvex-favicon.svg" />
          <link rel="apple-touch-icon" sizes="180x180" href="/logo.png?v=6" />
          <link rel="shortcut icon" href="/purvex-favicon.svg" />
        </head>
        <body className={`${inter.className} text-foreground`} suppressHydrationWarning>
          {children}
        </body>
      </html>
    );
  }

                return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} bg-background`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const theme = localStorage.getItem('purvex-theme') || 'dark';
                if (theme === 'dark') {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              })();
            `,
          }}
        />
        <link rel="icon" href="/purvex-favicon.svg" />
        <link rel="apple-touch-icon" sizes="180x180" href="/logo.png?v=6" />
        <link rel="shortcut icon" href="/purvex-favicon.svg" />
      </head>
      <body className={`${inter.className} text-foreground`} suppressHydrationWarning>
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
          <LoadingSplash />
          <ToastProvider>
          <div className="flex min-h-screen w-screen bg-white text-slate-900">
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
                className="flex-1 min-w-0 bg-white text-slate-900 flex flex-col"
              >
                <div className="flex flex-col gap-5 px-6 pb-10 pt-8 sm:px-10 lg:px-14">
                  <div className="w-full max-w-7xl min-w-0 mx-auto flex flex-col gap-3">
                    {!isFullBleedPage && hero && firstSegment !== "login" && firstSegment !== "dashboard" && (
                      <UnifiedPageHeader
                        title={hero.title}
                        subtitle={hero.subtitle}
                        className="mt-0.5 mb-2 pl-0.5"
                      />
                    )}
                    <div className="min-h-0 flex flex-col route-transition-wrap">
                      {prevChildren && (
                        <div
                          className="route-layer route-fade-out"
                          style={{ position: "absolute", inset: 0 }}
                          aria-hidden
                        >
                          {prevChildren}
                        </div>
                      )}
                      <div className="route-layer route-fade-in stagger-children">{children}</div>
                    </div>
                  </div>
                </div>
              </main>
              <footer className="border-t border-slate-200 bg-white">
                <div className="flex h-24 w-full flex-col items-center justify-center gap-1 px-4 text-[11px] leading-tight text-slate-600 sm:px-6 lg:px-10">
                  <span className="text-center font-semibold text-slate-800">© 2025 PurveX</span>
                  <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
                    <Link href="/about" className="hover:text-indigo-600 hover:underline underline-offset-4">About</Link>
                    <Link href="/press" className="hover:text-indigo-600 hover:underline underline-offset-4">Press</Link>
                    <Link href="/legal/copyright" className="hover:text-indigo-600 hover:underline underline-offset-4">Copyright</Link>
                    <Link href="/contact" className="hover:text-indigo-600 hover:underline underline-offset-4">Contact</Link>
                    <Link href="/legal/creators" className="hover:text-indigo-600 hover:underline underline-offset-4">Creators</Link>
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
      </body>
    </html>
  );
}
