"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { createMaintenanceRecord } from "@/services/maintenance.service";
import { buildFuelDiagnosticPayload } from "@/lib/fuel/diagnostic";

export function FuelDiagnosticAction({ vehicle, from, to, existingDiagnostic, lookup, onFiled }) {
  const [confirmRepeat, setConfirmRepeat] = useState(false);
  const [filed, setFiled] = useState(null);
  const [filing, setFiling] = useState(false);
  const pending = useRef(false);

  async function file() {
    if (pending.current || filed || lookup.isError || !Array.isArray(lookup.data)) return;
    pending.current = true;
    setFiling(true);
    try {
      const created = await createMaintenanceRecord(buildFuelDiagnosticPayload({
        vehicleId: vehicle.vehicle_id, plate: vehicle.plate_number,
        estimatedKmpl: vehicle.estimated_kmpl, baselineKmpl: vehicle.baseline_efficiency,
        variancePercent: vehicle.variance_percent, from, to,
        trips: vehicle.trips, km: vehicle.distance, liters: vehicle.liters,
      }));
      setFiled(created?.maintenance_id ?? true);
      toast.success(`Diagnostic work order${created?.maintenance_id ? ` #${created.maintenance_id}` : ""} filed — scheduled for tomorrow.`);
      onFiled?.();
    } catch (error) {
      toast.error(error?.message || "Could not file the diagnostic work order.");
    } finally {
      pending.current = false;
      setFiling(false);
    }
  }

  if (filed) return <span role="status" className="text-xs font-semibold text-success-700">Diagnostic filed{typeof filed === "number" ? ` #${filed}` : ""}</span>;
  if (lookup.isError) return <Button type="button" variant="outline" size="sm" onClick={() => lookup.refetch()} disabled={lookup.isFetching}>Could not check existing diagnostics — retry</Button>;
  if (lookup.isLoading || !Array.isArray(lookup.data)) return <span role="status" className="text-xs text-foreground-muted">Checking existing diagnostics…</span>;

  return (
    <div className="space-y-2">
      {existingDiagnostic && <p className="text-xs text-foreground-secondary">Open diagnostic #{existingDiagnostic.maintenance_id} · {existingDiagnostic.status}</p>}
      {confirmRepeat && <p className="text-xs text-foreground-secondary">This creates a separate work order. Keep the existing diagnostic unless another inspection is needed.</p>}
      <Button type="button" size="sm" variant="outline" disabled={filing} className="min-h-[44px]" onClick={existingDiagnostic && !confirmRepeat ? () => setConfirmRepeat(true) : file}>
        {filing ? "Filing…" : existingDiagnostic ? confirmRepeat ? "Confirm another diagnostic" : "Create another diagnostic" : "Create diagnostic work order"}
      </Button>
      {confirmRepeat && <Button type="button" size="sm" variant="ghost" disabled={filing} onClick={() => setConfirmRepeat(false)}>Keep existing diagnostic</Button>}
    </div>
  );
}
