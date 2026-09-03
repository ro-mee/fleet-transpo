"use client";

import { useState, useEffect } from "react";
import { useQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HeroHeader, heroButtonOutlineClass } from "@/components/ui/hero-header";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/tables/data-table";
import { createColumnHelper } from "@tanstack/react-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip } from "@/components/ui/tooltip";
import {
  getExpenseRecords,
  reviewExpenseRecord,
} from "@/services/expenses.service";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import {
  Receipt,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  Truck,
} from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { exportToCSV } from "@/lib/export";
import { toast } from "@/components/ui/toast";
import { useFormValidation } from "@/lib/validation/useFormValidation";
import { ExpenseVerificationModal } from "@/components/expenses/ExpenseVerificationModal";

const TONE_MAP = {
  primary:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   icon: 'bg-slate-500/15 text-slate-500',   dot: 'bg-slate-500',   text: 'text-slate-600 dark:text-slate-400' },
  success:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'bg-emerald-500/15 text-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  warning:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   icon: 'bg-amber-500/15 text-amber-500',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400' },
  danger:    { bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: 'bg-red-500/15 text-red-500',       dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400' },
};

export default function ExpensesPage() {
  useRequireRole();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("Pending");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState([]);

  const [inspectRecord, setInspectRecord] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const statusParam = activeTab === "all" ? undefined : activeTab;

  const {
    data = { rows: [], total: 0, counts: { total: 0, pending: 0, approved: 0, rejected: 0, approvedCost: 0 } },
    isLoading,
  } = useQuery({
    queryKey: ["expense-records", { page, activeTab, search, sort }],
    queryFn: () =>
      getExpenseRecords({
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
  const counts = data.counts || { total: 0, pending: 0, approved: 0, rejected: 0, approvedCost: 0 };

  const handleExport = async () => {
    setExporting(true);
    try {
      const all = await getExpenseRecords({
        status: statusParam,
        search: search || undefined,
      });
      exportToCSV(all?.rows || [], "travel-expenses", [
        { label: "Expense Date", key: "expense_date" },
        { label: "Driver", accessor: (r) => (r.driver?.employee ? `${r.driver.employee.first_name} ${r.driver.employee.last_name}` : "") },
        { label: "Merchant", key: "merchant_name" },
        { label: "Category", key: "category" },
        { label: "Payment Method", key: "payment_method" },
        { label: "Amount", key: "amount" },
        { label: "Status", key: "status" },
      ]);
      toast.success(`Exported ${(all?.rows || []).length} records`);
    } catch {
      toast.error("Export failed — please try again");
    } finally {
      setExporting(false);
    }
  };

  const reviewMutation = useMutation({
    mutationFn: ({ id, action, review_remarks }) => reviewExpenseRecord(id, { action, review_remarks }),
    onSuccess: (_, variables) => {
      toast.success(`Expense ${variables.action === "Approve" ? "approved" : "rejected"} successfully`);
      queryClient.invalidateQueries({ queryKey: ["expense-records"] });
      setInspectRecord(null);
    },
    onError: (err) => toast.error(err.message || "Failed to update status"),
  });

  const handleReview = (id, action, remarks) => {
    reviewMutation.mutate({ id, action, review_remarks: remarks });
  };

  const columnHelper = createColumnHelper();

  const columns = [
    {
      key: "expense_date",
      label: "Expense Date",
      sortable: true,
      render: (val) => (
        <span className="font-data font-bold text-xs text-foreground">
          {val ? formatDate(val) : "—"}
        </span>
      ),
    },
    {
      key: "driver_info",
      label: "Driver / Source",
      render: (_, row) => {
        const emp = row.driver?.employee;
        const name = emp ? `${emp.first_name} ${emp.last_name}` : "—";
        const vehicle = row.vehicle?.plate_number || "—";
        return (
          <div>
            <p className="font-bold text-sm text-foreground">{name}</p>
            <p className="text-xs text-foreground-muted font-medium">{vehicle}</p>
          </div>
        );
      },
    },
    {
      key: "merchant_name",
      label: "Merchant",
      render: (val) => <span className="font-semibold text-xs text-foreground">{val || "—"}</span>,
    },
    {
      key: "category",
      label: "Category",
      render: (val) => <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs font-bold">{val}</Badge>,
    },
    {
      key: "payment_method",
      label: "Payment",
      render: (val, row) => (
        <div>
          <span className="font-semibold text-xs text-foreground">{val}</span>
          {val === 'Company Card' && row.company_card && (
            <p className="text-[10px] text-foreground-muted mt-0.5">{row.company_card.provider} •••• {row.company_card.card_last_four}</p>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      label: "Total Amount",
      sortable: true,
      render: (val, row) => <span className="font-data font-medium text-xs text-foreground">{val ? formatCurrency(val, row.currency) : "—"}</span>,
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
        return (
          <div className="inline-flex items-center gap-0.5 rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="Inspect Expense">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
                onClick={() => setInspectRecord(row)}
              >
                <Eye className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Receipt}
        title="Travel Expenses & Company Cards"
        badge="Finance"
        description="Verify driver-submitted expenses against AI extracted receipts and approve or reject claims."
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
                isActive ? cn(t.border, t.bg, "shadow-md") : "border-border/60 bg-surface hover:shadow-sm hover:border-primary/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Total Submissions</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><Receipt className="w-4 h-4" /></div>
              </div>
              <div className="text-3xl font-bold text-foreground font-data leading-none">{counts.total}</div>
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
                isActive ? cn(t.border, t.bg, "shadow-md") : "border-border/60 bg-surface hover:shadow-sm hover:border-warning/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Pending Audit</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><Clock className="w-4 h-4" /></div>
              </div>
              <div className="text-3xl font-bold text-foreground font-data leading-none">{counts.pending}</div>
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
                isActive ? cn(t.border, t.bg, "shadow-md") : "border-border/60 bg-surface hover:shadow-sm hover:border-success/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Approved Expense</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><CheckCircle2 className="w-4 h-4" /></div>
              </div>
              <div className="text-3xl font-bold text-foreground font-data leading-none">{formatCurrency(counts.approvedCost)}</div>
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
                isActive ? cn(t.border, t.bg, "shadow-md") : "border-border/60 bg-surface hover:shadow-sm hover:border-danger/40"
              )}
            >
              <div className="flex items-start justify-between gap-2 mt-1">
                <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">Rejected Items</span>
                <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}><XCircle className="w-4 h-4" /></div>
              </div>
              <div className="text-3xl font-bold text-foreground font-data leading-none">{counts.rejected}</div>
            </button>
          );
        })()}
      </div>

      <DataTable
        columns={columns}
        data={records}
        isLoading={isLoading}
        title="Expense Records"
        description="Travel and business expenses submitted by drivers."
        icon={Receipt}
        searchable={true}
        onSearch={setSearchInput}
        onSort={setSort}
        totalItems={data.total}
        page={page}
        onPageChange={setPage}
        pageSize={10}
        emptyTitle="No expenses found"
        onRowClick={(row) => setInspectRecord(row)}
      />

      {inspectRecord && (
        <ExpenseVerificationModal 
          record={inspectRecord} 
          onClose={() => setInspectRecord(null)}
          onReview={(action, remarks) => handleReview(inspectRecord.id, action, remarks)}
          isSubmitting={reviewMutation.isPending}
        />
      )}
    </div>
  );
}
