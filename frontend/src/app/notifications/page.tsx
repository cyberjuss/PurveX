"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTests, getDetections, getEnvironmentRunners, TestWithDetectionTitle, Detection } from "@/lib/api";
import { 
  Clock, 
  Activity, 
  ShieldCheck, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  ArrowRight,
  Filter,
  RefreshCw,
  Zap,
  Bell,
  X
} from "lucide-react";
import Link from "next/link";
import { formatRelative, format, isToday, isThisWeek, isThisMonth } from "date-fns";
import { PageContainer } from "@/components/layout/page-container";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";

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

const PLATFORM_NOTIFICATIONS_KEY = "purvex_platform_notifications";
const PLATFORM_RUNNER_SEEN_KEY = "purvex_platform_runner_ids";
const DISMISSED_NOTIFICATIONS_KEY = "purvex_dismissed_notifications";

type StoredNotification = Omit<UnifiedNotification, "timestamp"> & { timestamp: string };

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
        const storedIds: number[] = JSON.parse(
          window.localStorage.getItem(PLATFORM_RUNNER_SEEN_KEY) || "[]"
        );
        const newRunners = (runners || []).filter((runner: any) => runner?.id && !storedIds.includes(runner.id));
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        const storedNotifications: StoredNotification[] = JSON.parse(
          window.localStorage.getItem(PLATFORM_NOTIFICATIONS_KEY) || "[]"
        ).filter((item: StoredNotification) => new Date(item.timestamp).getTime() >= cutoff);
        const newNotifications: StoredNotification[] = newRunners.map((runner: any) => ({
          id: `platform-runner-${runner.id}-${Date.now()}`,
          type: "platform",
          title: "New runner registered",
          description: `${runner.hostname || "Runner"} · ${(runner.environment_name || "unknown").toUpperCase()}`,
          timestamp: new Date().toISOString(),
          status: "success",
          actionUrl: "/settings/test-runner",
          metadata: {
            environment: runner.environment_name,
          },
        }));

        const mergedNotifications = [...newNotifications, ...storedNotifications].slice(0, 50);
        const mergedIds = Array.from(new Set([...storedIds, ...newRunners.map((runner: any) => runner.id)]));

        window.localStorage.setItem(PLATFORM_NOTIFICATIONS_KEY, JSON.stringify(mergedNotifications));
        window.localStorage.setItem(PLATFORM_RUNNER_SEEN_KEY, JSON.stringify(mergedIds));

        setPlatformNotifications(
          mergedNotifications.map((item) => ({
            ...item,
            timestamp: new Date(item.timestamp),
          }))
        );
      }
      } catch (err: any) {
        setError(err.message || "Unable to load notifications.");
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
      const storedDismissed: string[] = JSON.parse(
        window.localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY) || "[]"
      );
      setDismissedIds(new Set(storedDismissed));
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
        title: test.detection_title || "Test completed",
        description: `${test.technique_id || "Unknown technique"} · ${test.environment?.toUpperCase() || "Unknown"}`,
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
        description: `${detection.technique_id || "Unknown"} · ${detection.siem_type?.toUpperCase() || "Unknown"}`,
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

    // Sort by timestamp (newest first)
    const sorted = items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
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
        return <CheckCircle2 className="h-5 w-5 text-emerald-400" />;
      case "error":
        return <XCircle className="h-5 w-5 text-red-400" />;
      case "warning":
        return <AlertTriangle className="h-5 w-5 text-amber-400" />;
      default:
        return <Activity className="h-5 w-5 text-slate-400" />;
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "success":
        return "hover:border-emerald-500/40";
      case "error":
        return "hover:border-red-500/40";
      case "warning":
        return "hover:border-amber-500/40";
      default:
        return undefined;
    }
  };

  const getTypeIcon = (type: NotificationType) => {
    switch (type) {
      case "test":
        return <Activity className="h-4 w-4" />;
      case "detection":
        return <ShieldCheck className="h-4 w-4" />;
      case "platform":
        return <Sparkles className="h-4 w-4" />;
    }
  };

  const unreadCount = notifications.length; // Could be enhanced with actual read/unread tracking
  const dismissNotification = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(DISMISSED_NOTIFICATIONS_KEY, JSON.stringify(Array.from(next)));
      }
      return next;
    });
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

  return (
    <PageContainer maxWidth="full" className={cn("pt-4", refreshing && "page-refreshing")}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-2 pb-8 space-y-6">

      {/* Category Tabs */}
      <div className="mb-6 flex items-center gap-3 flex-wrap">
        <Filter className="h-4 w-4 text-slate-500" />
        {(["all", "tests", "detections", "platform"] as NotificationCategory[]).map((cat) => (
          <Button
            key={cat}
            variant={category === cat ? "default" : "secondary"}
            size="sm"
            onClick={() => setCategory(cat)}
            className={cn(
              "h-8 text-xs capitalize focus-visible:ring-2 focus-visible:ring-sky-500/50 transition-all font-semibold",
              category === cat
                ? "bg-white text-slate-900 border-white shadow-md"
                : "bg-white/90 text-slate-700 border border-slate-200 hover:bg-white"
            )}
            aria-label={`Filter notifications by ${cat}`}
            aria-pressed={category === cat}
          >
            {cat === "all" ? "All" : cat}
            {cat === "all" && unreadCount > 0 && (
              <Badge className="ml-2 h-4 px-1.5 text-[10px] bg-slate-100 text-slate-700 border-slate-200">
                {unreadCount}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Notifications Timeline */}
      {filteredNotifications.length === 0 ? (
        <Card className="elite-card">
          <CardContent className="pt-14 pb-14 text-center">
            <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm border border-slate-200 mb-5">
              <div className="absolute inset-0 rounded-full ring-1 ring-slate-200/60" />
              <Bell className="h-8 w-8 text-slate-500 relative z-10" />
            </div>
            <p className="text-lg font-display font-semibold text-slate-900 mb-2">
              {category === "all" ? "No notifications yet" : `No ${category} notifications`}
            </p>
            <p className="text-sm text-slate-500 max-w-md mx-auto">
              {category === "all"
                ? "When you run tests, add detections, or receive platform updates, they'll appear here."
                : `No ${category} notifications available. Try selecting a different category.`}
            </p>
            {category !== "all" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCategory("all")}
                className="mt-4"
              >
                View All Notifications
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {groupedNotifications.map((group, groupIndex) => (
            <div key={group.label} className="space-y-4">
              {/* Time Group Header */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
                <h2 className="text-xs font-display font-semibold text-slate-700 uppercase tracking-[0.2em]">
                  {group.label}
                </h2>
                <Badge variant="outline" className="text-[10px] px-2 py-0.5 bg-white border-slate-200 text-slate-700">
                  {group.items.length}
                </Badge>
                <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
              </div>

              {/* Notifications List */}
              <div className="space-y-3">
                {group.items.map((notification, index) => (
                  <Card
                    key={notification.id}
                    className={cn(
                      "elite-card dynamic-card border border-slate-200 transition-all cursor-pointer group",
                      getStatusColor(notification.status) || ""
                    )}
                    style={{
                      animation: `fadeInScale 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards`,
                      animationDelay: `${Math.min((groupIndex * 10 + index) * 50, 500)}ms`,
                      opacity: 0,
                    }}
                    onClick={() => router.push(notification.actionUrl)}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start gap-4">
                        {/* Status Icon */}
                        <div className="mt-0.5 shrink-0">
                          <div className="relative">
                            <div className="absolute inset-0 bg-current opacity-20 rounded-full blur-md" />
                            <div className="relative">
                              {getStatusIcon(notification.status)}
                            </div>
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            {getTypeIcon(notification.type)}
                            <span className="capitalize">{notification.type}</span>
                          </div>
                          {notification.metadata?.score !== undefined && (
                            <>
                              <span className="text-slate-400">·</span>
                              <span className="text-xs font-semibold text-emerald-600">
                                Score: {notification.metadata.score}
                  </span>
                            </>
                          )}
                        </div>
                              <h3 className="text-base font-display font-semibold text-slate-900 group-hover:text-slate-700 transition-colors">
                                {notification.title}
                              </h3>
                              <p className="text-sm text-slate-600 mt-1">
                                {notification.description}
                          </p>
                        </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 px-3 text-xs opacity-0 group-hover:opacity-100 transition-all"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  router.push(notification.actionUrl);
                                }}
                              >
                                View
                                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-all"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  dismissNotification(notification.id);
                                }}
                                aria-label="Dismiss notification"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {/* Timestamp */}
                          <div className="flex items-center gap-1.5 text-xs text-slate-500">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{formatRelative(notification.timestamp, new Date())}</span>
                            {notification.metadata?.testId && (
                              <>
                                <span className="text-slate-400">·</span>
                                <span className="font-mono text-slate-500">#{notification.metadata.testId}</span>
                              </>
                )}
                          </div>
                        </div>
                      </div>
              </CardContent>
            </Card>
                ))}
          </div>
            </div>
          ))}
        </div>
      )}
        </div>
      </PageContainer>
  );
}
