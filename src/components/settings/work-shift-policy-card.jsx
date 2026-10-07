"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { TimePicker } from "@/components/ui/time-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import {
  CalendarClock,
  Clock,
  Coffee,
  CalendarDays,
  Sparkles,
  Users,
  CheckCircle2,
  RotateCcw,
  TriangleAlert,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WORK_SHIFT_POLICY,
  DEFAULT_BREAK_SLOTS,
  validateWorkShiftPolicy,
} from "@/lib/work-shift-policy";
import {
  getWorkShiftPolicy,
  updateWorkShiftPolicy,
  applyWorkShiftPolicy,
} from "@/services/settings.service";

const WEEKDAYS = [
  { dow: 1, label: "Mon" },
  { dow: 2, label: "Tue" },
  { dow: 3, label: "Wed" },
  { dow: 4, label: "Thu" },
  { dow: 5, label: "Fri" },
  { dow: 6, label: "Sat" },
  { dow: 0, label: "Sun" },
];

function fmtTime12(timeStr) {
  if (!timeStr) return "";
  const [hStr, mStr] = timeStr.split(":");
  const h = Number(hStr);
  const m = mStr || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

function WorkShiftPolicyForm({ initialPolicy, queryClient }) {
  const [form, setForm] = useState(initialPolicy || DEFAULT_WORK_SHIFT_POLICY);
  const [savedPolicy, setSavedPolicy] = useState(initialPolicy || DEFAULT_WORK_SHIFT_POLICY);
  const [error, setError] = useState(null);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: updateWorkShiftPolicy,
    onSuccess: (saved) => {
      setForm(saved);
      setSavedPolicy(saved);
      setError(null);
      queryClient.setQueryData(["work-shift-policy"], saved);
      queryClient.invalidateQueries({ queryKey: ["work-shift-policy"] });
      toast.success("Operating hours & shift policy saved.");
    },
    onError: (e) => {
      setError(e.message || "Failed to save shift policy.");
      toast.error(e.message || "Failed to save shift policy.");
    },
  });

  const applyMutation = useMutation({
    mutationFn: (opts) => applyWorkShiftPolicy(opts),
    onSuccess: (res) => {
      setConfirmApplyOpen(false);
      queryClient.invalidateQueries({ queryKey: ["driver-work-schedule"] });
      toast.success(`Standard shift routine applied to ${res.updatedCount || "all"} active drivers.`);
    },
    onError: (e) => {
      toast.error(e.message || "Failed to apply shift policy to drivers.");
    },
  });

  const toggleDay = (dow) => {
    setForm((prev) => {
      const current = prev.workingDays || [];
      const exists = current.includes(dow);
      let nextDays = exists ? current.filter((d) => d !== dow) : [...current, dow];
      if (nextDays.length === 0) {
        toast.warning("At least one working day must remain active.");
        return prev;
      }
      return { ...prev, workingDays: nextDays.sort((a, b) => a - b) };
    });
  };

  const handleSave = () => {
    const check = validateWorkShiftPolicy(form);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    saveMutation.mutate(form);
  };

  const workingCount = form.workingDays?.length || 0;
  const restCount = 7 - workingCount;
  const hasStaggerBreaks = form.staggerBreaks !== false;
  const hasStaggerRestDays = form.staggerRestDays !== false;
  const hasUnsavedChanges = JSON.stringify(form) !== JSON.stringify(savedPolicy);

  return (
    <div className="space-y-6">
      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/6 px-4 py-3 text-xs font-semibold text-danger">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Visual Shift Summary Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-primary/5 via-muted/30 to-transparent border border-border/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1">
          <span className="text-[10px] font-bold tracking-wider uppercase text-foreground-muted">
            Fleet Routine &amp; Operational Baseline
          </span>
          <p className="text-sm font-extrabold text-foreground flex flex-wrap items-center gap-2">
            <span>{fmtTime12(form.shiftStart)} – {fmtTime12(form.shiftEnd)}</span>
            <span className="text-border">|</span>
            <span className="text-xs font-semibold text-foreground-secondary">
              Lunch: {hasStaggerBreaks ? "4 Rotating Slots (11:30 AM – 2:00 PM)" : (form.breakStart && form.breakEnd ? `${fmtTime12(form.breakStart)} – ${fmtTime12(form.breakEnd)}` : "None")}
            </span>
            <span className="text-border">|</span>
            <span className="text-xs font-semibold text-foreground-secondary">
              Coverage: {hasStaggerRestDays ? "7-Day Staggered Rest Days" : `${workingCount} working / ${restCount} rest`}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasStaggerBreaks && (
            <Badge variant="secondary" className="rounded-full text-[11px] font-medium px-3 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
              <Coffee className="w-3 h-3 mr-1" /> Staggered Breaks
            </Badge>
          )}
          {hasStaggerRestDays && (
            <Badge variant="secondary" className="rounded-full text-[11px] font-medium px-3 py-0.5 bg-primary/10 text-primary border border-primary/20">
              <ShieldCheck className="w-3 h-3 mr-1" /> 7-Day Fleet Coverage
            </Badge>
          )}
        </div>
      </div>

      {/* Time Controls Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Daily Shift Boundaries */}
        <div className="p-4 rounded-2xl bg-muted/10 border border-border/50 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            <div>
              <h4 className="text-xs font-bold text-foreground">Daily Shift Operating Hours</h4>
              <p className="text-[11px] text-foreground-muted">Fleet availability start and conclusion span.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                Shift Start
              </Label>
              <TimePicker
                value={form.shiftStart || "06:00"}
                onChange={(val) => setForm((f) => ({ ...f, shiftStart: val }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                Shift End
              </Label>
              <TimePicker
                value={form.shiftEnd || "22:00"}
                onChange={(val) => setForm((f) => ({ ...f, shiftEnd: val }))}
              />
            </div>
          </div>
        </div>

        {/* Lunch Break Period */}
        <div className="p-4 rounded-2xl bg-muted/10 border border-border/50 space-y-4">
          <div className="flex items-center gap-2">
            <Coffee className="w-4 h-4 text-amber-500" />
            <div>
              <h4 className="text-xs font-bold text-foreground">Standard Lunch Break Window</h4>
              <p className="text-[11px] text-foreground-muted">Baseline pause if staggering is turned off.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                Break Start
              </Label>
              <TimePicker
                value={form.breakStart || "12:00"}
                onChange={(val) => setForm((f) => ({ ...f, breakStart: val }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                Break End
              </Label>
              <TimePicker
                value={form.breakEnd || "13:00"}
                onChange={(val) => setForm((f) => ({ ...f, breakEnd: val }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Staggering & Continuous Coverage Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Stagger Lunch Breaks */}
        <div
          className={cn(
            "p-4 rounded-2xl border transition-all duration-200 space-y-3",
            hasStaggerBreaks ? "bg-amber-500/5 border-amber-500/30" : "bg-muted/10 border-border/50"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Coffee className="w-4 h-4 text-amber-500" />
                <h4 className="text-xs font-bold text-foreground">Stagger Lunch Breaks Across Drivers</h4>
              </div>
              <p className="text-[11px] text-foreground-muted leading-relaxed">
                Rotates driver break times across 4 lunchtime slots (11:30 AM – 2:00 PM) so vehicles always remain available to catch bookings during noon hours.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={hasStaggerBreaks}
              onClick={() => setForm((f) => ({ ...f, staggerBreaks: !hasStaggerBreaks }))}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer",
                hasStaggerBreaks ? "bg-amber-500" : "bg-border"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                  hasStaggerBreaks ? "left-4.5" : "left-0.5"
                )}
              />
            </button>
          </div>

          {hasStaggerBreaks ? (
            <div className="pt-1 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                Rotating Break Windows (Round-Robin)
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {DEFAULT_BREAK_SLOTS.map((slot, idx) => (
                  <div
                    key={idx}
                    className="px-2.5 py-1.5 rounded-xl bg-surface border border-amber-500/20 text-[11px] font-semibold flex items-center justify-between text-foreground"
                  >
                    <span className="text-amber-600 dark:text-amber-400 font-bold">Slot {idx + 1}</span>
                    <span>{fmtTime12(slot.breakStart)}–{fmtTime12(slot.breakEnd)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-foreground-muted italic pt-1">
              Disabled: All drivers share the same baseline break ({fmtTime12(form.breakStart)}–{fmtTime12(form.breakEnd)}).
            </p>
          )}
        </div>

        {/* Stagger Rest Days */}
        <div
          className={cn(
            "p-4 rounded-2xl border transition-all duration-200 space-y-3",
            hasStaggerRestDays ? "bg-primary/5 border-primary/30" : "bg-muted/10 border-border/50"
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                <h4 className="text-xs font-bold text-foreground">Stagger Rest Days Across Drivers</h4>
              </div>
              <p className="text-[11px] text-foreground-muted leading-relaxed">
                Distribute days off across drivers throughout the 7 days of the week (Sun–Sat) so the fleet maintains continuous 7-day vehicle readiness.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={hasStaggerRestDays}
              onClick={() => setForm((f) => ({ ...f, staggerRestDays: !hasStaggerRestDays }))}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer",
                hasStaggerRestDays ? "bg-primary" : "bg-border"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                  hasStaggerRestDays ? "left-4.5" : "left-0.5"
                )}
              />
            </button>
          </div>

          {hasStaggerRestDays ? (
            <div className="pt-1 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted">
                  Rotated Rest Day Layout (7-Day Spread)
                </span>
                <Badge variant="outline" className="text-[10px] font-bold border-primary/20 text-primary">
                  7-Day Continuous
                </Badge>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {[
                  { label: "Sun", d: "D1" },
                  { label: "Mon", d: "D2" },
                  { label: "Tue", d: "D3" },
                  { label: "Wed", d: "D4" },
                  { label: "Thu", d: "D5" },
                  { label: "Fri", d: "D6" },
                  { label: "Sat", d: "D7" },
                ].map((item, idx) => (
                  <div
                    key={idx}
                    className="p-1.5 rounded-lg bg-surface border border-primary/20 flex flex-col items-center justify-center gap-0.5 shadow-2xs"
                  >
                    <span className="text-[10px] font-extrabold text-foreground">{item.label}</span>
                    <span className="text-[9px] font-semibold text-primary">{item.d} Off</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-foreground-muted italic pt-1">
              Disabled: All drivers follow the identical fixed weekly rest days set below.
            </p>
          )}
        </div>
      </div>

      {/* Standard Working Days */}
      <div className="p-4 rounded-2xl bg-muted/10 border border-border/50 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-primary" />
            <h4 className="text-xs font-bold text-foreground">Standard Baseline Days (Fallback)</h4>
          </div>
          <span className="text-[11px] text-foreground-muted">
            Used when rest day staggering is disabled. Click a weekday to toggle.
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-2">
          {WEEKDAYS.map(({ dow, label }) => {
            const isWorking = form.workingDays?.includes(dow);
            return (
              <button
                key={dow}
                type="button"
                onClick={() => toggleDay(dow)}
                className={`p-3 rounded-2xl border text-center transition-all duration-200 cursor-pointer flex flex-col items-center justify-center gap-1.5 ${
                  isWorking
                    ? "bg-primary/10 border-primary/30 text-primary shadow-xs hover:bg-primary/15"
                    : "bg-surface border-border/70 text-foreground-muted hover:border-border hover:bg-muted/40"
                }`}
              >
                <span className="text-xs font-extrabold">{label}</span>
                <span className="text-[10px] font-bold tracking-tight">
                  {isWorking ? (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Clock className="w-2.5 h-2.5" /> Work
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <Coffee className="w-2.5 h-2.5" /> Rest
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="rounded-xl font-bold h-9 text-xs shadow-sm px-5"
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
            )}
            Save Shift Policy
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setForm(DEFAULT_WORK_SHIFT_POLICY);
              setError(null);
            }}
            className="rounded-xl font-semibold h-9 text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5 text-foreground-muted" />
            Reset to Defaults
          </Button>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirmApplyOpen(true)}
          disabled={applyMutation.isPending || saveMutation.isPending || hasUnsavedChanges}
          className="rounded-xl font-bold h-9 text-xs bg-muted hover:bg-muted/80 text-foreground border border-border/60"
        >
          <Users className="w-3.5 h-3.5 mr-1.5 text-primary" />
          Apply Routine to All Drivers…
        </Button>
      </div>
      {hasUnsavedChanges && (
        <p className="text-xs text-foreground-muted">Save the policy before applying this routine to drivers.</p>
      )}

      <ConfirmDialog
        open={confirmApplyOpen}
        onOpenChange={setConfirmApplyOpen}
        variant="warning"
        title="Apply Standard Routine to All Active Drivers?"
        description={
          hasStaggerRestDays && hasStaggerBreaks
            ? `This action will recalculate the weekly schedule for all active drivers: operating between ${fmtTime12(form.shiftStart)} and ${fmtTime12(form.shiftEnd)}, with staggered lunch breaks across 4 slots (11:30 AM – 2:00 PM), and staggered rest days across the 7 days of the week (Sun–Sat) for 7-day fleet coverage.`
            : hasStaggerRestDays
            ? `This action will recalculate the weekly schedule for all active drivers: operating between ${fmtTime12(form.shiftStart)} and ${fmtTime12(form.shiftEnd)}, with staggered rest days across the 7 days of the week (Sun–Sat).`
            : hasStaggerBreaks
            ? `This action will recalculate the weekly schedule for all active drivers: operating between ${fmtTime12(form.shiftStart)} and ${fmtTime12(form.shiftEnd)}, with staggered lunch breaks across 4 slots (11:30 AM – 2:00 PM).`
            : `This action will replace the weekly schedule for all active drivers with an identical shift: ${fmtTime12(form.shiftStart)} – ${fmtTime12(form.shiftEnd)}, break: ${fmtTime12(form.breakStart)} – ${fmtTime12(form.breakEnd)}, and fixed rest days.`
        }
        confirmLabel={applyMutation.isPending ? "Applying…" : "Apply to All Drivers"}
        onConfirm={() =>
          applyMutation.mutate({
            stagger_breaks: hasStaggerBreaks,
            stagger_rest_days: hasStaggerRestDays,
          })
        }
        loading={applyMutation.isPending}
      />
    </div>
  );
}

export function WorkShiftPolicyCard() {
  const queryClient = useQueryClient();

  const { data: policy, isLoading, isError, error } = useQuery({
    queryKey: ["work-shift-policy"],
    queryFn: getWorkShiftPolicy,
  });

  return (
    <Card className="border-0 shadow-xs rounded-3xl bg-surface overflow-hidden">
      <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2 text-foreground">
              <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
                <CalendarClock className="w-4 h-4" />
              </div>
              Operating Hours &amp; Driver Shift Policy
            </CardTitle>
            <CardDescription className="text-xs text-foreground-secondary mt-0.5">
              Organizational standard work hours, staggered lunch breaks, and staggered rest days for fleet operations.
            </CardDescription>
          </div>
          <Badge
            variant="outline"
            className="rounded-full px-3 py-1 text-[11px] font-bold bg-primary/5 text-primary border-primary/20 shrink-0 self-start sm:self-auto"
          >
            <Sparkles className="w-3 h-3 mr-1 text-primary" />
            Configurable Baseline
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-5 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-foreground-muted gap-2 text-xs">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            Loading operating hours configuration…
          </div>
        ) : isError ? (
          <p className="text-sm text-danger">Could not load shift policy: {error?.message || "Request failed"}</p>
        ) : (
          <WorkShiftPolicyForm
            initialPolicy={policy || DEFAULT_WORK_SHIFT_POLICY}
            queryClient={queryClient}
          />
        )}
      </CardContent>
    </Card>
  );
}
