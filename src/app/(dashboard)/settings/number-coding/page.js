"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getUvvrpPolicy, updateUvvrpPolicy } from "@/services/settings.service";
import {
  getUvvrpExemptions,
  createUvvrpExemption,
  setUvvrpExemptionActive,
  getUvvrpViolations,
  decideUvvrpViolation,
} from "@/services/uvvrp.service";
import { getVehicles } from "@/services/vehicle.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "@/components/ui/toast";
import { Car, ShieldCheck, Clock, Hash, CheckCircle2, ShieldAlert } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { UVVRP_PRESETS } from "@/lib/uvvrp/policy";
import { cn } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function PolicyForm({ policy, queryClient }) {
  const [form, setForm] = useState(policy);

  const applyPreset = (preset) => {
    setForm((f) => ({ ...f, location: preset, weekdayRestrictions: UVVRP_PRESETS[preset] || f.weekdayRestrictions }));
  };

  const toggleDigit = (weekday, digit) => {
    setForm((f) => {
      const cur = f?.weekdayRestrictions?.[weekday] || [];
      const next = cur.includes(digit) ? cur.filter((d) => d !== digit) : [...cur, digit].sort((a, b) => a - b);
      return { ...f, weekdayRestrictions: { ...f.weekdayRestrictions, [weekday]: next } };
    });
  };

  const saveMutation = useMutation({
    mutationFn: updateUvvrpPolicy,
    onSuccess: (saved) => {
      setForm(saved);
      queryClient.invalidateQueries({ queryKey: ["uvvrp-policy"] });
      toast.success("Number coding policy saved.");
    },
    onError: (e) => toast.error(e.message || "Could not save policy."),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Label className="w-32 font-semibold text-xs">Policy State</Label>
        <select
          value={form.enabled ? "yes" : "no"}
          onChange={(e) => setForm({ ...form, enabled: e.target.value === "yes" })}
          className="h-9 rounded-3xl border border-border/80 bg-surface px-3 text-xs font-medium"
        >
          <option value="yes">Enabled</option>
          <option value="no">Disabled</option>
        </select>
      </div>

      <div className="flex items-center gap-3">
        <Label className="w-32 font-semibold text-xs">Location Preset</Label>
        <Select value={form.location || "custom"} onValueChange={applyPreset}>
          <SelectTrigger className="flex-1 h-9 rounded-3xl border-border/80 text-xs font-medium"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(UVVRP_PRESETS).map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-3">
        <Label className="w-32 font-semibold text-xs">On Violation</Label>
        <Select value={form.response} onValueChange={(v) => setForm({ ...form, response: v })}>
          <SelectTrigger className="flex-1 h-9 rounded-3xl border-border/80 text-xs font-medium"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="block">Block dispatch</SelectItem>
            <SelectItem value="warn">Warning only</SelectItem>
            <SelectItem value="approve">Require approval</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="block mb-2 text-xs font-semibold text-foreground">Restricted Plate Digits (per weekday)</Label>
        <div className="space-y-2 p-3 rounded-2xl bg-muted/20 border border-border/60">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="flex items-center gap-2">
              <span className="w-24 text-xs font-semibold text-foreground-secondary">{wd}</span>
              <div className="flex flex-wrap gap-1">
                {DIGITS.map((d) => {
                  const on = (form.weekdayRestrictions?.[wd] || []).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDigit(wd, d)}
                      className={cn(
                        "h-7 w-7 rounded-lg text-xs font-medium transition-all cursor-pointer font-data",
                        on ? "bg-danger text-white shadow-2xs" : "bg-surface border border-border/60 text-foreground-muted hover:border-danger/40 hover:text-danger"
                      )}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label className="block mb-2 text-xs font-semibold text-foreground">Exemption Categories (comma separated)</Label>
        <Input
          value={(form.exemptionCategories || []).join(", ")}
          onChange={(e) => setForm({ ...form, exemptionCategories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="Emergency Vehicles, Government Vehicles, ..."
          className="h-10 rounded-3xl border border-border/80 text-xs font-medium"
        />
      </div>

      <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending} className="rounded-xl font-semibold">
        {saveMutation.isPending ? "Saving…" : "Save Policy"}
      </Button>
    </div>
  );
}

export default function NumberCodingSettingsPage() {
  useRequireRole(["admin", "system_admin"]);
  const queryClient = useQueryClient();

  const { data: policy, isLoading } = useQuery({
    queryKey: ["uvvrp-policy"],
    queryFn: getUvvrpPolicy,
  });

  const { data: vehicles = [] } = useQuery({ queryKey: ["vehicles"], queryFn: () => getVehicles() });

  const { data: exemptions = [] } = useQuery({
    queryKey: ["uvvrp-exemptions"],
    queryFn: () => getUvvrpExemptions({ activeOnly: false }),
  });

  const { data: violations = [] } = useQuery({
    queryKey: ["uvvrp-violations"],
    queryFn: () => getUvvrpViolations({ pendingOnly: true }),
  });

  const [exForm, setExForm] = useState({ vehicle_id: "", category: "Government Pass", expires_on: "" });

  const addExemption = useMutation({
    mutationFn: createUvvrpExemption,
    onSuccess: () => {
      toast.success("Exemption pass added.");
      queryClient.invalidateQueries({ queryKey: ["uvvrp-exemptions"] });
      setExForm({ vehicle_id: "", category: "Government Pass", expires_on: "" });
    },
    onError: (e) => toast.error(e.message || "Failed to add exemption."),
  });

  const toggleExemption = useMutation({
    mutationFn: ({ id, active }) => setUvvrpExemptionActive(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uvvrp-exemptions"] });
    },
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }) => decideUvvrpViolation(id, { approve }),
    onSuccess: () => {
      toast.success("Decision updated.");
      queryClient.invalidateQueries({ queryKey: ["uvvrp-violations"] });
    },
  });

  return (
    <div className="space-y-6 pb-12 w-full select-none">
      {/* ── HERO HEADER BAR ── */}
      <HeroHeader
        icon={ShieldCheck}
        title="Number Coding (UVVRP) Settings"
        badge="Rules & Exemptions"
        description="Configure Metro Manila Unified Vehicle Volume Reduction Program rules, exemption passes, and pending violation decisions."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* PANEL 1: Global Policy Rules */}
        <Card className="lg:col-span-6 border-0 shadow-xs rounded-3xl bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Hash className="w-4 h-4 text-primary" /> Daily Rule Matrix
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {isLoading ? (
              <p className="text-xs font-medium text-foreground-muted">Loading policy…</p>
            ) : policy ? (
              <PolicyForm policy={policy} queryClient={queryClient} />
            ) : null}
          </CardContent>
        </Card>

        {/* PANEL 2: Vehicle Exemptions */}
        <Card className="lg:col-span-6 border-0 shadow-xs rounded-3xl bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <ShieldCheck className="w-4 h-4 text-success" /> Vehicle Exemption Passes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={exForm.vehicle_id} onValueChange={(v) => setExForm({ ...exForm, vehicle_id: v })}>
                <SelectTrigger className="h-9 rounded-3xl border-border/80 text-xs font-medium"><SelectValue placeholder="Vehicle" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map((vh) => (
                    <SelectItem key={vh.vehicle_id} value={String(vh.vehicle_id)}>
                      {vh.plate_number} — {vh.make || ""} {vh.model || ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={exForm.expires_on}
                onChange={(e) => setExForm({ ...exForm, expires_on: e.target.value })}
                className="h-9 rounded-3xl border-border/80 text-xs font-data font-medium"
              />
              <Button
                onClick={() => addExemption.mutate({ vehicle_id: Number(exForm.vehicle_id), category: exForm.category, expires_on: exForm.expires_on || null })}
                disabled={!exForm.vehicle_id || addExemption.isPending}
                className="rounded-xl font-semibold h-9 text-xs"
              >
                Add Pass
              </Button>
            </div>

            <div className="divide-y divide-border/60 max-h-80 overflow-y-auto">
              {exemptions.length === 0 ? (
                <EmptyState icon={ShieldCheck} title="No exemptions registered" description="Exemption passes bypass daily UVVRP rules." className="py-8" />
              ) : (
                exemptions.map((ex) => (
                  <div key={ex.exemption_id} className="py-2.5 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-foreground font-data truncate">{ex.plate_number || `Vehicle #${ex.vehicle_id}`}</p>
                      <p className="text-[11px] text-foreground-muted">{ex.category || "Pass"} {ex.expires_on ? `(Exp: ${ex.expires_on})` : ""}</p>
                    </div>
                    <button
                      onClick={() => toggleExemption.mutate({ id: ex.exemption_id, active: !ex.is_active })}
                      className="text-xs font-medium text-primary hover:underline cursor-pointer"
                    >
                      {ex.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PANEL 3: Pending Violations */}
      <Card className="border-0 shadow-xs rounded-3xl bg-surface">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ShieldAlert className="w-4 h-4 text-warning" /> Pending Coding Decisions
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {violations.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No pending violation decisions" description="Dispatches requiring manual override will appear here." className="py-8" />
          ) : (
            <div className="divide-y divide-border/60">
              {violations.map((v) => (
                <div key={v.violation_id} className="py-3 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium font-data text-foreground truncate">{v.plate_number || `Vehicle #${v.vehicle_id}`}</p>
                    <p className="text-[11px] text-foreground-muted">
                      {v.weekday} restriction (Digit {v.plate_digit}) — Dispatched for {v.scheduled_departure ? new Date(v.scheduled_departure).toLocaleString() : "today"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="xs" variant="success" className="rounded-xl font-medium" onClick={() => decide.mutate({ id: v.violation_id, approve: true })}>Approve</Button>
                    <Button size="xs" variant="danger" className="rounded-xl font-medium" onClick={() => decide.mutate({ id: v.violation_id, approve: false })}>Deny</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
