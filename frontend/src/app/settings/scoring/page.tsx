"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { Gauge } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";

interface DetectionScoringSettings {
  base_scoring_explanation: string;
  pass_log_base_score: number;
  fail_log_base_score: number;
  inconclusive_base_score: number;
  recent_pass_fail_weight: number;
  false_positive_penalty: number;
  environment_penalty_discount: number;
  health_threshold_healthy: number;
  health_threshold_at_risk: number;
  health_threshold_critical: number;
  scoring_window_n_tests: number;
}

export default function ScoringSettingsPage() {
  const [settings, setSettings] = useState<DetectionScoringSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function fetchSettings() {
      try {
        setLoading(true);
        const data = await apiFetch("/settings/detection-scoring");
        setSettings(data);
      } catch (err: any) {
        setError(err.message || "Failed to load detection scoring settings.");
      } finally {
        setLoading(false);
      }
    }
    fetchSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value, type } = e.target;
    setSettings(prev => (prev ? { ...prev, [id]: type === "number" ? parseInt(value) : value } : null));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setIsSaving(true);
    setError(null);
    try {
      await apiFetch("/settings/detection-scoring", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to save detection scoring settings.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <p className="text-muted-foreground">Loading scoring settings...</p>;
  if (error) return <p className="text-destructive">Error: {error}</p>;
  if (!settings) return <p className="text-muted-foreground">No scoring settings found.</p>;

  return (
    <PageContainer maxWidth="xl" className="space-y-6">
      <PageHeader
        eyebrow="Health model"
        title="Detection Scoring"
        subtitle="Tune scoring weights and thresholds so health reflects your risk tolerance."
        icon={<Gauge className="h-5 w-5" />}
      />
      <Card className="elite-card ">
        <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-white/5 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl font-display font-semibold">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300 border border-violet-400/40">
                <Gauge className="h-4 w-4" />
              </span>
              <span>Detection scoring &amp; health</span>
            </CardTitle>
            <CardDescription className="mt-1 text-xs md:text-sm">
              PurveX distills noisy test history into one score SOCs, analysts, detection engineers, and CISOs trust.
            </CardDescription>
          </div>
          <p className="hidden text-[11px] text-slate-400 md:block">
            Adjust weights and thresholds so dashboards and reports reflect your risk tolerance.
          </p>
        </CardHeader>
        <CardContent className="pt-4 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Base model
            </p>
            <div className="space-y-2">
              <Label htmlFor="base_scoring_explanation">Base scoring model explanation (read-only)</Label>
              <Textarea
                id="base_scoring_explanation"
                value={settings.base_scoring_explanation}
                readOnly
                className="bg-muted/30"
              />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Base scores
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pass_log_base_score">PASS with logs (base)</Label>
                <Input id="pass_log_base_score" type="number" value={settings.pass_log_base_score} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fail_log_base_score">FAIL with logs (base)</Label>
                <Input id="fail_log_base_score" type="number" value={settings.fail_log_base_score} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inconclusive_base_score">INCONCLUSIVE (base)</Label>
                <Input id="inconclusive_base_score" type="number" value={settings.inconclusive_base_score} onChange={handleChange} />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Weights
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="recent_pass_fail_weight">Recent pass/fail (+/- score)</Label>
                <Input id="recent_pass_fail_weight" type="number" value={settings.recent_pass_fail_weight} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="false_positive_penalty">False positive penalty (down to)</Label>
                <Input id="false_positive_penalty" type="number" value={settings.false_positive_penalty} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="environment_penalty_discount">Environment penalty/discount</Label>
                <Input id="environment_penalty_discount" type="number" value={settings.environment_penalty_discount} onChange={handleChange} />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Health thresholds
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="health_threshold_healthy">Healthy (score &gt;=)</Label>
                <Input id="health_threshold_healthy" type="number" value={settings.health_threshold_healthy} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="health_threshold_at_risk">At risk (middle band)</Label>
                <Input id="health_threshold_at_risk" type="number" value={settings.health_threshold_at_risk} onChange={handleChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="health_threshold_critical">Critical (score &lt;)</Label>
                <Input id="health_threshold_critical" type="number" value={settings.health_threshold_critical} onChange={handleChange} />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
              Scoring window
            </p>
            <div className="space-y-2 md:max-w-xs">
              <Label htmlFor="scoring_window_n_tests">Consider last N tests</Label>
              <Input id="scoring_window_n_tests" type="number" value={settings.scoring_window_n_tests} onChange={handleChange} />
            </div>
          </div>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save scoring settings"}
          </Button>
        </form>
      </CardContent>
    </Card>
    </PageContainer>
  );
}
