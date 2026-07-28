"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { getVehicleMaintenance, createVehicleMaintenance, updateVehicleMaintenance, getVehicles } from "@/services/vehicle.service";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Pencil, Archive, Eye, Wrench } from "lucide-react";

const statusVariant = {
  Scheduled: "default",
  "In Progress": "warning",
  Completed: "success",
  Cancelled: "danger",
};

const priorityVariant = {
  Normal: "secondary",
  High: "warning",
  Critical: "danger",
  Low: "default",
};

export default function MaintenancePage() {
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
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateVehicleMaintenance(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      closeDialog();
    },
    onError: (err) => setFormError(err.message),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id) => {
      const supabase = (await import("@/lib/supabase/client")).createClient();
      const { error } = await supabase
        .from("vehiclemaintenance")
        .update({ deleted_at: new Date().toISOString() })
        .eq("maintenance_id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["maintenance"] }),
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
    setDialogOpen(true);
  }

  function openViewDialog(record) {
    setViewingRecord(record);
    setEditingRecord(null);
    setDialogOpen(true);
  }

  function openEditDialog(record) {
    setEditingRecord(record);
    setViewingRecord(null);
    setFormData({
      vehicle_id: String(record.vehicle_id || ""),
      maintenance_type: record.maintenance_type || "Routine",
      description: record.description || "",
      maintenance_date: record.maintenance_date || new Date().toISOString().split("T")[0],
      completed_date: record.completed_date || "",
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
    if (!formData.vehicle_id) {
      setFormError("Vehicle is required");
      return;
    }
    if (!formData.maintenance_date) {
      setFormError("Maintenance date is required");
      return;
    }
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
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const columnHelper = createColumnHelper();

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
          <Badge variant={priorityVariant[info.getValue()] || "secondary"} className="text-xs">
            {info.getValue() || "Normal"}
          </Badge>
        ),
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => (
          <Badge variant={statusVariant[info.getValue()] || "default"}>
            {info.getValue()}
          </Badge>
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
                <Archive className="w-4 h-4" />
              </Button>
            </Tooltip>
          </div>
        ),
      }),
    ],
    [archiveMutation, setArchivingId]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Maintenance</h1>
          <p className="text-foreground-secondary mt-1">Vehicle maintenance records and scheduling</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); setDialogOpen(open); }}>
          <Button className="h-10" onClick={openNewDialog}>
            <Wrench className="w-4 h-4 mr-2" />
            Add Record
          </Button>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {viewingRecord ? "Maintenance Details" : editingRecord ? "Edit Maintenance Record" : "Add Maintenance Record"}
              </DialogTitle>
            </DialogHeader>
            {viewingRecord ? (
              <div className="space-y-4">
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
                    <Badge variant={statusVariant[viewingRecord.status] || "default"}>{viewingRecord.status}</Badge>
                  </div>
                  <div>
                    <p className="text-foreground-muted text-xs">Priority</p>
                    <Badge variant={priorityVariant[viewingRecord.priority] || "secondary"}>{viewingRecord.priority || "Normal"}</Badge>
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
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="vehicle_id">Vehicle *</Label>
                  <Select value={formData.vehicle_id} onValueChange={(val) => setFormData({ ...formData, vehicle_id: val })}>
                    <SelectTrigger><SelectValue placeholder="Select a vehicle" /></SelectTrigger>
                    <SelectContent>
                      {vehicles.filter((v) => !v.deleted_at).map((v) => (
                        <SelectItem key={v.vehicle_id} value={String(v.vehicle_id)}>
                          {v.plate_number} — {v.vehicle_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
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
                  <div>
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
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="maintenance_date">Maintenance Date *</Label>
                    <Input id="maintenance_date" type="date" value={formData.maintenance_date} onChange={(e) => setFormData({ ...formData, maintenance_date: e.target.value })} required />
                  </div>
                  <div>
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
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Describe the maintenance work" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="cost">Cost (₱)</Label>
                    <Input id="cost" type="number" min="0" step="0.01" value={formData.cost} onChange={(e) => setFormData({ ...formData, cost: e.target.value })} placeholder="0.00" />
                  </div>
                  <div>
                    <Label htmlFor="mileage_at_service">Mileage at Service (km)</Label>
                    <Input id="mileage_at_service" type="number" min="0" value={formData.mileage_at_service} onChange={(e) => setFormData({ ...formData, mileage_at_service: e.target.value })} placeholder="e.g. 10000" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="service_provider">Service Provider</Label>
                    <Input id="service_provider" value={formData.service_provider} onChange={(e) => setFormData({ ...formData, service_provider: e.target.value })} placeholder="e.g. Toyota Cebu" />
                  </div>
                  <div>
                    <Label htmlFor="service_center">Service Center</Label>
                    <Input id="service_center" value={formData.service_center} onChange={(e) => setFormData({ ...formData, service_center: e.target.value })} placeholder="e.g. Main Branch" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="completed_date">Completed Date</Label>
                  <Input id="completed_date" type="date" value={formData.completed_date} onChange={(e) => setFormData({ ...formData, completed_date: e.target.value })} />
                </div>
                <div>
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
      </div>

      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Scheduled", count: records.filter((r) => r.status === "Scheduled").length, color: "text-primary", bg: "bg-primary/10" },
          { label: "In Progress", count: records.filter((r) => r.status === "In Progress").length, color: "text-warning", bg: "bg-warning/10" },
          { label: "Completed", count: records.filter((r) => r.status === "Completed").length, color: "text-success", bg: "bg-success/10" },
          { label: "Total Cost", count: `₱${records.reduce((s, r) => s + (r.cost || 0), 0).toLocaleString()}`, color: "text-danger", bg: "bg-danger/10" },
        ].map((stat) => (
          <div key={stat.label} className="p-4 rounded-xl bg-surface border border-border">
            <p className="text-xs text-foreground-muted">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>{stat.count}</p>
          </div>
        ))}
      </div>

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
