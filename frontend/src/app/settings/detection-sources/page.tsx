"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GitBranch, Upload } from "lucide-react";
import {
  SettingsPageShell,
  SettingsStatusPill,
} from "@/components/settings/settings-section";
import { cn } from "@/lib/utils";
import { DetectionSourcesPanel } from "@/components/settings/detection-sources-panel";
import { DetectionMirrorsPanel } from "@/components/settings/detection-mirrors-panel";

type Tab = "import" | "export";

/**
 * Detection-as-Code settings.
 *
 * Two directions, one page:
 * - Import (Detection Sources): PurveX reads detection YAML from git and
 *   creates/updates Detections in the product.
 * - Export (Audit Mirrors): PurveX writes SIEM-synced detection YAML to
 *   git for audit — one commit per upstream change, never read back.
 *
 * Previously these were two separate, unlinked settings pages. Merged so
 * the git-based workflows live in one discoverable place.
 */
function DetectionAsCodeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab: Tab = searchParams?.get("tab") === "export" ? "export" : "import";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [sourceCount, setSourceCount] = useState<number | null>(null);
  const [mirrorCount, setMirrorCount] = useState<number | null>(null);

  function setActiveTab(next: Tab) {
    setTab(next);
    router.replace(`/settings/detection-sources${next === "export" ? "?tab=export" : ""}`, {
      scroll: false,
    });
  }

  const isImport = tab === "import";
  const count = isImport ? sourceCount : mirrorCount;

  return (
    <SettingsPageShell
      eyebrow="Detection-as-Code"
      title="Detection Sources"
      description={
        isImport
          ? "Wire a git repository up as the source of truth for your detection rules. Sync brings new rules in as drafts and routes conflicts through the Detections proposal queue."
          : "Mirror SIEM-owned detections into a git repository. Every upstream rule change becomes one commit — auditable, diffable, reviewable."
      }
      width="wide"
      status={
        count !== null ? (
          <SettingsStatusPill tone={count > 0 ? "ok" : "muted"}>
            {count > 0
              ? `${count} ${isImport ? "source" : "mirror"}${count === 1 ? "" : "s"}`
              : "Not configured"}
          </SettingsStatusPill>
        ) : undefined
      }
      divided={false}
    >
      <div className="mb-6 inline-flex items-center gap-1 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-subtle)] p-1">
        <button
          type="button"
          onClick={() => setActiveTab("import")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            isImport
              ? "bg-[var(--surface-card)] text-[var(--surface-card-foreground)] shadow-sm"
              : "text-[var(--surface-subtle-foreground)] hover:text-[var(--surface-card-foreground)]",
          )}
        >
          <GitBranch className="h-3.5 w-3.5" /> Import
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("export")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            !isImport
              ? "bg-[var(--surface-card)] text-[var(--surface-card-foreground)] shadow-sm"
              : "text-[var(--surface-subtle-foreground)] hover:text-[var(--surface-card-foreground)]",
          )}
        >
          <Upload className="h-3.5 w-3.5" /> Export / Audit
        </button>
      </div>

      {isImport ? (
        <DetectionSourcesPanel onStatusChange={setSourceCount} />
      ) : (
        <DetectionMirrorsPanel onStatusChange={setMirrorCount} />
      )}
    </SettingsPageShell>
  );
}

export default function DetectionAsCodePage() {
  return (
    <Suspense fallback={null}>
      <DetectionAsCodeContent />
    </Suspense>
  );
}
