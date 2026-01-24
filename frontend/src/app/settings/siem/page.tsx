"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Database, PlusCircle, Edit, Trash, TestTube, PlugZap } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";

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

export default function SiemSettingsPage() {
  const { hasPermission } = usePermissions();
  const [connections, setConnections] = useState<SIEMConnection[]>([]);
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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchConnections();
    // Cleanup on unmount to prevent memory leaks
    return () => {
      // Cancel any pending requests if component unmounts
    };
  }, []);

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
  };

  const handleEdit = (connection: SIEMConnection) => {
    setEditingConnection(connection);
    setFormData({ ...connection, credentials: "" });
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
    <div className="space-y-8 max-w-6xl mx-auto">
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between border-b border-slate-200 pb-3">
          <div>
            <CardTitle className="flex items-center gap-3 text-3xl font-display font-semibold text-slate-900">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 border border-slate-200">
                <Database className="h-5 w-5 text-slate-700" />
              </span>
              <span className="font-semibold">SIEM</span>
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl text-sm md:text-base text-slate-600">
              Manage how PurveX reaches your SIEM clusters and which indexes it scans for PurveX markers.
            </CardDescription>
          </div>
          <div className="hidden" aria-hidden="true" />
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="flex flex-col gap-0 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                Configured SIEM connections
              </h3>
              <p className="text-sm text-slate-600 mt-[-2px] mb-4">
                One SIEM per workspace or cluster. Used for test lookups.
              </p>
            </div>
          </div>

          {hasPermission(Permission.SETTINGS_SIEM_MANAGE) && connections.length > 0 && (
            <div className="flex justify-end">
              <Button
                onClick={handleToggleForm}
                className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm rounded-full px-5"
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                {showAddForm ? "Cancel" : "Add SIEM connection"}
              </Button>
            </div>
          )}

          <div
            className={`transition-all duration-300 ease-out overflow-hidden ${
              showAddForm ? "max-h-[1400px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"
            }`}
          >
            <Card className={`bg-card/60 border border-border/60 shadow-inner rounded-xl ${showAddForm ? "animate-in fade-in slide-in-from-top-2 duration-300" : ""}`}>
            <CardHeader className="hidden">
                <CardTitle className="sr-only">
                  {editingConnection ? "Edit SIEM connection" : "Add SIEM connection"}
                </CardTitle>
                <CardDescription className="sr-only">
                  One entry per SIEM workspace or cluster. Use names your SOC will recognize.
                </CardDescription>
            </CardHeader>
            <CardContent className="pt-1">
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
                            <SelectItem value="Sentinel">Sentinel</SelectItem>
                            <SelectItem value="Elastic">Elastic</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="url">URL / cluster / workspace</Label>
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
                            <SelectItem value="API Key">API Key</SelectItem>
                            <SelectItem value="Username/Password">Username/Password</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="credentials">Credentials (stored securely)</Label>
                        <Input
                          id="credentials"
                          type="password"
                          value={formData.credentials || ""}
                          onChange={handleFormChange}
                          placeholder="Token, API key, or password"
                          className="bg-white text-slate-900 border-slate-200 placeholder:text-slate-400"
                        />
                        <p className="text-[11px] text-muted-foreground hidden" />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="space-y-2">
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

                  <div className="flex flex-wrap gap-2 pt-3">
                    <Button
                      type="submit"
                      disabled={isSaving}
                      variant="outline"
                      className="border-border text-foreground hover:bg-accent"
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
                        className="border-border text-foreground hover:bg-accent"
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
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-sm text-slate-800">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-emerald-700">
                    <PlugZap className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-slate-900">No SIEM connections yet</p>
                    <p className="text-sm text-slate-600">
                      Connect your lab workspace first so PurveX can trace telemetry before pointing to production SIEMs.
                    </p>
                  </div>
                </div>
                {hasPermission(Permission.SETTINGS_SIEM_MANAGE) && (
                  <Button
                    onClick={handleToggleForm}
                    className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm rounded-full px-5"
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
                  className="border border-white/5 bg-slate-950/40 shadow-lg shadow-black/30 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
                >
                  <CardContent className="pt-5 pb-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">SIEM Connection</p>
                        <h4 className="text-base font-semibold text-slate-100 mt-1">{conn.name}</h4>
                        <p className="text-xs text-slate-400 mt-1">{conn.siem_type}</p>
                      </div>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                          conn.status === "connected" || conn.status === "active"
                            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                            : conn.credentials_present
                              ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
                              : "border-amber-400/30 bg-amber-400/10 text-amber-300"
                        }`}
                      >
                        {conn.status === "connected" || conn.status === "active"
                          ? "Connected"
                          : conn.credentials_present
                            ? "Configured"
                            : "Not configured"}
                      </span>
                    </div>

                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">URL</span>
                        <span className="font-mono text-[11px] text-slate-200 truncate max-w-[60%]">
                          {conn.url}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Auth</span>
                        <span className="inline-flex items-center rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-200">
                          {conn.auth_type}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400">Last validated</span>
                        <span className="text-[11px] text-slate-200">
                          {conn.last_validated_at
                            ? new Date(conn.last_validated_at).toLocaleDateString()
                            : "Not yet"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEdit(conn)}
                        disabled={!hasPermission(Permission.SETTINGS_SIEM_MANAGE)}
                        title={!hasPermission(Permission.SETTINGS_SIEM_MANAGE) ? "You don't have permission to edit SIEM connections" : ""}
                        className="border-border text-foreground hover:bg-accent"
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
        </CardContent>
      </Card>
    </div>
  );
}
