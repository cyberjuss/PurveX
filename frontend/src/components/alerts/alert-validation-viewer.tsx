"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DetectionAlert, Detection, TestDetailResponse, getTest, getDetection } from "@/lib/api";
import { 
  AlertTriangle, 
  Clock, 
  Server, 
  Target, 
  Code, 
  FileText, 
  Activity, 
  CheckCircle2, 
  XCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Shield,
  Zap,
  Database,
  Eye,
  Copy,
  Check
} from "lucide-react";
import { format, formatRelative } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface AlertValidationViewerProps {
  alert: DetectionAlert & { detection_id?: string; detection_title?: string };
  detection?: Detection;
  test?: TestDetailResponse;
  expanded?: boolean;
  onToggleExpand?: () => void;
  showAsCard?: boolean;
}

export function AlertValidationViewer({
  alert,
  detection,
  test,
  expanded = false,
  onToggleExpand,
  showAsCard = true,
}: AlertValidationViewerProps) {
  const [testData, setTestData] = useState<TestDetailResponse | null>(test || null);
  const [detectionData, setDetectionData] = useState<Detection | null>(detection || null);
  const [loadingTest, setLoadingTest] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (alert.test_id && !testData && expanded) {
      loadTestData();
    }
  }, [alert.test_id, expanded]);

  useEffect(() => {
    if (alert.detection_id && !detectionData && expanded) {
      loadDetectionData();
    }
  }, [alert.detection_id, expanded]);

  const loadTestData = async () => {
    if (!alert.test_id) return;
    try {
      setLoadingTest(true);
      const data = await getTest(alert.test_id);
      // getTest now returns null for 404s instead of throwing
      if (data) {
        setTestData(data);
        if (data.detection) {
          setDetectionData(data.detection);
        }
      }
      // If data is null, test doesn't exist - this is expected and we just continue
    } catch (err: any) {
      // Only catch non-404 errors (network errors, auth errors, etc.)
      // 404s are now handled by getTest returning null
      if (process.env.NODE_ENV === 'development') {
        console.debug("Error loading test data:", alert.test_id, err);
      }
    } finally {
      setLoadingTest(false);
    }
  };

  const loadDetectionData = async () => {
    if (!alert.detection_id) return;
    try {
      const data = await getDetection(alert.detection_id);
      // getDetection now returns null for 404s instead of throwing
      if (data) {
        setDetectionData(data);
      }
    } catch (err) {
      // Only log non-404 errors
      const is404 = (err as any)?.is404 || 
                    (err as any)?.message?.toLowerCase().includes("not found") || 
                    (err as any)?.message?.toLowerCase().includes("404");
      if (!is404) {
        console.error("Failed to load detection data:", err);
      }
    }
  };

  const parseRawEvent = (rawEvent?: string) => {
    if (!rawEvent) return null;
    try {
      return JSON.parse(rawEvent);
    } catch {
      return null;
    }
  };

  const parsedEvent = parseRawEvent(alert.raw_event);
  const siemEvents = testData?.artifact?.siem_sample_events 
    ? (() => {
        try {
          return JSON.parse(testData.artifact.siem_sample_events);
        } catch {
          return null;
        }
      })()
    : null;

  const rawTitle = detectionData?.title || alert.detection_title || alert.name || "Detection";
  const titleEnvMatch = rawTitle.match(/\(([^)]+)\)\s*$/);
  const titleEnv = titleEnvMatch ? titleEnvMatch[1].trim() : "";
  const notesEnvMatch = detectionData?.notes?.match(/\b(lab|dev|prod)\b/i);
  const descriptionEnvMatch = detectionData?.description?.match(/\b(lab|dev|prod)\b/i);
  const environment = (titleEnv || notesEnvMatch?.[1] || descriptionEnvMatch?.[1] || "").toUpperCase();
  const displayTitle = rawTitle.replace(/^Sample\s+/i, "").replace(/\s*\([^)]+\)\s*$/, "").trim();

  const rawTechnique = detectionData?.technique_id || "";
  const techniqueLabel =
    rawTechnique === "T1059.003" && /powershell/i.test(rawTitle) ? "T1059.001" : rawTechnique;

  const rawSiemType = detectionData?.siem_type || "Unknown";
  const siemTypeLabel =
    rawSiemType.toLowerCase() === "splunk"
      ? "Splunk Enterprise"
      : rawSiemType.replace(/^./, (char) => char.toUpperCase());

  const eventDate = new Date(alert.time);
  const eventTimestampUtc = Number.isNaN(eventDate.getTime())
    ? "Unknown time"
    : eventDate.toISOString().replace("T", " ").replace("Z", " UTC");

  const severityLabel = alert.severity
    ? alert.severity.toLowerCase().replace(/^./, (char) => char.toUpperCase())
    : "";
  const statusLabel = (alert as any).status
    ? String((alert as any).status).toLowerCase().replace(/^./, (char) => char.toUpperCase())
    : "";

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const severityColor = 
    alert.severity?.toLowerCase() === "critical" || alert.severity?.toLowerCase() === "high"
      ? "bg-red-500/20 text-red-300 border-red-500/40"
      : alert.severity?.toLowerCase() === "medium"
      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
      : "bg-blue-500/20 text-blue-300 border-blue-500/40";

  const content = (
    <div className="space-y-4">
      {/* High-level Event Summary */}
        <Card className="border border-slate-200 bg-white shadow-[0_14px_36px_rgba(15,23,42,0.08)] rounded-3xl gap-2">
          <CardHeader className="pt-6 pb-2 border-b border-slate-200 bg-white !pb-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.32em] text-slate-400">
                <span className="h-1.5 w-10 rounded-full bg-slate-200" />
                Summary
              </div>
              <CardTitle className="mt-3 text-lg font-semibold text-slate-900 flex items-center gap-2">
                <div className="h-10 w-10 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                </div>
                Event Summary
              </CardTitle>
              <CardDescription className="text-xs text-slate-600 mt-0.5">
                Key signal context and detection metadata.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {onToggleExpand && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onToggleExpand}
                  className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                >
                  {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
          <CardContent className="pt-0 pb-5 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
              <div className="space-y-1.5 p-4 rounded-2xl bg-slate-50 border border-slate-200 min-h-[110px] flex flex-col justify-between">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.24em] flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-slate-600" />
                Rule Name
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900 leading-tight">
                <span>{displayTitle}</span>
                {environment && (
                  <Badge className="text-[10px] uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                    {environment}
                  </Badge>
                )}
              </div>
            </div>
              <div className="space-y-1.5 p-4 rounded-2xl bg-slate-50 border border-slate-200 min-h-[110px] flex flex-col justify-between">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.24em] flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-slate-600" />
                MITRE Technique
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {techniqueLabel ? (
                  <Link 
                    href={`/tests/explore?technique=${techniqueLabel}`}
                    className="text-sky-600 hover:text-sky-700 hover:underline inline-flex items-center gap-1"
                  >
                    {techniqueLabel}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="text-slate-500">N/A</span>
                )}
              </div>
            </div>
              <div className="space-y-1.5 p-4 rounded-2xl bg-slate-50 border border-slate-200 min-h-[110px] flex flex-col justify-between">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.24em] flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-slate-600" />
                SIEM Type
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {siemTypeLabel}
              </div>
            </div>
              <div className="space-y-1.5 p-4 rounded-2xl bg-slate-50 border border-slate-200 min-h-[110px] flex flex-col justify-between">
              <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.24em] flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-slate-600" />
                Event time (UTC)
              </div>
              <div className="text-sm font-semibold text-slate-900">
                {eventTimestampUtc}
              </div>
              <div className="text-[10px] text-slate-600 font-medium">
                {formatRelative(new Date(alert.time), new Date())}
              </div>
            </div>
          </div>
          {alert.test_id && (
            <div className="pt-4 border-t border-dashed border-slate-200">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="bg-sky-100 text-sky-700 border border-sky-300 text-sm px-3 py-1.5 focus:outline-none focus:ring-0">
                  Test #{alert.test_id}
                </Badge>
              {alert.severity && (
                <Badge className={cn(
                  "text-sm px-3 py-1.5 focus:outline-none focus:ring-0",
                  alert.severity?.toLowerCase() === "critical" || alert.severity?.toLowerCase() === "high"
                    ? "bg-red-100 text-red-700 border-red-300"
                    : alert.severity?.toLowerCase() === "medium"
                    ? "bg-amber-100 text-amber-700 border-amber-300"
                    : "bg-sky-100 text-sky-700 border-sky-300"
                )}>
                  {severityLabel}
                </Badge>
              )}
              {(alert as any).status && (
                <Badge className={cn(
                  "text-sm px-3 py-1.5 focus:outline-none focus:ring-0",
                  (alert as any).status === "active" || (alert as any).status === "open"
                    ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                    : "bg-slate-100 text-slate-700 border-slate-300"
                )}>
                  {statusLabel}
                </Badge>
              )}
              {alert.test_id && (
                <Badge className={cn(
                  "text-sm px-3 py-1.5 focus:outline-none focus:ring-0",
                  testData?.result === "PASS" 
                    ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                    : testData?.result === "FAIL"
                    ? "bg-red-100 text-red-700 border-red-300"
                    : "bg-slate-100 text-slate-700 border-slate-300"
                )}>
                  {`Result: ${testData?.result || testData?.status || "Unavailable"}`}
                </Badge>
              )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {expanded && (
        <>
          <Tabs defaultValue="raw-logs" className="w-full">
            <TabsList className={cn(
              "bg-white border border-slate-200 rounded-xl p-1.5 h-auto shadow-sm",
              testData ? "grid w-full grid-cols-4 gap-1.5" : "grid w-full grid-cols-2 gap-1.5"
            )}>
              <TabsTrigger 
                value="raw-logs" 
                className="text-sm font-semibold data-[state=active]:bg-slate-200 data-[state=active]:text-black data-[state=active]:shadow-sm data-[state=active]:border-slate-300 !text-black hover:bg-slate-50 transition-all duration-200 rounded-lg px-4 py-2.5 border border-transparent data-[state=active]:border-slate-300"
              >
                <FileText className="h-4 w-4 mr-2 !text-black transition-colors" />
                Raw Logs
              </TabsTrigger>
              <TabsTrigger 
                value="correlation" 
                className="text-sm font-semibold data-[state=active]:bg-slate-200 data-[state=active]:text-black data-[state=active]:shadow-sm data-[state=active]:border-slate-300 !text-black hover:bg-slate-50 transition-all duration-200 rounded-lg px-4 py-2.5 border border-transparent data-[state=active]:border-slate-300"
              >
                <Code className="h-4 w-4 mr-2 !text-black transition-colors" />
                Correlation Logic
              </TabsTrigger>
              {testData && (
                <TabsTrigger 
                  value="test-context" 
                  className="text-sm font-semibold data-[state=active]:bg-slate-200 data-[state=active]:text-black data-[state=active]:shadow-sm data-[state=active]:border-slate-300 !text-black hover:bg-slate-50 transition-all duration-200 rounded-lg px-4 py-2.5 border border-transparent data-[state=active]:border-slate-300"
                >
                  <Server className="h-4 w-4 mr-2 !text-black transition-colors" />
                  Test Context
                </TabsTrigger>
              )}
              {testData && (
                <TabsTrigger 
                  value="scoring" 
                  className="text-sm font-semibold data-[state=active]:bg-slate-200 data-[state=active]:text-black data-[state=active]:shadow-sm data-[state=active]:border-slate-300 !text-black hover:bg-slate-50 transition-all duration-200 rounded-lg px-4 py-2.5 border border-transparent data-[state=active]:border-slate-300"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2 !text-black transition-colors" />
                  Detection Scoring
                </TabsTrigger>
              )}
            </TabsList>

            {/* Raw Logs Tab */}
            <TabsContent value="raw-logs" className="space-y-4 mt-6">
              <Card className="border-2 border-slate-200 bg-white shadow-md">
                <CardHeader className="pb-3 border-b-2 border-slate-200 bg-white">
                  <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <FileText className="h-5 w-5 text-slate-600" />
                    Original Event from SIEM
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-600 mt-1">
                    Raw event payload captured from the SIEM.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  {parsedEvent ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-600">Parsed JSON Event</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(JSON.stringify(parsedEvent, null, 2), "parsed-event")}
                          className="h-6 text-xs"
                        >
                          {copiedField === "parsed-event" ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                      <div className="rounded-lg bg-slate-50 border border-slate-200 overflow-hidden">
                        <pre className="p-4 text-xs text-slate-900 overflow-x-auto font-mono leading-relaxed max-h-96 overflow-y-auto">
                          {JSON.stringify(parsedEvent, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-slate-50 border border-slate-200 overflow-hidden">
                      <pre className="p-4 text-xs text-slate-900 overflow-x-auto font-mono leading-relaxed max-h-96 overflow-y-auto">
                        {alert.raw_event}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>

              {siemEvents && (
                <Card className="border-2 border-slate-200 bg-white shadow-md">
                  <CardHeader className="pb-3 border-b-2 border-slate-200 bg-white">
                    <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                      <Database className="h-5 w-5 text-slate-600" />
                      SIEM Sample Events (from Test)
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-600 mt-1">
                      Parsed events captured during the validation run.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="space-y-3">
                      {Array.isArray(siemEvents) ? (
                        siemEvents.map((event: any, idx: number) => (
                          <div key={idx} className="rounded-lg bg-slate-50 border border-slate-200 overflow-hidden">
                            <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-xs text-slate-600">
                              Event {idx + 1}
                            </div>
                            <pre className="p-4 text-xs text-slate-900 overflow-x-auto font-mono leading-relaxed">
                              {JSON.stringify(event, null, 2)}
                            </pre>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg bg-slate-50 border border-slate-200 overflow-hidden">
                          <pre className="p-4 text-xs text-slate-900 overflow-x-auto font-mono leading-relaxed">
                            {JSON.stringify(siemEvents, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Normalized Fields */}
              {parsedEvent && (
                <Card className="border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-emerald-900/30 to-slate-950/40 backdrop-blur-sm">
                  <CardHeader className="pb-3 border-b border-slate-800/50">
                    <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                      <Eye className="h-4 w-4 text-emerald-400" />
                      Normalized Fields
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(parsedEvent).map(([key, value]) => (
                        <div key={key} className="space-y-1 p-2 rounded bg-slate-900/40 border border-slate-800/50">
                          <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                            {key}
                          </div>
                          <div className="text-xs text-slate-200 font-mono break-all">
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Correlation Logic Tab */}
            <TabsContent value="correlation" className="space-y-4 mt-6">
              <Card className="border-2 border-slate-200 bg-white shadow-md">
                <CardHeader className="pb-3 border-b-2 border-slate-200 bg-white">
                  <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Code className="h-5 w-5 text-slate-600" />
                    Detection Query
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-600 mt-1">
                    SIEM Query that triggered this event
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  {(() => {
                    const query = alert.query || detectionData?.siem_query;
                    const hasQuery = query && query.trim().length > 0;
                    
                    return (
                      <div className="rounded-lg bg-slate-50 border-2 border-slate-200 overflow-hidden">
                        <div className="px-4 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Query</span>
                          {hasQuery && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(query, "query")}
                              className="h-7 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-200"
                            >
                              {copiedField === "query" ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                        {hasQuery ? (
                          <pre className="p-4 text-sm text-slate-900 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto bg-white">
                            {query}
                          </pre>
                        ) : (
                          <div className="p-8 text-center bg-white">
                            <Code className="h-8 w-8 text-slate-400 mx-auto mb-2" />
                            <p className="text-sm text-slate-600 mb-1">No query available</p>
                            <p className="text-xs text-slate-500">The detection query is not available for this event.</p>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

              {detectionData?.siem_query && detectionData.siem_query !== alert.query && (
                <Card className="border-2 border-blue-200 bg-white shadow-md">
                  <CardHeader className="pb-3 border-b-2 border-slate-200 bg-gradient-to-r from-blue-50 to-white">
                    <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                      <Shield className="h-5 w-5 text-blue-600" />
                      Detection Rule Query
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-600 mt-1">
                      Original detection rule query from the detection definition
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="rounded-lg bg-slate-900 border-2 border-slate-300 overflow-hidden shadow-inner">
                      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-300">Rule Query</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(detectionData.siem_query, "rule-query")}
                          className="h-6 text-xs text-slate-400 hover:text-slate-200"
                        >
                          {copiedField === "rule-query" ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                      <pre className="p-4 text-sm text-slate-100 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                        {detectionData.siem_query}
                      </pre>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Field Matching Analysis */}
              {parsedEvent && detectionData?.siem_query && (
                <Card className="border border-sky-500/30 bg-gradient-to-br from-sky-950/40 via-sky-900/30 to-slate-950/40 backdrop-blur-sm">
                  <CardHeader className="pb-3 border-b border-slate-800/50">
                    <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                      <Zap className="h-4 w-4 text-sky-400" />
                      Field Matching Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <div className="space-y-2 text-xs text-slate-300">
                      <p className="text-slate-400 mb-3">
                        The following fields from the event matched the detection rule:
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {Object.keys(parsedEvent).map((key) => {
                          const value = parsedEvent[key];
                          const queryLower = (detectionData.siem_query || "").toLowerCase();
                          const keyLower = key.toLowerCase();
                          const valueStr = String(value).toLowerCase();
                          const matches = queryLower.includes(keyLower) || queryLower.includes(valueStr);
                          
                          return (
                            <div
                              key={key}
                              className={cn(
                                "p-2 rounded border",
                                matches
                                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-200"
                                  : "bg-slate-900/40 border-slate-800/50 text-slate-400"
                              )}
                            >
                              <div className="font-semibold">{key}</div>
                              <div className="text-[10px] font-mono mt-1 truncate">
                                {typeof value === "object" ? JSON.stringify(value) : String(value)}
                              </div>
                              {matches && (
                                <div className="text-[9px] text-emerald-400 mt-1">✓ Matched in query</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Test Context Tab */}
            <TabsContent value="test-context" className="space-y-4 mt-6">
              {loadingTest ? (
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-sm text-slate-400">Loading test context...</div>
                  </CardContent>
                </Card>
              ) : testData ? (
                <>
                  <Card className="border-2 border-sky-200 bg-white shadow-md">
                    <CardHeader className="pb-4 border-b-2 border-slate-200 bg-gradient-to-r from-sky-50 to-white">
                      <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                        <Server className="h-5 w-5 text-sky-600" />
                        Test Run Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Hostname
                          </div>
                          <div className="text-sm font-semibold text-slate-900 font-mono">
                            {alert.host || testData.environment || "N/A"}
                          </div>
                        </div>
                        <div className="space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Environment
                          </div>
                          <div className="text-sm font-semibold text-slate-900">
                            {testData.environment}
                          </div>
                        </div>
                        <div className="space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Test Result
                          </div>
                          <Badge className={cn(
                            "text-xs font-semibold",
                            testData.result === "PASS"
                              ? "bg-emerald-100 text-emerald-700 border-2 border-emerald-300"
                              : testData.result === "FAIL"
                              ? "bg-red-100 text-red-700 border-2 border-red-300"
                              : "bg-slate-100 text-slate-700 border-2 border-slate-300"
                          )}>
                            {testData.result || testData.status}
                          </Badge>
                        </div>
                        <div className="space-y-2 p-3 rounded-lg bg-slate-50 border border-slate-200">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Score
                          </div>
                          <div className="text-sm font-semibold text-slate-900">
                            {testData.score !== undefined ? `${testData.score}%` : "N/A"}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {testData.artifact?.atomic_command && (
                    <Card className="border border-purple-500/30 bg-gradient-to-br from-purple-950/40 via-purple-900/30 to-slate-950/40 backdrop-blur-sm">
                      <CardHeader className="pb-3 border-b border-slate-800/50">
                        <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                          <Activity className="h-4 w-4 text-purple-400" />
                          Atomic Command Executed
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <div className="rounded-lg bg-slate-950/90 border border-slate-800/60 overflow-hidden">
                          <pre className="p-4 text-xs text-slate-200 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap">
                            {testData.artifact.atomic_command}
                          </pre>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {testData.artifact?.ai_explanation && (
                    <Card className="border border-indigo-500/30 bg-gradient-to-br from-indigo-950/40 via-indigo-900/30 to-slate-950/40 backdrop-blur-sm">
                      <CardHeader className="pb-3 border-b border-slate-800/50">
                        <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                          <Zap className="h-4 w-4 text-indigo-400" />
                          AI Analysis
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <div className="text-sm text-slate-300 whitespace-pre-wrap">
                          {testData.artifact.ai_explanation}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-sm text-slate-400">
                      {alert.test_id 
                        ? "Test context not available. This event may not be associated with a test run."
                        : "This event was not generated from a test run."}
                    </div>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Detection Scoring Tab */}
            <TabsContent value="scoring" className="space-y-4 mt-6">
              <Card className="border-2 border-emerald-200 bg-white shadow-md">
                <CardHeader className="pb-4 border-b-2 border-slate-200 bg-gradient-to-r from-emerald-50 to-white">
                  <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    Detection Validation Proof
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-600 mt-1">
                    This event serves as proof that your detection rule is working correctly
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="text-sm text-slate-700">
                    <p className="mb-4 font-medium">
                      This event demonstrates that:
                    </p>
                    <ul className="list-disc list-inside space-y-2 text-slate-600 ml-2">
                      <li>The detection rule triggered as expected</li>
                      <li>The SIEM query matched the event correctly</li>
                      {testData && <li>The test execution produced the expected event</li>}
                      {testData?.result === "PASS" && (
                        <li className="text-emerald-700 font-semibold flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4" />
                          Detection validation passed
                        </li>
                      )}
                    </ul>
                  </div>

                  {testData && (
                    <div className="pt-4 border-t-2 border-slate-200">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2 p-4 rounded-lg bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-sm">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Test Score
                          </div>
                          <div className="text-3xl font-bold text-slate-900">
                            {testData.score !== undefined ? `${testData.score}%` : "N/A"}
                          </div>
                        </div>
                        <div className="space-y-2 p-4 rounded-lg bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-sm">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Test Result
                          </div>
                          <Badge className={cn(
                            "text-sm font-semibold px-3 py-1.5",
                            testData.result === "PASS"
                              ? "bg-emerald-100 text-emerald-700 border-2 border-emerald-300"
                              : testData.result === "FAIL"
                              ? "bg-red-100 text-red-700 border-2 border-red-300"
                              : "bg-slate-100 text-slate-700 border-2 border-slate-300"
                          )}>
                            {testData.result || testData.status}
                          </Badge>
                        </div>
                        <div className="space-y-2 p-4 rounded-lg bg-gradient-to-br from-slate-50 to-white border-2 border-slate-200 shadow-sm">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Last Tested
                          </div>
                          <div className="text-sm font-semibold text-slate-900">
                            {testData.finished_at 
                              ? formatRelative(new Date(testData.finished_at), new Date())
                              : "In progress"}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {alert.detection_id && (
                    <div className="pt-4 border-t-2 border-slate-200">
                      <Link href={`/detections/${alert.detection_id}`}>
                        <Button variant="outline" className="w-full border-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-medium">
                          View Detection Details <ExternalLink className="h-4 w-4 ml-2" />
                        </Button>
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );

  if (showAsCard) {
    return (
      <Card className="border border-slate-800/50 bg-gradient-to-br from-slate-950/40 via-slate-900/30 to-slate-950/40 backdrop-blur-sm">
        <CardContent className="pt-4 pb-4">
          {content}
        </CardContent>
      </Card>
    );
  }

  return content;
}
