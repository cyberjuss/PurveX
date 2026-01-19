"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Eye, Search } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { cn } from "@/lib/utils";
import { getDetections, getDetectionAlerts, type Detection, type DetectionAlert } from "@/lib/api";

type EventRow = DetectionAlert & {
  detectionId: string;
  detectionTitle: string;
  detectionTechnique?: string | null;
};

export default function EventsPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [detectionFilter, setDetectionFilter] = useState("all");
  const [hostFilter, setHostFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [expandedQueries, setExpandedQueries] = useState<Record<string, boolean>>({});

  const loadEvents = async () => {
    try {
      setError(null);
      const detectionList = await getDetections();
      setDetections(detectionList);
      if (detectionList.length === 0) {
        setEvents([]);
        return;
      }
      const results = await Promise.all(
        detectionList.map(async (det) => {
          const alerts = await getDetectionAlerts(det.id);
          return alerts.map((alert) => ({
            ...alert,
            detectionId: det.id,
            detectionTitle: det.title || "Untitled detection",
            detectionTechnique: det.technique_id || null,
          }));
        })
      );
      const merged = results.flat();
      setEvents(merged);
    } catch (err: any) {
      setError(err?.message || "Unable to load events.");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredEvents = useMemo(() => {
    let filtered = events;

    if (detectionFilter !== "all") {
      filtered = filtered.filter((event) => event.detectionId === detectionFilter);
    }

    if (hostFilter !== "all") {
      filtered = filtered.filter((event) => event.host === hostFilter);
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((event) => {
        const normalized = (event.status || "").toLowerCase();
        if (statusFilter === "active") {
          return normalized === "active" || normalized === "open";
        }
        if (statusFilter === "resolved") {
          return normalized === "resolved" || normalized === "closed";
        }
        return normalized === statusFilter;
      });
    }

    if (severityFilter !== "all") {
      filtered = filtered.filter(
        (event) => (event.severity || "").toLowerCase() === severityFilter
      );
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((event) => {
        return (
          event.name?.toLowerCase().includes(query) ||
          event.message?.toLowerCase().includes(query) ||
          (event.host || "").toLowerCase().includes(query) ||
          event.detectionTitle.toLowerCase().includes(query) ||
          (event.detectionTechnique || "").toLowerCase().includes(query)
        );
      });
    }

    return filtered.sort((a, b) => {
      const dateA = new Date(a.time || a.created_at || 0).getTime();
      const dateB = new Date(b.time || b.created_at || 0).getTime();
      return dateB - dateA;
    });
  }, [events, searchQuery, detectionFilter, hostFilter, statusFilter, severityFilter]);

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
        <ErrorState message={error} onRetry={loadEvents} />
      </PageContainer>
    );
  }

  const toggleQuery = (eventId: number | string) => {
    setExpandedQueries((prev) => ({
      ...prev,
      [String(eventId)]: !prev[String(eventId)],
    }));
  };

  return (
    <PageContainer maxWidth="full" className="space-y-6 pt-2 pb-10">
      <div className="w-full pl-0.5 pr-0 sm:pr-0">
        <PageHeader
          title="Events"
          subtitle="Events tied to validation runs across detections."
        />
      </div>

      <Card className="border-2 border-slate-200 bg-white shadow-md">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white border-slate-300 text-slate-900 placeholder:text-slate-500"
              />
            </div>
            <div className="min-w-[220px]">
              <Select value={detectionFilter} onValueChange={setDetectionFilter}>
                <SelectTrigger className="h-10 border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="All detections" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All detections</SelectItem>
                  {detections.map((det) => (
                    <SelectItem key={det.id} value={det.id}>
                      {det.title || "Untitled detection"}{det.technique_id ? ` - ${det.technique_id}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px]">
              <Select value={hostFilter} onValueChange={setHostFilter}>
                <SelectTrigger className="h-10 border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="All hosts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All hosts</SelectItem>
                  {Array.from(
                    new Set(
                      events
                        .map((event) => event.host)
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
            <div className="min-w-[180px]">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[180px]">
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="h-10 border-slate-300 bg-white text-slate-900">
                  <SelectValue placeholder="All severities" />
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
          </div>
        </CardContent>
      </Card>

      {!loading && filteredEvents.length === 0 ? (
        <Card className="border-2 border-slate-200 bg-white shadow-md">
          <CardContent className="pt-12 pb-12 text-center">
            <CalendarClock className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-lg font-semibold text-slate-900 mb-2">
              {searchQuery || detectionFilter !== "all" || hostFilter !== "all" || statusFilter !== "all" || severityFilter !== "all"
                ? "No events match your filters"
                : "No events yet"}
            </p>
            <p className="text-sm text-slate-600">
              {searchQuery || detectionFilter !== "all" || hostFilter !== "all" || statusFilter !== "all" || severityFilter !== "all"
                ? "Try adjusting your search or filter criteria."
                : "Events will appear here after validations and test runs complete."}
            </p>
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
                    <th className="py-3 pr-5 w-[240px]">Detection</th>
                    <th className="py-3 pr-5 w-[90px]">Severity</th>
                    <th className="py-3 pr-5 w-[160px]">Host</th>
                    <th className="py-3 pr-5 w-[70px]">Test</th>
                    <th className="py-3 pr-2 text-right w-[90px]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredEvents.map((event) => {
                    const severityColor =
                      event.severity === "critical"
                        ? "bg-red-100 text-red-700 border-red-300"
                        : event.severity === "high"
                        ? "bg-orange-100 text-orange-700 border-orange-300"
                        : event.severity === "medium"
                        ? "bg-yellow-100 text-yellow-700 border-yellow-300"
                        : "bg-blue-100 text-blue-700 border-blue-300";

                    return (
                      <tr
                        key={event.id}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a")) {
                            return;
                          }
                          router.push(`/detections/${event.detectionId}/events/${event.id}`);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(`/detections/${event.detectionId}/events/${event.id}`);
                          }
                        }}
                      >
                        <td className="py-4 pr-5 whitespace-nowrap text-slate-600">
                          {new Date(event.time || event.created_at || new Date()).toLocaleString()}
                        </td>
                        <td className="py-4 pr-5 max-w-[240px]">
                          <div className="text-slate-900 font-medium truncate">
                            {event.detectionTitle}
                          </div>
                          {event.detectionTechnique && (
                            <div className="text-[11px] text-slate-500 truncate">
                              {event.detectionTechnique}
                            </div>
                          )}
                        </td>
                        <td className="py-4 pr-5">
                          <Badge className={cn("text-[10px] px-2 py-0.5", severityColor)}>
                            {event.severity || "medium"}
                          </Badge>
                        </td>
                        <td className="py-4 pr-5 max-w-[160px] truncate">
                          {event.host || "N/A"}
                        </td>
                        <td className="py-4 pr-5 whitespace-nowrap text-slate-600">
                          {event.test_id ? `#${event.test_id}` : "N/A"}
                        </td>
                        <td className="py-4 pr-2 text-right">
                          <Link
                            href={`/detections/${event.detectionId}/events/${event.id}`}
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
