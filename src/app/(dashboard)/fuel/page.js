"use client";

import { useState, useEffect, useRef } from "react";
import { MotionConfig, motion } from "framer-motion";
import { useQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/tables/data-table";
import { createColumnHelper } from "@tanstack/react-table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Tooltip } from "@/components/ui/tooltip";
import {
  getFuelRecord,
  getFuelRecords,
  getFuelAllocations,
  getFuelRequests,
  reviewFuelRequest,
  saveFuelAllocation,
  updateFuelRecord,
  updateFuelStatus,
} from "@/services/fuel.service";
import { apiFetch } from "@/lib/api/client";
import { useRoleAccess } from "@/hooks/use-role-access";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import {
  Fuel,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Loader2,
  FileText,
  AlertTriangle,
  User,
  Truck,
  ClipboardList,
  Gauge,
  Settings2,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import { toast } from "@/components/ui/toast";
import { DatePicker } from "@/components/ui/date-picker";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { LIMITS } from "@/lib/validation";
import { fuelTypeMismatch } from "@/lib/fuel/request-policy";
import { ReceiptVerificationModal } from "@/components/fuel/receipt-verification-modal";
import { RejectClaimDialog } from "@/components/fuel/reject-claim-dialog";
import { FullscreenReceiptDialog } from "@/components/fuel/fullscreen-receipt-dialog";
import { ConfigureAllocationDialog } from "@/components/fuel/configure-allocation-dialog";

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
  useRequireRole();
  const queryClient = useQueryClient();
  const { can } = useRoleAccess();
  // Drivers never reach this console (NAV_ROLES), but the actions stay gated
  // so a deep link can never expose review/configure controls.
  const canReviewRequests = can("fuel_requests", "review");
  const canReviewRecords = can("fuel", "update");
  const canConfigure = can("fuelallocations", "update");

  // Smart default without render-phase or effect-phase pitfalls: the query
  // always fetches a concrete tab (override, else Pending); counts from any
  // completed fetch then steer the *override* once via a deferred update, so
  // the query key follows on the next render. Manual pill picks win outright.
  const [tabOverride, setTabOverride] = useState(null); // 'Pending' | 'Approved' | 'Rejected' | 'all' | null
  const steerTimer = useRef(null);
  const pickTab = (tab) => {
    clearTimeout(steerTimer.current);
    setTabOverride(tab);
    setPage(1);
  };
  const fetchTab = tabOverride ?? "Pending";
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
  const statusParam = fetchTab === "all" ? undefined : fetchTab;

  // Fetch a page of fuel records. Filtering/sorting/pagination now happen on the
  // server; the API returns `{ rows, total, counts }` for the table + stat cards.
  const {
    data = { rows: [], total: 0, counts: { total: 0, pending: 0, approved: 0, rejected: 0, approvedCost: 0 } },
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["fuel-records", { page, tab: fetchTab, search, sort }],
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
  const countsReady = !isLoading && !isError;
  // Displayed tab: user pick wins; otherwise Pending while loading or when
  // review work exists, All when healthy-but-nonempty. Steering the override
  // (deferred, once) pulls the query key along — polls never yank it after.
  const activeTab =
    tabOverride ?? (countsReady && counts.total > 0 && !(counts.pending > 0) ? "all" : "Pending");

  useEffect(() => {
    if (tabOverride || !countsReady) return;
    if (!(counts.total > 0 && !(counts.pending > 0))) return;
    steerTimer.current = setTimeout(() => setTabOverride("all"), 0);
    return () => clearTimeout(steerTimer.current);
  }, [tabOverride, countsReady, counts.total, counts.pending]);

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

  // Flagged transactions + per-vehicle efficiency for the Needs-review section
  // (ported from the retired fleet/fuel page; same month-defaulted endpoint).
  const { data: exceptionData, isLoading: exceptionsLoading } = useQuery({
    queryKey: ["fuel-exceptions"],
    queryFn: () => apiFetch("/api/admin/analytics/fuel"),
    refetchInterval: 30_000,
  });
  const exceptions = exceptionData?.exceptions || [];
  const [inspectingException, setInspectingException] = useState(false);

  // An exception row is a projection, not a full record — load the complete
  // row (vehicles/drivers/scan joins) so the verification studio gets everything.
  const openExceptionReview = async (exception) => {
    setInspectingException(true);
    try {
      const full = await getFuelRecord(exception.fuel_record_id);
      setInspectRecord(full);
    } catch (e) {
      toast.error(e.message || "Could not load the fuel record.");
    } finally {
      setInspectingException(false);
    }
  };

  // Export needs the whole (filtered) set, not just the current page.
  const handleExport = async () => {
    if (!total) {
      toast.error("Nothing to export for the current filter.");
      return;
    }
    setExporting(true);
    try {
      const all = await getFuelRecords({
        status: statusParam,
        search: search || undefined,
        pageSize: total,
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
      queryClient.invalidateQueries({ queryKey: ["fuel-exceptions"] });
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
      queryClient.invalidateQueries({ queryKey: ["fuel-exceptions"] });
      setEditRecord(null);
    },
    onError: (err) => toast.error(err.message || "Failed to update fuel record"),
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

  // Overview cards switch the visible table (assignments-module pattern):
  // one section shown at a time, nothing hidden behind scroll. The pills stay
  // the registry's only status filter.
  const [overviewTab, setOverviewTab] = useState("registry"); // 'budget' | 'permits' | 'review' | 'registry'

  // Stats come from the server-side counts (whole set, not the current page).
  const pendingCount = counts.pending;
  const approvedCount = counts.approved;
  const rejectedCount = counts.rejected;
  const configuredBudgets = fuelAllocations.filter((row) => row.allocation_id).length;
  const unconfiguredBudgets = fuelAllocations.length - configuredBudgets;
  const totalAllocated = fuelAllocations.reduce((sum, row) => sum + (Number(row.allocated_liters) || 0), 0);
  const overBudget = fuelAllocations.filter((row) => {
    const alloc = Number(row.allocated_liters) || 0;
    if (!(alloc > 0)) return false;
    return (Number(row.consumed_liters) || 0) + (Number(row.committed_liters) || 0) > alloc;
  }).length;

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

            {isPending && canReviewRecords && (
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

  const columnHelper = createColumnHelper();
  
  const allocationColumns = [
    columnHelper.accessor("plate_number", {
      header: "Vehicle",
      cell: (info) => (
        <div>
          <p className="font-data text-xs font-bold">{info.getValue()}</p>
          <p className="text-xs text-foreground-muted">{info.row.original.vehicle_name}</p>
        </div>
      ),
    }),
    columnHelper.display({
      id: "profile",
      header: "Fuel profile",
      cell: (info) => {
        const row = info.row.original;
        return row.tank_capacity_l && row.fuel_efficiency_kmpl
          ? <span className="text-xs">{`${row.tank_capacity_l} L tank · ${row.fuel_efficiency_kmpl} km/L`}</span>
          : <span className="text-xs text-warning">Profile required</span>;
      },
    }),
    columnHelper.accessor("allocated_liters", {
      header: "Monthly budget",
      cell: (info) => <span className="font-data font-bold">{info.getValue() ? `${info.getValue()} L` : "—"}</span>,
    }),
    columnHelper.display({
      id: "used",
      header: "Used / committed",
      cell: (info) => {
        const row = info.row.original;
        return <span className="font-data text-xs">{Number(row.consumed_liters || 0).toFixed(1)} / {Number(row.committed_liters || 0).toFixed(1)} L</span>;
      },
    }),
    columnHelper.display({
      id: "utilization",
      header: "Utilization",
      cell: (info) => {
        const row = info.row.original;
        if (!row.allocated_liters) return "—";
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
      },
    }),
    columnHelper.display({
      id: "action",
      header: () => <div className="text-right">Action</div>,
      cell: (info) => (
        <div className="text-right">
          {canConfigure ? (
            <Button size="sm" variant="outline" onClick={() => openAllocationSetup(info.row.original)}>
              <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Configure
            </Button>
          ) : (
            <span className="text-xs text-foreground-muted">—</span>
          )}
        </div>
      ),
    }),
  ];

  const requestColumns = [
    columnHelper.display({
      id: "driver",
      header: "Driver / Source",
      cell: (info) => {
        const req = info.row.original;
        return (
          <div>
            <p className="font-semibold text-foreground">{req.first_name} {req.last_name}</p>
            <p className="text-xs text-foreground-muted">{req.trip_id ? `Trip #${req.trip_id}` : "Vehicle assignment"}</p>
          </div>
        );
      },
    }),
    columnHelper.accessor("plate_number", {
      header: "Vehicle",
      cell: (info) => <span className="font-data text-xs font-bold">{info.getValue()}</span>,
    }),
    columnHelper.display({
      id: "forecast",
      header: "Fuel / Forecast",
      cell: (info) => {
        const req = info.row.original;
        return (
          <div className="text-xs">
            <p className="font-data font-bold">{req.current_fuel_level_percent ?? "—"}% current</p>
            <p className="text-foreground-muted">{req.forecast_distance_km ?? "—"} km / 24h</p>
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "recommended",
      header: "Recommended",
      cell: (info) => {
        const req = info.row.original;
        return <span className="font-data font-bold">{req.recommended_liters || req.requested_liters} L</span>;
      },
    }),
    columnHelper.accessor("approved_liters", {
      header: "Authorized",
      cell: (info) => <span className="font-data">{info.getValue() ? `${info.getValue()} L` : "—"}</span>,
    }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => {
        const req = info.row.original;
        return (
          <div>
            <StatusBadge status={req.status} entity="fuel" />
            {req.status === "Approved" && req.calculation_snapshot?.auto_authorized ? (
              <span className="ml-1.5 inline-flex items-center rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success">
                Within policy
              </span>
            ) : null}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "action",
      header: () => <div className="text-right">Action</div>,
      cell: (info) => {
        const req = info.row.original;
        return (
          <div className="text-right">
            {req.status === "Pending" ? (
              canReviewRequests ? (
                <Button size="sm" onClick={() => openRequestReview(req)}>Review</Button>
              ) : (
                <span className="text-xs text-foreground-muted">Pending review</span>
              )
            ) : (
              <span className="text-xs text-foreground-muted">Reviewed</span>
            )}
          </div>
        );
      },
    }),
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

  const handleOpenEdit = (rec) => {
    setEditRecord(rec);
    setEditForm({
      station_name: rec.station_name || "",
      liters: rec.liters != null ? String(rec.liters) : "",
      amount: rec.amount != null ? String(rec.amount) : "",
      price_per_liter: rec.price_per_liter != null ? String(rec.price_per_liter) : "",
      odometer: rec.odometer != null ? String(rec.odometer) : "",
      fuel_date: rec.fuel_date ? String(rec.fuel_date).substring(0, 10) : "",
    });
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

      {/* ── View tabs: sliding-pill switcher ── */}
      <MotionConfig reducedMotion="user">
      <div className="flex items-center gap-1 overflow-x-auto rounded-2xl border border-border/60 bg-surface p-1.5 shadow-xs" role="tablist" aria-label="Fuel tables">
        {[
          { key: "registry", label: "Registry", icon: Fuel },
          { key: "budget", label: "Monthly Budget", icon: Gauge },
          { key: "permits", label: "Permits", icon: ClipboardList, count: requestsLoading ? null : requestData.counts?.pending || 0 },
        ].map((tab) => {
          const selected = overviewTab === tab.key;
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setOverviewTab(tab.key)}
              className={cn("relative flex h-11 flex-1 items-center justify-center whitespace-nowrap rounded-xl px-4 text-xs font-bold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", !selected && "hover:bg-hover")}
            >
              {selected && (
                <motion.span
                  layoutId="fuel-tab-pill"
                  className="absolute inset-0 rounded-xl bg-primary shadow-xs"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <span className={cn("relative flex items-center gap-2 transition-colors", selected ? "text-white dark:text-slate-950" : "text-foreground-secondary")}>
                <Icon className="h-4 w-4" />
                {tab.label}
                {tab.count != null && tab.count > 0 && (
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", selected ? "bg-white/20 text-white dark:text-slate-950" : "bg-warning/10 border border-warning/25 text-warning-700")}>
                    {tab.count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      </MotionConfig>

      {overviewTab === "budget" && (
        <StatGrid cols={4}>
          <StatCard icon={Gauge} label="Configured" value={allocationsLoading ? "—" : configuredBudgets} valueNote={allocationsLoading ? undefined : `of ${fuelAllocations.length}`} trend="Vehicles with a monthly limit set" tone="primary" />
          <StatCard icon={Gauge} label="Unconfigured" value={allocationsLoading ? "—" : unconfiguredBudgets} trend="Vehicles missing a monthly limit" tone={unconfiguredBudgets ? "warning" : "neutral"} />
          <StatCard icon={Fuel} label="Total Allocated" value={allocationsLoading ? "—" : `${totalAllocated.toLocaleString()} L`} trend="Sum of monthly limits this period" tone="info" />
          <StatCard icon={AlertTriangle} label="Over Budget" value={allocationsLoading ? "—" : overBudget} trend="Used + committed above the limit" tone={overBudget ? "danger" : "neutral"} />
        </StatGrid>
      )}
      {overviewTab === "permits" && (
        <StatGrid cols={4}>
          <StatCard icon={Clock} label="Pending" value={requestsLoading ? "—" : requestData.counts?.pending || 0} trend="Requests awaiting review" tone="warning" />
          <StatCard icon={CheckCircle2} label="Approved" value={requestsLoading ? "—" : requestData.counts?.approved || 0} trend="Authorized, awaiting logging" tone="info" />
          <StatCard icon={Fuel} label="Fulfilled" value={requestsLoading ? "—" : requestData.counts?.fulfilled || 0} trend="Logged against the permit" tone="success" />
          <StatCard icon={XCircle} label="Rejected" value={requestsLoading ? "—" : requestData.counts?.rejected || 0} trend="Declined requests" tone="neutral" />
        </StatGrid>
      )}
      {overviewTab === "registry" && (
        <StatGrid cols={4}>
          <StatCard icon={Fuel} label="Total Submissions" value={counts.total} trend="All receipt records in filter" tone="primary" />
          <StatCard icon={Clock} label="Pending Audit" value={pendingCount} trend="Records awaiting verification" tone="warning" />
          <StatCard icon={CheckCircle2} label="Approved Expense" value={formatCurrency(counts.approvedCost)} trend="Verified spend in filter" tone="success" />
          <StatCard icon={XCircle} label="Rejected" value={rejectedCount} trend="Declined claims" tone="neutral" />
        </StatGrid>
      )}

      {/* ── Monthly Budget ── */}
      {overviewTab === "budget" && (
      <DataTable
        columns={allocationColumns}
        data={fuelAllocations}
        isLoading={allocationsLoading}
        title="Monthly Vehicle Fuel Plan"
        description="Configure each vehicle once per month; approved receipts consume the available liters."
        icon={Gauge}
        searchable={false}
        pageSize={5}
        toolbar={
          <Badge variant="secondary" className="rounded-full">
            {fuelAllocations.filter((row) => !row.allocation_id).length} unconfigured
          </Badge>
        }
        emptyTitle="No active vehicles found"
      />
      )}

      {overviewTab === "permits" && (
      <DataTable
        columns={requestColumns}
        data={fuelRequests}
        isLoading={requestsLoading}
        title="Fuel Requests (Permits)"
        description="Permits authorize fuel before the pump — recommendations cover the next 24 hours toward a safe level."
        icon={ClipboardList}
        searchable={false}
        pageSize={5}
        toolbar={
          <Badge variant="warning" className="rounded-full">
            {requestData.counts?.pending || 0} pending
          </Badge>
        }
        emptyTitle="No fuel requests yet"
      />
      )}

      {/* ── Status Filter Tabs & Table ── */}
      {overviewTab === "registry" && (
      <>
      {exceptions.length > 0 && (
      <Card className="border-warning/25 bg-warning/5 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3 border-b border-warning/20">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-[15px] font-semibold text-foreground tracking-tight flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning-700" /> Needs review
              </CardTitle>
              <p className="mt-1 text-xs leading-relaxed text-foreground-secondary">
                Automated checks flagged these records — they stay out of verified totals until a human clears them.
              </p>
            </div>
            <Badge variant="warning" className="rounded-full shrink-0">
              {exceptionsLoading ? "…" : `${exceptions.length} flagged`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {exceptionsLoading ? (
            <p className="px-5 py-8 text-center text-sm text-foreground-muted">Checking records for anomalies…</p>
          ) : (
            <div className="divide-y divide-border/60">
              {exceptions.map((ex) => (
                <div key={ex.fuel_record_id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-data text-sm font-bold text-foreground">{ex.plate_number || "Unknown vehicle"}</p>
                    <p className="mt-0.5 text-xs text-foreground-secondary tabular-nums">
                      {ex.fuel_date ? formatDate(ex.fuel_date) : "—"} · {ex.liters} L · {formatCurrency(ex.amount)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ex.flags?.price_anomaly && <span className="rounded-full bg-warning/10 border border-warning/25 px-2 py-0.5 text-[11px] font-bold text-warning-700">Price anomaly</span>}
                      {ex.flags?.driver_edited && <span className="rounded-full bg-info/10 border border-info/25 px-2 py-0.5 text-[11px] font-bold text-info-700">Driver edited</span>}
                      {ex.flags?.fuel_type_mismatch && <span className="rounded-full bg-danger/10 border border-danger/25 px-2 py-0.5 text-[11px] font-bold text-danger-700">Type mismatch</span>}
                      {ex.flags?.possible_duplicate && <span className="rounded-full bg-warning/10 border border-warning/25 px-2 py-0.5 text-[11px] font-bold text-warning-700">Possible duplicate</span>}
                    </div>
                  </div>
                  {canReviewRecords && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={inspectingException}
                      onClick={() => openExceptionReview(ex)}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" /> {inspectingException ? "Loading…" : "Review"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}
      <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
        <CardHeader className="pb-3.5 border-b border-border/60 bg-muted/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-[11px] font-bold uppercase tracking-wider text-foreground-muted shrink-0">Filter</span>
            <button
              className={cn('px-4 h-8 flex items-center justify-center rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap', activeTab === "Pending" ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}
              onClick={() => pickTab("Pending")}
            >
              <Clock className="w-3.5 h-3.5 mr-1.5" /> Pending Review ({pendingCount})
            </button>

            <button
              className={cn('px-4 h-8 flex items-center justify-center rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap', activeTab === "Approved" ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}
              onClick={() => pickTab("Approved")}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Approved ({approvedCount})
            </button>

            <button
              className={cn('px-4 h-8 flex items-center justify-center rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap', activeTab === "Rejected" ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}
              onClick={() => pickTab("Rejected")}
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Rejected ({rejectedCount})
            </button>

            <button
              className={cn('px-4 h-8 flex items-center justify-center rounded-full text-xs font-bold border transition-all cursor-pointer whitespace-nowrap', activeTab === "all" ? 'bg-primary text-white dark:text-slate-950 border-primary' : 'bg-surface border-border/60 text-foreground-secondary hover:border-primary/40')}
              onClick={() => pickTab("all")}
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
      </>
      )}

      {/* ── CONFIGURE MONTHLY ALLOCATION MODAL ── */}
      <ConfigureAllocationDialog
        open={!!configureAllocation}
        onOpenChange={(open) => {
          if (!open) setConfigureAllocation(null);
        }}
        vehicle={configureAllocation}
        form={allocationForm}
        setForm={setAllocationForm}
        onSubmit={submitAllocation}
        isPending={saveAllocationMutation.isPending}
      />

      <Dialog open={!!reviewRequest} onOpenChange={(open) => !open && setReviewRequest(null)}>
        <DialogContent className="max-w-2xl w-[95vw] md:w-[640px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
          <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base font-bold text-foreground">
                    Review Fuel Request
                  </DialogTitle>
                  <span className="inline-flex items-center rounded-lg border border-border bg-muted px-2 py-0.5 font-mono text-xs font-bold text-foreground">
                    Request #{reviewRequest?.fuel_request_id}
                  </span>
                </div>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Evaluate driver refill request against consumption policy & budget.
                </p>
              </div>
            </div>
          </div>

          {reviewRequest ? (
            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Driver & Trip Info Card */}
              <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                <div className="rounded-xl bg-surface p-3.5 border border-border/50 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[10px] text-foreground-muted block">Driver</span>
                      <p className="font-bold text-foreground text-sm">{reviewRequest.first_name} {reviewRequest.last_name}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                      <Truck className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-[10px] text-foreground-muted block">Vehicle & Purpose</span>
                      <p className="font-bold text-foreground font-mono text-xs">
                        {reviewRequest.plate_number} • {reviewRequest.trip_id ? `Trip #${reviewRequest.trip_id}` : "Vehicle assignment"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {reviewRequest.gauge_photo_url ? (
                <div className="flex items-center gap-3 rounded-2xl border border-border/80 bg-muted/30 p-3">
                  <img
                    src={reviewRequest.gauge_photo_url}
                    alt="Fuel gauge evidence"
                    className="h-16 w-24 cursor-zoom-in rounded-xl border border-border/80 object-cover shadow-xs"
                    onClick={() => setZoomReceiptUrl(reviewRequest.gauge_photo_url)}
                  />
                  <div className="text-xs">
                    <span className="font-bold text-foreground block">Fuel Gauge Photo Evidence</span>
                    <p className="text-foreground-secondary text-[11px] mt-0.5">
                      Attached by driver
                      {reviewRequest.calculation_snapshot?.gauge_scan ? ` • AI read ~${reviewRequest.calculation_snapshot.gauge_scan.estimated_level_percent}%` : " (driver manual read)"}
                    </p>
                  </div>
                </div>
              ) : null}

              {reviewFacts?.variance?.variance_detected ? (
                <div className="flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <p>
                    <strong className="font-bold">Fuel variance detected:</strong> Expected ≈{reviewFacts.variance.expected_liters} L remaining from previous report & trips, but driver reported {reviewRequest.current_fuel_level_percent}%.
                  </p>
                </div>
              ) : null}

              {/* 6-Tile Policy Matrix */}
              <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                <div className="rounded-xl bg-surface p-3.5 border border-border/50 space-y-2">
                  <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider block">
                    Replenishment Policy Factors
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="rounded-xl border border-border/70 bg-muted/40 p-2.5">
                      <span className="text-[10px] font-medium text-foreground-muted block">Min Safe Refill</span>
                      <p className="font-data font-bold text-foreground text-sm mt-0.5">{reviewFacts?.minSafe != null ? `${reviewFacts.minSafe.toFixed(2)} L` : "—"}</p>
                      <p className="text-[9px] text-foreground-muted mt-0.5">Forecast + reserve</p>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-emerald-500/10 dark:bg-emerald-500/15 border-emerald-500/20 p-2.5">
                      <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 block">Preferred Target</span>
                      <p className="font-data font-bold text-emerald-600 dark:text-emerald-300 text-sm mt-0.5">{reviewFacts?.target} L</p>
                      <p className="text-[9px] text-emerald-700/80 dark:text-emerald-400/80 mt-0.5">Fewer refuel stops</p>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/40 p-2.5">
                      <span className="text-[10px] font-medium text-foreground-muted block">Tank Space Left</span>
                      <p className="font-data font-bold text-foreground text-sm mt-0.5">{reviewFacts?.tankSpace != null ? `${reviewFacts.tankSpace.toFixed(2)} L` : "—"}</p>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/40 p-2.5">
                      <span className="text-[10px] font-medium text-foreground-muted block">Budget Remaining</span>
                      <p className="font-data font-bold text-foreground text-sm mt-0.5">{reviewFacts?.remaining ?? "—"} L</p>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/40 p-2.5">
                      <span className="text-[10px] font-medium text-foreground-muted block">Current Fuel</span>
                      <p className="font-data font-bold text-foreground text-sm mt-0.5">{reviewRequest.current_fuel_level_percent}% · {reviewRequest.calculation_snapshot?.current_liters ?? "—"} L</p>
                    </div>

                    <div className="rounded-xl border border-border/70 bg-muted/40 p-2.5">
                      <span className="text-[10px] font-medium text-foreground-muted block">24h Forecast</span>
                      <p className="font-data font-bold text-foreground text-sm mt-0.5">{reviewRequest.forecast_distance_km} km · ≈{reviewRequest.calculation_snapshot?.forecast_consumption_liters ?? "—"} L</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Approval Inputs */}
              <div className="space-y-3 pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="approved_liters" className="text-xs font-semibold text-foreground">
                    Approved Refill Liters *
                  </Label>
                  <Input
                    id="approved_liters"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={approvedLiters}
                    onChange={(event) => setApprovedLiters(event.target.value)}
                    className="text-base font-data font-bold h-10"
                  />
                  <p className="text-[11px] text-foreground-muted">
                    Approving below min safe ({reviewFacts?.minSafe?.toFixed(1) || "—"} L) or above remaining budget requires an override reason.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="request_notes" className="text-xs font-semibold text-foreground">
                    Review Notes / Override Reason
                  </Label>
                  <Input
                    id="request_notes"
                    maxLength={500}
                    value={requestNotes}
                    onChange={(event) => setRequestNotes(event.target.value)}
                    placeholder="Required when rejecting, approving below minimum, or exceeding budget"
                    className="text-xs"
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="px-6 py-3.5 border-t border-border/70 bg-surface/90 backdrop-blur-md flex items-center justify-end gap-2.5 shrink-0">
            <Button variant="outline" onClick={() => setReviewRequest(null)} className="text-xs h-9 px-4">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => submitRequestReview("Rejected")}
              disabled={reviewRequestMutation.isPending}
              className="text-xs h-9 px-4 font-semibold"
            >
              Reject
            </Button>
            <Button
              onClick={() => submitRequestReview("Approved")}
              disabled={reviewRequestMutation.isPending}
              className="text-xs h-9 px-5 font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {reviewRequestMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Approve Refill
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── HIGH-END RECEIPT VERIFICATION MODAL ── */}
      <ReceiptVerificationModal
        open={!!inspectRecord}
        onOpenChange={(open) => {
          if (!open) setInspectRecord(null);
        }}
        record={inspectRecord}
        onApprove={handleApprove}
        onReject={openRejectPrompt}
        onEdit={(rec) => {
          setInspectRecord(null);
          handleOpenEdit(rec);
        }}
        onFullscreenZoom={(url) => setZoomReceiptUrl(url)}
        isActionPending={updateStatusMutation.isPending}
      />

      {/* ── REJECTION REASON PROMPT DIALOG ── */}
      <RejectClaimDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        record={targetRejectRecord}
        rejectionReason={rejectionReason}
        setRejectionReason={setRejectionReason}
        onConfirm={handleRejectConfirm}
        isPending={updateStatusMutation.isPending}
        fieldError={rejectFieldError}
        registerField={registerRejectField}
      />

      {/* ── EDIT FUEL LOG DIALOG ── */}
      <Dialog
        open={!!editRecord}
        onOpenChange={(open) => {
          if (!open) setEditRecord(null);
        }}
      >
        <DialogContent className="max-w-lg w-[95vw] md:w-[500px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
          <div className="px-6 py-4 border-b border-border/70 bg-surface/80 backdrop-blur-md flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                <Fuel className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold text-foreground">
                  Edit Fuel Record
                </DialogTitle>
                <p className="text-xs text-foreground-muted mt-0.5">
                  Update refuel volume, claimed costs, and odometer telemetry.
                </p>
              </div>
            </div>
          </div>

          {editRecord && (
            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div className="rounded-2xl bg-muted/40 p-1.5 border border-border/80 shadow-2xs">
                <div className="rounded-xl bg-surface p-4 border border-border/50 space-y-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="station_name" className="text-xs font-semibold text-foreground">
                      Gas Station Name
                    </Label>
                    <Input
                      id="station_name"
                      defaultValue={editRecord.station_name || ""}
                      onChange={(e) => setEditForm({ ...editForm, station_name: e.target.value })}
                      ref={registerEditField("station_name")}
                      invalid={editFieldError("station_name").invalid}
                      placeholder="Petron, Shell, Caltex..."
                      className="text-xs h-9"
                    />
                    {editFieldError("station_name").error && <p className="text-xs text-danger">{editFieldError("station_name").error}</p>}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="liters" className="text-xs font-semibold text-foreground">
                        Volume (Liters) <span className="text-danger">*</span>
                      </Label>
                      <div className="relative">
                        <Input
                          id="liters"
                          type="number"
                          step="0.01"
                          defaultValue={editRecord.liters || ""}
                          onChange={(e) => setEditForm({ ...editForm, liters: e.target.value })}
                          ref={registerEditField("liters")}
                          invalid={editFieldError("liters").invalid}
                          className="text-sm font-data font-semibold pr-9 h-10"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-foreground-muted pointer-events-none">
                          L
                        </span>
                      </div>
                      {editFieldError("liters").error && <p className="text-xs text-danger">{editFieldError("liters").error}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="amount" className="text-xs font-semibold text-foreground">
                        Total Amount (₱) <span className="text-danger">*</span>
                      </Label>
                      <div className="relative">
                        <Input
                          id="amount"
                          type="number"
                          step="0.01"
                          defaultValue={editRecord.amount || ""}
                          onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                          ref={registerEditField("amount")}
                          invalid={editFieldError("amount").invalid}
                          className="text-sm font-data font-bold text-emerald-600 dark:text-emerald-400 pl-7 h-10"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-600 dark:text-emerald-400 pointer-events-none">
                          ₱
                        </span>
                      </div>
                      {editFieldError("amount").error && <p className="text-xs text-danger">{editFieldError("amount").error}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="price_per_liter" className="text-xs font-semibold text-foreground">
                        Unit Price (₱/L)
                      </Label>
                      <Input
                        id="price_per_liter"
                        type="number"
                        step="0.01"
                        defaultValue={editRecord.price_per_liter || ""}
                        onChange={(e) => setEditForm({ ...editForm, price_per_liter: e.target.value })}
                        ref={registerEditField("price_per_liter")}
                        invalid={editFieldError("price_per_liter").invalid}
                        className="text-xs font-data h-9"
                      />
                      {editFieldError("price_per_liter").error && <p className="text-xs text-danger">{editFieldError("price_per_liter").error}</p>}
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="odometer" className="text-xs font-semibold text-foreground">
                        Odometer (km)
                      </Label>
                      <Input
                        id="odometer"
                        type="number"
                        defaultValue={editRecord.odometer || ""}
                        onChange={(e) => setEditForm({ ...editForm, odometer: e.target.value })}
                        ref={registerEditField("odometer")}
                        invalid={editFieldError("odometer").invalid}
                        className="text-xs font-data h-9"
                      />
                      {editFieldError("odometer").error && <p className="text-xs text-danger">{editFieldError("odometer").error}</p>}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="fuel_date" className="text-xs font-semibold text-foreground">
                      Refuel Date <span className="text-danger">*</span>
                    </Label>
                    <DatePicker
                      id="fuel_date"
                      label="Refuel Date *"
                      value={editForm.fuel_date !== undefined ? editForm.fuel_date : (editRecord.fuel_date ? editRecord.fuel_date.substring(0, 10) : "")}
                      onChange={(val) => setEditForm({ ...editForm, fuel_date: val })}
                    />
                    {editFieldError("fuel_date").error && <p className="text-xs text-danger">{editFieldError("fuel_date").error}</p>}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditRecord(null)} className="text-xs h-9 px-4">
                  Cancel
                </Button>
                <Button type="submit" disabled={editMutation.isPending} className="text-xs h-9 px-5 font-bold shadow-xs">
                  {editMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  Update Fuel Record
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── FULLSCREEN RECEIPT ZOOM DIALOG ── */}
      <FullscreenReceiptDialog
        open={!!zoomReceiptUrl}
        onOpenChange={(open) => {
          if (!open) setZoomReceiptUrl(null);
        }}
        receiptUrl={zoomReceiptUrl}
      />

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

    </div>
  );
}
