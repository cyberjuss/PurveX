"use client";

import { useState, useEffect } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function parseListSetting(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function serializeListSetting(value: string) {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return JSON.stringify(items);
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
      } catch (error: unknown) {
        setError(getErrorMessage(error, "Failed to load organization settings."));
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setSettings(prev => {
      if (!prev) return null;
      if (id === "default_environment_names" || id === "compliance_mode_flags") {
        return { ...prev, [id]: serializeListSetting(value) };
      }
      return { ...prev, [id]: value };
    });
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
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to save organization settings."));
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <PageContainer maxWidth="lg" className="space-y-6">
        <PageHeader
          eyebrow="Organization"
          title="Organization"
          subtitle="Configure the organization identity and workspace defaults that shape reports, schedules, and environments."
          icon={<Building2 className="h-5 w-5" />}
        />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">Loading organization settings...</CardContent>
        </Card>
      </PageContainer>
    );
  }
  if (error) {
    return (
      <PageContainer maxWidth="lg" className="space-y-6">
        <PageHeader
          eyebrow="Organization"
          title="Organization"
          subtitle="Configure the organization identity and workspace defaults that shape reports, schedules, and environments."
          icon={<Building2 className="h-5 w-5" />}
        />
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">Error loading organization settings: {error}</CardContent>
        </Card>
      </PageContainer>
    );
  }
  if (!settings) {
    return (
      <PageContainer maxWidth="lg" className="space-y-6">
        <PageHeader
          eyebrow="Organization"
          title="Organization"
          subtitle="Configure the organization identity and workspace defaults that shape reports, schedules, and environments."
          icon={<Building2 className="h-5 w-5" />}
        />
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">No organization settings found.</CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg" className="space-y-6">
      <PageHeader
        eyebrow="Organization"
        title="Organization"
        subtitle="Configure the organization identity and workspace defaults that shape reports, schedules, and environments."
        icon={<Building2 className="h-5 w-5" />}
      />
      <Card>
        <CardContent className="pt-6 space-y-6">
          {!hasPermission(Permission.SETTINGS_ORG_MANAGE) ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              You don&apos;t have permission to modify organization settings. Only administrators can update these settings.
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
                  <Label htmlFor="default_environment_names">Default environments</Label>
                  <Input
                    id="default_environment_names"
                    value={parseListSetting(settings.default_environment_names).join(", ")}
                    onChange={handleChange}
                    placeholder="lab, dev, prod"
                  />
                  <p className="text-xs text-slate-500">Use a comma-separated list. PurveX stores this as a workspace default.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="compliance_mode_flags">Compliance modes</Label>
                  <Input
                    id="compliance_mode_flags"
                    value={parseListSetting(settings.compliance_mode_flags).join(", ")}
                    onChange={handleChange}
                    placeholder="pci, hipaa"
                  />
                  <p className="text-xs text-slate-500">Use a comma-separated list for the compliance labels your team reports against.</p>
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
