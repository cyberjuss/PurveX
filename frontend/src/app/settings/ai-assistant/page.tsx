"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsRow,
  SettingsBanner,
  SettingsSaveBar,
  SettingsStatusPill,
} from "@/components/settings/settings-section";

interface AIAssistantSettings {
  provider: string;
  model_name: string;
  api_base_url: string;
  analysis_mode: string;
  generate_tuning_suggestions: boolean;
  explain_test_failures: boolean;
  automatically_modify_rules: boolean;
  strip_ips_hostnames: boolean;
  no_raw_logs_outside_env: boolean;
  audience_preference: string;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function AIAssistantSettingsPage() {
  const [settings, setSettings] = useState<AIAssistantSettings | null>(null);
  const [pristine, setPristine] = useState<AIAssistantSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function fetchSettings() {
      try {
        setLoading(true);
        const data = await apiFetch("/settings/ai-assistant-settings");
        setSettings(data);
        setPristine(data);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to load Watchtower settings."));
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  // Normalise provider defaults so DeepSeek doesn't point at the OpenAI URL.
  useEffect(() => {
    if (!settings) return;
    const providerLower = (settings.provider || "").toLowerCase();
    const baseUrl = (settings.api_base_url || "").trim();
    const model = (settings.model_name || "").trim();
    if (providerLower === "deepseek") {
      const nextBaseUrl = !baseUrl || baseUrl === "https://api.openai.com/v1" ? "https://api.deepseek.com/v1" : baseUrl;
      const nextModel = !model || model.startsWith("gpt-") ? "deepseek-chat" : model;
      if (nextBaseUrl !== settings.api_base_url || nextModel !== settings.model_name) {
        setSettings((prev) => (prev ? { ...prev, api_base_url: nextBaseUrl, model_name: nextModel } : prev));
      }
    } else if (providerLower === "openai") {
      const nextBaseUrl = !baseUrl || baseUrl === "https://api.deepseek.com/v1" ? "https://api.openai.com/v1" : baseUrl;
      const nextModel = !model || model.startsWith("deepseek-") ? "gpt-4o-mini" : model;
      if (nextBaseUrl !== settings.api_base_url || nextModel !== settings.model_name) {
        setSettings((prev) => (prev ? { ...prev, api_base_url: nextBaseUrl, model_name: nextModel } : prev));
      }
    }
  }, [settings]);

  const dirty = !!settings && !!pristine && JSON.stringify(settings) !== JSON.stringify(pristine);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setSettings((prev) => (prev ? { ...prev, [id]: value } : null));
  };

  const handleSwitch = (id: keyof AIAssistantSettings, checked: boolean) => {
    setSettings((prev) => (prev ? { ...prev, [id]: checked } : null));
  };

  const handleSelect = (id: keyof AIAssistantSettings, value: string) => {
    setSettings((prev) => (prev ? { ...prev, [id]: value } : null));
  };

  const handleSave = async () => {
    if (!settings) return;
    setIsSaving(true);
    setError(null);
    try {
      await apiFetch("/settings/ai-assistant-settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setPristine(settings);
      router.refresh();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save Watchtower settings."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => setSettings(pristine);

  if (loading) {
    return (
      <SettingsPageShell eyebrow="AI governance" title="Watchtower">
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
      <SettingsPageShell eyebrow="AI governance" title="Watchtower">
        <SettingsBanner tone="danger" title="Couldn't load settings">
          {error}
        </SettingsBanner>
      </SettingsPageShell>
    );
  }

  if (!settings) return null;

  return (
    <>
      <SettingsPageShell
        eyebrow="AI governance"
        title="Watchtower"
        description="What Watchtower can analyze, how it responds, and what data may leave the environment."
        status={
          <SettingsStatusPill tone={settings.provider ? "ok" : "muted"}>
            {settings.provider || "Unconfigured"}
          </SettingsStatusPill>
        }
        banner={
          error ? (
            <SettingsBanner tone="danger" title="Save failed">
              {error}
            </SettingsBanner>
          ) : undefined
        }
      >
        <SettingsSection
          title="Provider"
          description="Which LLM endpoint Watchtower calls and how aggressively it analyses each run."
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="provider">Provider</Label>
              <Select
                onValueChange={(value: string) => handleSelect("provider", value)}
                value={settings.provider}
              >
                <SelectTrigger className="max-w-sm">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OpenAI">OpenAI</SelectItem>
                  <SelectItem value="DeepSeek">DeepSeek</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                The server reads provider keys from <code>OPENAI_API_KEY</code>. DeepSeek uses
                <code> https://api.deepseek.com/v1</code> with <code>deepseek-chat</code>.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="analysis_mode">Analysis depth</Label>
              <Select
                onValueChange={(value: string) => handleSelect("analysis_mode", value)}
                value={settings.analysis_mode}
              >
                <SelectTrigger className="max-w-sm">
                  <SelectValue placeholder="Select depth" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">Fast — 3 events, ~10s</SelectItem>
                  <SelectItem value="balanced">Balanced — 6 events, ~15s</SelectItem>
                  <SelectItem value="deep">Deep — 10 events, ~25s</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <details className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                Advanced provider settings
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="api_base_url">API base URL</Label>
                  <Input
                    id="api_base_url"
                    value={settings.api_base_url}
                    onChange={handleChange}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="model_name">Model</Label>
                  <Input
                    id="model_name"
                    value={settings.model_name}
                    onChange={handleChange}
                    placeholder="gpt-4o-mini"
                  />
                </div>
              </div>
            </details>
          </div>
        </SettingsSection>

        <SettingsSection
          title="Capabilities"
          description="Toggle what Watchtower is allowed to do automatically."
        >
          <div className="space-y-1">
            <SettingsRow
              label="Generate detection tuning suggestions"
              description="Watchtower proposes targeted edits when a detection fails."
              control={
                <Switch
                  checked={settings.generate_tuning_suggestions}
                  onCheckedChange={(checked: boolean) =>
                    handleSwitch("generate_tuning_suggestions", checked)
                  }
                />
              }
            />
            <SettingsRow
              label="Explain validation failures"
              description="Plain-language summary appears next to each FAIL/Blind Spot."
              control={
                <Switch
                  checked={settings.explain_test_failures}
                  onCheckedChange={(checked: boolean) =>
                    handleSwitch("explain_test_failures", checked)
                  }
                />
              }
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Data sharing"
          description="What can be sent to the LLM endpoint with each request."
        >
          <div className="space-y-1">
            <SettingsRow
              label="Strip IPs and hostnames"
              description="Removes private addresses and host names before any prompt is sent."
              control={
                <Switch
                  checked={settings.strip_ips_hostnames}
                  onCheckedChange={(checked: boolean) =>
                    handleSwitch("strip_ips_hostnames", checked)
                  }
                />
              }
            />
            <SettingsRow
              label="Never send raw logs to cloud models"
              description="Disabled in this build — applies once self-hosted models are wired in."
              control={
                <Switch
                  checked={settings.no_raw_logs_outside_env}
                  onCheckedChange={(checked: boolean) =>
                    handleSwitch("no_raw_logs_outside_env", checked)
                  }
                  disabled
                />
              }
            />
          </div>
        </SettingsSection>

        <SettingsSection
          title="Audience"
          description="Who Watchtower is writing for; influences tone and depth."
        >
          <div className="space-y-1.5">
            <Label htmlFor="audience_preference">Default audience</Label>
            <Select
              onValueChange={(value: string) => handleSelect("audience_preference", value)}
              value={settings.audience_preference}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue placeholder="Select audience" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Analyst">Analyst</SelectItem>
                <SelectItem value="SOC Manager">SOC Manager</SelectItem>
                <SelectItem value="CISO">CISO</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </SettingsSection>
      </SettingsPageShell>

      <SettingsSaveBar
        saving={isSaving}
        dirty={dirty}
        onSave={handleSave}
        onReset={handleReset}
        saveLabel="Save Watchtower"
      />
    </>
  );
}
