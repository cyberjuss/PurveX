"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { toneClasses } from "@/lib/status-tone";
import {
  getTests,
  getDetections,
  getNotifications,
  dismissNotification as apiDismissNotification,
  type TestWithDetectionTitle,
  type Detection,
  type PlatformNotification,
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
    notificationId?: number;
  };
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  all: "All updates",
  tests: "Validation runs",
  detections: "Trust changes",
  platform: "Setup",
};

// Test/detection categories are still derived client-side from their own
// tables, so "dismiss" for those two is local-only. The "platform" category
// (runner/proposal events) is a real persisted Notification row — dismissing
// it goes through the API instead (see dismissNotification below).
const DISMISSED_NOTIFICATIONS_KEY = "purvex_dismissed_notifications";
const NOTIFICATION_RETENTION_DAYS = 14;
const DISMISSED_RETENTION_DAYS = 30;
const MAX_NOTIFICATIONS = 80;

type StoredDismissal = { id: string; dismissedAt: string };

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
        const [recentTests, recentDetections, platformItems] = await Promise.all([
          getTests().catch(() => []),
          getDetections().catch(() => []),
          getNotifications().catch(() => []),
        ]);
      setTests(recentTests.slice(0, 20));
      setDetections(recentDetections.slice(0, 10));
      setPlatformNotifications(
        (platformItems as PlatformNotification[]).map((item) => ({
          id: `platform-${item.id}`,
          type: "platform" as const,
          title: item.title,
          description: item.description || "",
          timestamp: new Date(item.created_at),
          status: item.status,
          actionUrl: item.action_url || "/lab",
          metadata: { notificationId: item.id },
        }))
      );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to load notifications.");
      } finally {
        setLoading(false);
      setRefreshing(false);
      }
  };

  useEffect(() => {
    // Visiting the notifications page marks test notifications as read.
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("purvex_unread_test_notification");
      setDismissedIds(readDismissedIds());
    }
    loadData();
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

  const statusTone = (status?: string): NonNullable<ChipProps["tone"]> => {
    if (status === "success") return "success";
    if (status === "error") return "danger";
    if (status === "warning") return "warning";
    return "muted";
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className={cn("h-4 w-4", toneClasses("success").icon)} />;
      case "error":
        return <XCircle className={cn("h-4 w-4", toneClasses("danger").icon)} />;
      case "warning":
        return <AlertTriangle className={cn("h-4 w-4", toneClasses("warning").icon)} />;
      default:
        return <Activity className={cn("h-4 w-4", toneClasses("muted").icon)} />;
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
  const dismissNotification = (notification: UnifiedNotification) => {
    if (notification.type === "platform" && notification.metadata?.notificationId != null) {
      const backendId = notification.metadata.notificationId;
      setPlatformNotifications((prev) => prev.filter((n) => n.id !== notification.id));
      void apiDismissNotification(backendId).catch(() => void loadData());
      return;
    }
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(notification.id);
      writeDismissedIds(next);
      return next;
    });
  };

  const dismissMany = (items: UnifiedNotification[]) => {
    const platformBackendIds = items
      .filter((n) => n.type === "platform" && n.metadata?.notificationId != null)
      .map((n) => n.metadata!.notificationId as number);
    const otherIds = items.filter((n) => n.type !== "platform").map((n) => n.id);

    if (platformBackendIds.length > 0) {
      setPlatformNotifications((prev) =>
        prev.filter((n) => !platformBackendIds.includes(n.metadata?.notificationId as number))
      );
      void Promise.all(platformBackendIds.map((id) => apiDismissNotification(id).catch(() => {})));
    }
    if (otherIds.length > 0) {
      setDismissedIds((prev) => {
        const next = new Set(prev);
        otherIds.forEach((id) => next.add(id));
        writeDismissedIds(next);
        return next;
      });
    }
  };

  const clearVisibleNotifications = () => {
    dismissMany(filteredNotifications);
  };

  const cleanOldNotifications = () => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    dismissMany(notifications.filter((notification) => notification.timestamp.getTime() < cutoff));
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
    all: <Inbox className="h-4 w-4" />,
    tests: <Activity className="h-4 w-4" />,
    detections: <ShieldCheck className="h-4 w-4" />,
    platform: <Sparkles className="h-4 w-4" />,
  };

  return (
    <PageContainer maxWidth="full" className={cn("pt-4", refreshing && "page-refreshing")}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-10">
        {/* Inline header — no boxed card */}
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--stroke-soft)] pb-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--surface-subtle-foreground)]">
              Validation updates
            </p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
              <Bell className="h-5 w-5 text-[var(--surface-subtle-foreground)]" />
              Notifications
              {notifications.length > 0 && (
                <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-[var(--foreground)] px-2 text-xs font-semibold text-[var(--background)] tabular-nums">
                  {notifications.length}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-[var(--surface-subtle-foreground)]">
              Validation runs, trust changes, and setup issues that need attention.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={cleanOldNotifications}
              disabled={notifications.length === 0}
              className="h-8 whitespace-nowrap text-xs"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Dismiss old
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearVisibleNotifications}
              disabled={filteredNotifications.length === 0}
              className="h-8 whitespace-nowrap text-xs"
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Dismiss all
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
          <Chip tone={statusBreakdown.error > 0 ? "danger" : "muted"}>
            <XCircle className="h-3 w-3" />
            Failed {statusBreakdown.error}
          </Chip>
          <Chip tone={statusBreakdown.warning > 0 ? "warning" : "muted"}>
            <AlertTriangle className="h-3 w-3" />
            Warnings {statusBreakdown.warning}
          </Chip>
          <Chip tone={statusBreakdown.success > 0 ? "success" : "muted"}>
            <CheckCircle2 className="h-3 w-3" />
            Passed {statusBreakdown.success}
          </Chip>
        </div>

        {/* Two-column inbox */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Left rail — categories with live counts, styled like the app sidebar's active state */}
          <aside className="space-y-1">
            <p className="px-3 pb-2 text-[11px] uppercase tracking-[0.22em] text-[var(--surface-subtle-foreground)]">
              Categories
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
                    "group relative flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-all",
                    active
                      ? "border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--foreground)]"
                      : "border-transparent text-[var(--surface-subtle-foreground)] hover:border-[var(--stroke-soft)] hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)]"
                  )}
                >
                  <span
                    className={cn(
                      "absolute inset-y-1.5 left-0 w-[3px] rounded-full transition-all",
                      active ? "bg-[var(--accent-strong)]" : "bg-transparent"
                    )}
                  />
                  <span className={cn(active ? "text-[var(--accent-strong)]" : "text-slate-400")}>
                    {categoryIcons[cat]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{CATEGORY_LABELS[cat]}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                      active ? "bg-[var(--surface-card)] text-[var(--foreground)]" : "text-[var(--surface-subtle-foreground)]"
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
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--stroke-soft)] px-6 py-16 text-center">
                <Bell className="h-6 w-6 text-[var(--surface-subtle-foreground)]" />
                <p className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                  {category === "all"
                    ? "Inbox zero"
                    : `No ${CATEGORY_LABELS[category].toLowerCase()} yet`}
                </p>
                <p className="mt-1 max-w-sm text-xs text-[var(--surface-subtle-foreground)]">
                  {category === "all"
                    ? "Validation runs, trust changes, and setup issues will appear here as your workspace produces evidence."
                    : "Switch categories to see other updates, or view everything below."}
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
              <div className="overflow-hidden rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
                {groupedNotifications.map((group, groupIndex) => (
                  <div key={group.label}>
                    <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-[var(--stroke-soft)] bg-[var(--surface-subtle)]/80 px-4 py-2 backdrop-blur">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--surface-subtle-foreground)]">
                        {group.label}
                      </span>
                      <span className="text-[11px] tabular-nums text-[var(--surface-subtle-foreground)]">
                        {group.items.length}
                      </span>
                    </div>
                    <ul className="divide-y divide-[var(--stroke-soft)]">
                      {group.items.map((notification) => {
                        const meta = getTypeMeta(notification.type);
                        return (
                          <li
                            key={notification.id}
                            onClick={() => router.push(notification.actionUrl)}
                            className={cn(
                              "group relative flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:bg-[var(--surface-subtle)]",
                              groupIndex === 0 && "first:rounded-t-none"
                            )}
                          >
                            {/* Status accent stripe */}
                            <span
                              aria-hidden
                              className={cn(
                                "absolute left-0 top-2 bottom-2 w-[3px] rounded-r",
                                toneClasses(statusTone(notification.status)).bg,
                              )}
                            />

                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--surface-subtle)] ring-1 ring-[var(--stroke-soft)]">
                              {getStatusIcon(notification.status)}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Chip tone="muted" size="sm">
                                  {meta.icon}
                                  {meta.label}
                                </Chip>
                                {notification.metadata?.environment && (
                                  <span className="text-[10px] uppercase tracking-wide text-[var(--surface-subtle-foreground)]">
                                    {notification.metadata.environment}
                                  </span>
                                )}
                                {notification.metadata?.score !== undefined &&
                                  notification.metadata.score !== null && (
                                    <span className={cn("text-[10px] font-semibold", toneClasses("success").text)}>
                                      Score {notification.metadata.score}
                                    </span>
                                  )}
                              </div>
                              <p className="mt-0.5 truncate text-sm font-medium text-[var(--foreground)]">
                                {notification.title}
                              </p>
                              <p className="truncate text-xs text-[var(--surface-subtle-foreground)]">
                                {notification.description}
                              </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-3">
                              <span className="text-[11px] tabular-nums text-[var(--surface-subtle-foreground)]">
                                {formatDistanceToNowStrict(notification.timestamp, { addSuffix: true })}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dismissNotification(notification);
                                }}
                                aria-label="Dismiss notification"
                                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--surface-subtle-foreground)] opacity-0 transition hover:bg-[var(--surface-subtle)] hover:text-[var(--foreground)] group-hover:opacity-100"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              <ChevronRight className="h-4 w-4 text-[var(--surface-subtle-foreground)] transition group-hover:translate-x-0.5" />
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
