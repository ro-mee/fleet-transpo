"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { getVehicleMaintenance } from "@/services/maintenance.service";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { HeroHeader } from "@/components/ui/hero-header";
import { PageEntrance } from "@/components/ui/page-entrance";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { TableSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";

// History — Completed/Cancelled rows assigned to the mechanic. Cost is a
// READ-ONLY display here (never an input): the mechanic never writes it.
// Parts render from the lean projection (parts_replaced); only rows without
// parts data read "Not recorded".
const HISTORY_STATUSES = new Set(["Completed", "Cancelled"]);

export default function MechanicHistoryPage() {
  useRequireRole();
  const historyQuery = useQuery({
    queryKey: ["mechanicHistory"],
    queryFn: () => getVehicleMaintenance(),
    staleTime: 60 * 1000,
  });

  const all = Array.isArray(historyQuery.data)
    ? historyQuery.data
    : (historyQuery.data?.rows ?? []);
  const rows = all.filter((r) => HISTORY_STATUSES.has(r.status));

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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <caption className="sr-only">
                    Completed and cancelled work orders assigned to you
                  </caption>
                  <thead>
                    <tr className="border-b border-border bg-hover">
                      {["Date", "Type", "Findings", "Parts", "Cost", "Mechanic", "Completed"].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-foreground-muted"
                        >
                          {h}
                        </th>
                      ))}
                      <th scope="col" className="px-4 py-3 text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const plate =
                        row.vehicles?.plate_number ?? row.vehicle?.plate_number ?? `WO #${row.maintenance_id}`;
                      return (
                        <tr
                          key={row.maintenance_id}
                          className="border-b border-border/60 last:border-0 transition-colors duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-hover motion-reduce:transition-none"
                        >
                          <td className="whitespace-nowrap px-4 py-3 text-foreground">
                            {formatDate(row.maintenance_date)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="block font-semibold text-foreground">
                              {row.maintenance_type}
                            </span>
                            <a
                              href={`/mechanic/work-orders/${row.maintenance_id}`}
                              className="text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            >
                              {plate}
                            </a>
                          </td>
                          <td className="max-w-56 px-4 py-3 text-foreground-secondary">
                            <span className="block truncate">
                              {row.description || row.remarks || "No findings recorded"}
                            </span>
                          </td>
                          <td
                            className="px-4 py-3 text-foreground-muted"
                            title={Array.isArray(row.parts_replaced) && row.parts_replaced.length ? row.parts_replaced.join(", ") : "Parts data is not included in this view"}
                          >
                            {Array.isArray(row.parts_replaced) && row.parts_replaced.length
                              ? row.parts_replaced.join(", ")
                              : (typeof row.parts_replaced === "string" && row.parts_replaced.trim() ? row.parts_replaced : "Not recorded")}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-data font-semibold tabular-nums text-foreground">
                            {row.cost != null ? formatCurrency(row.cost) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground-secondary">
                            Assigned to you
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-foreground-secondary">
                            {row.completed_date ? formatDate(row.completed_date) : "—"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <StatusBadge status={row.status} entity="maintenance" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageEntrance>
  );
}
