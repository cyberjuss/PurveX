import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Inline per-field error, rendered right under the input. Keep the DOM node
 * present even when there's no message so screen readers see updates via
 * `aria-live` rather than a mount/unmount.
 */
export function FieldError({
  message,
  id,
  className,
}: {
  message?: string;
  id?: string;
  className?: string;
}) {
  return (
    <p
      id={id}
      role={message ? "alert" : undefined}
      aria-live="polite"
      className={cn(
        "mt-1.5 min-h-[1.25rem] text-xs text-rose-600",
        !message && "sr-only",
        className,
      )}
    >
      {message ?? ""}
    </p>
  );
}

/**
 * Form-level banner for server errors or aggregated validation failures.
 * Prefer `FieldError` for per-field messages; use this only when the failure
 * doesn't map cleanly to a single input.
 */
export function FormError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/[0.05] px-3 py-2.5 text-xs text-rose-800",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
      <span className="min-w-0 flex-1 leading-relaxed">{message}</span>
    </div>
  );
}
