"use client";

import { useRef, useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { refreshMaintenance } from "@/lib/maintenance/outlook-display";
import { hasRole } from "@/lib/auth/permissions";
import { Input } from "@/components/ui/input";
import { MechanicAssignmentField } from "@/components/maintenance/mechanic-assignment-field";
import { createMaintenanceRecord, createReviewedPlanWorkOrder, updateMaintenanceRecord, getMechanics } from "@/services/maintenance.service";
import { getVehicles } from "@/services/vehicle.service";
import { useAuth } from "@/hooks/use-auth";
import { normalizeMaintenanceMileage, normalizeVehicleId, selectMaintenanceVehicle } from "@/lib/maintenance/vehicle-selection";
import { toast } from "@/components/ui/toast";

export default function MaintenanceFormDialog({ isOpen, onClose, initialData }) {
  const queryClient = useQueryClient();
  const isEditing = !!initialData?.maintenance_id;
  // P0 mechanic integration: assignment UI is staff-only — never render it
  // for the mechanic role (the server whitelist strips it regardless).
  const { employee } = useAuth();
  const canAssignMechanic = hasRole(employee, ["super_admin", "admin", "fleet_manager"]);
  const submitting = useRef(false);
  const [formError, setFormError] = useState(null);
  const [conflicted, setConflicted] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [pendingCancellationData, setPendingCancellationData] = useState(null);
  const [formData, setFormData] = useState({
    vehicle_id: normalizeVehicleId(initialData?.vehicle_id),
    maintenance_type: initialData?.maintenance_type || "Routine",
    status: initialData?.status || "Scheduled",
    priority: initialData?.priority || "Normal",
    maintenance_date: initialData?.maintenance_date ? initialData.maintenance_date.split('T')[0] : new Date().toISOString().split('T')[0],
    description: initialData?.description || "",
    cost: initialData?.cost || "",
    mileage_at_service: normalizeMaintenanceMileage(initialData?.mileage_at_service),
    completed_date: initialData?.completed_date ? initialData.completed_date.split('T')[0] : "",
    remarks: initialData?.remarks || "",
    // Staff assign-mechanic select value: "" = unassigned. Seeded from the
    // row on edit so an untouched select never drops the current assignee.
    assigned_mechanic_id: initialData?.assigned_mechanic_id != null && initialData?.assigned_mechanic_id !== ""
      ? String(initialData.assigned_mechanic_id)
      : ""
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles"],
    queryFn: getVehicles,
    staleTime: 60_000,
  });

  // Active-mechanic directory. Staff-only query: disabled for any other role
  // so no request fires where the UI (and the endpoint guard) refuses it.
  const mechanicsQuery = useQuery({
    queryKey: ["mechanics-for-maintenance"],
    queryFn: getMechanics,
    enabled: canAssignMechanic,
    staleTime: 60_000,
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "vehicle_id") {
      setFormData((prev) => selectMaintenanceVehicle(prev, value, vehicles));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const saveRecord = async (data, { showErrorToast = true } = {}) => {
    if (submitting.current || conflicted) return;
    submitting.current = true;
    setFormError(null);
    setLoading(true);
    // P0: fold the assign-mechanic select into the payload. Create sends the
    // id only when a mechanic is chosen; edit sends it only when the
    // selection changed — "" back to null is an explicit unassign, an
    // untouched select stays out of the PUT entirely.
    const payload = { ...data };
    const selected = payload.assigned_mechanic_id === "unassigned" ? "" : payload.assigned_mechanic_id;
    if (isEditing) {
      const before = initialData?.assigned_mechanic_id != null && initialData?.assigned_mechanic_id !== ""
        ? String(initialData.assigned_mechanic_id)
        : "";
      if (selected === before) delete payload.assigned_mechanic_id;
      else payload.assigned_mechanic_id = selected === "" ? null : Number(selected);
    } else if (selected === "") {
      delete payload.assigned_mechanic_id;
    } else {
      payload.assigned_mechanic_id = Number(selected);
    }
    try {
      if (isEditing) {
        await updateMaintenanceRecord(initialData.maintenance_id, payload);
        toast.success("Maintenance updated successfully");
      } else {
        if (initialData?.service_plan_id) {
          await createReviewedPlanWorkOrder(initialData.vehicle_id, { plan_id: initialData.service_plan_id, version: initialData.expected_version,
            service_code: initialData.service_code }, payload);
        } else await createMaintenanceRecord(payload);
        toast.success("Maintenance scheduled successfully");
      }
      await refreshMaintenance(queryClient);
      setPendingCancellationData(null);
      onClose();
    } catch (err) {
      setFormError(err.message || "Failed to save maintenance record");
      if (err.status === 409) { setConflicted(true); await refreshMaintenance(queryClient); }
      if (showErrorToast) toast.error(err.message || "Failed to save maintenance record");
      throw err;
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isEditing && formData.status === "Cancelled" && initialData?.status !== "Cancelled") {
      setPendingCancellationData({ ...formData });
      return;
    }
    await saveRecord(formData).catch(() => {});
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !loading) onClose(); }}>
      <DialogContent className="sm:max-w-[500px] max-h-[90dvh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? (formData.status === 'Completed' ? 'View/Edit Record' : 'Resolve Maintenance') : 'Schedule Maintenance'}</DialogTitle>
            <DialogDescription>
              {isEditing ? "Update details or complete this maintenance record." : initialData?.service_code ? `Review ${initialData.service_code} service for this vehicle.` : "Create a new maintenance record for a vehicle."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field label="Vehicle">
              <select className="min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground" aria-label="Vehicle" name="vehicle_id" value={formData.vehicle_id} onChange={handleChange} required disabled={isEditing || !!initialData?.service_plan_id}>
                <option value="">Select a vehicle...</option>
                {vehicles.map(v => (
                  <option key={v.vehicle_id} value={String(v.vehicle_id)}>{v.plate_number} - {v.vehicle_name}</option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Type">
                <select className="min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground" aria-label="Maintenance type" name="maintenance_type" value={formData.maintenance_type} onChange={handleChange} required disabled={!!initialData?.service_plan_id}>
                  <option value="Routine">Routine</option>
                  <option value="Corrective">Corrective</option>
                  <option value="Preventive">Preventive</option>
                  <option value="Emergency">Emergency</option>
                </select>
              </Field>
              <Field label="Status">
                <select className="min-h-[44px] w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground" aria-label="Status" name="status" disabled={!!initialData?.service_plan_id && !isEditing} value={formData.status} onChange={handleChange} required>
                  <option value="Scheduled">Scheduled</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Pending Inspection">Pending Inspection</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </Field>
            </div>

            <Field label="Maintenance Date">
              <DatePicker label="Maintenance date" value={formData.maintenance_date} onChange={(value) => setFormData(prev => ({...prev, maintenance_date: value}))} />
            </Field>

            {canAssignMechanic && (
              <MechanicAssignmentField
                value={formData.assigned_mechanic_id}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, assigned_mechanic_id: value }))}
                directory={mechanicsQuery}
              />
            )}

            <Field label="Description">
              <Input type="text" name="description" aria-label="Description" value={formData.description} onChange={handleChange} placeholder="Brief description of service needed/done" />
            </Field>

            <Field
              label="Mileage at Service (km)"
              hint="Prefilled from the vehicle’s saved mileage; adjust it if the odometer reading at service differs."
            >
              <Input
                type="number"
                step="1"
                min="0"
                name="mileage_at_service"
                aria-label="Mileage at service (km)"
                value={formData.mileage_at_service}
                onChange={handleChange}
                placeholder="Odometer reading"
              />
            </Field>

            {formData.status === "Completed" && (
              <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-border">
                <Field label="Completed Date">
                  <DatePicker label="Completed date" value={formData.completed_date} onChange={(value) => setFormData(prev => ({...prev, completed_date: value}))} />
                </Field>
                <Field label="Cost (₱)">
                  <Input type="number" step="0.01" min="0" name="cost" aria-label="Cost (PHP)" value={formData.cost} onChange={handleChange} placeholder="0.00" />
                </Field>
              </div>
            )}
          </div>
          {formError && <p role="alert" className="mb-4 text-sm text-danger-700 dark:text-danger">{formError}{conflicted && " The outlook has been refreshed. Close and review the latest service evidence before reopening."}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading || conflicted}>{loading ? "Saving..." : "Save Record"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <ConfirmDialog
        open={!!pendingCancellationData}
        onOpenChange={(open) => { if (!open) setPendingCancellationData(null); }}
        title="Cancel this maintenance record?"
        message="This is a terminal work-order status. The record will remain in history and cannot be edited afterward."
        confirmLabel="Cancel record"
        cancelLabel="Keep editing"
        variant="danger"
        reconsiderable
        actionKey={initialData?.maintenance_id}
        workingLabel="Cancelling record..."
        onConfirm={async () => {
          if (pendingCancellationData) {
            await saveRecord(pendingCancellationData, { showErrorToast: false });
          }
        }}
      />
    </Dialog>
  );
}
