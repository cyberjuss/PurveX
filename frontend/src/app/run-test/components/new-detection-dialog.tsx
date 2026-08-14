import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { createDetection, type Detection } from "@/lib/api";

export function NewDetectionDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (detection: Detection) => void;
}) {
  const [title, setTitle] = useState("");
  const [technique, setTechnique] = useState("");
  const [siemType, setSiemType] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setTechnique("");
    setSiemType("");
    setQuery("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedTechnique = technique.trim().toUpperCase();
    const trimmedSiemType = siemType.trim();
    const trimmedQuery = query.trim();

    if (!trimmedTitle || !trimmedTechnique || !trimmedSiemType || !trimmedQuery) {
      setError("Fill in title, technique, SIEM type, and query.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createDetection({
        technique_id: trimmedTechnique,
        title: trimmedTitle,
        siem_type: trimmedSiemType,
        siem_query: trimmedQuery,
      });
      onCreated(created);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create detection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New detection</DialogTitle>
          <DialogDescription>
            Add a minimal detection record so you can validate it right away, without leaving this flow.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="new-detection-title">Title</Label>
            <Input
              id="new-detection-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Suspicious PowerShell Execution"
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="new-detection-technique">MITRE technique</Label>
              <Input
                id="new-detection-technique"
                value={technique}
                onChange={(e) => setTechnique(e.target.value)}
                placeholder="T1059.001"
                disabled={saving}
              />
            </div>
            <div>
              <Label htmlFor="new-detection-siem">SIEM type</Label>
              <Input
                id="new-detection-siem"
                value={siemType}
                onChange={(e) => setSiemType(e.target.value)}
                placeholder="splunk"
                disabled={saving}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="new-detection-query">SIEM query</Label>
            <Textarea
              id="new-detection-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="index=main sourcetype=powershell ..."
              rows={4}
              disabled={saving}
            />
          </div>
          <FormError message={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  Creating
                </>
              ) : (
                "Create detection"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
