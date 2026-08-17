"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { DriverConsentGate } from "@/components/driver/consent-gate";
import { useRequireRole } from "@/lib/auth/role-guard";
import {
  getMyWorkSchedule, getMyLeaveRequests, getMyLeaveBalances,
  requestDriverLeave, withdrawDriverLeave,
} from "@/services/driver.service";
import { DAY_NAMES } from "@/lib/scheduling/driver-schedule";
import { CalendarClock, Loader2, Send, Trash2, CalendarDays } from "lucide-react";

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
  useRequireRole(["driver"]);
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
      <div className="space-y-6 w-full max-w-4xl">
        <HeroHeader
          icon={CalendarClock}
          title="My Schedule & Leave"
          badge="Driver Workspace"
          description="View your weekly work schedule and manage your leave requests."
        />

        <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
              <CalendarDays className="w-4 h-4 text-primary" /> Weekly Work Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            {scheduleQ.isLoading ? (
              <div className="py-6 text-center text-xs text-foreground-muted">Loading schedule…</div>
            ) : days.length === 0 ? (
              <p className="py-6 text-center text-xs text-foreground-muted">
                No weekly schedule on file yet. Ask your fleet manager to set your work schedule.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                {scheduleShape(days).map((day) => (
                  <div key={day.day_of_week} className="flex items-center justify-between py-2.5 border-b border-border/40 text-sm">
                    <span className="font-bold text-foreground">{DAY_NAMES[day.day_of_week]}</span>
                    {day.is_rest_day ? (
                      <Badge variant="warning" className="rounded-full text-xs">Rest day</Badge>
                    ) : day.shift_start ? (
                      <span className="font-medium text-foreground text-sm">
                        {fmtTime(day.shift_start)} – {fmtTime(day.shift_end)}
                        {day.break_start && day.break_end && (
                          <span className="text-foreground-muted text-xs"> · break {fmtTime(day.break_start)}–{fmtTime(day.break_end)}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-foreground-muted italic text-sm">No schedule</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
            <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <Send className="w-4 h-4 text-primary" /> File a Leave Request
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {balances.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {balances.map(b => (
                    <Badge key={b.leave_type} variant="secondary" className="rounded-md">
                      {b.leave_type}: {b.used_days} / {b.allocated_days} days used
                    </Badge>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-3 gap-y-4">
                <div className="pt-2">
                  <DatePicker label="Start date" value={startDate} onChange={setStartDate} disablePast />
                </div>
                <div className="pt-2">
                  <DatePicker label="End date" value={endDate} onChange={setEndDate} disablePast />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-foreground-secondary ml-1">Start time (optional)</Label>
                  <TimePicker value={startTime} onChange={setStartTime} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-foreground-secondary ml-1">End time (optional)</Label>
                  <TimePicker value={endTime} onChange={setEndTime} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Leave type</Label>
                <Input value={leaveType} onChange={(e) => setLeaveType(e.target.value)} placeholder="e.g. Personal, Vacation, Medical" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Reason</Label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why do you need the leave?"
                  className="flex w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <p className="text-[11px] text-foreground-muted">
                Requests stay Pending until your fleet manager approves. Only approved leave blocks assignments.
              </p>
              <Button
                className="w-full rounded-xl"
                disabled={!startDate || !endDate || request.isPending}
                onClick={() => request.mutate()}
              >
                {request.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                Submit Request
              </Button>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
            <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
                <CalendarClock className="w-4 h-4 text-primary" /> My Leave Requests
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {leaveQ.isLoading ? (
                <div className="py-6 text-center text-xs text-foreground-muted">Loading…</div>
              ) : leave.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="No leave requests"
                  description="Requests you file will appear here with their approval status."
                />
              ) : (
                <div className="space-y-2">
                  {leave.map((l) => (
                    <div key={l.leave_request_id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-muted/20 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground text-xs">
                          {fmtDate(l.start_date)} {l.start_time ? `(${l.start_time})` : ""} – {fmtDate(l.end_date)} {l.end_time ? `(${l.end_time})` : ""}
                          {l.leave_type ? <span className="text-foreground-muted"> · {l.leave_type}</span> : null}
                        </p>
                        {l.reason && <p className="text-[11px] text-foreground-secondary truncate mt-0.5">{l.reason}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={l.status === "Approved" ? "success" : l.status === "Declined" ? "danger" : "secondary"} className="rounded-full text-xs">
                          {l.status}
                        </Badge>
                        {l.status === "Pending" && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-danger" onClick={() => withdraw.mutate(l.leave_request_id)} title="Withdraw request">
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DriverConsentGate>
  );
}