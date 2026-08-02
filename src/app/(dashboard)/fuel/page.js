"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/tables/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { getFuelRecords, updateFuelRecord, updateFuelStatus, deleteFuelRecord } from "@/services/fuel.service";
import { formatDate, formatCurrency } from "@/lib/utils";
import {
  Fuel,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Pencil,
  Archive,
  ZoomIn,
  Loader2,
  FileText,
  AlertTriangle,
  MapPin,
  User,
  Truck,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import { toast } from "@/components/ui/toast";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { LIMITS } from "@/lib/validation";

const rejectSchema = {
  rejection_reason: { required: true, maxLength: 500, label: "Rejection reason" },
};

const editFuelSchema = {
  station_name: { required: true, maxLength: 255, label: "Gas station name" },
  liters: { required: true, type: "positiveNumber", min: LIMITS.FUEL_MIN, label: "Liters" },
  amount: { required: true, type: "positiveNumber", min: LIMITS.FUEL_MIN, label: "Total amount" },
  price_per_liter: { type: "positiveNumber", label: "Unit price" },
  odometer: { type: "positiveNumber", label: "Odometer" },
  fuel_date: { required: true, type: "date", label: "Refuel date" },
};

export default function FuelPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("Pending"); // 'Pending' | 'Approved' | 'Rejected' | 'all'
  const [search, setSearch] = useState("");

  // Modals state
  const [inspectRecord, setInspectRecord] = useState(null);
  const [zoomReceiptUrl, setZoomReceiptUrl] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [archivingRecord, setArchivingRecord] = useState(null);

  // Reject Prompt State
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [targetRejectRecord, setTargetRejectRecord] = useState(null);
  const { validate: validateReject, fieldError: rejectFieldError, registerField: registerRejectField, resetValidation: resetRejectValidation } = useFormValidation(rejectSchema);

  // Edit dialog state
  const [editForm, setEditForm] = useState({});
  const { validate: validateEdit, fieldError: editFieldError, registerField: registerEditField } = useFormValidation(editFuelSchema);

  // Fetch fuel records
  const { data: records = [], isLoading } = useQuery({
    queryKey: ["fuel-records"],
    queryFn: () => getFuelRecords(),
  });

  // Filter records based on tab & search
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      const currentStatus = (r.status || "Pending").toLowerCase();
      if (activeTab === "Pending" && currentStatus !== "pending") return false;
      if (activeTab === "Approved" && currentStatus !== "approved" && currentStatus !== "completed") return false;
      if (activeTab === "Rejected" && currentStatus !== "rejected") return false;
      return true;
    });
  }, [records, activeTab]);

  // Mutations
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, rejection_reason }) => updateFuelStatus(id, { status, rejection_reason }),
    onSuccess: (_, variables) => {
      toast.success(`Fuel record ${variables.status.toLowerCase()} successfully`);
      queryClient.invalidateQueries({ queryKey: ["fuel-records"] });
      setInspectRecord(null);
      setRejectDialogOpen(false);
      setRejectionReason("");
    },
    onError: (err) => toast.error(err.message || "Failed to update status"),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }) => updateFuelRecord(id, data),
    onSuccess: () => {
      toast.success("Fuel record updated successfully");
      queryClient.invalidateQueries({ queryKey: ["fuel-records"] });
      setEditRecord(null);
    },
    onError: (err) => toast.error(err.message || "Failed to update fuel record"),
  });

  const archiveMutation = useMutation({
    mutationFn: (id) => deleteFuelRecord(id),
    onSuccess: () => {
      toast.success("Fuel record archived successfully");
      queryClient.invalidateQueries({ queryKey: ["fuel-records"] });
      setArchivingRecord(null);
    },
    onError: (err) => toast.error(err.message || "Failed to archive record"),
  });

  // Stats calculation
  const pendingCount = records.filter((r) => (r.status || "Pending").toLowerCase() === "pending").length;
  const approvedCount = records.filter((r) => ["approved", "completed"].includes((r.status || "").toLowerCase())).length;
  const rejectedCount = records.filter((r) => (r.status || "").toLowerCase() === "rejected").length;
  const totalCost = records
    .filter((r) => ["approved", "completed"].includes((r.status || "").toLowerCase()))
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const columns = [
    {
      key: "fuel_date",
      label: "Refuel Date",
      sortable: true,
      render: (val) => (val ? formatDate(val) : "—"),
    },
    {
      key: "vehicle_info",
      label: "Vehicle",
      render: (_, row) => (
        <div>
          <p className="font-semibold text-foreground font-data">{row.vehicles?.plate_number || "N/A"}</p>
          <p className="text-xs text-foreground-secondary">{row.vehicles?.vehicle_name || "—"}</p>
        </div>
      ),
    },
    {
      key: "driver_info",
      label: "Driver",
      render: (_, row) => {
        const emp = row.drivers?.employees;
        return emp ? `${emp.first_name} ${emp.last_name}` : "—";
      },
    },
    {
      key: "station_name",
      label: "Gas Station",
      render: (val) => val || "Station Scan",
    },
    { key: "fuel_type", label: "Fuel Type" },
    {
      key: "liters",
      label: "Liters",
      render: (val) => (val ? `${val} L` : "—"),
    },
    {
      key: "amount",
      label: "Total Amount",
      sortable: true,
      render: (val) => (val ? formatCurrency(val) : "—"),
    },
    {
      key: "status",
      label: "Verification Status",
      render: (val) => {
        const st = (val || "Pending").toLowerCase();
        if (st === "approved" || st === "completed") {
          return <Badge variant="success" className="text-[11px]">Approved</Badge>;
        }
        if (st === "rejected") {
          return <Badge variant="danger" className="text-[11px]">Rejected</Badge>;
        }
        return <Badge variant="warning" className="text-[11px]">Pending Review</Badge>;
      },
    },
    {
      key: "actions",
      label: "Actions",
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <Tooltip content="Inspect Receipt">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs flex items-center gap-1 border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => setInspectRecord(row)}
            >
              <Eye className="w-3.5 h-3.5" /> Inspect
            </Button>
          </Tooltip>

          <Tooltip content="Edit Details">
            <Button variant="ghost" size="icon" className="w-8 h-8 text-foreground-secondary" onClick={() => {
              setEditRecord(row);
              setEditForm({
                station_name: row.station_name || "",
                liters: row.liters != null ? String(row.liters) : "",
                amount: row.amount != null ? String(row.amount) : "",
                price_per_liter: row.price_per_liter != null ? String(row.price_per_liter) : "",
                odometer: row.odometer != null ? String(row.odometer) : "",
                fuel_date: row.fuel_date ? row.fuel_date.substring(0, 10) : "",
              });
            }}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>

          <Tooltip content="Archive">
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 text-warning hover:text-warning hover:bg-warning/10"
              onClick={() => setArchivingRecord(row)}
            >
              <Archive className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  const handleApprove = (rec) => {
    updateStatusMutation.mutate({ id: rec.fuel_record_id, status: "Approved" });
  };

  const openRejectPrompt = (rec) => {
    setTargetRejectRecord(rec);
    setRejectionReason("");
    resetRejectValidation();
    setRejectDialogOpen(true);
  };

  const handleRejectConfirm = () => {
    if (!targetRejectRecord) return;
    const isValid = validateReject(
      { rejection_reason: rejectionReason },
      {
        onSuccess: () => {
          updateStatusMutation.mutate({
            id: targetRejectRecord.fuel_record_id,
            status: "Rejected",
            rejection_reason: rejectionReason.trim(),
          });
        },
      }
    );
    if (!isValid) return;
  };

  const handleEditSubmit = (e) => {
    e.preventDefault();
    if (!editRecord) return;
    const data = {
      station_name: editForm.station_name,
      liters: editForm.liters,
      amount: editForm.amount,
      price_per_liter: editForm.price_per_liter || null,
      odometer: editForm.odometer || null,
      fuel_date: editForm.fuel_date,
    };
    const isValid = validateEdit(data, {
      onSuccess: () => {
        editMutation.mutate({
          id: editRecord.fuel_record_id,
          data: {
            station_name: data.station_name,
            liters: Number(data.liters),
            amount: Number(data.amount),
            price_per_liter: data.price_per_liter ? Number(data.price_per_liter) : null,
            odometer: data.odometer ? Number(data.odometer) : null,
            fuel_date: data.fuel_date,
          },
        });
      },
    });
    if (!isValid) return;
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <PageHeader
        eyebrow="Operations"
        title="Fuel Receipt Audit & Review"
        description="Verify scanned driver fuel receipts and approve or reject claims for hotel fleet operations."
        actions={
          <Button
            variant="outline"
            className="h-10"
            onClick={() =>
              exportToCSV(records, "fuel-receipt-claims", [
                { label: "Refuel Date", key: "fuel_date" },
                { label: "Vehicle Plate", accessor: (r) => r.vehicles?.plate_number || "" },
                { label: "Driver", accessor: (r) => (r.drivers?.employees ? `${r.drivers.employees.first_name} ${r.drivers.employees.last_name}` : "") },
                { label: "Station", key: "station_name" },
                { label: "Fuel Type", key: "fuel_type" },
                { label: "Liters", key: "liters" },
                { label: "Total Amount", key: "amount" },
                { label: "Status", key: "status" },
              ])
            }
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      {/* ── Metric Cards ── */}
      <StatGrid cols={4}>
        <StatCard icon={Fuel} label="Total Submissions" value={records.length} tone="primary" />
        <StatCard icon={Clock} label="Pending Audit" value={pendingCount} tone="warning" />
        <StatCard icon={CheckCircle2} label="Approved Expense" value={formatCurrency(totalCost)} tone="success" />
        <StatCard icon={XCircle} label="Flagged / Rejected" value={rejectedCount} tone="danger" />
      </StatGrid>

      {/* ── Status Filter Tabs & Table ── */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            <Button
              variant={activeTab === "Pending" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={() => setActiveTab("Pending")}
            >
              <Clock className="w-3.5 h-3.5 mr-1.5" /> Pending Review ({pendingCount})
            </Button>

            <Button
              variant={activeTab === "Approved" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={() => setActiveTab("Approved")}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-success" /> Approved ({approvedCount})
            </Button>

            <Button
              variant={activeTab === "Rejected" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={() => setActiveTab("Rejected")}
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5 text-danger" /> Rejected ({rejectedCount})
            </Button>

            <Button
              variant={activeTab === "all" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs font-medium"
              onClick={() => setActiveTab("all")}
            >
              All Records ({records.length})
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={filteredRecords}
            isLoading={isLoading}
            searchable
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search driver, plate #, station..."
          />
        </CardContent>
      </Card>

      {/* ── SIDE-BY-SIDE RECEIPT INSPECTION & VERIFICATION MODAL ── */}
      <Dialog open={!!inspectRecord} onOpenChange={() => setInspectRecord(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Receipt Verification — Claim #{inspectRecord?.fuel_record_id}
            </DialogTitle>
          </DialogHeader>

          {inspectRecord && (
            <div className="space-y-6 pt-2">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* LEFT: Receipt Image Scan Box (5 Columns) */}
                <div className="lg:col-span-5 space-y-3">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                    Scanned Fuel Receipt Scan
                  </span>

                  {inspectRecord.receipt_url ? (
                    <div className="rounded-xl overflow-hidden border border-border bg-black/5 relative group aspect-[3/4] flex items-center justify-center">
                      <img
                        src={inspectRecord.receipt_url}
                        alt="Fuel Receipt Scan"
                        className="w-full h-full object-contain p-2"
                      />
                      <div
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-medium gap-1.5 cursor-pointer"
                        onClick={() => setZoomReceiptUrl(inspectRecord.receipt_url)}
                      >
                        <ZoomIn className="w-4 h-4" /> Full Screen Scan Zoom
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-dashed border-border p-8 text-center bg-muted/20 aspect-[3/4] flex flex-col items-center justify-center text-foreground-muted">
                      <FileText className="w-8 h-8 mb-2 opacity-50" />
                      <p className="text-xs font-medium">No receipt scan photo attached</p>
                    </div>
                  )}
                </div>

                {/* RIGHT: Driver Submission Details (7 Columns) */}
                <div className="lg:col-span-7 space-y-4">
                  <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                    Driver Claim Details
                  </span>

                  <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-foreground-muted flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-primary" /> Driver Name:
                        </span>
                        <p className="font-semibold text-foreground text-sm mt-0.5">
                          {inspectRecord.drivers?.employees
                            ? `${inspectRecord.drivers.employees.first_name} ${inspectRecord.drivers.employees.last_name}`
                            : "—"}
                        </p>
                      </div>

                      <div>
                        <span className="text-foreground-muted flex items-center gap-1">
                          <Truck className="w-3.5 h-3.5 text-primary" /> Vehicle Plate:
                        </span>
                        <p className="font-semibold text-foreground text-sm font-mono mt-0.5">
                          {inspectRecord.vehicles?.plate_number || "—"} ({inspectRecord.vehicles?.vehicle_name})
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs pt-2 border-t border-border">
                      <div>
                        <span className="text-foreground-muted flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-primary" /> Gas Station:
                        </span>
                        <p className="font-medium text-foreground mt-0.5">{inspectRecord.station_name || "—"}</p>
                      </div>

                      <div>
                        <span className="text-foreground-muted">Refuel Date:</span>
                        <p className="font-medium text-foreground mt-0.5">
                          {inspectRecord.fuel_date ? formatDate(inspectRecord.fuel_date) : "—"}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border text-center">
                      <div className="p-2 rounded-lg bg-surface border border-border">
                        <span className="text-[11px] text-foreground-muted block">Liters (L)</span>
                        <span className="text-sm font-bold text-foreground">{inspectRecord.liters || 0} L</span>
                      </div>
                      <div className="p-2 rounded-lg bg-surface border border-border">
                        <span className="text-[11px] text-foreground-muted block">Price / Liter</span>
                        <span className="text-sm font-bold text-foreground">
                          {inspectRecord.price_per_liter ? formatCurrency(inspectRecord.price_per_liter) : "—"}
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-surface border border-border">
                        <span className="text-[11px] text-foreground-muted block">Total Claim</span>
                        <span className="text-sm font-bold text-success">{formatCurrency(inspectRecord.amount)}</span>
                      </div>
                    </div>

                    {inspectRecord.rejection_reason && (
                      <div className="p-3 rounded-lg bg-danger/10 border border-danger/20 text-xs text-danger space-y-1">
                        <span className="font-semibold flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" /> Rejection Note:
                        </span>
                        <p>{inspectRecord.rejection_reason}</p>
                      </div>
                    )}
                  </div>

                  {/* Verification Decision Buttons */}
                  <div className="p-4 rounded-xl border border-border bg-surface space-y-3">
                    <span className="text-xs font-semibold text-foreground block">Verification Decision</span>
                    <div className="flex items-center gap-3">
                      <Button
                        className="flex-1 bg-success hover:bg-success/90 text-white h-10 text-xs font-semibold"
                        onClick={() => handleApprove(inspectRecord)}
                        disabled={updateStatusMutation.isPending}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-1.5" /> Approve Receipt Claim
                      </Button>

                      <Button
                        variant="destructive"
                        className="flex-1 h-10 text-xs font-semibold"
                        onClick={() => openRejectPrompt(inspectRecord)}
                        disabled={updateStatusMutation.isPending}
                      >
                        <XCircle className="w-4 h-4 mr-1.5" /> Reject Claim
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── REJECTION REASON PROMPT DIALOG ── */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-danger">
              <AlertTriangle className="w-5 h-5" /> Reject Fuel Receipt Claim
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <p className="text-xs text-foreground-secondary">
              Please enter a reason for rejecting this driver refuel claim (e.g. <i>"Unreadable image scan"</i>, <i>"Amount mismatch on receipt"</i>).
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="rejection_reason">Rejection Note / Reason *</Label>
              <Input
                id="rejection_reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                ref={registerRejectField("rejection_reason")}
                invalid={rejectFieldError("rejection_reason").invalid}
                placeholder="e.g. Receipt amount does not match total claimed"
              />
              {rejectFieldError("rejection_reason").error && (
                <p className="text-xs text-danger">{rejectFieldError("rejection_reason").error}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={handleRejectConfirm} disabled={updateStatusMutation.isPending}>
                {updateStatusMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                Confirm Rejection
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── EDIT FUEL LOG DIALOG ── */}
      <Dialog
        open={!!editRecord}
        onOpenChange={(open) => {
          if (!open) setEditRecord(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Edit Fuel Log Details</DialogTitle>
          </DialogHeader>

          {editRecord && (
            <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="station_name">Gas Station Name</Label>
                <Input
                  id="station_name"
                  defaultValue={editRecord.station_name || ""}
                  onChange={(e) => setEditForm({ ...editForm, station_name: e.target.value })}
                  ref={registerEditField("station_name")}
                  invalid={editFieldError("station_name").invalid}
                  placeholder="Petron, Shell, Caltex..."
                />
                {editFieldError("station_name").error && <p className="text-xs text-danger">{editFieldError("station_name").error}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="liters">Liters (L) *</Label>
                  <Input
                    id="liters"
                    type="number"
                    step="0.01"
                    defaultValue={editRecord.liters || ""}
                    onChange={(e) => setEditForm({ ...editForm, liters: e.target.value })}
                    ref={registerEditField("liters")}
                    invalid={editFieldError("liters").invalid}
                  />
                  {editFieldError("liters").error && <p className="text-xs text-danger">{editFieldError("liters").error}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="amount">Total Amount (₱) *</Label>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    defaultValue={editRecord.amount || ""}
                    onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                    ref={registerEditField("amount")}
                    invalid={editFieldError("amount").invalid}
                  />
                  {editFieldError("amount").error && <p className="text-xs text-danger">{editFieldError("amount").error}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="price_per_liter">Unit Price (₱/L)</Label>
                  <Input
                    id="price_per_liter"
                    type="number"
                    step="0.01"
                    defaultValue={editRecord.price_per_liter || ""}
                    onChange={(e) => setEditForm({ ...editForm, price_per_liter: e.target.value })}
                    ref={registerEditField("price_per_liter")}
                    invalid={editFieldError("price_per_liter").invalid}
                  />
                  {editFieldError("price_per_liter").error && <p className="text-xs text-danger">{editFieldError("price_per_liter").error}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="odometer">Odometer (km)</Label>
                  <Input
                    id="odometer"
                    type="number"
                    defaultValue={editRecord.odometer || ""}
                    onChange={(e) => setEditForm({ ...editForm, odometer: e.target.value })}
                    ref={registerEditField("odometer")}
                    invalid={editFieldError("odometer").invalid}
                  />
                  {editFieldError("odometer").error && <p className="text-xs text-danger">{editFieldError("odometer").error}</p>}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="fuel_date">Refuel Date *</Label>
                <Input
                  id="fuel_date"
                  type="date"
                  defaultValue={editRecord.fuel_date ? editRecord.fuel_date.substring(0, 10) : ""}
                  onChange={(e) => setEditForm({ ...editForm, fuel_date: e.target.value })}
                  ref={registerEditField("fuel_date")}
                  invalid={editFieldError("fuel_date").invalid}
                />
                {editFieldError("fuel_date").error && <p className="text-xs text-danger">{editFieldError("fuel_date").error}</p>}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setEditRecord(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={editMutation.isPending}>
                  {editMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                  Update Fuel Record
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── RECEIPT FULL ZOOM MODAL ── */}
      <Dialog open={!!zoomReceiptUrl} onOpenChange={() => setZoomReceiptUrl(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Full Resolution Scanned Receipt
            </DialogTitle>
          </DialogHeader>
          <div className="p-2 flex items-center justify-center max-h-[75vh] overflow-auto bg-black/5 rounded-xl border border-border">
            {zoomReceiptUrl && (
              <img
                src={zoomReceiptUrl}
                alt="Fuel Receipt Full Zoom"
                className="max-h-[70vh] w-auto object-contain rounded-lg shadow-md"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── ARCHIVE CONFIRMATION DIALOG ── */}
      <ConfirmDialog
        open={!!archivingRecord}
        onOpenChange={(open) => { if (!open) setArchivingRecord(null); }}
        title={`Archive Fuel Record #${archivingRecord?.fuel_record_id}?`}
        message="This record will be archived and hidden from active fleet reports."
        confirmLabel="Archive Record"
        variant="archive"
        onConfirm={() => { if (archivingRecord) archiveMutation.mutate(archivingRecord.fuel_record_id); }}
      />
    </div>
  );
}
