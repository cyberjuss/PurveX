"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Eye, Info, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";
import { getDetection, getDetectionAlerts, type Detection, type DetectionAlert } from "@/lib/api";

type AlertStatus = "all" | "active" | "resolved";
type AlertSeverity = "all" | "critical" | "high" | "medium" | "low";

export default function DetectionAlertsPage() {
  const params = useParams();
  const router = useRouter();
  const detectionId = (params as { id?: string }).id;

  const [detection, setDetection] = useState<Detection | null>(null);
  const [alerts, setAlerts] = useState<DetectionAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<AlertStatus>("all");
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity>("all");
  const [hostFilter, setHostFilter] = useState("all");
  const [expandedQueries, setExpandedQueries] = useState<Record<string, boolean>>({});

  const loadData = async () => {
    if (!detectionId) return;
    try {
      setError(null);
      const [detectionData, alertData] = await Promise.all([
        getDetection(detectionId),
        getDetectionAlerts(detectionId),
      ]);
      setDetection(detectionData);
      setAlerts(alertData);
    } catch (err: any) {
      setError(err?.message || "Unable to load events.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectionId]);

  const filteredAlerts = useMemo(() => {
    let filtered = alerts;

    if (statusFilter !== "all") {
      filtered = filtered.filter((alert) => {
        if (statusFilter === "active") {
          return alert.status === "active" || alert.status === "open";
        }
        return alert.status === "resolved" || alert.status === "closed";
      });
    }

    if (severityFilter !== "all") {
      filtered = filtered.filter(
        (alert) => (alert.severity || "").toLowerCase() === severityFilter
      );
    }

    if (hostFilter !== "all") {
      filtered = filtered.filter((alert) => alert.host === hostFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((alert) => {
        return (
          alert.name?.toLowerCase().includes(query) ||
          alert.message?.toLowerCase().includes(query) ||
          alert.severity?.toLowerCase().includes(query)
        );
      });
    }

    return filtered.sort((a, b) => {
      const dateA = new Date(a.time || a.created_at || 0).getTime();
      const dateB = new Date(b.time || b.created_at || 0).getTime();
      return dateB - dateA;
    });
  }, [alerts, searchQuery, statusFilter, severityFilter, hostFilter]);

  if (loading) {
    return (
      <PageContainer>
        <LoadingState message="Loading events..." size="lg" />
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer>
        <ErrorState message={error} onRetry={loadData} />
      </PageContainer>
    );
  }

  const toggleQuery = (alertId: number | string) => {
    setExpandedQueries((prev) => ({
      ...prev,
      [String(alertId)]: !prev[String(alertId)],
    }));
  };

  return (
    <PageContainer maxWidth="full" className="space-y-6">
      <div className="w-full pl-0.5 pr-0 sm:pr-0">
        <PageHeader
          eyebrow="Detection events"
          title={detection?.title || "Detection Events"}
          subtitle="Events tied to validation runs for this detection."
          icon={<CalendarClock className="h-5 w-5" />}
        />
      </div>

      <Card className="border-2 border-slate-200 bg-white shadow-md">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white border-slate-300 text-slate-900 placeholder:text-slate-500"
              />
            </div>
            <div className="min-w-[160px]">
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as AlertStatus)}>
                <SelectTrigger className="h-10 border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[160px]">
              <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as AlertSeverity)}>
                <SelectTrigger className="h-10 border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px]">
              <Select value={hostFilter} onValueChange={setHostFilter}>
                <SelectTrigger className="h-10 border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="Host" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All hosts</SelectItem>
                  {Array.from(
                    new Set(
                      alerts
                        .map((alert) => alert.host)
                        .filter((host): host is string => Boolean(host))
                    )
                  )
                    .sort((a, b) => a.localeCompare(b))
                    .map((host) => (
                      <SelectItem key={host} value={host}>
                        {host}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredAlerts.length === 0 ? (
        <Card className="border-2 border-slate-200 bg-white shadow-md">
          <CardContent className="pt-12 pb-12 text-center">
            <CalendarClock className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-lg font-semibold text-slate-900 mb-2">
              {searchQuery || statusFilter !== "all" || severityFilter !== "all" || hostFilter !== "all"
                ? "No events match your filters"
                : "No events yet"}
            </p>
            <p className="text-sm text-slate-600">
              {searchQuery || statusFilter !== "all" || severityFilter !== "all" || hostFilter !== "all"
                ? "Try adjusting your search or filter criteria."
                : "Events will appear here after validations and test runs complete."}
            </p>
            <div className="inline-flex items-center gap-2 text-xs text-slate-500 mt-2">
              <Info className="h-3.5 w-3.5" />
              This page is intentionally focused on events, not alerts.
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-2 border-slate-200 bg-white shadow-md">
          <CardContent className="pt-4 pb-4">
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto text-left text-[12px] text-slate-700">
                <thead className="border-b border-slate-200 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3 pr-5 w-[170px]">Time</th>
                    <th className="py-3 pr-5 w-[90px]">Severity</th>
                    <th className="py-3 pr-5 w-[90px]">Status</th>
                    <th className="py-3 pr-5 w-[160px]">Host</th>
                    <th className="py-3 pr-5 w-[70px]">Test</th>
                    <th className="py-3 pr-2 text-right w-[90px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAlerts.map((alert) => {
                    const severityColor =
                      alert.severity === "critical"
                        ? "bg-red-100 text-red-700 border-red-300"
                        : alert.severity === "high"
                        ? "bg-orange-100 text-orange-700 border-orange-300"
                        : alert.severity === "medium"
                        ? "bg-yellow-100 text-yellow-700 border-yellow-300"
                        : "bg-blue-100 text-blue-700 border-blue-300";

                    const statusColor =
                      alert.status === "active" || alert.status === "open"
                        ? "bg-amber-100 text-amber-700 border-amber-300"
                        : "bg-emerald-100 text-emerald-700 border-emerald-300";

                    return (
                      <tr
                        key={alert.id}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a")) {
                            return;
                          }
                          router.push(`/detections/${detectionId}/events/${alert.id}`);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(`/detections/${detectionId}/events/${alert.id}`);
                          }
                        }}
                      >
                        <td className="py-4 pr-5 whitespace-nowrap text-slate-600">
                          {new Date(alert.time || alert.created_at || new Date()).toLocaleString()}
                        </td>
                        <td className="py-4 pr-5">
                          <Badge className={cn("text-[10px] px-2 py-0.5", severityColor)}>
                            {alert.severity || "medium"}
                          </Badge>
                        </td>
                        <td className="py-4 pr-5">
                          <Badge className={cn("text-[10px] px-2 py-0.5", statusColor)}>
                            {alert.status || "active"}
                          </Badge>
                        </td>
                        <td className="py-4 pr-5 max-w-[160px] truncate">
                          {alert.host || "N/A"}
                        </td>
                        <td className="py-4 pr-5 whitespace-nowrap text-slate-600">
                          {alert.test_id ? `#${alert.test_id}` : "N/A"}
                        </td>
                        <td className="py-4 pr-2 text-right">
                          <Link
                            href={`/detections/${detectionId}/events/${alert.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-700 font-medium"
                          >
                            <Eye className="h-3 w-3" />
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
