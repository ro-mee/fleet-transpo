"use client";

import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createMaintenanceRecord, updateMaintenanceRecord } from "@/services/maintenance.service";
import { getVehicles } from "@/services/vehicle.service";
import { toast } from "@/components/ui/toast";

export default function MaintenanceFormDialog({ isOpen, onClose, initialData }) {
  const queryClient = useQueryClient();
  const isEditing = !!initialData?.maintenance_id;
  const isCompletion = initialData?.status === "Scheduled" || initialData?.status === "In Progress";
  
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    vehicle_id: initialData?.vehicle_id || "",
    maintenance_type: initialData?.maintenance_type || "Routine",
    status: initialData?.status || "Scheduled",
    priority: initialData?.priority || "Normal",
    maintenance_date: initialData?.maintenance_date ? initialData.maintenance_date.split('T')[0] : new Date().toISOString().split('T')[0],
    description: initialData?.description || "",
    cost: initialData?.cost || "",
    service_provider: initialData?.service_provider || "",
    mileage_at_service: initialData?.mileage_at_service || "",
    completed_date: initialData?.completed_date ? initialData.completed_date.split('T')[0] : "",
    remarks: initialData?.remarks || ""
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles"],
    queryFn: getVehicles,
    staleTime: 60_000,
  });

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEditing) {
        await updateMaintenanceRecord(initialData.maintenance_id, formData);
        toast.success("Maintenance updated successfully");
      } else {
        await createMaintenanceRecord(formData);
        toast.success("Maintenance scheduled successfully");
      }
      queryClient.invalidateQueries(["maintenance-records"]);
      queryClient.invalidateQueries(["predictive-maintenance"]);
      onClose();
    } catch (err) {
      toast.error(err.message || "Failed to save maintenance record");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEditing ? (formData.status === 'Completed' ? 'View/Edit Record' : 'Resolve Maintenance') : 'Schedule Maintenance'}</DialogTitle>
            <DialogDescription>
              {isEditing ? "Update details or complete this maintenance record." : "Create a new maintenance record for a vehicle."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Field label="Vehicle">
              <Select name="vehicle_id" value={formData.vehicle_id} onChange={handleChange} required disabled={isEditing}>
                <option value="">Select a vehicle...</option>
                {vehicles.map(v => (
                  <option key={v.vehicle_id} value={v.vehicle_id}>{v.plate_number} - {v.vehicle_name}</option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Type">
                <Select name="maintenance_type" value={formData.maintenance_type} onChange={handleChange} required>
                  <option value="Routine">Routine</option>
                  <option value="Corrective">Corrective</option>
                  <option value="Preventive">Preventive</option>
                  <option value="Emergency">Emergency</option>
                </Select>
              </Field>
              <Field label="Status">
                <Select name="status" value={formData.status} onChange={handleChange} required>
                  <option value="Scheduled">Scheduled</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </Select>
              </Field>
            </div>

            <Field label="Maintenance Date">
              <Input type="date" name="maintenance_date" value={formData.maintenance_date} onChange={handleChange} required />
            </Field>

            <Field label="Service Provider / Center">
              <Input type="text" name="service_provider" value={formData.service_provider} onChange={handleChange} placeholder="e.g. Toyota Alabang" />
            </Field>

            <Field label="Description">
              <Input type="text" name="description" value={formData.description} onChange={handleChange} placeholder="Brief description of service needed/done" />
            </Field>

            {formData.status === "Completed" && (
              <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-border">
                <Field label="Completed Date">
                  <Input type="date" name="completed_date" value={formData.completed_date} onChange={handleChange} required={formData.status === 'Completed'} />
                </Field>
                <Field label="Cost (₱)">
                  <Input type="number" step="0.01" min="0" name="cost" value={formData.cost} onChange={handleChange} placeholder="0.00" />
                </Field>
                <Field label="Mileage at Service (km)" className="col-span-2">
                  <Input type="number" step="1" min="0" name="mileage_at_service" value={formData.mileage_at_service} onChange={handleChange} placeholder="Odometer reading" />
                </Field>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Saving..." : "Save Record"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
