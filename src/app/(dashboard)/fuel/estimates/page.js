"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api/client";
import { formatCurrency } from "@/lib/utils";
import { Fuel } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";

export function estimatesQueryString({ from, to, region = "", search = "" } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (String(region ?? "").trim()) params.set("region", String(region).trim());
  if (String(search ?? "").trim()) params.set("search", String(search).trim());
  const qs = params.toString();
  return qs ? `/api/fuel/estimates?${qs}` : "/api/fuel/estimates";
}

export function EstimateRows({ rows = [] }) {
  if (!rows.length) {
    return <EmptyState
      icon={Fuel}
      title="No estimates in range"
      description="Completed trips with locked fuel estimates will appear here."
      variant="filtered"
      size="compact"
    />;
  }
  return <div className="custom-scrollbar overflow-x-auto">
    <table className="w-full min-w-[980px] text-left text-sm">
      <caption className="sr-only">Trip fuel cost estimates</caption>
      <thead>
        <tr className="border-y border-border/70 bg-hover/40">
          {["Trip", "Vehicle", "Completed", "Distance", "Est. fuel", "Est. cost", "Price basis"].map((label, index) => (
            <th
              key={label}
              scope="col"
              className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted ${index > 2 ? "text-right" : "text-left"}`}
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.trip_id} className="border-b border-border/60 transition-colors hover:bg-hover/40 last:border-0">
            <td className="whitespace-nowrap px-4 py-4">
              <Link
                href={`/trips/${row.trip_id}`}
                className="inline-flex min-h-10 items-center rounded-md font-semibold text-foreground underline-offset-4 hover:text-foreground-secondary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Trip {row.trip_id}
              </Link>
            </td>
            <td className="px-4 py-4">
              <span className="font-semibold text-foreground">{row.plate_number}</span>
              <span className="mt-0.5 block text-xs text-foreground-secondary">{row.vehicle_name}</span>
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-foreground-secondary">
              {row.end_time ? new Date(row.end_time).toLocaleString() : "—"}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-right font-medium tabular-nums text-foreground">
              {row.actual_distance_km ?? "—"}{row.actual_distance_km != null ? <span className="ml-1 text-xs font-normal text-foreground-secondary">km</span> : null}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-right font-medium tabular-nums text-foreground">
              {row.estimated_fuel_l ?? "—"}{row.estimated_fuel_l != null ? <span className="ml-1 text-xs font-normal text-foreground-secondary">L</span> : null}
            </td>
            <td className="whitespace-nowrap px-4 py-4 text-right font-semibold tabular-nums text-foreground">
              {row.estimated_fuel_cost != null
                ? formatCurrency(row.estimated_fuel_cost)
                : <span className="font-medium text-warning-700">No estimate ({row.fuel_estimate_reason ?? "no price"})</span>}
            </td>
            <td className="px-4 py-4 text-right tabular-nums">
              {row.fuel_reference_price
                ? <><span className="whitespace-nowrap font-medium text-foreground">{formatCurrency(row.fuel_reference_price)} / L</span><span className="mt-0.5 block text-xs text-foreground-secondary">{row.fuel_region}</span></>
                : <span className="text-foreground-muted">—</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}

export default function FuelEstimatesPage() {
  useRequireRole();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [region, setRegion] = useState("");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "", region: "", search: "" });
  const estimates = useQuery({ queryKey: ["fuel-estimates", applied], queryFn: () => apiFetch(estimatesQueryString(applied)) });
  const totals = estimates.data?.totals ?? { trips: 0, estimated_cost: 0, estimated_liters: 0 };
  const dash = (value) => (!estimates.data && (estimates.isLoading || estimates.isError) ? "—" : value);
  const summary = [
    { label: "Estimated cost", value: dash(formatCurrency(totals.estimated_cost)) },
    { label: "Estimated liters", value: dash(`${Number(totals.estimated_liters).toFixed(1)} L`) },
    { label: "Completed trips", value: dash(totals.trips) },
    { label: "Average cost per trip", value: dash(formatCurrency(totals.trips ? totals.estimated_cost / totals.trips : 0)) },
  ];

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Fuel}
        title="Fuel estimates"
        badge="Monitoring"
        description="Per-trip fuel cost locked at completion, priced from verified reference prices."
      />

      <dl aria-label="Fuel estimate summary" className="grid grid-cols-2 gap-x-5 gap-y-5 rounded-2xl border border-border/80 bg-surface px-4 py-5 shadow-xs sm:grid-cols-4 sm:px-6">
        {summary.map(({ label, value }) => (
          <div key={label} className="min-w-0 space-y-1">
            <dt className="text-xs font-medium text-foreground-secondary">{label}</dt>
            <dd className="text-xl font-semibold tracking-tight tabular-nums text-foreground sm:text-2xl">{value}</dd>
          </div>
        ))}
      </dl>

      <Card className="overflow-hidden">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle>Completed trips</CardTitle>
          <p className="text-sm text-foreground-secondary">Review the estimate and price basis recorded for each trip.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <form
            className="grid gap-3 rounded-xl border border-border/70 bg-hover/30 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_minmax(10rem,1.25fr)_auto] xl:items-end"
            onSubmit={(event) => { event.preventDefault(); setApplied({ from, to, region, search }); }}
          >
            <div className="min-w-0 space-y-1.5"><Label htmlFor="est-from">From</Label><Input id="est-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="min-w-0 space-y-1.5"><Label htmlFor="est-to">To</Label><Input id="est-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <div className="min-w-0 space-y-1.5"><Label htmlFor="est-region">Region</Label><Input id="est-region" value={region} maxLength={100} placeholder="NCR" onChange={(e) => setRegion(e.target.value)} /></div>
            <div className="min-w-0 space-y-1.5"><Label htmlFor="est-search">Vehicle</Label><Input id="est-search" value={search} maxLength={60} placeholder="Plate or name" onChange={(e) => setSearch(e.target.value)} /></div>
            <Button type="submit" className="h-11 w-full sm:col-span-2 xl:col-span-1">Apply filters</Button>
          </form>

          {estimates.isLoading && !estimates.data ? (
            <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-sm text-foreground-secondary" role="status" aria-busy="true">
              Loading estimates…
            </div>
          ) : null}
          {estimates.isError ? (
            <QueryErrorBanner query={estimates} title="Fuel estimates could not be loaded" description="The latest results could not be loaded. Try again to refresh them." />
          ) : null}
          {estimates.data ? <EstimateRows rows={estimates.data.rows ?? []} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
