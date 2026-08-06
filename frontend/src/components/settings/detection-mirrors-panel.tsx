"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GitCommitHorizontal,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Link2,
  Link2Off,
  Upload,
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
import { UpgradeBanner, isUpgradeRequiredError } from "@/components/ui/upgrade-banner";
import {
  listDetectionMirrors,
  createDetectionMirror,
  deleteDetectionMirror,
  linkMirrorToSiem,
  unlinkMirrorFromSiem,
  bootstrapMirror,
  getSiemConnections,
  type DetectionGitMirror,
  type DetectionMirrorAuthType,
  type DetectionMirrorWriteMode,
  type DetectionMirrorPublishResult,
  type SIEMConnection,
} from "@/lib/api";

/**
 * Export panel of the Detection-as-Code settings page.
 *
 * A one-way *write* target for SIEM-owned detections. Every time PurveX
 * syncs detection rules from a linked SIEM, the service serializes the
 * affected rules as YAML and commits them here — so compliance teams get
 * a full git-native change log for rules PurveX doesn't own.
 *
 * How it differs from the Import panel (Detection Sources)
 * ----------------------------------------------------------
 * * Import: PurveX *reads* detection YAML from git and creates/updates
 *   Detections in the product.
 * * Export (this panel): PurveX *writes* SIEM-synced detection YAML to
 *   git for audit. Never reads back.
 */
export function DetectionMirrorsPanel({
  onStatusChange,
}: {
  onStatusChange?: (count: number) => void;
}) {
  const [mirrors, setMirrors] = useState<DetectionGitMirror[]>([]);
  const [siems, setSiems] = useState<SIEMConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [lastPublish, setLastPublish] = useState<
    | (DetectionMirrorPublishResult & { name: string; kind: "ok" | "error" })
    | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, conns] = await Promise.all([
        listDetectionMirrors(),
        getSiemConnections(),
      ]);
      setMirrors(rows);
      setSiems(Array.isArray(conns) ? (conns as SIEMConnection[]) : []);
      onStatusChange?.(rows.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mirrors");
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(mirror: DetectionGitMirror) {
    const ok = window.confirm(
      `Delete mirror "${mirror.name}"? SIEM connections pointing at this mirror will be unlinked; the repo itself is not touched.`,
    );
    if (!ok) return;
    setDeletingId(mirror.id);
    try {
      await deleteDetectionMirror(mirror.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleLink(mirror: DetectionGitMirror, siemId: number) {
    try {
      await linkMirrorToSiem(mirror.id, siemId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Link failed");
    }
  }

  async function handleUnlink(mirror: DetectionGitMirror, siemId: number) {
    try {
      await unlinkMirrorFromSiem(mirror.id, siemId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlink failed");
    }
  }

  async function handleBootstrap(
    mirror: DetectionGitMirror,
    siemId: number,
  ) {
    setLastPublish(null);
    try {
      const result = await bootstrapMirror(mirror.id, siemId);
      const kind = result.errors.length > 0 ? "error" : "ok";
      setLastPublish({ ...result, name: mirror.name, kind });
      await load();
    } catch (err) {
      setLastPublish({
        mirror_id: mirror.id,
        commit_sha: null,
        files_written: 0,
        commits: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : "Bootstrap failed"],
        name: mirror.name,
        kind: "error",
      });
    }
  }

  return (
    <>
      {error ? (
        <SettingsBanner tone="danger" title="Couldn't load mirrors">
          {error}
        </SettingsBanner>
      ) : lastPublish ? (
        <SettingsBanner
          tone={lastPublish.kind === "ok" ? "success" : "warning"}
          title={
            <>
              {lastPublish.kind === "ok"
                ? "Bootstrap complete"
                : "Bootstrap reported issues"}
              <span className="ml-2 font-normal text-[var(--surface-subtle-foreground)]">
                {lastPublish.name}
              </span>
            </>
          }
        >
          <p>
            Wrote {lastPublish.files_written} file
            {lastPublish.files_written === 1 ? "" : "s"} in {lastPublish.commits} commit
            {lastPublish.commits === 1 ? "" : "s"}.
            {lastPublish.commit_sha
              ? ` HEAD ${lastPublish.commit_sha.slice(0, 7)}.`
              : ""}
          </p>
          {lastPublish.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs">
              {lastPublish.errors.slice(0, 5).map((e, i) => (
                <li key={i} className="font-mono">
                  {e}
                </li>
              ))}
            </ul>
          )}
        </SettingsBanner>
      ) : null}

      <SettingsSection
        title="Connected mirrors"
        description="One mirror per repository — link it to SIEM connections to bootstrap and keep them in sync."
        stacked
      >
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add mirror
          </Button>
        </div>
        <div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--surface-subtle-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading mirrors…
            </div>
          ) : mirrors.length === 0 ? (
            <div className="py-12 text-center">
              <GitCommitHorizontal className="mx-auto h-10 w-10 text-[var(--surface-subtle-foreground)]" />
              <h3 className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                No audit mirrors yet
              </h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-[var(--surface-subtle-foreground)]">
                Connect a git repository to mirror your SIEM-owned
                detections for audit. Changes in the SIEM will be committed
                here automatically the next time PurveX syncs.
              </p>
              <Button className="mt-4" onClick={() => setAddOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Add your first mirror
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--stroke-soft)]">
              {mirrors.map((m) => (
                <MirrorRow
                  key={m.id}
                  mirror={m}
                  siems={siems}
                  deleting={deletingId === m.id}
                  onDelete={() => handleDelete(m)}
                  onLink={(siemId) => handleLink(m, siemId)}
                  onUnlink={(siemId) => handleUnlink(m, siemId)}
                  onBootstrap={(siemId) => handleBootstrap(m, siemId)}
                />
              ))}
            </ul>
          )}
        </div>
      </SettingsSection>

      <AddMirrorDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) load();
        }}
      />
    </>
  );
}

interface MirrorRowProps {
  mirror: DetectionGitMirror;
  siems: SIEMConnection[];
  deleting: boolean;
  onDelete: () => void;
  onLink: (siemId: number) => void;
  onUnlink: (siemId: number) => void;
  onBootstrap: (siemId: number) => void;
}

function MirrorRow({
  mirror,
  siems,
  deleting,
  onDelete,
  onLink,
  onUnlink,
  onBootstrap,
}: MirrorRowProps) {
  // Which SIEMs are currently linked to this mirror.
  const linkedSiems = useMemo(
    () =>
      siems.filter(
        (s) =>
          s.audit_mirror_id === mirror.id && s.audit_mirror_enabled === true,
      ),
    [siems, mirror.id],
  );
  const unlinkedSiems = useMemo(
    () =>
      siems.filter(
        (s) =>
          !(
            s.audit_mirror_id === mirror.id && s.audit_mirror_enabled === true
          ),
      ),
    [siems, mirror.id],
  );

  const [linkChoice, setLinkChoice] = useState<string>("");
  const [bootstrapChoice, setBootstrapChoice] = useState<string>("");

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-[var(--foreground)]">
              {mirror.name}
            </h3>
            {!mirror.enabled && (
              <span className="rounded-full border border-slate-500/40 bg-slate-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                Disabled
              </span>
            )}
            <span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-200">
              {mirror.write_mode}
            </span>
            {mirror.auth_type === "token" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-200">
                <KeyRound className="h-2.5 w-2.5" /> Token
              </span>
            )}
          </div>
          <p className="truncate font-mono text-xs text-[var(--surface-subtle-foreground)]">
            {mirror.repo_url}
          </p>
          <p className="text-xs text-[var(--surface-subtle-foreground)]">
            branch <span className="font-mono">{mirror.branch}</span>
            {" · "}
            path <span className="font-mono">{mirror.path_template}</span>
          </p>
          <p className="text-xs text-[var(--surface-subtle-foreground)]">
            Author{" "}
            <span className="font-mono">
              {mirror.commit_author_name} &lt;{mirror.commit_author_email}&gt;
            </span>
          </p>
          <MirrorStatusLine mirror={mirror} />
        </div>
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={onDelete}
            disabled={deleting}
            className="text-rose-300 hover:text-rose-200"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-3 text-xs">
        <p className="font-semibold text-[var(--foreground)]">
          Linked SIEM connections
        </p>
        <p className="mt-0.5 text-[var(--surface-subtle-foreground)]">
          Every detection sync on a linked SIEM auto-pushes one commit to
          this mirror.
        </p>
        {linkedSiems.length === 0 ? (
          <p className="mt-2 text-[var(--surface-subtle-foreground)]">
            No SIEM connections are linked.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {linkedSiems.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate">
                  <span className="font-mono">{s.siem_type}</span>
                  {" · "}
                  {s.name}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => onUnlink(Number(s.id))}
                  className="h-7 px-2 text-[11px]"
                >
                  <Link2Off className="mr-1 h-3 w-3" /> Unlink
                </Button>
              </li>
            ))}
          </ul>
        )}

        {unlinkedSiems.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={linkChoice}
              onChange={(e) => setLinkChoice(e.target.value)}
              className="flex h-8 rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2 text-xs text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]/40"
            >
              <option value="">Choose SIEM to link…</option>
              {unlinkedSiems.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.siem_type} · {s.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!linkChoice}
              onClick={() => {
                if (!linkChoice) return;
                onLink(Number(linkChoice));
                setLinkChoice("");
              }}
              className="h-8 text-xs"
            >
              <Link2 className="mr-1 h-3 w-3" /> Link
            </Button>
          </div>
        )}

        {linkedSiems.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={bootstrapChoice}
              onChange={(e) => setBootstrapChoice(e.target.value)}
              className="flex h-8 rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2 text-xs text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]/40"
            >
              <option value="">Choose SIEM to bootstrap…</option>
              {linkedSiems.map((s) => (
                <option key={String(s.id)} value={String(s.id)}>
                  {s.siem_type} · {s.name}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              disabled={!bootstrapChoice}
              onClick={() => {
                if (!bootstrapChoice) return;
                onBootstrap(Number(bootstrapChoice));
                setBootstrapChoice("");
              }}
              className="h-8 text-xs"
            >
              <Upload className="mr-1 h-3 w-3" /> Bootstrap
            </Button>
            <span className="text-[11px] text-[var(--surface-subtle-foreground)]">
              One-time full export of every current SIEM-synced rule as YAML.
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

function MirrorStatusLine({ mirror }: { mirror: DetectionGitMirror }) {
  if (!mirror.last_mirrored_at) {
    return (
      <p className="text-xs text-[var(--surface-subtle-foreground)]">
        Never published.
      </p>
    );
  }
  const isError = mirror.last_mirror_status === "error";
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
        {isError ? "Last publish failed" : "Last publish OK"}
      </span>
      <span className="text-[var(--surface-subtle-foreground)]">
        {new Date(mirror.last_mirrored_at).toLocaleString()}
        {mirror.last_commit_sha
          ? ` · ${mirror.last_commit_sha.slice(0, 7)}`
          : ""}
      </span>
      {!isError && (
        <span className="text-[var(--surface-subtle-foreground)]">
          · {mirror.last_commits_count} commit
          {mirror.last_commits_count === 1 ? "" : "s"},{" "}
          {mirror.last_files_written} file
          {mirror.last_files_written === 1 ? "" : "s"}
        </span>
      )}
      {isError && mirror.last_mirror_error && (
        <span className="font-mono text-[11px] text-rose-300">
          {mirror.last_mirror_error}
        </span>
      )}
    </div>
  );
}

interface AddMirrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AddMirrorDialog({ open, onOpenChange }: AddMirrorDialogProps) {
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [pathTemplate, setPathTemplate] = useState(
    "detections/{siem}/{technique_id}/{slug}.yml",
  );
  const [writeMode, setWriteMode] =
    useState<DetectionMirrorWriteMode>("direct");
  const [authorName, setAuthorName] = useState("PurveX Bot");
  const [authorEmail, setAuthorEmail] = useState("purvex-bot@purvex.local");
  const [authType, setAuthType] = useState<DetectionMirrorAuthType>("none");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errIsUpgrade, setErrIsUpgrade] = useState(false);

  function reset() {
    setName("");
    setRepoUrl("");
    setBranch("main");
    setPathTemplate("detections/{siem}/{technique_id}/{slug}.yml");
    setWriteMode("direct");
    setAuthorName("PurveX Bot");
    setAuthorEmail("purvex-bot@purvex.local");
    setAuthType("none");
    setToken("");
    setErr(null);
    setErrIsUpgrade(false);
  }

  async function submit() {
    setErr(null);
    setErrIsUpgrade(false);
    if (!name.trim() || !repoUrl.trim()) {
      setErr("Name and repo URL are required.");
      return;
    }
    if (!/^https?:\/\//i.test(repoUrl)) {
      setErr("Repo URL must start with http:// or https://");
      return;
    }
    if (authType === "token" && !token.trim()) {
      setErr("Access token is required for token-auth mirrors.");
      return;
    }
    setBusy(true);
    try {
      await createDetectionMirror({
        name: name.trim(),
        repo_url: repoUrl.trim(),
        branch: branch.trim() || "main",
        path_template:
          pathTemplate.trim() ||
          "detections/{siem}/{technique_id}/{slug}.yml",
        commit_author_name: authorName.trim() || "PurveX Bot",
        commit_author_email:
          authorEmail.trim() || "purvex-bot@purvex.local",
        write_mode: writeMode,
        auth_type: authType,
        auth_secret: authType === "token" ? token : null,
      });
      reset();
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create mirror");
      setErrIsUpgrade(isUpgradeRequiredError(e));
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
      <DialogContent className="w-[min(calc(100vw-2rem),32rem)]">
        <DialogHeader>
          <DialogTitle>Add audit mirror</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            <div>
              <Label htmlFor="dm-name">Name</Label>
              <Input
                id="dm-name"
                placeholder="Production SIEM audit log"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="dm-url">Repository URL</Label>
              <Input
                id="dm-url"
                placeholder="https://github.com/example/detections-audit.git"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">
                HTTPS only. Needs write access — use a token scoped to this
                repo only.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="dm-branch">Branch</Label>
                <Input
                  id="dm-branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="dm-write-mode">Write mode</Label>
                <select
                  id="dm-write-mode"
                  value={writeMode}
                  onChange={(e) =>
                    setWriteMode(e.target.value as DetectionMirrorWriteMode)
                  }
                  className="flex h-10 w-full items-center rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]/40"
                >
                  <option value="direct">Direct to branch</option>
                  <option value="branch">Timestamped audit branch</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="dm-path">Path template</Label>
              <Input
                id="dm-path"
                value={pathTemplate}
                onChange={(e) => setPathTemplate(e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">
                Tokens: <span className="font-mono">{"{siem}"}</span>,{" "}
                <span className="font-mono">{"{technique_id}"}</span>,{" "}
                <span className="font-mono">{"{external_id}"}</span>,{" "}
                <span className="font-mono">{"{slug}"}</span>. All tokens are
                slug-safe.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="dm-author-name">Commit author name</Label>
                <Input
                  id="dm-author-name"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="dm-author-email">Commit author email</Label>
                <Input
                  id="dm-author-email"
                  value={authorEmail}
                  onChange={(e) => setAuthorEmail(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="dm-auth">Authentication</Label>
              <select
                id="dm-auth"
                value={authType}
                onChange={(e) =>
                  setAuthType(e.target.value as DetectionMirrorAuthType)
                }
                className="flex h-10 w-full items-center rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)]/40"
              >
                <option value="none">None (public repo)</option>
                <option value="token">Personal access token</option>
              </select>
            </div>
            {authType === "token" && (
              <div>
                <Label htmlFor="dm-token">Access token</Label>
                <Input
                  id="dm-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="ghp_..."
                />
                <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">
                  Encrypted at rest. Used as the HTTPS password with username{" "}
                  <span className="font-mono">x-access-token</span>. Needs
                  repo <span className="font-mono">write</span> scope.
                </p>
              </div>
            )}
          </div>

          {err && errIsUpgrade ? (
            <UpgradeBanner message={err} />
          ) : err ? (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
              {err}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add mirror
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
