"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getMyWorkSchedule, getMyLeaveRequests, getMyLeaveBalances,
  requestDriverLeave, withdrawDriverLeave,
} from "@/services/driver.service";
import { DAY_NAMES } from "@/lib/scheduling/driver-schedule";
import { CalendarClock, Loader2, Send, CalendarDays, Undo2 } from "lucide-react";

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

export default function DriverSchedulePage() {
  useRequireRole();
  const queryClient = useQueryClient();

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [leaveType, setLeaveType] = useState("");
  const [reason, setReason] = useState("");

  const scheduleQ = useQuery({ queryKey: ["driver-work-schedule-me"], queryFn: getMyWorkSchedule });
  const leaveQ = useQuery({ queryKey: ["driver-leave-me"], queryFn: getMyLeaveRequests });
  const balanceQ = useQuery({ queryKey: ["driver-leave-balances-me"], queryFn: getMyLeaveBalances });

  const request = useMutation({
    mutationFn: () => requestDriverLeave({ start_date: startDate, end_date: endDate, start_time: startTime, end_time: endTime, leave_type: leaveType, reason }),
    onSuccess: () => {
      toast.success("Leave request submitted for approval");
      setStartDate(""); setEndDate(""); setStartTime(""); setEndTime(""); setLeaveType(""); setReason("");
      queryClient.invalidateQueries({ queryKey: ["driver-leave-me"] });
    },
    onError: (err) => toast.error(err.message || "Failed to submit leave request"),
  });

  const withdraw = useMutation({
    mutationFn: (id) => withdrawDriverLeave(id),
    onSuccess: () => {
      toast.success("Leave request withdrawn");
      queryClient.invalidateQueries({ queryKey: ["driver-leave-me"] });
    },
    onError: (err) => toast.error(err.message || "Failed to withdraw request"),
  });

  const days = scheduleQ.data?.days ?? [];
  const leave = leaveQ.data ?? [];
  const balances = balanceQ.data ?? [];

  return (
    <DriverConsentGate>
      <div className="space-y-6 w-full">
        <HeroHeader
          icon={CalendarClock}
          title="My Schedule & Leave"
          badge="Driver Workspace"
          description="View your weekly work schedule and manage your leave requests."
        />

        <Tabs defaultValue="schedule" className="w-full">
          <TabsList className="mb-6 bg-muted/40 p-1 rounded-xl h-auto">
            <TabsTrigger value="schedule" className="rounded-lg px-6 py-2">Work Schedule</TabsTrigger>
            <TabsTrigger value="leave" className="rounded-lg px-6 py-2">Leave Management</TabsTrigger>
          </TabsList>

          <TabsContent value="schedule" className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
              <CardHeader className="pb-5 border-b border-border bg-muted/10 px-6 pt-6">
                <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                  <CalendarDays className="w-5 h-5 text-primary" /> Weekly Timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {scheduleQ.isLoading ? (
                  <div className="py-10 text-center text-xs text-foreground-muted">Loading schedule…</div>
                ) : days.length === 0 ? (
                  <EmptyState
                    icon={CalendarDays}
                    title="No schedule found"
                    description="No weekly schedule on file yet. Ask your fleet manager to set your work schedule."
                  />
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                    {scheduleShape(days).map((day) => {
                      const dayColors = {
                        1: "bg-blue-500/5 border-blue-500/20",
                        2: "bg-indigo-500/5 border-indigo-500/20",
                        3: "bg-violet-500/5 border-violet-500/20",
                        4: "bg-fuchsia-500/5 border-fuchsia-500/20",
                        5: "bg-rose-500/5 border-rose-500/20",
                        6: "bg-cyan-500/5 border-cyan-500/20",
                        0: "bg-teal-500/5 border-teal-500/20",
                      };
                      
                      return (
                        <div 
                          key={day.day_of_week} 
                          className={cn(
                            "flex flex-col rounded-xl border p-4 transition-colors",
                            day.is_rest_day 
                              ? "bg-amber-500/5 border-dashed border-amber-500/30" 
                              : dayColors[day.day_of_week] || "bg-muted/30 border-border"
                          )}
                        >
                          <span className="font-bold text-foreground text-sm mb-3">
                            {DAY_NAMES[day.day_of_week]}
                          </span>
                          
                          {day.is_rest_day ? (
                            <div className="flex-1 flex items-center">
                              <span className="text-xs font-semibold text-amber-600 dark:text-amber-500 uppercase tracking-wider px-2 py-1 bg-amber-500/10 rounded-md">Rest Day</span>
                            </div>
                          ) : day.shift_start ? (
                            <div className="flex flex-col gap-2 flex-1 justify-center">
                              <div>
                                <p className="text-[10px] text-foreground-muted uppercase tracking-wider font-semibold mb-0.5">Shift</p>
                                <p className="text-sm font-medium text-foreground">
                                  {fmtTime(day.shift_start)}
                                  <br />
                                  <span className="text-foreground-secondary text-xs">{fmtTime(day.shift_end)}</span>
                                </p>
                              </div>
                              {day.break_start && day.break_end && (
                                <div className="mt-1 pt-2 border-t border-border/50">
                                  <p className="text-[10px] text-foreground-muted uppercase tracking-wider font-semibold mb-0.5">Break</p>
                                  <p className="text-xs text-foreground-secondary">
                                    {fmtTime(day.break_start)} - {fmtTime(day.break_end)}
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="flex-1 flex items-center text-xs text-foreground-muted italic">
                              Unscheduled
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leave" className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            
            {/* Leave Balances Section */}
            {balances.length > 0 && (
              <Card className="border-0 shadow-sm rounded-2xl overflow-hidden">
                <CardHeader className="pb-4 px-6 pt-6">
                  <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                    Leave Balances
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {balances.map(b => (
                      <div key={b.leave_type} className="bg-muted/20 p-4 rounded-xl border border-border/50">
                        <ProgressBar 
                          value={(b.used_days / b.allocated_days) * 100}
                          tone={b.used_days >= b.allocated_days ? "danger" : "primary"}
                          label={b.leave_type}
                          valueLabel={`${b.used_days} / ${b.allocated_days} days`}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
              
              {/* Form Section */}
              <Card className="border-0 shadow-sm rounded-2xl overflow-hidden lg:col-span-1">
                <CardHeader className="pb-5 border-b border-border bg-muted/10 px-6 pt-6">
                  <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                    <Send className="w-4 h-4 text-primary" /> File a Request
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6 px-6 pb-6 space-y-5">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div><DatePicker label="Start date" value={startDate} onChange={setStartDate} disablePast /></div>
                      <div><DatePicker label="End date" value={endDate} onChange={setEndDate} disablePast /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-[11px] text-foreground-secondary font-semibold uppercase tracking-wider ml-1">Start time</Label>
                        <TimePicker value={startTime} onChange={setStartTime} />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[11px] text-foreground-secondary font-semibold uppercase tracking-wider ml-1">End time</Label>
                        <TimePicker value={endTime} onChange={setEndTime} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Leave Type</Label>
                    <Select value={leaveType} onValueChange={setLeaveType}>
                      <SelectTrigger className="w-full bg-surface">
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Vacation">Vacation</SelectItem>
                        <SelectItem value="Sick">Sick Leave</SelectItem>
                        <SelectItem value="Personal">Personal Leave</SelectItem>
                        <SelectItem value="Unpaid">Unpaid Leave</SelectItem>
                        <SelectItem value="Other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold">Reason</Label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      placeholder="Why do you need the leave?"
                      className="flex w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                  <Button
                    className="w-full rounded-xl h-10 font-bold"
                    disabled={!startDate || !endDate || !leaveType || request.isPending}
                    onClick={() => request.mutate()}
                  >
                    {request.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                    Submit Request
                  </Button>
                </CardContent>
              </Card>

              {/* History Section */}
              <Card className="border-0 shadow-sm rounded-2xl overflow-hidden lg:col-span-2 min-h-[450px]">
                <CardHeader className="pb-5 border-b border-border bg-muted/10 px-6 pt-6">
                  <CardTitle className="text-base font-bold flex items-center gap-2 text-foreground">
                    <CalendarClock className="w-4 h-4 text-primary" /> Request History
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {leaveQ.isLoading ? (
                    <div className="py-10 text-center text-xs text-foreground-muted">Loading history…</div>
                  ) : leave.length === 0 ? (
                    <EmptyState
                      icon={CalendarClock}
                      title="No leave requests"
                      description="Requests you file will appear here."
                      className="py-12"
                    />
                  ) : (
                    <div className="w-full overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                      <div className="min-w-[600px]">
                        <div className="grid grid-cols-[1.5fr_1.5fr_2fr_1fr_1fr] gap-4 py-3 px-6 text-[11px] font-semibold text-foreground-muted uppercase tracking-wider border-b border-border bg-muted/5">
                          <div>Type</div>
                          <div>Dates</div>
                          <div>Reason</div>
                          <div>Status</div>
                          <div className="text-right">Action</div>
                        </div>
                        
                        <div className="divide-y divide-border/50">
                          {leave.map((l) => (
                            <div key={l.leave_request_id} className="grid grid-cols-[1.5fr_1.5fr_2fr_1fr_1fr] gap-4 py-4 px-6 text-xs items-center hover:bg-muted/10 transition-colors">
                              <div className="font-medium text-foreground">{l.leave_type || "—"}</div>
                              <div>
                                <div className="text-foreground">{fmtDate(l.start_date)}</div>
                                {l.start_date !== l.end_date && (
                                  <div className="text-foreground-secondary mt-0.5">to {fmtDate(l.end_date)}</div>
                                )}
                              </div>
                              <div className="text-foreground-secondary truncate pr-4" title={l.reason}>{l.reason || "—"}</div>
                              <div>
                                <Badge variant={l.status === "Approved" ? "success" : l.status === "Declined" ? "danger" : "secondary"} className="rounded-md text-[10px] px-2 py-0.5">
                                  {l.status}
                                </Badge>
                              </div>
                              <div className="text-right">
                                {l.status === "Pending" ? (
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="h-7 text-[11px] text-foreground-secondary hover:text-danger hover:bg-danger/10" 
                                    onClick={() => {
                                      if (confirm("Are you sure you want to withdraw this request?")) {
                                        withdraw.mutate(l.leave_request_id);
                                      }
                                    }}
                                  >
                                    <Undo2 className="w-3 h-3 mr-1" /> Withdraw
                                  </Button>
                                ) : (
                                  <span className="text-foreground-muted text-[10px] italic">Locked</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DriverConsentGate>
  );
}
