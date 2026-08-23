"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/data-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FloatingField } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { getVehicleMaintenance, createVehicleMaintenance, updateVehicleMaintenance, getVehicles, archiveVehicleMaintenance } from "@/services/vehicle.service";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { toDateInput } from "@/lib/dates";
import { Pencil, Trash2, Eye, Wrench, Clock, CheckCircle2, TriangleAlert, PhilippinePeso, Calendar, Sparkles, ChevronRight, Activity, Tag, FileText } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { maintenanceDateRule } from "@/lib/validation/helpers";
import Link from "next/link";

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
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce the server-side search so every keystroke doesn't hit the API.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

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

  const {
    data = { rows: [], total: 0, counts: { total: 0, scheduled: 0, inProgress: 0, totalCost: 0 } },
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["maintenance", { page, search, sort }],
    queryFn: () =>
      getVehicleMaintenance({
        page,
        pageSize: 10,
        search: search || undefined,
        sort: sort[0]?.id,
        sortDir: sort[0]?.desc ? "desc" : "asc",
      }),
    placeholderData: keepPreviousData,
  });

  const records = data.rows || [];
  const total = data.total || 0;
  const stats = data.counts || { total: 0, scheduled: 0, inProgress: 0, totalCost: 0 };

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

  function openEditDialog(record) {
    setEditingRecord(record);
    setViewingRecord(null);
    setFormData({
      vehicle_id: record.vehicle_id || "",
      maintenance_type: record.maintenance_type || "Routine",
      description: record.description || "",
      maintenance_date: toDateInput(record.maintenance_date),
      completed_date: toDateInput(record.completed_date),
      cost: record.cost ? String(record.cost) : "",
      mileage_at_service: record.mileage_at_service ? String(record.mileage_at_service) : "",
      service_provider: record.service_provider || "",
      service_center: record.service_center || "",
      priority: record.priority || "Normal",
      status: record.status || "Scheduled",
      remarks: record.remarks || "",
    });
    setFormError(null);
    resetValidation();
    setDialogOpen(true);
  }

  function openViewDialog(record) {
    setViewingRecord(record);
    setEditingRecord(null);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setViewingRecord(null);
    setEditingRecord(null);
    setFormError(null);
  }

  function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    const submissionData = {
      ...formData,
      cost: formData.cost !== "" ? Number(formData.cost) : null,
      mileage_at_service: formData.mileage_at_service !== "" ? Number(formData.mileage_at_service) : null,
      completed_date: formData.completed_date !== "" ? formData.completed_date : null,
    };
    if (!validate(submissionData)) return;

    if (editingRecord) {
      updateMutation.mutate({ id: editingRecord.maintenance_id, data: submissionData });
    } else {
      createMutation.mutate(submissionData);
    }
  }

  const columns = useMemo(
    () => [
      columnHelper.accessor("vehicles.plate_number", {
        header: "Vehicle",
        cell: (info) => {
          const row = info.row.original;
          const plate = info.getValue();
          return (
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 text-foreground border border-border/40 shadow-2xs">
                <Wrench className="h-4.5 w-4.5" />
              </div>
              <div>
                <div className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-2.5 py-1 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
                  {plate || "—"}
                </div>
                <p className="text-xs text-foreground-muted font-medium mt-0.5">{row.vehicles?.vehicle_name || ""}</p>
              </div>
            </div>
          );
        },
      }),
      columnHelper.accessor("maintenance_type", {
        header: "Type",
        cell: (info) => <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-bold">{info.getValue()}</Badge>,
      }),
      columnHelper.accessor("maintenance_date", {
        header: "Scheduled Date",
        cell: (info) => <span className="font-data text-xs text-foreground font-bold">{formatDate(info.getValue())}</span>,
      }),
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => <StatusBadge status={info.getValue()} entity="maintenance" className="rounded-full px-3 py-1 text-xs font-bold" />,
      }),
      columnHelper.accessor("priority", {
        header: "Priority",
        cell: (info) => <StatusBadge status={info.getValue()} entity="priority" className="rounded-full px-3 py-1 text-xs font-bold" />,
      }),
      columnHelper.accessor("cost", {
        header: "Cost",
        cell: (info) => (
          <span className="font-data text-xs font-medium text-foreground">{formatCurrency(info.getValue() || 0)}</span>
        ),
      }),
      columnHelper.accessor("service_provider", {
        header: "Provider",
        cell: (info) => (
          <span className="text-xs text-foreground-secondary font-medium">{info.getValue() || "—"}</span>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (info) => (
          <div className="inline-flex items-center gap-0.5 rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="View Details">
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer" onClick={() => openViewDialog(info.row.original)}>
                <Eye className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Edit Record">
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer" onClick={() => openEditDialog(info.row.original)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
            <Tooltip content="Archive Record">
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-danger hover:bg-danger/10 hover:text-danger cursor-pointer" onClick={() => setArchivingId(info.row.original.maintenance_id)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
          </div>
        ),
      }),
    ],
    []
  );

  if (isError) {
    return (
      <div className="space-y-6 pb-12 w-full">
        <EmptyState
          icon={TriangleAlert}
          title="Could not load maintenance records"
          description={error?.message || "Something went wrong reading the maintenance register."}
          action={<Button onClick={() => refetch()} className="rounded-2xl text-xs font-bold mt-2">Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 w-full">
      {/* ── TOP HERO HEADER BAR ── */}
      <HeroHeader
        icon={Wrench}
        title="Fleet Maintenance Register"
        badge="Work Orders & Servicing"
        description="Vehicle maintenance history, scheduled servicing, repairs, and service center cost tracking."
        actions={
          <>
            <Link href="/maintenance/predictive">
              <Button variant="outline" size="sm" className={cn("rounded-2xl h-10 px-4 text-xs font-bold", heroButtonOutlineClass)}>
                <Sparkles className="w-4 h-4 mr-2 text-warning" /> AI Predictive Health
              </Button>
            </Link>
            <Button
              variant="default"
              size="sm"
              onClick={openNewDialog}
              className={cn("rounded-2xl h-10 px-5 text-xs font-bold shadow-xs cursor-pointer", heroButtonPrimaryClass)}
            >
              <Wrench className="w-4 h-4 mr-2" /> Add Maintenance Record
            </Button>
          </>
        }
      />

      {/* ── EXECUTIVE KPI CARDS ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Total Records</span>
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Wrench className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data">{stats.total}</div>
            <p className="text-[11px] text-primary font-medium mt-1">Logged service records</p>
          </div>
        </div>

        <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Scheduled Servicing</span>
            <div className="p-2 rounded-xl bg-info/10 text-info">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data">{stats.scheduled}</div>
            <p className="text-[11px] text-info font-medium mt-1">Pending maintenance dates</p>
          </div>
        </div>

        <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">In Progress</span>
            <div className="p-2 rounded-xl bg-warning/10 text-warning">
              <Activity className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-3xl font-medium text-foreground font-data">{stats.inProgress}</div>
            <p className="text-[11px] text-warning font-semibold mt-1">Currently in shop</p>
          </div>
        </div>

        <div className="p-4 rounded-3xl border border-border/80 bg-surface shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground-secondary uppercase tracking-wider">Total Expense</span>
            <div className="p-2 rounded-xl bg-success/10 text-success">
              <PhilippinePeso className="w-4 h-4" />
            </div>
          </div>
          <div>
            <div className="text-2xl font-medium text-foreground font-data">{formatCurrency(stats.totalCost)}</div>
            <p className="text-[11px] text-success font-semibold mt-1">Cumulative maintenance cost</p>
          </div>
        </div>
      </div>

      {/* ── MAINTENANCE TABLE ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardContent className="p-0">
          <DataTable
            data={records}
            columns={columns}
            isLoading={isLoading}
            pageSize={10}
            title="Maintenance Records Registry"
            description="Schedule, track, and audit vehicle repairs, preventive maintenance, and service costs."
            icon={Wrench}
            context="Maintenance"
            searchable
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            searchPlaceholder="Search maintenance by vehicle plate or provider..."
            onRowClick={openViewDialog}
            manualPagination
            pageIndex={page - 1}
            onPageChange={(idx) => setPage(idx + 1)}
            rowCount={total}
            onSortChange={(s) => { setSort(s); setPage(1); }}
          />
        </CardContent>
      </Card>

      {/* ── CREATE / EDIT / VIEW DIALOG ── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); setDialogOpen(open); }}>
        <DialogContent className="max-w-3xl rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-extrabold flex items-center gap-2 text-foreground">
              <Wrench className="w-5 h-5 text-primary" />
              {viewingRecord ? "Maintenance Record Details" : editingRecord ? "Edit Maintenance Record" : "Add Maintenance Record"}
            </DialogTitle>
          </DialogHeader>

          {viewingRecord ? (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4 text-xs bg-hover/40 p-4 rounded-3xl border border-border/60">
                <div>
                  <p className="text-foreground-muted font-bold">Vehicle</p>
                  <p className="font-extrabold text-foreground font-data mt-0.5">{viewingRecord.vehicles?.plate_number || "—"} ({viewingRecord.vehicles?.vehicle_name || "—"})</p>
                </div>
                <div>
                  <p className="text-foreground-muted font-bold">Maintenance Type</p>
                  <p className="font-extrabold text-foreground mt-0.5">{viewingRecord.maintenance_type}</p>
                </div>
                <div>
                  <p className="text-foreground-muted font-bold">Scheduled Date</p>
                  <p className="font-extrabold text-foreground font-data mt-0.5">{formatDate(viewingRecord.maintenance_date)}</p>
                </div>
                <div>
                  <p className="text-foreground-muted font-bold">Status</p>
                  <div className="mt-0.5"><StatusBadge status={viewingRecord.status} entity="maintenance" className="text-[11px] font-bold" /></div>
                </div>
                <div>
                  <p className="text-foreground-muted font-bold">Priority</p>
                  <div className="mt-0.5"><StatusBadge status={viewingRecord.priority} entity="priority" className="text-[11px] font-bold" /></div>
                </div>
                <div>
                  <p className="text-foreground-muted font-bold">Total Cost</p>
                  <p className="font-extrabold text-foreground font-data mt-0.5">{formatCurrency(viewingRecord.cost || 0)}</p>
                </div>
                <div>
                  <p className="text-foreground-muted font-bold">Service Provider</p>
                  <p className="font-bold text-foreground mt-0.5">{viewingRecord.service_provider || "—"}</p>
                </div>
                <div>
                  <p className="text-foreground-muted font-bold">Service Center</p>
                  <p className="font-bold text-foreground mt-0.5">{viewingRecord.service_center || "—"}</p>
                </div>
              </div>
              {viewingRecord.description && (
                <div className="p-4 rounded-2xl bg-surface border border-border/60 text-xs">
                  <p className="text-foreground-muted font-bold mb-1">Description &amp; Work Performed</p>
                  <p className="text-foreground font-medium">{viewingRecord.description}</p>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              {formError && (
                <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FloatingField label="Vehicle" icon={Wrench} required error={fieldError("vehicle_id").error}>
                  <select
                    id="vehicle_id"
                    value={formData.vehicle_id}
                    onChange={(e) => setFormData({ ...formData, vehicle_id: e.target.value })}
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
                  >
                    <option value="">Select vehicle</option>
                    {vehicles.map((v) => (
                      <option key={v.vehicle_id} value={v.vehicle_id}>
                        {v.plate_number} — {v.vehicle_name} ({v.model || "Standard"})
                      </option>
                    ))}
                  </select>
                </FloatingField>

                <FloatingField label="Maintenance Type" icon={Tag}>
                  <select
                    id="maintenance_type"
                    value={formData.maintenance_type}
                    onChange={(e) => setFormData({ ...formData, maintenance_type: e.target.value })}
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
                  >
                    <option value="Routine">Routine Service</option>
                    <option value="Repair">Repair</option>
                    <option value="Emergency">Emergency</option>
                    <option value="Inspection">Inspection</option>
                  </select>
                </FloatingField>

                <div>
                  <DatePicker
                    id="maintenance_date"
                    label="Scheduled Date"
                    value={formData.maintenance_date}
                    onChange={(val) => setFormData({ ...formData, maintenance_date: val })}
                  />
                  {fieldError("maintenance_date").error && (
                    <p className="text-xs text-danger font-semibold mt-1">{fieldError("maintenance_date").error}</p>
                  )}
                </div>

                <div>
                  <DatePicker
                    id="completed_date"
                    label="Completed Date (Optional)"
                    value={formData.completed_date}
                    onChange={(val) => setFormData({ ...formData, completed_date: val })}
                  />
                </div>

                <FloatingField label="Cost (₱)" icon={PhilippinePeso} error={fieldError("cost").error}>
                  <input
                    id="cost"
                    type="number"
                    step="0.01"
                    value={formData.cost}
                    onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data"
                  />
                </FloatingField>

                <FloatingField label="Mileage at Service (km)" icon={Activity} error={fieldError("mileage_at_service").error}>
                  <input
                    id="mileage_at_service"
                    type="number"
                    value={formData.mileage_at_service}
                    onChange={(e) => setFormData({ ...formData, mileage_at_service: e.target.value })}
                    placeholder="e.g. 45000"
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 font-data"
                  />
                </FloatingField>

                <FloatingField label="Service Provider" icon={Wrench}>
                  <input
                    id="service_provider"
                    value={formData.service_provider}
                    onChange={(e) => setFormData({ ...formData, service_provider: e.target.value })}
                    placeholder="e.g. Toyota Motors Service"
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1"
                  />
                </FloatingField>

                <FloatingField label="Service Center Location" icon={Wrench}>
                  <input
                    id="service_center"
                    value={formData.service_center}
                    onChange={(e) => setFormData({ ...formData, service_center: e.target.value })}
                    placeholder="e.g. Pasig Branch"
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1"
                  />
                </FloatingField>

                <FloatingField label="Priority Level" icon={Tag}>
                  <select
                    id="priority"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </FloatingField>

                <FloatingField label="Work Status" icon={Tag}>
                  <select
                    id="status"
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 cursor-pointer"
                  >
                    <option value="Scheduled">Scheduled</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Completed">Completed</option>
                    <option value="Cancelled">Cancelled</option>
                  </select>
                </FloatingField>

                <FloatingField label="Description &amp; Work Done" icon={FileText} className="md:col-span-2">
                  <textarea
                    id="description"
                    rows={2}
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe maintenance work performed..."
                    className="w-full bg-transparent text-xs font-semibold text-foreground focus:outline-hidden py-1 resize-none"
                  />
                </FloatingField>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-border/60">
                <Button type="button" variant="outline" onClick={closeDialog} className="rounded-xl text-xs">
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="rounded-xl px-5 text-xs font-bold shadow-xs cursor-pointer"
                >
                  {editingRecord ? "Update Record" : "Create Record"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ARCHIVE CONFIRM DIALOG */}
      <ConfirmDialog
        open={!!archivingId}
        onOpenChange={(open) => { if (!open) setArchivingId(null); }}
        title="Archive Maintenance Record"
        message="Are you sure you want to archive this maintenance record? This action can be audited."
        confirmLabel="Archive"
        variant="archive"
        loading={archiveMutation.isPending}
        onConfirm={() => {
          if (archivingId) {
            archiveMutation.mutate(archivingId, {
              onSuccess: () => setArchivingId(null),
            });
          }
        }}
      />
    </div>
  );
}
