"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import { toast } from "@/components/ui/toast";
import { 
  CalendarClock, 
  Pencil, 
  Loader2, 
  Coffee, 
  Clock, 
  AlertCircle,
  CalendarRange,
  CalendarOff,
  CalendarDays,
  CheckCircle2,
  XCircle,
  Clock4
} from "lucide-react";
import { getDriverWorkSchedule, saveDriverWorkSchedule, getDriverLeaveRequests } from "@/services/driver.service";
import { DAY_NAMES } from "@/lib/scheduling/driver-schedule";

const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];

function fmtTime(value) {
  if (!value) return "";
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(value);
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h >= 12 ? "PM" : "AM"}`;
}

function scheduleShape(days) {
  const byDow = new Map((days || []).map((d) => [Number(d.day_of_week), d]));
  return DOW_ORDER.map((dow) => byDow.get(dow) ?? { day_of_week: dow });
}

function fmtDate(value) {
  if (!value) return "—";
  const s = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const [y, m, d] = s.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(y, m - 1, d));
}

export function WorkScheduleCard({ driverId, canEdit = false }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);

  const scheduleQ = useQuery({
    queryKey: ["driver-work-schedule", driverId],
    queryFn: () => getDriverWorkSchedule(driverId),
    enabled: !!driverId,
  });
  const leaveQ = useQuery({
    queryKey: ["driver-leave", driverId],
    queryFn: () => getDriverLeaveRequests(driverId),
    enabled: !!driverId,
  });

  const days = scheduleQ.data?.days ?? [];

  const save = useMutation({
    mutationFn: () => saveDriverWorkSchedule(driverId, draft),
    onSuccess: (data) => {
      toast.success("Weekly schedule saved");
      setEditing(false);
      queryClient.setQueryData(["driver-work-schedule", driverId], (old) => ({ ...old, days: data.days }));
      queryClient.invalidateQueries({ queryKey: ["driver-work-schedule", driverId] });
    },
    onError: (err) => toast.error(err.message || "Failed to save schedule"),
  });

  const openEditor = () => {
    setDraft(scheduleShape(days));
    setEditing(true);
  };

  const patchDay = (dow, field, value) =>
    setDraft((prev) => prev.map((d) => ({ ...d, [field]: value })));
  const setRest = (dow, rest) =>
    setDraft((prev) => prev.map((d) => (Number(d.day_of_week) === dow ? { ...d, is_rest_day: rest } : d)));

  const leave = leaveQ.data ?? [];

  return (
    <Card className="border border-border/60 shadow-sm rounded-[20px] md:col-span-2 overflow-hidden bg-surface transition-all duration-300 hover:shadow-md hover:border-primary/20 group/card">
      <CardHeader className="pb-4 bg-gradient-to-r from-muted/30 via-transparent to-transparent border-b border-border/40">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[15px] font-bold flex items-center gap-2.5 text-foreground">
            <div className="p-2 bg-primary/10 rounded-xl text-primary">
              <CalendarClock className="w-4 h-4" />
            </div>
            Work Schedule &amp; Leave
          </CardTitle>
          {canEdit && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-8 text-xs rounded-xl hover:bg-primary/5 hover:text-primary hover:border-primary/30 transition-all shadow-xs" 
              onClick={openEditor}
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5 text-foreground-muted group-hover:text-primary" /> Edit Schedule
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        {scheduleQ.isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-foreground-muted space-y-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary/40" />
            <p className="text-xs font-medium">Loading schedule profile…</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {/* Weekly Schedule Section */}
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <CalendarDays className="w-4 h-4 text-primary/70" />
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Weekly Routine</h3>
              </div>
              
              {days.length === 0 && (
                <div className="flex items-start gap-3 p-4 rounded-xl bg-warning/5 border border-warning/20 text-xs text-foreground-secondary transition-colors hover:bg-warning/10 shadow-xs">
                  <AlertCircle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-warning">No weekly schedule on file.</p>
                    <p className="leading-relaxed opacity-90">This driver is not assignable until a schedule is set. A driver with no schedule row is treated as unavailable.</p>
                  </div>
                </div>
              )}
              
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {scheduleShape(days).map((day) => {
                  const isRest = day.is_rest_day;
                  const hasShift = !isRest && day.shift_start;
                  
                  return (
                    <div 
                      key={day.day_of_week} 
                      className={`group flex items-center justify-between p-3.5 rounded-xl border transition-all duration-200 ${
                        isRest 
                          ? "bg-amber-50/50 border-amber-100/50 dark:bg-amber-950/10 dark:border-amber-900/20" 
                          : hasShift 
                            ? "bg-surface border-border/60 hover:border-primary/30 hover:shadow-sm" 
                            : "bg-muted/10 border-border/40 border-dashed"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
                          isRest ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 border border-amber-200/50" :
                          hasShift ? "bg-primary/10 text-primary border border-primary/20" : "bg-muted text-foreground-muted border border-border/50"
                        }`}>
                          <span className="text-xs font-bold">{DAY_NAMES[day.day_of_week].slice(0, 3)}</span>
                        </div>
                        <span className={`text-sm font-bold ${isRest ? "text-amber-700 dark:text-amber-500" : hasShift ? "text-foreground" : "text-foreground-muted"}`}>
                          {DAY_NAMES[day.day_of_week]}
                        </span>
                      </div>
                      
                      <div className="text-right flex items-center gap-2">
                        {isRest ? (
                          <Badge variant="outline" className="rounded-full bg-amber-100/50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30 gap-1.5 px-3 py-1 shadow-none font-semibold text-[11px]">
                            <Coffee className="w-3.5 h-3.5" /> Rest Day
                          </Badge>
                        ) : hasShift ? (
                          <div className="flex flex-col items-end">
                            <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                              <Clock4 className="w-3.5 h-3.5 text-primary/70" />
                              {fmtTime(day.shift_start)} – {fmtTime(day.shift_end)}
                            </span>
                            {day.break_start && day.break_end && (
                              <span className="text-[10px] font-medium text-foreground-muted flex items-center gap-1 mt-0.5">
                                <Coffee className="w-3 h-3 text-foreground-muted/70" /> break {fmtTime(day.break_start)}–{fmtTime(day.break_end)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] font-medium text-foreground-muted bg-muted/40 px-2 py-1 rounded-md border border-border/40">Not scheduled</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Leave Requests Section */}
            <div className="p-5 bg-muted/10 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <CalendarRange className="w-4 h-4 text-info/80" />
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Leave Requests</h3>
              </div>
              
              {leave.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-6 border border-dashed border-border/60 rounded-xl bg-surface/50 text-center hover:bg-surface transition-colors">
                  <CalendarOff className="w-8 h-8 text-foreground-muted/30 mb-2" />
                  <p className="text-xs font-semibold text-foreground">No leave on file</p>
                  <p className="text-[11px] text-foreground-muted mt-1">This driver has no upcoming or past leave requests.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {leave.map((l) => {
                    const isApproved = l.status === "Approved";
                    const isDeclined = l.status === "Declined";
                    const StatusIcon = isApproved ? CheckCircle2 : isDeclined ? XCircle : Clock;
                    
                    return (
                      <div key={l.leave_request_id} className="group relative flex flex-col gap-3 p-4 rounded-xl bg-surface border border-border/60 hover:border-primary/20 hover:shadow-sm transition-all duration-200">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1.5">
                            <span className="text-xs font-bold text-foreground block">
                              {fmtDate(l.start_date)} – {fmtDate(l.end_date)}
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground-secondary bg-muted/60 border border-border/40 px-2.5 py-0.5 rounded-full">
                              {l.leave_type || "Standard Leave"}
                            </span>
                          </div>
                          <Badge 
                            variant={isApproved ? "success" : isDeclined ? "destructive" : "secondary"} 
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold flex items-center gap-1 shadow-none ${isApproved ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30' : isDeclined ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30' : ''}`}
                          >
                            <StatusIcon className="w-3.5 h-3.5" />
                            {l.status}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-[95vw] xl:max-w-[1400px] p-0 overflow-hidden bg-surface border-border/60 shadow-2xl rounded-[24px]">
          <DialogHeader className="p-6 pb-5 border-b border-border/40 bg-gradient-to-r from-muted/30 to-transparent">
            <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-3 text-foreground">
              <div className="p-2.5 bg-primary/10 rounded-[14px] text-primary shadow-sm">
                <CalendarClock className="w-5 h-5" />
              </div>
              Edit Weekly Schedule
            </DialogTitle>
          </DialogHeader>
          
          <div className="p-6 bg-surface max-h-[75vh] overflow-auto scrollbar-thin">
            <div className="flex flex-col lg:flex-row gap-6">
              
              {/* Left Panel: Days Selection */}
              <div className="flex-1 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Working Days</h3>
                    <p className="text-xs text-foreground-muted">Toggle rest days for the week.</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {draft.map((day) => {
                    const isRest = Boolean(day.is_rest_day);
                    return (
                      <div 
                        key={day.day_of_week} 
                        className={`relative overflow-hidden p-3.5 rounded-[16px] border transition-all duration-300 shadow-sm flex items-center justify-between gap-2 ${
                          isRest 
                            ? "bg-amber-50/40 border-amber-200/60 dark:bg-amber-950/20 dark:border-amber-900/40" 
                            : "bg-surface border-border/60 hover:border-primary/30"
                        }`}
                      >
                        <div className={`absolute left-0 top-0 bottom-0 w-1.5 transition-colors duration-300 ${isRest ? 'bg-amber-400' : 'bg-primary'}`} />

                        <div className="flex items-center gap-2.5 ml-1">
                          <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 border-2 transition-colors ${
                            isRest ? "bg-amber-100 border-amber-300 dark:bg-amber-900/50 text-amber-600" : "bg-primary/10 border-primary/20 text-primary"
                          }`}>
                            <span className="text-[11px] font-black">{DAY_NAMES[day.day_of_week].slice(0, 3)}</span>
                          </div>
                          <span className="text-sm font-bold text-foreground">{DAY_NAMES[day.day_of_week]}</span>
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => setRest(day.day_of_week, !isRest)}
                          className={`relative inline-flex h-7 items-center rounded-full border px-2.5 text-[10px] font-bold transition-all shadow-sm ${
                            isRest 
                              ? "bg-amber-100 border-amber-300 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/60 dark:border-amber-700 dark:text-amber-300" 
                              : "bg-surface border-border/80 text-foreground-secondary hover:text-foreground hover:bg-muted"
                          }`}
                        >
                          <span className="flex items-center gap-1.5">
                            {isRest ? <Coffee className="w-3 h-3" /> : <Clock className="w-3 h-3 opacity-70" />}
                            {isRest ? "Rest Day" : "Set as Rest Day"}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right Panel: Global Schedule Configuration */}
              <div className="w-full lg:w-[320px] xl:w-[360px] shrink-0">
                <div className="bg-muted/10 border border-border/50 rounded-[20px] p-5 space-y-5 sticky top-0">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">Schedule Configuration</h3>
                    <p className="text-[11px] text-foreground-muted mt-0.5">Applies to all working days.</p>
                  </div>
                  
                  {(() => {
                    const activeDay = draft.find(d => !d.is_rest_day) || draft[0] || {};
                    return (
                      <div className="space-y-5">
                        {/* Shift Hours */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground-secondary uppercase tracking-wider">
                            <Clock className="w-3.5 h-3.5 text-primary/70" /> 
                            Shift Hours
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold text-foreground-muted uppercase ml-1">Start Time</Label>
                              <TimePicker 
                                value={activeDay.shift_start || ""} 
                                onChange={(val) => patchDay(null, "shift_start", val)} 
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold text-foreground-muted uppercase ml-1">End Time</Label>
                              <TimePicker 
                                value={activeDay.shift_end || ""} 
                                onChange={(val) => patchDay(null, "shift_end", val)} 
                              />
                            </div>
                          </div>
                        </div>
                        
                        <div className="h-px bg-border/40 w-full" />

                        {/* Break Period */}
                        <div className="space-y-3">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-foreground-secondary uppercase tracking-wider">
                            <Coffee className="w-3.5 h-3.5 text-amber-500/70" /> 
                            Break Period
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold text-foreground-muted uppercase ml-1">Start Time</Label>
                              <TimePicker 
                                value={activeDay.break_start || ""} 
                                onChange={(val) => patchDay(null, "break_start", val)} 
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] font-bold text-foreground-muted uppercase ml-1">End Time</Label>
                              <TimePicker 
                                value={activeDay.break_end || ""} 
                                onChange={(val) => patchDay(null, "break_end", val)} 
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

            </div>
          </div>
          
          <div className="flex items-center justify-between p-5 bg-gradient-to-r from-muted/20 to-transparent border-t border-border/40">
            <div className="flex items-center gap-2 text-[11px] font-bold text-foreground-secondary bg-surface px-4 py-2 rounded-xl border border-border/60 shadow-sm">
              <AlertCircle className="w-4 h-4 text-warning" />
              <span className="hidden sm:inline">Drivers without a schedule are unassignable.</span>
              <span className="sm:hidden">Schedule required for assignment.</span>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => setEditing(false)} className="rounded-xl px-5 font-bold hover:bg-muted/80">Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-xl px-6 font-bold shadow-md h-10">
                {save.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                Save Schedule
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}