import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PageSkeleton } from "@/components/ui/skeleton";
import { serverGetTests } from "@/lib/api.server";

import { TestsWorkspace } from "./tests-workspace";

/**
 * RSC shell for /tests. All interactive state (SWR, filters, view switcher,
 * router navigation) lives inside the client-only `TestsWorkspace` island.
 *
 * The shell pre-fetches the initial tests list server-side using the
 * incoming browser's auth cookies. The result is handed to the workspace as
 * `initialTests` and installed as SWR's `fallbackData`, so a hydrated user
 * sees real rows on the first paint instead of a skeleton. If the server
 * fetch fails (expired session, backend down, etc.) the value is `null` and
 * the workspace reverts to the pre-existing client-side fetch.
 */
async function TestsData() {
  const initialTests = await serverGetTests();
  return <TestsWorkspace initialTests={initialTests} />;
}

export default function TestsPage() {
  return (
    <Suspense
      fallback={
        <PageContainer maxWidth="full">
          <PageSkeleton stats={4} withActions variant="table" rows={8} />
        </PageContainer>
      }
    >
      <TestsData />
    </Suspense>
  );
}
