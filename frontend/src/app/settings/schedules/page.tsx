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
  Calendar, Clock, Play, Pause, Trash2, Plus, RefreshCw, AlertCircle, CheckCircle2,
  TestTube, FileText, Activity, Settings
} from "lucide-react";
import { format, formatRelative, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { usePermissions } from "@/hooks/usePermissions";

export default function TestSchedulesPage() {
  const { hasPermission, canScheduleTest, loading: permissionsLoading } = usePermissions();
  const [schedules, setSchedules] = useState<TestSchedule[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [mitreTechniques, setMitreTechniques] = useState<MitreTechnique[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<number | null>(null);
  
  // Form state
  const [formDetectionId, setFormDetectionId] = useState<string>("none");
  const [formTechniqueId, setFormTechniqueId] = useState<string>("");
  const [formEnvironment, setFormEnvironment] = useState<"lab" | "dev" | "prod">("lab");
  const [formMode, setFormMode] = useState<TestRunMode>("DETECTION_VALIDATION");
  const [formScheduleType, setFormScheduleType] = useState<"once" | "interval" | "cron">("once");
  const [formRunAt, setFormRunAt] = useState<string>("");
  const [formIntervalMinutes, setFormIntervalMinutes] = useState<string>("60");
  const [formCronExpression, setFormCronExpression] = useState<string>("0 * * * *"); // Every hour
  const [creating, setCreating] = useState(false);

  const fetchSchedules = async () => {
    try {
      setError(null);
      const data = await getTestSchedules();
      setSchedules(data);
    } catch (err: any) {
      setError(err.message || "Failed to load test schedules");
      console.error("Error fetching schedules:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [schedulesData, detectionsData, techniquesData] = await Promise.all([
          getTestSchedules().catch(() => []),
          getDetections().catch(() => []),
          getMitreTechniques().catch(() => []),
        ]);
        setSchedules(schedulesData);
        setDetections(detectionsData);
        setMitreTechniques(techniquesData);
      } catch (err: any) {
        setError(err.message || "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleCreateSchedule = async () => {
    const detectionId = formDetectionId === "none" ? "" : formDetectionId;
    if (!detectionId && !formTechniqueId) {
      setError("Please select either a detection or technique");
      return;
    }

    if (formScheduleType === "once" && !formRunAt) {
      setError("Please select a date and time for the one-time schedule");
      return;
    }

    if (formScheduleType === "interval") {
      const minutes = parseInt(formIntervalMinutes, 10);
      if (!minutes || minutes <= 0) {
        setError("Please enter a valid interval in minutes");
        return;
      }
    }

    if (formScheduleType === "cron" && !formCronExpression) {
      setError("Please enter a cron expression");
      return;
    }

    try {
      setCreating(true);
      setError(null);
      
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
      // Reset form
      setFormDetectionId("none");
      setFormTechniqueId("");
      setFormEnvironment("lab");
      setFormMode("DETECTION_VALIDATION");
      setFormScheduleType("once");
      setFormRunAt("");
      setFormIntervalMinutes("60");
      setFormCronExpression("0 * * * *");
      
      // Refresh schedules
      await fetchSchedules();
    } catch (err: any) {
      setError(err.message || "Failed to create schedule");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSchedule = async (scheduleId: number) => {
    try {
      await deleteTestSchedule(scheduleId);
      await fetchSchedules();
      setDeleteDialogOpen(null);
    } catch (err: any) {
      setError(err.message || "Failed to delete schedule");
    }
  };

  const getScheduleDescription = (schedule: TestSchedule) => {
    if (schedule.schedule_type === "once") {
      return schedule.run_at ? `Run once at ${format(parseISO(schedule.run_at), "MMM d, yyyy h:mm a")}` : "One-time schedule";
    } else if (schedule.schedule_type === "interval") {
      const hours = schedule.interval_seconds ? Math.floor(schedule.interval_seconds / 3600) : 0;
      const minutes = schedule.interval_seconds ? Math.floor((schedule.interval_seconds % 3600) / 60) : 0;
      if (hours > 0 && minutes > 0) {
        return `Every ${hours}h ${minutes}m`;
      } else if (hours > 0) {
        return `Every ${hours} hour${hours > 1 ? "s" : ""}`;
      } else {
        return `Every ${minutes} minute${minutes > 1 ? "s" : ""}`;
      }
    } else {
      return `Cron: ${schedule.cron_expression || "N/A"}`;
    }
  };

  const getNextRunDisplay = (schedule: TestSchedule) => {
    if (!schedule.next_run_at) return "Not scheduled";
    const nextRun = parseISO(schedule.next_run_at);
    const now = new Date();
    if (nextRun < now) {
      return "Due now";
    }
    return formatRelative(nextRun, now);
  };

  if (permissionsLoading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      </PageContainer>
    );
  }

  if (!canScheduleTest) {
    return (
      <PageContainer>
        <Card className="elite-card ">
          <CardContent className="py-12 text-center">
            <AlertCircle className="h-12 w-12 mx-auto text-slate-500 mb-4" />
            <p className="text-slate-400">You don't have permission to manage test schedules.</p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Automation"
        title="Test Schedules"
        subtitle="Schedule tests to run automatically at specified times or intervals"
        icon={<Calendar className="h-5 w-5" />}
        actions={
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="bg-white text-slate-900 border-slate-300 hover:bg-slate-50"
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-semibold text-slate-900">Create Test Schedule</DialogTitle>
                <DialogDescription className="text-slate-600">
                  Configure a test to run automatically at specified times or intervals
                </DialogDescription>
              </DialogHeader>
              
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="detection" className="text-slate-700 font-medium">Detection (Optional)</Label>
                    <Select value={formDetectionId} onValueChange={setFormDetectionId}>
                      <SelectTrigger id="detection" className="bg-white border-slate-300 text-slate-900 hover:border-slate-400">
                        <SelectValue placeholder="Select detection" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        <SelectItem value="none">None</SelectItem>
                        {detections.map(d => (
                          <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="technique" className="text-slate-700 font-medium">Technique ID (Optional)</Label>
                    <Input
                      id="technique"
                      value={formTechniqueId}
                      onChange={(e) => setFormTechniqueId(e.target.value)}
                      placeholder="e.g., T1055"
                      className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="environment" className="text-slate-700 font-medium">Environment</Label>
                    <Select value={formEnvironment} onValueChange={(v: any) => setFormEnvironment(v)}>
                      <SelectTrigger id="environment" className="bg-white border-slate-300 text-slate-900 hover:border-slate-400">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        <SelectItem value="lab">Lab</SelectItem>
                        <SelectItem value="dev">Dev</SelectItem>
                        <SelectItem value="prod">Prod</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="mode" className="text-slate-700 font-medium">Test Mode</Label>
                    <Select value={formMode} onValueChange={(v: any) => setFormMode(v)}>
                      <SelectTrigger id="mode" className="bg-white border-slate-300 text-slate-900 hover:border-slate-400">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border-slate-200">
                        <SelectItem value="DETECTION_VALIDATION">Detection Validation</SelectItem>
                        <SelectItem value="ALERT_CHECK">Alert Check</SelectItem>
                        <SelectItem value="TELEMETRY_CHECK">Telemetry Check</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schedule-type" className="text-slate-700 font-medium">Schedule Type</Label>
                  <Select value={formScheduleType} onValueChange={(v: any) => setFormScheduleType(v)}>
                    <SelectTrigger id="schedule-type" className="bg-white border-slate-300 text-slate-900 hover:border-slate-400">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      <SelectItem value="once">Run Once</SelectItem>
                      <SelectItem value="interval">Repeat at Interval</SelectItem>
                      <SelectItem value="cron">Cron Expression</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formScheduleType === "once" && (
                  <div className="space-y-2">
                    <Label htmlFor="run-at" className="text-slate-700 font-medium">Run At</Label>
                    <Input
                      id="run-at"
                      type="datetime-local"
                      value={formRunAt}
                      onChange={(e) => setFormRunAt(e.target.value)}
                      className="bg-white border-slate-300 text-slate-900"
                    />
                  </div>
                )}

                {formScheduleType === "interval" && (
                  <div className="space-y-2">
                    <Label htmlFor="interval" className="text-slate-700 font-medium">Interval (minutes)</Label>
                    <Input
                      id="interval"
                      type="number"
                      value={formIntervalMinutes}
                      onChange={(e) => setFormIntervalMinutes(e.target.value)}
                      min="1"
                      className="bg-white border-slate-300 text-slate-900"
                    />
                  </div>
                )}

                {formScheduleType === "cron" && (
                  <div className="space-y-2">
                    <Label htmlFor="cron" className="text-slate-700 font-medium">Cron Expression</Label>
                    <Input
                      id="cron"
                      value={formCronExpression}
                      onChange={(e) => setFormCronExpression(e.target.value)}
                      placeholder="0 * * * *"
                      className="bg-white border-slate-300 text-slate-900 placeholder:text-slate-400"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Format: minute hour day month weekday (e.g., "0 * * * *" = every hour)
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateSchedule}
                  disabled={creating}
                  variant="outline"
                  className="bg-white text-slate-900 border-slate-300 hover:bg-slate-50"
                >
                  {creating ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Schedule
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      {error && !loading && (
        <Card className="elite-card ">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle className="h-5 w-5" />
              {error}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="elite-card ">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-slate-900">Scheduled Tests</CardTitle>
              <CardDescription className="text-slate-500 mt-1">
                {schedules.length} schedule{schedules.length !== 1 ? "s" : ""} configured
              </CardDescription>
            </div>
            {schedules.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchSchedules}
                className="text-slate-500 hover:text-slate-900"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          ) : schedules.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="rounded-full bg-slate-100 p-4 mb-4">
                <Calendar className="h-10 w-10 text-slate-500" />
              </div>
              <p className="text-sm font-medium text-slate-700 mb-1">No test schedules configured</p>
              <p className="text-xs text-slate-500 max-w-sm">
                Create a schedule to run tests automatically at specified times or intervals
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden bg-white">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-200 bg-slate-50">
                    <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Target</TableHead>
                    <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Environment</TableHead>
                    <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Schedule</TableHead>
                    <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Next Run</TableHead>
                    <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider">Status</TableHead>
                    <TableHead className="text-slate-600 font-semibold text-xs uppercase tracking-wider text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {schedules.map((schedule) => {
                    const detection = detections.find(d => d.id === schedule.detection_id);
                    return (
                      <TableRow key={schedule.id} className="border-slate-200 hover:bg-slate-50 transition-colors">
                        <TableCell className="text-slate-700 py-4">
                          <div className="flex items-center gap-2.5">
                            {detection ? (
                              <>
                                <div className="rounded-md bg-blue-100 p-1.5">
                                  <FileText className="h-3.5 w-3.5 text-blue-600" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-slate-900">{detection.title}</span>
                                  <span className="text-xs text-slate-500">{detection.technique_id || "No technique"}</span>
                                </div>
                              </>
                            ) : schedule.technique_id ? (
                              <>
                                <div className="rounded-md bg-purple-100 p-1.5">
                                  <TestTube className="h-3.5 w-3.5 text-purple-600" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-medium text-slate-900">{schedule.technique_id}</span>
                                  <span className="text-xs text-slate-500">MITRE Technique</span>
                                </div>
                              </>
                            ) : (
                              <span className="text-sm text-slate-500">—</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-medium",
                              schedule.environment === "lab" && "bg-blue-500/20 text-blue-300 border-blue-500/40",
                              schedule.environment === "dev" && "bg-amber-500/20 text-amber-300 border-amber-500/40",
                              schedule.environment === "prod" && "bg-red-500/20 text-red-300 border-red-500/40"
                            )}
                          >
                            {(schedule.environment || "unknown").toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-700 text-sm py-4">
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-slate-500" />
                            <span className="font-medium">{getScheduleDescription(schedule)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-700 text-sm py-4">
                          <span className="font-medium">{getNextRunDisplay(schedule)}</span>
                        </TableCell>
                        <TableCell className="py-4">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-medium",
                              schedule.enabled
                                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                                : "bg-slate-500/20 text-slate-400 border-slate-500/40"
                            )}
                          >
                            {schedule.enabled ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 mr-1.5" />
                                Active
                              </>
                            ) : (
                              <>
                                <Pause className="h-3 w-3 mr-1.5" />
                                Disabled
                              </>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Dialog open={deleteDialogOpen === schedule.id} onOpenChange={(open) => setDeleteDialogOpen(open ? schedule.id : null)}>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle className="text-slate-900">Delete Schedule</DialogTitle>
                                  <DialogDescription className="text-slate-600">
                                    Are you sure you want to delete this schedule? This action cannot be undone.
                                  </DialogDescription>
                                </DialogHeader>
                                <DialogFooter>
                                  <Button variant="outline" onClick={() => setDeleteDialogOpen(null)}>
                                    Cancel
                                  </Button>
                                  <Button variant="destructive" onClick={() => handleDeleteSchedule(schedule.id)}>
                                    Delete
                                  </Button>
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
