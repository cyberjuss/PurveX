"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  Users,
  Shield,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Settings as SettingsIcon,
  Calendar,
  CheckCircle2,
  Circle,
  ArrowRight,
  ChevronRight,
  Zap,
  Target,
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import {
  getOrganizationSettings,
  getSiemConnections,
  getEnvironmentRunners,
  getTestingPolicySettings,
  getAIAssistantSettings,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface SettingsItem {
  id: string;
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  status?: "configured" | "default" | "not_configured";
  statusText?: string;
  count?: number;
  category: "core" | "advanced" | "management";
}

const categoryTabs = [
  { id: "all", label: "All Settings", icon: SettingsIcon },
  { id: "core", label: "Platform Setup", icon: Target },
  { id: "advanced", label: "Policy & Controls", icon: Zap },
  { id: "management", label: "People & Governance", icon: Users },
] as const;

export default function SettingsPage() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [siemCount, setSiemCount] = useState<number | null>(null);
  const [runnerCount, setRunnerCount] = useState<number | null>(null);
  const [hasPolicy, setHasPolicy] = useState(false);
  const [hasAiAssistant, setHasAiAssistant] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<"all" | "core" | "advanced" | "management">("all");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [
          org,
          siems,
          runners,
          policy,
          aiSettings,
        ] = await Promise.allSettled([
          getOrganizationSettings(),
          getSiemConnections(),
          getEnvironmentRunners(),
          getTestingPolicySettings(),
          getAIAssistantSettings(),
        ]);

        if (cancelled) return;

        if (org.status === "fulfilled") {
          setOrgName(org.value.name);
        }
        if (siems.status === "fulfilled") {
          setSiemCount(siems.value.length);
        }
        if (runners.status === "fulfilled") {
          setRunnerCount(runners.value.length);
        }
        if (policy.status === "fulfilled") {
          setHasPolicy(true);
        }
        if (aiSettings.status === "fulfilled") {
          setHasAiAssistant(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const siemConfigured = (siemCount ?? 0) > 0;
  const runnersConfigured = (runnerCount ?? 0) > 0;
  const domainsTotal = 5;
  const domainsConfigured =
    (orgName ? 1 : 0) +
    (siemConfigured ? 1 : 0) +
    (runnersConfigured ? 1 : 0) +
    (hasPolicy ? 1 : 0) +
    (hasAiAssistant ? 1 : 0);
  const openIssues = Math.max(domainsTotal - domainsConfigured, 0);

  const settingsItems: SettingsItem[] = [
    {
      id: "organization",
      href: "/settings/organization",
      label: "Organization",
      description: "Org name, contact, time zone, and global defaults",
      icon: Building2,
      color: "sky",
      status: orgName ? "configured" : "not_configured",
      statusText: orgName || "Not configured",
      category: "core",
    },
    {
      id: "siem",
      href: "/settings/siem",
      label: "SIEM",
      description: "Splunk and other SIEM connections plus marker patterns",
      icon: Shield,
      color: "emerald",
      status: siemConfigured ? "configured" : "not_configured",
      statusText: siemConfigured ? `${siemCount} connected` : "Not configured",
      count: siemCount ?? 0,
      category: "core",
    },
    {
      id: "test-runner",
      href: "/settings/test-runner",
      label: "Agent",
      description: "Where and how atomic tests execute (lab, staging, prod)",
      icon: ServerCog,
      color: "indigo",
      status: runnersConfigured ? "configured" : "not_configured",
      statusText: runnersConfigured ? `${runnerCount} runner(s)` : "None yet",
      count: runnerCount ?? 0,
      category: "core",
    },
    {
      id: "testing-policy",
      href: "/settings/testing-policy",
      label: "Testing Policy & Safety",
      description: "Business hours, prod guardrails, and marker conventions",
      icon: ShieldCheck,
      color: "cyan",
      status: hasPolicy ? "configured" : "default",
      statusText: hasPolicy ? "Guardrails set" : "Using defaults",
      category: "advanced",
    },
    {
      id: "ai-assistant",
      href: "/settings/ai-assistant",
      label: "AI Assistant",
      description: "Control how PurveX-AI explains, tunes, and shares data",
      icon: Sparkles,
      color: "amber",
      status: hasAiAssistant ? "configured" : "default",
      statusText: hasAiAssistant ? "Configured" : "Off by default",
      category: "advanced",
    },
    {
      id: "users",
      href: "/settings/users",
      label: "Users & Access",
      description: "Manage user accounts and assign roles for access control",
      icon: Users,
      color: "slate",
      category: "management",
    },
    {
      id: "security",
      href: "/settings/security",
      label: "Security",
      description: "Two-factor authentication and account security settings",
      icon: Shield,
      color: "sky",
      category: "management",
    },
    {
      id: "audit",
      href: "/settings/audit",
      label: "Audit Log",
      description: "View and analyze all security-sensitive actions and administrative changes",
      icon: Shield,
      color: "purple",
      category: "management",
    },
    {
      id: "schedules",
      href: "/settings/schedules",
      label: "Test Schedules",
      description: "Schedule tests to run automatically at specified times or intervals",
      icon: Calendar,
      color: "indigo",
      category: "management",
    },
  ];

  const filteredItems = activeCategory === "all" 
    ? settingsItems 
    : settingsItems.filter(item => item.category === activeCategory);

  const nextActions = settingsItems
    .filter(
      (item) =>
        item.status === "not_configured" || item.status === "default"
    )
    .slice(0, 2);

  const coreItems = settingsItems.filter(item => item.category === "core");
  const advancedItems = settingsItems.filter(item => item.category === "advanced");
  const managementItems = settingsItems.filter(item => item.category === "management");

  return (
    <PageContainer maxWidth="full" className="p-0">

        <div className="max-w-7xl mx-auto px-8 py-8">
          {/* Category Tabs - Unique Horizontal Design */}
          <div className="flex items-center gap-3 mb-8 overflow-x-auto hide-scrollbar pb-2" data-tour="settings-categories">
            {categoryTabs.map((cat) => {
              const Icon = cat.icon;
              const isActive = activeCategory === cat.id;
              const count =
                cat.id === "all"
                  ? settingsItems.length
                  : cat.id === "core"
                    ? coreItems.length
                    : cat.id === "advanced"
                      ? advancedItems.length
                      : managementItems.length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id as typeof activeCategory)}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2.5 rounded-full border transition-all duration-200 whitespace-nowrap focus-visible:outline-none shadow-sm",
                    isActive
                      ? "bg-white text-slate-900 border-slate-300 font-semibold"
                      : "bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  )}
                  aria-label={`Filter settings by ${cat.label}`}
                  aria-pressed={isActive}
                >
                  <Icon className={cn("h-4 w-4", isActive ? "text-slate-900" : "text-slate-500")} />
                  <span className="font-display font-semibold">{cat.label}</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-xs font-semibold border",
                    isActive ? "bg-white text-slate-700 border-slate-300" : "bg-slate-50 text-slate-600 border-slate-200"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Main Content Grid - Unique 3-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Left Column - Core Settings */}
            <div className="lg:col-span-2 space-y-6">
              {/* Hero Section */}
              <div className="p-8 rounded-3xl bg-white border border-slate-200">
                <div className="flex items-start justify-between gap-6 mb-3">
                  <div className="flex-1">
                    <h2 className="text-2xl font-display font-bold text-slate-900 mb-3">
                      Settings Workspace
                    </h2>
                    <p className="text-base font-body text-slate-600 leading-relaxed">
                      Connect SIEMs, runners, policies, and AI to match your environment. Move from
                      lab testing to production-ready coverage in one place.
                    </p>
                  </div>
                  {/* Progress Ring */}
                  <div className="flex-shrink-0">
                    <div className="relative w-20 h-20">
                      <svg className="transform -rotate-90 w-20 h-20">
                        <circle
                          cx="40"
                          cy="40"
                          r="36"
                          stroke="currentColor"
                          strokeWidth="6"
                          fill="none"
                          className="text-slate-200"
                        />
                        <circle
                          cx="40"
                          cy="40"
                          r="36"
                          stroke="currentColor"
                          strokeWidth="6"
                          fill="none"
                          strokeDasharray={`${(domainsConfigured / domainsTotal) * 226} 226`}
                          className="text-slate-900 transition-all duration-500"
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-center">
                          <div className="text-2xl font-display font-bold text-slate-900">{domainsConfigured}</div>
                          <div className="text-xs font-body text-slate-600">/{domainsTotal}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Settings Grid - Unique Card Design */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = pathname === item.href;
                  const statusColor =
                    item.status === "configured"
                      ? "emerald"
                      : item.status === "default"
                      ? "amber"
                      : "slate";

                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      data-tour={`settings-${item.id}`}
                      className={cn(
                        "group relative p-6 rounded-2xl transition-all duration-300",
                        "hover:scale-[1.02] hover:shadow-lg border border-slate-200",
                        isActive
                          ? "bg-white shadow-md"
                          : "bg-white hover:shadow-md"
                      )}
                    >
                      {/* Status Indicator Bar */}
                      {item.status && (
                        <div className={cn(
                          "absolute top-0 left-0 right-0 h-1 rounded-t-2xl",
                          item.status === "configured" ? "bg-emerald-500" :
                          item.status === "default" ? "bg-amber-500" :
                          "bg-slate-600"
                        )} />
                      )}
                      
                      <div className="flex items-start gap-4">
                        <div className={cn(
                          "h-14 w-14 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm transition-all duration-300",
                          isActive
                            ? item.color === "sky" ? "bg-sky-100" :
                              item.color === "emerald" ? "bg-emerald-100" :
                              item.color === "indigo" ? "bg-indigo-100" :
                              item.color === "cyan" ? "bg-cyan-100" :
                              item.color === "violet" ? "bg-violet-100" :
                              item.color === "amber" ? "bg-amber-100" :
                              item.color === "purple" ? "bg-purple-100" :
                              "bg-slate-100"
                            : "bg-slate-100 group-hover:bg-slate-200"
                        )}>
                          <Icon className={cn(
                            "h-6 w-6 transition-colors",
                            isActive
                              ? item.color === "sky" ? "text-sky-600" :
                                item.color === "emerald" ? "text-emerald-600" :
                                item.color === "indigo" ? "text-indigo-600" :
                                item.color === "cyan" ? "text-cyan-600" :
                                item.color === "violet" ? "text-violet-600" :
                                item.color === "amber" ? "text-amber-600" :
                                item.color === "purple" ? "text-purple-600" :
                                "text-slate-600"
                              : "text-slate-500 group-hover:text-slate-600"
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <h3 className={cn(
                              "text-lg font-display font-bold truncate",
                              isActive ? "text-slate-900" : "text-slate-900 group-hover:text-slate-900"
                            )}>
                              {item.label}
                            </h3>
                            {item.status && (
                              <div className={cn(
                                "h-2 w-2 rounded-full flex-shrink-0",
                                item.status === "configured" ? "bg-emerald-400" :
                                item.status === "default" ? "bg-amber-400" :
                                "bg-slate-500"
                              )} />
                            )}
                          </div>
                          <p className="text-sm font-body text-slate-600 line-clamp-2 mb-3">
                            {item.description}
                          </p>
                          {item.statusText && (
                            <div className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold",
                              item.status === "configured" ? "bg-emerald-50 text-emerald-700" :
                              item.status === "default" ? "bg-amber-50 text-amber-700" :
                              "bg-slate-100 text-slate-600"
                            )}>
                              {item.statusText}
                            </div>
                          )}
                        </div>
                        <ChevronRight className={cn(
                          "h-5 w-5 flex-shrink-0 transition-all",
                          isActive ? "text-sky-600" : "text-slate-400 group-hover:text-slate-600"
                        )} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right Column - Quick Actions & Stats */}
            <div className="space-y-6">
              {/* Next Actions */}
              {nextActions.length > 0 && (
                <div className="p-6 rounded-2xl bg-white border border-slate-200" data-tour="settings-next-actions">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap className="h-5 w-5 text-amber-600" />
                    <h3 className="text-lg font-display font-bold text-slate-900">Next Actions</h3>
                  </div>
                  <p className="text-sm font-body text-slate-600 mb-4">
                    Complete these to improve test reliability
                  </p>
                  <div className="space-y-3">
                    {nextActions.map((action) => {
                      const Icon = action.icon;
                      return (
                        <Link
                          key={action.id}
                          href={action.href}
                          className="group flex items-center gap-3 p-4 rounded-xl bg-white hover:bg-slate-50 transition-all duration-200 border border-slate-200"
              >
                          <div className={cn(
                            "h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0",
                            action.color === "sky" ? "bg-sky-100" :
                            action.color === "emerald" ? "bg-emerald-100" :
                            action.color === "indigo" ? "bg-indigo-100" :
                            "bg-slate-100"
                          )}>
                            <Icon className={cn(
                              "h-5 w-5",
                              action.color === "sky" ? "text-sky-600" :
                              action.color === "emerald" ? "text-emerald-600" :
                              action.color === "indigo" ? "text-indigo-600" :
                              "text-slate-600"
                            )} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-display font-semibold text-slate-900 truncate">
                              {action.label}
                            </h4>
                          </div>
                          <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Quick Stats */}
              <div className="p-6 rounded-2xl bg-white border border-slate-200">
                <h3 className="text-lg font-display font-bold text-slate-900 mb-4">Progress</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-body text-slate-600">Configured</span>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span className="text-xl font-display font-bold text-slate-900">{domainsConfigured}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-body text-slate-600">Remaining</span>
                    <div className="flex items-center gap-2">
                      <Circle className="h-4 w-4 text-amber-600" />
                      <span className="text-xl font-display font-bold text-slate-900">{openIssues}</span>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-body text-slate-600">Completion</span>
                      <span className="text-2xl font-display font-bold text-slate-900">
                        {Math.round((domainsConfigured / domainsTotal) * 100)}%
                </span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-900 transition-all duration-500"
                        style={{ width: `${(domainsConfigured / domainsTotal) * 100}%` }}
                      />
                    </div>
          </div>
        </div>
            </div>

              {/* Status Pills */}
              <div className="p-6 rounded-2xl bg-white border border-slate-200">
                <h3 className="text-lg font-display font-bold text-slate-900 mb-4">Status</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Org", value: orgName || "Not named", status: orgName ? "configured" : "not_configured", color: "sky" },
                    { label: "SIEM", value: siemConfigured ? `${siemCount} connected` : "Not configured", status: siemConfigured ? "configured" : "not_configured", color: "emerald" },
                    { label: "Runners", value: runnersConfigured ? `${runnerCount} defined` : "None yet", status: runnersConfigured ? "configured" : "not_configured", color: "indigo" },
                    { label: "Policy", value: hasPolicy ? "Guardrails set" : "Using defaults", status: hasPolicy ? "configured" : "default", color: "cyan" },
                    { label: "AI", value: hasAiAssistant ? "Configured" : "Off", status: hasAiAssistant ? "configured" : "default", color: "amber" },
                  ].map((pill) => (
                    <div
                      key={pill.label}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-body",
                        pill.status === "configured"
                          ? pill.color === "sky" ? "bg-sky-50 text-sky-700" :
                            pill.color === "emerald" ? "bg-emerald-50 text-emerald-700" :
                            pill.color === "indigo" ? "bg-indigo-50 text-indigo-700" :
                            pill.color === "cyan" ? "bg-cyan-50 text-cyan-700" :
                            pill.color === "violet" ? "bg-violet-50 text-violet-700" :
                            "bg-amber-50 text-amber-700"
                          : pill.status === "default"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      )}
                    >
                      <div
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          pill.status === "configured"
                            ? pill.color === "sky" ? "bg-sky-400" :
                              pill.color === "emerald" ? "bg-emerald-400" :
                              pill.color === "indigo" ? "bg-indigo-400" :
                              pill.color === "cyan" ? "bg-cyan-400" :
                              pill.color === "violet" ? "bg-violet-400" :
                              "bg-amber-400"
                            : pill.status === "default"
                            ? "bg-amber-400"
                            : "bg-slate-500"
                        )}
                      />
                      <span className="font-semibold">{pill.label}:</span>
                      <span>{pill.value}</span>
          </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
      </div>
    </PageContainer>
  );
}
