"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import Link from "next/link";
import { getExpiringDocuments } from "@/services/vehicle.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatsGridSkeleton } from "@/components/ui/skeleton";
import { FileText, AlertTriangle, Clock, ShieldCheck, Truck, IdCard } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { cn } from "@/lib/utils";

function daysLabel(days) {
  if (days == null) return "No expiry";
  if (days < 0) return `${Math.abs(days)} days expired`;
  if (days === 0) return "Expires today";
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function ExpiryBadge({ days }) {
  if (days == null) return <Badge variant="secondary">No expiry</Badge>;
  if (days < 0) return <Badge variant="danger">Expired</Badge>;
  if (days <= 30) return <Badge variant="warning">{daysLabel(days)}</Badge>;
  if (days <= 90) return <Badge variant="info">{daysLabel(days)}</Badge>;
  return <Badge variant="success">{daysLabel(days)}</Badge>;
}

function KpiSummary({ list, activeFilter, onSelectFilter }) {
  const expired = list.filter((i) => i.days_left != null && i.days_left < 0).length;
  const exp30 = list.filter((i) => i.days_left != null && i.days_left >= 0 && i.days_left <= 30).length;
  const exp90 = list.filter((i) => i.days_left != null && i.days_left > 30 && i.days_left <= 90).length;

  const kpis = [
    {
      id: "all",
      label: "Total Documents",
      value: list.length,
      icon: FileText,
      tone: "primary",
      active: activeFilter === "all",
      onClick: () => onSelectFilter(activeFilter === "all" ? "all" : "all"),
    },
    {
      id: "expired",
      label: "Expired",
      value: expired,
      icon: AlertTriangle,
      tone: "danger",
      active: activeFilter === "expired",
      onClick: () => onSelectFilter(activeFilter === "expired" ? "all" : "expired"),
    },
    {
      id: "exp30",
      label: "Expiring in 30 days",
      value: exp30,
      icon: Clock,
      tone: "warning",
      active: activeFilter === "exp30",
      onClick: () => onSelectFilter(activeFilter === "exp30" ? "all" : "exp30"),
    },
    {
      id: "exp90",
      label: "Expiring in 90 days",
      value: exp90,
      icon: ShieldCheck,
      tone: "info",
      active: activeFilter === "exp90",
      onClick: () => onSelectFilter(activeFilter === "exp90" ? "all" : "exp90"),
    },
  ];

  return (
    <StatGrid cols={4}>
      {kpis.map((k) => (
        <StatCard
          key={k.id}
          icon={k.icon}
          label={k.label}
          value={k.value}
          tone={k.tone}
          active={k.active}
          onClick={k.onClick}
        />
      ))}
    </StatGrid>
  );
}

function DocumentTable({ rows, type }) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={type === "driver" ? IdCard : Truck}
        title={type === "driver" ? "No driver documents" : "No vehicle documents"}
        description={type === "driver" ? "Driver license expirations will appear here." : "Vehicle registrations, OR/CR and insurance expirations will appear here."}
        className="py-16"
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-foreground-muted">
            <th className="px-5 py-3 font-medium">{type === "driver" ? "Driver" : "Vehicle"}</th>
            <th className="px-5 py-3 font-medium">Document</th>
            <th className="px-5 py-3 font-medium">Reference #</th>
            <th className="px-5 py-3 font-medium">Expiry Date</th>
            <th className="px-5 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={`${r.vehicle_id || r.driver_id || "doc"}-${r.document_type}-${i}`} className="hover:bg-hover transition-colors">
              <td className="px-5 py-3">
                {type === "driver" ? (
                  <Link href={`/drivers/${r.driver_id}`} className="font-medium text-foreground hover:underline">
                    {r.vehicle}
                  </Link>
                ) : (
                  <>
                    <Link href={`/fleet/vehicles/${r.vehicle_id}`} className="font-medium text-foreground hover:underline">
                      {r.plate_number}
                    </Link>
                    <div className="text-xs text-foreground-muted">{r.vehicle || "—"}</div>
                  </>
                )}
              </td>
              <td className="px-5 py-3 text-foreground capitalize">{r.document_type}</td>
              <td className="px-5 py-3 text-foreground-muted">{r.document_number || "—"}</td>
              <td className="px-5 py-3 text-foreground">
                {r.expiry_date ? new Date(r.expiry_date).toISOString().slice(0, 10) : "—"}
              </td>
              <td className="px-5 py-3"><ExpiryBadge days={r.days_left} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DocumentExpirationPage() {
  useRequireRole(["admin", "system_admin", "fleet_manager"]);
  const [tab, setTab] = useState("vehicle");
  const [docFilter, setDocFilter] = useState("all");

  const { data, isLoading, isError, error, refetch } = useQuery({
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

  const tabs = [
    { key: "vehicle", label: "Vehicle Documents", icon: Truck },
    { key: "driver", label: "Driver Documents", icon: IdCard },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Document Expiration Center" description="Vehicle and driver documents approaching or past expiry." />

      {isLoading ? (
        <StatsGridSkeleton count={4} gridClass="md:grid-cols-2 lg:grid-cols-4" />
      ) : (
        <KpiSummary
          list={rawList}
          activeFilter={docFilter}
          onSelectFilter={(filterKey) => setDocFilter(filterKey)}
        />
      )}

      <div className="flex gap-1 rounded-lg bg-hover p-1 w-fit">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setDocFilter("all");
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
              tab === t.key ? "bg-surface text-foreground shadow-sm" : "text-foreground-muted hover:text-foreground"
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>{tab === "vehicle" ? "Vehicle Documents" : "Driver Documents"}</span>
            {docFilter !== "all" && (
              <span className="text-xs font-normal text-foreground-muted">
                Filtered: <span className="font-semibold text-primary capitalize">{docFilter === "exp30" ? "Expiring in 30 days" : docFilter === "exp90" ? "Expiring in 90 days" : docFilter}</span>
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-foreground-muted">Loading…</div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-foreground-secondary">
              Could not load document data.{" "}
              <button onClick={() => refetch()} className="text-primary hover:underline">
                Retry
              </button>
            </div>
          ) : (
            <DocumentTable rows={displayList} type={tab} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
