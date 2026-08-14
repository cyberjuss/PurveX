import { CheckCircle2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Detection, MitreTechnique } from "@/lib/api";

export function DetectionPicker({
  detections,
  detectionsForUi,
  selectedDetection,
  onSelectDetection,
  detectionSearch,
  onDetectionSearchChange,
  isRunning,
  canCreateDetection,
  onOpenNewDetection,
  techniqueFromExplore,
  scenarioNameFromExplore,
  mitreTechniques,
  selectedSubtechniqueId,
  onSelectSubtechnique,
}: {
  detections: Detection[];
  detectionsForUi: Detection[];
  selectedDetection: string;
  onSelectDetection: (id: string) => void;
  detectionSearch: string;
  onDetectionSearchChange: (value: string) => void;
  isRunning: boolean;
  canCreateDetection: boolean;
  onOpenNewDetection: () => void;
  techniqueFromExplore: string | null;
  scenarioNameFromExplore: string;
  mitreTechniques: MitreTechnique[];
  selectedSubtechniqueId: string;
  onSelectSubtechnique: (id: string) => void;
}) {
  const filteredDetections = detectionsForUi.filter((det) => {
    if (!detectionSearch.trim()) return true;
    const q = detectionSearch.toLowerCase();
    return (
      det.title.toLowerCase().includes(q) ||
      det.technique_id.toLowerCase().includes(q) ||
      (det.siem_type || "").toLowerCase().includes(q)
    );
  });

  const selectedDetectionRecord = detections.find((d) => d.id === selectedDetection);
  const relatedSubtechniques = (() => {
    const techniqueId = selectedDetectionRecord?.technique_id;
    if (!techniqueId || mitreTechniques.length === 0) return [];
    const parentId = techniqueId.split(".")[0];
    return mitreTechniques.filter((t) => t.is_subtechnique && t.id.startsWith(parentId + "."));
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--surface-subtle-foreground)]" />
          <Input
            type="text"
            value={detectionSearch}
            onChange={(e) => onDetectionSearchChange(e.target.value)}
            placeholder="Search detections by name, MITRE technique, or SIEM type..."
            className="pl-10 h-10 bg-[var(--surface-card)] border-[var(--stroke-soft)] text-sm text-[var(--foreground)] placeholder:text-[var(--surface-subtle-foreground)]"
            disabled={isRunning}
          />
        </div>
        {canCreateDetection && (
          <Button
            type="button"
            variant="outline"
            className="h-10 shrink-0"
            onClick={onOpenNewDetection}
            disabled={isRunning}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New detection
          </Button>
        )}
      </div>
      <div className="max-h-64 overflow-y-auto overflow-x-hidden hide-scrollbar space-y-2 border border-[var(--stroke-soft)] rounded-lg p-2 bg-[var(--surface-card)]">
        {filteredDetections.map((det) => {
          const tooltipParts = [
            det.description || "No description provided",
            `SIEM: ${det.siem_type || "N/A"}`,
            `Last tested: ${
              det.last_tested_at
                ? new Date(det.last_tested_at).toISOString().slice(0, 19).replace("T", " ")
                : "Never"
            }`,
            `Last score: ${typeof det.last_score === "number" ? det.last_score : "N/A"}`,
          ];
          const isSelected = selectedDetection === det.id;
          return (
            <button
              key={det.id}
              type="button"
              onClick={() => onSelectDetection(det.id)}
              title={tooltipParts.join(" • ")}
              disabled={isRunning}
              className={cn(
                "w-full text-left px-4 py-3 rounded-lg border-2 transition-all bg-[var(--surface-card)]",
                isRunning
                  ? "border-[var(--stroke-soft)] text-[var(--surface-subtle-foreground)] cursor-not-allowed"
                  : isSelected
                  ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--foreground)] shadow-sm"
                  : "border-[var(--stroke-soft)] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] cursor-pointer"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate text-[var(--foreground)]">{det.title}</div>
                  <div className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
                    {det.technique_id} · {det.siem_type?.toUpperCase() || "SIEM"}
                  </div>
                </div>
                {isSelected && (
                  <CheckCircle2 className="h-5 w-5 text-[var(--accent-strong)] flex-shrink-0 ml-2" />
                )}
              </div>
            </button>
          );
        })}
        {detectionsForUi.length === 0 && (
          <div className="p-4 rounded-lg border border-[var(--stroke-soft)] bg-[var(--surface-elevated)] text-center space-y-2">
            <p className="text-sm text-[var(--surface-subtle-foreground)]">No detections yet.</p>
            {canCreateDetection ? (
              <Button type="button" variant="outline" size="sm" onClick={onOpenNewDetection}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add a detection
              </Button>
            ) : (
              <p className="text-xs text-[var(--surface-subtle-foreground)]">
                Ask an admin to add one, or sync detections from git in Settings.
              </p>
            )}
          </div>
        )}
      </div>
      {detections.length > 0 && (
        <p className="text-xs text-[var(--surface-subtle-foreground)] mt-2">
          Showing <span className="font-semibold text-[var(--foreground)]">{filteredDetections.length}</span> of{" "}
          <span className="font-semibold text-[var(--foreground)]">{detections.length}</span> detections
        </p>
      )}
      {techniqueFromExplore && scenarioNameFromExplore && (
        <p className="mt-1 text-[11px] text-[var(--surface-subtle-foreground)]">
          Scenario from Explore:{" "}
          <span className="font-semibold text-[var(--foreground)]">{scenarioNameFromExplore}</span> (
          {techniqueFromExplore})
        </p>
      )}
      {techniqueFromExplore &&
        detections.filter((d) => d.technique_id === techniqueFromExplore).length === 0 && (
          <p className="mt-1 text-[11px] text-amber-600">
            No detection rules currently match technique {techniqueFromExplore}. Go to the Tests page to design one.
          </p>
        )}

      {relatedSubtechniques.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-[var(--stroke-soft)] pt-4">
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">Optional: Choose Subtechnique</p>
            <p className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
              Select a specific ATT&amp;CK subtechnique, or skip to use the detection&apos;s primary technique
            </p>
          </div>
          <div className="max-h-40 overflow-y-auto overflow-x-hidden hide-scrollbar space-y-2 border border-[var(--stroke-soft)] rounded-lg p-2 bg-[var(--surface-card)]">
            {relatedSubtechniques.map((t) => {
              const isSelected = selectedSubtechniqueId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onSelectSubtechnique(isSelected ? "" : t.id)}
                  className={cn(
                    "w-full text-left px-4 py-2 rounded-lg border-2 transition-all bg-[var(--surface-card)]",
                    isSelected
                      ? "border-[var(--accent-strong)] bg-[var(--accent-soft)] text-[var(--foreground)] shadow-sm"
                      : "border-[var(--stroke-soft)] text-[var(--foreground)] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] cursor-pointer"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate text-[var(--foreground)]">
                        {t.id} · {t.name}
                      </div>
                      <div className="text-xs text-[var(--surface-subtle-foreground)] mt-0.5">
                        {t.tactics.join(", ")}
                      </div>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="h-5 w-5 text-[var(--accent-strong)] flex-shrink-0 ml-2" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
