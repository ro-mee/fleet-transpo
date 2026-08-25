"use client";

import { Fuel, Gauge, Layers, Loader2, Sparkles, Truck, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

export function ConfigureAllocationDialog({
  open,
  onOpenChange,
  vehicle,
  form,
  setForm,
  onSubmit,
  isPending,
}) {
  if (!vehicle) return null;

  const usedOrCommitted =
    Number(vehicle.consumed_liters || 0) + Number(vehicle.committed_liters || 0);

  const budgetLiters = Number(form.allocated_liters) || 0;
  const tankCapacity = Number(form.tank_capacity_l) || 0;
  const efficiency = Number(form.fuel_efficiency_kmpl) || 0;
  const estimatedFullTankRange = tankCapacity > 0 && efficiency > 0 ? tankCapacity * efficiency : null;
  const estimatedMonthlyRange = budgetLiters > 0 && efficiency > 0 ? budgetLiters * efficiency : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[95vw] md:w-[500px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-bold text-foreground">
                  Configure Fuel Budget
                </DialogTitle>
                <span className="inline-flex items-center rounded-lg border border-border bg-muted/70 px-2 py-0.5 font-mono text-xs font-bold text-foreground">
                  {vehicle.plate_number}
                </span>
              </div>
              <p className="text-xs text-foreground-muted mt-0.5">
                {vehicle.vehicle_name ? `${vehicle.vehicle_name} • ` : ""}
                Monthly operational refill limits & vehicle consumption profile.
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Main Monthly Budget Field (Hero Double-Bezel Card) */}
          <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
            <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="monthly_allocation" className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Fuel className="w-3.5 h-3.5 text-primary" /> Monthly Fuel Budget
                </Label>
                <span className="text-[11px] font-semibold text-foreground-muted">
                  Current Month
                </span>
              </div>

              <div className="relative">
                <Input
                  id="monthly_allocation"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.allocated_liters}
                  onChange={(e) => setForm({ ...form, allocated_liters: e.target.value })}
                  placeholder="e.g. 200"
                  className="text-lg font-data font-bold pr-16 h-11"
                  autoFocus
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-foreground-muted pointer-events-none">
                  Liters
                </span>
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50 text-foreground-secondary">
                <span className="text-foreground-muted">Used or committed this month:</span>
                <span className="font-data font-bold text-foreground">
                  {usedOrCommitted.toFixed(1)} L
                  {budgetLiters > 0 && (
                    <span className="font-normal text-foreground-muted ml-1">
                      ({Math.round((usedOrCommitted / budgetLiters) * 100)}%)
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Vehicle Profile: Tank Capacity & Efficiency */}
          <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
            <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3">
              <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                Vehicle Specifications
              </span>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tank_capacity" className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <Layers className="w-3 h-3 text-primary" /> Tank Capacity
                  </Label>
                  <div className="relative">
                    <Input
                      id="tank_capacity"
                      type="number"
                      min="0.01"
                      max="1000"
                      step="0.01"
                      value={form.tank_capacity_l}
                      onChange={(e) => setForm({ ...form, tank_capacity_l: e.target.value })}
                      placeholder="65.0"
                      className="text-sm font-data font-semibold pr-9 h-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-foreground-muted pointer-events-none">
                      L
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="fuel_efficiency" className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <Gauge className="w-3 h-3 text-primary" /> Fuel Efficiency
                  </Label>
                  <div className="relative">
                    <Input
                      id="fuel_efficiency"
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={form.fuel_efficiency_kmpl}
                      onChange={(e) => setForm({ ...form, fuel_efficiency_kmpl: e.target.value })}
                      placeholder="10.5"
                      className="text-sm font-data font-semibold pr-14 h-10"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-foreground-muted pointer-events-none">
                      km/L
                    </span>
                  </div>
                </div>
              </div>

              {/* Calculated Range Helper */}
              {(estimatedFullTankRange || estimatedMonthlyRange) && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50 text-[11px] text-foreground-muted">
                  {estimatedFullTankRange && (
                    <span>Est. Tank Range: <strong className="font-semibold text-foreground">≈ {Math.round(estimatedFullTankRange)} km</strong></span>
                  )}
                  {estimatedMonthlyRange && (
                    <span>Est. Monthly Range: <strong className="font-semibold text-foreground">≈ {Math.round(estimatedMonthlyRange)} km</strong></span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/70 bg-surface/90 backdrop-blur-md flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="text-xs h-9 px-4"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isPending}
            className="text-xs h-9 px-5 font-bold bg-primary text-primary-foreground shadow-xs"
          >
            {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
            Save Fuel Plan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
