"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";

/**
 * Settings page primitives.
 *
 * Layout language (intentionally NOT card-on-card):
 * - Page-wide chrome (`SettingsPageShell`) renders a back link, title block,
 *   and the section list with hairline dividers between sections.
 * - Each `SettingsSection` is a two-column row: label + description on the
 *   left, controls on the right. No box around it — the divider does the
 *   visual separation.
 * - `SettingsRow` is the inline "switch with label" pattern used inside
 *   sections so toggles read like a vertical list, not a checkbox grid.
 * - `SettingsSaveBar` sticks to the bottom and only shows when the form is
 *   dirty (or always, if you prefer the explicit affordance).
 *
 * The result: every settings page reads top-to-bottom as a list of
 * "what" → "controls", which is the established pattern users learn from
 * GitHub / Linear / Stripe / Vercel.
 */

interface SettingsPageShellProps {
  eyebrow?: string;
  title: string;
  description?: string;
  /** Right-aligned chips/badges shown next to the title (e.g. "Configured"). */
  status?: ReactNode;
  /** Top-right slot for actions like "Add connection". */
  actions?: ReactNode;
  /** Banner shown above sections (errors, permission warnings, etc.). */
  banner?: ReactNode;
  /** Where the back link points. Defaults to /settings. */
  backHref?: string;
  backLabel?: string;
  /**
   * Inner content width. "form" (default) is the narrow Stripe-style form
   * column. "wide" is for list/table-heavy pages like Audit or Users.
   */
  width?: "form" | "wide";
  /** Render section dividers between children. Disable for fully custom content. */
  divided?: boolean;
  children: ReactNode;
}

export function SettingsPageShell({
  eyebrow,
  title,
  description,
  status,
  actions,
  banner,
  backHref = "/settings",
  backLabel = "Back to Settings",
  width = "form",
  divided = true,
  children,
}: SettingsPageShellProps) {
  const widthClass = width === "wide" ? "max-w-6xl" : "max-w-3xl";
  return (
    <PageContainer maxWidth={width === "wide" ? "full" : "lg"} className="pb-32">
      <div className={cn("mx-auto w-full space-y-6 px-2 sm:px-4", widthClass)}>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--surface-subtle-foreground)] transition-colors hover:text-[var(--surface-card-foreground)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>

        <header className="space-y-2">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-strong)]">
              {eyebrow}
            </p>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h1 className="text-2xl font-display font-semibold tracking-tight text-[var(--surface-card-foreground)]">
                {title}
              </h1>
              {description ? (
                <p className="text-sm leading-relaxed text-[var(--surface-subtle-foreground)]">
                  {description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {status}
              {actions}
            </div>
          </div>
        </header>

        {banner}

        <div
          className={cn(
            divided &&
              "divide-y divide-[var(--stroke-soft)] border-y border-[var(--stroke-soft)]"
          )}
        >
          {children}
        </div>
      </div>
    </PageContainer>
  );
}

interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  /** Optional small badge on the section header (e.g. "Required"). */
  badge?: ReactNode;
  children: ReactNode;
  /** Force single-column rendering (rare; defaults to two-column on md+). */
  stacked?: boolean;
}

export function SettingsSection({
  title,
  description,
  badge,
  children,
  stacked = false,
}: SettingsSectionProps) {
  return (
    <section
      className={cn(
        "grid gap-6 py-7",
        stacked ? "grid-cols-1" : "md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]"
      )}
    >
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--surface-card-foreground)]">
            {title}
          </h2>
          {badge}
        </div>
        {description ? (
          <p className="text-xs leading-5 text-[var(--surface-subtle-foreground)]">
            {description}
          </p>
        ) : null}
      </header>
      <div className="min-w-0 space-y-4">{children}</div>
    </section>
  );
}

interface SettingsRowProps {
  label: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  /** When true, renders without inline border so it can sit inside a denser group. */
  flat?: boolean;
}

/**
 * "List row with a control on the right" — the GitHub repo settings pattern.
 * Use inside a SettingsSection for switches, toggles, simple checkboxes, or
 * inline action buttons.
 */
export function SettingsRow({ label, description, control, flat = false }: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-3",
        !flat && "first:pt-0 last:pb-0"
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--surface-card-foreground)]">{label}</p>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-[var(--surface-subtle-foreground)]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{control}</div>
    </div>
  );
}

interface SettingsBannerProps {
  tone?: "info" | "warning" | "danger" | "success";
  icon?: ReactNode;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}

const BANNER_TONES: Record<NonNullable<SettingsBannerProps["tone"]>, string> = {
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
  danger:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100",
};

export function SettingsBanner({
  tone = "info",
  icon,
  title,
  children,
  action,
}: SettingsBannerProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
        BANNER_TONES[tone]
      )}
      role={tone === "danger" ? "alert" : "status"}
    >
      <div className="mt-0.5 shrink-0">{icon ?? <AlertCircle className="h-4 w-4" />}</div>
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={cn("text-sm leading-relaxed", title && "mt-0.5")}>{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

interface SettingsSaveBarProps {
  /** Whether the save button is enabled. Disabled when form is clean or saving. */
  saving?: boolean;
  dirty?: boolean;
  onSave?: () => void;
  onReset?: () => void;
  saveLabel?: string;
  resetLabel?: string;
  message?: ReactNode;
}

/**
 * Sticky bottom bar with Save / Reset. Only shown when there are pending
 * changes (`dirty=true`) — keeps the page calm at rest, surfaces clearly
 * when there's work to commit.
 */
export function SettingsSaveBar({
  saving = false,
  dirty = false,
  onSave,
  onReset,
  saveLabel = "Save changes",
  resetLabel = "Discard",
  message,
}: SettingsSaveBarProps) {
  if (!dirty && !saving) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--stroke-soft)] bg-[var(--surface-card)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--surface-card)]/85">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-6 py-3">
        <p className="truncate text-xs text-[var(--surface-subtle-foreground)]">
          {message ?? (dirty ? "You have unsaved changes." : null)}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {onReset ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={saving || !dirty}
            >
              {resetLabel}
            </Button>
          ) : null}
          <Button type="button" size="sm" onClick={onSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SettingsStatusPillProps {
  tone?: "ok" | "warn" | "muted" | "danger";
  children: ReactNode;
}

const PILL_TONES: Record<NonNullable<SettingsStatusPillProps["tone"]>, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  warn: "bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20",
  muted:
    "bg-[var(--surface-elevated)] text-[var(--surface-subtle-foreground)] ring-[var(--stroke-soft)]",
  danger:
    "bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20",
};

export function SettingsStatusPill({ tone = "muted", children }: SettingsStatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
        PILL_TONES[tone]
      )}
    >
      {children}
    </span>
  );
}
