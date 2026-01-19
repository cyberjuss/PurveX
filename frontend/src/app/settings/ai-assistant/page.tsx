"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { Sparkles } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";

interface AIAssistantSettings {
  ai_provider: string;
  generate_tuning_suggestions: boolean;
  explain_test_failures: boolean;
  automatically_modify_rules: boolean;
  strip_ips_hostnames: boolean;
  no_raw_logs_outside_env: boolean;
  audience_preference: string;
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
      } catch (err: any) {
        setError(err.message || "Failed to load AI assistant settings.");
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

  const handleCheckboxChange = (id: keyof AIAssistantSettings, checked: boolean) => {
    setSettings(prev => (prev ? { ...prev, [id]: checked } : null));
  };

  const handleSelectChange = (id: keyof AIAssistantSettings, value: string) => {
    setSettings(prev => (prev ? { ...prev, [id]: value } : null));
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
    } catch (err: any) {
      setError(err.message || "Failed to save AI assistant settings.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading AI assistant settings…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-destructive">
        Error loading AI assistant settings: {error}
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="text-sm text-muted-foreground">
        No AI assistant settings found.
      </div>
    );
  }

  return (
    <PageContainer maxWidth="lg" className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl font-display font-semibold">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Sparkles className="h-4 w-4" />
              </span>
              <span>AI assistant</span>
            </CardTitle>
            <CardDescription className="mt-1 text-xs md:text-sm text-slate-600">
              Shape how PurveX AI explains failures, recommends tuning, and respects your data boundaries.
            </CardDescription>
          </div>
          <p className="hidden text-[11px] text-slate-500 md:block">
            Tune AI for analysts, leaders, or CISOs while keeping sensitive telemetry under control.
          </p>
        </CardHeader>
        <CardContent className="pt-4 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Provider
            </p>
            <div className="space-y-2 md:max-w-xs">
              <Label htmlFor="ai_provider">AI provider</Label>
              <Select onValueChange={(value: string) => handleSelectChange("ai_provider", value)} value={settings.ai_provider}>
                <SelectTrigger>
                  <SelectValue placeholder="Select AI provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Local LLaMA">Local LLaMA (Ollama)</SelectItem>
                  <SelectItem value="OpenAI">OpenAI (coming soon)</SelectItem>
                  <SelectItem value="Other">Other (coming soon)</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                <Label htmlFor="explain_test_failures">Explain test failures in plain language</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="automatically_modify_rules"
                  checked={settings.automatically_modify_rules}
                  onCheckedChange={(checked: boolean) => handleCheckboxChange("automatically_modify_rules", checked)}
                  disabled // Coming soon
                />
                <Label htmlFor="automatically_modify_rules">Automatically modify rules (coming soon)</Label>
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
            className="bg-[#7561f6] text-white hover:bg-[#6a53f0] border border-transparent shadow-sm"
          >
            {isSaving ? "Saving…" : "Save AI settings"}
          </Button>
        </form>
      </CardContent>
      </Card>
    </PageContainer>
  );
}
