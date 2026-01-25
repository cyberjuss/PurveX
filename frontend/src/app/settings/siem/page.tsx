"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Database, PlusCircle, Edit, Trash, TestTube, PlugZap, Server } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { useToast } from "@/components/ui/toast";

interface SIEMConnection {
  id: number;
  siem_type: string;
  name: string;
  url: string;
  auth_type: string;
  credentials?: string; // Stored securely, maybe not directly editable here
  credentials_present?: boolean;
  status?: string;
  last_validated_at?: string;
  default_windows_index?: string;
  default_linux_index?: string;
  default_cloud_index?: string;
  log_marker_pattern: string;
}

interface SIEMEvidenceItem {
  event_time?: string;
  severity?: string;
  host?: string;
  user?: string;
  dest?: string;
  src?: string;
  signature?: string;
  sourcetype?: string;
  index?: string;
}

interface SIEMEvidenceBundle {
  count: number;
  items: SIEMEvidenceItem[];
  deep_link?: string;
}

export default function SiemSettingsPage() {
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const [connections, setConnections] = useState<SIEMConnection[]>([]);
  const [healthById, setHealthById] = useState<Record<number, { status?: string; message?: string }>>({});
  const [lastHealthCheckAt, setLastHealthCheckAt] = useState<Date | null>(null);
  const [lastHealthCheckId, setLastHealthCheckId] = useState<number | null>(null);
  const [lastHealthStatus, setLastHealthStatus] = useState<"connected" | "error" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SIEMConnection | null>(null);
  const [formData, setFormData] = useState<Partial<SIEMConnection>>({
    siem_type: "Splunk",
    name: "",
    url: "",
    auth_type: "Token",
    log_marker_pattern: "purvex_*",
  });
  const [splunkToken, setSplunkToken] = useState("");
  const [splunkWebUrl, setSplunkWebUrl] = useState("");
  const [verifySsl, setVerifySsl] = useState("true");
  const [notableIndex, setNotableIndex] = useState("notable");
  const [alertsMode, setAlertsMode] = useState("alerts_fired");
  const [alertsIndex, setAlertsIndex] = useState("");
  const [hostField, setHostField] = useState("host");
  const [userField, setUserField] = useState("user");
  const [destField, setDestField] = useState("dest");
  const [srcField, setSrcField] = useState("src");
  const [signatureField, setSignatureField] = useState("signature");
  const [esApp, setEsApp] = useState("SplunkEnterpriseSecurity");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchConnections();
    // Cleanup on unmount to prevent memory leaks
    return () => {
      // Cancel any pending requests if component unmounts
    };
  }, []);

  useEffect(() => {
    if (connections.length === 0) {
      setHealthById({});
      return;
    }
    let cancelled = false;
    const fetchHealth = async () => {
      const entries = await Promise.all(
        connections.map(async (conn) => {
          try {
            const health = await apiFetch(`/settings/siem-connections/${conn.id}/health`);
            return [conn.id, { status: health?.status, message: health?.message }] as const;
          } catch (err: any) {
            return [conn.id, { status: "error", message: err.message || "Health check failed" }] as const;
          }
        })
      );
      if (!cancelled) {
        const next: Record<number, { status?: string; message?: string }> = {};
        entries.forEach(([id, value]) => {
          next[id] = value;
        });
        setHealthById(next);
        setLastHealthCheckAt(new Date());
      }
    };
    fetchHealth();
    return () => {
      cancelled = true;
    };
  }, [connections]);

  const fetchConnections = async () => {
    try {
      setLoading(true);
      const data = await apiFetch("/settings/siem-connections");
      setConnections(data);
    } catch (err: any) {
      setError(err.message || "Failed to load SIEM connections.");
    } finally {
      setLoading(false);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (id: keyof SIEMConnection, value: string) => {
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.siem_type || !formData.name || !formData.url || !formData.auth_type) {
      setError("Please fill in all required fields.");
      return;
    }

    const payload: Partial<SIEMConnection> = { ...formData };
    const credentialsPayload = {
      token: splunkToken || undefined,
      web_url: splunkWebUrl || undefined,
      verify_ssl: verifySsl === "true",
      notable_index: notableIndex || "notable",
      alerts_mode: alertsMode,
      alerts_index: alertsIndex || undefined,
      host_field: hostField || "host",
      user_field: userField || "user",
      dest_field: destField || "dest",
      src_field: srcField || "src",
      signature_field: signatureField || "signature",
      es_app: esApp || "SplunkEnterpriseSecurity",
    };
    const hasAnyCredentials = Object.values(credentialsPayload).some(value => value !== undefined);
    if (hasAnyCredentials) {
      payload.credentials = JSON.stringify(credentialsPayload);
    }
    if (!payload.credentials || payload.credentials.trim().length === 0) {
      delete payload.credentials;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (editingConnection) {
        await apiFetch(`/settings/siem-connections/${editingConnection.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/settings/siem-connections", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setFormData({
        siem_type: "Splunk",
        name: "",
        url: "",
        auth_type: "Token",
        log_marker_pattern: "purvex_*",
      });
      setSplunkToken("");
      setSplunkWebUrl("");
      setVerifySsl("true");
      setNotableIndex("notable");
      setAlertsMode("alerts_fired");
      setAlertsIndex("");
      setHostField("host");
      setUserField("user");
      setDestField("dest");
      setSrcField("src");
      setSignatureField("signature");
      setEsApp("SplunkEnterpriseSecurity");
      setShowAddForm(false);
      setEditingConnection(null);
      fetchConnections(); // Re-fetch connections after save
    } catch (err: any) {
      setError(err.message || "Failed to save SIEM connection.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleForm = () => {
    setShowAddForm(prev => !prev);
    setEditingConnection(null);
    setFormData({
      siem_type: "Splunk",
      name: "",
      url: "",
      auth_type: "Token",
      log_marker_pattern: "purvex_*",
    });
    setSplunkToken("");
    setSplunkWebUrl("");
    setVerifySsl("true");
    setNotableIndex("notable");
    setAlertsMode("alerts_fired");
    setAlertsIndex("");
    setHostField("host");
    setUserField("user");
    setDestField("dest");
    setSrcField("src");
    setSignatureField("signature");
    setEsApp("SplunkEnterpriseSecurity");
  };

  const handleEdit = (connection: SIEMConnection) => {
    setEditingConnection(connection);
    setFormData({ ...connection, credentials: "" });
    setSplunkToken("");
    try {
      const parsed = connection.credentials ? JSON.parse(connection.credentials) : {};
      setSplunkWebUrl(parsed.web_url || "");
      setVerifySsl(parsed.verify_ssl === false ? "false" : "true");
      setNotableIndex(parsed.notable_index || "notable");
      setAlertsMode(parsed.alerts_mode || "alerts_fired");
      setAlertsIndex(parsed.alerts_index || "");
      setHostField(parsed.host_field || "host");
      setUserField(parsed.user_field || "user");
      setDestField(parsed.dest_field || "dest");
      setSrcField(parsed.src_field || "src");
      setSignatureField(parsed.signature_field || "signature");
      setEsApp(parsed.es_app || "SplunkEnterpriseSecurity");
    } catch {
      setSplunkWebUrl("");
      setVerifySsl("true");
      setNotableIndex("notable");
      setAlertsMode("alerts_fired");
      setAlertsIndex("");
      setHostField("host");
      setUserField("user");
      setDestField("dest");
      setSrcField("src");
      setSignatureField("signature");
      setEsApp("SplunkEnterpriseSecurity");
    }
    setShowAddForm(true);
  };


  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this SIEM connection?")) return;
    try {
      await apiFetch(`/settings/siem-connections/${id}`, {
        method: "DELETE",
      });
      fetchConnections();
    } catch (err: any) {
      setError(err.message || "Failed to delete SIEM connection.");
    }
  };

  const handleTestConnection = async (id: number) => {
    try {
      const health = await apiFetch(`/settings/siem-connections/${id}/health`);
      if (health?.status === "connected") {
        setLastHealthCheckId(id);
        setLastHealthStatus("connected");
        setLastHealthCheckAt(new Date());
        toast({
          type: "success",
          title: "Splunk connected",
          description: "PurveX can reach Splunk and read alerts.",
        });
      } else {
        setLastHealthCheckId(id);
        setLastHealthStatus("error");
        setLastHealthCheckAt(new Date());
        toast({
          type: "error",
          title: "Connection failed",
          description: health?.message || "Unable to connect to Splunk.",
        });
      }
      fetchConnections();
    } catch (err: any) {
      setLastHealthCheckId(id);
      setLastHealthStatus("error");
      setLastHealthCheckAt(new Date());
      toast({
        type: "error",
        title: "Connection failed",
        description: err.message || "Unable to connect to Splunk.",
      });
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading SIEM connections…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-destructive">
        Error loading SIEM settings: {error}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,116,144,0.12),_transparent_45%),radial-gradient(circle_at_80%_10%,_rgba(2,132,199,0.14),_transparent_35%),radial-gradient(circle_at_20%_20%,_rgba(148,163,184,0.18),_transparent_40%)]" />
      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-10 sm:px-6 lg:px-8 space-y-10">
        <section className="rounded-[28px] border border-slate-200/80 bg-white/80 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.6)] backdrop-blur">
          <div className="grid gap-8 px-6 py-8 md:grid-cols-[1.3fr_0.7fr] md:px-8">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-900/20">
                  <Database className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Secure SIEM Access</p>
                  <h1 className="text-3xl font-display font-semibold text-slate-900 md:text-4xl">Splunk Connection</h1>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-slate-600 md:text-base">
                Connect Splunk to validate detections without copying raw logs. PurveX only verifies alerts and pulls small evidence bundles on demand.
              </p>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                  Zero raw log ingestion
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">
                  Read-only token
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
                  Evidence on-demand
                </span>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
              <p className="text-[11px] uppercase tracking-[0.32em] text-slate-500">Health signal</p>
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {lastHealthCheckAt
                    ? `Last checked ${lastHealthCheckAt.toLocaleTimeString()}`
                    : "Run Test connection for a live health signal."}
                </div>
                {lastHealthCheckAt && lastHealthCheckId && lastHealthStatus && (
                  <div
                    className={`rounded-xl border px-4 py-3 text-xs ${
                      lastHealthStatus === "connected"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    }`}
                  >
                    {lastHealthStatus === "connected"
                      ? "Connection verified. PurveX can read Splunk alerts for this workspace."
                      : "Connection failed. Check token, URL, and network access."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-slate-200/80 bg-white shadow-[0_18px_48px_-36px_rgba(15,23,42,0.55)] px-6 py-6 md:px-8">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Configured SIEM connections</h2>
              <p className="text-sm text-slate-600">
                One Splunk connection per workspace. Used for alert lookups and evidence bundles.
              </p>
            </div>
            {hasPermission(Permission.SETTINGS_SIEM_MANAGE) && connections.length > 0 && (
              <Button
                onClick={handleToggleForm}
                className="mt-4 w-fit px-6"
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                {showAddForm ? "Cancel" : "Add SIEM connection"}
              </Button>
            )}
          </div>

          <div
            className={`transition-all duration-300 ease-out overflow-hidden ${
              showAddForm ? "max-h-[1400px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
            }`}
          >
            <Card className={`bg-white/95 border border-slate-200 shadow-[0_20px_48px_-32px_rgba(15,23,42,0.55)] rounded-2xl ${showAddForm ? "animate-in fade-in slide-in-from-top-2 duration-300" : ""}`}>
            <CardHeader className="hidden">
                <CardTitle className="sr-only">
                  {editingConnection ? "Edit SIEM connection" : "Add SIEM connection"}
                </CardTitle>
                <CardDescription className="sr-only">
                  One entry per SIEM workspace or cluster. Use names your SOC will recognize.
                </CardDescription>
            </CardHeader>
            <CardContent className="pt-5 space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-xs text-emerald-700">
                Read-only access only. PurveX does not ingest raw logs or customer data.
              </div>
              <form onSubmit={handleFormSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="name">Connection name</Label>
                        <Input
                          id="name"
                          value={formData.name || ""}
                          onChange={handleFormChange}
                          required
                          className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="siem_type">SIEM type</Label>
                        <Select onValueChange={(value: string) => handleSelectChange("siem_type", value)} value={formData.siem_type}>
                          <SelectTrigger className="bg-white text-slate-900 border-slate-200">
                            <SelectValue placeholder="Select SIEM type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Splunk">Splunk</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="url">Splunk Management URL (8089)</Label>
                        <Input
                          id="url"
                          value={formData.url || ""}
                          onChange={handleFormChange}
                          required
                          className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="auth_type">Authentication type</Label>
                        <Select onValueChange={(value: string) => handleSelectChange("auth_type", value)} value={formData.auth_type}>
                          <SelectTrigger className="bg-white text-slate-900 border-slate-200">
                            <SelectValue placeholder="Select auth type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Token">Token</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="credentials">Splunk token (stored securely)</Label>
                        <Input
                          id="credentials"
                          type="password"
                          value={splunkToken}
                          onChange={(e) => setSplunkToken(e.target.value)}
                          placeholder={editingConnection ? "Leave blank to keep current token" : "Paste Splunk token"}
                          className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                        />
                        <p className="text-[11px] text-slate-500">Token is never displayed after saving.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="web_url">Splunk Web URL (optional)</Label>
                        <Input
                          id="web_url"
                          value={splunkWebUrl}
                          onChange={(e) => setSplunkWebUrl(e.target.value)}
                          placeholder="https://splunk.company.com:8000"
                          className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="verify_ssl">Verify SSL</Label>
                        <Select value={verifySsl} onValueChange={(value: string) => setVerifySsl(value)}>
                          <SelectTrigger className="bg-white text-slate-900 border-slate-200">
                            <SelectValue placeholder="Select" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">true</SelectItem>
                            <SelectItem value="false">false</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="alerts_mode">Alerts source</Label>
                        <Select value={alertsMode} onValueChange={(value: string) => setAlertsMode(value)}>
                          <SelectTrigger className="bg-white text-slate-900 border-slate-200">
                            <SelectValue placeholder="Select alerts source" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="alerts_fired">Alerts fired (recommended)</SelectItem>
                            <SelectItem value="alerts_index">Custom alert index</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {alertsMode === "alerts_index" && (
                        <div className="space-y-2">
                          <Label htmlFor="alerts_index">Alert index</Label>
                          <Input
                            id="alerts_index"
                            value={alertsIndex}
                            onChange={(e) => setAlertsIndex(e.target.value)}
                            placeholder="alerts"
                            className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                          />
                        </div>
                      )}
                      <div className="space-y-2">
                        <Label htmlFor="notable_index">Fallback index (optional)</Label>
                        <Input
                          id="notable_index"
                          value={notableIndex}
                          onChange={(e) => setNotableIndex(e.target.value)}
                          placeholder="notable"
                          className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="es_app">ES app name</Label>
                        <Input
                          id="es_app"
                          value={esApp}
                          onChange={(e) => setEsApp(e.target.value)}
                          placeholder="SplunkEnterpriseSecurity"
                          className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                        />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label className="text-sm font-semibold text-slate-900">Field mapping (optional)</Label>
                        <div className="grid gap-3 md:grid-cols-3">
                          <Input
                            id="host_field"
                            value={hostField}
                            onChange={(e) => setHostField(e.target.value)}
                            placeholder="host field"
                            className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                          />
                          <Input
                            id="user_field"
                            value={userField}
                            onChange={(e) => setUserField(e.target.value)}
                            placeholder="user field"
                            className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                          />
                          <Input
                            id="dest_field"
                            value={destField}
                            onChange={(e) => setDestField(e.target.value)}
                            placeholder="dest field"
                            className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                          />
                          <Input
                            id="src_field"
                            value={srcField}
                            onChange={(e) => setSrcField(e.target.value)}
                            placeholder="src field"
                            className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                          />
                          <Input
                            id="signature_field"
                            value={signatureField}
                            onChange={(e) => setSignatureField(e.target.value)}
                            placeholder="signature field"
                            className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                          />
                        </div>
                        <p className="text-[11px] text-slate-500">Only change if your ES notable fields are customized.</p>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="log_marker_pattern">Log marker pattern (e.g., purvex_*)</Label>
                        <Input
                          id="log_marker_pattern"
                          value={formData.log_marker_pattern || ""}
                          onChange={handleFormChange}
                          required
                          className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                        />
                        <p className="text-[11px] text-muted-foreground">
                          PurveX tags test runs with this prefix so your SIEM searches stay clean and auditable.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-3">
                    <Button
                      type="submit"
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving…" : "Save connection"}
                    </Button>
                    {editingConnection && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowAddForm(false);
                          setEditingConnection(null);
                          setFormData({});
                        }}
                        className="border-slate-200 text-slate-700 hover:bg-slate-50"
                      >
                        Cancel
                      </Button>
                    )}
                    <Button type="button" variant="secondary" disabled className="hidden">
                      <TestTube className="mr-2 h-4 w-4" /> Test connection (coming soon)
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {connections.length === 0 && !showAddForm ? (
            <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-white px-6 py-8 text-sm text-slate-800 shadow-[0_20px_48px_-36px_rgba(15,23,42,0.4)]">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-slate-950 text-white p-3 shadow-lg shadow-slate-900/20">
                    <PlugZap className="h-6 w-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-lg font-semibold text-slate-900">No SIEM connections yet</p>
                    <p className="text-sm text-slate-600">
                      Add a Splunk connection to validate detections. PurveX never ingests raw logs.
                    </p>
                    <p className="text-xs text-slate-500">
                      You can test the connection immediately after saving.
                    </p>
                  </div>
                </div>
                {hasPermission(Permission.SETTINGS_SIEM_MANAGE) && (
                  <Button
                    onClick={handleToggleForm}
                    className="rounded-full px-6"
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add connection
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {connections.map((conn) => (
                <Card
                  key={conn.id}
                  className="border border-slate-200 bg-white shadow-[0_18px_40px_-32px_rgba(15,23,42,0.45)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_50px_-34px_rgba(15,23,42,0.55)]"
                >
                  <CardContent className="pt-5 pb-5 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="h-11 w-11 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center">
                          <Server className="h-5 w-5 text-slate-600" />
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">SIEM Connection</p>
                          <h4 className="text-lg font-semibold text-slate-900 mt-1">{conn.name}</h4>
                          <p className="text-xs text-slate-600 mt-1">{conn.siem_type}</p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${
                            healthById[conn.id]?.status === "connected"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : conn.credentials_present
                                ? "border-sky-200 bg-sky-50 text-sky-700"
                                : "border-amber-200 bg-amber-50 text-amber-700"
                          }`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full bg-current ${
                              healthById[conn.id]?.status === "connected" ? "animate-pulse" : ""
                            }`}
                          />
                          {healthById[conn.id]?.status === "connected"
                            ? "Connected"
                            : conn.credentials_present
                              ? "Configured"
                              : "Not configured"}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          {healthById[conn.id]?.status === "connected"
                            ? "Live check passed"
                            : "Run a test to verify"}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-700 md:grid-cols-3">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">URL</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-700 truncate">{conn.url}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Auth</p>
                        <span className="mt-1 inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] text-slate-600">
                          {conn.auth_type}
                        </span>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Last validated</p>
                        <p className="mt-1 text-[11px] text-slate-700">
                          {conn.last_validated_at
                            ? new Date(conn.last_validated_at).toLocaleString()
                            : "Not yet"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleTestConnection(conn.id)}
                        className="border-slate-200 text-slate-700 hover:bg-slate-50"
                      >
                        Test connection
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(conn)}
                        disabled={!hasPermission(Permission.SETTINGS_SIEM_MANAGE)}
                        title={!hasPermission(Permission.SETTINGS_SIEM_MANAGE) ? "You don't have permission to edit SIEM connections" : ""}
                        className="border-slate-200 text-slate-700 hover:bg-slate-50"
                      >
                        <Edit className="h-4 w-4 mr-1.5" />
                        Edit
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(conn.id)}
                        disabled={!hasPermission(Permission.SETTINGS_SIEM_MANAGE)}
                        title={!hasPermission(Permission.SETTINGS_SIEM_MANAGE) ? "You don't have permission to delete SIEM connections" : ""}
                      >
                        <Trash className="h-4 w-4 mr-1.5" />
                        Remove
                      </Button>
                    </div>

                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
