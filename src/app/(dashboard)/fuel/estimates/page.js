"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorBanner } from "@/components/ui/query-feedback";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api/client";
import { collectPagedRows, exportToCSV } from "@/lib/export";
import { formatCalendarDate, formatManilaDateTime, manilaMonthRange, manilaTrailingRange } from "@/lib/dates";
import { cn, formatCurrency } from "@/lib/utils";
import { BadgePercent, Fuel, Gauge, Receipt, Route, Wallet } from "lucide-react";
import { useRequireRole } from "@/lib/auth/role-guard";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { REFERENCE_PRICE_STALE_AFTER_DAYS } from "@/lib/fuel/price-policy";

// Recharts SVG takes raw values, not Tailwind classes; the same CSS vars as
// the fuel analytics charts keep both screens consistent.
const chartTooltipStyle = {
  background: "var(--sf)",
  border: "1px solid var(--br)",
  borderRadius: "12px",
  fontSize: "12px",
};

export function estimatesQueryString({ from, to, region = "", search = "", page = null } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (String(region ?? "").trim()) params.set("region", String(region).trim());
  if (String(search ?? "").trim()) params.set("search", String(search).trim());
  // Page 1 is the default; only export walks pass a page.
  if (page != null && Number(page) > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/api/fuel/estimates?${qs}` : "/api/fuel/estimates";
}

// Rows captured before the estimate columns existed (2026-09) must not be read
// as "no price": the estimate was never attempted and the honest label is
// "Not captured". Anything with a capture timestamp has a real reason code.
const MISSING_REASON_LABELS = {
  "no-price": "no reference price",
  "no-distance": "no distance",
  "no-efficiency": "no efficiency",
  "out-of-range": "value out of range",
};

export function estimateMissingLabel(row) {
  if (!row || row.fuel_estimate_captured_at == null) return "Not captured";
  return MISSING_REASON_LABELS[row.fuel_estimate_reason] ?? "unavailable";
}

// The distance a completion used, in the words the rest of the app uses.
// Unknown keys render as themselves rather than being guessed at.
export const PROVENANCE_LABELS = {
  "odometer": "Odometer",
  "trip-distance": "Reported",
  "gps-trail": "GPS trail",
};

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

/** Actual − planned, or null when either side is missing (never 0-as-unknown). */
export function plannedDelta(actual, planned) {
  const a = numberOrNull(actual);
  const p = numberOrNull(planned);
  if (a === null || p === null) return null;
  return a - p;
}

/** Estimate − receipt, or null when either side is missing (never 0-as-unknown). */
export function receiptDelta(estimated, receipt) {
  const e = numberOrNull(estimated);
  const r = numberOrNull(receipt);
  if (e === null || r === null) return null;
  return e - r;
}

/** Recharts rows for the daily cost series: "Oct 3" labels from the Manila day. */
export function dailyChartData(daily = []) {
  return (Array.isArray(daily) ? daily : []).map((entry) => ({
    day: entry.day,
    label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      .format(new Date(`${entry.day}T00:00:00Z`)),
    cost: numberOrNull(entry.estimated_cost),
    liters: numberOrNull(entry.estimated_liters),
    trips: Number(entry.trips) || 0,
    pricedTrips: Number(entry.priced_trips) || 0,
  }));
}

/**
 * Preset ranges for the filter chips, anchored on the Manila calendar.
 * "This month" is the same fixed range the API defaults to (FE-01).
 */
export function estimatePresets(reference = new Date()) {
  return [
    { id: "this-month", label: "This month", range: manilaMonthRange(0, reference) },
    { id: "last-month", label: "Last month", range: manilaMonthRange(-1, reference) },
    { id: "last-30", label: "Last 30 days", range: manilaTrailingRange(30, reference) },
  ];
}

/** "October 2026" for a whole month, "Oct 1, 2026 – Oct 15, 2026" otherwise. */
export function describeRange(from, to) {
  if (!from || !to) return "—";
  const [year, month] = from.split("-").map(Number);
  if (/^\d{4}-\d{2}-01$/.test(from)) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (to === `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`) {
      return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
        .format(new Date(Date.UTC(year, month - 1, 1)));
    }
  }
  return `${formatCalendarDate(from)} – ${formatCalendarDate(to)}`;
}

/** Flatten rows for the CSV, keeping the table's labels and null-safety. */
export function estimateExportRows(rows = []) {
  return rows.map((row) => {
    const fuelDelta = plannedDelta(row.estimated_fuel_l, row.planned_estimated_fuel_l);
    const costDelta = plannedDelta(row.estimated_fuel_cost, row.planned_estimated_fuel_cost);
    const receiptFuelDelta = receiptDelta(row.estimated_fuel_l, row.actual_fuel_l);
    const receiptCostDelta = receiptDelta(row.estimated_fuel_cost, row.actual_cost);
    return {
      trip: `Trip ${row.trip_id}`,
      plate_number: row.plate_number ?? "",
      vehicle_name: row.vehicle_name ?? "",
      completed: formatManilaDateTime(row.end_time, ""),
      distance_km: numberOrNull(row.actual_distance_km) ?? "",
      distance_provenance: PROVENANCE_LABELS[row.distance_provenance] ?? row.distance_provenance ?? "",
      planned_fuel_l: numberOrNull(row.planned_estimated_fuel_l) ?? "",
      planned_cost: numberOrNull(row.planned_estimated_fuel_cost) ?? "",
      estimated_fuel_l: numberOrNull(row.estimated_fuel_l) ?? "",
      estimated_cost: numberOrNull(row.estimated_fuel_cost) ?? "",
      delta_fuel_l: fuelDelta == null ? "" : Number(fuelDelta.toFixed(3)),
      delta_cost: costDelta == null ? "" : Number(costDelta.toFixed(2)),
      receipt_fuel_l: numberOrNull(row.actual_fuel_l) ?? "",
      receipt_cost: numberOrNull(row.actual_cost) ?? "",
      delta_receipt_fuel_l: receiptFuelDelta == null ? "" : Number(receiptFuelDelta.toFixed(3)),
      delta_receipt_cost: receiptCostDelta == null ? "" : Number(receiptCostDelta.toFixed(2)),
      price_per_l: numberOrNull(row.fuel_reference_price) ?? "",
      region: row.fuel_region ?? "",
      price_effective_at: formatManilaDateTime(row.effective_at, ""),
      price_age_days: row.price_age_days ?? "",
      stale_reference: row.price_stale ? "Yes" : "",
      source_url: row.source_url ?? "",
      status: row.estimated_fuel_cost != null ? "Priced" : `No cost (${estimateMissingLabel(row)})`,
    };
  });
}

export const ESTIMATE_EXPORT_COLUMNS = [
  { label: "Trip", key: "trip" },
  { label: "Plate", key: "plate_number" },
  { label: "Vehicle", key: "vehicle_name" },
  { label: "Completed (Manila)", key: "completed" },
  { label: "Distance (km)", key: "distance_km" },
  { label: "Distance source", key: "distance_provenance" },
  { label: "Planned fuel (L)", key: "planned_fuel_l" },
  { label: "Planned cost", key: "planned_cost" },
  { label: "Estimated fuel (L)", key: "estimated_fuel_l" },
  { label: "Estimated cost", key: "estimated_cost" },
  { label: "Delta fuel (L)", key: "delta_fuel_l" },
  { label: "Delta cost", key: "delta_cost" },
  { label: "Receipt fuel (L)", key: "receipt_fuel_l" },
  { label: "Receipt cost", key: "receipt_cost" },
  { label: "Delta vs receipt (L)", key: "delta_receipt_fuel_l" },
  { label: "Delta vs receipt cost", key: "delta_receipt_cost" },
  { label: "Price per L", key: "price_per_l" },
  { label: "Region", key: "region" },
  { label: "Price effective", key: "price_effective_at" },
  { label: "Price age (days)", key: "price_age_days" },
  { label: "Stale reference", key: "stale_reference" },
  { label: "Source URL", key: "source_url" },
  { label: "Status", key: "status" },
];

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
  return <div
    role="region"
    aria-label="Trip fuel estimates. Scroll horizontally to see all columns."
    tabIndex={0}
    className="custom-scrollbar overflow-x-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
  >
    <table className="w-full min-w-[1320px] text-left text-sm font-data tabular-nums">
      <caption className="sr-only">Trip fuel cost estimates</caption>
      <thead>
        <tr className="border-y border-border/70 bg-hover/40">
          {["Trip", "Vehicle", "Completed", "Distance", "Planned", "Est. fuel", "Δ vs planned", "Est. cost", "Receipt", "Δ vs receipt", "Price basis"].map((label, index) => (
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
        {rows.map((row) => {
          const fuelDelta = plannedDelta(row.estimated_fuel_l, row.planned_estimated_fuel_l);
          const costDelta = plannedDelta(row.estimated_fuel_cost, row.planned_estimated_fuel_cost);
          const receiptFuelDelta = receiptDelta(row.estimated_fuel_l, row.actual_fuel_l);
          const receiptCostDelta = receiptDelta(row.estimated_fuel_cost, row.actual_cost);
          const receiptCount = Number(row.actual_receipt_count) || 0;
          return (
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
              {/* Manila wall clock (FE-16): the viewer's zone must not shift the
                  day a trip completed. */}
              <td className="whitespace-nowrap px-4 py-4 text-foreground-secondary">
                {formatManilaDateTime(row.end_time)}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-right font-medium tabular-nums text-foreground">
                {row.actual_distance_km ?? "—"}{row.actual_distance_km != null ? <span className="ml-1 text-xs font-normal text-foreground-secondary">km</span> : null}
                {row.distance_provenance ? (
                  <span className="mt-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                    {PROVENANCE_LABELS[row.distance_provenance] ?? row.distance_provenance}
                  </span>
                ) : null}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                {row.planned_estimated_fuel_l == null && row.planned_estimated_fuel_cost == null ? (
                  <span className="text-foreground-muted">—</span>
                ) : (
                  <>
                    {row.planned_estimated_fuel_l != null ? <span className="block font-medium text-foreground">{row.planned_estimated_fuel_l} L</span> : null}
                    {row.planned_estimated_fuel_cost != null ? <span className="mt-0.5 block text-xs text-foreground-secondary">{formatCurrency(row.planned_estimated_fuel_cost)}</span> : null}
                  </>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-right font-medium tabular-nums text-foreground">
                {row.estimated_fuel_l ?? "—"}{row.estimated_fuel_l != null ? <span className="ml-1 text-xs font-normal text-foreground-secondary">L</span> : null}
              </td>
              {/* Null-safe: a missing planned or actual value renders "—", never
                  a delta computed against an unknown. */}
              <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                {fuelDelta == null && costDelta == null ? (
                  <span className="text-foreground-muted">—</span>
                ) : (
                  <>
                    {fuelDelta != null ? <span className="block text-foreground-secondary">{fuelDelta.toFixed(2)} L</span> : null}
                    {costDelta != null ? <span className="mt-0.5 block text-xs text-foreground-secondary">{formatCurrency(costDelta)}</span> : null}
                  </>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-right font-semibold tabular-nums text-foreground">
                {row.estimated_fuel_cost != null
                  ? formatCurrency(row.estimated_fuel_cost)
                  : <span className="font-medium text-warning-700">No cost ({estimateMissingLabel(row)})</span>}
              </td>
              {/* FE-19: verified receipts linked to the trip, summed — an
                  absent receipt is an em dash, never a fabricated 0. */}
              <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                {receiptCount > 0 ? (
                  <>
                    {row.actual_fuel_l != null ? <span className="block font-medium text-foreground">{row.actual_fuel_l} L</span> : null}
                    {row.actual_cost != null ? <span className="mt-0.5 block text-xs text-foreground-secondary">{formatCurrency(row.actual_cost)}</span> : null}
                    <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {receiptCount} receipt{receiptCount === 1 ? "" : "s"}
                    </span>
                  </>
                ) : (
                  <span className="text-foreground-muted">—</span>
                )}
              </td>
              {/* Estimate − receipt; null-safe like the planned delta. */}
              <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums">
                {receiptFuelDelta == null && receiptCostDelta == null ? (
                  <span className="text-foreground-muted">—</span>
                ) : (
                  <>
                    {receiptFuelDelta != null ? <span className="block text-foreground-secondary">{receiptFuelDelta.toFixed(2)} L</span> : null}
                    {receiptCostDelta != null ? <span className="mt-0.5 block text-xs text-foreground-secondary">{formatCurrency(receiptCostDelta)}</span> : null}
                  </>
                )}
              </td>
              <td className="px-4 py-4 text-right tabular-nums">
                {row.fuel_reference_price ? (
                  <>
                    <span className="whitespace-nowrap font-medium text-foreground">{formatCurrency(row.fuel_reference_price)} / L</span>
                    <span className="mt-0.5 block text-xs text-foreground-secondary">{row.fuel_region}</span>
                    {row.effective_at ? <span className="mt-0.5 block text-xs text-foreground-secondary">Effective {formatManilaDateTime(row.effective_at)}{row.verification_method ? ` · ${row.verification_method}` : ""}</span> : null}
                    {row.source_url ? (
                      <a
                        href={row.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                      >
                        Source ↗
                      </a>
                    ) : null}
                    {/* FE-11: the reference was already older than the horizon
                        when it priced this trip. A label, never a repricing. */}
                    {row.price_stale ? (
                      <span className="mt-1 block">
                        <span className="inline-flex items-center rounded-full border border-warning-700/40 bg-warning-700/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-700">
                          Stale reference
                        </span>
                        {row.price_age_days != null && Number(row.price_age_days) >= 0 ? (
                          <span className="ml-1 text-xs text-foreground-secondary">{row.price_age_days} d old</span>
                        ) : null}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-foreground-muted">—</span>
                )}
              </td>
            </tr>
          );
        })}
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
  const [exporting, setExporting] = useState(false);
  const [showDailyData, setShowDailyData] = useState(false);
  const estimates = useQuery({ queryKey: ["fuel-estimates", applied], queryFn: () => apiFetch(estimatesQueryString(applied)) });

  // The vehicle search applies itself after a pause: one request per quiet
  // keystroke-burst instead of one per character. Dates and region still go
  // through Apply, where a half-picked range must not fire.
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied((prev) => (prev.search === search ? prev : { ...prev, search }));
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const totals = estimates.data?.totals ?? {};
  const dash = (value) => (!estimates.data && (estimates.isLoading || estimates.isError) ? "—" : value);
  const tripCount = Number(totals.trips) || 0;
  const pricedTrips = Number(totals.priced_trips) || 0;
  const literedTrips = Number(totals.litered_trips) || 0;
  const estimatedCost = Number(totals.estimated_cost) || 0;
  const estimatedLiters = Number(totals.estimated_liters) || 0;
  const litersDistanceKm = Number(totals.liters_distance_km) || 0;
  const litersWithDistance = Number(totals.liters_with_distance) || 0;
  const pricedDistanceKm = Number(totals.priced_distance_km) || 0;
  const pricedCostWithDistance = Number(totals.priced_cost_with_distance) || 0;
  const coveragePct = tripCount ? Math.round((pricedTrips / tripCount) * 100) : 0;
  const stalePricedTrips = Number(totals.stale_priced_trips) || 0;
  const measured = estimates.data?.measured ?? null;
  const daily = dailyChartData(estimates.data?.daily ?? []);
  const unpricedDays = daily.filter((entry) => entry.cost == null).length;
  // Ratios divide filtered SQL sums, so the denominator is always the km that
  // belongs to the same numerator (see the route's aggregate comment).
  const costPerKm = pricedDistanceKm > 0 ? pricedCostWithDistance / pricedDistanceKm : null;
  const litersPer100km = litersDistanceKm > 0 ? (litersWithDistance / litersDistanceKm) * 100 : null;
  const km = (value) => `${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 1 })} km`;

  const rangeCaption = estimates.data ? describeRange(estimates.data.from, estimates.data.to) : "—";
  const presets = estimatePresets();
  const activePresetId = presets.find((preset) =>
    (applied.from === preset.range.from && applied.to === preset.range.to)
    || (!applied.from && !applied.to && preset.id === "this-month")
  )?.id;
  const regions = estimates.data?.regions ?? [];
  const regionOptions = region && !regions.includes(region) ? [region, ...regions] : regions;

  const handleExport = async () => {
    setExporting(true);
    try {
      // The CSV must hold every trip in the applied range, not just the 500
      // rows on screen — so walk the endpoint's pages.
      const rows = await collectPagedRows((page) => apiFetch(estimatesQueryString({ ...applied, page })), { pageSize: 500 });
      const result = exportToCSV(estimateExportRows(rows), "fuel-estimates", ESTIMATE_EXPORT_COLUMNS);
      if (!result.count) toast.warning("Nothing to export for these filters.");
      else toast.success(`Exported ${result.count} trip estimates.`);
    } catch (error) {
      toast.warning(error?.message || "The export could not be completed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <HeroHeader
        icon={Fuel}
        title="Fuel estimates"
        badge="Monitoring"
        description="Per-trip fuel cost locked at completion, priced from verified reference prices."
      />

      <StatGrid cols={3} className="[&_.kpi-stat-card>div:last-child>div]:flex-wrap [&_.kpi-stat-card_p]:font-data">
        <StatCard
          icon={Wallet}
          label="Estimated cost"
          value={dash(formatCurrency(estimatedCost))}
          valueNote={dash(`${pricedTrips} of ${tripCount} priced`)}
          trend="Locked at trip completion from verified reference prices"
          tone="primary"
        />
        <StatCard
          icon={Fuel}
          label="Estimated litres"
          value={dash(`${estimatedLiters.toFixed(1)} L`)}
          valueNote={dash(`${literedTrips} of ${tripCount} trips`)}
          trend="Litres are computed from distance and efficiency, never from price"
          tone="info"
        />
        <StatCard
          icon={BadgePercent}
          label="Priced coverage"
          value={dash(`${coveragePct}%`)}
          valueNote={dash(`${pricedTrips} of ${tripCount}`)}
          trend="Trips with a locked cost over all completed trips"
          tone={!tripCount ? "neutral" : pricedTrips < tripCount ? "warning" : "success"}
        />
        <StatCard
          icon={Receipt}
          label="Average cost per priced trip"
          value={dash(pricedTrips ? formatCurrency(estimatedCost / pricedTrips) : "—")}
          valueNote={dash(`over ${pricedTrips} priced trip${pricedTrips === 1 ? "" : "s"}`)}
          trend="Averaged over priced trips only, never diluted by unpriced ones"
          tone="neutral"
        />
        <StatCard
          icon={Route}
          label="Cost per km"
          value={dash(costPerKm == null ? "—" : formatCurrency(costPerKm))}
          valueNote={dash(costPerKm == null ? "no priced distance" : `over ${km(pricedDistanceKm)}`)}
          trend="Priced cost divided by the distance those same trips ran"
          tone="neutral"
        />
        <StatCard
          icon={Gauge}
          label="Fuel per 100 km"
          value={dash(litersPer100km == null ? "—" : `${litersPer100km.toFixed(1)} L`)}
          valueNote={dash(litersPer100km == null ? "no estimated distance" : `estimated over ${km(litersDistanceKm)}`)}
          trend="Estimated litres per distance with a recorded estimate"
          tone="neutral"
        />
      </StatGrid>

      {/* Level 3 read-out (read-only): the official measured caliber from the
          Reports service, shown so the estimate KPIs above can be sanity-
          checked — the locked estimates keep their configured profiles. */}
      {measured ? (
        <div role="status" className="space-y-2 rounded-xl border border-border/70 bg-hover/30 p-4 text-sm text-foreground-secondary">
          <p><span className="font-semibold text-foreground">Measured efficiency (fleet-wide period): </span>
          {measured.efficiency_kmpl != null ? (
            <>
              <span className="font-data font-semibold text-foreground">{Number(measured.efficiency_kmpl).toFixed(1)} km/L</span> — {km(measured.distance_km)} of completed trips ÷ {Number(measured.liters).toLocaleString("en-PH", { maximumFractionDigits: 1 })} L of verified receipts.
            </>
          ) : (
            <>insufficient data — needs at least {measured.min_distance_km} km of completed trips with verified receipts.</>
          )}</p>
          <p className="text-xs leading-relaxed">Read-only reference from Reports for the selected dates across all vehicles and regions. Region and vehicle filters do not change this reference. The locked estimates above keep their configured profiles; a vehicle&apos;s request forecast may instead run on its own 90-day measured basis once that vehicle clears at least 100 km over at least 3 receipts.</p>
        </div>
      ) : null}

      {daily.length ? (
        <Card className="overflow-hidden">
          <CardHeader className="space-y-1 pb-2">
            <CardTitle>Cost per day</CardTitle>
            <p className="text-sm text-foreground-secondary">Locked estimate cost by completion day (Manila).</p>
          </CardHeader>
          <CardContent>
            <div className="chart-h-md w-full" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer={false}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--br)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--fg-muted)" }} />
                  <YAxis tickLine={false} axisLine={false} width={80} tick={{ fontSize: 12, fill: "var(--fg-muted)" }} tickFormatter={(value) => `₱${Number(value).toLocaleString("en-PH")}`} />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(value) => [formatCurrency(value), "Estimated cost"]}
                    labelFormatter={(label, payload) => {
                      const entry = payload?.[0]?.payload;
                      return entry ? `${formatCalendarDate(entry.day)} · ${entry.pricedTrips} of ${entry.trips} trips priced` : label;
                    }}
                  />
                  <Bar dataKey="cost" name="Estimated cost" fill="var(--primary)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div
              id="daily-estimate-data"
              role={showDailyData ? "region" : undefined}
              aria-label={showDailyData ? "Daily fuel estimates. Scroll to see all values." : undefined}
              tabIndex={showDailyData ? 0 : undefined}
              className={showDailyData ? "custom-scrollbar mt-3 max-h-64 overflow-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2" : "sr-only"}
            >
              <table className="w-full min-w-[420px] text-left text-xs font-data tabular-nums [&_th]:p-2 [&_td]:p-2 [&_tr]:border-b [&_tr]:border-border/60">
                <caption>Daily estimated cost and priced coverage</caption>
                <thead><tr><th scope="col">Completion day (Manila)</th><th scope="col">Estimated cost</th><th scope="col">Trips priced</th></tr></thead>
                <tbody>{daily.map((entry) => (
                  <tr key={entry.day}>
                    <th scope="row">{formatCalendarDate(entry.day)}</th>
                    <td>{entry.cost == null ? "Unavailable" : formatCurrency(entry.cost)}</td>
                    <td>{entry.pricedTrips} of {entry.trips}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-foreground-secondary">Daily totals include priced trips only. Missing costs are unavailable, rather than zero. View daily totals for priced coverage, or review each trip below for its saved basis.</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" aria-expanded={showDailyData} aria-controls="daily-estimate-data" onClick={() => setShowDailyData((shown) => !shown)}>
              {showDailyData ? "Hide daily totals" : "View daily totals"}
            </Button>
            {unpricedDays > 0 ? <p role="status" className="mt-2 text-sm text-warning-700">{unpricedDays} {unpricedDays === 1 ? "day has" : "days have"} no priced trips. No cost bar is shown for {unpricedDays === 1 ? "that day" : "those days"}.</p> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-col items-start justify-between gap-3 space-y-0 pb-4 sm:flex-row">
          <div className="space-y-1">
            <CardTitle>Completed trips</CardTitle>
            <p className="text-sm text-foreground-secondary">Review the estimate and price basis recorded for each trip.</p>
            <p className="text-xs text-foreground-muted" role="status">Showing {rangeCaption}</p>
          </div>
          <Button type="button" variant="outline" className="w-full shrink-0 sm:w-auto" onClick={handleExport} disabled={exporting || !estimates.data || estimates.isFetching}>
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                aria-pressed={activePresetId === preset.id}
                onClick={() => {
                  setFrom(preset.range.from);
                  setTo(preset.range.to);
                  setApplied((prev) => ({ ...prev, from: preset.range.from, to: preset.range.to }));
                }}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                  activePresetId === preset.id
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-surface text-foreground-secondary hover:border-primary/40"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <form
            className="grid gap-3 rounded-xl border border-border/70 bg-hover/30 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(8rem,1fr)_minmax(10rem,1.25fr)_auto] xl:items-end"
            onSubmit={(event) => { event.preventDefault(); setApplied({ from, to, region, search }); }}
          >
            <DatePicker id="est-from" label="From" placeholder="From date" value={from} onChange={setFrom} maxDate={to || null} />
            <DatePicker id="est-to" label="To" placeholder="To date" value={to} onChange={setTo} minDate={from || null} />
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="est-region">Region</Label>
              <Select value={region || "all"} onValueChange={(value) => setRegion(value === "all" ? "" : value)}>
                <SelectTrigger id="est-region" aria-label="Region filter">
                  <span className="truncate">{region || "All regions"}</span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All regions</SelectItem>
                  {regionOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5"><Label htmlFor="est-search">Vehicle</Label><Input id="est-search" value={search} maxLength={60} placeholder="Plate or name" onChange={(e) => setSearch(e.target.value)} /></div>
            <Button type="submit" className="h-11 w-full sm:col-span-2 xl:col-span-1">Apply filters</Button>
          </form>

          {stalePricedTrips > 0 ? (
            <p role="status" className="rounded-lg border border-warning-700/30 bg-warning-700/10 px-3 py-2 text-sm font-medium text-warning-700">
              {stalePricedTrips} priced trip{stalePricedTrips === 1 ? "" : "s"} used a reference older than {REFERENCE_PRICE_STALE_AFTER_DAYS} days. Flagged in the Price basis column.
            </p>
          ) : null}

          {estimates.data?.truncated ? (
            <p role="status" className="rounded-lg border border-warning-700/30 bg-warning-700/10 px-3 py-2 text-sm font-medium text-warning-700">
              Showing the latest 500 of {Number(estimates.data.totals?.trips) || 0} completed trips. Narrow the date range to review the rest.
            </p>
          ) : null}

          {estimates.isLoading && !estimates.data ? (
            <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-sm text-foreground-secondary" role="status" aria-busy="true">
              Loading estimates…
            </div>
          ) : null}
          {estimates.isError ? (
            <QueryErrorBanner query={estimates} title="Fuel estimates could not be loaded" description="The latest results could not be loaded. Try again to refresh them." />
          ) : null}
          {estimates.data?.rows?.length ? <p className="text-xs leading-relaxed text-foreground-secondary">Δ vs planned = estimate − plan. Δ vs receipt = estimate − verified fuel purchases. Purchases are not measured trip consumption. A dash means a comparison is unavailable.</p> : null}
          {estimates.data ? <EstimateRows rows={estimates.data.rows ?? []} /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
