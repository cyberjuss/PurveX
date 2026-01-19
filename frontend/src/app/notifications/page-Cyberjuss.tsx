"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getTests, getDetections, TestWithDetectionTitle, Detection } from "@/lib/api";
import { 
  Clock, 
  Activity, 
  ShieldCheck, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  ArrowRight,
  Bell,
  Filter,
  RefreshCw
} from "lucide-react";
import { formatRelative, isToday, isThisWeek } from "date-fns";
import { PageContainer } from "@/components/layout/page-container";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";

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
    techniqueId?: string;
    environment?: string;
    score?: number;
    testId?: number;
  };
}

export default function NotificationsPage() {
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<NotificationCategory>("all");
  const [refreshing, setRefreshing] = useState(false);
  const router = useRouter();

  const loadData = async () => {
      try {
      setRefreshing(true);
        setError(null);
        const [recentTests, recentDetections] = await Promise.all([
          getTests().catch(() => []),
          getDetections().catch(() => []),
        ]);
      setTests(recentTests.slice(0, 20));
      setDetections(recentDetections.slice(0, 10));
      } catch (err: any) {
        setError(err.message || "Unable to load notifications.");
      } finally {
        setLoading(false);
      setRefreshing(false);
      }
  };

  useEffect(() => {
    // Visiting the notifications page marks test notifications as read.
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("purvex_unread_test_notification");
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
        title: test.detection_title || "Test completed",
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

    // Sort by timestamp (newest first)
    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [tests, detections]);

  // Filter by category
  const filteredNotifications = useMemo(() => {
    if (category === "all") return notifications;
    return notifications.filter((n) => n.type === category.slice(0, -1) as NotificationType);
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
    <PageContainer maxWidth="full" className="space-y-6 pt-2 pb-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center shadow-sm">
            <Bell className="h-6 w-6 text-indigo-600" />
          </div>
          <div className="space-y-1">
            <h1 className="text-[30px] font-bold text-slate-900">Notifications</h1>
            <p className="text-sm text-slate-600">
              Stay updated with test results, detection changes, and platform events.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-slate-500" />
        {(["all", "tests", "detections", "platform"] as NotificationCategory[]).map((cat) => (
          <Button
            key={cat}
            variant={category === cat ? "default" : "outline"}
            size="sm"
            onClick={() => setCategory(cat)}
            className={`h-9 text-xs px-3 capitalize transition-all ${category === cat ? "bg-slate-900 text-white hover:bg-slate-800 border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:border-indigo-200 hover:text-indigo-700"}`}
            aria-label={`Filter notifications by ${cat}`}
            aria-pressed={category === cat}
          >
            {cat === "all" ? "All" : cat}
            {cat === "all" && unreadCount > 0 && (
              <Badge className="ml-2 h-4 px-1.5 text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-100">
                {unreadCount}
              </Badge>
            )}
          </Button>
        ))}
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={refreshing}
          className="flex items-center gap-2 border-slate-200 text-slate-700 hover:border-indigo-200 hover:text-indigo-700"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {filteredNotifications.length === 0 ? (
        <Card className="border border-slate-200 bg-white shadow-sm">
          <CardContent className="py-12 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 border border-slate-200">
              <Bell className="h-7 w-7 text-slate-500" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-slate-900">
                {category === "all" ? "No notifications yet" : `No ${category} notifications`}
              </h3>
              <p className="text-sm text-slate-600 max-w-xl mx-auto">
                {category === "all"
                  ? "When you run tests, add detections, or receive platform updates, they will appear here."
                  : `No ${category} notifications available. Try selecting a different category.`}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedNotifications.map((group) => (
            <div key={group.label} className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-slate-200" />
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    {group.label}
                  </span>
                  <Badge variant="secondary" className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5">
                    {group.items.length}
                  </Badge>
                </div>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <div className="space-y-3">
                {group.items.map((notification) => (
                  <Card
                    key={notification.id}
                    className="border border-slate-200 bg-white shadow-sm hover:border-indigo-200 hover:shadow-md transition-all cursor-pointer"
                    onClick={() => router.push(notification.actionUrl)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <div className="h-10 w-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center">
                          {getStatusIcon(notification.status)}
                        </div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <div className="flex items-center gap-1.5">
                              {getTypeIcon(notification.type)}
                              <span className="capitalize">{notification.type}</span>
                            </div>
                            {notification.metadata?.environment && (
                              <Badge variant="outline" className="text-[11px] px-2 py-0 border-slate-200 text-slate-600">
                                {notification.metadata.environment.toUpperCase()}
                              </Badge>
                            )}
                            {notification.metadata?.techniqueId && (
                              <span className="font-mono text-slate-500">{notification.metadata.techniqueId}</span>
                            )}
                            {notification.metadata?.score !== undefined && (
                              <span className="font-semibold text-emerald-600">Score: {notification.metadata.score}</span>
                            )}
                          </div>
                          <div className="space-y-1">
                            <h3 className="text-base font-semibold text-slate-900 line-clamp-1">
                              {notification.title}
                            </h3>
                            <p className="text-sm text-slate-600 line-clamp-2">
                              {notification.description}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{formatRelative(notification.timestamp, new Date())}</span>
                            {notification.metadata?.testId && (
                              <span className="font-mono text-slate-500">#{notification.metadata.testId}</span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-3 text-xs text-slate-700 hover:text-indigo-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(notification.actionUrl);
                          }}
                        >
                          View
                          <ArrowRight className="h-4 w-4 ml-1" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
