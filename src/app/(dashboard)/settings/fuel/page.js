"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { getFuelPolicy, updateFuelPolicy } from "@/services/settings.service";
import {
  DEFAULT_FUEL_POLICY,
  FUEL_POLICY_RANGES,
  validateFuelPolicy,
} from "@/lib/fuel/fuel-policy";
import { cn } from "@/lib/utils";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatCard } from "@/components/ui/stat-card";
import {
  Fuel,
  ShieldAlert,
  Zap,
  DollarSign,
  TriangleAlert,
  RotateCcw,
  Save,
  CheckCircle2,
  Camera,
  Layers,
  Info,
  Scale,
} from "lucide-react";

function ToggleRow({ label, description, checked, onChange, disabled = false }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-3 border-b border-border/40 last:border-0", disabled && "opacity-50")}>
      <div className="min-w-0 pr-2">
        <p className="text-xs font-bold text-foreground leading-tight">{label}</p>
        {description && (
          <p className="text-[11px] text-foreground-secondary mt-1 leading-normal">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          checked ? "bg-primary" : "bg-border",
          disabled && "cursor-not-allowed"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-all",
            checked ? "left-4.5" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}

function NumberRangeField({ label, hint, min, max, unit = "%", value, onChange, disabled = false }) {
  return (
    <div className={cn("flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-3 border-b border-border/40 last:border-0", disabled && "opacity-50")}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-semibold text-foreground">{label}</Label>
          <span className="text-[10px] font-mono text-foreground-muted">[{min}–{max}{unit}]</span>
        </div>
        {hint && <p className="text-[11px] text-foreground-secondary mt-0.5">{hint}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Input
          type="number"
          min={min}
          max={max}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className="h-9 w-24 rounded-2xl border border-border/80 font-data text-xs text-right px-3"
        />
        <span className="text-xs font-medium text-foreground-muted w-6">{unit}</span>
      </div>
    </div>
  );
}

function TankVisualizer({ reserve, target, cap }) {
  const r = Math.min(40, Math.max(5, Number(reserve) || 10));
  const t = Math.min(100, Math.max(r + 1, Number(target) || 90));
  const c = Math.min(100, Math.max(t, Number(cap) || 100));

  return (
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5 text-primary" /> Three-Value Tank Partition Model
        </span>
        <span className="text-[11px] text-foreground-muted font-mono">0% → 100% capacity</span>
      </div>

      {/* Visual Bar */}
      <div className="relative h-7 w-full rounded-xl overflow-hidden bg-muted flex border border-border/60 shadow-inner">
        {/* Reserve Zone */}
        <div
          style={{ width: `${r}%` }}
          className="h-full bg-danger/70 flex items-center justify-center text-[10px] font-bold text-white tracking-wider uppercase transition-all duration-300"
          title={`Reserve Buffer: ${r}%`}
        >
          {r >= 12 && `Reserve ${r}%`}
        </div>

        {/* Operating Refill Zone */}
        <div
          style={{ width: `${t - r}%` }}
          className="h-full bg-primary/70 flex items-center justify-center text-[10px] font-bold text-white tracking-wider uppercase transition-all duration-300"
          title={`Normal Operating Zone: ${t - r}%`}
        >
          {t - r >= 20 && `Target ${t}%`}
        </div>

        {/* Headroom / Buffer Zone */}
        <div
          style={{ width: `${c - t}%` }}
          className="h-full bg-emerald-500/70 flex items-center justify-center text-[10px] font-bold text-white tracking-wider uppercase transition-all duration-300"
          title={`Top Headroom: ${c - t}%`}
        >
          {c - t >= 10 && `Cap ${c}%`}
        </div>

        {/* Locked / Expansion Space */}
        {100 - c > 0 && (
          <div
            style={{ width: `${100 - c}%` }}
            className="h-full bg-border/80 flex items-center justify-center text-[9px] font-semibold text-foreground-muted transition-all duration-300"
            title={`Expansion Air Gap: ${100 - c}%`}
          >
            {100 - c >= 8 && "Cap"}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[11px] text-foreground-secondary pt-1">
        <div className="flex items-center gap-1.5 justify-center">
          <span className="w-2.5 h-2.5 rounded-full bg-danger/80 inline-block" />
          <span>Safety Floor ({r}%)</span>
        </div>
        <div className="flex items-center gap-1.5 justify-center">
          <span className="w-2.5 h-2.5 rounded-full bg-primary/80 inline-block" />
          <span>Operating Target ({t}%)</span>
        </div>
        <div className="flex items-center gap-1.5 justify-center">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
          <span>Max Allowed ({c}%)</span>
        </div>
      </div>
    </div>
  );
}

function FuelPolicyForm({ policy, queryClient }) {
  const [form, setForm] = useState({ ...DEFAULT_FUEL_POLICY, ...policy });
  const [error, setError] = useState(null);

  const saveMutation = useMutation({
    mutationFn: updateFuelPolicy,
    onSuccess: (saved) => {
      setForm({ ...DEFAULT_FUEL_POLICY, ...saved });
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["fuel-policy"] });
      toast.success("Fuel policy updated successfully.");
    },
    onError: (e) => {
      setError(e.message || "Could not save the fuel policy.");
      toast.error(e.message || "Could not save the fuel policy.");
    },
  });

  const handleSave = () => {
    const check = validateFuelPolicy(form);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError(null);
    saveMutation.mutate(form);
  };

  const handleReset = () => {
    setForm(DEFAULT_FUEL_POLICY);
    setError(null);
    toast.info("Reset form to default fuel governance parameters.");
  };

  return (
    <div className="space-y-6">
      {/* ── KPI STATUS AT A GLANCE ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        <StatCard
          icon={Zap}
          label="Auto-Authorization"
          value={form.autoApprovalEnabled ? "Enabled" : "Disabled"}
          valueNote={form.autoApprovalEnabled ? `≤ ${form.autoApprovalMaxLiters} L per permit` : "Manual review only"}
          tone={form.autoApprovalEnabled ? "success" : "neutral"}
        />
        <StatCard
          icon={Fuel}
          label="Reserve Buffer"
          value={`${form.reserveBufferPercent}%`}
          valueNote="Safety minimum floor"
          tone="warning"
        />
        <StatCard
          icon={Layers}
          label="Target Fill Level"
          value={`${form.preferredTargetPercent}%`}
          valueNote="Optimal refill operating point"
          tone="primary"
        />
        <StatCard
          icon={ShieldAlert}
          label="Pilferage Detection"
          value={form.enableVarianceAlerts ? `${form.varianceThresholdPercent}%` : "Off"}
          valueNote={form.enableVarianceAlerts ? "Telemetry vs report variance" : "Alerts disabled"}
          tone={form.enableVarianceAlerts ? "danger" : "neutral"}
        />
        <StatCard
          icon={Scale}
          label="Budget Enforcement"
          value={form.budgetEnforcementMode === "strict" ? "Strict" : "Warning"}
          valueNote={form.budgetEnforcementMode === "strict" ? "Hard block over-budget" : "Manager override allowed"}
          tone={form.budgetEnforcementMode === "strict" ? "danger" : "info"}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-xs font-semibold text-danger">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {/* ── POLICY CARDS GRID ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Card 1: Refueling Thresholds */}
        <Card className="border-0 shadow-xs rounded-3xl bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
              <Fuel className="w-4 h-4 text-primary" /> Refueling &amp; Planning Thresholds
            </CardTitle>
            <CardDescription className="text-xs text-foreground-secondary mt-0.5">
              Governs minimum safe reserve floors, standard preferred operational fill targets, and maximum tank limits.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <TankVisualizer
              reserve={form.reserveBufferPercent}
              target={form.preferredTargetPercent}
              cap={form.maxFillCapPercent}
            />

            <NumberRangeField
              label="Safety Reserve Buffer"
              hint="Minimum fuel percentage retained before triggering a mandatory refill recommendation."
              min={FUEL_POLICY_RANGES.reserveBufferPercent.min}
              max={FUEL_POLICY_RANGES.reserveBufferPercent.max}
              value={form.reserveBufferPercent}
              onChange={(v) => setForm((f) => ({ ...f, reserveBufferPercent: v }))}
            />

            <NumberRangeField
              label="Preferred Target Operating Level"
              hint="Target fill percentage to ensure range safety while preventing excessive pump visit frequency."
              min={FUEL_POLICY_RANGES.preferredTargetPercent.min}
              max={FUEL_POLICY_RANGES.preferredTargetPercent.max}
              value={form.preferredTargetPercent}
              onChange={(v) => setForm((f) => ({ ...f, preferredTargetPercent: v }))}
            />

            <NumberRangeField
              label="Physical Tank Space Cap"
              hint="Upper bound percentage to prevent overfilling and account for thermal expansion."
              min={FUEL_POLICY_RANGES.maxFillCapPercent.min}
              max={FUEL_POLICY_RANGES.maxFillCapPercent.max}
              value={form.maxFillCapPercent}
              onChange={(v) => setForm((f) => ({ ...f, maxFillCapPercent: v }))}
            />
          </CardContent>
        </Card>

        {/* Card 2: Pilferage & Variance Detection */}
        <Card className="border-0 shadow-xs rounded-3xl bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-warning" /> Pilferage &amp; Consumption Variance
            </CardTitle>
            <CardDescription className="text-xs text-foreground-secondary mt-0.5">
              Detects discrepancies between driver-reported gauge levels and theoretical consumption from completed trip mileage.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <ToggleRow
              label="Enable Fuel Variance Auditing"
              description="Automatically detects fuel anomalies by cross-referencing trip distances with vehicle fuel efficiency profiles."
              checked={form.enableVarianceAlerts}
              onChange={(v) => setForm((f) => ({ ...f, enableVarianceAlerts: v }))}
            />

            <NumberRangeField
              label="Discrepancy Threshold"
              hint="Gap percentage of total tank capacity that triggers an anomaly flag and routes the request to manager queue."
              min={FUEL_POLICY_RANGES.varianceThresholdPercent.min}
              max={FUEL_POLICY_RANGES.varianceThresholdPercent.max}
              disabled={!form.enableVarianceAlerts}
              value={form.varianceThresholdPercent}
              onChange={(v) => setForm((f) => ({ ...f, varianceThresholdPercent: v }))}
            />

            <div className="rounded-2xl border border-warning/30 bg-warning/5 p-3.5 flex items-start gap-2.5 text-xs text-foreground-secondary">
              <Info className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                When variance exceeds <strong className="text-foreground font-mono">{form.varianceThresholdPercent}%</strong>, auto-authorization is immediately bypassed. The permit is diverted to the Fleet Manager with dashboard gauge photo audit evidence.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Auto-Authorization Engine */}
        <Card className="border-0 shadow-xs rounded-3xl bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
              <Zap className="w-4 h-4 text-success-700" /> Auto-Authorization Engine
            </CardTitle>
            <CardDescription className="text-xs text-foreground-secondary mt-0.5">
              Automates instant approval for compliant refill requests, freeing dispatchers from manual approvals for routine refills.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-2">
            <ToggleRow
              label="Auto-Approval Engine"
              description="Instantly approves permits when all criteria (clean variance, positive recommendation, budget coverage) are met."
              checked={form.autoApprovalEnabled}
              onChange={(v) => setForm((f) => ({ ...f, autoApprovalEnabled: v }))}
            />

            <NumberRangeField
              label="Auto-Approval Volume Ceiling"
              hint="Refueling requests exceeding this liter threshold require manual Fleet Manager ladder sign-off."
              min={FUEL_POLICY_RANGES.autoApprovalMaxLiters.min}
              max={FUEL_POLICY_RANGES.autoApprovalMaxLiters.max}
              unit="L"
              disabled={!form.autoApprovalEnabled}
              value={form.autoApprovalMaxLiters}
              onChange={(v) => setForm((f) => ({ ...f, autoApprovalMaxLiters: v }))}
            />

            <ToggleRow
              label="Mandatory Gauge Photo Evidence"
              description="Requires driver to submit a fresh in-app dashboard gauge camera photo before submitting a refill request."
              checked={form.requireGaugePhoto}
              onChange={(v) => setForm((f) => ({ ...f, requireGaugePhoto: v }))}
            />

          </CardContent>
        </Card>

        {/* Card 4: Cost & Budget Governance */}
        <Card className="border-0 shadow-xs rounded-3xl bg-surface">
          <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20">
            <CardTitle className="text-sm font-extrabold flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-600" /> Cost &amp; Budget Controls
            </CardTitle>
            <CardDescription className="text-xs text-foreground-secondary mt-0.5">
              Enforces monthly vehicle budget allocation boundaries and protects against anomalous pump pricing.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-2 border-b border-border/40 pb-4">
              <Label className="text-xs font-semibold text-foreground">Monthly Budget Enforcement Mode</Label>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, budgetEnforcementMode: "warning" }))}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-2xl border transition-all cursor-pointer",
                    form.budgetEnforcementMode === "warning"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-muted/20 text-foreground-muted hover:border-border"
                  )}
                >
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    {form.budgetEnforcementMode === "warning" && <CheckCircle2 className="w-3.5 h-3.5" />}
                    Warning Mode (Default)
                  </span>
                  <span className="text-[11px] text-foreground-secondary mt-1">
                    Warns manager on overrun; allows override with audit justification.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, budgetEnforcementMode: "strict" }))}
                  className={cn(
                    "flex flex-col text-left p-3 rounded-2xl border transition-all cursor-pointer",
                    form.budgetEnforcementMode === "strict"
                      ? "border-danger bg-danger/10 text-danger"
                      : "border-border/60 bg-muted/20 text-foreground-muted hover:border-border"
                  )}
                >
                  <span className="text-xs font-bold flex items-center gap-1.5">
                    {form.budgetEnforcementMode === "strict" && <CheckCircle2 className="w-3.5 h-3.5" />}
                    Strict Mode
                  </span>
                  <span className="text-[11px] text-foreground-secondary mt-1">
                    Hard blocks permit approvals once vehicle monthly budget is depleted.
                  </span>
                </button>
              </div>
            </div>

            <NumberRangeField
              label="Maximum Price Per Liter Ceiling"
              hint="Receipts reporting pump prices exceeding this limit trigger an anomaly review warning."
              min={FUEL_POLICY_RANGES.maxPricePerLiter.min}
              max={FUEL_POLICY_RANGES.maxPricePerLiter.max}
              unit="₱/L"
              value={form.maxPricePerLiter}
              onChange={(v) => setForm((f) => ({ ...f, maxPricePerLiter: v }))}
            />

            <ToggleRow
              label="Strict Fuel Type Matching"
              description="Reject claims when receipt product line conflicts with vehicle profile (e.g., Gasoline claimed for Diesel engine)."
              checked={form.strictFuelTypeMatching}
              onChange={(v) => setForm((f) => ({ ...f, strictFuelTypeMatching: v }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* ── ACTION CONTROLS ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-border/60">
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <Camera className="w-3.5 h-3.5" />
          <span>Policies take effect immediately for all active dispatch calculations and mobile submissions.</span>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleReset}
            disabled={saveMutation.isPending}
            className="rounded-2xl text-xs font-semibold cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reset to defaults
          </Button>

          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="rounded-2xl text-xs font-semibold shadow-sm cursor-pointer"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveMutation.isPending ? "Saving changes…" : "Save Fuel Policy"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function FuelPolicyPage() {
  useRequireRole();
  const queryClient = useQueryClient();

  const { data: policy, isLoading, isError, error } = useQuery({
    queryKey: ["fuel-policy"],
    queryFn: getFuelPolicy,
  });

  return (
    <div className="space-y-8 pb-12 w-full select-none">
      <HeroHeader
        icon={Fuel}
        title="Fuel Governance & Policy"
        badge="Consumption &amp; Cost Control"
        description="Configure automated fuel request authorization, consumption variance detection, tank safety buffers, and monthly budget enforcement rules across the fleet."
      />

      <div className="pt-2">
        {isLoading ? (
          <div className="p-8 text-center text-sm text-foreground-muted">
            Loading fuel governance policies…
          </div>
        ) : isError ? (
          <div className="p-6 rounded-3xl border border-danger/30 bg-danger/10 text-danger text-sm font-medium">
            Failed to load fuel policy: {error?.message || "Internal server error"}
          </div>
        ) : (
          <FuelPolicyForm policy={policy || DEFAULT_FUEL_POLICY} queryClient={queryClient} />
        )}
      </div>
    </div>
  );
}
