"use client";

import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Database, PlusCircle, Edit, Trash, PlugZap, Server, CheckCircle2, AlertCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { useToast } from "@/components/ui/toast";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { FieldError, FormError } from "@/components/ui/form-error";
import { z } from "zod";
import { httpUrlSchema, safeNameSchema } from "@/lib/validators";

interface SIEMConnection {
  id: number;
  siem_type: string;
  name: string;
  url: string;
  auth_type: string;
  credentials?: string;
  credentials_present?: boolean;
  status?: string;
  last_validated_at?: string;
  default_windows_index?: string;
  default_linux_index?: string;
  default_cloud_index?: string;
  log_marker_pattern: string;
}

interface ConnectionHealth {
  status?: string;
  message?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export default function SiemSettingsPage() {
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const [connections, setConnections] = useState<SIEMConnection[]>([]);
  const [healthById, setHealthById] = useState<Record<number, ConnectionHealth>>({});
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
  // Elastic
  const [elasticApiKey, setElasticApiKey] = useState("");
  const [elasticSignalsIndex, setElasticSignalsIndex] = useState(".alerts-security.alerts-default");
  const [elasticEventsIndex, setElasticEventsIndex] = useState("logs-*");
  // Sentinel
  const [sentinelTenantId, setSentinelTenantId] = useState("");
  const [sentinelClientId, setSentinelClientId] = useState("");
  const [sentinelClientSecret, setSentinelClientSecret] = useState("");
  const [sentinelWorkspaceId, setSentinelWorkspaceId] = useState("");
  const [sentinelSubscriptionId, setSentinelSubscriptionId] = useState("");
  const [sentinelResourceGroup, setSentinelResourceGroup] = useState("");
  const [sentinelWorkspaceName, setSentinelWorkspaceName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    url?: string;
    credential?: string;
  }>({});

  const siemType = (formData.siem_type || "").toLowerCase();
  const isSplunk = siemType === "splunk";
  const isElastic = siemType === "elastic" || siemType === "elasticsearch" || siemType === "kibana";
  const isSentinel = siemType === "sentinel";

  useEffect(() => {
    fetchConnections();
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
          } catch (err: unknown) {
            return [conn.id, { status: "error", message: getErrorMessage(err, "Health check failed") }] as const;
          }
        })
      );
      if (!cancelled) {
        const next: Record<number, ConnectionHealth> = {};
        entries.forEach(([id, value]) => {
          next[id] = value;
        });
        setHealthById(next);
      }
    };
    fetchHealth();
    return () => { cancelled = true; };
  }, [connections]);

  const fetchConnections = async () => {
    try {
      setLoading(true);
      const data = await apiFetch("/settings/siem-connections");
      setConnections(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load SIEM connections."));
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

  const resetForm = () => {
    setFormData({ siem_type: "Splunk", name: "", url: "", auth_type: "Token", log_marker_pattern: "purvex_*" });
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
    setElasticApiKey("");
    setElasticSignalsIndex(".alerts-security.alerts-default");
    setElasticEventsIndex("logs-*");
    setSentinelTenantId("");
    setSentinelClientId("");
    setSentinelClientSecret("");
    setSentinelWorkspaceId("");
    setSentinelSubscriptionId("");
    setSentinelResourceGroup("");
    setSentinelWorkspaceName("");
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Core common fields. URL is optional for Sentinel (portal URL is optional
    // on that connector) so the schema is composed conditionally.
    const commonSchema = z.object({
      name: safeNameSchema,
      url: isSentinel ? z.string().trim().optional() : httpUrlSchema,
      siem_type: z.string().min(1, "Pick a SIEM type."),
      auth_type: z.string().min(1, "Pick an auth type."),
    });

    const parsed = commonSchema.safeParse({
      name: formData.name ?? "",
      url: formData.url ?? "",
      siem_type: formData.siem_type ?? "",
      auth_type: formData.auth_type ?? "",
    });

    const nextFieldErrors: typeof fieldErrors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "name" && !nextFieldErrors.name) nextFieldErrors.name = issue.message;
        if (key === "url" && !nextFieldErrors.url) nextFieldErrors.url = issue.message;
      }
    }

    // Connector-specific required credential. Keep the check shallow — the
    // server performs full validation when the user clicks "Test connection".
    let credentialIssue: string | undefined;
    if (isSplunk && !splunkToken && !editingConnection) {
      credentialIssue = "Splunk HEC/auth token is required.";
    } else if (isElastic && !elasticApiKey && !editingConnection) {
      credentialIssue = "Elastic API key is required.";
    } else if (isSentinel && !editingConnection) {
      if (!sentinelTenantId || !sentinelClientId || !sentinelClientSecret || !sentinelWorkspaceId) {
        credentialIssue = "Tenant, client ID, client secret, and workspace ID are required for Sentinel.";
      }
    }
    if (credentialIssue) nextFieldErrors.credential = credentialIssue;

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setError(null);
      return;
    }

    setFieldErrors({});

    const payload: Partial<SIEMConnection> = { ...formData };
    let credentialsPayload: Record<string, unknown> = {};
    if (isSplunk) {
      credentialsPayload = {
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
    } else if (isElastic) {
      credentialsPayload = {
        api_key: elasticApiKey || undefined,
        verify_ssl: verifySsl === "true",
        signals_index: elasticSignalsIndex || ".alerts-security.alerts-default",
        events_index: elasticEventsIndex || "logs-*",
      };
    } else if (isSentinel) {
      credentialsPayload = {
        tenant_id: sentinelTenantId || undefined,
        client_id: sentinelClientId || undefined,
        client_secret: sentinelClientSecret || undefined,
        workspace_id: sentinelWorkspaceId || undefined,
        subscription_id: sentinelSubscriptionId || undefined,
        resource_group: sentinelResourceGroup || undefined,
        workspace_name: sentinelWorkspaceName || undefined,
      };
    }
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
      resetForm();
      setShowAddForm(false);
      setEditingConnection(null);
      fetchConnections();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save SIEM connection."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleForm = () => {
    setShowAddForm(prev => !prev);
    setEditingConnection(null);
    resetForm();
  };

  const handleEdit = (connection: SIEMConnection) => {
    setEditingConnection(connection);
    setFormData({ ...connection, credentials: "" });
    setSplunkToken("");
    setElasticApiKey("");
    setSentinelClientSecret("");
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
      setElasticSignalsIndex(parsed.signals_index || ".alerts-security.alerts-default");
      setElasticEventsIndex(parsed.events_index || "logs-*");
      setSentinelTenantId(parsed.tenant_id || "");
      setSentinelClientId(parsed.client_id || "");
      setSentinelWorkspaceId(parsed.workspace_id || "");
      setSentinelSubscriptionId(parsed.subscription_id || "");
      setSentinelResourceGroup(parsed.resource_group || "");
      setSentinelWorkspaceName(parsed.workspace_name || "");
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
      setElasticSignalsIndex(".alerts-security.alerts-default");
      setElasticEventsIndex("logs-*");
      setSentinelTenantId("");
      setSentinelClientId("");
      setSentinelWorkspaceId("");
      setSentinelSubscriptionId("");
      setSentinelResourceGroup("");
      setSentinelWorkspaceName("");
    }
    setShowAddForm(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this SIEM connection?")) return;
    try {
      await apiFetch(`/settings/siem-connections/${id}`, { method: "DELETE" });
      fetchConnections();
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to delete SIEM connection."));
    }
  };

  const handleTestConnection = async (id: number) => {
    try {
      const health = await apiFetch(`/settings/siem-connections/${id}/health`);
      if (health?.status === "connected") {
        toast({ type: "success", title: "Splunk connected", description: "PurveX can reach Splunk and read alerts." });
      } else {
        toast({ type: "error", title: "Connection failed", description: health?.message || "Unable to connect to Splunk." });
      }
      fetchConnections();
    } catch (err: unknown) {
      toast({ type: "error", title: "Connection failed", description: getErrorMessage(err, "Unable to connect to Splunk.") });
    }
  };

  if (loading) {
    return (
      <PageContainer maxWidth="xl">
        <PageSkeleton withEyebrow withActions variant="list" rows={3} />
      </PageContainer>
    );
  }

  const canManage = hasPermission(Permission.SETTINGS_SIEM_MANAGE);

  return (
    <PageContainer maxWidth="xl" className="space-y-6">
      <PageHeader
        eyebrow="Configuration"
        title="SIEM"
        subtitle="Connect your SIEM for detection validation and evidence collection."
        icon={<Database className="h-5 w-5" />}
        actions={
          canManage && connections.length > 0 ? (
            <Button onClick={handleToggleForm}>
              <PlusCircle className="mr-2 h-4 w-4" />
              {showAddForm ? "Cancel" : "Add connection"}
            </Button>
          ) : undefined
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Connection form */}
      {showAddForm && (
        <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)]">
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Read-only access only. PurveX does not ingest raw logs.
            </div>
            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Connection name</Label>
                  <Input
                    id="name"
                    value={formData.name || ""}
                    onChange={handleFormChange}
                    required
                    placeholder="e.g. Production Splunk"
                    aria-invalid={!!fieldErrors.name}
                    aria-describedby="siem-name-error"
                  />
                  <FieldError id="siem-name-error" message={fieldErrors.name} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="siem_type">SIEM type</Label>
                  <Select onValueChange={(v: string) => handleSelectChange("siem_type", v)} value={formData.siem_type}>
                    <SelectTrigger><SelectValue placeholder="Select SIEM type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Splunk">Splunk</SelectItem>
                      <SelectItem value="Elastic">Elastic Security</SelectItem>
                      <SelectItem value="Sentinel">Microsoft Sentinel</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="url">
                    {isSplunk && "Management URL (port 8089)"}
                    {isElastic && "Kibana base URL"}
                    {isSentinel && "Portal URL (optional)"}
                  </Label>
                  <Input
                    id="url"
                    value={formData.url || ""}
                    onChange={handleFormChange}
                    required={!isSentinel}
                    placeholder={
                      isSplunk
                        ? "https://splunk.company.com:8089"
                        : isElastic
                          ? "https://kibana.company.com"
                          : "https://portal.azure.com"
                    }
                    aria-invalid={!!fieldErrors.url}
                    aria-describedby="siem-url-error"
                  />
                  <FieldError id="siem-url-error" message={fieldErrors.url} />
                </div>
              </div>

              {fieldErrors.credential && (
                <FormError message={fieldErrors.credential} />
              )}

              {isSplunk && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="auth_type">Authentication</Label>
                    <Select onValueChange={(v: string) => handleSelectChange("auth_type", v)} value={formData.auth_type}>
                      <SelectTrigger><SelectValue placeholder="Select auth type" /></SelectTrigger>
                      <SelectContent><SelectItem value="Token">Token</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="credentials">Splunk token</Label>
                    <Input
                      id="credentials"
                      type="password"
                      value={splunkToken}
                      onChange={(e) => setSplunkToken(e.target.value)}
                      placeholder={editingConnection ? "Leave blank to keep current" : "Paste token"}
                    />
                  </div>
                </div>
              )}

              {isElastic && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="auth_type">Authentication</Label>
                    <Select onValueChange={(v: string) => handleSelectChange("auth_type", v)} value={formData.auth_type}>
                      <SelectTrigger><SelectValue placeholder="Select auth type" /></SelectTrigger>
                      <SelectContent><SelectItem value="ApiKey">API key</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="elastic_api_key">Elastic API key</Label>
                    <Input
                      id="elastic_api_key"
                      type="password"
                      value={elasticApiKey}
                      onChange={(e) => setElasticApiKey(e.target.value)}
                      placeholder={editingConnection ? "Leave blank to keep current" : "Paste base64 API key"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Signals index</Label>
                    <Input value={elasticSignalsIndex} onChange={(e) => setElasticSignalsIndex(e.target.value)} placeholder=".alerts-security.alerts-default" />
                  </div>
                  <div className="space-y-2">
                    <Label>Events index pattern</Label>
                    <Input value={elasticEventsIndex} onChange={(e) => setElasticEventsIndex(e.target.value)} placeholder="logs-*" />
                  </div>
                </div>
              )}

              {isSentinel && (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="auth_type">Authentication</Label>
                    <Select onValueChange={(v: string) => handleSelectChange("auth_type", v)} value={formData.auth_type}>
                      <SelectTrigger><SelectValue placeholder="Select auth type" /></SelectTrigger>
                      <SelectContent><SelectItem value="ServicePrincipal">Service principal</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Tenant ID</Label>
                    <Input value={sentinelTenantId} onChange={(e) => setSentinelTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                  </div>
                  <div className="space-y-2">
                    <Label>Client ID</Label>
                    <Input value={sentinelClientId} onChange={(e) => setSentinelClientId(e.target.value)} placeholder="App registration client ID" />
                  </div>
                  <div className="space-y-2">
                    <Label>Client secret</Label>
                    <Input
                      type="password"
                      value={sentinelClientSecret}
                      onChange={(e) => setSentinelClientSecret(e.target.value)}
                      placeholder={editingConnection ? "Leave blank to keep current" : "Client secret value"}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Log Analytics workspace ID</Label>
                    <Input value={sentinelWorkspaceId} onChange={(e) => setSentinelWorkspaceId(e.target.value)} placeholder="Workspace (customer) ID" />
                  </div>
                  <div className="space-y-2">
                    <Label>Subscription ID (optional, for rules)</Label>
                    <Input value={sentinelSubscriptionId} onChange={(e) => setSentinelSubscriptionId(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Resource group (optional)</Label>
                    <Input value={sentinelResourceGroup} onChange={(e) => setSentinelResourceGroup(e.target.value)} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Workspace name (optional)</Label>
                    <Input value={sentinelWorkspaceName} onChange={(e) => setSentinelWorkspaceName(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="log_marker_pattern">Log marker pattern</Label>
                <Input id="log_marker_pattern" value={formData.log_marker_pattern || ""} onChange={handleFormChange} required placeholder="purvex_*" />
              </div>

              {isSplunk && (
              <details className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
                <summary className="cursor-pointer text-sm font-medium text-[var(--foreground)]">Advanced evidence mapping</summary>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Splunk Web URL</Label>
                    <Input value={splunkWebUrl} onChange={(e) => setSplunkWebUrl(e.target.value)} placeholder="https://splunk.company.com:8000" />
                  </div>
                  <div className="space-y-2">
                    <Label>Verify SSL</Label>
                    <Select value={verifySsl} onValueChange={(v: string) => setVerifySsl(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">true</SelectItem>
                        <SelectItem value="false">false</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Alerts source</Label>
                    <Select value={alertsMode} onValueChange={(v: string) => setAlertsMode(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="alerts_fired">Alerts fired</SelectItem>
                        <SelectItem value="alerts_index">Custom alert index</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {alertsMode === "alerts_index" && (
                    <div className="space-y-2">
                      <Label>Alert index</Label>
                      <Input value={alertsIndex} onChange={(e) => setAlertsIndex(e.target.value)} placeholder="alerts" />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Fallback index</Label>
                    <Input value={notableIndex} onChange={(e) => setNotableIndex(e.target.value)} placeholder="notable" />
                  </div>
                  <div className="space-y-2">
                    <Label>ES app name</Label>
                    <Input value={esApp} onChange={(e) => setEsApp(e.target.value)} placeholder="SplunkEnterpriseSecurity" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Field mapping</Label>
                    <div className="grid gap-3 md:grid-cols-3">
                      <Input value={hostField} onChange={(e) => setHostField(e.target.value)} placeholder="host" />
                      <Input value={userField} onChange={(e) => setUserField(e.target.value)} placeholder="user" />
                      <Input value={destField} onChange={(e) => setDestField(e.target.value)} placeholder="dest" />
                      <Input value={srcField} onChange={(e) => setSrcField(e.target.value)} placeholder="src" />
                      <Input value={signatureField} onChange={(e) => setSignatureField(e.target.value)} placeholder="signature" />
                    </div>
                  </div>
                </div>
              </details>
              )}

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save connection"}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowAddForm(false); setEditingConnection(null); resetForm(); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {connections.length === 0 && !showAddForm && (
        <Card className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)]">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--surface-elevated)] mb-4">
              <PlugZap className="h-6 w-6 text-[var(--surface-subtle-foreground)]" />
            </div>
            <p className="text-base font-semibold text-[var(--foreground)]">No SIEM connections</p>
            <p className="mt-1 text-sm text-[var(--surface-subtle-foreground)]">Add a connection to start validating detections.</p>
            {canManage && (
              <Button onClick={handleToggleForm} className="mt-4">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add connection
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Connection cards */}
      {connections.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {connections.map((conn) => {
            const health = healthById[conn.id];
            const isConnected = health?.status === "connected";
            const isConfigured = conn.credentials_present;
            return (
              <Card key={conn.id} className="border border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)] transition hover:shadow-md">
                <CardContent className="pt-5 pb-5 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="h-10 w-10 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] flex items-center justify-center">
                        <Server className="h-5 w-5 text-[var(--surface-subtle-foreground)]" />
                      </div>
                      <div>
                        <h4 className="text-base font-semibold text-[var(--foreground)]">{conn.name}</h4>
                        <p className="text-xs text-[var(--surface-subtle-foreground)]">{conn.siem_type}</p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                      isConnected
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : isConfigured
                          ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300"
                          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full bg-current ${isConnected ? "animate-pulse" : ""}`} />
                      {isConnected ? "Connected" : isConfigured ? "Configured" : "Not configured"}
                    </span>
                  </div>

                  <div className="grid gap-3 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-xs md:grid-cols-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">URL</p>
                      <p className="mt-1 font-mono text-[11px] text-[var(--foreground)] truncate">{conn.url}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Auth</p>
                      <p className="mt-1 text-[11px] text-[var(--foreground)]">{conn.auth_type}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">Last validated</p>
                      <p className="mt-1 text-[11px] text-[var(--foreground)]">
                        {conn.last_validated_at ? new Date(conn.last_validated_at).toLocaleString() : "Not yet"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleTestConnection(conn.id)}>
                      Test connection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(conn)}
                      disabled={!canManage}
                      title={!canManage ? "You don't have permission to edit SIEM connections" : ""}
                    >
                      <Edit className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(conn.id)}
                      disabled={!canManage}
                      title={!canManage ? "You don't have permission to delete SIEM connections" : ""}
                    >
                      <Trash className="h-3.5 w-3.5 mr-1.5" />
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
