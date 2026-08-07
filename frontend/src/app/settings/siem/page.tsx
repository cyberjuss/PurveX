"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PlusCircle,
  Edit,
  Trash,
  PlugZap,
  Server,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  SettingsPageShell,
  SettingsSection,
  SettingsBanner,
  SettingsStatusPill,
} from "@/components/settings/settings-section";
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
      <SettingsPageShell eyebrow="Configuration" title="SIEM" divided={false}>
        <PageSkeleton withEyebrow withActions variant="list" rows={3} />
      </SettingsPageShell>
    );
  }

  const canManage = hasPermission(Permission.SETTINGS_SIEM_MANAGE);

  return (
    <SettingsPageShell
      eyebrow="Configuration"
      title="SIEM"
      description="Connect your SIEM so PurveX can validate detections and pull evidence on demand. Read-only access only — raw logs never leave your environment."
      status={
        <SettingsStatusPill tone={connections.length > 0 ? "ok" : "muted"}>
          {connections.length > 0
            ? `${connections.length} connected`
            : "Not configured"}
        </SettingsStatusPill>
      }
      actions={
        canManage && connections.length > 0 && !showAddForm ? (
          <Button size="sm" onClick={handleToggleForm}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add connection
          </Button>
        ) : undefined
      }
      banner={
        error ? (
          <SettingsBanner tone="danger" icon={<AlertCircle className="h-4 w-4" />}>
            {error}
          </SettingsBanner>
        ) : undefined
      }
    >
      {showAddForm ? (
        <SiemForm
          editing={!!editingConnection}
          isSaving={isSaving}
          siemType={formData.siem_type || ""}
          isSplunk={isSplunk}
          isElastic={isElastic}
          isSentinel={isSentinel}
          formData={formData}
          fieldErrors={fieldErrors}
          onFormChange={handleFormChange}
          onSelectChange={handleSelectChange}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setShowAddForm(false);
            setEditingConnection(null);
            resetForm();
          }}
          splunkToken={splunkToken}
          setSplunkToken={setSplunkToken}
          splunkWebUrl={splunkWebUrl}
          setSplunkWebUrl={setSplunkWebUrl}
          verifySsl={verifySsl}
          setVerifySsl={setVerifySsl}
          notableIndex={notableIndex}
          setNotableIndex={setNotableIndex}
          alertsMode={alertsMode}
          setAlertsMode={setAlertsMode}
          alertsIndex={alertsIndex}
          setAlertsIndex={setAlertsIndex}
          hostField={hostField}
          setHostField={setHostField}
          userField={userField}
          setUserField={setUserField}
          destField={destField}
          setDestField={setDestField}
          srcField={srcField}
          setSrcField={setSrcField}
          signatureField={signatureField}
          setSignatureField={setSignatureField}
          esApp={esApp}
          setEsApp={setEsApp}
          elasticApiKey={elasticApiKey}
          setElasticApiKey={setElasticApiKey}
          elasticSignalsIndex={elasticSignalsIndex}
          setElasticSignalsIndex={setElasticSignalsIndex}
          elasticEventsIndex={elasticEventsIndex}
          setElasticEventsIndex={setElasticEventsIndex}
          sentinelTenantId={sentinelTenantId}
          setSentinelTenantId={setSentinelTenantId}
          sentinelClientId={sentinelClientId}
          setSentinelClientId={setSentinelClientId}
          sentinelClientSecret={sentinelClientSecret}
          setSentinelClientSecret={setSentinelClientSecret}
          sentinelWorkspaceId={sentinelWorkspaceId}
          setSentinelWorkspaceId={setSentinelWorkspaceId}
          sentinelSubscriptionId={sentinelSubscriptionId}
          setSentinelSubscriptionId={setSentinelSubscriptionId}
          sentinelResourceGroup={sentinelResourceGroup}
          setSentinelResourceGroup={setSentinelResourceGroup}
          sentinelWorkspaceName={sentinelWorkspaceName}
          setSentinelWorkspaceName={setSentinelWorkspaceName}
        />
      ) : connections.length === 0 ? (
        <SettingsSection
          title="No connections yet"
          description="Add a SIEM so PurveX can read evidence for detection validation."
          stacked
        >
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--stroke-soft)] bg-[var(--surface-elevated)] py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--surface-card)]">
              <PlugZap className="h-5 w-5 text-[var(--surface-subtle-foreground)]" />
            </div>
            <p className="mt-3 text-sm font-medium text-[var(--surface-card-foreground)]">
              Connect your first SIEM
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--surface-subtle-foreground)]">
              We support Splunk, Elastic Security, and Microsoft Sentinel. The
              account only needs read access.
            </p>
            {canManage ? (
              <Button size="sm" onClick={handleToggleForm} className="mt-4">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add connection
              </Button>
            ) : null}
          </div>
        </SettingsSection>
      ) : (
        <SettingsSection
          title="Connections"
          description="Each connection is one SIEM PurveX can validate detections against."
          stacked
        >
          <ul className="divide-y divide-[var(--stroke-soft)] overflow-hidden rounded-lg border border-[var(--stroke-soft)]">
            {connections.map((conn) => {
              const health = healthById[conn.id];
              const isConnected = health?.status === "connected";
              const isConfigured = conn.credentials_present;
              const tone = isConnected
                ? "ok"
                : isConfigured
                  ? "muted"
                  : "warn";
              return (
                <li
                  key={conn.id}
                  className="flex flex-col gap-3 bg-[var(--surface-card)] p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                      <Server className="h-4 w-4 text-[var(--surface-subtle-foreground)]" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[var(--surface-card-foreground)]">
                          {conn.name}
                        </p>
                        <SettingsStatusPill tone={tone}>
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full bg-current",
                              isConnected && "animate-pulse"
                            )}
                          />
                          {isConnected
                            ? "Connected"
                            : isConfigured
                              ? "Configured"
                              : "Not configured"}
                        </SettingsStatusPill>
                      </div>
                      <p className="truncate font-mono text-xs text-[var(--surface-subtle-foreground)]">
                        {conn.url || "—"}
                      </p>
                      <p className="text-xs text-[var(--surface-subtle-foreground)]">
                        {conn.siem_type} · {conn.auth_type} · last validated{" "}
                        {conn.last_validated_at
                          ? new Date(conn.last_validated_at).toLocaleString()
                          : "never"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestConnection(conn.id)}
                    >
                      <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(conn)}
                      disabled={!canManage}
                      title={
                        !canManage
                          ? "You do not have permission to edit SIEM connections"
                          : ""
                      }
                    >
                      <Edit className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(conn.id)}
                      disabled={!canManage}
                      title={
                        !canManage
                          ? "You do not have permission to delete SIEM connections"
                          : ""
                      }
                      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </SettingsSection>
      )}
    </SettingsPageShell>
  );
}

interface SiemFormProps {
  editing: boolean;
  isSaving: boolean;
  siemType: string;
  isSplunk: boolean;
  isElastic: boolean;
  isSentinel: boolean;
  formData: Partial<SIEMConnection>;
  fieldErrors: { name?: string; url?: string; credential?: string };
  onFormChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onSelectChange: (id: keyof SIEMConnection, value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;

  splunkToken: string;
  setSplunkToken: (v: string) => void;
  splunkWebUrl: string;
  setSplunkWebUrl: (v: string) => void;
  verifySsl: string;
  setVerifySsl: (v: string) => void;
  notableIndex: string;
  setNotableIndex: (v: string) => void;
  alertsMode: string;
  setAlertsMode: (v: string) => void;
  alertsIndex: string;
  setAlertsIndex: (v: string) => void;
  hostField: string;
  setHostField: (v: string) => void;
  userField: string;
  setUserField: (v: string) => void;
  destField: string;
  setDestField: (v: string) => void;
  srcField: string;
  setSrcField: (v: string) => void;
  signatureField: string;
  setSignatureField: (v: string) => void;
  esApp: string;
  setEsApp: (v: string) => void;

  elasticApiKey: string;
  setElasticApiKey: (v: string) => void;
  elasticSignalsIndex: string;
  setElasticSignalsIndex: (v: string) => void;
  elasticEventsIndex: string;
  setElasticEventsIndex: (v: string) => void;

  sentinelTenantId: string;
  setSentinelTenantId: (v: string) => void;
  sentinelClientId: string;
  setSentinelClientId: (v: string) => void;
  sentinelClientSecret: string;
  setSentinelClientSecret: (v: string) => void;
  sentinelWorkspaceId: string;
  setSentinelWorkspaceId: (v: string) => void;
  sentinelSubscriptionId: string;
  setSentinelSubscriptionId: (v: string) => void;
  sentinelResourceGroup: string;
  setSentinelResourceGroup: (v: string) => void;
  sentinelWorkspaceName: string;
  setSentinelWorkspaceName: (v: string) => void;
}

function SiemForm(props: SiemFormProps) {
  const {
    editing,
    isSaving,
    isSplunk,
    isElastic,
    isSentinel,
    formData,
    fieldErrors,
    onFormChange,
    onSelectChange,
    onSubmit,
    onCancel,
  } = props;

  return (
    <form onSubmit={onSubmit}>
      <SettingsSection
        title="Identity"
        description="What this connection is and where to reach it."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Connection name</Label>
            <Input
              id="name"
              value={formData.name || ""}
              onChange={onFormChange}
              required
              placeholder="e.g. Production Splunk"
              aria-invalid={!!fieldErrors.name}
              aria-describedby="siem-name-error"
            />
            <FieldError id="siem-name-error" message={fieldErrors.name} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="siem_type">SIEM type</Label>
            <Select
              onValueChange={(v: string) => onSelectChange("siem_type", v)}
              value={formData.siem_type}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select SIEM type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Splunk">Splunk</SelectItem>
                <SelectItem value="Elastic">Elastic Security</SelectItem>
                <SelectItem value="Sentinel">Microsoft Sentinel</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="url">
              {isSplunk && "Management URL (port 8089)"}
              {isElastic && "Kibana base URL"}
              {isSentinel && "Portal URL (optional)"}
            </Label>
            <Input
              id="url"
              value={formData.url || ""}
              onChange={onFormChange}
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
      </SettingsSection>

      <SettingsSection
        title="Authentication"
        description="Read-only credentials. PurveX never ingests raw logs."
      >
        <div className="space-y-4">
          {fieldErrors.credential ? <FormError message={fieldErrors.credential} /> : null}

          {isSplunk ? (
            <SplunkAuthFields
              authType={formData.auth_type || "Token"}
              onAuthChange={(v) => onSelectChange("auth_type", v)}
              token={props.splunkToken}
              setToken={props.setSplunkToken}
              editing={editing}
            />
          ) : null}

          {isElastic ? (
            <ElasticAuthFields
              authType={formData.auth_type || "ApiKey"}
              onAuthChange={(v) => onSelectChange("auth_type", v)}
              apiKey={props.elasticApiKey}
              setApiKey={props.setElasticApiKey}
              signalsIndex={props.elasticSignalsIndex}
              setSignalsIndex={props.setElasticSignalsIndex}
              eventsIndex={props.elasticEventsIndex}
              setEventsIndex={props.setElasticEventsIndex}
              editing={editing}
            />
          ) : null}

          {isSentinel ? (
            <SentinelAuthFields
              authType={formData.auth_type || "ServicePrincipal"}
              onAuthChange={(v) => onSelectChange("auth_type", v)}
              tenantId={props.sentinelTenantId}
              setTenantId={props.setSentinelTenantId}
              clientId={props.sentinelClientId}
              setClientId={props.setSentinelClientId}
              clientSecret={props.sentinelClientSecret}
              setClientSecret={props.setSentinelClientSecret}
              workspaceId={props.sentinelWorkspaceId}
              setWorkspaceId={props.setSentinelWorkspaceId}
              subscriptionId={props.sentinelSubscriptionId}
              setSubscriptionId={props.setSentinelSubscriptionId}
              resourceGroup={props.sentinelResourceGroup}
              setResourceGroup={props.setSentinelResourceGroup}
              workspaceName={props.sentinelWorkspaceName}
              setWorkspaceName={props.setSentinelWorkspaceName}
              editing={editing}
            />
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Evidence"
        description="How PurveX recognises its own validation traffic in your SIEM."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="log_marker_pattern">Log marker pattern</Label>
            <Input
              id="log_marker_pattern"
              value={formData.log_marker_pattern || ""}
              onChange={onFormChange}
              required
              placeholder="purvex_*"
            />
            <p className="text-xs text-[var(--surface-subtle-foreground)]">
              Used to filter validation activity from real alerts in queries.
            </p>
          </div>

          {isSplunk ? (
            <details className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                Advanced Splunk mapping
              </summary>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Splunk Web URL</Label>
                  <Input
                    value={props.splunkWebUrl}
                    onChange={(e) => props.setSplunkWebUrl(e.target.value)}
                    placeholder="https://splunk.company.com:8000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Verify SSL</Label>
                  <Select
                    value={props.verifySsl}
                    onValueChange={(v: string) => props.setVerifySsl(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">true</SelectItem>
                      <SelectItem value="false">false</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Alerts source</Label>
                  <Select
                    value={props.alertsMode}
                    onValueChange={(v: string) => props.setAlertsMode(v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alerts_fired">Alerts fired</SelectItem>
                      <SelectItem value="alerts_index">Custom alert index</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {props.alertsMode === "alerts_index" ? (
                  <div className="space-y-1.5">
                    <Label>Alert index</Label>
                    <Input
                      value={props.alertsIndex}
                      onChange={(e) => props.setAlertsIndex(e.target.value)}
                      placeholder="alerts"
                    />
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label>Fallback index</Label>
                  <Input
                    value={props.notableIndex}
                    onChange={(e) => props.setNotableIndex(e.target.value)}
                    placeholder="notable"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>ES app name</Label>
                  <Input
                    value={props.esApp}
                    onChange={(e) => props.setEsApp(e.target.value)}
                    placeholder="SplunkEnterpriseSecurity"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Field mapping</Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      value={props.hostField}
                      onChange={(e) => props.setHostField(e.target.value)}
                      placeholder="host"
                    />
                    <Input
                      value={props.userField}
                      onChange={(e) => props.setUserField(e.target.value)}
                      placeholder="user"
                    />
                    <Input
                      value={props.destField}
                      onChange={(e) => props.setDestField(e.target.value)}
                      placeholder="dest"
                    />
                    <Input
                      value={props.srcField}
                      onChange={(e) => props.setSrcField(e.target.value)}
                      placeholder="src"
                    />
                    <Input
                      value={props.signatureField}
                      onChange={(e) => props.setSignatureField(e.target.value)}
                      placeholder="signature"
                    />
                  </div>
                </div>
              </div>
            </details>
          ) : null}
        </div>
      </SettingsSection>

      <div className="flex items-center justify-end gap-2 border-t border-[var(--stroke-soft)] py-4">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isSaving}>
          <CheckCircle2 className="mr-1.5 h-4 w-4" />
          {isSaving ? "Saving…" : editing ? "Save changes" : "Save connection"}
        </Button>
      </div>
    </form>
  );
}

function SplunkAuthFields({
  authType,
  onAuthChange,
  token,
  setToken,
  editing,
}: {
  authType: string;
  onAuthChange: (v: string) => void;
  token: string;
  setToken: (v: string) => void;
  editing: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="auth_type">Auth method</Label>
        <Select onValueChange={onAuthChange} value={authType}>
          <SelectTrigger>
            <SelectValue placeholder="Select auth type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Token">Token</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="splunk_token">Splunk token</Label>
        <Input
          id="splunk_token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={editing ? "Leave blank to keep current" : "Paste token"}
        />
      </div>
    </div>
  );
}

function ElasticAuthFields({
  authType,
  onAuthChange,
  apiKey,
  setApiKey,
  signalsIndex,
  setSignalsIndex,
  eventsIndex,
  setEventsIndex,
  editing,
}: {
  authType: string;
  onAuthChange: (v: string) => void;
  apiKey: string;
  setApiKey: (v: string) => void;
  signalsIndex: string;
  setSignalsIndex: (v: string) => void;
  eventsIndex: string;
  setEventsIndex: (v: string) => void;
  editing: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Auth method</Label>
        <Select onValueChange={onAuthChange} value={authType}>
          <SelectTrigger>
            <SelectValue placeholder="Select auth type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ApiKey">API key</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="elastic_api_key">Elastic API key</Label>
        <Input
          id="elastic_api_key"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={editing ? "Leave blank to keep current" : "Paste base64 API key"}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Signals index</Label>
        <Input
          value={signalsIndex}
          onChange={(e) => setSignalsIndex(e.target.value)}
          placeholder=".alerts-security.alerts-default"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Events index pattern</Label>
        <Input
          value={eventsIndex}
          onChange={(e) => setEventsIndex(e.target.value)}
          placeholder="logs-*"
        />
      </div>
    </div>
  );
}

function SentinelAuthFields(props: {
  authType: string;
  onAuthChange: (v: string) => void;
  tenantId: string;
  setTenantId: (v: string) => void;
  clientId: string;
  setClientId: (v: string) => void;
  clientSecret: string;
  setClientSecret: (v: string) => void;
  workspaceId: string;
  setWorkspaceId: (v: string) => void;
  subscriptionId: string;
  setSubscriptionId: (v: string) => void;
  resourceGroup: string;
  setResourceGroup: (v: string) => void;
  workspaceName: string;
  setWorkspaceName: (v: string) => void;
  editing: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Auth method</Label>
        <Select onValueChange={props.onAuthChange} value={props.authType}>
          <SelectTrigger>
            <SelectValue placeholder="Select auth type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ServicePrincipal">Service principal</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>Tenant ID</Label>
        <Input
          value={props.tenantId}
          onChange={(e) => props.setTenantId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Client ID</Label>
        <Input
          value={props.clientId}
          onChange={(e) => props.setClientId(e.target.value)}
          placeholder="App registration client ID"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Client secret</Label>
        <Input
          type="password"
          value={props.clientSecret}
          onChange={(e) => props.setClientSecret(e.target.value)}
          placeholder={props.editing ? "Leave blank to keep current" : "Client secret value"}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Log Analytics workspace ID</Label>
        <Input
          value={props.workspaceId}
          onChange={(e) => props.setWorkspaceId(e.target.value)}
          placeholder="Workspace (customer) ID"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Subscription ID (optional)</Label>
        <Input
          value={props.subscriptionId}
          onChange={(e) => props.setSubscriptionId(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Resource group (optional)</Label>
        <Input
          value={props.resourceGroup}
          onChange={(e) => props.setResourceGroup(e.target.value)}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Workspace name (optional)</Label>
        <Input
          value={props.workspaceName}
          onChange={(e) => props.setWorkspaceName(e.target.value)}
        />
      </div>
    </div>
  );
}
