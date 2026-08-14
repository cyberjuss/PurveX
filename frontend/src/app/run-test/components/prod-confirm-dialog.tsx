import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-error";
import { toneClasses } from "@/lib/status-tone";
import { cn } from "@/lib/utils";

export function ProdConfirmDialog({
  open,
  onOpenChange,
  targetHost,
  reason,
  onReasonChange,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetHost: string;
  reason: string;
  onReasonChange: (value: string) => void;
  error: string | null;
  onConfirm: (reason: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className={cn("h-5 w-5", toneClasses("danger").icon)} />
            Confirm production run
          </DialogTitle>
          <DialogDescription>
            This executes a real payload against a real production host. Name the reason so there is a record of who
            approved this run and why.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] p-3 text-xs text-[var(--surface-subtle-foreground)] space-y-1">
            <p>
              <span className="font-medium text-[var(--foreground)]">Target host:</span> {targetHost || "—"}
            </p>
            <p>
              <span className="font-medium text-[var(--foreground)]">Environment:</span> Production
            </p>
          </div>
          <div>
            <Label htmlFor="prod-confirm-reason">Reason for this run</Label>
            <Textarea
              id="prod-confirm-reason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="e.g. Validating T1059.001 coverage ahead of the Q3 audit — ticket SEC-482"
              rows={3}
            />
          </div>
          <FormError message={error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onConfirm(reason)}>
            Run in production
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
