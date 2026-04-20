import { cn } from "@/lib/utils";

type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-[var(--surface-elevated)]",
        className,
      )}
      {...props}
    />
  );
}

export function SkeletonText({ className }: { className?: string }) {
  return <Skeleton className={cn("h-4 w-full", className)} />;
}

export function SkeletonTableRows({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-[var(--stroke-soft)]">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-4">
              <Skeleton className="h-4 w-3/4" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function SkeletonStatCard() {
  return (
    <div className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-5">
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-2 h-8 w-20" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)] p-6">
      <Skeleton className="mb-4 h-5 w-48" />
      <Skeleton className="mb-2 h-3 w-full" />
      <Skeleton className="mb-2 h-3 w-5/6" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

export function SkeletonListRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-[var(--stroke-soft)] rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonHeader({
  withEyebrow = false,
  withActions = false,
}: {
  withEyebrow?: boolean;
  withActions?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-2xl" />
        <div className="space-y-2">
          {withEyebrow && <Skeleton className="h-3 w-24" />}
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
      </div>
      {withActions && (
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-32 rounded-lg" />
        </div>
      )}
    </div>
  );
}

/**
 * PageSkeleton — a composed, opinionated skeleton for top-level routes that
 * follow the common pattern: header row, optional stat strip, one or more
 * data blocks. Use as the default `loading` state for data-heavy pages so
 * every route feels the same while data is fetching.
 */
export function PageSkeleton({
  stats = 0,
  withEyebrow = false,
  withActions = false,
  variant = "list",
  rows = 6,
}: {
  stats?: number;
  withEyebrow?: boolean;
  withActions?: boolean;
  variant?: "list" | "cards" | "table" | "detail";
  rows?: number;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="space-y-6"
    >
      <span className="sr-only">Loading…</span>
      <SkeletonHeader withEyebrow={withEyebrow} withActions={withActions} />

      {stats > 0 && (
        <div
          className={cn(
            "grid gap-4",
            stats === 2 && "sm:grid-cols-2",
            stats === 3 && "sm:grid-cols-2 lg:grid-cols-3",
            stats === 4 && "sm:grid-cols-2 lg:grid-cols-4",
            stats >= 5 && "sm:grid-cols-2 lg:grid-cols-5",
          )}
        >
          {Array.from({ length: stats }).map((_, i) => (
            <SkeletonStatCard key={i} />
          ))}
        </div>
      )}

      {variant === "list" && <SkeletonListRows rows={rows} />}

      {variant === "cards" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {variant === "table" && (
        <div className="overflow-hidden rounded-xl border border-[var(--stroke-soft)] bg-[var(--surface-card)]">
          <table className="w-full text-left text-sm">
            <tbody>
              <SkeletonTableRows rows={rows} columns={5} />
            </tbody>
          </table>
        </div>
      )}

      {variant === "detail" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <div className="space-y-4">
            <SkeletonStatCard />
            <SkeletonStatCard />
          </div>
        </div>
      )}
    </div>
  );
}
