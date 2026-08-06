import { Sparkles, UserPlus, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Marketing site's pricing page — where every free-plan upgrade link points. */
export const PRICING_URL = "https://purvex-llc.com/pricing";
/** Self-service "buy one more seat" purchase — where a paid org that hit
 * its own license's seat cap gets sent, distinct from the pricing page it
 * has already been through. */
export const ADD_SEAT_URL = "https://purvex-llc.com/add-seat";

/**
 * True when an `apiFetch()` call failed because the org's plan doesn't cover
 * it (seat/runner/daily-run limit, or a paid-only feature) — apiFetch tags
 * these with `isUpgradeRequired` on a 402 response. Distinct from a 403,
 * which means "not allowed" rather than "not on your plan."
 */
export function isUpgradeRequiredError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { isUpgradeRequired?: boolean }).isUpgradeRequired === true;
}

// The backend appends one of two trailing sentences to a 402, depending on
// which limit was hit and what plan the org is on. Free tier: "Upgrade at
// purvex-llc.com/pricing..." (there's a whole plan to sell). Paid tier that
// hit its own license's specific cap: "Add a seat at
// purvex-llc.com/add-seat..." (they already have a plan; they just need one
// more unit of it). Runner-limit-on-paid has no suffix at all -- runners
// aren't sold a la carte -- so the banner falls back to plain text with no
// button for anything that doesn't match either pattern.
const CTA_PATTERNS: { pattern: RegExp; label: string; url: string; icon: typeof Sparkles }[] = [
  { pattern: /\s*Upgrade at purvex-llc\.com\/pricing[^.]*\.?\s*$/i, label: "Upgrade plan", url: PRICING_URL, icon: Sparkles },
  { pattern: /\s*Add a seat at purvex-llc\.com\/add-seat[^.]*\.?\s*$/i, label: "Add a seat", url: ADD_SEAT_URL, icon: UserPlus },
];

function resolveCta(message: string) {
  for (const cta of CTA_PATTERNS) {
    if (cta.pattern.test(message)) {
      return { cta, displayMessage: message.replace(cta.pattern, "").trim() };
    }
  }
  return { cta: null, displayMessage: message };
}

/**
 * Inline banner for a caught `isUpgradeRequiredError`. Drop this in wherever
 * a gated action (create schedule, invite past seat limit, generate a PDF
 * report, ...) can 402 — same call site that would otherwise render a
 * generic `FormError`.
 */
export function UpgradeBanner({ message, className }: { message: string; className?: string }) {
  const { cta, displayMessage } = resolveCta(message);
  const Icon = cta?.icon ?? Info;

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-400/25 dark:bg-amber-400/[0.08] dark:text-amber-100",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span className="min-w-0 leading-relaxed">{displayMessage}</span>
      </div>
      {cta ? (
        <Button
          asChild
          size="sm"
          variant="outline"
          className="shrink-0 border-amber-500/40 text-amber-900 hover:bg-amber-500/10 dark:border-amber-400/40 dark:text-amber-100"
        >
          <a href={cta.url} target="_blank" rel="noreferrer">
            {cta.label}
          </a>
        </Button>
      ) : null}
    </div>
  );
}
