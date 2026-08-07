"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  FileEdit,
  GitBranch,
  Inbox,
  Info,
  RefreshCw,
  Search,
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
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FormError } from "@/components/ui/form-error";
import { Input } from "@/components/ui/input";
import { PageSkeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { Permission } from "@/lib/permissions";
import { toneClasses, type Tone } from "@/lib/status-tone";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | ProposalStatus;
type KindFilter = "all" | "ai" | "user" | "git";
type ActionFilter = "all" | "create" | "update" | "delete";

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "applied", label: "Applied" },
  { key: "rejected", label: "Rejected" },
  { key: "superseded", label: "Superseded" },
  { key: "all", label: "All" },
];

const KIND_META: Record<
  DetectionProposal["proposed_by_kind"],
  { label: string; icon: typeof Bot; tone: string }
> = {
  ai: { label: "AI", icon: Bot, tone: "text-sky-500" },
  user: { label: "User", icon: User2, tone: "text-violet-500" },
  git: { label: "Git", icon: GitBranch, tone: "text-emerald-500" },
};

const ACTION_META: Record<
  DetectionProposal["action"],
  { label: string; icon: typeof FileEdit; dot: string }
> = {
  create: { label: "create", icon: FileEdit, dot: "bg-emerald-500" },
  update: { label: "update", icon: FileEdit, dot: "bg-sky-500" },
  delete: { label: "delete", icon: Trash2, dot: "bg-rose-500" },
};

// Mirrors the backend's action-specific RBAC check on approve/reject
// (require_detection_create/update/delete) — see routers/proposals.py.
const ACTION_PERMISSION: Record<DetectionProposal["action"], Permission> = {
  create: Permission.DETECTIONS_CREATE,
  update: Permission.DETECTIONS_UPDATE,
  delete: Permission.DETECTIONS_DELETE,
};

const STATUS_CHIP_TONE: Record<ProposalStatus, Tone> = {
  pending: "warning",
  approved: "success",
  applied: "success",
  rejected: "danger",
  superseded: "muted",
};

function severityTone(proposal: DetectionProposal): Tone {
  if (proposal.status === "rejected") return "danger";
  if (proposal.status === "applied") return "success";
  if (proposal.status === "superseded") return "muted";
  if (proposal.stale) return "warning";
  if (proposal.action === "delete") return "danger";
  return "warning";
}

function formatRelative(iso: string): string {
  const when = new Date(iso);
  const delta = Math.max(0, Date.now() - when.getTime());
  const minutes = Math.round(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString();
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}...` : id;
}

function compactOriginLabel(proposal: DetectionProposal): string {
  return KIND_META[proposal.proposed_by_kind]?.label || proposal.proposed_by_kind;
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "--";
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
        !entry.changed && "opacity-65",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="console-label console-mono text-[var(--accent-strong)]">
          {entry.field}
        </span>
        <span
          className={cn(
            "console-pill",
            entry.changed
              ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300"
              : "text-[var(--surface-subtle-foreground)]",
          )}
        >
          {entry.changed ? "changed" : "unchanged"}
        </span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="console-label">Before</p>
          <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-3 text-[11px] text-[var(--foreground)]">
            {renderValue(entry.before)}
          </pre>
        </div>
        <div>
          <p className="console-label">After</p>
          <pre
            className={cn(
              "mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-[11px]",
              entry.changed
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
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

/**
 * Proposals panel — the "pending changes" view of Detections.
 *
 * A proposal is a suggested create/update/delete to a Detection, filed by
 * the AI assistant, a user, or a git sync. This used to be its own
 * top-level page (`/proposals`); it now lives as a tab inside Detections
 * since a proposal is a state a detection is in, not a peer concept.
 */
export function ProposalsPanel({
  onPendingCountChange,
}: {
  onPendingCountChange?: (count: number) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [staleOnly, setStaleOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [proposals, setProposals] = useState<DetectionProposal[]>([]);
  const [stats, setStats] = useState<DetectionProposalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<DetectionProposal | null>(null);
  const [note, setNote] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null,
  );

  const { hasPermission } = usePermissions();

  const refresh = useCallback(async () => {
    setListError(null);
    setRefreshing(true);
    try {
      const [rows, proposalStats] = await Promise.all([
        listProposals({
          status: statusFilter === "all" ? undefined : statusFilter,
        }),
        getProposalStats().catch(() => null),
      ]);
      setProposals(rows);
      if (proposalStats) {
        setStats(proposalStats);
        onPendingCountChange?.(proposalStats.pending ?? 0);
      }
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Failed to load proposals.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [statusFilter, onPendingCountChange]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const filteredProposals = useMemo(() => {
    const query = search.trim().toLowerCase();
    return proposals.filter((proposal) => {
      if (kindFilter !== "all" && proposal.proposed_by_kind !== kindFilter) {
        return false;
      }
      if (actionFilter !== "all" && proposal.action !== actionFilter) {
        return false;
      }
      if (staleOnly && !proposal.stale) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        proposal.detection_title ?? "",
        proposal.detection_id ?? "",
        proposal.proposed_by_label ?? "",
        proposal.reason ?? "",
        proposal.id,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [actionFilter, kindFilter, proposals, search, staleOnly]);

  const tabCounts = useMemo<Record<StatusFilter, number>>(() => {
    const value = stats ?? {
      pending: 0,
      approved: 0,
      applied: 0,
      rejected: 0,
      superseded: 0,
    };
    return {
      pending: value.pending ?? 0,
      approved: value.approved ?? 0,
      applied: value.applied ?? 0,
      rejected: value.rejected ?? 0,
      superseded: value.superseded ?? 0,
      all:
        (value.pending ?? 0) +
        (value.approved ?? 0) +
        (value.applied ?? 0) +
        (value.rejected ?? 0) +
        (value.superseded ?? 0),
    };
  }, [stats]);

  const kindCounts = useMemo<Record<KindFilter, number>>(() => {
    const counts: Record<KindFilter, number> = {
      all: proposals.length,
      ai: 0,
      user: 0,
      git: 0,
    };
    proposals.forEach((proposal) => {
      counts[proposal.proposed_by_kind] += 1;
    });
    return counts;
  }, [proposals]);

  const actionCounts = useMemo<Record<ActionFilter, number>>(() => {
    const counts: Record<ActionFilter, number> = {
      all: proposals.length,
      create: 0,
      update: 0,
      delete: 0,
    };
    proposals.forEach((proposal) => {
      counts[proposal.action] += 1;
    });
    return counts;
  }, [proposals]);

  const staleCount = useMemo(
    () => proposals.filter((proposal) => proposal.stale).length,
    [proposals],
  );

  async function handleReview(kind: "approve" | "reject") {
    if (!selected) return;
    setReviewError(null);
    setSubmitting(kind);
    try {
      const action = kind === "approve" ? approveProposal : rejectProposal;
      const updated = await action(selected.id, note.trim() || undefined);
      setSelected(updated);
      setNote("");
      await refresh();
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : `Failed to ${kind} proposal.`,
      );
    } finally {
      setSubmitting(null);
    }
  }

  if (loading && proposals.length === 0) {
    return <PageSkeleton stats={3} withActions variant="cards" rows={6} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search detection, author, rationale, or proposal id…"
            className="h-10 border-[var(--stroke-soft)] bg-[var(--surface-card)] pl-9"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-1">
          {STATUS_FILTERS.map((item) => {
            const active = statusFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition",
                  active
                    ? "bg-[var(--surface-card)] text-[var(--foreground)] shadow-sm"
                    : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400",
                )}
              >
                {item.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                    active
                      ? "bg-[var(--surface-elevated)] text-[var(--foreground)]"
                      : "bg-[var(--surface-card)] text-slate-400 dark:text-slate-500",
                  )}
                >
                  {tabCounts[item.key]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={staleOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setStaleOnly((value) => !value)}
          >
            Outdated{staleCount > 0 ? ` · ${staleCount}` : ""}
          </Button>
          <Button
            type="button"
            variant={filtersOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
          >
            Filters
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", filtersOpen && "rotate-180")} />
          </Button>
        </div>
      </div>

      {filtersOpen ? (
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-8">
          <FilterGroup
            label="Origin"
            options={[
              { key: "all", label: "Any" },
              { key: "ai", label: "AI" },
              { key: "user", label: "User" },
              { key: "git", label: "Git" },
            ]}
            active={kindFilter}
            onChange={(value) => setKindFilter(value as KindFilter)}
            counts={kindCounts}
          />
          <FilterGroup
            label="Mutation"
            options={[
              { key: "all", label: "Any" },
              { key: "create", label: "Create" },
              { key: "update", label: "Update" },
              { key: "delete", label: "Delete" },
            ]}
            active={actionFilter}
            onChange={(value) => setActionFilter(value as ActionFilter)}
            counts={actionCounts}
          />
        </div>
      ) : null}

      <div className="min-w-0">
          {listError ? (
            <div className="mx-4 mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-300">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{listError}</span>
              </div>
            </div>
          ) : null}

          {filteredProposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <Inbox className="h-8 w-8 text-[var(--surface-subtle-foreground)]" />
              <div>
                <p className="text-base font-semibold text-[var(--foreground)]">
                  No proposals match these filters.
                </p>
                <p className="mt-1 max-w-lg text-sm text-[var(--surface-subtle-foreground)]">
                  Clear filters or check back when new proposals are filed.
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="console-table text-sm">
                <thead>
                  <tr>
                    <th className="w-1.5 px-0 py-0" />
                    <th>Proposal</th>
                    <th>Detection</th>
                    <th>Origin</th>
                    <th>Status</th>
                    <th className="text-right">Delta</th>
                    <th className="text-right">Filed</th>
                    <th className="text-right">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProposals.map((proposal) => {
                    const kindMeta = KIND_META[proposal.proposed_by_kind];
                    const actionMeta = ACTION_META[proposal.action];
                    const changedFields = proposal.diff.filter(
                      (entry) => entry.changed,
                    ).length;
                    const isSelected = selected?.id === proposal.id;
                    const KindIcon = kindMeta.icon;
                    const ActionIcon = actionMeta.icon;
                    return (
                      <tr
                        key={proposal.id}
                        className={cn(isSelected && "bg-[var(--surface-subtle)]")}
                        onClick={() => {
                          setSelected(proposal);
                          setNote("");
                          setReviewError(null);
                        }}
                      >
                        <td className="p-0">
                          <span
                            className={cn(
                              "block h-full min-h-[76px] w-1.5",
                              toneClasses(severityTone(proposal)).bg,
                            )}
                          />
                        </td>
                        <td>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="console-mono text-[11px] text-[var(--surface-subtle-foreground)]">
                                {shortId(proposal.id)}
                              </span>
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--foreground)]">
                                <span
                                  className={cn(
                                    "h-2 w-2 rounded-full",
                                    actionMeta.dot,
                                  )}
                                />
                                <ActionIcon className="h-3.5 w-3.5 text-[var(--surface-subtle-foreground)]" />
                                {actionMeta.label}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--surface-subtle-foreground)]">
                              {proposal.reason || "No rationale attached."}
                            </p>
                          </div>
                        </td>
                        <td>
                          <div className="space-y-1">
                            <p className="font-medium text-[var(--foreground)]">
                              {proposal.detection_title ||
                                proposal.detection_id ||
                                "(new detection)"}
                            </p>
                            <p className="console-mono text-[11px] text-[var(--surface-subtle-foreground)]">
                              {proposal.detection_id || "new-object"}
                            </p>
                          </div>
                        </td>
                        <td>
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 text-[11px]",
                              kindMeta.tone,
                            )}
                            title={proposal.proposed_by_label || compactOriginLabel(proposal)}
                          >
                            <KindIcon className="h-3.5 w-3.5" />
                            <span className="text-[var(--foreground)]">
                              {compactOriginLabel(proposal)}
                            </span>
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip tone={STATUS_CHIP_TONE[proposal.status]}>
                              {proposal.status}
                            </Chip>
                            {proposal.stale ? (
                              <Chip tone="warning" appearance="outline">
                                stale
                              </Chip>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-right">
                          <span className="console-mono text-[12px] text-[var(--foreground)]">
                            {changedFields}
                          </span>
                        </td>
                        <td
                          className="text-right text-[11px] text-[var(--surface-subtle-foreground)]"
                          title={formatAbsolute(proposal.created_at)}
                        >
                          {formatRelative(proposal.created_at)}
                        </td>
                        <td className="text-right">
                          <span className="console-pill">Open</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
          className="border-[var(--stroke-soft)] !bg-[var(--surface-card)] !text-[var(--foreground)]"
        >
          {selected ? (
            <>
              <SheetHeader className="border-[var(--stroke-soft)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="console-pill console-mono">{selected.id}</span>
                  <span
                    className="console-pill"
                    title={selected.proposed_by_label || compactOriginLabel(selected)}
                  >
                    {compactOriginLabel(selected)}
                  </span>
                  <span className="console-pill">{ACTION_META[selected.action].label}</span>
                </div>
                <SheetTitle className="text-[var(--foreground)]">
                  {selected.detection_title ||
                    selected.detection_id ||
                    "Proposal detail"}
                </SheetTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--surface-subtle-foreground)]">
                  <Chip tone={STATUS_CHIP_TONE[selected.status]}>{selected.status}</Chip>
                  <span>{formatRelative(selected.created_at)}</span>
                </div>
              </SheetHeader>

              <SheetBody>
                {selected.stale ? (
                  <div className="mb-4 flex items-start gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 text-sm text-orange-700 dark:text-orange-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      The detection changed after this proposal was filed.
                      Approving now will mark it superseded and the assistant
                      should re-propose against the latest detection state.
                    </span>
                  </div>
                ) : null}

                {selected.reason ? (
                  <div className="mb-4 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
                    <p className="console-label">Rationale</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                      {selected.reason}
                    </p>
                  </div>
                ) : null}

                <div className="space-y-3">
                  <p className="console-label">Field-level diff</p>
                  {selected.diff.length === 0 ? (
                    <div className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4 text-sm text-[var(--surface-subtle-foreground)]">
                      <Info className="mr-2 inline h-4 w-4" />
                      No field-level diff is available for this proposal.
                    </div>
                  ) : (
                    selected.diff.map((entry) => (
                      <DiffRow key={entry.field} entry={entry} />
                    ))
                  )}
                </div>

                {selected.status === "pending" ? (
                  <div className="mt-6 space-y-2">
                    <p className="console-label">Reviewer note</p>
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Explain the reasoning behind this decision for future reviewers."
                      rows={4}
                      maxLength={4000}
                      className="bg-[var(--surface-elevated)] text-[var(--foreground)]"
                    />
                    <FormError message={reviewError} />
                  </div>
                ) : selected.review_note ? (
                  <div className="mt-6 rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-4">
                    <p className="console-label">
                      Reviewer note
                      {selected.reviewed_by_label
                        ? ` / ${selected.reviewed_by_label}`
                        : ""}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                      {selected.review_note}
                    </p>
                  </div>
                ) : null}
              </SheetBody>

              <SheetFooter className="border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                {selected.status === "pending" ? (
                  <>
                    {!hasPermission(ACTION_PERMISSION[selected.action]) ? (
                      <p className="mr-auto text-xs text-[var(--surface-subtle-foreground)]">
                        You do not have permission to review {ACTION_META[selected.action].label} proposals.
                      </p>
                    ) : null}
                    <Button
                      variant="outline"
                      disabled={submitting !== null || !hasPermission(ACTION_PERMISSION[selected.action])}
                      onClick={() => void handleReview("reject")}
                    >
                      <X className="h-4 w-4" />
                      {submitting === "reject" ? "Rejecting..." : "Reject"}
                    </Button>
                    <Button
                      disabled={
                        submitting !== null ||
                        selected.stale ||
                        !hasPermission(ACTION_PERMISSION[selected.action])
                      }
                      onClick={() => void handleReview("approve")}
                    >
                      <Check className="h-4 w-4" />
                      {submitting === "approve" ? "Applying..." : "Approve and apply"}
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
    </div>
  );
}

/**
 * Secondary filter group — a labeled segmented control, e.g. "ORIGIN: [Any] [AI] [User] [Git]".
 * Matches the segmented-tab styling used for the status filters above it.
 */
function FilterGroup<T extends string>({
  label,
  options,
  active,
  onChange,
  counts,
}: {
  label: string;
  options: Array<{ key: T; label: string }>;
  active: T;
  onChange: (value: T) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--surface-subtle-foreground)]">
        {label}
      </span>
      <div className="flex items-center gap-1 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-1">
        {options.map((option) => {
          const isActive = option.key === active;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition",
                isActive
                  ? "bg-[var(--surface-elevated)] text-[var(--foreground)]"
                  : "text-slate-500 hover:text-[var(--foreground)] dark:text-slate-400",
              )}
            >
              {option.label}
              {option.key === "all" ? null : (
                <span className="ml-1 text-[10px] text-slate-400 dark:text-slate-500">
                  {counts[option.key] ?? 0}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
