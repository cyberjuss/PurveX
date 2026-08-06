import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Marketing site's pricing page — where every paid-plan upgrade link points. */
export const PRICING_URL = "https://purvex-llc.com/pricing";

/**
 * True when an `apiFetch()` call failed because the org's plan doesn't cover
 * it (seat/runner/daily-run limit, or a paid-only feature) — apiFetch tags
 * these with `isUpgradeRequired` on a 402 response. Distinct from a 403,
 * which means "not allowed" rather than "not on your plan."
 */
export function isUpgradeRequiredError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { isUpgradeRequired?: boolean }).isUpgradeRequired === true;
}

// The backend's 402 detail message already ends with its own "Upgrade at
// purvex-llc.com/pricing" sentence. Strip it here since the banner has its
// own button doing that job — keeps the message from saying it twice.
function stripUpgradeSuffix(message: string): string {
  return message.replace(/\s*Upgrade at purvex-llc\.com\/pricing[^.]*\.?\s*$/i, "").trim();
}

/**
 * Inline banner for a caught `isUpgradeRequiredError`. Drop this in wherever
 * a gated action (create schedule, invite past seat limit, generate a PDF
 * report, ...) can 402 — same call site that would otherwise render a
 * generic `FormError`.
 */
export function UpgradeBanner({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-400/25 dark:bg-amber-400/[0.08] dark:text-amber-100",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span className="min-w-0 leading-relaxed">{stripUpgradeSuffix(message)}</span>
      </div>
      <Button
        asChild
        size="sm"
        variant="outline"
        className="shrink-0 border-amber-500/40 text-amber-900 hover:bg-amber-500/10 dark:border-amber-400/40 dark:text-amber-100"
      >
        <a href={PRICING_URL} target="_blank" rel="noreferrer">
          Upgrade plan
        </a>
      </Button>
    </div>
  );
}
