"use client";

import { useState } from "react";
import { Download, Copy, Check, FileCode2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportDetectionYaml } from "@/lib/api";

interface Props {
  detectionId: string;
  detectionTitle?: string;
  variant?: "button" | "ghost";
  className?: string;
}

/**
 * Renders a button that opens a dialog with the detection rendered as YAML,
 * ready to drop into a Detection-as-Code repository. Clipboard copy and
 * file download are both supported; we stream the YAML from the server
 * (never cached client-side) so the dialog always reflects the current
 * detection state.
 */
export function ExportYamlButton({
  detectionId,
  detectionTitle,
  variant = "button",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [yaml, setYaml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function openDialog() {
    setOpen(true);
    if (yaml) return; // Already loaded; reuse until the sheet is re-mounted.
    setLoading(true);
    setError(null);
    try {
      const res = await exportDetectionYaml(detectionId);
      setYaml(res.yaml);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!yaml) return;
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API can fail under insecure contexts; user can still
      // select + Ctrl-C from the rendered text.
    }
  }

  function download() {
    if (!yaml) return;
    const safeTitle = (detectionTitle || detectionId)
      .replace(/[^a-z0-9_-]+/gi, "_")
      .slice(0, 64)
      .toLowerCase();
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle || "detection"}.yml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Button
        type="button"
        variant={variant === "ghost" ? "ghost" : "outline"}
        className={className}
        onClick={openDialog}
      >
        <FileCode2 className="mr-2 h-4 w-4" />
        Export as YAML
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(calc(100vw-2rem),40rem)]">
          <DialogHeader>
            <DialogTitle>Detection-as-Code export</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Commit this YAML into a Detection-as-Code repository. When a
              source is configured under{" "}
              <span className="font-mono text-xs">Settings → Detection Sources</span>,
              PurveX will keep the rule in sync and route changes through
              the proposal inbox.
            </p>

            {loading ? (
              <div className="h-48 animate-pulse rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)]" />
            ) : error ? (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
                {error}
              </div>
            ) : yaml ? (
              <pre className="max-h-[50vh] overflow-auto rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-xs leading-relaxed text-[var(--foreground)]">
                <code>{yaml}</code>
              </pre>
            ) : null}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={copy}
              disabled={!yaml}
            >
              {copied ? (
                <>
                  <Check className="mr-2 h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="mr-2 h-4 w-4" /> Copy
                </>
              )}
            </Button>
            <Button type="button" onClick={download} disabled={!yaml}>
              <Download className="mr-2 h-4 w-4" /> Download
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
