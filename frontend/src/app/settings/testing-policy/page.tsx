"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api";
import { ShieldCheck } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

interface TestingPolicySettings {
  allowed_environments: string; // JSON string
  default_marker_prefix: string;
  include_env_timestamp_in_marker: boolean;
  tag_test_alerts: string;
  notify_before_prod_tests: boolean;
  disallow_tests_during_business_hours: boolean;
  business_hours_start: string;
  business_hours_end: string;
  only_prod_during_maintenance_windows: boolean;
  test_data_retention_days: number;
  retention_pass_days_lab: number;
  retention_fail_days_lab: number;
  retention_pass_days_dev: number;
  retention_fail_days_dev: number;
  retention_pass_days_prod: number;
  retention_fail_days_prod: number;
}

type RetentionKey =
  | "retention_pass_days_lab"
  | "retention_fail_days_lab"
  | "retention_pass_days_dev"
  | "retention_fail_days_dev"
  | "retention_pass_days_prod"
  | "retention_fail_days_prod";

const ENVIRONMENT_OPTIONS = [
  { id: "lab", label: "Lab", detail: "Use for controlled validation and safe first runs." },
  { id: "dev", label: "Dev", detail: "Use for shared pre-production validation." },
  { id: "prod", label: "Prod", detail: "Use only when protections and notifications are in place." },
] as const;

function parseAllowedEnvironments(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getRetentionValue(settings: TestingPolicySettings, key: RetentionKey) {
  return settings[key];
}

export default function TestingPolicySettingsPage() {
  const [settings, setSettings] = useState<TestingPolicySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function fetchSettings() {
      try {
        setLoading(true);
        const data = await apiFetch("/settings/testing-policy");
        setSettings(data);
      } catch (error: unknown) {
        setError(getErrorMessage(error, "Failed to load testing policy settings."));
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    const { id, value, type } = target;
    const checked = type === "checkbox" ? target.checked : undefined;
    setSettings(prev => (prev ? { ...prev, [id]: type === "checkbox" ? checked : value } : null));
  };

  const handleCheckboxChange = (id: keyof TestingPolicySettings, checked: boolean) => {
    setSettings(prev => (prev ? { ...prev, [id]: checked } : null));
  };

  const handleAllowedEnvironmentToggle = (environment: string, checked: boolean) => {
    setSettings((prev) => {
      if (!prev) return null;
      const current = new Set(parseAllowedEnvironments(prev.allowed_environments));
      if (checked) current.add(environment);
      else current.delete(environment);
      return { ...prev, allowed_environments: JSON.stringify(Array.from(current)) };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setIsSaving(true);
    setError(null);
    try {
      await apiFetch("/settings/testing-policy", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      router.refresh();
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to save testing policy settings."));
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <PageContainer maxWidth="xl" className="space-y-6">
        <PageHeader
          eyebrow="Safety controls"
          title="Testing Policy"
          subtitle="Configure where validations can run, how production is protected, and how long validation evidence is kept."
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </PageContainer>
    );
  }
  if (error) {
    return (
      <PageContainer maxWidth="xl" className="space-y-6">
        <PageHeader
          eyebrow="Safety controls"
          title="Testing Policy"
          subtitle="Configure where validations can run, how production is protected, and how long validation evidence is kept."
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <Card><CardContent className="pt-6 text-sm text-destructive">Error loading testing policy settings: {error}</CardContent></Card>
      </PageContainer>
    );
  }
  if (!settings) {
    return (
      <PageContainer maxWidth="xl" className="space-y-6">
        <PageHeader
          eyebrow="Safety controls"
          title="Testing Policy"
          subtitle="Configure where validations can run, how production is protected, and how long validation evidence is kept."
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">No testing policy settings found.</CardContent></Card>
      </PageContainer>
    );
  }

  const allowedEnvs = parseAllowedEnvironments(settings.allowed_environments);
  const prodAllowed = allowedEnvs.includes("prod");
  const notificationsOn = settings.notify_before_prod_tests;
  const maintenanceRequired = settings.only_prod_during_maintenance_windows;
  const businessHoursBlocked = settings.disallow_tests_during_business_hours;
  const riskUnprotectedProd = prodAllowed && !maintenanceRequired;

  return (
    <PageContainer maxWidth="xl" className="space-y-6">
        <PageHeader
        eyebrow="Safety controls"
        title="Testing Policy"
        subtitle="Configure where validations can run, how production is protected, and how long validation evidence is kept."
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-sm">
        <CardContent className="pt-6">
          <div className="mb-5 rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-3">
            <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Policy status</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              {riskUnprotectedProd && (
                <Chip tone="warning" size="md" className="font-semibold">
                  Prod risk: maintenance off
                </Chip>
              )}
              <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                <span className="font-semibold uppercase tracking-[0.18em] text-[10px]">Prod</span>
                <span className={prodAllowed ? "text-amber-700" : "text-emerald-700"}>
                  {prodAllowed ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                <span className="font-semibold uppercase tracking-[0.18em] text-[10px]">Notify</span>
                <span className={notificationsOn ? "text-emerald-700" : "text-slate-500"}>
                  {notificationsOn ? "On" : "Off"}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                <span className="font-semibold uppercase tracking-[0.18em] text-[10px]">Hours</span>
                <span className={businessHoursBlocked ? "text-emerald-700" : "text-slate-500"}>
                  {businessHoursBlocked ? "Blocked" : "Allowed"}
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                <span className="font-semibold uppercase tracking-[0.18em] text-[10px]">Maint</span>
                <span className={maintenanceRequired ? "text-emerald-700" : "text-slate-500"}>
                  {maintenanceRequired ? "Required" : "Optional"}
                </span>
              </div>
            </div>
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-5 space-y-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Scope</p>
                  <h3 className="text-lg font-display font-semibold text-[var(--foreground)]">Where tests can run</h3>
                  <p className="text-sm text-slate-600">Allow only the environments you want validated.</p>
                </div>
                <div className="space-y-2">
                  <Label>Allowed environments</Label>
                  <div className="space-y-2">
                    {ENVIRONMENT_OPTIONS.map((environment) => (
                      <label
                        key={environment.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-4 py-3 text-sm text-slate-700"
                      >
                        <div>
                          <p className="font-medium text-[var(--foreground)]">{environment.label}</p>
                          <p className="mt-1 text-xs text-slate-500">{environment.detail}</p>
                        </div>
                        <Checkbox
                          checked={allowedEnvs.includes(environment.id)}
                          onCheckedChange={(checked) => handleAllowedEnvironmentToggle(environment.id, checked === true)}
                        />
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">Enable only the environments your team is prepared to validate safely.</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="default_marker_prefix">Marker prefix</Label>
                    <Input id="default_marker_prefix" value={settings.default_marker_prefix} onChange={handleChange} required className="bg-[var(--surface-card)] text-[var(--foreground)] border-[var(--stroke-soft)]" />
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-4 py-3 text-sm text-slate-700">
                    <span>Include environment + timestamp</span>
                    <Switch
                      checked={settings.include_env_timestamp_in_marker}
                      onCheckedChange={(checked: boolean) => handleCheckboxChange("include_env_timestamp_in_marker", checked)}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-5 space-y-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Signal</p>
                  <h3 className="text-lg font-display font-semibold text-[var(--foreground)]">SOC visibility</h3>
                  <p className="text-sm text-slate-600">Make test activity easy to filter and audit.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tag_test_alerts">SOC tag</Label>
                  <Input id="tag_test_alerts" value={settings.tag_test_alerts} onChange={handleChange} required className="bg-white text-[var(--foreground)] border-slate-200" />
                  <p className="text-xs text-slate-500">Example: Purvex_Test = true</p>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-4 py-3 text-sm text-slate-700">
                    <span>Notify before production tests</span>
                    <Switch
                      checked={settings.notify_before_prod_tests}
                      onCheckedChange={(checked: boolean) => handleCheckboxChange("notify_before_prod_tests", checked)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-4 py-3 text-sm text-slate-700">
                    <span>Require maintenance windows for production tests</span>
                    <Switch
                      checked={settings.only_prod_during_maintenance_windows}
                      onCheckedChange={(checked: boolean) => handleCheckboxChange("only_prod_during_maintenance_windows", checked)}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-5 space-y-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Schedule</p>
                <h3 className="text-lg font-display font-semibold text-[var(--foreground)]">Business hours</h3>
                <p className="text-sm text-slate-600">Prevent tests from running during sensitive hours.</p>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] px-4 py-3 text-sm text-slate-700">
                <span>Block tests during business hours</span>
                <Switch
                  checked={settings.disallow_tests_during_business_hours}
                  onCheckedChange={(checked: boolean) => handleCheckboxChange("disallow_tests_during_business_hours", checked)}
                />
              </label>
              {settings.disallow_tests_during_business_hours && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="business_hours_start">Start time</Label>
                    <Input id="business_hours_start" type="time" value={settings.business_hours_start} onChange={handleChange} className="bg-white text-[var(--foreground)] border-slate-200" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="business_hours_end">End time</Label>
                    <Input id="business_hours_end" type="time" value={settings.business_hours_end} onChange={handleChange} className="bg-white text-[var(--foreground)] border-slate-200" />
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-5 space-y-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Retention</p>
                <h3 className="text-lg font-display font-semibold text-[var(--foreground)]">Test data retention</h3>
                <p className="text-sm text-slate-600">
                  Controls how long validation run data is kept before automatic purging.
                </p>
              </div>
              <div className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4 space-y-2">
                <Label htmlFor="test_data_retention_days">Global data retention (days)</Label>
                <Input
                  id="test_data_retention_days"
                  type="number"
                  min={1}
                  value={settings.test_data_retention_days ?? 90}
                  onChange={handleChange}
                  className="bg-white text-[var(--foreground)] border-slate-200 max-w-xs"
                />
                <p className="text-xs text-slate-500">Runs older than this are automatically purged. Default: 90 days.</p>
              </div>
              <h4 className="text-sm font-semibold text-slate-700 pt-2">Per-environment overrides</h4>
              <div className="grid gap-4 lg:grid-cols-3">
                {[
                  {
                    label: "Lab",
                    passKey: "retention_pass_days_lab" as RetentionKey,
                    failKey: "retention_fail_days_lab" as RetentionKey,
                  },
                  {
                    label: "Dev",
                    passKey: "retention_pass_days_dev" as RetentionKey,
                    failKey: "retention_fail_days_dev" as RetentionKey,
                  },
                  {
                    label: "Prod",
                    passKey: "retention_pass_days_prod" as RetentionKey,
                    failKey: "retention_fail_days_prod" as RetentionKey,
                  },
                ].map((row) => (
                  <div key={row.label} className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-4 space-y-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                      {row.label}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={row.passKey}>PASS retention (days)</Label>
                        <Input
                          id={row.passKey}
                          type="number"
                          min={1}
                          value={getRetentionValue(settings, row.passKey) ?? ""}
                          onChange={handleChange}
                          className="bg-white text-[var(--foreground)] border-slate-200"
                        />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={row.failKey}>FAIL/INCONCLUSIVE retention (days)</Label>
                        <Input
                          id={row.failKey}
                          type="number"
                          min={1}
                          value={getRetentionValue(settings, row.failKey) ?? ""}
                          onChange={handleChange}
                          className="bg-white text-[var(--foreground)] border-slate-200"
                        />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                Defaults: Lab 7/30, Dev 30/90, Prod 90/180 (PASS/FAIL).
              </p>
            </div>

            <div className="flex items-center justify-end">
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-white hover:bg-slate-50 text-[var(--foreground)] border border-[var(--stroke-soft)] shadow-sm rounded-full px-5"
              >
                {isSaving ? "Saving..." : "Save policy"}
              </Button>
            </div>
          </form>
        </CardContent>
    </Card>
    </PageContainer>
  );
}
