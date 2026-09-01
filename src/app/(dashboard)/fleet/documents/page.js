"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Link from "next/link";
import { getExpiringDocuments } from "@/services/vehicle.service";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FileText, AlertTriangle, Clock, ShieldCheck, Truck, IdCard, ShieldAlert, Eye, RefreshCw } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";
import { formatCalendarDate } from "@/lib/dates";
import { HeroHeader, heroButtonOutlineClass, heroButtonPrimaryClass } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { useRouter } from "next/navigation";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

function daysLabel(days) {
  if (days == null) return "No expiry";
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  return `Expires in ${days}d`;
}

// Mirrors QueryBoundary's error state. A compliance page must say "the data
// failed to load" — never render as if the fleet simply has no documents.
function DocumentErrorPanel({ onRetry, busy }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl border border-danger/20 bg-danger-bg/40"
      role="alert"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 mb-4">
        <AlertTriangle className="w-5 h-5 text-danger" />
      </div>
      <p className="text-sm font-medium text-foreground">Couldn&apos;t load document expiration data</p>
      <p className="text-sm text-foreground-secondary mt-1 max-w-sm leading-relaxed">
        The registry below is unavailable because the request failed — not because nothing is expiring.
      </p>
      <Button variant="outline" size="sm" className="mt-4 cursor-pointer" onClick={onRetry} disabled={busy}>
        <RefreshCw className={cn("mr-2 h-3.5 w-3.5", busy && "animate-spin")} />
        Try again
      </Button>
    </div>
  );
}

function ExpiryBadge({ days }) {
  if (days == null) return <span className="text-xs text-foreground-muted font-medium">—</span>;
  if (days < 0) {
    return (
      <Badge variant="danger" className="gap-1 rounded-full px-3 py-1 text-xs font-bold">
        <AlertTriangle className="w-3.5 h-3.5" />
        {daysLabel(days)}
      </Badge>
    );
  }
  if (days <= 30) {
    return (
      <Badge variant="warning" className="gap-1 rounded-full px-3 py-1 text-xs font-bold">
        <Clock className="w-3.5 h-3.5" />
        {daysLabel(days)}
      </Badge>
    );
  }
  if (days <= 90) {
    return (
      <Badge variant="info" className="gap-1 rounded-full px-3 py-1 text-xs font-bold">
        <Clock className="w-3.5 h-3.5" />
        {daysLabel(days)}
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="gap-1 rounded-full px-3 py-1 text-xs font-bold">
      <ShieldCheck className="w-3.5 h-3.5" />
      {daysLabel(days)}
    </Badge>
  );
}

const TONE_MAP = {
  primary:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   icon: 'bg-slate-500/15 text-slate-500',   dot: 'bg-slate-500',   text: 'text-slate-600 dark:text-slate-400' },
  success:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'bg-emerald-500/15 text-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  warning:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   icon: 'bg-amber-500/15 text-amber-500',   dot: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400' },
  danger:    { bg: 'bg-red-500/10',     border: 'border-red-500/30',     icon: 'bg-red-500/15 text-red-500',       dot: 'bg-red-500',     text: 'text-red-600 dark:text-red-400' },
  info:      { bg: 'bg-blue-500/10',    border: 'border-blue-500/30',    icon: 'bg-blue-500/15 text-blue-500',     dot: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400' },
  secondary: { bg: 'bg-zinc-500/10',    border: 'border-zinc-500/30',    icon: 'bg-zinc-500/15 text-zinc-500',     dot: 'bg-zinc-500',    text: 'text-zinc-600 dark:text-zinc-400' },
};

function KpiSummary({ items, activeFilter, setFilter }) {
  const expired = items.filter((i) => i.days_left != null && i.days_left < 0).length;
  const exp30 = items.filter((i) => i.days_left != null && i.days_left >= 0 && i.days_left <= 30).length;
  const exp90 = items.filter((i) => i.days_left != null && i.days_left > 30 && i.days_left <= 90).length;

  const kpis = [
    { key: "all", label: "Total Monitored", value: items.length, icon: FileText, tone: "primary" },
    { key: "expired", label: "Expired", value: expired, icon: AlertTriangle, tone: "danger" },
    { key: "exp30", label: "Expiring (≤ 30 Days)", value: exp30, icon: Clock, tone: "warning" },
    { key: "exp90", label: "Expiring (31–90 Days)", value: exp90, icon: ShieldCheck, tone: "info" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {kpis.map((k) => {
        const Icon = k.icon;
        const isActive = activeFilter === k.key;
        const t = TONE_MAP[k.tone] || TONE_MAP.primary;
        return (
          <button
            key={k.key}
            type="button"
            onClick={() => setFilter(isActive ? "all" : k.key)}
            className={cn(
              "relative p-4 rounded-3xl border-2 transition-all duration-200 text-left flex flex-col justify-between gap-3 cursor-pointer select-none overflow-hidden",
              isActive
                ? cn(t.border, t.bg, "shadow-md")
                : "border-border/60 bg-surface hover:shadow-sm hover:border-primary/40"
            )}
          >
            {/* label + icon */}
            <div className="flex items-start justify-between gap-2 mt-1">
              <span className="text-[11px] font-bold text-foreground-secondary uppercase tracking-wider leading-tight">{k.label}</span>
              <div className={cn("p-2 rounded-2xl shrink-0", t.icon)}>
                <Icon className="w-4 h-4" />
              </div>
            </div>

            {/* value */}
            <div>
              <div className="text-3xl font-bold text-foreground font-data leading-none">{k.value}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default function DocumentExpirationPage() {
  useRequireRole();
  const router = useRouter();
  const [tab, setTab] = useState("vehicle");
  const [docFilter, setDocFilter] = useState("all");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["documents-expiring"],
    queryFn: () => getExpiringDocuments(),
  });

  const items = useMemo(() => data?.items || [], [data]);
  const vehicleDocs = useMemo(
    () => items.filter((i) => i.driver_id == null).sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9)),
    [items]
  );
  const driverDocs = useMemo(
    () => items.filter((i) => i.driver_id != null).sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9)),
    [items]
  );

  const rawList = tab === "vehicle" ? vehicleDocs : driverDocs;

  const displayList = useMemo(() => {
    if (docFilter === "expired") {
      return rawList.filter((i) => i.days_left != null && i.days_left < 0);
    }
    if (docFilter === "exp30") {
      return rawList.filter((i) => i.days_left != null && i.days_left >= 0 && i.days_left <= 30);
    }
    if (docFilter === "exp90") {
      return rawList.filter((i) => i.days_left != null && i.days_left > 30 && i.days_left <= 90);
    }
    return rawList;
  }, [rawList, docFilter]);

  const vehicleColumns = [
    {
      key: "plate_number",
      label: "Plate #",
      sortable: true,
      render: (val) => (
        <span className="inline-flex items-center rounded-xl border border-border/80 bg-surface px-3 py-1.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
          {val || "—"}
        </span>
      ),
    },
    {
      key: "vehicle",
      label: "Vehicle",
      sortable: true,
      render: (val, row) => (
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 text-foreground border border-border/40 shadow-2xs">
            <Truck className="h-4.5 w-4.5" />
          </div>
          <div>
            <p className="font-bold text-sm text-foreground">{val || "Vehicle"}</p>
            <p className="text-xs text-foreground-muted font-medium">Vehicle document</p>
          </div>
        </div>
      ),
    },
    {
      key: "document_type",
      label: "Document",
      sortable: true,
      render: (val) => <span className="text-xs font-bold capitalize text-foreground">{val}</span>,
    },
    {
      key: "document_number",
      label: "Reference #",
      render: (val) => <span className="font-data text-xs font-bold text-foreground">{val || "—"}</span>,
    },
    {
      key: "expiry_date",
      label: "Expiry Date",
      sortable: true,
      render: (val) => (
        <span className="font-data font-bold text-xs text-foreground">
          {formatCalendarDate(val)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (_, row) => <ExpiryBadge days={row.days_left} />,
    },
    {
      key: "actions",
      label: "",
      render: (_, row) => (
        <div className="inline-flex items-center rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
          <Tooltip content="View Vehicle">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
              onClick={() => router.push(`/fleet/vehicles/${row.vehicle_id}`)}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  const driverColumns = [
    {
      key: "vehicle",
      label: "Driver Name",
      sortable: true,
      render: (val, row) => {
        const initials = val ? val.split(" ").map((n) => n[0]).join("").slice(0, 2) : "DR";
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted/60 font-black text-xs text-foreground border border-border/40 shadow-2xs">
              {initials}
            </div>
            <div>
              <p className="font-bold text-sm text-foreground">{val}</p>
              <p className="text-xs text-foreground-muted font-medium">Driver license document</p>
            </div>
          </div>
        );
      },
    },
    {
      key: "document_type",
      label: "Document",
      sortable: true,
      render: (val) => <span className="text-xs font-bold capitalize text-foreground">{val}</span>,
    },
    {
      key: "document_number",
      label: "License #",
      render: (val) => <span className="font-data text-xs font-bold text-foreground">{val || "—"}</span>,
    },
    {
      key: "expiry_date",
      label: "Expiry Date",
      sortable: true,
      render: (val) => (
        <span className="font-data font-bold text-xs text-foreground">
          {formatCalendarDate(val)}
        </span>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (_, row) => <ExpiryBadge days={row.days_left} />,
    },
    {
      key: "actions",
      label: "",
      render: (_, row) => (
        <div className="inline-flex items-center rounded-full border border-border/80 bg-surface p-1 shadow-2xs" onClick={(e) => e.stopPropagation()}>
          <Tooltip content="View Driver Profile">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
              onClick={() => router.push(`/drivers/${row.driver_id}`)}
            >
              <Eye className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Hero Header ── */}
      <HeroHeader
        icon={ShieldAlert}
        title="Document Expiration Center"
        badge="Compliance"
        description="Vehicle and driver documents approaching or past expiry."
      />

      {/* ── Error branch: one query feeds both tabs — say so, offer retry ── */}
      {isError ? (
        <DocumentErrorPanel onRetry={() => refetch()} busy={isRefetching} />
      ) : (
        <>
          {/* ── KPI Stat Summary Grid ── */}
          {isLoading ? (
            <div className="p-8 text-center text-sm text-foreground-muted">Loading metrics…</div>
          ) : (
            <KpiSummary items={items} activeFilter={docFilter} setFilter={setDocFilter} />
          )}

          {/* ── Tab Switcher Pill Buttons ── */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab("vehicle")}
              className={cn(
                "px-4 h-9 flex items-center justify-center gap-2 rounded-full text-xs font-bold border transition-all cursor-pointer",
                tab === "vehicle"
                  ? "bg-primary text-white dark:text-slate-950 border-primary shadow-2xs"
                  : "bg-surface text-foreground-secondary border-border/80 hover:border-primary/40"
              )}
            >
              <Truck className="w-3.5 h-3.5" /> Vehicle Documents ({vehicleDocs.length})
            </button>
            <button
              onClick={() => setTab("driver")}
              className={cn(
                "px-4 h-9 flex items-center justify-center gap-2 rounded-full text-xs font-bold border transition-all cursor-pointer",
                tab === "driver"
                  ? "bg-primary text-white dark:text-slate-950 border-primary shadow-2xs"
                  : "bg-surface text-foreground-secondary border-border/80 hover:border-primary/40"
              )}
            >
              <IdCard className="w-3.5 h-3.5" /> Driver Documents ({driverDocs.length})
            </button>
          </div>

          {/* ── DataTable Card ── */}
          <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
            <CardContent className="p-0">
              <DataTable
                columns={tab === "vehicle" ? vehicleColumns : driverColumns}
                data={displayList}
                pageSize={10}
                title={tab === "vehicle" ? "Vehicle Expiration Registry" : "Driver License Expiration Registry"}
                description={tab === "vehicle" ? "Monitor vehicle OR/CR, insurance, and registration expirations." : "Monitor driver license expirations and compliance status."}
                icon={tab === "vehicle" ? Truck : IdCard}
                context={tab === "vehicle" ? "Vehicle Docs" : "Driver Docs"}
                searchPlaceholder="Search documents by plate or name..."
                isLoading={isLoading}
                onRowClick={(row) =>
                  router.push(tab === "vehicle" ? `/fleet/vehicles/${row.vehicle_id}` : `/drivers/${row.driver_id}`)
                }
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
