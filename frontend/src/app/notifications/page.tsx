"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  getTests,
  getDetections,
  getEnvironmentRunners,
  type TestWithDetectionTitle,
  type Detection,
  type EnvironmentRunnerConfig,
} from "@/lib/api";
import {
  Activity,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Bell,
  Trash2,
  X,
  Inbox,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNowStrict, isToday, isThisWeek } from "date-fns";
import { PageContainer } from "@/components/layout/page-container";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";

type NotificationType = "test" | "detection" | "platform";
type NotificationCategory = "all" | "tests" | "detections" | "platform";

interface UnifiedNotification {
  id: string;
  type: NotificationType;
  title: string;
  description: string;
  timestamp: Date;
  status?: "success" | "warning" | "error" | "info";
  actionUrl: string;
  metadata?: {
    techniqueId?: string | null;
    environment?: string | null;
    score?: number | null;
    testId?: number;
  };
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  all: "All updates",
  tests: "Validation runs",
  detections: "Trust changes",
  platform: "Setup",
};

const PLATFORM_NOTIFICATIONS_KEY = "purvex_platform_notifications";
const PLATFORM_RUNNER_SEEN_KEY = "purvex_platform_runner_ids";
const DISMISSED_NOTIFICATIONS_KEY = "purvex_dismissed_notifications";
const NOTIFICATION_RETENTION_DAYS = 14;
const DISMISSED_RETENTION_DAYS = 30;
const MAX_NOTIFICATIONS = 80;

type StoredNotification = Omit<UnifiedNotification, "timestamp"> & { timestamp: string };
type StoredDismissal = { id: string; dismissedAt: string };
type RunnerSummary = EnvironmentRunnerConfig & {
  id?: number;
  hostname?: string;
  environment_name?: string;
};

function safeReadArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isFreshTimestamp(value: Date | string, retentionDays = NOTIFICATION_RETENTION_DAYS) {
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  return timestamp >= Date.now() - retentionDays * 24 * 60 * 60 * 1000;
}

function readDismissedIds() {
  const stored = safeReadArray<string | StoredDismissal>(DISMISSED_NOTIFICATIONS_KEY);
  const cutoff = Date.now() - DISMISSED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const fresh: StoredDismissal[] = [];

  for (const item of stored) {
    if (typeof item === "string") {
      fresh.push({ id: item, dismissedAt: new Date().toISOString() });
      continue;
    }
    if (!item?.id) continue;
    const dismissedAt = new Date(item.dismissedAt).getTime();
    if (!Number.isFinite(dismissedAt) || dismissedAt >= cutoff) {
      fresh.push(item);
    }
  }

  if (typeof window !== "undefined") {
    window.localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(fresh));
  }

  return new Set(fresh.map((item) => item.id));
}

function writeDismissedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  const now = new Date().toISOString();
  const records: StoredDismissal[] = Array.from(ids).map((id) => ({ id, dismissedAt: now }));
  window.localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(records));
}

export default function NotificationsPage() {
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [platformNotifications, setPlatformNotifications] = useState<UnifiedNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<NotificationCategory>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const router = useRouter();

  const loadData = async () => {
      try {
      setRefreshing(true);
        setError(null);
        const [recentTests, recentDetections, runners] = await Promise.all([
          getTests().catch(() => []),
          getDetections().catch(() => []),
          getEnvironmentRunners().catch(() => []),
        ]);
      setTests(recentTests.slice(0, 20));
      setDetections(recentDetections.slice(0, 10));
      if (typeof window !== "undefined") {
        const storedIds = safeReadArray<number>(PLATFORM_RUNNER_SEEN_KEY);
        const newRunners = (runners || []).filter(
          (runner: RunnerSummary) => typeof runner.id === "number" && !storedIds.includes(runner.id)
        );
        const storedNotifications = safeReadArray<StoredNotification>(PLATFORM_NOTIFICATIONS_KEY)
          .filter((item) => isFreshTimestamp(item.timestamp));
        const newNotifications: StoredNotification[] = newRunners.map((runner: RunnerSummary) => ({
          id: `platform-runner-${runner.id}-${Date.now()}`,
          type: "platform",
          title: "New validation agent connected",
          description: `${runner.hostname || "Runner"} - ${(runner.environment_name || "unknown").toUpperCase()}`,
          timestamp: new Date().toISOString(),
          status: "success",
          actionUrl: "/settings/test-runner",
          metadata: {
            environment: runner.environment_name,
          },
        }));

        const mergedNotifications = [...newNotifications, ...storedNotifications].slice(0, MAX_NOTIFICATIONS);
        const mergedIds = Array.from(new Set([...storedIds, ...newRunners.map((runner: RunnerSummary) => runner.id)]));

        window.localStorage.setItem(PLATFORM_NOTIFICATIONS_KEY, JSON.stringify(mergedNotifications));
        window.localStorage.setItem(PLATFORM_RUNNER_SEEN_KEY, JSON.stringify(mergedIds));

        setPlatformNotifications(
          mergedNotifications.map((item) => ({
            ...item,
            timestamp: new Date(item.timestamp),
          }))
        );
      }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to load notifications.");
      } finally {
        setLoading(false);
      setRefreshing(false);
      }
  };

  useEffect(() => {
    let handler: (() => void) | null = null;
    // Visiting the notifications page marks test notifications as read.
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("purvex_unread_test_notification");
      setDismissedIds(readDismissedIds());
      handler = () => {
        loadData();
      };
      window.addEventListener("purvex:platform-notification", handler);
    }
    loadData();
    return () => {
      if (handler && typeof window !== "undefined") {
        window.removeEventListener("purvex:platform-notification", handler);
      }
    };
  }, []);

  // Transform data into unified notifications
  const notifications = useMemo<UnifiedNotification[]>(() => {
    const items: UnifiedNotification[] = [];

    // Add test notifications
    tests.forEach((test) => {
      const status = test.result === "PASS" 
        ? "success" 
        : test.result === "FAIL" 
        ? "error" 
        : test.status === "running" || test.status === "qa"
        ? "warning"
        : "info";

      items.push({
        id: `test-${test.id}`,
        type: "test",
        title: test.detection_title || "Validation run completed",
        description: `${test.technique_id || "Unknown technique"} - ${test.environment?.toUpperCase() || "Unknown"}`,
        timestamp: new Date(test.started_at),
        status,
        actionUrl: `/tests/${test.id}`,
        metadata: {
          techniqueId: test.technique_id,
          environment: test.environment,
          score: test.score,
          testId: test.id,
        },
      });
    });

    // Add detection notifications
    detections.forEach((detection) => {
      items.push({
        id: `detection-${detection.id}`,
        type: "detection",
        title: detection.title,
        description: `${detection.technique_id || "Unknown"} - ${detection.siem_type?.toUpperCase() || "Unknown"}`,
        timestamp: detection.last_tested_at ? new Date(detection.last_tested_at) : new Date(detection.created_at || Date.now()),
        status: detection.last_result === "PASS" ? "success" : detection.last_result === "FAIL" ? "error" : "info",
        actionUrl: `/detections/${detection.id}`,
        metadata: {
          techniqueId: detection.technique_id,
        },
      });
    });

    platformNotifications.forEach((notification) => {
      items.push(notification);
    });

    // Sort by timestamp (newest first), auto-expire old derived notifications,
    // and cap the list so the page cannot accumulate stale noise forever.
    const sorted = items
      .filter((item) => isFreshTimestamp(item.timestamp))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, MAX_NOTIFICATIONS);
    return sorted.filter((item) => !dismissedIds.has(item.id));
  }, [tests, detections, platformNotifications, dismissedIds]);

  // Filter by category
  const filteredNotifications = useMemo(() => {
    if (category === "all") return notifications;
    if (category === "platform") return notifications.filter((n) => n.type === "platform");
    return notifications.filter((n) => n.type === (category.slice(0, -1) as NotificationType));
  }, [notifications, category]);

  // Group by time
  const groupedNotifications = useMemo(() => {
    const groups: { label: string; items: UnifiedNotification[] }[] = [
      { label: "Today", items: [] },
      { label: "This Week", items: [] },
      { label: "Earlier", items: [] },
    ];

    filteredNotifications.forEach((notification) => {
      if (isToday(notification.timestamp)) {
        groups[0].items.push(notification);
      } else if (isThisWeek(notification.timestamp)) {
        groups[1].items.push(notification);
      } else {
        groups[2].items.push(notification);
      }
    });

    return groups.filter((group) => group.items.length > 0);
  }, [filteredNotifications]);

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "error":
        return <XCircle className="h-4 w-4 text-rose-500" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default:
        return <Activity className="h-4 w-4 text-slate-400" />;
    }
  };

  const getTypeMeta = (type: NotificationType) => {
    switch (type) {
      case "test":
        return { icon: <Activity className="h-3 w-3" />, label: "Validation run" };
      case "detection":
        return { icon: <ShieldCheck className="h-3 w-3" />, label: "Trust change" };
      case "platform":
        return { icon: <Sparkles className="h-3 w-3" />, label: "Setup" };
    }
  };

  // Counts per category for the left rail
  const counts = useMemo(() => {
    return {
      all: notifications.length,
      tests: notifications.filter((n) => n.type === "test").length,
      detections: notifications.filter((n) => n.type === "detection").length,
      platform: notifications.filter((n) => n.type === "platform").length,
    } as Record<NotificationCategory, number>;
  }, [notifications]);

  const statusBreakdown = useMemo(() => {
    return {
      error: notifications.filter((n) => n.status === "error").length,
      warning: notifications.filter((n) => n.status === "warning").length,
      success: notifications.filter((n) => n.status === "success").length,
    };
  }, [notifications]);
  const dismissNotification = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeDismissedIds(next);
      return next;
    });
  };

  const dismissMany = (ids: string[]) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      writeDismissedIds(next);
      return next;
    });
  };

  const clearVisibleNotifications = () => {
    dismissMany(filteredNotifications.map((notification) => notification.id));
  };

  const cleanOldNotifications = () => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    dismissMany(
      notifications
        .filter((notification) => notification.timestamp.getTime() < cutoff)
        .map((notification) => notification.id)
    );
    if (typeof window !== "undefined") {
      const freshPlatform = safeReadArray<StoredNotification>(PLATFORM_NOTIFICATIONS_KEY)
        .filter((notification) => new Date(notification.timestamp).getTime() >= cutoff);
      window.localStorage.setItem(PLATFORM_NOTIFICATIONS_KEY, JSON.stringify(freshPlatform));
    }
    setPlatformNotifications((prev) => prev.filter((notification) => notification.timestamp.getTime() >= cutoff));
  };

  if (loading) {
    return (
      <PageContainer>
        <LoadingState message="Loading notifications..." />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState
          title="Failed to load notifications"
          message={error}
          onRetry={loadData}
        />
      </PageContainer>
    );
  }

  const categoryOrder: NotificationCategory[] = ["all", "tests", "detections", "platform"];
  const categoryIcons: Record<NotificationCategory, React.ReactNode> = {
    all: <Inbox className="h-3.5 w-3.5" />,
    tests: <Activity className="h-3.5 w-3.5" />,
    detections: <ShieldCheck className="h-3.5 w-3.5" />,
    platform: <Sparkles className="h-3.5 w-3.5" />,
  };

  return (
    <PageContainer maxWidth="full" className={cn("pt-4", refreshing && "page-refreshing")}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-10">
        {/* Inline header — no boxed card */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Validation updates
            </p>
            <h1 className="mt-1 flex items-center gap-2.5 text-[26px] font-display font-semibold tracking-tight text-slate-900">
              <Bell className="h-5 w-5 text-slate-500" />
              Notifications
              {notifications.length > 0 && (
                <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-slate-900 px-2 text-xs font-semibold text-white tabular-nums">
                  {notifications.length}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Validation runs, trust changes, and setup issues that need attention.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={cleanOldNotifications}
              disabled={notifications.length === 0}
              className="h-8 whitespace-nowrap text-xs text-slate-600"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clean old
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearVisibleNotifications}
              disabled={filteredNotifications.length === 0}
              className="h-8 whitespace-nowrap text-xs text-slate-600"
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Clear view
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadData()}
              disabled={refreshing}
              className="h-8 whitespace-nowrap text-xs"
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </header>

        {/* Status breakdown strip */}
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <StatusChip
            tone="rose"
            label="Errors"
            count={statusBreakdown.error}
            icon={<XCircle className="h-3 w-3" />}
          />
          <StatusChip
            tone="amber"
            label="Warnings"
            count={statusBreakdown.warning}
            icon={<AlertTriangle className="h-3 w-3" />}
          />
          <StatusChip
            tone="emerald"
            label="Successful"
            count={statusBreakdown.success}
            icon={<CheckCircle2 className="h-3 w-3" />}
          />
          <span className="ml-auto text-[11px] text-slate-400">
            Auto-expire after {NOTIFICATION_RETENTION_DAYS} days · dismissed pruned after {DISMISSED_RETENTION_DAYS}
          </span>
        </div>

        {/* Two-column inbox */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Left rail — categories with live counts */}
          <aside className="space-y-1">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              Filter
            </p>
            {categoryOrder.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  aria-pressed={active}
                  className={cn(
                    "group flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[13px] transition",
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-50"
                  )}
                >
                  <span className="flex items-center gap-2 truncate">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                        active ? "bg-white/10 text-white" : "bg-slate-100 text-slate-500"
                      )}
                    >
                      {categoryIcons[cat]}
                    </span>
                    <span className="truncate">{CATEGORY_LABELS[cat]}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 text-[11px] tabular-nums",
                      active ? "bg-white/15 text-white" : "text-slate-500"
                    )}
                  >
                    {counts[cat]}
                  </span>
                </button>
              );
            })}
          </aside>

          {/* Right — feed */}
          <section>
            {filteredNotifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-6 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200">
                  <Bell className="h-5 w-5 text-slate-400" />
                </div>
                <p className="mt-4 text-sm font-semibold text-slate-900">
                  {category === "all"
                    ? "Inbox zero"
                    : `No ${CATEGORY_LABELS[category].toLowerCase()} yet`}
                </p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  {category === "all"
                    ? "Validation runs, trust changes, and setup issues will appear here as your workspace produces evidence."
                    : "Try a different category to see what is currently in the inbox."}
                </p>
                {category !== "all" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCategory("all")}
                    className="mt-4 h-8 text-xs"
                  >
                    View all updates
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {groupedNotifications.map((group, groupIndex) => (
                  <div key={group.label}>
                    <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-2 backdrop-blur">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {group.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-slate-400">
                        {group.items.length}
                      </span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {group.items.map((notification) => {
                        const meta = getTypeMeta(notification.type);
                        return (
                          <li
                            key={notification.id}
                            onClick={() => router.push(notification.actionUrl)}
                            className={cn(
                              "group relative flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-slate-50",
                              groupIndex === 0 && "first:rounded-t-none"
                            )}
                          >
                            {/* Status accent stripe */}
                            <span
                              aria-hidden
                              className={cn(
                                "absolute left-0 top-2 bottom-2 w-[3px] rounded-r",
                                notification.status === "error"
                                  ? "bg-rose-500"
                                  : notification.status === "warning"
                                    ? "bg-amber-500"
                                    : notification.status === "success"
                                      ? "bg-emerald-500"
                                      : "bg-slate-300"
                              )}
                            />

                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-50 ring-1 ring-slate-200">
                              {getStatusIcon(notification.status)}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                                  {meta.icon}
                                  {meta.label}
                                </span>
                                {notification.metadata?.environment && (
                                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                                    {notification.metadata.environment}
                                  </span>
                                )}
                                {notification.metadata?.score !== undefined &&
                                  notification.metadata.score !== null && (
                                    <span className="text-[10px] font-semibold text-emerald-600">
                                      Score {notification.metadata.score}
                                    </span>
                                  )}
                              </div>
                              <p className="mt-0.5 truncate text-sm font-medium text-slate-900">
                                {notification.title}
                              </p>
                              <p className="truncate text-xs text-slate-500">
                                {notification.description}
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-3">
                              <span className="text-[11px] tabular-nums text-slate-400">
                                {formatDistanceToNowStrict(notification.timestamp, { addSuffix: true })}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dismissNotification(notification.id);
                                }}
                                aria-label="Dismiss notification"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              <ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </PageContainer>
  );
}

function StatusChip({
  tone,
  label,
  count,
  icon,
}: {
  tone: "rose" | "amber" | "emerald";
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  const palette = {
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  } as const;
  const muted = "bg-slate-50 text-slate-500 ring-slate-200";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium ring-1",
        count > 0 ? palette[tone] : muted
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="tabular-nums">{count}</span>
    </span>
  );
}
