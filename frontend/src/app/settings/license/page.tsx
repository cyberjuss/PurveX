"use client";

import { useState, useEffect } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLicenseStatus, updateLicenseKey, clearLicenseKey, type LicenseStatus } from "@/lib/api";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsBanner,
  SettingsStatusPill,
} from "@/components/settings/settings-section";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function LimitRow({ label, limit }: { label: string; limit: number | null }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-[var(--surface-subtle-foreground)]">{label}</span>
      <span className="font-medium text-[var(--surface-card-foreground)]">
        {limit === null ? "Unlimited" : limit}
      </span>
    </div>
  );
}

export default function LicenseSettingsPage() {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission(Permission.SETTINGS_ORG_MANAGE);

  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const data = await getLicenseStatus();
        if (!cancelled) setStatus(data);
      } catch (err: unknown) {
        if (!cancelled) setLoadError(getErrorMessage(err, "Failed to load license status."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    const token = keyInput.trim();
    if (!token) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const data = await updateLicenseKey(token);
      setStatus(data);
      setKeyInput("");
      setSaveSuccess(true);
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, "That license key couldn't be saved."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setIsClearing(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const data = await clearLicenseKey();
      setStatus(data);
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, "Failed to remove the saved license key."));
    } finally {
      setIsClearing(false);
    }
  };

  if (loading) {
    return (
      <SettingsPageShell eyebrow="Workspace" title="License">
        <div className="space-y-6 py-8">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SettingsPageShell>
    );
  }

  if (loadError && !status) {
    return (
      <SettingsPageShell eyebrow="Workspace" title="License">
        <SettingsBanner tone="danger" title="Couldn't load license status">
          {loadError}
        </SettingsBanner>
      </SettingsPageShell>
    );
  }

  if (!status) return null;

  return (
    <SettingsPageShell
      eyebrow="Workspace"
      title="License"
      description="Paste the license key you received by email to unlock paid-tier limits — takes effect immediately, no restart needed."
      status={
        <SettingsStatusPill tone={status.plan === "paid" ? "ok" : "muted"}>
          {status.plan === "paid" ? "Paid plan" : "Free plan"}
        </SettingsStatusPill>
      }
      banner={
        !canEdit ? (
          <SettingsBanner tone="warning" title="Read-only">
            You don&apos;t have permission to change the license key. Ask an administrator.
          </SettingsBanner>
        ) : status.source === "env" ? (
          <SettingsBanner tone="info" title="Set via environment variable">
            This instance&apos;s license currently comes from the <code>PURVEX_LICENSE_KEY</code>{" "}
            environment variable. Saving a key here will take priority over it, and won&apos;t require
            a restart.
          </SettingsBanner>
        ) : undefined
      }
    >
      <SettingsSection title="Current plan" description="What this workspace is limited to right now.">
        <div className="divide-y divide-[var(--stroke-soft)]">
          <LimitRow label="Team members" limit={status.seat_limit} />
          <LimitRow label="Test runners" limit={status.runner_limit} />
        </div>
      </SettingsSection>

      <SettingsSection
        title="License key"
        description="Received by email after purchase. It's a long block of text — paste the whole thing."
      >
        <fieldset disabled={!canEdit} className="space-y-3 disabled:opacity-60">
          <div className="space-y-1.5">
            <Label htmlFor="license_key">License key</Label>
            <Textarea
              id="license_key"
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setSaveError(null);
                setSaveSuccess(false);
              }}
              placeholder="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."
              rows={4}
              className="font-mono text-xs"
            />
          </div>

          {saveError ? (
            <SettingsBanner tone="danger" title="Couldn't save">
              {saveError}
            </SettingsBanner>
          ) : null}
          {saveSuccess ? (
            <SettingsBanner tone="success" title="License applied">
              Your plan and limits above are now up to date.
            </SettingsBanner>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={handleSave} disabled={isSaving || !keyInput.trim()}>
              {isSaving ? "Saving…" : "Save license key"}
            </Button>
            {status.has_saved_key ? (
              <Button type="button" variant="ghost" size="sm" onClick={handleClear} disabled={isClearing}>
                {isClearing ? "Removing…" : "Remove saved key"}
              </Button>
            ) : null}
          </div>
        </fieldset>
      </SettingsSection>
    </SettingsPageShell>
  );
}
