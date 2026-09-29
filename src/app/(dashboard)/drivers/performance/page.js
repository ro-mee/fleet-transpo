"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDriverPerformanceReport } from "@/services/report.service";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeroHeader } from "@/components/ui/hero-header";
import { DataTable } from "@/components/tables/data-table";
import { DriverAvatar } from "@/components/drivers/driver-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { CHART_COLORS } from "@/lib/chart-tokens";
import { cn } from "@/lib/utils";
import { useRequireRole } from "@/lib/auth/role-guard";
import { useRouter } from "next/navigation";
import { AlertTriangle, Award, CheckCircle2, Clock, Eye, Gauge, MinusCircle, RefreshCw } from "lucide-react";

// Reporting periods. `all` reproduces the report API's own default window so
// the selector can express "no date filter" without a second code path.
const PRESETS = [
  { id: "30d", label: "Last 30 Days" },
  { id: "90d", label: "Last 90 Days" },
  { id: "year", label: "This Year" },
  { id: "all", label: "All Time" },
];

// Local-calendar "YYYY-MM-DD". `.toISOString().slice(0, 10)` re-reads the wall
// clock in UTC and silently drops "today" for UTC+8 mornings — en-CA formats in
// the *local* zone while keeping the ISO date shape.
function toLocalDay(date) {
  return date.toLocaleDateString("en-CA");
}

export function resolvePresetRange(preset) {
  const now = new Date();
  const to = toLocalDay(now);
  if (preset === "all") return { from: "1970-01-01", to: "2100-01-01" };
  if (preset === "year") return { from: `${now.getFullYear()}-01-01`, to };
  const start = new Date(now);
  start.setDate(start.getDate() - (preset === "90d" ? 90 : 30));
  return { from: toLocalDay(start), to };
}

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Fleet roll-up of the report's per-driver rows. Every number here is a sum (or
 * a ratio of sums) so the band and the ring describe the same fleet the table
 * below them lists.
 */
export function buildPunctualitySummary(details) {
  const rows = Array.isArray(details) ? details : [];
  const total = (key) => rows.reduce((sum, row) => sum + count(row?.[key]), 0);
  const measuredTrips = total("measured_trips");
  const onTimeTrips = total("on_time_trips");
  const lateTrips = total("late_trips");
  const unmeasuredTrips = total("unmeasured_trips");
  const overrideTrips = total("override_trips");
  return {
    drivers: rows.length,
    totalCompletedTrips: total("completed_trips"),
    measuredTrips,
    onTimeTrips,
    lateTrips,
    unmeasuredTrips,
    overrideTrips,
    // `unmeasured_trips` deliberately EXCLUDES overrides
    // (unmeasured = completed − measured − override), so the ring's gray slice
    // has to fold them back in — otherwise the three slices only sum to
    // Completed minus the overrides, and the ring contradicts its own centre.
    notMeasuredTrips: unmeasuredTrips + overrideTrips,
    // Fleet punctuality is the ratio of the totals: on-time ÷ measured. It is
    // NOT the mean of the per-driver percentages, which would let one driver
    // with a single trip count as much as a driver with two hundred.
    onTimeRate: measuredTrips === 0 ? null : Math.round((onTimeTrips / measuredTrips) * 100),
  };
}

// Mirrors QueryBoundary's error state — a failed report must never read as an
// empty roster or all-zero KPIs.
function DriverPerfErrorPanel({ onRetry, busy }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center px-6 py-12 rounded-2xl border border-danger/20 bg-danger-bg/40"
      role="alert"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger/10 mb-4">
        <AlertTriangle className="w-5 h-5 text-danger" />
      </div>
      <p className="text-sm font-medium text-foreground">Couldn&apos;t load driver performance data</p>
      <p className="text-sm text-foreground-secondary mt-1 max-w-sm leading-relaxed">
        The completed-trip counts and punctuality below are unavailable because the report failed to load.
      </p>
      <Button variant="outline" size="sm" className="mt-4 cursor-pointer" onClick={onRetry} disabled={busy}>
        <RefreshCw className={cn("mr-2 h-3.5 w-3.5", busy && "animate-spin")} />
        Try again
      </Button>
    </div>
  );
}

// A dash is the no-data convention on every reports surface. The reason is also
// spelled out for assistive technology, because a hover tooltip alone is
// invisible to a keyboard or screen-reader user.
function NoData({ hint }) {
  return (
    <Tooltip content={hint}>
      <span tabIndex={0} className="cursor-help text-xs font-semibold text-foreground-muted/60">
        —<span className="sr-only"> {hint}</span>
      </span>
    </Tooltip>
  );
}

const DONUT_RADIUS = 62;
const DONUT_STROKE = 22;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

// Hand-rolled ring (recharts' ResponsiveContainer renders nothing during a
// server render, and this needs to stay assertable). Three slices, always
// totalling Completed: on-time, late, and not measured (incl. overrides).
function PunctualityDonut({ summary }) {
  const total = summary.totalCompletedTrips;
  const slices = [
    { key: "onTime", count: summary.onTimeTrips, color: CHART_COLORS.success },
    { key: "late", count: summary.lateTrips, color: CHART_COLORS.warning },
    { key: "notMeasured", count: summary.notMeasuredTrips, color: CHART_COLORS.neutral },
  ].filter((slice) => slice.count > 0);
  const gap = slices.length > 1 ? 2 : 0;
  let offset = 0;

  return (
    // Colour-coded and therefore unpredictable without sight: the ring is
    // decorative, and the same three numbers are stated in the KPI cards above
    // it and in the caption beside it.
    <div id="punctuality-donut" aria-hidden="true" className="relative h-44 w-44 shrink-0">
      <svg viewBox="0 0 160 160" fill="none" className="h-full w-full -rotate-90">
        {total === 0 ? (
          <circle cx="80" cy="80" r={DONUT_RADIUS} stroke={CHART_COLORS.neutral} strokeWidth={DONUT_STROKE} />
        ) : (
          slices.map((slice) => {
            const length = (slice.count / total) * DONUT_CIRCUMFERENCE;
            const visible = Math.max(0, length - gap);
            const dashOffset = -(offset + gap / 2);
            offset += length;
            return (
              <circle
                key={slice.key}
                cx="80"
                cy="80"
                r={DONUT_RADIUS}
                stroke={slice.color}
                strokeWidth={DONUT_STROKE}
                strokeDasharray={`${visible} ${DONUT_CIRCUMFERENCE - visible}`}
                strokeDashoffset={dashOffset}
              />
            );
          })
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
          {summary.onTimeRate == null ? "—" : `${summary.onTimeRate}%`}
        </p>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-widest text-foreground-muted">Punctuality</p>
      </div>
    </div>
  );
}

function PunctualityBreakdown({ summary }) {
  return (
    <Card className="border-0 shadow-xs rounded-3xl">
      <CardContent className="flex flex-col items-center gap-6 p-6 sm:flex-row sm:justify-center sm:gap-10">
        <PunctualityDonut summary={summary} />
        <div className="text-center sm:text-left">
          <p className="text-sm font-bold text-foreground">Where the completed trips landed</p>
          {/* One template literal, not adjacent expressions: React splices an
              HTML comment between neighbouring text nodes, which would break
              this sentence into fragments for anyone reading the markup. */}
          <p className="mt-1 max-w-sm text-sm leading-relaxed text-foreground-secondary">
            {`${summary.onTimeTrips} on-time, ${summary.lateTrips} late, ${summary.notMeasuredTrips} not measured of ${summary.totalCompletedTrips} completed trips`}
          </p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-foreground-muted">
            On-time means the driver reached pickup within the allowed window. Not measured covers trips with no usable
            arrival stamp — including {summary.overrideTrips} arrival
            {summary.overrideTrips === 1 ? "" : "s"} recorded with a geofence override, which are never counted as
            on-time or late.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DriverPerformancePage() {
  useRequireRole();
  const router = useRouter();
  const [preset, setPreset] = useState("30d");

  const range = useMemo(() => resolvePresetRange(preset), [preset]);

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["driver-performance", preset, range.from, range.to],
    queryFn: () => getDriverPerformanceReport(range.from, range.to),
  });

  const details = data?.details || [];
  const rowSummary = buildPunctualitySummary(details);
  // The payload's own fleet total is authoritative — it is the same
  // `totalCompletedTrips` every other reports surface reads, so the page must
  // not re-derive it from the rows and drift from them silently. The row sum is
  // only the fallback while the payload is missing (and during loading). The
  // fleet rate is NOT taken from here: the payload carries no fleet-level rate,
  // so it stays the ratio of the row totals.
  const serverCompletedTrips = data?.totalCompletedTrips;
  const summary = Number.isFinite(serverCompletedTrips)
    ? { ...rowSummary, totalCompletedTrips: serverCompletedTrips }
    : rowSummary;
  const rosterEmpty = !isLoading && details.length === 0;
  // Both empty states are a dash, never a 0%: an empty period is not a fleet
  // that missed every pickup.
  const noTrips = !isLoading && !rosterEmpty && summary.totalCompletedTrips === 0;
  const noMeasurements = summary.measuredTrips === 0;

  const kpis = [
    {
      label: "Completed Trips",
      value: summary.totalCompletedTrips,
      icon: CheckCircle2,
      tone: "primary",
      trend: "finished in the selected period",
    },
    {
      label: "Punctuality",
      value: summary.onTimeRate == null ? "—" : `${summary.onTimeRate}%`,
      icon: Gauge,
      tone: summary.onTimeRate == null ? "muted" : "primary",
      // Raw counts, never a bare percentage: "226 of 240" is auditable, "94%"
      // alone is not. No measured trips is a dash — never 0%.
      trend: noMeasurements ? "No measured trips" : `${summary.onTimeTrips} of ${summary.measuredTrips} measured trips`,
    },
    {
      label: "On-Time",
      value: summary.onTimeTrips,
      icon: Clock,
      tone: summary.onTimeTrips > 0 ? "success" : "muted",
      trend: "inside the pickup window",
    },
    {
      label: "Late",
      value: summary.lateTrips,
      icon: AlertTriangle,
      tone: summary.lateTrips > 0 ? "warning" : "success",
      trend: "past the pickup window",
    },
    {
      label: "Not Measured",
      value: summary.notMeasuredTrips,
      icon: MinusCircle,
      tone: "neutral",
      trend: "no usable arrival stamp",
    },
  ];

  // Column order and vocabulary follow the plan's table contract:
  // `Driver | Status | Completed | Punctuality | On-Time | Late | Avg Late | View`.
  // "Punctuality" is the per-driver rate (%), "On-Time"/"Late" are the measured
  // trip counts behind it — the same vocabulary the KPI band and the Excel
  // Driver Details sheet use, so the rate is never mistaken for a count.
  const columns = [
    {
      key: "name",
      label: "Driver",
      sortable: true,
      render: (val, row) => (
        <div className="flex items-center gap-3">
          <DriverAvatar source={row} name={val} />
          <p className="font-bold text-sm text-foreground">{val}</p>
        </div>
      ),
    },
    {
      key: "driver_status",
      label: "Status",
      render: (val) =>
        val ? (
          <StatusBadge status={val} entity="driver" className="rounded-full px-3 py-1 text-xs font-bold capitalize" />
        ) : (
          <span className="text-xs text-foreground-muted">—</span>
        ),
    },
    {
      key: "completed_trips",
      label: "Completed",
      sortable: true,
      render: (val) => <span className="font-data font-bold text-xs text-foreground">{count(val)}</span>,
    },
    {
      key: "punctuality_rate",
      label: "Punctuality",
      sortable: true,
      render: (val, row) =>
        count(row.measured_trips) > 0 && val != null ? (
          <span className="font-data font-bold text-xs text-foreground">{`${Math.round(Number(val))}%`}</span>
        ) : (
          <NoData hint="No pickup timing measurements available." />
        ),
    },
    {
      key: "on_time_trips",
      label: "On-Time",
      sortable: true,
      render: (val) => <span className="font-data font-bold text-xs text-foreground">{count(val)}</span>,
    },
    {
      key: "late_trips",
      label: "Late",
      sortable: true,
      render: (val) => <span className="font-data font-bold text-xs text-foreground">{count(val)}</span>,
    },
    {
      key: "avg_late_minutes",
      label: "Avg Late",
      sortable: true,
      render: (val) =>
        val == null ? (
          <NoData hint="No measured late arrivals for this driver." />
        ) : (
          <span className="font-data font-bold text-xs text-foreground">{`+${Number(val).toFixed(1)} min`}</span>
        ),
    },
    {
      key: "actions",
      label: "View",
      render: (_, row) => (
        <div className="inline-flex items-center" onClick={(event) => event.stopPropagation()}>
          <Tooltip content="View Driver Profile">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full text-foreground-secondary hover:bg-hover hover:text-foreground cursor-pointer"
              onClick={() => router.push(`/drivers/${row.driver_id}`)}
              aria-label={`View ${row.name ?? "driver"} profile`}
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
        icon={Award}
        title="Driver Performance Center"
        badge="Analytics"
        description="Completed trips and pickup punctuality per driver."
        actions={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => refetch()}
            disabled={isRefetching}
            title="Refresh performance data"
            aria-label="Refresh performance data"
            className="rounded-full cursor-pointer text-foreground-secondary hover:text-foreground"
          >
            <RefreshCw className={cn("w-4 h-4", isRefetching && "animate-spin")} />
          </Button>
        }
      />

      {/* ── Reporting period ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-hover/70 p-1 ring-1 ring-border/60 scrollbar-thin">
          {PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPreset(option.id)}
              aria-pressed={preset === option.id}
              className={cn(
                "shrink-0 rounded-full px-4 py-2 text-xs font-bold transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                preset === option.id
                  ? "bg-foreground text-surface shadow-xs"
                  : "text-foreground-secondary hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs font-medium text-foreground-muted">
          {preset === "all" ? "Every completed trip on record" : `${range.from} → ${range.to}`}
        </p>
      </div>

      {isError ? (
        <DriverPerfErrorPanel onRetry={() => refetch()} busy={isRefetching} />
      ) : (
        <>
          {/* ── KPI band: the ring below carries no information these do not ── */}
          <StatGrid cols={5}>
            {kpis.map((k) => (
              <StatCard key={k.label} icon={k.icon} label={k.label} value={isLoading ? "—" : k.value} trend={k.trend} tone={k.tone} />
            ))}
          </StatGrid>

          {noTrips ? (
            <Card className="border-0 shadow-xs rounded-3xl">
              <CardContent className="p-0">
                <EmptyState
                  icon={Gauge}
                  variant="first-run"
                  title="No completed trips"
                  description="Nothing was completed in the selected period, so there is no pickup punctuality to report. Widen the period above."
                />
              </CardContent>
            </Card>
          ) : (
            <>
              <PunctualityBreakdown summary={summary} />

              {/* ── Per-driver punctuality ── */}
              <Card className="border-0 shadow-xs rounded-3xl overflow-hidden">
                <CardContent className="p-0">
                  <DataTable
                    columns={columns}
                    data={details}
                    pageSize={10}
                    title="Driver Punctuality"
                    description={`${details.length} drivers on the roster for the selected period.`}
                    icon={Award}
                    searchPlaceholder="Search drivers by name..."
                    isLoading={isLoading}
                    emptyTitle="No drivers on the roster"
                    emptyDescription="Add drivers to the roster to report on completed trips and punctuality."
                    onRowClick={(row) => router.push(`/drivers/${row.driver_id}`)}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
