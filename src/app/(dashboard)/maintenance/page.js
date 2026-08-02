"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { getVehicleMaintenance, createVehicleMaintenance, updateVehicleMaintenance, getVehicles, archiveVehicleMaintenance } from "@/services/vehicle.service";
import { formatDate, formatCurrency } from "@/lib/utils";
import { toDateInput } from "@/lib/dates";
import { Pencil, Trash2, Eye, Wrench, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { maintenanceDateRule } from "@/lib/validation/helpers";

const maintenanceFormSchema = {
  vehicle_id: { required: true, label: "Vehicle" },
  maintenance_date: { required: true, type: "date", label: "Maintenance date", validate: maintenanceDateRule },
  completed_date: { type: "date", label: "Completed date" },
  cost: { type: "positiveNumber", label: "Cost" },
  mileage_at_service: { type: "positiveNumber", label: "Mileage at service" },
  description: { maxLength: 1000, label: "Description" },
  remarks: { maxLength: 1000, label: "Remarks" },
};

const columnHelper = createColumnHelper();

export default function MaintenancePage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);
  const [formError, setFormError] = useState(null);
  const [formData, setFormData] = useState({
    vehicle_id: "",
    maintenance_type: "Routine",
    description: "",
    maintenance_date: new Date().toISOString().split("T")[0],
    completed_date: "",
    cost: "",
    mileage_at_service: "",
    service_provider: "",
    service_center: "",
    priority: "Normal",
    status: "Scheduled",
    remarks: "",
  });
  const { validate, fieldError, registerField, resetValidation } = useFormValidation(maintenanceFormSchema);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["maintenance"],
    queryFn: () => getVehicleMaintenance(),
  });

  const { data: vehicles = [] } = useQuery({
    queryKey: ["vehicles-for-maintenance"],
    queryFn: () => getVehicles(),
  });

  const createMutation = useMutation({
    mutationFn: createVehicleMaintenance,
    onSuccess: () => {
      toast.success("Maintenance record created");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-for-maintenance"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateVehicleMaintenance(id, data),
    onSuccess: () => {
      toast.success("Maintenance record updated");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-for-maintenance"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: archiveVehicleMaintenance,
    onSuccess: () => {
      toast.success("Maintenance record archived");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["vehicle"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles-for-maintenance"] });
    },
    onError: (err) => toast.error(err.message),
  });

  const [archivingId, setArchivingId] = useState(null);

  function openNewDialog() {
    setEditingRecord(null);
    setViewingRecord(null);
    setFormData({
      vehicle_id: "",
      maintenance_type: "Routine",
      description: "",
      maintenance_date: new Date().toISOString().split("T")[0],
      completed_date: "",
      cost: "",
      mileage_at_service: "",
      service_provider: "",
      service_center: "",
      priority: "Normal",
      status: "Scheduled",
      remarks: "",
    });
    setFormError(null);
    resetValidation();
    setDialogOpen(true);
  }

  function openViewDialog(record) {
    setViewingRecord(record);
    setEditingRecord(null);
    resetValidation();
    setDialogOpen(true);
  }

  function openEditDialog(record) {
    setEditingRecord(record);
    setViewingRecord(null);
    setFormData({
      vehicle_id: String(record.vehicle_id || ""),
      maintenance_type: record.maintenance_type || "Routine",
      description: record.description || "",
      maintenance_date: toDateInput(record.maintenance_date, new Date().toISOString().split("T")[0]),
      completed_date: toDateInput(record.completed_date),
      cost: record.cost ?? "",
      mileage_at_service: record.mileage_at_service ?? "",
      service_provider: record.service_provider || "",
      service_center: record.service_center || "",
      priority: record.priority || "Normal",
      status: record.status || "Scheduled",
      remarks: record.remarks || "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingRecord(null);
    setViewingRecord(null);
    setFormError(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const isValid = validate(formData, {
      onSuccess: () => {
        const payload = {
          vehicle_id: Number(formData.vehicle_id),
          maintenance_type: formData.maintenance_type,
          description: formData.description || null,
          maintenance_date: formData.maintenance_date,
          completed_date: formData.completed_date || null,
          cost: formData.cost ? Number(formData.cost) : 0,
          mileage_at_service: formData.mileage_at_service ? Number(formData.mileage_at_service) : null,
          service_provider: formData.service_provider || null,
          service_center: formData.service_center || null,
          priority: formData.priority,
          status: formData.status,
          remarks: formData.remarks || null,
        };
        if (editingRecord) {
          updateMutation.mutate({ id: editingRecord.maintenance_id, data: payload });
        } else {
          createMutation.mutate(payload);
        }
      },
    });
    if (!isValid) return;
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const columns = useMemo(
    () => [
      columnHelper.accessor("maintenance_type", {
        header: "Type",
        cell: (info) => (
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-foreground-muted" />
            <span className="font-medium text-foreground">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor("vehicles.plate_number", {
        id: "vehicle",
        header: "Vehicle",
        cell: (info) => (
          <div>
            <p className="font-medium text-foreground">{info.getValue() || "—"}</p>
            <p className="text-xs text-foreground-muted">{info.row.original.vehicles?.vehicle_name}</p>
          </div>
        ),
      }),
      columnHelper.accessor("maintenance_date", {
        header: "Date",
        cell: (info) => (
          <span className="text-foreground-secondary">{formatDate(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("cost", {
        header: "Cost",
        cell: (info) => (
          <span className="font-medium text-foreground">{formatCurrency(info.getValue() || 0)}</span>
        ),
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: (info) => (
          <StatusBadge status={info.getValue()} entity="priority" />
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => (
          <StatusBadge status={info.getValue()} entity="maintenance" />
        ),
      }),
      columnHelper.accessor("service_provider", {
        header: "Provider",
        cell: (info) => (
          <span className="text-foreground-secondary">{info.getValue() || "—"}</span>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="View">
              <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => openViewDialog(info.row.original)}>
                <Eye className="w-4 h-4" />
              </Button>
            </Tooltip>
            <Tooltip content="Edit">
              <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => openEditDialog(info.row.original)}>
                <Pencil className="w-4 h-4" />
              </Button>
            </Tooltip>
            <Tooltip content="Archive">
              <Button variant="ghost" size="icon" className="w-8 h-8 text-danger" onClick={() => setArchivingId(info.row.original.maintenance_id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </Tooltip>
          </div>
        ),
      }),
    ],
    []
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations"
        title="Maintenance"
        description="Vehicle maintenance records and scheduling."
        actions={
          <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); setDialogOpen(open); }}>
            <Button className="h-10" onClick={openNewDialog}>
              <Wrench className="w-4 h-4 mr-2" />
              Add Record
            </Button>
            <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {viewingRecord ? "Maintenance Details" : editingRecord ? "Edit Maintenance Record" : "Add Maintenance Record"}
              </DialogTitle>
            </DialogHeader>
            {viewingRecord ? (
              <div className="p-6 pt-4 space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-foreground-muted text-xs">Vehicle</p>
                    <p className="font-medium">{viewingRecord.vehicles?.plate_number || "—"} ({viewingRecord.vehicles?.vehicle_name || "—"})</p>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs">Type</p>
                    <p className="font-medium">{viewingRecord.maintenance_type}</p>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs">Date</p>
                    <p className="font-medium">{formatDate(viewingRecord.maintenance_date)}</p>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs">Status</p>
                    <StatusBadge status={viewingRecord.status} entity="maintenance" />
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs">Priority</p>
                    <StatusBadge status={viewingRecord.priority} entity="priority" />
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs">Cost</p>
                    <p className="font-medium">{formatCurrency(viewingRecord.cost || 0)}</p>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs">Provider</p>
                    <p className="font-medium">{viewingRecord.service_provider || "—"}</p>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs">Service Center</p>
                    <p className="font-medium">{viewingRecord.service_center || "—"}</p>
                  </div>
                  {viewingRecord.completed_date && (
                    <div>
                      <p className="text-foreground-muted text-xs">Completed Date</p>
                      <p className="font-medium">{formatDate(viewingRecord.completed_date)}</p>
                    </div>
                  )}
                  {viewingRecord.mileage_at_service && (
                    <div>
                      <p className="text-foreground-muted text-xs">Mileage at Service</p>
                      <p className="font-medium">{viewingRecord.mileage_at_service.toLocaleString()} km</p>
                    </div>
                  )}
                </div>
                {viewingRecord.description && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-1">Description</p>
                    <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3">{viewingRecord.description}</p>
                  </div>
                )}
                {viewingRecord.remarks && (
                  <div>
                    <p className="text-foreground-muted text-xs mb-1">Remarks</p>
                    <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3">{viewingRecord.remarks}</p>
                  </div>
                )}
                <div className="flex items-center justify-end pt-2">
                  <Button variant="outline" onClick={closeDialog}>Close</Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-6 pt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="vehicle_id">Vehicle *</Label>
                    <Select value={formData.vehicle_id} onValueChange={(val) => setFormData({ ...formData, vehicle_id: val })}>
                      <SelectTrigger className={fieldError("vehicle_id").invalid ? "border-danger/70" : ""}><SelectValue placeholder="Select a vehicle" /></SelectTrigger>
                      <SelectContent>
                        {vehicles.filter((v) => !v.deleted_at).map((v) => (
                          <SelectItem key={v.vehicle_id} value={String(v.vehicle_id)}>
                            {v.plate_number} — {v.vehicle_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldError("vehicle_id").error && <p className="text-xs text-danger">{fieldError("vehicle_id").error}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="maintenance_type">Type</Label>
                    <Select value={formData.maintenance_type} onValueChange={(val) => setFormData({ ...formData, maintenance_type: val })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Routine">Routine</SelectItem>
                        <SelectItem value="Repair">Repair</SelectItem>
                        <SelectItem value="Inspection">Inspection</SelectItem>
                        <SelectItem value="Emergency">Emergency</SelectItem>
                        <SelectItem value="Scheduled">Scheduled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="maintenance_date">Date *</Label>
                    <Input id="maintenance_date" type="date" value={formData.maintenance_date} onChange={(e) => setFormData({ ...formData, maintenance_date: e.target.value })} ref={registerField("maintenance_date")} invalid={fieldError("maintenance_date").invalid} />
                    {fieldError("maintenance_date").error && <p className="text-xs text-danger">{fieldError("maintenance_date").error}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="priority">Priority</Label>
                    <Select value={formData.priority} onValueChange={(val) => setFormData({ ...formData, priority: val })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Low">Low</SelectItem>
                        <SelectItem value="Normal">Normal</SelectItem>
                        <SelectItem value="High">High</SelectItem>
                        <SelectItem value="Critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="status">Status</Label>
                    <Select value={formData.status} onValueChange={(val) => setFormData({ ...formData, status: val })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Scheduled">Scheduled</SelectItem>
                        <SelectItem value="In Progress">In Progress</SelectItem>
                        <SelectItem value="Completed">Completed</SelectItem>
                        <SelectItem value="Cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="completed_date">Completed Date</Label>
                    <Input id="completed_date" type="date" value={formData.completed_date} onChange={(e) => setFormData({ ...formData, completed_date: e.target.value })} ref={registerField("completed_date")} invalid={fieldError("completed_date").invalid} />
                    {fieldError("completed_date").error && <p className="text-xs text-danger">{fieldError("completed_date").error}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="cost">Cost (₱)</Label>
                    <Input id="cost" type="number" min="0" step="0.01" value={formData.cost} onChange={(e) => setFormData({ ...formData, cost: e.target.value })} ref={registerField("cost")} invalid={fieldError("cost").invalid} placeholder="0.00" />
                    {fieldError("cost").error && <p className="text-xs text-danger">{fieldError("cost").error}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mileage_at_service">Mileage at Service (km)</Label>
                    <Input id="mileage_at_service" type="number" min="0" value={formData.mileage_at_service} onChange={(e) => setFormData({ ...formData, mileage_at_service: e.target.value })} ref={registerField("mileage_at_service")} invalid={fieldError("mileage_at_service").invalid} placeholder="e.g. 10000" />
                    {fieldError("mileage_at_service").error && <p className="text-xs text-danger">{fieldError("mileage_at_service").error}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="service_provider">Service Provider</Label>
                    <Input id="service_provider" value={formData.service_provider} onChange={(e) => setFormData({ ...formData, service_provider: e.target.value })} placeholder="e.g. Toyota Cebu" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="service_center">Service Center</Label>
                    <Input id="service_center" value={formData.service_center} onChange={(e) => setFormData({ ...formData, service_center: e.target.value })} placeholder="e.g. Main Branch" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Describe the maintenance work" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="remarks">Remarks</Label>
                  <Input id="remarks" value={formData.remarks} onChange={(e) => setFormData({ ...formData, remarks: e.target.value })} placeholder="Additional notes" />
                </div>

                {formError && <p className="text-sm text-destructive">{formError}</p>}
                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Saving..." : editingRecord ? "Update Record" : "Create Record"}
                  </Button>
                </div>
              </form>
            )}
          </DialogContent>
          </Dialog>
        }
      />

      <StatGrid cols={4}>
        <StatCard icon={Clock} label="Scheduled" value={records.filter((r) => r.status === "Scheduled").length} tone="info" />
        <StatCard icon={Wrench} label="In Progress" value={records.filter((r) => r.status === "In Progress").length} tone="warning" />
        <StatCard icon={CheckCircle2} label="Completed" value={records.filter((r) => r.status === "Completed").length} tone="success" />
        <StatCard icon={Wrench} label="Total Cost" value={formatCurrency(records.reduce((s, r) => s + (r.cost || 0), 0))} tone="primary" />
      </StatGrid>

      <DataTable
        columns={columns}
        data={records}
        searchPlaceholder="Search maintenance records..."
      />

      <ConfirmDialog
        open={!!archivingId}
        onOpenChange={(open) => { if (!open) setArchivingId(null); }}
        title="Archive Record?"
        message="This maintenance record will be hidden from active lists."
        confirmLabel="Archive"
        variant="archive"
        onConfirm={() => { if (archivingId) archiveMutation.mutate(archivingId); }}
      />
    </div>
  );
}
