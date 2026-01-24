"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText, Download, Calendar, Server, Loader2, Trash2, CheckCircle2, XCircle, AlertTriangle, AlertCircle, X } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { format, subDays, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import { getReports, generateReport, deleteReport, apiFetch, getApiBaseCandidates } from "@/lib/api";

interface Report {
  id: number;
  report_id: string;
  title: string;
  generated_at: string;
  start_date: string;
  end_date: string;
  environments: string[];
  overall_health_score: number | null;
  total_detections: number;
  total_tests: number;
  file_path: string | null;
  file_size: number | null;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  // Report generation form state
  const [startDate, setStartDate] = useState<string>(() => {
    const date = subMonths(new Date(), 1);
    return format(date, "yyyy-MM-dd");
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return format(new Date(), "yyyy-MM-dd");
  });
  const [selectedEnvironments, setSelectedEnvironments] = useState<string[]>(["lab", "dev", "prod"]);
  const [reportTitle, setReportTitle] = useState<string>("");

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      setLoading(true);
      const data = await getReports();
      setReports(data);
    } catch (err: any) {
      const msg = err.message || "Unable to fetch reports";
      toast({
        type: "error",
        title: "Failed to load reports",
        description: msg,
      });
    } finally {
      setLoading(false);
    }
  };

  const resolveApiUrl = () => {
    const envUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");
    if (envUrl) return envUrl;
    const candidates = getApiBaseCandidates();
    return (candidates[0] || "http://127.0.0.1:8001").replace(/\/$/, "");
  };

  const handleGenerateReport = async () => {
    if (!startDate || !endDate) {
      toast({
        type: "error",
        title: "Date range required",
        description: "Please select both start and end dates",
      });
      return;
    }

    if (selectedEnvironments.length === 0) {
      toast({
        type: "error",
        title: "Environment required",
        description: "Please select at least one environment",
      });
      return;
    }

    try {
      setGenerating(true);
      const report = await generateReport({
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate + "T23:59:59").toISOString(),
        environments: selectedEnvironments,
        title: reportTitle || undefined,
      });
      toast({
        type: "success",
        title: "Report generated",
        description: "Your PDF report has been generated successfully",
      });
      
      // Reload reports list
      await loadReports();
      
      // Auto-download the report
      setTimeout(() => {
        const apiUrl = resolveApiUrl();
        window.open(`${apiUrl}/reports/${report.report_id}/download`, "_blank");
      }, 500);
    } catch (err: any) {
      const msg = err.message || "Unable to generate report";
      toast({
        type: "error",
        title: "Generation failed",
        description: msg,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = (reportId: string) => {
    const apiUrl = resolveApiUrl();
    window.open(`${apiUrl}/reports/${reportId}/download`, "_blank");
  };

  const handleDelete = async (reportId: string) => {
    if (!confirm("Are you sure you want to delete this report? This action cannot be undone.")) {
      return;
    }

    try {
      setDeleting(reportId);
      await deleteReport(reportId);

      toast({
        type: "success",
        title: "Report deleted",
        description: "The report has been deleted successfully",
      });

      await loadReports();
    } catch (err: any) {
      const msg = err.message || "Unable to delete report";
      toast({
        type: "error",
        title: "Delete failed",
        description: msg,
      });
    } finally {
      setDeleting(null);
    }
  };

  const getHealthBadge = (score: number | null) => {
    if (score === null) return null;
    if (score >= 80) {
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Healthy</Badge>;
    } else if (score >= 60) {
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Degraded</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-700 border-red-200">Critical</Badge>;
    }
  };

  const normalizeEnvironments = (value: unknown): string[] => {
    if (Array.isArray(value)) return value as string[];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch (_) {
        return trimmed.split(",").map((env) => env.trim()).filter(Boolean);
      }
    }
    return [];
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <PageContainer maxWidth="xl" className="space-y-6">
      <PageHeader
        eyebrow="Executive reporting"
        title="Detection Effectiveness Reports"
        subtitle="Generate comprehensive PDF reports proving detection effectiveness, highlighting gaps, and guiding next actions."
        icon={<FileText className="h-5 w-5" />}
      />

      {/* Report Generation Card */}
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-xl font-display font-semibold text-slate-900">Generate New Report</CardTitle>
              <CardDescription className="text-sm text-slate-600 mt-1">
                Create a comprehensive detection effectiveness report for your selected time period and environments
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Date Range */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="start-date" className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  Start Date
                </Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="h-11 border-slate-200 bg-white text-slate-900"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end-date" className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  End Date
                </Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-11 border-slate-200 bg-white text-slate-900"
                />
              </div>
            </div>

            {/* Environments */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Server className="h-4 w-4 text-slate-500" />
                  Environments
                </Label>
                <div className="flex flex-wrap gap-3">
                  {["lab", "dev", "prod"].map((env) => (
                    <button
                      key={env}
                      onClick={() => {
                        if (selectedEnvironments.includes(env)) {
                          setSelectedEnvironments(selectedEnvironments.filter((e) => e !== env));
                        } else {
                          setSelectedEnvironments([...selectedEnvironments, env]);
                        }
                      }}
                      className={cn(
                        "px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all",
                        selectedEnvironments.includes(env)
                          ? "bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm"
                          : "bg-white border-slate-200 text-slate-600 hover:border-indigo-200 hover:bg-slate-50"
                      )}
                    >
                      {env.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-title" className="text-sm font-semibold text-slate-900">
                  Report Title (Optional)
                </Label>
                <Input
                  id="report-title"
                  type="text"
                  value={reportTitle}
                  onChange={(e) => setReportTitle(e.target.value)}
                  placeholder="Custom report title"
                  className="h-11 border-slate-200 bg-white text-slate-900"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t border-slate-200">
            <Button
              onClick={handleGenerateReport}
              disabled={generating || !startDate || !endDate || selectedEnvironments.length === 0}
              className="bg-white hover:bg-slate-50 text-slate-900 border border-slate-200 shadow-sm font-semibold px-6 rounded-full"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Generate PDF Report
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Generated Reports List */}
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-display font-semibold text-slate-900">Generated Reports</CardTitle>
          <CardDescription className="text-sm text-slate-600">
            View and download previously generated detection effectiveness reports
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : reports.length === 0 ? (
            <div className="text-center py-12 text-slate-600">
              <FileText className="h-12 w-12 mx-auto mb-4 text-slate-400" />
              <p className="text-sm">No reports generated yet</p>
              <p className="text-xs text-slate-500 mt-1">Generate your first report using the form above</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200">
                    <TableHead className="text-xs font-semibold text-slate-700">Title</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Period</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Environments</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Health Score</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Detections</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Tests</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Generated</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Size</TableHead>
                    <TableHead className="text-xs font-semibold text-slate-700">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id} className="border-slate-100">
                      <TableCell className="font-medium text-slate-900">
                        {report.title}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {format(new Date(report.start_date), "MMM dd")} - {format(new Date(report.end_date), "MMM dd, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1.5">
                          {normalizeEnvironments(report.environments as any).map((env: string) => (
                            <Badge key={env} className="bg-slate-100 text-slate-700 border-slate-200 text-xs">
                              {env.toUpperCase()}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {report.overall_health_score !== null ? (
                          <div className="flex items-center gap-2">
                            {getHealthBadge(report.overall_health_score)}
                            <span className="text-sm font-semibold text-slate-900">{report.overall_health_score}/100</span>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-400">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {report.total_detections}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {report.total_tests}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {format(new Date(report.generated_at), "MMM dd, yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="text-sm text-slate-600">
                        {formatFileSize(report.file_size)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownload(report.report_id)}
                            className="border-slate-200 text-slate-700 hover:bg-slate-50 h-8"
                          >
                            <Download className="h-3.5 w-3.5 mr-1.5" />
                            Download
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDelete(report.report_id)}
                            disabled={deleting === report.report_id}
                            className="border-red-200 text-red-700 hover:bg-red-50 h-8"
                          >
                            {deleting === report.report_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
