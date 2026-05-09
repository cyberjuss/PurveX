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
  ChevronRight,
  ArrowRight,
  AlertCircle,
  GitBranch,
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import {
  getOrganizationSettings,
  getSiemConnections,
  getEnvironmentRunners,
  getTestingPolicySettings,
  getAIAssistantSettings,
  listDetectionSources,
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

export default function SettingsPage() {
  const pathname = usePathname();
  const [siemCount, setSiemCount] = useState<number | null>(null);
  const [runnerCount, setRunnerCount] = useState<number | null>(null);
  const [hasPolicy, setHasPolicy] = useState(false);
  const [hasAiAssistant, setHasAiAssistant] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [detectionSourceCount, setDetectionSourceCount] = useState<number | null>(null);

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
          detectionSources,
        ] = await Promise.allSettled([
          getOrganizationSettings(),
          getSiemConnections(),
          getEnvironmentRunners(),
          getTestingPolicySettings(),
          getAIAssistantSettings(),
          listDetectionSources(),
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
        if (detectionSources.status === "fulfilled") {
          setDetectionSourceCount(detectionSources.value.length);
        }
      } finally {
        // Intentionally no local loading gate here; the overview can render
        // progressively as each settings domain resolves.
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const siemConfigured = (siemCount ?? 0) > 0;
  const runnersConfigured = (runnerCount ?? 0) > 0;
  const settingsItems: SettingsItem[] = [
    {
      id: "organization",
      href: "/settings/organization",
      label: "Organization",
      description: "Set the organization name, contact details, timezone, and default environments.",
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
      description: "Connect SIEM data sources and define how PurveX reads validation evidence.",
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
      label: "Agents",
      description: "Register validation agents and control where validations can run.",
      icon: ServerCog,
      color: "indigo",
      status: runnersConfigured ? "configured" : "not_configured",
      statusText: runnersConfigured ? `${runnerCount} agent(s)` : "Not configured",
      count: runnerCount ?? 0,
      category: "core",
    },
    {
      id: "testing-policy",
      href: "/settings/testing-policy",
      label: "Testing Policy",
      description: "Set allowed environments, production guardrails, and data retention rules.",
      icon: ShieldCheck,
      color: "cyan",
      status: hasPolicy ? "configured" : "default",
      statusText: hasPolicy ? "Configured" : "Using defaults",
      category: "advanced",
    },
    {
      id: "ai-assistant",
      href: "/settings/ai-assistant",
      label: "Watchtower",
      description: "Configure Watchtower's LLM provider, privacy controls, and analysis behavior.",
      icon: Sparkles,
      color: "amber",
      status: hasAiAssistant ? "configured" : "default",
      statusText: hasAiAssistant ? "Configured" : "Using defaults",
      category: "advanced",
    },
    {
      id: "detection-sources",
      href: "/settings/detection-sources",
      label: "Detection Sources",
      description: "Connect a git repository to treat detections as code — sync creates proposals that route through the approval inbox.",
      icon: GitBranch,
      color: "violet",
      status: (detectionSourceCount ?? 0) > 0 ? "configured" : "not_configured",
      statusText:
        (detectionSourceCount ?? 0) > 0
          ? `${detectionSourceCount} source${detectionSourceCount === 1 ? "" : "s"}`
          : "Not configured",
      count: detectionSourceCount ?? 0,
      category: "advanced",
    },
    {
      id: "users",
      href: "/settings/users",
      label: "Users",
      description: "Add workspace members, assign roles, and manage access.",
      icon: Users,
      color: "slate",
      category: "management",
    },
    {
      id: "audit",
      href: "/settings/audit",
      label: "Audit",
      description: "Review configuration, access, and operational changes over time.",
      icon: Shield,
      color: "purple",
      category: "management",
    },
  ];

  const nextActions = settingsItems
    .filter(
      (item) =>
        item.status === "not_configured" || item.status === "default"
    );

  return (
    <PageContainer maxWidth="full">
      <div className="mx-auto max-w-7xl px-8 py-8 space-y-6">
        <PageHeader
          eyebrow="Platform configuration"
          title="Settings"
          subtitle="Configure the systems PurveX depends on, who can use them, and how validation should run."
          icon={<SettingsIcon className="h-5 w-5" />}
        />

        {nextActions.length > 0 && (
          <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5 shadow-[var(--shadow-soft)]" data-tour="settings-next-actions">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-amber-50 p-2 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                <AlertCircle className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-sm font-display font-semibold text-[var(--surface-card-foreground)]">Needs attention</h2>
                    <p className="text-sm text-[var(--surface-subtle-foreground)]">
                      {nextActions.length} setting area{nextActions.length === 1 ? "" : "s"} still need review.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-2 md:flex-row md:flex-wrap">
                  {nextActions.slice(0, 3).map((action) => (
                    <Link
                      key={action.id}
                      href={action.href}
                      className="inline-flex items-center gap-2 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-2 text-sm font-medium text-[var(--surface-card-foreground)] transition-colors hover:bg-[var(--interactive-surface-hover)]"
                    >
                      <span>{action.label}</span>
                      <span className="text-[var(--surface-subtle-foreground)]">{action.statusText}</span>
                      <ArrowRight className="h-4 w-4 text-[var(--surface-subtle-foreground)]" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {settingsItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.id}
                href={item.href}
                data-tour={`settings-${item.id}`}
                className={cn(
                  "group relative rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6 transition-all duration-200 hover:border-[var(--accent-line)] hover:shadow-[var(--shadow-soft)]",
                  isActive && "border-[var(--accent-line)] shadow-[var(--shadow-soft)]"
                )}
              >
                {item.status && (
                  <div
                    className={cn(
                      "absolute left-0 right-0 top-0 h-1 rounded-t-2xl",
                      item.status === "configured"
                        ? "bg-emerald-500"
                        : item.status === "default"
                          ? "bg-amber-500"
                          : "bg-[var(--surface-subtle-foreground)]"
                    )}
                  />
                )}

                <div className="flex items-start gap-4">
                  <div className={cn(
                    "flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--surface-elevated)] text-[var(--surface-subtle-foreground)] transition-colors group-hover:bg-[var(--interactive-surface-hover)]",
                    isActive && "bg-[var(--interactive-surface-hover)]"
                  )}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="truncate text-lg font-display font-semibold text-[var(--surface-card-foreground)]">
                        {item.label}
                      </h3>
                      {item.statusText && (
                        <span
                          className={cn(
                            "rounded-lg px-2.5 py-1 text-xs font-semibold",
                            item.status === "configured"
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                              : item.status === "default"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                                : "bg-[var(--surface-elevated)] text-[var(--surface-subtle-foreground)]"
                          )}
                        >
                          {item.statusText}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--surface-subtle-foreground)]">
                      {item.description}
                    </p>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 flex-shrink-0 text-[var(--surface-subtle-foreground)] transition-colors group-hover:text-[var(--surface-card-foreground)]" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </PageContainer>
  );
}
