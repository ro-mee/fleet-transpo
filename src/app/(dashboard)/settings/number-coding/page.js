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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { Car, ShieldCheck, Clock } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { UVVRP_PRESETS } from "@/lib/uvvrp/policy";

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
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label className="w-32">Enabled</Label>
        <select
          value={form.enabled ? "yes" : "no"}
          onChange={(e) => setForm({ ...form, enabled: e.target.value === "yes" })}
          className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"
        >
          <option value="yes">Enabled</option>
          <option value="no">Disabled</option>
        </select>
      </div>

      <div className="flex items-center gap-3">
        <Label className="w-32">Location</Label>
        <Select value={form.location || "custom"} onValueChange={applyPreset}>
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.keys(UVVRP_PRESETS).map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-3">
        <Label className="w-32">On violation</Label>
        <Select value={form.response} onValueChange={(v) => setForm({ ...form, response: v })}>
          <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="block">Block dispatch</SelectItem>
            <SelectItem value="warn">Warning only</SelectItem>
            <SelectItem value="approve">Require approval</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="block mb-2">Restricted plate-ending digits (per weekday)</Label>
        <div className="space-y-2">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="flex items-center gap-2">
              <span className="w-24 text-xs text-foreground-muted">{wd}</span>
              <div className="flex flex-wrap gap-1">
                {DIGITS.map((d) => {
                  const on = (form.weekdayRestrictions?.[wd] || []).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDigit(wd, d)}
                      className={`h-7 w-7 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                        on ? "bg-danger text-surface" : "bg-hover text-foreground-muted hover:text-foreground"
                      }`}
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
        <Label className="block mb-2">Exemption categories (comma separated)</Label>
        <Input
          value={(form.exemptionCategories || []).join(", ")}
          onChange={(e) => setForm({ ...form, exemptionCategories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="Emergency Vehicles, Government Vehicles, ..."
        />
      </div>

      <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
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
  const { data: exemptions = [] } = useQuery({ queryKey: ["uvvrp-exemptions"], queryFn: getUvvrpExemptions });
  const { data: pending = [] } = useQuery({
    queryKey: ["uvvrp-pending"],
    queryFn: () => getUvvrpViolations({ status: "pending_approval" }),
  });

  const [exForm, setExForm] = useState({ vehicle_id: "", category: "", reason: "", expires_on: "" });

  const addExemption = useMutation({
    mutationFn: createUvvrpExemption,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uvvrp-exemptions"] });
      setExForm({ vehicle_id: "", category: "", reason: "", expires_on: "" });
      toast.success("Exemption added.");
    },
    onError: (e) => toast.error(e.message || "Could not add exemption."),
  });

  const toggleExemption = useMutation({
    mutationFn: ({ id, active }) => setUvvrpExemptionActive(id, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["uvvrp-exemptions"] }),
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }) => decideUvvrpViolation(id, { approve, reason: "Resolved from settings" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["uvvrp-pending"] });
      toast.success("Coding approval decision recorded.");
    },
    onError: (e) => toast.error(e.message || "Could not record decision."),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Number Coding (UVVRP)" description="Configure the plate-coding policy and manage exemptions. Admin only." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-foreground-muted" /> Policy</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-foreground-muted">Loading policy…</p>
            ) : (
              <PolicyForm key={policy?.updated_at || "policy"} policy={policy} queryClient={queryClient} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Car className="h-4 w-4 text-foreground-muted" /> Vehicle Exemptions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Select value={exForm.vehicle_id ? String(exForm.vehicle_id) : undefined} onValueChange={(v) => setExForm({ ...exForm, vehicle_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Vehicle" /></SelectTrigger>
                  <SelectContent>
                    {vehicles.map((v) => (
                      <SelectItem key={v.vehicle_id} value={String(v.vehicle_id)}>{v.plate_number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={exForm.category} onChange={(e) => setExForm({ ...exForm, category: e.target.value })} placeholder="Category (e.g. Hotel Shuttle)" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input value={exForm.reason} onChange={(e) => setExForm({ ...exForm, reason: e.target.value })} placeholder="Reason (optional)" />
                <Input type="date" value={exForm.expires_on} onChange={(e) => setExForm({ ...exForm, expires_on: e.target.value })} />
              </div>
              <Button
                onClick={() => addExemption.mutate({ ...exForm, vehicle_id: Number(exForm.vehicle_id), expires_on: exForm.expires_on || null })}
                disabled={addExemption.isPending || !exForm.vehicle_id || !exForm.category}
              >
                {addExemption.isPending ? "Adding…" : "Add Exemption"}
              </Button>

              {exemptions.length ? (
                <div className="divide-y divide-border">
                  {exemptions.map((ex) => (
                    <div key={ex.exemption_id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{ex.plate_number || `Vehicle #${ex.vehicle_id}`}</p>
                        <p className="text-xs text-foreground-muted truncate">
                          {ex.category}{ex.expires_on ? ` · until ${ex.expires_on.slice(0, 10)}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => toggleExemption.mutate({ id: ex.exemption_id, active: !ex.active })}
                        className="text-xs font-medium text-primary hover:underline cursor-pointer"
                      >
                        {ex.active ? "Revoke" : "Reactivate"}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={Car} title="No exemptions" description="Add exempt vehicles above." className="py-8" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4 text-foreground-muted" /> Pending Coding Approvals</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {pending.length === 0 ? (
                <EmptyState icon={Clock} title="Nothing pending" description="Approval-required coding violations will appear here." className="py-8" />
              ) : (
                <div className="divide-y divide-border">
                  {pending.map((v) => (
                    <div key={v.violation_id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{v.plate_number || `Vehicle #${v.vehicle_id}`}</p>
                        <p className="text-xs text-foreground-muted truncate">
                          {v.weekday} · ends {v.plate_digit} · {v.scheduled_departure ? new Date(v.scheduled_departure).toLocaleString() : ""}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button size="sm" variant="success" onClick={() => decide.mutate({ id: v.violation_id, approve: true })}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: v.violation_id, approve: false })}>Deny</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
