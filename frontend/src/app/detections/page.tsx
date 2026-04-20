import { Suspense } from "react";

import { serverGetDetections } from "@/lib/api.server";

import { DetectionsWorkspace } from "./detections-workspace";

/**
 * RSC shell for /detections. All interactive state (SWR, search, view
 * switcher, detail panel) lives inside the client-only `DetectionsWorkspace`
 * island.
 *
 * The shell pre-fetches the initial detections list server-side using the
 * incoming browser's auth cookies. The result is handed to the workspace as
 * `initialDetections` and becomes SWR's `fallbackData`, so the library
 * renders immediately on first paint. When the server fetch is unavailable
 * (unauthenticated, backend down, etc.) the value is `null` and the
 * workspace reverts to its original client-side fetch.
 */
async function DetectionsData() {
  const initialDetections = await serverGetDetections();
  return <DetectionsWorkspace initialDetections={initialDetections} />;
}

export default function DetectionsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface-page)]" />}>
      <DetectionsData />
    </Suspense>
  );
}
