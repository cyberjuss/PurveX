"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTestSchedules, createTestSchedule, deleteTestSchedule, getDetections, getMitreTechniques, type TestSchedule, type Detection, type MitreTechnique, TestRunMode } from "@/lib/api";
import {
  Calendar, Clock, Pause, Trash2, Plus, RefreshCw, AlertCircle, CheckCircle2,
  TestTube, FileText
} from "lucide-react";
import { format, formatRelative, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { usePermissions } from "@/hooks/usePermissions";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function TestSchedulesPage() {
  const { canScheduleTest, loading: permissionsLoading } = usePermissions();
  const canManageSchedules =
    canScheduleTest("lab") || canScheduleTest("dev") || canScheduleTest("prod");
  const [schedules, setSchedules] = useState<TestSchedule[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [mitreTechniques, setMitreTechniques] = useState<MitreTechnique[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<number | null>(null);

  const [formDetectionId, setFormDetectionId] = useState<string>("none");
  const [formTechniqueId, setFormTechniqueId] = useState<string>("");
  const [formEnvironment, setFormEnvironment] = useState<"lab" | "dev" | "prod">("lab");
  const [formMode, setFormMode] = useState<TestRunMode>("DETECTION_VALIDATION");
  const [formScheduleType, setFormScheduleType] = useState<"once" | "interval" | "cron">("once");
  const [formRunAt, setFormRunAt] = useState<string>("");
  const [formIntervalMinutes, setFormIntervalMinutes] = useState<string>("60");
  const [formCronExpression, setFormCronExpression] = useState<string>("0 * * * *");
  const [creating, setCreating] = useState(false);

  const fetchSchedules = async () => {
    try {
      setLoadError(null);
      const data = await getTestSchedules();
      setSchedules(data);
    } catch (error: unknown) {
      setLoadError(getErrorMessage(error, "Failed to load test schedules"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setLoadError(null);
      try {
        const [schedulesData, detectionsData, techniquesData] = await Promise.all([
          getTestSchedules(),
          getDetections().catch(() => []),
          getMitreTechniques().catch(() => []),
        ]);
        setSchedules(schedulesData);
        setDetections(detectionsData);
        setMitreTechniques(techniquesData);
      } catch (error: unknown) {
        setLoadError(getErrorMessage(error, "Failed to load data"));
      } finally {
        setLoading(false);
      }
    }
    void loadData();
  }, []);

  const handleCreateSchedule = async () => {
    const detectionId = formDetectionId === "none" ? "" : formDetectionId;
    if (!detectionId && !formTechniqueId) {
      setFormError("Please select either a detection or technique");
      return;
    }

    if (formScheduleType === "once" && !formRunAt) {
      setFormError("Please select a date and time for the one-time schedule");
      return;
    }

    if (formScheduleType === "interval") {
      const minutes = parseInt(formIntervalMinutes, 10);
      if (!minutes || minutes <= 0) {
        setFormError("Please enter a valid interval in minutes");
        return;
      }
    }

    if (formScheduleType === "cron" && !formCronExpression) {
      setFormError("Please enter a cron expression");
      return;
    }

    try {
      setCreating(true);
      setFormError(null);

      await createTestSchedule({
        detectionId: detectionId || null,
        techniqueId: formTechniqueId || null,
        environment: formEnvironment,
        mode: formMode,
        scheduleType: formScheduleType,
        runAt: formScheduleType === "once" ? formRunAt : null,
        intervalMinutes: formScheduleType === "interval" ? parseInt(formIntervalMinutes, 10) : null,
        cronExpression: formScheduleType === "cron" ? formCronExpression : null,
      });

      setCreateDialogOpen(false);
      setFormDetectionId("none");
      setFormTechniqueId("");
      setFormEnvironment("lab");
      setFormMode("DETECTION_VALIDATION");
      setFormScheduleType("once");
      setFormRunAt("");
      setFormIntervalMinutes("60");
      setFormCronExpression("0 * * * *");
      setFormError(null);

      await fetchSchedules();
    } catch (error: unknown) {
      setFormError(getErrorMessage(error, "Failed to create schedule"));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId: number) => {
    try {
      setDeleteError(null);
      await deleteTestSchedule(scheduleId);
      await fetchSchedules();
      setDeleteDialogOpen(null);
    } catch (error: unknown) {
      setDeleteError(getErrorMessage(error, "Failed to delete schedule"));
    }
  };

  const getScheduleDescription = (schedule: TestSchedule) => {
    if (schedule.schedule_type === "once") {
      return schedule.run_at ? `Run once at ${format(parseISO(schedule.run_at), "MMM d, yyyy h:mm a")}` : "One-time schedule";
    }
    if (schedule.schedule_type === "interval") {
      const hours = schedule.interval_seconds ? Math.floor(schedule.interval_seconds / 3600) : 0;
      const minutes = schedule.interval_seconds ? Math.floor((schedule.interval_seconds % 3600) / 60) : 0;
      if (hours > 0 && minutes > 0) return `Every ${hours}h ${minutes}m`;
      if (hours > 0) return `Every ${hours} hour${hours > 1 ? "s" : ""}`;
      return `Every ${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    return `Cron: ${schedule.cron_expression || "N/A"}`;
  };

  const getNextRunDisplay = (schedule: TestSchedule) => {
    if (!schedule.next_run_at) return "Not scheduled";
    const nextRun = parseISO(schedule.next_run_at);
    const now = new Date();
    if (nextRun < now) return "Due now";
    return formatRelative(nextRun, now);
  };

  if (permissionsLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-[var(--surface-subtle-foreground)]" />
        </div>
      </PageContainer>
    );
  }

  if (!canManageSchedules) {
    return (
      <PageContainer>
        <Card className="border-[var(--stroke-soft)] bg-[var(--surface-card)]">
          <CardContent className="py-12 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-[var(--surface-subtle-foreground)]" />
            <p className="text-[var(--surface-subtle-foreground)]">You do not have permission to manage validation schedules.</p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Validation automation"
        title="Test Schedules"
        subtitle="Automate validation cadence so detection trust stays current without depending on memory."
        icon={<Calendar className="h-5 w-5" />}
        actions={
          <Dialog open={createDialogOpen} onOpenChange={(open) => { setCreateDialogOpen(open); if (!open) setFormError(null); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Create Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Test Schedule</DialogTitle>
                <DialogDescription>
                  Configure a validation to run automatically at a specific time or interval.
                </DialogDescription>
              </DialogHeader>

              {formError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {formError}
                </div>
              )}

              <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="detection">Detection (Optional)</Label>
                    <Select value={formDetectionId} onValueChange={setFormDetectionId}>
                      <SelectTrigger id="detection">
                        <SelectValue placeholder="Select detection" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {detections.map((detection) => (
                          <SelectItem key={detection.id} value={detection.id}>{detection.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="technique">Technique (Optional)</Label>
                    <Select value={formTechniqueId || "none"} onValueChange={(value) => setFormTechniqueId(value === "none" ? "" : value)}>
                      <SelectTrigger id="technique">
                        <SelectValue placeholder="Select technique" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {mitreTechniques.map((technique) => (
                          <SelectItem key={technique.id} value={technique.id}>
                            {technique.id} · {technique.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="environment">Environment</Label>
                    <Select value={formEnvironment} onValueChange={(value) => setFormEnvironment(value as "lab" | "dev" | "prod")}>
                      <SelectTrigger id="environment">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lab">Lab</SelectItem>
                        <SelectItem value="dev">Dev</SelectItem>
                        <SelectItem value="prod">Prod</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mode">Test Mode</Label>
                    <Select value={formMode} onValueChange={(value) => setFormMode(value as TestRunMode)}>
                      <SelectTrigger id="mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DETECTION_VALIDATION">Detection Validation</SelectItem>
                        <SelectItem value="ALERT_CHECK">Alert Check</SelectItem>
                        <SelectItem value="TELEMETRY_CHECK">Telemetry Check</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schedule-type">Schedule Type</Label>
                  <Select value={formScheduleType} onValueChange={(value) => setFormScheduleType(value as "once" | "interval" | "cron")}>
                    <SelectTrigger id="schedule-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="once">Run Once</SelectItem>
                      <SelectItem value="interval">Repeat at Interval</SelectItem>
                      <SelectItem value="cron">Cron Expression</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formScheduleType === "once" && (
                  <div className="space-y-2">
                    <Label htmlFor="run-at">Run At</Label>
                    <Input id="run-at" type="datetime-local" value={formRunAt} onChange={(e) => setFormRunAt(e.target.value)} />
                  </div>
                )}

                {formScheduleType === "interval" && (
                  <div className="space-y-2">
                    <Label htmlFor="interval">Interval (minutes)</Label>
                    <Input id="interval" type="number" value={formIntervalMinutes} onChange={(e) => setFormIntervalMinutes(e.target.value)} min="1" />
                  </div>
                )}

                {formScheduleType === "cron" && (
                  <div className="space-y-2">
                    <Label htmlFor="cron">Cron Expression</Label>
                    <Input id="cron" value={formCronExpression} onChange={(e) => setFormCronExpression(e.target.value)} placeholder="0 * * * *" />
                    <p className="mt-1 text-xs text-[var(--surface-subtle-foreground)]">
                      Format: minute hour day month weekday. Example: `0 * * * *` means every hour.
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => { setCreateDialogOpen(false); setFormError(null); }}>Cancel</Button>
                <Button onClick={handleCreateSchedule} disabled={creating}>
                  {creating ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Schedule
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {loadError && !loading && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {loadError}
        </div>
      )}

      <Card className="border-[var(--stroke-soft)] bg-[var(--surface-card)] shadow-[var(--shadow-soft)]">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-[var(--foreground)]">Scheduled Validations</CardTitle>
              <CardDescription className="mt-1 text-[var(--surface-subtle-foreground)]">
                {schedules.length} schedule{schedules.length !== 1 ? "s" : ""} configured
              </CardDescription>
            </div>
            {schedules.length > 0 && (
              <Button variant="ghost" size="sm" onClick={fetchSchedules}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-[var(--surface-subtle-foreground)]" />
            </div>
          ) : schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 rounded-full bg-[var(--surface-elevated)] p-4">
                <Calendar className="h-10 w-10 text-[var(--surface-subtle-foreground)]" />
              </div>
              <p className="mb-1 text-sm font-medium text-[var(--foreground)]">No validation schedules configured</p>
              <p className="max-w-sm text-xs text-[var(--surface-subtle-foreground)]">
                Create a schedule to keep validation recurring without relying on memory or manual effort.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[var(--stroke-soft)]">
              <Table>
                <TableHeader>
                  <TableRow className="border-[var(--stroke-soft)] bg-[var(--surface-elevated)]">
                    <TableHead className="font-semibold text-xs uppercase tracking-wider">Target</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider">Environment</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider">Schedule</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider">Next Run</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider">Status</TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((schedule) => {
                    const detection = detections.find((item) => item.id === schedule.detection_id);
                    return (
                      <TableRow key={schedule.id} className="border-[var(--stroke-soft)] transition-colors hover:bg-[var(--surface-elevated)]">
                        <TableCell className="py-4">
                          <div className="flex items-center gap-2.5">
                            {detection ? (
                              <>
                                <div className="rounded-md bg-sky-100 p-1.5 dark:bg-sky-500/10">
                                  <FileText className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-[var(--foreground)]">{detection.title}</span>
                                  <span className="text-xs text-[var(--surface-subtle-foreground)]">{detection.technique_id || "No technique"}</span>
                                </div>
                              </>
                            ) : schedule.technique_id ? (
                              <>
                                <div className="rounded-md bg-violet-100 p-1.5 dark:bg-violet-500/10">
                                  <TestTube className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-[var(--foreground)]">{schedule.technique_id}</span>
                                  <span className="text-xs text-[var(--surface-subtle-foreground)]">MITRE Technique</span>
                                </div>
                              </>
                            ) : (
                              <span className="text-sm text-[var(--surface-subtle-foreground)]">&mdash;</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-medium",
                              schedule.environment === "lab" && "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
                              schedule.environment === "dev" && "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
                              schedule.environment === "prod" && "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                            )}
                          >
                            {(schedule.environment || "unknown").toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 text-sm text-[var(--foreground)]">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-[var(--surface-subtle-foreground)]" />
                            <span className="font-medium">{getScheduleDescription(schedule)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="py-4 text-sm text-[var(--foreground)]">
                          <span className="font-medium">{getNextRunDisplay(schedule)}</span>
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-medium",
                              schedule.enabled
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                                : "border-slate-200 bg-slate-100 text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-400"
                            )}
                          >
                            {schedule.enabled ? (
                              <>
                                <CheckCircle2 className="mr-1.5 h-3 w-3" />
                                Active
                              </>
                            ) : (
                              <>
                                <Pause className="mr-1.5 h-3 w-3" />
                                Disabled
                              </>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Dialog open={deleteDialogOpen === schedule.id} onOpenChange={(open) => { setDeleteDialogOpen(open ? schedule.id : null); if (!open) setDeleteError(null); }}>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Delete Schedule</DialogTitle>
                                  <DialogDescription>
                                    Are you sure you want to delete this schedule? This action cannot be undone.
                                  </DialogDescription>
                                </DialogHeader>
                                {deleteError && (
                                  <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                                    <AlertCircle className="h-4 w-4 shrink-0" />
                                    {deleteError}
                                  </div>
                                )}
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => { setDeleteDialogOpen(null); setDeleteError(null); }}>Cancel</Button>
                                  <Button variant="destructive" onClick={() => handleDeleteSchedule(schedule.id)}>Delete</Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
