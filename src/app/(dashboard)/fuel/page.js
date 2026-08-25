"use client";

import { useState, useEffect } from "react";
import { useQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/tables/data-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  getFuelRecords,
  getFuelAllocations,
  getFuelRequests,
  reviewFuelRequest,
  saveFuelAllocation,
  updateFuelRecord,
  updateFuelStatus,
  deleteFuelRecord,
} from "@/services/fuel.service";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
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
  ClipboardList,
  Gauge,
  Settings2,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import { toast, ToastAction } from "@/components/ui/toast";
import { DatePicker } from "@/components/ui/date-picker";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { LIMITS } from "@/lib/validation";
import { fuelTypeMismatch } from "@/lib/fuel/request-policy";

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

function requestReviewFacts(request) {
  const snap = request?.calculation_snapshot || {};
  const current = Number(request?.current_fuel_level_percent);
  const tank = Number(request?.tank_capacity_l);
  const minSafe = snap.minimum_safe_liters != null
    ? Number(snap.minimum_safe_liters)
    : [snap.forecast_consumption_liters, snap.reserve_liters, snap.current_liters].every((v) => v != null)
      ? Math.max(0, Number(snap.forecast_consumption_liters) + Number(snap.reserve_liters) - Number(snap.current_liters))
      : null;
  return {
    minSafe,
    target: request?.recommended_liters || request?.requested_liters,
    tankSpace: Number.isFinite(current) && Number.isFinite(tank) ? tank * (1 - current / 100) : null,
    remaining: snap.monthly_remaining_liters ?? null,
    variance: snap.fuel_variance || null,
  };
}

export default function FuelPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("Pending"); // 'Pending' | 'Approved' | 'Rejected' | 'all'
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState([]);

  // Debounce the server-side search so every keystroke doesn't hit the API.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Modals state
  const [inspectRecord, setInspectRecord] = useState(null);
  const [zoomReceiptUrl, setZoomReceiptUrl] = useState(null);
  const [editRecord, setEditRecord] = useState(null);
  const [archivingRecord, setArchivingRecord] = useState(null);
  const [approvingRecord, setApprovingRecord] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [reviewRequest, setReviewRequest] = useState(null);
  const [approvedLiters, setApprovedLiters] = useState("");
  const [requestNotes, setRequestNotes] = useState("");
  const [configureAllocation, setConfigureAllocation] = useState(null);
  const [allocationForm, setAllocationForm] = useState({ allocated_liters: "", tank_capacity_l: "", fuel_efficiency_kmpl: "" });

  // Reject Prompt State
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [targetRejectRecord, setTargetRejectRecord] = useState(null);
  const { validate: validateReject, fieldError: rejectFieldError, registerField: registerRejectField, resetValidation: resetRejectValidation } = useFormValidation(rejectSchema);

  // Edit dialog state
  const [editForm, setEditForm] = useState({});
  const { validate: validateEdit, fieldError: editFieldError, registerField: registerEditField } = useFormValidation(editFuelSchema);

  // The status tab maps to a server-side `status` param. "all" = no filter.
  const statusParam = activeTab === "all" ? undefined : activeTab;

  // Fetch a page of fuel records. Filtering/sorting/pagination now happen on the
  // server; the API returns `{ rows, total, counts }` for the table + stat cards.
  const {
    data = { rows: [], total: 0, counts: { total: 0, pending: 0, approved: 0, rejected: 0, approvedCost: 0 } },
    isLoading,
  } = useQuery({
    queryKey: ["fuel-records", { page, activeTab, search, sort }],
    queryFn: () =>
      getFuelRecords({
        page,
        pageSize: 10,
        status: statusParam,
        search: search || undefined,
        sort: sort[0]?.id,
        sortDir: sort[0]?.desc ? "desc" : "asc",
      }),
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });

  const records = data.rows || [];
  const total = data.total || 0;
  const counts = data.counts || { total: 0, pending: 0, approved: 0, rejected: 0, approvedCost: 0 };

  const { data: requestData = { rows: [], counts: {} }, isLoading: requestsLoading } = useQuery({
    queryKey: ["fuel-requests"],
    queryFn: () => getFuelRequests(),
    refetchInterval: 30_000,
  });
  const fuelRequests = requestData.rows || [];

  const { data: allocationData = { rows: [] }, isLoading: allocationsLoading } = useQuery({
    queryKey: ["fuel-allocations"],
    queryFn: () => getFuelAllocations(),
    refetchInterval: 30_000,
  });
  const fuelAllocations = allocationData.rows || [];

  // Export needs the whole (filtered) set, not just the current page.
  const handleExport = async () => {
    setExporting(true);
    try {
      const all = await getFuelRecords({
        status: statusParam,
        search: search || undefined,
      });
      exportToCSV(all || [], "fuel-receipt-claims", [
        { label: "Refuel Date", key: "fuel_date" },
        { label: "Vehicle Plate", accessor: (r) => r.vehicles?.plate_number || "" },
        { label: "Driver", accessor: (r) => (r.drivers?.employees ? `${r.drivers.employees.first_name} ${r.drivers.employees.last_name}` : "") },
        { label: "Station", key: "station_name" },
        { label: "Fuel Type", key: "fuel_type" },
        { label: "Liters", key: "liters" },
        { label: "Total Amount", key: "amount" },
        { label: "Status", key: "status" },
      ]);
      toast.success(`Exported ${(all || []).length} records`);
    } catch {
      toast.error("Export failed — please try again");
    } finally {
      setExporting(false);
    }
  };

  // Mutations
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, rejection_reason }) => updateFuelStatus(id, { status, rejection_reason }),
    onSuccess: (_, variables) => {
      toast.success(`Fuel record ${variables.status.toLowerCase()} successfully`);
      queryClient.invalidateQueries({ queryKey: ["fuel-records"] });
      setInspectRecord(null);
      setApprovingRecord(null);
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

  const reviewRequestMutation = useMutation({
    mutationFn: reviewFuelRequest,
    onSuccess: (_, variables) => {
      toast.success(`Fuel request ${variables.status.toLowerCase()}`);
      queryClient.invalidateQueries({ queryKey: ["fuel-requests"] });
      setReviewRequest(null);
      setRequestNotes("");
    },
    onError: (error) => toast.error(error.message || "Could not review fuel request"),
  });

  const openRequestReview = (request) => {
    setReviewRequest(request);
    setApprovedLiters(String(request.recommended_liters || request.requested_liters));
    setRequestNotes("");
  };

  const submitRequestReview = (status) => {
    if (status === "Rejected" && !requestNotes.trim()) {
      toast.error("Enter a reason before rejecting the request");
      return;
    }
    const litersValue = Number(approvedLiters);
    if (status === "Approved" && (!Number.isFinite(litersValue) || litersValue <= 0)) {
      toast.error("Enter the approved liters");
      return;
    }
    if (status === "Approved") {
      const facts = requestReviewFacts(reviewRequest);
      const remaining = Number(facts.remaining);
      if (!requestNotes.trim() && facts.minSafe != null && litersValue < facts.minSafe) {
        toast.error(`At least ${facts.minSafe.toFixed(2)} L covers the forecast consumption plus reserve — add an override reason to approve less`);
        return;
      }
      if (!requestNotes.trim() && litersValue > Number(facts.target || 0)) {
        toast.error("Add a reason when approving above the recommendation");
        return;
      }
      if (!requestNotes.trim() && Number.isFinite(remaining) && litersValue > remaining) {
        toast.error(`This exceeds the monthly fuel budget by ${(litersValue - remaining).toFixed(2)} L — add an override reason to proceed`);
        return;
      }
    }
    reviewRequestMutation.mutate({
      fuel_request_id: reviewRequest.fuel_request_id,
      status,
      approved_liters: status === "Approved" ? litersValue : undefined,
      review_notes: requestNotes.trim() || undefined,
    });
  };

  const saveAllocationMutation = useMutation({
    mutationFn: saveFuelAllocation,
    onSuccess: () => {
      toast.success("Monthly fuel budget saved");
      queryClient.invalidateQueries({ queryKey: ["fuel-allocations"] });
      queryClient.invalidateQueries({ queryKey: ["fuel-requests"] });
      setConfigureAllocation(null);
    },
    onError: (error) => toast.error(error.message || "Could not save the monthly fuel budget"),
  });

  const openAllocationSetup = (row) => {
    setConfigureAllocation(row);
    setAllocationForm({
      allocated_liters: String(row.allocated_liters || ""),
      tank_capacity_l: String(row.tank_capacity_l || ""),
      fuel_efficiency_kmpl: String(row.fuel_efficiency_kmpl || ""),
    });
  };

  const submitAllocation = () => {
    const values = Object.fromEntries(Object.entries(allocationForm).map(([key, value]) => [key, Number(value)]));
    if (Object.values(values).some((value) => !Number.isFinite(value) || value <= 0)) {
      toast.error("Enter valid positive values for the monthly limit, tank capacity, and efficiency");
      return;
    }
    saveAllocationMutation.mutate({ vehicle_id: configureAllocation.vehicle_id, ...values });
  };

  // Stats come from the server-side counts (whole set, not the current page).
  const pendingCount = counts.pending;
  const approvedCount = counts.approved;
  const rejectedCount = counts.rejected;
  const totalCost = counts.approvedCost;

  const reviewFacts = reviewRequest ? requestReviewFacts(reviewRequest) : null;

  const columns = [
    {
      key: "fuel_date",
      label: "Refuel Date",
      sortable: true,
      render: (val) => (
        <span className="font-data font-bold text-xs text-foreground">
          {val ? formatDate(val) : "—"}
        </span>
      ),
    },
    {
      key: "vehicle_info",
      label: "Vehicle",
      render: (_, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 text-foreground border border-border/40 shadow-2xs">
            <Truck className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-2.5 py-1 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
              {row.vehicles?.plate_number || "N/A"}
            </div>
            <p className="text-xs text-foreground-muted font-medium mt-0.5">{row.vehicles?.vehicle_name || "—"}</p>
          </div>
        </div>
      ),
    },
    {
      key: "driver_info",
      label: "Driver",
      render: (_, row) => {
        const emp = row.drivers?.employees;
        const name = emp ? `${emp.first_name} ${emp.last_name}` : "—";
        const initials = emp ? `${emp.first_name?.[0] || ""}${emp.last_name?.[0] || ""}`.toUpperCase() : "DR";
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
              {initials}
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">{name}</p>
              <p className="text-xs text-foreground-muted font-medium">Refueling driver</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "station_name",
      label: "Gas Station",
      render: (val) => <span className="font-semibold text-xs text-foreground">{val || "Station Scan"}</span>,
    },
    {
      key: "fuel_type",
      label: "Fuel Type",
      render: (val) => <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-bold">{val || "Fuel"}</Badge>,
    },
    {
      key: "liters",
      label: "Liters",
      render: (val) => <span className="font-data font-bold text-xs text-foreground">{val ? `${val} L` : "—"}</span>,
    },
    {
      key: "amount",
      label: "Total Amount",
      sortable: true,
      render: (val) => <span className="font-data font-medium text-xs text-foreground">{val ? formatCurrency(val) : "—"}</span>,
    },
    {
      key: "status",
      label: "Status",
      render: (val) => (
        <StatusBadge status={val || "Pending"} entity="fuel" className="rounded-full px-3 py-1 text-xs font-bold" />
      ),
    },
    {
      key: "actions",
      label: "",
      render: (_, row) => {
        const isPending = (row.status || "Pending").toLowerCase() === "pending";
        return (
          <div className="inline-flex items-center gap-0.5 rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="Inspect Receipt">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
                onClick={() => setInspectRecord(row)}
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>

            {isPending && (
              <>
                <Tooltip content="Approve">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-full text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 cursor-pointer"
                    onClick={() => setApprovingRecord(row)}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </Button>
                </Tooltip>

                <Tooltip content="Reject">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-full text-red-600 hover:bg-red-500/10 hover:text-red-700 cursor-pointer"
                    onClick={() => openRejectPrompt(row)}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                  </Button>
                </Tooltip>
              </>
            )}
          </div>
        );
      },
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

  const TONE_MAP = {
    primary:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   icon: 'bg-slate-500/15 text-slate-500',   dot: 'bg-slate-500',   text: 'text-slate-600 dark:text-slate-400' },
    success:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'bg-emerald-500/15 text-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
    warning:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   icon: 'bg-amber-500/15 text-amber-500',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400' },
    danger:    { bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: 'bg-red-500/15 text-red-500',       dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400' },
    info:      { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    icon: 'bg-blue-500/15 text-blue-500',     dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400' },
    secondary: { bg: 'bg-zinc-500/10',    border: 'border-zinc-500/30',    icon: 'bg-zinc-500/15 text-zinc-500',     dot: 'bg-zinc-500',    text: 'text-zinc-600 dark:text-zinc-400' },
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header ── */}
      <HeroHeader
        icon={Fuel}
        title="Fuel Management"
        badge="Operations"
        description="Set monthly vehicle limits, approve forecasted replenishment, and verify the receipts that consume each budget."
        actions={
          <Button
            variant="outline"
            className={cn("h-10", heroButtonOutlineClass)}
            onClick={handleExport}
            disabled={exporting}
          >
            <Download className={cn("w-4 h-4 mr-2", exporting && "animate-pulse")} />
            Export CSV
          </Button>
        }
      />

      {/* ── Metric Cards ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-muted/20 flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4.5 w-4.5 text-primary" /> Monthly Vehicle Fuel Plan
            </CardTitle>
            <p className="mt-1 text-xs text-foreground-secondary">
              Configure each vehicle once per month; approved receipts consume the available liters.
            </p>
          </div>
          <Badge variant="secondary" className="rounded-full">
            {fuelAllocations.filter((row) => !row.allocation_id).length} unconfigured
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/10 text-[11px] uppercase tracking-wider text-foreground-muted">
                <tr>
                    <th className="px-5 py-3 font-bold">Vehicle</th>
                    <th className="px-5 py-3 font-bold">Fuel profile</th>
                    <th className="px-5 py-3 font-bold">Monthly budget</th>
                    <th className="px-5 py-3 font-bold">Used / committed</th>
                    <th className="px-5 py-3 font-bold">Utilization</th>
                  <th className="px-5 py-3 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {allocationsLoading ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-foreground-muted">Loading monthly allocations…</td></tr>
                ) : fuelAllocations.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-foreground-muted">No active vehicles found.</td></tr>
                ) : fuelAllocations.map((row) => (
                  <tr key={row.vehicle_id} className="bg-surface hover:bg-muted/20">
                    <td className="px-5 py-3">
                      <p className="font-data text-xs font-bold">{row.plate_number}</p>
                      <p className="text-xs text-foreground-muted">{row.vehicle_name}</p>
                    </td>
                    <td className="px-5 py-3 text-xs">
                      {row.tank_capacity_l && row.fuel_efficiency_kmpl
                        ? `${row.tank_capacity_l} L tank · ${row.fuel_efficiency_kmpl} km/L`
                        : <span className="text-warning">Profile required</span>}
                    </td>
                    <td className="px-5 py-3 font-data font-bold">{row.allocated_liters ? `${row.allocated_liters} L` : "—"}</td>
                    <td className="px-5 py-3 font-data text-xs">{Number(row.consumed_liters || 0).toFixed(1)} / {Number(row.committed_liters || 0).toFixed(1)} L</td>
                    <td className="px-5 py-3">
                      {row.allocated_liters ? (() => {
                        const alloc = Number(row.allocated_liters);
                        const used = Number(row.consumed_liters || 0) + Number(row.committed_liters || 0);
                        const pct = Math.round((used / alloc) * 100);
                        const over = pct > 100;
                        const fill = over ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success";
                        return (
                          <div className="w-28">
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className={cn("h-full rounded-full", fill)} style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                            <p className={cn("mt-1 text-[10px] font-bold", over ? "text-danger" : pct >= 80 ? "text-warning" : "text-foreground-muted")}>
                              {over ? "Budget exceeded" : pct >= 80 ? "Near budget limit" : `${pct}% used`}
                              {" · "}{Number(row.remaining_liters || 0).toFixed(1)} L left
                            </p>
                          </div>
                        );
                      })() : "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => openAllocationSetup(row)}>
                        <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="border-b border-border/60 bg-muted/20 flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-4.5 w-4.5 text-primary" /> Fuel Requests & Allocation History
            </CardTitle>
            <p className="mt-1 text-xs text-foreground-secondary">
              Recommendations cover the vehicle&apos;s next 24 hours and refill toward a safe operating level.
            </p>
          </div>
          <Badge variant="warning" className="rounded-full">
            {requestData.counts?.pending || 0} pending
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/10 text-[11px] uppercase tracking-wider text-foreground-muted">
                <tr>
                  <th className="px-5 py-3 font-bold">Driver / Source</th>
                  <th className="px-5 py-3 font-bold">Vehicle</th>
                  <th className="px-5 py-3 font-bold">Fuel / Forecast</th>
                  <th className="px-5 py-3 font-bold">Recommended</th>
                  <th className="px-5 py-3 font-bold">Authorized</th>
                  <th className="px-5 py-3 font-bold">Status</th>
                  <th className="px-5 py-3 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {requestsLoading ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-foreground-muted">Loading fuel requests…</td></tr>
                ) : fuelRequests.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-8 text-center text-foreground-muted">No fuel requests yet.</td></tr>
                ) : fuelRequests.map((request) => (
                  <tr key={request.fuel_request_id} className="bg-surface hover:bg-muted/20">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-foreground">{request.first_name} {request.last_name}</p>
                      <p className="text-xs text-foreground-muted">{request.trip_id ? `Trip #${request.trip_id}` : "Vehicle assignment"}</p>
                    </td>
                    <td className="px-5 py-3 font-data text-xs font-bold">{request.plate_number}</td>
                    <td className="px-5 py-3 text-xs">
                      <p className="font-data font-bold">{request.current_fuel_level_percent ?? "—"}% current</p>
                      <p className="text-foreground-muted">{request.forecast_distance_km ?? "—"} km / 24h</p>
                    </td>
                    <td className="px-5 py-3 font-data font-bold">{request.recommended_liters || request.requested_liters} L</td>
                    <td className="px-5 py-3 font-data">{request.approved_liters ? `${request.approved_liters} L` : "—"}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={request.status} entity="fuel" />
                      {request.status === "Approved" && request.calculation_snapshot?.auto_authorized ? (
                        <span className="ml-1.5 inline-flex items-center rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success">
                          Within policy
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {request.status === "Pending" ? (
                        <Button size="sm" onClick={() => openRequestReview(request)}>Review</Button>
                      ) : (
                        <span className="text-xs text-foreground-muted">Reviewed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(() => {
          const t = TONE_MAP.primary;
          const isActive = activeTab === "all";
          return (
            <button
              type="button"
              onClick={() => { setActiveTab("all"); setPage(1); }}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                isActive
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-primary/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Total Submissions</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><Fuel className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{counts.total}</div>
              </div>
            </button>
          );
        })()}

        {(() => {
          const t = TONE_MAP.warning;
          const isActive = activeTab === "Pending";
          return (
            <button
              type="button"
              onClick={() => { setActiveTab("Pending"); setPage(1); }}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                isActive
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-warning/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Pending Audit</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><Clock className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{pendingCount}</div>
              </div>
            </button>
          );
        })()}

        {(() => {
          const t = TONE_MAP.success;
          const isActive = activeTab === "Approved";
          return (
            <button
              type="button"
              onClick={() => { setActiveTab("Approved"); setPage(1); }}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                isActive
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-success/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Approved Expense</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><CheckCircle2 className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{formatCurrency(totalCost)}</div>
              </div>
            </button>
          );
        })()}

        {(() => {
          const t = TONE_MAP.danger;
          const isActive = activeTab === "Rejected";
          return (
            <button
              type="button"
              onClick={() => { setActiveTab("Rejected"); setPage(1); }}
              className={cn(
                "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
                isActive
                  ? cn(t.border, t.bg, "shadow-md")
                  : "border-border/60 bg-surface hover:shadow-sm hover:border-danger/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Rejected</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><XCircle className="w-4 h-4" /></div>
              </div>
              <div>
                <div className="text-3xl font-bold text-foreground font-data leading-none">{rejectedCount}</div>
              </div>
            </button>
          );
        })()}
      </div>

      {/* ── Status Filter Tabs & Table ── */}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              className={cn('px-4 h-8 flex items-center justify-center rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap', activeTab === "Pending" ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}
              onClick={() => { setActiveTab("Pending"); setPage(1); }}
            >
              <Clock className="w-3.5 h-3.5 mr-1.5" /> Pending Review ({pendingCount})
            </button>

            <button
              className={cn('px-4 h-8 flex items-center justify-center rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap', activeTab === "Approved" ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}
              onClick={() => { setActiveTab("Approved"); setPage(1); }}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approved ({approvedCount})
            </button>

            <button
              className={cn('px-4 h-8 flex items-center justify-center rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap', activeTab === "Rejected" ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}
              onClick={() => { setActiveTab("Rejected"); setPage(1); }}
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Rejected ({rejectedCount})
            </button>

            <button
              className={cn('px-4 h-8 flex items-center justify-center rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap', activeTab === "all" ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}
              onClick={() => { setActiveTab("all"); setPage(1); }}
            >
              All Records ({counts.total})
            </button>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={records}
            isLoading={isLoading}
            pageSize={10}
            title="Fuel Audit Registry"
            description="Verify scanned driver fuel receipts and approve or reject claims."
            icon={Fuel}
            context={activeTab === "all" ? "All Fuel Logs" : activeTab}
            searchable
            searchValue={searchInput}
            onSearchChange={setSearchInput}
            searchPlaceholder="Search driver, plate #, station..."
            manualPagination
            pageIndex={page - 1}
            onPageChange={(idx) => setPage(idx + 1)}
            rowCount={total}
            onSortChange={(s) => { setSort(s); setPage(1); }}
          />
        </CardContent>
      </Card>

      {/* ── SIDE-BY-SIDE RECEIPT INSPECTION & VERIFICATION MODAL ── */}
      <Dialog open={!!configureAllocation} onOpenChange={(open) => !open && setConfigureAllocation(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure {configureAllocation?.plate_number}</DialogTitle>
          </DialogHeader>
          {configureAllocation ? (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-foreground-secondary">
                These values drive every recommendation for this vehicle during the current month.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="monthly_allocation">Monthly fuel budget (L)</Label>
                <Input id="monthly_allocation" type="number" min="0.01" step="0.01" value={allocationForm.allocated_liters} onChange={(event) => setAllocationForm({ ...allocationForm, allocated_liters: event.target.value })} />
                <p className="text-xs text-foreground-muted">Already used or committed: {(Number(configureAllocation.consumed_liters || 0) + Number(configureAllocation.committed_liters || 0)).toFixed(1)} L</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tank_capacity">Tank capacity (L)</Label>
                  <Input id="tank_capacity" type="number" min="0.01" max="1000" step="0.01" value={allocationForm.tank_capacity_l} onChange={(event) => setAllocationForm({ ...allocationForm, tank_capacity_l: event.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fuel_efficiency">Efficiency (km/L)</Label>
                  <Input id="fuel_efficiency" type="number" min="0.01" max="100" step="0.01" value={allocationForm.fuel_efficiency_kmpl} onChange={(event) => setAllocationForm({ ...allocationForm, fuel_efficiency_kmpl: event.target.value })} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfigureAllocation(null)}>Cancel</Button>
                <Button onClick={submitAllocation} disabled={saveAllocationMutation.isPending}>
                  {saveAllocationMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save monthly plan
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!reviewRequest} onOpenChange={(open) => !open && setReviewRequest(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review fuel request #{reviewRequest?.fuel_request_id}</DialogTitle>
          </DialogHeader>
          {reviewRequest ? (
            <div className="space-y-4 pt-2">
              <div className="rounded-2xl border border-border bg-muted/20 p-4 text-sm">
                <p className="font-semibold">{reviewRequest.first_name} {reviewRequest.last_name}</p>
                <p className="text-foreground-secondary">{reviewRequest.plate_number} · {reviewRequest.trip_id ? `Trip #${reviewRequest.trip_id}` : "Vehicle assignment"}</p>
                {reviewRequest.purpose ? <p className="mt-2 text-foreground-secondary">{reviewRequest.purpose}</p> : null}
              </div>
              {reviewRequest.gauge_photo_url ? (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/20 p-2">
                  <img
                    src={reviewRequest.gauge_photo_url}
                    alt="Fuel gauge evidence"
                    className="h-16 w-24 cursor-zoom-in rounded-lg border border-border object-cover"
                    onClick={() => setZoomReceiptUrl(reviewRequest.gauge_photo_url)}
                  />
                  <p className="text-xs text-foreground-muted">
                    Gauge photo attached by driver
                    {reviewRequest.calculation_snapshot?.gauge_scan ? ` · AI read ~${reviewRequest.calculation_snapshot.gauge_scan.estimated_level_percent}%` : " (not machine-read)"}
                  </p>
                </div>
              ) : null}
              {reviewFacts.variance?.variance_detected ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    <span className="font-bold">Fuel variance detected — review recommended.</span>{" "}
                    Expected ≈{reviewFacts.variance.expected_liters} L remaining based on the previous report and trips since, but the driver reports {reviewRequest.current_fuel_level_percent}%.
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3"><span className="text-foreground-muted">Minimum safe refill</span><p className="mt-1 font-data font-bold">{reviewFacts.minSafe != null ? `${reviewFacts.minSafe.toFixed(2)} L` : "—"}</p><p className="mt-0.5 text-[10px] text-foreground-muted">Forecast use + emergency reserve</p></div>
                <div className="rounded-xl border border-border/60 bg-muted/30 p-3"><span className="text-foreground-muted">Preferred target</span><p className="mt-1 font-data font-bold">{reviewFacts.target} L</p><p className="mt-0.5 text-[10px] text-foreground-muted">Fewer refueling stops</p></div>                <div className="rounded-xl bg-muted/30 p-3"><span className="text-foreground-muted">Tank space left</span><p className="mt-1 font-data font-bold">{reviewFacts.tankSpace != null ? `${reviewFacts.tankSpace.toFixed(2)} L` : "—"}</p></div>
                <div className="rounded-xl bg-muted/30 p-3"><span className="text-foreground-muted">Budget remaining</span><p className="mt-1 font-data font-bold">{reviewFacts.remaining ?? "—"} L</p></div>
                <div className="rounded-xl bg-muted/30 p-3"><span className="text-foreground-muted">Current fuel</span><p className="mt-1 font-data font-bold">{reviewRequest.current_fuel_level_percent}% · {reviewRequest.calculation_snapshot?.current_liters ?? "—"} L</p><p className="mt-0.5 text-[10px] text-foreground-muted">{reviewRequest.calculation_snapshot?.gauge_scan ? `Gauge scan read ~${reviewRequest.calculation_snapshot.gauge_scan.estimated_level_percent}%` : "Driver-reported"}</p></div>
                <div className="rounded-xl bg-muted/30 p-3"><span className="text-foreground-muted">24h forecast</span><p className="mt-1 font-data font-bold">{reviewRequest.forecast_distance_km} km · ≈{reviewRequest.calculation_snapshot?.forecast_consumption_liters ?? "—"} L</p></div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="approved_liters">Approved allocation (liters)</Label>
                <Input
                  id="approved_liters"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={approvedLiters}
                  onChange={(event) => setApprovedLiters(event.target.value)}
                />
                <p className="text-xs text-foreground-muted">Below the minimum safe refill or above the monthly available requires an override reason.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="request_notes">Review notes / override reason</Label>
                <Input
                  id="request_notes"
                  maxLength={500}
                  value={requestNotes}
                  onChange={(event) => setRequestNotes(event.target.value)}
                  placeholder="Required when rejecting, approving below minimum, or exceeding the budget"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setReviewRequest(null)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={() => submitRequestReview("Rejected")}
                  disabled={reviewRequestMutation.isPending}
                >
                  Reject
                </Button>
                <Button
                  onClick={() => submitRequestReview("Approved")}
                  disabled={reviewRequestMutation.isPending}
                >
                  {reviewRequestMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Approve allocation
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

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
                    <div className="rounded-3xl border-2 border-dashed border-border p-8 text-center bg-muted/20 aspect-[3/4] flex flex-col items-center justify-center text-foreground-muted">
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

                    {(() => {
                      const vehicle = inspectRecord.vehicles || {};
                      const tank = Number(vehicle.tank_capacity_l);
                      const level = Number(vehicle.fuel_level);
                      const liters = Number(inspectRecord.liters);
                      const estimated = Number.isFinite(tank) && Number.isFinite(level) ? tank * (level / 100) : null;
                      const tankOk = estimated == null || !Number.isFinite(liters) ? null : liters + estimated <= tank;
                      const mismatch = fuelTypeMismatch(vehicle.fuel_type, inspectRecord.receipt_fuel_type);
                      return (
                        <div className="space-y-1.5 text-xs pt-2 border-t border-border">
                          <p className="font-semibold text-foreground">Automatic checks</p>
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            <span className={mismatch ? "text-danger font-semibold" : "text-foreground-muted"}>
                              {inspectRecord.receipt_fuel_type
                                ? mismatch
                                  ? `⚠ Fuel type: receipt says ${inspectRecord.receipt_fuel_type}, vehicle uses ${vehicle.fuel_type || "unspecified"}`
                                  : `Fuel type: ${inspectRecord.receipt_fuel_type} –`
                                : "Fuel type: not stated on receipt"}
                            </span>
                            <span className={tankOk === false ? "text-danger font-semibold" : "text-foreground-muted"}>
                              {tankOk == null
                                ? "Tank capacity check: unavailable"
                                : tankOk
                                  ? `Tank capacity check: passed – (${estimated.toFixed(1)} L current + ${liters} L ≤ ${tank} L)`
                                  : `⚠ Impossible fuel quantity — only about ${(tank - estimated).toFixed(1)} L of space left`}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Verification Decision Buttons */}
                  <div className="p-4 rounded-3xl border border-border bg-surface space-y-3">
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
              Please enter a reason for rejecting this driver refuel claim (e.g. <i>&quot;Unreadable image scan&quot;</i>, <i>&quot;Amount mismatch on receipt&quot;</i>).
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
                <DatePicker
                  id="fuel_date"
                  label="Refuel Date *"
                  value={editForm.fuel_date !== undefined ? editForm.fuel_date : (editRecord.fuel_date ? editRecord.fuel_date.substring(0, 10) : "")}
                  onChange={(val) => setEditForm({ ...editForm, fuel_date: val })}
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
          <div className="p-2 flex items-center justify-center max-h-[75vh] overflow-auto bg-black/5 rounded-3xl border border-border">
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

      {/* ── ROW APPROVE CONFIRMATION DIALOG ── */}
      <ConfirmDialog
        open={!!approvingRecord}
        onOpenChange={(open) => { if (!open) setApprovingRecord(null); }}
        title="Approve this fuel record?"
        message={`Approve ${approvingRecord?.liters ?? "—"} L for ${approvingRecord?.vehicles?.plate_number || "—"} refueled by ${
          approvingRecord?.drivers?.employees
            ? `${approvingRecord.drivers.employees.first_name} ${approvingRecord.drivers.employees.last_name}`
            : "—"
        }?`}
        confirmLabel="Approve"
        variant="info"
        loading={updateStatusMutation.isPending}
        onConfirm={() => {
          if (approvingRecord) {
            updateStatusMutation.mutate({ id: approvingRecord.fuel_record_id, status: "Approved" });
          }
        }}
      />

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
