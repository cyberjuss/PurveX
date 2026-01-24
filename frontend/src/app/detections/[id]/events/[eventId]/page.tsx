"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertValidationViewer } from "@/components/alerts/alert-validation-viewer";
import {
 type Detection,
 type DetectionAlert,
 type Test,
 getDetectionAlerts,
 getDetection,
 getTest,
} from "@/lib/api";
import { Activity, Cpu, AlertTriangle, Shield } from "lucide-react";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { cn } from "@/lib/utils";

export default function DetectionAlertDetailPage() {
 const params = useParams();
 const detectionId = (params as { id?: string }).id;
 const alertIdRaw = (params as { eventId?: string }).eventId;
 const alertId = alertIdRaw ? Number(alertIdRaw) : NaN;

 const [alerts, setAlerts] = useState<DetectionAlert[]>([]);
 const [detection, setDetection] = useState<Detection | null>(null);
 const [test, setTest] = useState<Test | null>(null);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState<string | null>(null);

 useEffect(() => {
  if (!detectionId || Number.isNaN(alertId)) return;

  let cancelled = false;

  const load = async () => {
   setLoading(true);
   setError(null);
   try {
    // Load alerts and detection in parallel
    // Use Promise.allSettled to prevent unhandled rejections from being logged
    // getDetectionAlerts and getDetection now return null/empty array for 404s instead of throwing
    const results = await Promise.allSettled([
     getDetectionAlerts(detectionId),
     getDetection(detectionId),
    ]);
    
    // Extract values, handling both fulfilled and rejected promises
    const alertsData = results[0].status === 'fulfilled' ? results[0].value : [];
    const detectionData = results[1].status === 'fulfilled' ? results[1].value : null;
    
    // Check for non-404 errors that should be surfaced
    if (results[0].status === 'rejected') {
     const err = results[0].reason;
     const is404 = (err as any)?.is404 || 
            err?.message?.toLowerCase().includes("not found") || 
            err?.message?.toLowerCase().includes("404");
     if (!is404) {
      throw err; // Re-throw non-404 errors
     }
    }
    if (results[1].status === 'rejected') {
     const err = results[1].reason;
     const is404 = (err as any)?.is404 || 
            err?.message?.toLowerCase().includes("not found") || 
            err?.message?.toLowerCase().includes("404");
     if (!is404) {
      throw err; // Re-throw non-404 errors
     }
    }

    if (cancelled) return;

    setAlerts(alertsData);
    setDetection(detectionData);

    const matchingAlert = alertsData.find((a) => a.id === alertId);
    // Optionally load test data if available, but don't fail if it's missing
    if (matchingAlert?.test_id) {
     try {
      const testData = await getTest(matchingAlert.test_id);
      // getTest now returns null for 404s instead of throwing
      if (!cancelled && testData) {
       setTest(testData);
      }
      // If testData is null, test doesn't exist - this is expected and we just continue
     } catch (err: any) {
      // Only catch non-404 errors (network errors, auth errors, etc.)
      // 404s are now handled by getTest returning null
      // Suppress console errors for expected 404s
      if (!err?.message?.toLowerCase().includes("not found") && 
        !err?.message?.toLowerCase().includes("404") &&
        !(err as any)?.is404) {
       // Only log unexpected errors
       if (process.env.NODE_ENV === 'development') {
        console.debug("Error loading test data:", matchingAlert.test_id, err);
       }
      }
     }
    }
   } catch (err: any) {
    if (!cancelled) {
     // Only log and show errors that aren't expected 404s
     const isExpected404 = err?.message?.toLowerCase().includes("not found") || 
                err?.message?.toLowerCase().includes("404") ||
                (err as any)?.is404;
     
     if (!isExpected404) {
      console.error("Unable to load event details.", err);
      setError("Unable to load event details. Please try again.");
     } else {
      // For expected 404s, just set empty state without error message
      setAlerts([]);
      setDetection(null);
     }
    }
   } finally {
    if (!cancelled) setLoading(false);
   }
  };

  load();

  return () => {
   cancelled = true;
  };
 }, [alertId, detectionId]);

 const alert = alerts.find((a) => a.id === alertId);

 let content: React.ReactNode = null;

 if (!detectionId || Number.isNaN(alertId)) {
  content = (
   <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
    Invalid event link.
   </div>
  );
 } else if (loading) {
  content = <p className="text-slate-600 text-sm">Loading event details.</p>;
 } else if (error) {
  content = (
   <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
    {error}
   </div>
  );
 } else if (!alert) {
  content = (
   <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
    No event details were found for this link in the demo feed. Try going back to Detections
    and selecting a fresh event.
   </div>
  );
 } else {
  content = (
   <div className="space-y-6">
    <AlertValidationViewer
     alert={{
      ...alert,
      detection_id: detectionId,
      detection_title: detection?.title,
     }}
     detection={detection ?? undefined}
     test={test ?? undefined}
     expanded
     showAsCard={false}
    />
   </div>
  );
 }

 const eventTime = alert?.time || alert?.created_at;
 const eventTimeLabel = eventTime ? new Date(eventTime).toLocaleString() : "Unknown time";
 const eventStatus = (alert as any)?.status || "active";

  return (
    <PageContainer maxWidth="xl">
      <PageHeader
        eyebrow="Detection event"
        title={alert?.name || "Event details"}
        subtitle={detection?.notes || "Purpose not set."}
        icon={<Shield className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              asChild
              size="sm"
              variant="outline"
              className="border-slate-300 bg-white text-slate-900 hover:bg-slate-50"
            >
              <Link href={`/run-test?detectionId=${detectionId}`}>
                <Activity className="h-4 w-4 mr-2" />
                Run Test
              </Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-slate-300 text-slate-700 hover:bg-slate-50"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.href = `/agent?detectionId=${detectionId}&alertId=${alert?.id}`;
                }
              }}
            >
              <Cpu className="h-4 w-4 mr-2" />
              Ask Watchtower
            </Button>
          </div>
        }
      />
      <div className="space-y-6">
    {alert && (
          <Card className="border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)] overflow-hidden rounded-3xl">
            <CardContent className="p-0">
              <div className="px-6 py-6 sm:px-10 sm:py-8">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div className="min-w-0">
                    <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.32em] text-slate-400">
                      <span className="h-1.5 w-10 rounded-full bg-slate-200" />
                      Event Overview
                    </div>
                    <h1 className="mt-3 text-2xl sm:text-3xl font-semibold text-slate-900">
                      {alert.name || "Event details"}
                    </h1>
                    <p className="text-sm text-slate-600 mt-2 max-w-2xl">
                      {detection?.notes || "Purpose not set."}
                    </p>
                  </div>
                </div>
                <div className="mt-6 flex flex-wrap gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
                    <Activity className="h-3.5 w-3.5 text-slate-500" />
                    Host: {alert.host || "Unknown"}
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-700">
                    <Shield className="h-3.5 w-3.5 text-slate-500" />
                    Source: {alert.source || "SIEM"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

    {content}
   </div>
  </PageContainer>
 );
}
