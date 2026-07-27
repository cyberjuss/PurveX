"use client";

import { useCallback, useEffect, useState } from "react";
import {
  RefreshCw,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  FileCode2,
} from "lucide-react";
import { SettingsSection, SettingsBanner } from "@/components/settings/settings-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  listDetectionSources,
  createDetectionSource,
  deleteDetectionSource,
  syncDetectionSource,
  type DetectionSource,
  type DetectionSourceSyncResult,
  type DetectionSourceAuthType,
} from "@/lib/api";

/**
 * Import panel of the Detection-as-Code settings page.
 *
 * PurveX supports Detection-as-Code: teams keep detection YAML files in a
 * git repository and let PurveX sync them. Changes that conflict with
 * local edits become proposals routed through the Detections proposal
 * filter.
 *
 * We deliberately don't ship an "edit" modal in V1 — deleting + re-adding
 * a source is low-cost (detections remain in place because the delete
 * endpoint just nulls out the FK).
 */
export function DetectionSourcesPanel({
  onStatusChange,
}: {
  onStatusChange?: (count: number) => void;
}) {
  const [sources, setSources] = useState<DetectionSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<
    | (DetectionSourceSyncResult & { name: string; kind: "ok" | "error" })
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listDetectionSources();
      setSources(rows);
      onStatusChange?.(rows.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sources");
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSync(source: DetectionSource) {
    setSyncingId(source.id);
    setLastResult(null);
    try {
      const result = await syncDetectionSource(source.id);
      const kind = result.errors.length > 0 ? "error" : "ok";
      setLastResult({ ...result, name: source.name, kind });
      await load();
    } catch (err) {
      setLastResult({
        source_id: source.id,
        commit_sha: null,
        created: 0,
        updated: 0,
        proposals: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : "Sync failed"],
        name: source.name,
        kind: "error",
      });
    } finally {
      setSyncingId(null);
    }
  }

  async function handleDelete(source: DetectionSource) {
    const ok = window.confirm(
      `Delete "${source.name}"? Detections that were synced from this source will remain, but will no longer be kept in sync with the repo.`,
    );
    if (!ok) return;
    setDeletingId(source.id);
    try {
      await deleteDetectionSource(source.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      {error ? (
        <SettingsBanner tone="danger" title="Couldn't load sources">
          {error}
        </SettingsBanner>
      ) : lastResult ? (
        <SettingsBanner
          tone={lastResult.kind === "ok" ? "success" : "warning"}
          title={
            <>
              {lastResult.kind === "ok" ? "Sync complete" : "Sync reported issues"}
              <span className="ml-2 font-normal text-[var(--surface-subtle-foreground)]">
                {lastResult.name}
              </span>
            </>
          }
        >
          <p>
            Created {lastResult.created}, updated {lastResult.updated},{" "}
            {lastResult.proposals} proposal
            {lastResult.proposals === 1 ? "" : "s"} opened, {lastResult.skipped} unchanged.
          </p>
          {lastResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {lastResult.errors.slice(0, 5).map((e, i) => (
                <li key={i} className="font-mono">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </SettingsBanner>
      ) : null}

      <SettingsSection
        title="Connected sources"
        description="Each source maps a git repository + branch + path to a detection set."
        stacked
      >
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add source
          </Button>
        </div>
        <div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--surface-subtle-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading sources…
            </div>
          ) : sources.length === 0 ? (
            <div className="py-12 text-center">
              <FileCode2 className="mx-auto h-10 w-10 text-[var(--surface-subtle-foreground)]" />
              <h3 className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                No sources yet
              </h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-[var(--surface-subtle-foreground)]">
                Connect a git repository to sync detection rules into PurveX.
                You can export any existing detection as YAML using the
                &ldquo;Export as YAML&rdquo; button on the detection detail page.
              </p>
              <Button className="mt-4" onClick={() => setAddOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Add your first source
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--stroke-soft)]">
              {sources.map((s) => (
                <li key={s.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">
                        {s.name}
                      </h3>
                      {!s.enabled && (
                        <span className="rounded-full border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                          Disabled
                        </span>
                      )}
                      {s.auth_type === "token" && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                          <KeyRound className="h-2.5 w-2.5" /> Token
                        </span>
                      )}
                    </div>
                    <p className="truncate font-mono text-xs text-[var(--surface-subtle-foreground)]">
                      {s.repo_url}
                    </p>
                    <p className="text-xs text-[var(--surface-subtle-foreground)]">
                      branch <span className="font-mono">{s.branch}</span>
                      {" · "}
                      path <span className="font-mono">{s.path_glob}</span>
                    </p>
                    <SyncStatusLine source={s} />
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleSync(s)}
                      disabled={syncingId === s.id || !s.enabled}
                    >
                      {syncingId === s.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Sync now
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => handleDelete(s)}
                      disabled={deletingId === s.id}
                      className="text-rose-300 hover:text-rose-200"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SettingsSection>

      <AddSourceDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) load();
        }}
      />
    </>
  );
}

function SyncStatusLine({ source }: { source: DetectionSource }) {
  if (!source.last_synced_at) {
    return (
      <p className="text-xs text-[var(--surface-subtle-foreground)]">
        Never synced.
      </p>
    );
  }
  const isError = source.last_sync_status === "error";
  const Icon = isError ? AlertTriangle : CheckCircle2;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
          isError
            ? "border border-rose-500/40 bg-rose-500/10 text-rose-200"
            : "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
        )}
      >
        <Icon className="h-3 w-3" />
        {isError ? "Last sync failed" : "Last sync OK"}
      </span>
      <span className="text-[var(--surface-subtle-foreground)]">
        {new Date(source.last_synced_at).toLocaleString()}
        {source.last_commit_sha
          ? ` · ${source.last_commit_sha.slice(0, 7)}`
          : ""}
      </span>
      {!isError && (
        <span className="text-[var(--surface-subtle-foreground)]">
          · created {source.last_created_count}, updated{" "}
          {source.last_updated_count}, proposals {source.last_proposals_count},{" "}
          skipped {source.last_skipped_count}
        </span>
      )}
      {isError && source.last_sync_error && (
        <span className="font-mono text-[11px] text-rose-300">
          {source.last_sync_error}
        </span>
      )}
    </div>
  );
}

interface AddSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AddSourceDialog({ open, onOpenChange }: AddSourceDialogProps) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [pathGlob, setPathGlob] = useState("detections/**/*.yml");
  const [authType, setAuthType] = useState<DetectionSourceAuthType>("none");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setName("");
    setRepoUrl("");
    setBranch("main");
    setPathGlob("detections/**/*.yml");
    setAuthType("none");
    setToken("");
    setErr(null);
  }

  async function submit() {
    setErr(null);
    if (!name.trim() || !repoUrl.trim()) {
      setErr("Name and repo URL are required.");
      return;
    }
    if (!/^https?:\/\//i.test(repoUrl)) {
      setErr("Repo URL must start with http:// or https://");
      return;
    }
    if (authType === "token" && !token.trim()) {
      setErr("Access token is required for token-auth sources.");
      return;
    }
    setBusy(true);
    try {
      await createDetectionSource({
        name: name.trim(),
        repo_url: repoUrl.trim(),
        branch: branch.trim() || "main",
        path_glob: pathGlob.trim() || "detections/**/*.yml",
        auth_type: authType,
        auth_secret: authType === "token" ? token : null,
      });
      reset();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create source");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="w-[min(calc(100vw-2rem),28rem)]">
        <DialogHeader>
          <DialogTitle>Add detection source</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label htmlFor="ds-name">Name</Label>
              <Input
                id="ds-name"
                placeholder="Production detections"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="ds-url">Repository URL</Label>
              <Input
                id="ds-url"
                placeholder="https://github.com/example/detections.git"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">
                HTTPS only in V1. SSH + deploy keys are on the roadmap.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ds-branch">Branch</Label>
                <Input
                  id="ds-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="ds-path">Path glob</Label>
                <Input
                  id="ds-path"
                  value={pathGlob}
                  onChange={(e) => setPathGlob(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="ds-auth">Authentication</Label>
              <select
                id="ds-auth"
                value={authType}
                onChange={(e) =>
                  setAuthType(e.target.value as DetectionSourceAuthType)
                }
                className="flex h-10 w-full items-center rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]/40"
              >
                <option value="none">None (public repo)</option>
                <option value="token">Personal access token</option>
              </select>
            </div>
            {authType === "token" && (
              <div>
                <Label htmlFor="ds-token">Access token</Label>
                <Input
                  id="ds-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_..."
                />
                <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">
                  Encrypted at rest. Used as the HTTPS password with
                  username <span className="font-mono">x-access-token</span>.
                </p>
              </div>
            )}
          </div>

          {err && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
              {err}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save source
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
