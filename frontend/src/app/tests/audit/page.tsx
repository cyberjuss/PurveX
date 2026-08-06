"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Search, Eye } from "lucide-react";
import { Chip, type ChipProps } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { getTests, type TestWithDetectionTitle } from "@/lib/api";

type ResultFilter = "all" | "PASS" | "FAIL" | "INCONCLUSIVE" | "PENDING" | "RUNNING" | "ERROR";
type EnvFilter = "all" | "lab" | "dev" | "prod";
type TimeFilter = "all" | "24h" | "7d" | "30d";

function formatDuration(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return "—";
  const totalSeconds = Math.round((endMs - startMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Test run result → Chip tone. ERROR maps to danger alongside FAIL because
// the audit table only has room for a single chip per row and users care
// about "did it pass / did it fail" more than "did it crash or report FAIL".
function getResultLabel(result?: string): string | undefined {
  if ((result || "").toUpperCase() === "INCONCLUSIVE") return "Blind Spot";
  return result;
}

function getResultTone(result?: string): NonNullable<ChipProps["tone"]> {
  switch ((result || "").toUpperCase()) {
    case "PASS":
      return "success";
    case "FAIL":
    case "ERROR":
      return "danger";
    case "INCONCLUSIVE":
    case "RUNNING":
      return "warning";
    case "PENDING":
      return "info";
    default:
      return "neutral";
  }
}

export default function TestsAuditPage() {
  const router = useRouter();
  const [tests, setTests] = useState<TestWithDetectionTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [envFilter, setEnvFilter] = useState<EnvFilter>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");

  const loadData = async () => {
    try {
      setError(null);
      const data = await getTests();
      setTests(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load test executions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredTests = useMemo(() => {
    let filtered = [...tests];

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((t) =>
        (t.detection_title || "").toLowerCase().includes(query) ||
        (t.technique_id || "").toLowerCase().includes(query) ||
        t.id.toString().includes(query)
      );
    }

    if (resultFilter !== "all") {
      filtered = filtered.filter((t) =>
        (t.result || t.status || "").toUpperCase() === resultFilter
      );
    }

    if (envFilter !== "all") {
      filtered = filtered.filter((t) =>
        (t.environment || "").toLowerCase() === envFilter
      );
    }

    if (timeFilter !== "all") {
      const now = Date.now();
      const cutoff =
        timeFilter === "24h"
          ? now - 24 * 60 * 60 * 1000
          : timeFilter === "7d"
          ? now - 7 * 24 * 60 * 60 * 1000
          : now - 30 * 24 * 60 * 60 * 1000;
      filtered = filtered.filter((t) => {
        const started = new Date(t.started_at).getTime();
        return started >= cutoff;
      });
    }

    return filtered.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  }, [tests, searchQuery, resultFilter, envFilter, timeFilter]);

  if (loading) {
    return (
      <PageContainer>
        <LoadingState message="Loading test executions..." size="lg" />
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

  return (
    <PageContainer maxWidth="full" className="space-y-6 pt-2 pb-10">
      <div className="w-full pl-0.5 pr-0 sm:pr-0">
        <PageHeader
          title="Test Execution Audit"
          subtitle="Follow every run end to end so lessons are preserved and improvement becomes cumulative."
        />
      </div>

      <Card className="border-2 border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-md">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search by detection, technique, or test id..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-[var(--foreground)] placeholder:text-slate-500 dark:placeholder:text-slate-400"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={resultFilter} onValueChange={(v: ResultFilter) => setResultFilter(v)}>
                <SelectTrigger className="h-10 w-[150px] border-slate-300 bg-white text-[var(--foreground)]">
                  <SelectValue placeholder="Result" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-[var(--stroke-soft)]">
                  <SelectItem value="all">All results</SelectItem>
                  <SelectItem value="PASS">Pass</SelectItem>
                  <SelectItem value="FAIL">Fail</SelectItem>
                  <SelectItem value="INCONCLUSIVE">Blind Spot</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="RUNNING">Running</SelectItem>
                  <SelectItem value="ERROR">Error</SelectItem>
                </SelectContent>
              </Select>
              <Select value={envFilter} onValueChange={(v: EnvFilter) => setEnvFilter(v)}>
                <SelectTrigger className="h-10 w-[150px] border-slate-300 bg-white text-[var(--foreground)]">
                  <SelectValue placeholder="Environment" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-[var(--stroke-soft)]">
                  <SelectItem value="all">All environments</SelectItem>
                  <SelectItem value="lab">Lab</SelectItem>
                  <SelectItem value="dev">Dev</SelectItem>
                  <SelectItem value="prod">Prod</SelectItem>
                </SelectContent>
              </Select>
              <Select value={timeFilter} onValueChange={(v: TimeFilter) => setTimeFilter(v)}>
                <SelectTrigger className="h-10 w-[140px] border-slate-300 bg-white text-[var(--foreground)]">
                  <SelectValue placeholder="Time range" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-[var(--stroke-soft)]">
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {filteredTests.length === 0 ? (
        <Card className="border-2 border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-md">
          <CardContent className="pt-12 pb-12 text-center">
            <p className="text-lg font-semibold text-[var(--foreground)] mb-2">No test executions found</p>
            <p className="text-sm text-slate-600">Try adjusting your filters or run a new test.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-2 border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-md">
          <CardContent className="pt-4 pb-4">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-[12px] text-slate-700">
                <thead className="border-b border-[var(--stroke-soft)] text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-2.5 pr-4">Time</th>
                    <th className="py-2.5 pr-4">Finished</th>
                    <th className="py-2.5 pr-4">Duration</th>
                    <th className="py-2.5 pr-4">User</th>
                    <th className="py-2.5 pr-4">Detection</th>
                    <th className="py-2.5 pr-4">Technique</th>
                    <th className="py-2.5 pr-4">Atomic</th>
                    <th className="py-2.5 pr-4">Environment</th>
                    <th className="py-2.5 pr-4">Result</th>
                    <th className="py-2.5 pr-4">Status</th>
                    <th className="py-2.5 pr-4">Score</th>
                    <th className="py-2.5 pr-4">Test ID</th>
                    <th className="py-2.5 pr-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTests.map((test) => {
                    const result = (test.result || test.status || "N/A").toUpperCase();
                    return (
                      <tr
                        key={test.id}
                        className="hover:bg-[var(--surface-elevated)] cursor-pointer"
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a")) {
                            return;
                          }
                          router.push(`/tests/${test.id}`);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(`/tests/${test.id}`);
                          }
                        }}
                      >
                        <td className="py-3 pr-4 whitespace-nowrap text-slate-600">
                          <div className="flex items-center gap-2">
                            <Clock className="h-3 w-3 text-slate-400" />
                            <span>{new Date(test.started_at).toLocaleString()}</span>
                          </div>
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap text-slate-600">
                          {test.finished_at ? new Date(test.finished_at).toLocaleString() : "—"}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap text-slate-600">
                          {formatDuration(test.started_at, test.finished_at)}
                        </td>
                        <td className="py-3 pr-4 max-w-[200px]">
                          <div className="text-[var(--foreground)] truncate">
                            {test.initiated_by_username || "Unknown user"}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {test.initiated_by_role || "Unknown role"}
                          </div>
                        </td>
                        <td className="py-3 pr-4 max-w-[260px]">
                          <div className="text-[var(--foreground)] font-medium truncate">
                            {test.detection_title || "No detection"}
                          </div>
                          {test.detection_id && (
                            <div className="text-[11px] text-slate-500 truncate">ID: {test.detection_id}</div>
                          )}
                        </td>
                        <td className="py-3 pr-4 whitespace-nowrap font-mono text-slate-600">
                          {test.technique_id || "—"}
                        </td>
                        <td className="py-3 pr-4 max-w-[220px]">
                          <span className="text-[11px] text-slate-500 truncate block">
                            {test.marker || "—"}
                          </span>
                        </td>
                        <td className="py-3 pr-4 uppercase text-slate-600">
                          {test.environment || "—"}
                        </td>
                        <td className="py-3 pr-4">
                          <Chip tone={getResultTone(result)}>{getResultLabel(result)}</Chip>
                        </td>
                        <td className="py-3 pr-4 text-slate-600">{test.status || "—"}</td>
                        <td className="py-3 pr-4 text-slate-600">
                          {typeof test.score === "number" ? test.score : "—"}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">#{test.id}</td>
                        <td className="py-3 pr-2 text-right">
                          <Link
                            href={`/tests/${test.id}`}
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
