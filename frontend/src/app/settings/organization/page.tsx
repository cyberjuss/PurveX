"use client";

import { useState, useEffect } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { Building2 } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

interface OrganizationSettings {
  name: string;
  primary_contact_email?: string;
  timezone: string;
  locale: string;
  default_environment_names: string; // JSON string for now
  compliance_mode_flags: string; // JSON string for now
}

export default function OrganizationSettingsPage() {
  const { hasPermission } = usePermissions();
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function fetchSettings() {
      try {
        setLoading(true);
        const data = await apiFetch("/settings/organization");
        setSettings(data);
      } catch (err: any) {
        setError(err.message || "Failed to load organization settings.");
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setSettings(prev => (prev ? { ...prev, [id]: value } : null));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setIsSaving(true);
    setError(null);
    try {
      await apiFetch("/settings/organization", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      // Optionally, show a success message
      router.refresh(); // Re-fetch data or update UI
    } catch (err: any) {
      setError(err.message || "Failed to save organization settings.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading organization settings...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;
  if (!settings) return <p className="text-muted-foreground">No organization settings found.</p>;

  return (
    <PageContainer maxWidth="lg" className="space-y-6">
      <PageHeader
        eyebrow="Organization"
        title="Organization Settings"
        subtitle="Set the defaults, locale, and compliance posture for this workspace."
        icon={<Building2 className="h-5 w-5" />}
      />
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl font-display font-semibold">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-sky-100 text-sky-600 border border-sky-200">
                <Building2 className="h-4 w-4" />
              </span>
              <span>Organization settings</span>
            </CardTitle>
            <CardDescription className="mt-1 text-xs md:text-sm text-slate-600">
              Manage your organization&apos;s identity, time zone, and global defaults for every workspace.
            </CardDescription>
          </div>
          <p className="hidden text-[11px] text-slate-500 md:block max-w-sm text-right">
            These settings define how PurveX presents your org across reports, exports, and events.
          </p>
        </CardHeader>
        <CardContent className="pt-4 space-y-6">
          {!hasPermission(Permission.SETTINGS_ORG_MANAGE) ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You don't have permission to modify organization settings. Only administrators can update these settings.
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                Identity
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Organization name</Label>
                  <Input id="name" value={settings.name} onChange={handleChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="primary_contact_email">Primary contact email</Label>
                  <Input
                    id="primary_contact_email"
                    type="email"
                    value={settings.primary_contact_email || ""}
                    onChange={handleChange}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                Locale &amp; time
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="timezone">Time zone</Label>
                  <Input id="timezone" value={settings.timezone} onChange={handleChange} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="locale">Locale</Label>
                  <Input id="locale" value={settings.locale} onChange={handleChange} required />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                Advanced defaults
              </p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="default_environment_names">Default environment names (JSON array)</Label>
                  <Textarea
                    id="default_environment_names"
                    value={settings.default_environment_names}
                    onChange={handleChange}
                    placeholder='["lab", "dev", "prod"]'>
                  </Textarea>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compliance_mode_flags">Compliance mode flags (JSON array)</Label>
                  <Textarea
                    id="compliance_mode_flags"
                    value={settings.compliance_mode_flags}
                    onChange={handleChange}
                    placeholder="[]">
                  </Textarea>
                </div>
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSaving}
              className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm rounded-full px-5"
            >
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
          </form>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
