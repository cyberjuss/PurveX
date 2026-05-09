"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsBanner,
  SettingsSaveBar,
  SettingsStatusPill,
} from "@/components/settings/settings-section";

interface OrganizationSettings {
  name: string;
  primary_contact_email?: string;
  timezone: string;
  locale: string;
  default_environment_names: string;
  compliance_mode_flags: string;
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
  const canEdit = hasPermission(Permission.SETTINGS_ORG_MANAGE);
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [pristine, setPristine] = useState<OrganizationSettings | null>(null);
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
        setPristine(data);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to load organization settings."));
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const dirty = !!settings && !!pristine && JSON.stringify(settings) !== JSON.stringify(pristine);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setSettings((prev) => {
      if (!prev) return null;
      if (id === "default_environment_names" || id === "compliance_mode_flags") {
        return { ...prev, [id]: serializeListSetting(value) };
      }
      return { ...prev, [id]: value };
    });
  };

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    setError(null);
    try {
      await apiFetch("/settings/organization", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setPristine(settings);
      router.refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save organization settings."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => setSettings(pristine);

  if (loading) {
    return (
      <SettingsPageShell eyebrow="Workspace" title="Organization">
        <div className="space-y-6 py-8">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </SettingsPageShell>
    );
  }

  if (error && !settings) {
    return (
      <SettingsPageShell eyebrow="Workspace" title="Organization">
        <SettingsBanner tone="danger" title="Couldn't load settings">
          {error}
        </SettingsBanner>
      </SettingsPageShell>
    );
  }

  if (!settings) return null;

  const envCount = parseListSetting(settings.default_environment_names).length;

  return (
    <>
      <SettingsPageShell
        eyebrow="Workspace"
        title="Organization"
        description="The workspace identity, locale, and defaults that propagate into reports, schedules, and environments."
        status={
          <SettingsStatusPill tone={settings.name ? "ok" : "muted"}>
            {settings.name || "Unnamed"}
          </SettingsStatusPill>
        }
        banner={
          !canEdit ? (
            <SettingsBanner tone="warning" title="Read-only">
              You don't have permission to modify organization settings. Ask an
              administrator to make changes.
            </SettingsBanner>
          ) : error ? (
            <SettingsBanner tone="danger" title="Save failed">
              {error}
            </SettingsBanner>
          ) : undefined
        }
      >
        <SettingsSection
          title="Identity"
          description="Shown on reports, audit exports, and the workspace header."
        >
          <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-60">
            <div className="space-y-1.5">
              <Label htmlFor="name">Organization name</Label>
              <Input id="name" value={settings.name} onChange={handleChange} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="primary_contact_email">Primary contact email</Label>
              <Input
                id="primary_contact_email"
                type="email"
                value={settings.primary_contact_email || ""}
                onChange={handleChange}
                placeholder="security-lead@yourcompany.com"
              />
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                Used as the default recipient for breaking-glass alerts.
              </p>
            </div>
          </fieldset>
        </SettingsSection>

        <SettingsSection
          title="Locale & time"
          description="Anchors timestamps, scheduled runs, and compliance windows."
        >
          <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2 disabled:opacity-60">
            <div className="space-y-1.5">
              <Label htmlFor="timezone">Time zone</Label>
              <Input
                id="timezone"
                value={settings.timezone}
                onChange={handleChange}
                placeholder="UTC"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="locale">Locale</Label>
              <Input
                id="locale"
                value={settings.locale}
                onChange={handleChange}
                placeholder="en_US"
                required
              />
            </div>
          </fieldset>
        </SettingsSection>

        <SettingsSection
          title="Defaults"
          description="Comma-separated lists used to seed new detections and reports."
        >
          <fieldset disabled={!canEdit} className="space-y-4 disabled:opacity-60">
            <div className="space-y-1.5">
              <Label htmlFor="default_environment_names">Default environments</Label>
              <Input
                id="default_environment_names"
                value={parseListSetting(settings.default_environment_names).join(", ")}
                onChange={handleChange}
                placeholder="lab, dev, prod"
              />
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                {envCount > 0 ? `${envCount} environment${envCount === 1 ? "" : "s"} listed.` : "No environments listed yet."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="compliance_mode_flags">Compliance modes</Label>
              <Input
                id="compliance_mode_flags"
                value={parseListSetting(settings.compliance_mode_flags).join(", ")}
                onChange={handleChange}
                placeholder="pci, hipaa"
              />
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                Surfaces matching banners on reports your team owns.
              </p>
            </div>
          </fieldset>
        </SettingsSection>
      </SettingsPageShell>

      {canEdit ? (
        <SettingsSaveBar
          saving={isSaving}
          dirty={dirty}
          onSave={handleSave}
          onReset={handleReset}
        />
      ) : null}
    </>
  );
}
