"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { toneClasses } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageContainer>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-xl rounded-[28px] border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-8 text-center shadow-[0_20px_48px_-36px_rgba(15,23,42,0.55)]">
          <div className={cn("mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 dark:bg-rose-500/10", toneClasses("danger").icon)}>
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h2 className="text-2xl font-display font-semibold text-[var(--surface-card-foreground)]">Something went wrong</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--surface-subtle-foreground)]">
            PurveX hit an unexpected error while loading this page. Retry the view, and if the problem
            persists, inspect the backend logs for the underlying exception.
          </p>
          <div className="mt-6 flex justify-center">
            <Button onClick={() => reset()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Try again
            </Button>
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
