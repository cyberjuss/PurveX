"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsRow,
  SettingsBanner,
  SettingsSaveBar,
  SettingsStatusPill,
} from "@/components/settings/settings-section";

interface TestingPolicySettings {
  allowed_environments: string;
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

const ENVIRONMENT_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
  detail: string;
}> = [
  { id: "lab", label: "Lab", detail: "Controlled validation and safe first runs." },
  { id: "dev", label: "Dev", detail: "Shared pre-production validation." },
  { id: "prod", label: "Prod", detail: "Live environment — pair with a maintenance window." },
];

const RETENTION_ROWS: ReadonlyArray<{
  label: string;
  passKey: RetentionKey;
  failKey: RetentionKey;
}> = [
  { label: "Lab", passKey: "retention_pass_days_lab", failKey: "retention_fail_days_lab" },
  { label: "Dev", passKey: "retention_pass_days_dev", failKey: "retention_fail_days_dev" },
  { label: "Prod", passKey: "retention_pass_days_prod", failKey: "retention_fail_days_prod" },
];

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

export default function TestingPolicySettingsPage() {
  const [settings, setSettings] = useState<TestingPolicySettings | null>(null);
  const [pristine, setPristine] = useState<TestingPolicySettings | null>(null);
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
        setPristine(data);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to load testing policy settings."));
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const dirty = !!settings && !!pristine && JSON.stringify(settings) !== JSON.stringify(pristine);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    const { id, value, type } = target;
    const checked = type === "checkbox" ? target.checked : undefined;
    setSettings((prev) => (prev ? { ...prev, [id]: type === "checkbox" ? checked : value } : null));
  };

  const handleSwitch = (id: keyof TestingPolicySettings, checked: boolean) => {
    setSettings((prev) => (prev ? { ...prev, [id]: checked } : null));
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

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    setError(null);
    try {
      await apiFetch("/settings/testing-policy", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setPristine(settings);
      router.refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save testing policy settings."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => setSettings(pristine);

  if (loading) {
    return (
      <SettingsPageShell eyebrow="Safety" title="Testing Policy">
        <div className="space-y-6 py-8">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SettingsPageShell>
    );
  }

  if (error && !settings) {
    return (
      <SettingsPageShell eyebrow="Safety" title="Testing Policy">
        <SettingsBanner tone="danger" title="Couldn't load settings">
          {error}
        </SettingsBanner>
      </SettingsPageShell>
    );
  }

  if (!settings) return null;

  const allowedEnvs = parseAllowedEnvironments(settings.allowed_environments);
  const prodAllowed = allowedEnvs.includes("prod");
  const maintenanceRequired = settings.only_prod_during_maintenance_windows;
  const riskUnprotectedProd = prodAllowed && !maintenanceRequired;

  return (
    <>
      <SettingsPageShell
        eyebrow="Safety"
        title="Testing Policy"
        description="Where validations may run, how production is protected, and how long evidence is kept."
        status={
          riskUnprotectedProd ? (
            <SettingsStatusPill tone="warn">Prod unprotected</SettingsStatusPill>
          ) : prodAllowed ? (
            <SettingsStatusPill tone="ok">Prod protected</SettingsStatusPill>
          ) : (
            <SettingsStatusPill tone="muted">Prod off</SettingsStatusPill>
          )
        }
        banner={
          riskUnprotectedProd ? (
            <SettingsBanner
              tone="warning"
              title="Production tests are allowed without a maintenance window"
            >
              Either disable Prod, or require a maintenance window in the
              "Production safeguards" section below.
            </SettingsBanner>
          ) : error ? (
            <SettingsBanner tone="danger" title="Save failed">
              {error}
            </SettingsBanner>
          ) : undefined
        }
      >
        <SettingsSection
          title="Allowed environments"
          description="Validations are blocked anywhere not in this list."
        >
          <div className="space-y-2">
            {ENVIRONMENT_OPTIONS.map((environment) => (
              <SettingsRow
                key={environment.id}
                label={environment.label}
                description={environment.detail}
                control={
                  <Switch
                    checked={allowedEnvs.includes(environment.id)}
                    onCheckedChange={(checked: boolean) =>
                      handleAllowedEnvironmentToggle(environment.id, checked === true)
                    }
                  />
                }
              />
            ))}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Test markers"
          description="Markers let SOC analysts quickly filter test traffic from real alerts."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="default_marker_prefix">Marker prefix</Label>
              <Input
                id="default_marker_prefix"
                value={settings.default_marker_prefix}
                onChange={handleChange}
                required
              />
            </div>
            <SettingsRow
              label="Include environment + timestamp"
              description="Appends env/timestamp to every marker for traceability."
              control={
                <Switch
                  checked={settings.include_env_timestamp_in_marker}
                  onCheckedChange={(checked: boolean) =>
                    handleSwitch("include_env_timestamp_in_marker", checked)
                  }
                />
              }
            />
            <div className="space-y-1.5">
              <Label htmlFor="tag_test_alerts">SOC alert tag</Label>
              <Input
                id="tag_test_alerts"
                value={settings.tag_test_alerts}
                onChange={handleChange}
                required
                placeholder="Purvex_Test = true"
              />
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                Added to every alert generated by a PurveX test.
              </p>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Production safeguards"
          description="Extra controls applied when targeting prod environments."
        >
          <div className="space-y-1">
            <SettingsRow
              label="Notify before production tests"
              description="Sends a heads-up to the primary contact before any prod run."
              control={
                <Switch
                  checked={settings.notify_before_prod_tests}
                  onCheckedChange={(checked: boolean) =>
                    handleSwitch("notify_before_prod_tests", checked)
                  }
                />
              }
            />
            <SettingsRow
              label="Require maintenance window"
              description="Prod tests are blocked outside a declared window."
              control={
                <Switch
                  checked={settings.only_prod_during_maintenance_windows}
                  onCheckedChange={(checked: boolean) =>
                    handleSwitch("only_prod_during_maintenance_windows", checked)
                  }
                />
              }
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Business hours"
          description="Optionally block all tests during sensitive hours."
        >
          <div className="space-y-4">
            <SettingsRow
              label="Block tests during business hours"
              control={
                <Switch
                  checked={settings.disallow_tests_during_business_hours}
                  onCheckedChange={(checked: boolean) =>
                    handleSwitch("disallow_tests_during_business_hours", checked)
                  }
                />
              }
            />
            {settings.disallow_tests_during_business_hours && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="business_hours_start">Start</Label>
                  <Input
                    id="business_hours_start"
                    type="time"
                    value={settings.business_hours_start}
                    onChange={handleChange}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="business_hours_end">End</Label>
                  <Input
                    id="business_hours_end"
                    type="time"
                    value={settings.business_hours_end}
                    onChange={handleChange}
                  />
                </div>
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          title="Data retention"
          description="How long validation runs are kept before automatic purging."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="test_data_retention_days">Global retention (days)</Label>
              <Input
                id="test_data_retention_days"
                type="number"
                min={1}
                value={settings.test_data_retention_days ?? 90}
                onChange={handleChange}
                className="max-w-xs"
              />
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                Default: 90 days. Per-environment overrides take precedence.
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                Per-environment overrides
              </p>
              <div className="overflow-hidden rounded-lg border border-[var(--stroke-soft)]">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--surface-elevated)] text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Env</th>
                      <th className="px-3 py-2 text-left font-semibold">Pass (days)</th>
                      <th className="px-3 py-2 text-left font-semibold">Fail (days)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--stroke-soft)]">
                    {RETENTION_ROWS.map((row) => (
                      <tr key={row.label}>
                        <td className="px-3 py-2 font-medium text-[var(--surface-card-foreground)]">
                          {row.label}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            id={row.passKey}
                            type="number"
                            min={1}
                            value={settings[row.passKey] ?? ""}
                            onChange={handleChange}
                            className="max-w-[6rem]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            id={row.failKey}
                            type="number"
                            min={1}
                            value={settings[row.failKey] ?? ""}
                            onChange={handleChange}
                            className="max-w-[6rem]"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                Defaults: Lab 7/30, Dev 30/90, Prod 90/180 (Pass / Fail).
              </p>
            </div>
          </div>
        </SettingsSection>
      </SettingsPageShell>

      <SettingsSaveBar
        saving={isSaving}
        dirty={dirty}
        onSave={handleSave}
        onReset={handleReset}
        saveLabel="Save policy"
      />
    </>
  );
}
