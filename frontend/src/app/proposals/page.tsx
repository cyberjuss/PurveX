"use client";

/**
 * /proposals — AI remediation guardrail inbox.
 *
 * Shows pending AI (and human) proposals awaiting approval, with a
 * before/after diff sheet for review. Approving the proposal patches
 * the underlying Detection via ``POST /proposals/{id}/approve`` and
 * writes an AuditEvent. Rejecting preserves the reviewer note for the
 * AI to learn from.
 *
 * V1 scope: update proposals are the main path (what the AI produces).
 * Create/delete proposals are shown in the list but don't have a
 * polished apply UI — they're the Sprint 3 DaC lane.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Clock3,
  FileEdit,
  GitBranch,
  Inbox,
  Info,
  Trash2,
  User2,
  X,
} from "lucide-react";

import {
  approveProposal,
  getProposalStats,
  listProposals,
  rejectProposal,
  type DetectionProposal,
  type DetectionProposalDiffEntry,
  type DetectionProposalStats,
  type ProposalStatus,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { PageSkeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/ui/form-error";

type TabKey = "pending" | "applied" | "rejected" | "all";

const TAB_CONFIG: { key: TabKey; label: string; status?: ProposalStatus }[] = [
  { key: "pending", label: "Pending", status: "pending" },
  { key: "applied", label: "Applied", status: "applied" },
  { key: "rejected", label: "Rejected", status: "rejected" },
  { key: "all", label: "All" },
];

const KIND_META: Record<
  DetectionProposal["proposed_by_kind"],
  { label: string; icon: typeof Bot }
> = {
  ai: { label: "AI", icon: Bot },
  user: { label: "User", icon: User2 },
  git: { label: "Git", icon: GitBranch },
};

const ACTION_META: Record<
  DetectionProposal["action"],
  { label: string; icon: typeof FileEdit; tone: string }
> = {
  create: { label: "Create", icon: FileEdit, tone: "text-emerald-400" },
  update: { label: "Update", icon: FileEdit, tone: "text-[var(--accent-strong)]" },
  delete: { label: "Delete", icon: Trash2, tone: "text-rose-400" },
};

const STATUS_BADGE: Record<ProposalStatus, string> = {
  pending:
    "border-amber-500/30 bg-amber-500/10 text-amber-300",
  approved:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  applied:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  rejected:
    "border-rose-500/30 bg-rose-500/10 text-rose-300",
  superseded:
    "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

function formatRelative(iso: string): string {
  const when = new Date(iso);
  const now = Date.now();
  const delta = Math.max(0, now - when.getTime());
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function DiffRow({ entry }: { entry: DetectionProposalDiffEntry }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3",
        !entry.changed && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between text-xs uppercase tracking-wide">
        <span className="font-mono text-[var(--accent-strong)]">
          {entry.field}
        </span>
        {entry.changed ? (
          <span className="text-amber-400">Changed</span>
        ) : (
          <span className="text-[var(--surface-subtle-foreground)]">Unchanged</span>
        )}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
            Before
          </p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-2 text-xs text-[var(--foreground)]">
            {renderValue(entry.before)}
          </pre>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
            After
          </p>
          <pre
            className={cn(
              "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2 text-xs",
              entry.changed
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                : "border-[var(--stroke-soft)] bg-[var(--surface-card)] text-[var(--foreground)]",
            )}
          >
            {renderValue(entry.after)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default function ProposalsPage() {
  const [tab, setTab] = useState<TabKey>("pending");
  const [proposals, setProposals] = useState<DetectionProposal[]>([]);
  const [stats, setStats] = useState<DetectionProposalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<DetectionProposal | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const statusFilter = TAB_CONFIG.find((t) => t.key === tab)?.status;

  const refresh = useCallback(async () => {
    setListError(null);
    try {
      const [rows, s] = await Promise.all([
        listProposals({ status: statusFilter }),
        getProposalStats().catch(() => null),
      ]);
      setProposals(rows);
      if (s) setStats(s);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Failed to load proposals.",
      );
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  const pendingCount = stats?.pending ?? 0;

  const tabCounts = useMemo<Record<TabKey, number>>(() => {
    return {
      pending: stats?.pending ?? 0,
      applied: stats?.applied ?? 0,
      rejected: stats?.rejected ?? 0,
      all:
        (stats?.pending ?? 0) +
        (stats?.applied ?? 0) +
        (stats?.rejected ?? 0) +
        (stats?.approved ?? 0) +
        (stats?.superseded ?? 0),
    };
  }, [stats]);

  async function handleReview(kind: "approve" | "reject") {
    if (!selected) return;
    setReviewError(null);
    setSubmitting(kind);
    try {
      const fn = kind === "approve" ? approveProposal : rejectProposal;
      const updated = await fn(selected.id, note.trim() || undefined);
      setSelected(updated);
      setNote("");
      await refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `Failed to ${kind} proposal.`;
      setReviewError(message);
    } finally {
      setSubmitting(null);
    }
  }

  if (loading && proposals.length === 0) {
    return <PageSkeleton stats={3} withActions variant="cards" rows={6} />;
  }

  return (
    <PageContainer maxWidth="lg">
      <PageHeader
        eyebrow="Guardrails"
        title="Remediation proposals"
        subtitle="Every AI-suggested change lands here first. Approve to apply, reject to dismiss with feedback."
        icon={<Inbox className="h-6 w-6" />}
        actions={
          pendingCount > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 text-amber-300"
            >
              {pendingCount} pending
            </Badge>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-2">
        {TAB_CONFIG.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition",
                active
                  ? "border-[var(--accent-line)] bg-[var(--accent-strong)]/10 text-[var(--accent-strong)]"
                  : "border-[var(--stroke-soft)] bg-[var(--surface-card)] text-[var(--surface-subtle-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              {t.label}
              <span className="ml-2 text-[10px] opacity-70">
                {tabCounts[t.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {listError ? (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex items-center gap-2 text-sm text-rose-300">
            <AlertTriangle className="h-4 w-4" />
            {listError}
          </CardContent>
        </Card>
      ) : null}

      {proposals.length === 0 && !listError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="h-8 w-8 text-[var(--surface-subtle-foreground)]" />
            <p className="text-sm text-[var(--surface-subtle-foreground)]">
              Nothing here right now. AI-suggested changes to detections will
              appear here for review.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {proposals.map((p) => {
          const KindIcon = KIND_META[p.proposed_by_kind]?.icon ?? Bot;
          const ActionIcon = ACTION_META[p.action]?.icon ?? FileEdit;
          const changedFields = p.diff.filter((d) => d.changed).length;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelected(p);
                setNote("");
                setReviewError(null);
              }}
              className="w-full text-left"
            >
              <Card className="transition hover:border-[var(--accent-line)] hover:shadow-[var(--shadow-soft)]">
                <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--stroke-soft)] px-2 py-0.5">
                        <KindIcon className="h-3 w-3" />
                        {p.proposed_by_label}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border border-[var(--stroke-soft)] px-2 py-0.5",
                          ACTION_META[p.action]?.tone,
                        )}
                      >
                        <ActionIcon className="h-3 w-3" />
                        {ACTION_META[p.action]?.label ?? p.action}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 capitalize",
                          STATUS_BADGE[p.status],
                        )}
                      >
                        {p.status}
                      </span>
                      {p.stale ? (
                        <Chip tone="warning">
                          <AlertTriangle className="h-3 w-3" /> stale
                        </Chip>
                      ) : null}
                      <span className="inline-flex items-center gap-1 text-[var(--surface-subtle-foreground)]">
                        <Clock3 className="h-3 w-3" />
                        {formatRelative(p.created_at)}
                      </span>
                    </div>
                    <div className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {p.detection_title ?? p.detection_id ?? "(new detection)"}
                    </div>
                    {p.reason ? (
                      <p className="line-clamp-2 text-xs text-[var(--surface-subtle-foreground)]">
                        {p.reason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-3 whitespace-nowrap text-xs text-[var(--surface-subtle-foreground)]">
                    <span>
                      {changedFields} field{changedFields === 1 ? "" : "s"}
                    </span>
                    <span className="rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-2 py-1 font-semibold text-[var(--foreground)]">
                      Review →
                    </span>
                  </div>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setNote("");
            setReviewError(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="!bg-[var(--surface-card)] !text-[var(--foreground)] !border-[var(--stroke-soft)]"
          style={{ width: "50vw", maxWidth: "760px", minWidth: "480px" }}
        >
          {selected ? (
            <>
              <SheetHeader className="border-[var(--stroke-soft)]">
                <SheetTitle className="!text-[var(--foreground)]">
                  {selected.detection_title ??
                    selected.detection_id ??
                    "Proposal detail"}
                </SheetTitle>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 capitalize",
                      STATUS_BADGE[selected.status],
                    )}
                  >
                    {selected.status}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--stroke-soft)] px-2 py-0.5 text-[var(--surface-subtle-foreground)]">
                    {selected.proposed_by_label}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-[var(--stroke-soft)] px-2 py-0.5 text-[var(--surface-subtle-foreground)]">
                    {ACTION_META[selected.action]?.label ?? selected.action}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[var(--surface-subtle-foreground)]">
                    {formatRelative(selected.created_at)}
                  </span>
                </div>
              </SheetHeader>

              <SheetBody>
                {selected.stale ? (
                  <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      The detection has changed since this proposal was filed.
                      Approving will mark it superseded; the AI should re-propose
                      against the current state.
                    </span>
                  </div>
                ) : null}

                {selected.reason ? (
                  <div className="mb-4 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                      Rationale
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                      {selected.reason}
                    </p>
                  </div>
                ) : null}

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                    Field-level diff
                  </p>
                  {selected.diff.length === 0 ? (
                    <div className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--surface-subtle-foreground)]">
                      <Info className="mr-2 inline h-3 w-3" />
                      No field-level diff available for this action.
                    </div>
                  ) : (
                    selected.diff.map((entry) => (
                      <DiffRow key={entry.field} entry={entry} />
                    ))
                  )}
                </div>

                {selected.status === "pending" ? (
                  <div className="mt-6 space-y-2">
                    <p className="text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                      Reviewer note (optional)
                    </p>
                    <Textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Why approve or reject? (Especially useful on rejects so the AI has signal to learn from.)"
                      rows={3}
                      maxLength={4000}
                      className="bg-[var(--surface-elevated)] text-[var(--foreground)]"
                    />
                    <FormError message={reviewError} />
                  </div>
                ) : selected.review_note ? (
                  <div className="mt-6 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
                      Reviewer note
                      {selected.reviewed_by_label
                        ? ` · ${selected.reviewed_by_label}`
                        : ""}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                      {selected.review_note}
                    </p>
                  </div>
                ) : null}
              </SheetBody>

              <SheetFooter
                className="border-[var(--stroke-soft)] bg-[var(--surface-elevated)]"
              >
                {selected.status === "pending" ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={submitting !== null}
                      onClick={() => void handleReview("reject")}
                    >
                      <X className="mr-1 h-4 w-4" />
                      {submitting === "reject" ? "Rejecting…" : "Reject"}
                    </Button>
                    <Button
                      disabled={submitting !== null || selected.stale}
                      onClick={() => void handleReview("approve")}
                    >
                      <Check className="mr-1 h-4 w-4" />
                      {submitting === "approve" ? "Applying…" : "Approve & apply"}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelected(null);
                      setNote("");
                    }}
                  >
                    Close
                  </Button>
                )}
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}
