"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonCard } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { Sparkles } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

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
      } catch (error: unknown) {
        setError(getErrorMessage(error, "Failed to load AI assistant settings."));
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  // Normalize provider defaults on initial load so DeepSeek doesn't point at OpenAI.
  useEffect(() => {
    if (!settings) return;
    const providerLower = (settings.provider || "").toLowerCase();
    if (providerLower === "deepseek") {
      const baseUrl = (settings.api_base_url || "").trim();
      const model = (settings.model_name || "").trim();
      const nextBaseUrl = !baseUrl || baseUrl === "https://api.openai.com/v1" ? "https://api.deepseek.com/v1" : baseUrl;
      const nextModel = !model || model.startsWith("gpt-") ? "deepseek-chat" : model;
      if (nextBaseUrl !== settings.api_base_url || nextModel !== settings.model_name) {
        setSettings((prev) => (prev ? { ...prev, api_base_url: nextBaseUrl, model_name: nextModel } : prev));
      }
      return;
    }
    if (providerLower === "openai") {
      const baseUrl = (settings.api_base_url || "").trim();
      const model = (settings.model_name || "").trim();
      const nextBaseUrl = !baseUrl || baseUrl === "https://api.deepseek.com/v1" ? "https://api.openai.com/v1" : baseUrl;
      const nextModel = !model || model.startsWith("deepseek-") ? "gpt-4o-mini" : model;
      if (nextBaseUrl !== settings.api_base_url || nextModel !== settings.model_name) {
        setSettings((prev) => (prev ? { ...prev, api_base_url: nextBaseUrl, model_name: nextModel } : prev));
      }
    }
  }, [settings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    const { id, value, type } = target;
    const checked = type === "checkbox" ? target.checked : undefined;
    setSettings(prev => (prev ? { ...prev, [id]: type === "checkbox" ? checked : value } : null));
  };

  const handleCheckboxChange = (id: keyof AIAssistantSettings, checked: boolean) => {
    setSettings(prev => (prev ? { ...prev, [id]: checked } : null));
  };

  const handleSelectChange = (id: keyof AIAssistantSettings, value: string) => {
    setSettings((prev) => {
      if (!prev) return null;
      if (id !== "provider") {
        return { ...prev, [id]: value };
      }

      const nextProvider = value;
      const next: AIAssistantSettings = { ...prev, provider: nextProvider };

      const providerLower = nextProvider.toLowerCase();
      if (providerLower === "deepseek") {
        const baseUrl = (next.api_base_url || "").trim();
        const model = (next.model_name || "").trim();

        if (!baseUrl || baseUrl === "https://api.openai.com/v1") {
          next.api_base_url = "https://api.deepseek.com/v1";
        }
        if (!model || model.startsWith("gpt-")) {
          next.model_name = "deepseek-chat";
        }
      } else if (providerLower === "openai") {
        const baseUrl = (next.api_base_url || "").trim();
        const model = (next.model_name || "").trim();

        if (!baseUrl || baseUrl === "https://api.deepseek.com/v1") {
          next.api_base_url = "https://api.openai.com/v1";
        }
        if (!model || model.startsWith("deepseek-")) {
          next.model_name = "gpt-4o-mini";
        }
      }

      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setIsSaving(true);
    setError(null);
    try {
      await apiFetch("/settings/ai-assistant-settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      router.refresh();
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to save AI assistant settings."));
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <PageContainer maxWidth="lg" className="space-y-6">
        <PageHeader
          eyebrow="AI governance"
          title="AI Assistant"
          subtitle="Configure what the assistant can analyze, how it responds, and what data limits apply inside PurveX."
          icon={<Sparkles className="h-5 w-5" />}
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
      <PageContainer maxWidth="lg" className="space-y-6">
        <PageHeader
          eyebrow="AI governance"
          title="AI Assistant"
          subtitle="Configure what the assistant can analyze, how it responds, and what data limits apply inside PurveX."
          icon={<Sparkles className="h-5 w-5" />}
        />
        <Card><CardContent className="pt-6 text-sm text-destructive">Error loading AI assistant settings: {error}</CardContent></Card>
      </PageContainer>
    );
  }
  if (!settings) {
    return (
      <PageContainer maxWidth="lg" className="space-y-6">
        <PageHeader
          eyebrow="AI governance"
          title="AI Assistant"
          subtitle="Configure what the assistant can analyze, how it responds, and what data limits apply inside PurveX."
          icon={<Sparkles className="h-5 w-5" />}
        />
        <Card><CardContent className="pt-6 text-sm text-muted-foreground">No AI assistant settings found.</CardContent></Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="lg" className="space-y-6">
        <PageHeader
        eyebrow="AI governance"
        title="AI Assistant"
        subtitle="Configure what the assistant can analyze, how it responds, and what data limits apply inside PurveX."
        icon={<Sparkles className="h-5 w-5" />}
      />
      <Card>
        <CardContent className="pt-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Provider
            </p>
            <div className="space-y-2 md:max-w-xs">
              <Label htmlFor="provider">AI provider</Label>
              <Select onValueChange={(value: string) => handleSelectChange("provider", value)} value={settings.provider}>
                <SelectTrigger>
                  <SelectValue placeholder="Select AI provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OpenAI">OpenAI</SelectItem>
                  <SelectItem value="DeepSeek">DeepSeek</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-slate-500 md:max-w-xl">
              The server reads provider keys from <code>OPENAI_API_KEY</code>. For DeepSeek, set base URL to <code>https://api.deepseek.com/v1</code> and model to <code>deepseek-chat</code> or <code>deepseek-reasoner</code>.
            </p>
            <div className="space-y-2 md:max-w-xs">
              <Label htmlFor="analysis_mode">Analysis mode</Label>
              <Select
                onValueChange={(value: string) => handleSelectChange("analysis_mode", value)}
                value={settings.analysis_mode}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select analysis mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">Fast (3 events, ~10s)</SelectItem>
                  <SelectItem value="balanced">Balanced (6 events, ~15s)</SelectItem>
                  <SelectItem value="deep">Deep (10 events, ~25s)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <details className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:max-w-xl">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">Advanced provider settings</summary>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="api_base_url">API base URL</Label>
                  <Input
                    id="api_base_url"
                    value={settings.api_base_url}
                    onChange={handleChange}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="model_name">Model name</Label>
                  <Input
                    id="model_name"
                    value={settings.model_name}
                    onChange={handleChange}
                    placeholder="deepseek-chat"
                  />
                </div>
              </div>
            </details>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              AI capabilities
            </p>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="generate_tuning_suggestions"
                  checked={settings.generate_tuning_suggestions}
                  onCheckedChange={(checked: boolean) => handleCheckboxChange("generate_tuning_suggestions", checked)}
                />
                <Label htmlFor="generate_tuning_suggestions">Generate detection tuning suggestions</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="explain_test_failures"
                  checked={settings.explain_test_failures}
                  onCheckedChange={(checked: boolean) => handleCheckboxChange("explain_test_failures", checked)}
                />
                <Label htmlFor="explain_test_failures">Explain validation failures in plain language</Label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Data sharing limits
            </p>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="strip_ips_hostnames"
                  checked={settings.strip_ips_hostnames}
                  onCheckedChange={(checked: boolean) => handleCheckboxChange("strip_ips_hostnames", checked)}
                />
                <Label htmlFor="strip_ips_hostnames">Strip IPs/hostnames before sending logs to AI</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="no_raw_logs_outside_env"
                  checked={settings.no_raw_logs_outside_env}
                  onCheckedChange={(checked: boolean) => handleCheckboxChange("no_raw_logs_outside_env", checked)}
                  disabled // Applies to cloud models
                />
                <Label htmlFor="no_raw_logs_outside_env">Do not send raw log lines outside environment (cloud models)</Label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Tone &amp; audience
            </p>
            <div className="space-y-2 md:max-w-xs">
              <Label htmlFor="audience_preference">Audience preference</Label>
              <Select onValueChange={(value: string) => handleSelectChange("audience_preference", value)} value={settings.audience_preference}>
                <SelectTrigger>
                  <SelectValue placeholder="Select audience" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Analyst">Analyst</SelectItem>
                  <SelectItem value="SOC Manager">SOC Manager</SelectItem>
                  <SelectItem value="CISO">CISO</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save AI settings"}
          </Button>
        </form>
      </CardContent>
      </Card>
    </PageContainer>
  );
}
