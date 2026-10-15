"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { getMaintenanceRecords } from "@/services/maintenance.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";

const HISTORY_STATUSES = new Set(["Completed", "Cancelled"]);

function partsLabel(value) {
  let parts = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "Not recorded";
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) parts = parsed;
      } catch {
        return trimmed;
      }
    } else {
      return trimmed;
    }
  }
  if (!Array.isArray(parts)) return "Not recorded";

  const labels = parts.map((part) => {
    if (typeof part === "string") return part;
    const name = part?.name ?? part?.part_name ?? part?.part ?? "";
    if (!name) return part ? JSON.stringify(part) : "";
    const quantity = Number(part?.qty ?? part?.quantity);
    return Number.isFinite(quantity) && quantity > 0 ? `${name} × ${quantity}` : String(name);
  }).filter(Boolean);

  return labels.length ? labels.join(", ") : "Not recorded";
}

function HistoryRow({ row }) {
  const vehicle = row.vehicles ?? row.vehicle ?? {};
  const plate = vehicle.plate_number ?? `WO #${row.maintenance_id}`;
  const findings = row.diagnosis || row.description || row.remarks || "No findings recorded";

  return (
    <li className="border-b border-border/60 px-4 py-4 last:border-0 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/mechanic/work-orders/${row.maintenance_id}`}
            className="inline-flex min-h-[44px] items-center rounded-control text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {plate}
          </Link>
          <p className="text-xs text-foreground-secondary">
            {row.maintenance_type ?? "Maintenance"} · {formatDate(row.maintenance_date)} · Assigned to you
          </p>
        </div>
        <StatusBadge status={row.status} entity="maintenance" />
      </div>

      <dl className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Findings</dt>
          <dd className="mt-1 break-words text-sm text-foreground-secondary">{findings}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Parts</dt>
          <dd className="mt-1 break-words text-sm text-foreground-secondary">{partsLabel(row.parts_replaced)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Cost</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">
            {row.cost != null ? formatCurrency(row.cost) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Completed</dt>
          <dd className="mt-1 text-sm text-foreground-secondary">
            {row.completed_date ? formatDate(row.completed_date) : "—"}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export default function MechanicHistoryPage() {
  useRequireRole();
  const historyQuery = useQuery({
    queryKey: ["mechanicHistory"],
    queryFn: () => getMaintenanceRecords(),
    staleTime: 60 * 1000,
  });

  const all = Array.isArray(historyQuery.data)
    ? historyQuery.data
    : (historyQuery.data?.rows ?? []);
  const rows = all.filter((row) => HISTORY_STATUSES.has(row.status));

  return (
    <PageEntrance>
      <div className="space-y-4">
        <HeroHeader
          icon={ClipboardList}
          title="History"
          description={
            historyQuery.isLoading
              ? "Loading your history…"
              : `${rows.length} finished job${rows.length === 1 ? "" : "s"}`
          }
        />

        <QueryErrorBanner query={historyQuery} title="Could not load history" />

        {historyQuery.isLoading ? (
          <TableSkeleton rows={5} cols={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No finished jobs yet"
            description="Completed and cancelled work assigned to you will be listed here."
          />
        ) : (
          <Card className="overflow-hidden rounded-card border-border/70 shadow-sm">
            <CardContent className="p-0">
              <ul aria-label="Finished work orders" className="m-0 list-none p-0">
                {rows.map((row) => <HistoryRow key={row.maintenance_id} row={row} />)}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </PageEntrance>
  );
}
