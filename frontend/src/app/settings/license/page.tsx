"use client";

import { useRef, useState, useEffect } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getLicenseStatus, updateLicenseKey, clearLicenseKey, type LicenseStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
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
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setLoadedFileName(null);
      setSaveSuccess(true);
    } catch (err: unknown) {
      setSaveError(getErrorMessage(err, "That license key could not be saved."));
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

  // A JWT is three base64url segments joined by dots -- the license file
  // from /my-license is a formatted document (who it's issued to, plan,
  // dates) with the key embedded in it, not a bare token, so pull the key
  // out from wherever it sits rather than trusting the whole file. The
  // length floor keeps this from matching something shorter that happens
  // to contain two dots.
  const LICENSE_KEY_PATTERN = /[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

  // Reads a dropped/picked license file and loads the key it contains into
  // the same keyInput the textarea uses -- the backend only ever sees a
  // string, so a file is just a friendlier way of getting that string in.
  const loadFile = (file: File) => {
    setSaveError(null);
    setSaveSuccess(false);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result.trim() : "";
      if (!text) {
        setSaveError("That file appears to be empty.");
        return;
      }
      const match = text.match(LICENSE_KEY_PATTERN);
      if (!match) {
        setSaveError("Couldn't find a license key in that file -- try pasting it instead.");
        return;
      }
      setKeyInput(match[0]);
      setLoadedFileName(file.name);
    };
    reader.onerror = () => setSaveError("Couldn't read that file -- try pasting the key instead.");
    reader.readAsText(file);
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
        <SettingsBanner tone="danger" title="Could not load license status">
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
      description="Upload the license file from your account page to unlock paid-tier limits — takes effect immediately, no restart needed."
      status={
        <SettingsStatusPill tone={status.plan === "paid" ? "ok" : "muted"}>
          {status.plan === "paid" ? "Paid plan" : "Free plan"}
        </SettingsStatusPill>
      }
      banner={
        !canEdit ? (
          <SettingsBanner tone="warning" title="Read-only">
            You do not have permission to change the license key. Ask an administrator.
          </SettingsBanner>
        ) : status.source === "env" ? (
          <SettingsBanner tone="info" title="Set via environment variable">
            This instance&apos;s license currently comes from the <code>PURVEX_LICENSE_KEY</code>{" "}
            environment variable. Saving a key here will take priority over it, and will not require
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
        description="Download the .lic file from your account page at purvex-llc.com/my-license and upload it here."
      >
        <fieldset disabled={!canEdit} className="space-y-3 disabled:opacity-60">
          <div className="space-y-1.5">
            <Label htmlFor="license_file">License file</Label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (canEdit) setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file && canEdit) loadFile(file);
              }}
              onClick={() => canEdit && fileInputRef.current?.click()}
              className={cn(
                "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-7 text-center transition",
                canEdit ? "cursor-pointer" : "cursor-not-allowed",
                isDragOver
                  ? "border-[var(--accent-strong)] bg-[var(--accent-soft)]"
                  : "border-[var(--stroke-soft)] hover:border-[var(--stroke-strong)]"
              )}
            >
              <Upload className="h-5 w-5 text-[var(--surface-subtle-foreground)]" />
              <p className="text-sm font-medium text-[var(--surface-card-foreground)]">
                {loadedFileName ? `Loaded ${loadedFileName}` : "Drop your license file here, or click to browse"}
              </p>
              <p className="text-xs text-[var(--surface-subtle-foreground)]">purvex-license.lic</p>
              <input
                ref={fileInputRef}
                id="license_file"
                type="file"
                accept=".lic,.txt,text/plain"
                disabled={!canEdit}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) loadFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer select-none text-[var(--surface-subtle-foreground)] hover:text-[var(--surface-card-foreground)]">
              Paste the key instead
            </summary>
            <div className="mt-2 space-y-1.5">
              <Label htmlFor="license_key">License key</Label>
              <Textarea
                id="license_key"
                value={keyInput}
                onChange={(e) => {
                  setKeyInput(e.target.value);
                  setLoadedFileName(null);
                  setSaveError(null);
                  setSaveSuccess(false);
                }}
                placeholder="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9..."
                rows={4}
                className="font-mono text-xs"
              />
            </div>
          </details>

          {saveError ? (
            <SettingsBanner tone="danger" title="Could not save">
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
