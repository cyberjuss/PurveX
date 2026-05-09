"use client";

/**
 * Small dialog for filing an AI-authored proposal.
 *
 * Intent: when the Watchtower assistant surfaces a concrete remediation,
 * the user clicks "File as proposal" to route that advice through the
 * guardrail flow (policy check on create, human review on apply) rather
 * than editing the detection in place. The dialog stays intentionally
 * minimal — field + value + reason — so the AI output is the heaviest
 * thing on screen.
 */

import { useMemo, useState } from "react";
import { FileEdit, ShieldCheck } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormError } from "@/components/ui/form-error";
import {
  createProposal,
  type Detection,
  type DetectionProposal,
} from "@/lib/api";

// Fields users are allowed to propose changes to. Kept in sync with
// PROPOSAL_EDITABLE_FIELDS on the backend; a narrower UI-level list keeps
// the common cases surfaced first. ``description`` and ``sigma_rule`` are
// multi-line; everything else is a single-line string.
const EDITABLE_FIELDS: {
  key: string;
  label: string;
  multiline?: boolean;
}[] = [
  { key: "siem_query", label: "SIEM query", multiline: true },
  { key: "description", label: "Description", multiline: true },
  { key: "sigma_rule", label: "Sigma rule", multiline: true },
  { key: "title", label: "Title" },
  { key: "technique_id", label: "MITRE technique" },
  { key: "status", label: "Status" },
  { key: "owner", label: "Owner" },
  { key: "notes", label: "Notes", multiline: true },
];

interface ProposeFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detection: Detection | null;
  proposerLabel?: string;
  initialField?: string;
  initialValue?: string;
  initialReason?: string;
  onSubmitted?: (proposal: DetectionProposal) => void;
}

export function ProposeFixDialog({
  open,
  onOpenChange,
  detection,
  proposerLabel = "PurveX Assistant",
  initialField = "siem_query",
  initialValue = "",
  initialReason = "",
  onSubmitted,
}: ProposeFixDialogProps) {
  const [field, setField] = useState(initialField);
  const [value, setValue] = useState(initialValue);
  const [reason, setReason] = useState(initialReason);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldMeta = useMemo(
    () => EDITABLE_FIELDS.find((f) => f.key === field),
    [field],
  );

  const currentValue = useMemo<string>(() => {
    if (!detection) return "";
    const raw = (detection as unknown as Record<string, unknown>)[field];
    return typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  }, [detection, field]);

  async function handleSubmit() {
    if (!detection) {
      setError("Select a detection before filing a proposal.");
      return;
    }
    if (!value.trim()) {
      setError("Provide a new value for the field.");
      return;
    }
    if (value.trim() === currentValue) {
      setError("New value matches the current value — nothing to propose.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const created = await createProposal({
        detection_id: detection.id,
        action: "update",
        proposed_by_kind: "ai",
        proposed_by_label: proposerLabel,
        reason: reason.trim() || null,
        target_fields: { [field]: value },
      });
      onSubmitted?.(created);
      onOpenChange(false);
      setValue("");
      setReason("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to file proposal.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(calc(100vw-2rem),32rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[var(--accent-strong)]" />
            File as proposal
          </DialogTitle>
          <p className="text-sm text-[var(--surface-subtle-foreground)]">
            Route this change through the approval inbox instead of editing
            the detection directly. A human reviewer will see the diff and
            apply or reject it.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
              Target detection
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">
              {detection?.title ?? "(none selected)"}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
              Field
            </label>
            <Select value={field} onValueChange={(v) => setField(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_FIELDS.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)]">
              Current value
            </label>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-2 text-xs text-[var(--surface-subtle-foreground)]">
              {currentValue || "—"}
            </pre>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="propose-value"
              className="text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)]"
            >
              Proposed value
            </label>
            {fieldMeta?.multiline ? (
              <Textarea
                id="propose-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={5}
                maxLength={10000}
              />
            ) : (
              <input
                id="propose-value"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="w-full rounded-md border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--foreground)] focus:border-[var(--accent-line)] focus:outline-none"
                maxLength={2000}
              />
            )}
          </div>

          <div className="space-y-2">
            <label
              htmlFor="propose-reason"
              className="text-xs uppercase tracking-wider text-[var(--surface-subtle-foreground)]"
            >
              Rationale (shown to reviewer)
            </label>
            <Textarea
              id="propose-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="Why this change? What did the AI observe?"
            />
          </div>

          <FormError message={error} />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            <FileEdit className="mr-1 h-4 w-4" />
            {submitting ? "Filing…" : "File proposal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
