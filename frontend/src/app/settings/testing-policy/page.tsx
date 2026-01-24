"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
      } catch (err: any) {
        setError(err.message || "Failed to load testing policy settings.");
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
    } catch (err: any) {
      setError(err.message || "Failed to save testing policy settings.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading testing policy settings...
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-destructive">
        Error loading testing policy settings: {error}
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="text-sm text-muted-foreground">
        No testing policy settings found.
      </div>
    );
  }

  const allowedEnvs = (() => {
    try {
      const parsed = JSON.parse(settings.allowed_environments);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  })();
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
        subtitle="Define where tests run, how they are tagged, and the protections around production."
        icon={<ShieldCheck className="h-5 w-5" />}
      />
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-slate-200 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl font-display font-semibold">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700 border border-slate-200">
                <ShieldCheck className="h-4 w-4 text-slate-700" />
              </span>
              <span>Testing policy &amp; safety</span>
            </CardTitle>
            <CardDescription className="mt-1 text-xs md:text-sm text-slate-600">
              Define where tests run, how they are tagged, and the protections around production.
            </CardDescription>
          </div>
          <div className="hidden md:block">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Policy status</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {riskUnprotectedProd && (
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-800">
                    Prod risk: maintenance off
                  </div>
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
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Scope</p>
                  <h3 className="text-lg font-display font-semibold text-slate-900">Where tests can run</h3>
                  <p className="text-sm text-slate-600">Allow only the environments you want validated.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="allowed_environments">Allowed environments (JSON)</Label>
                  <Textarea
                    id="allowed_environments"
                    value={settings.allowed_environments}
                    onChange={handleChange}
                    placeholder='["lab", "dev"]'
                  />
                  <p className="text-xs text-slate-500">Example: ["lab", "dev"]. Use caution with "prod".</p>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="default_marker_prefix">Marker prefix</Label>
                    <Input id="default_marker_prefix" value={settings.default_marker_prefix} onChange={handleChange} required />
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <span>Include environment + timestamp</span>
                    <Switch
                      checked={settings.include_env_timestamp_in_marker}
                      onCheckedChange={(checked: boolean) => handleCheckboxChange("include_env_timestamp_in_marker", checked)}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Signal</p>
                  <h3 className="text-lg font-display font-semibold text-slate-900">SOC visibility</h3>
                  <p className="text-sm text-slate-600">Make test activity easy to filter and audit.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tag_test_alerts">SOC tag</Label>
                  <Input id="tag_test_alerts" value={settings.tag_test_alerts} onChange={handleChange} required />
                  <p className="text-xs text-slate-500">Example: Purvex_Test = true</p>
                </div>
                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <span>Notify before production tests</span>
                    <Switch
                      checked={settings.notify_before_prod_tests}
                      onCheckedChange={(checked: boolean) => handleCheckboxChange("notify_before_prod_tests", checked)}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <span>Require maintenance windows for production tests</span>
                    <Switch
                      checked={settings.only_prod_during_maintenance_windows}
                      onCheckedChange={(checked: boolean) => handleCheckboxChange("only_prod_during_maintenance_windows", checked)}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 space-y-4">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Schedule</p>
                <h3 className="text-lg font-display font-semibold text-slate-900">Business hours</h3>
                <p className="text-sm text-slate-600">Prevent tests from running during sensitive hours.</p>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
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
                    <Input id="business_hours_start" type="time" value={settings.business_hours_start} onChange={handleChange} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="business_hours_end">End time</Label>
                    <Input id="business_hours_end" type="time" value={settings.business_hours_end} onChange={handleChange} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end">
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm rounded-full px-5"
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
