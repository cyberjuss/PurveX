"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building2,
  Users,
  Shield,
  ShieldCheck,
  Settings as SettingsIcon,
  ChevronRight,
  ArrowRight,
  AlertCircle,
  GitBranch,
  KeyRound,
} from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { toneClasses } from "@/lib/status-tone";
import {
  getOrganizationSettings,
  getSiemConnections,
  getTestingPolicySettings,
  listDetectionSources,
  getLicenseStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";

interface SettingsItem {
  id: string;
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: "configured" | "default" | "not_configured";
  statusText?: string;
  count?: number;
  category: "core" | "advanced" | "management";
}

function settingsStatusTone(status?: SettingsItem["status"]): NonNullable<ChipProps["tone"]> {
  if (status === "configured") return "success";
  if (status === "default") return "warning";
  return "muted";
}

export default function SettingsPage() {
  const pathname = usePathname();
  const [siemCount, setSiemCount] = useState<number | null>(null);
  const [hasPolicy, setHasPolicy] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [detectionSourceCount, setDetectionSourceCount] = useState<number | null>(null);
  const [plan, setPlan] = useState<"free" | "paid" | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [
          org,
          siems,
          policy,
          detectionSources,
          license,
        ] = await Promise.allSettled([
          getOrganizationSettings(),
          getSiemConnections(),
          getTestingPolicySettings(),
          listDetectionSources(),
          getLicenseStatus(),
        ]);

        if (cancelled) return;

        if (org.status === "fulfilled") {
          setOrgName(org.value.name);
        }
        if (siems.status === "fulfilled") {
          setSiemCount(siems.value.length);
        }
        if (policy.status === "fulfilled") {
          setHasPolicy(true);
        }
        if (detectionSources.status === "fulfilled") {
          setDetectionSourceCount(detectionSources.value.length);
        }
        if (license.status === "fulfilled") {
          setPlan(license.value.plan);
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
  const settingsItems: SettingsItem[] = [
    {
      id: "organization",
      href: "/settings/organization",
      label: "Organization",
      description: "Set the organization name, contact details, timezone, and default environments.",
      icon: Building2,
      status: orgName ? "configured" : "not_configured",
      statusText: orgName || "Not configured",
      category: "core",
    },
    {
      id: "license",
      href: "/settings/license",
      label: "License",
      description: "View your current plan limits, or paste a license key to unlock the paid tier.",
      icon: KeyRound,
      // Free is a normal, resolved state -- not a gap needing review --
      // so this only reads as "default" (needs attention) while the plan
      // hasn't loaded yet, never just because it's the free tier.
      status: plan ? "configured" : "default",
      statusText: plan === "paid" ? "Paid plan" : plan === "free" ? "Free plan" : undefined,
      category: "core",
    },
    {
      id: "siem",
      href: "/settings/siem",
      label: "SIEM",
      description: "Connect SIEM data sources and define how PurveX reads validation evidence.",
      icon: Shield,
      status: siemConfigured ? "configured" : "not_configured",
      statusText: siemConfigured ? `${siemCount} connected` : "Not configured",
      count: siemCount ?? 0,
      category: "core",
    },
    {
      id: "testing-policy",
      href: "/settings/testing-policy",
      label: "Testing Policy",
      description: "Set allowed environments, production guardrails, and data retention rules.",
      icon: ShieldCheck,
      // The backend auto-creates a default policy row on first read, so a
      // successful fetch says nothing about whether anyone has actually
      // customized it -- defaults are a real, enforced policy, not a gap.
      // Only the fetch itself failing to resolve is worth flagging.
      status: hasPolicy ? "configured" : "default",
      statusText: hasPolicy ? "Configured" : undefined,
      category: "advanced",
    },
    {
      id: "detection-sources",
      href: "/settings/detection-sources",
      label: "Detection-as-Code",
      description: "Import detections from a git repository, or export SIEM-owned detections to git for an audit trail — sync creates proposals that route through the approval inbox.",
      icon: GitBranch,
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
      category: "management",
    },
    {
      id: "audit",
      href: "/settings/audit",
      label: "Audit",
      description: "Review configuration, access, and operational changes over time.",
      icon: Shield,
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
              <div className={cn("mt-0.5 rounded-lg p-2", `${toneClasses("warning").bg}/10`, toneClasses("warning").text)}>
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
                      toneClasses(settingsStatusTone(item.status)).bg,
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
                    <h3 className="truncate text-lg font-display font-semibold text-[var(--surface-card-foreground)]">
                      {item.label}
                    </h3>
                    {item.statusText && (
                      <Chip
                        tone={settingsStatusTone(item.status)}
                        size="md"
                        className="mt-1.5 max-w-full truncate"
                      >
                        {item.statusText}
                      </Chip>
                    )}
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
