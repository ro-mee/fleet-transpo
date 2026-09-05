"use client";

// Pair-first half of the Resource Availability board (/dispatch/availability).
// Answers "which actual vehicle + driver pairs can dispatch in this window?"
// from GET /api/dispatch/availability-pairs — the same pairing rule the assign
// path enforces, so this view can never disagree with the AI panel.
//
// The Drivers | Vehicles tabs remain for individual investigation; this is the
// dispatch-truth view.

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, buildQuery } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CarFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  RefreshCw,
  User,
} from "lucide-react";

function toInputValue(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(d);
}

function fmtWindow(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function initials(name, fallback) {
  if (!name) return fallback;
  const parts = String(name).split(" ").filter(Boolean);
  return (parts.map((p) => p[0]).join("") || fallback).slice(0, 2).toUpperCase();
}

export function PairAvailabilityBoard({
  pickupAt,
  returnAt,
  minCapacity,
  categoryId,
  isCustomWindow,
  requestContext,
  onWindowChange,
  onResetWindow,
}) {
  // The mode MUST travel explicitly: the endpoint defaults to exact (strict),
  // so a missing mode would silently never enter dayScope. It also splits the
  // React Query cache between today and exact data via qs.
  const mode = isCustomWindow ? "exact" : "today";
  const qs = buildQuery({
    pickup_at: pickupAt ? new Date(pickupAt).toISOString() : undefined,
    return_at: returnAt ? new Date(returnAt).toISOString() : undefined,
    min_capacity: minCapacity || undefined,
    category_id: categoryId || undefined,
    mode,
  });

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["availability-pairs", qs],
    queryFn: () => apiFetch(`/api/dispatch/availability-pairs${qs}`),
  });

  const ready = data?.ready || [];
  const blocked = data?.blocked || [];
  const hasTrips = (e) => (e.clashes || []).length > 0;

  // Classification is display-only. The endpoint reports hard eligibility +
  // schedule activity; THIS is where today-mode (operational overview) and
  // exact-window mode (authoritative check) diverge:
  //   today  → Clear Schedule Today / Has Trips Today / Blocked
  //   exact  → Ready / Blocked (window overlap legitimately blocks)
  // Hard blockers always outrank schedule activity — a pair with trips AND a
  // hard blocker lands in Blocked, never in Has Trips Today.
  const clearToday = ready.filter((p) => !hasTrips(p));
  const tripsToday = [...ready.filter(hasTrips)].sort(byTripUrgency);
  const exactReady = ready.filter((p) => !hasTrips(p));
  const exactOverlap = ready.filter(hasTrips);

  // 8/page on the long-tail lists; restart from page 1 on window/filter change.
  const PAGE_SIZE = 8;
  const [tripsPage, setTripsPage] = useState(1);
  const [blockedPage, setBlockedPage] = useState(1);
  const [pageQs, setPageQs] = useState(qs);
  if (pageQs !== qs) {
    setPageQs(qs);
    setTripsPage(1);
    setBlockedPage(1);
  }
  const tripsPageCount = Math.max(1, Math.ceil(tripsToday.length / PAGE_SIZE));
  const safeTripsPage = Math.min(tripsPage, tripsPageCount);
  const pagedTrips = tripsToday.slice(
    (safeTripsPage - 1) * PAGE_SIZE,
    safeTripsPage * PAGE_SIZE
  );
  // Exact-window mode folds window-overlap into the blocked list (it
  // legitimately blocks a specific trip); today-mode keeps it separate.
  const blockedList = isCustomWindow
    ? [
        ...exactOverlap.map((p) => ({
          ...p,
          block_reason: overlapReason(p.clashes[0]),
          action: { label: "View Dispatch", href: "/dispatch" },
        })),
        ...blocked,
      ]
    : blocked;
  const blockedPageCount = Math.max(1, Math.ceil(blockedList.length / PAGE_SIZE));
  const safeBlockedPage = Math.min(blockedPage, blockedPageCount);
  const pagedBlocked = blockedList.slice(
    (safeBlockedPage - 1) * PAGE_SIZE,
    safeBlockedPage * PAGE_SIZE
  );

  // Exact-window picker is optional refinement on top of the today default —
  // collapsed until the dispatcher needs a precise future slot.
  const [customOpen, setCustomOpen] = useState(Boolean(isCustomWindow));

  return (
    <div className="space-y-6">
      {/* Window bar — today by default, exact window optional. Always explicit,
          never a blank "universal availability". */}
      <div className="rounded-3xl border border-border/80 bg-surface p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setCustomOpen((o) => !o)}
            aria-expanded={customOpen}
            className="h-9 cursor-pointer rounded-xl px-4 text-xs font-semibold"
          >
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            {customOpen ? "Hide exact window" : "Set exact window (optional)"}
          </Button>
          {isCustomWindow && (
            <Button
              variant="outline"
              onClick={onResetWindow}
              className="h-9 cursor-pointer rounded-xl px-4 text-xs font-semibold"
            >
              Back to today
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            disabled={isFetching}
            onClick={() => refetch()}
            aria-label="Refresh dispatchable pairs"
            className="cursor-pointer"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
        {customOpen && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                <CalendarClock className="h-3.5 w-3.5" /> Pickup
              </span>
              <input
                type="datetime-local"
                aria-label="Pickup time"
                value={toInputValue(pickupAt)}
                onChange={(e) => {
                  const v = e.target.value ? new Date(e.target.value) : null;
                  if (v && !Number.isNaN(v.getTime())) onWindowChange?.({ pickupAt: v });
                }}
                className="h-9 rounded-xl border border-border/60 bg-surface px-3 text-sm font-medium text-foreground"
              />
            </label>
            <label className="space-y-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
                <Clock className="h-3.5 w-3.5" /> Return <span className="font-medium normal-case">(optional)</span>
              </span>
              <input
                type="datetime-local"
                aria-label="Return time"
                value={toInputValue(returnAt)}
                onChange={(e) => {
                  const v = e.target.value ? new Date(e.target.value) : null;
                  if (v && !Number.isNaN(v.getTime())) onWindowChange?.({ returnAt: v });
                }}
                className="h-9 rounded-xl border border-border/60 bg-surface px-3 text-sm font-medium text-foreground"
              />
            </label>
          </div>
        )}
        <p className="mt-3 text-xs font-medium text-foreground-secondary" role="status">
          {isCustomWindow
            ? `Showing dispatchability for ${fmtWindow(data?.window?.pickup_at || pickupAt)} → ${fmtWindow(data?.window?.return_at || returnAt)}.`
            : `Showing dispatchability for today (${fmtDay(data?.window?.pickup_at || pickupAt)}).`}
        </p>
      </div>

      {requestContext && (
        <div className="rounded-3xl border border-primary/30 bg-primary/[0.04] p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            Request {requestContext.request_number || ""}
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {[requestContext.passengers ? `${requestContext.passengers} passengers` : null,
              requestContext.category || null,
              requestContext.requested_capacity ? `Requested size: ${requestContext.requested_capacity}-seater` : null,
            ].filter(Boolean).join(" · ") || "Prefiltered request"}
          </p>
          <p className="mt-0.5 text-xs font-medium text-foreground-secondary">
            Which actual vehicle + driver pairs can fulfill this request in this window?
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="h-48 animate-pulse rounded-3xl border border-border/40 bg-muted/20" />
      ) : isError ? (
        <div className="rounded-3xl border border-danger/30 bg-danger/5 p-6 text-sm font-medium text-danger">
          Could not load dispatchable pairs. Check your connection and refresh.
        </div>
      ) : (
        <>
          {!isCustomWindow ? (
            <>
              <section aria-label="Clear schedule today">
                <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  Clear Schedule Today
                  <span className="font-data text-xs font-bold text-foreground-secondary">({clearToday.length})</span>
                </h2>
                <p className="mb-3 text-xs font-medium text-foreground-secondary">
                  No scheduled trips today. Select an exact pickup window to verify assignment readiness.
                </p>
                {clearToday.length === 0 ? (
                  <div className="rounded-3xl border border-border/60 bg-surface">
                    <EmptyState
                      icon={CalendarClock}
                      title="Every pair has trips today"
                      description="Check the sections below before assigning more."
                      variant="waiting"
                      size="compact"
                    />
                  </div>
                ) : (
                  <ul className="grid gap-3 md:grid-cols-2">
                    {clearToday.map((p) => (
                      <PairCard
                        key={p.vehicle.vehicle_id}
                        entry={p}
                        badge={
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
                            <CheckCircle2 className="h-3 w-3" /> Clear
                          </span>
                        }
                      />
                    ))}
                  </ul>
                )}
              </section>

              {tripsToday.length > 0 && (
                <section aria-label="Has trips today">
                  <h2 className="mb-1 flex items-center gap-2 text-sm font-bold text-foreground">
                    <Clock className="h-4 w-4 text-info" />
                    Has Trips Today
                    <span className="font-data text-xs font-bold text-foreground-secondary">({tripsToday.length})</span>
                  </h2>
                  <p className="mb-3 text-xs font-medium text-foreground-secondary">
                    Cleared driver, but already running trips today — check times before assigning more.
                  </p>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {pagedTrips.map((p) => (
                      <PairCard
                        key={p.vehicle.vehicle_id}
                        entry={p}
                        badge={
                          <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-3 py-1 text-xs font-bold text-info">
                            <Clock className="h-3 w-3" /> {p.clashes.length} trip{p.clashes.length === 1 ? "" : "s"}
                          </span>
                        }
                      >
                        <ClashChips clashes={p.clashes} />
                      </PairCard>
                    ))}
                  </ul>
                  <Pager
                    page={safeTripsPage}
                    pageCount={tripsPageCount}
                    onPage={setTripsPage}
                    label="trips-today"
                  />
                </section>
              )}
            </>
          ) : (
            <section aria-label="Ready pairs">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <CheckCircle2 className="h-4 w-4 text-success" />
                Ready
                <span className="font-data text-xs font-bold text-foreground-secondary">({exactReady.length})</span>
              </h2>
              {exactReady.length === 0 ? (
                <div className="rounded-3xl border border-border/60 bg-surface">
                  <EmptyState
                    icon={AlertTriangle}
                    title="No dispatchable pair in this window"
                    description="Check blocked pairs below for the fix, or pick another window."
                    variant="blocked"
                    size="compact"
                  />
                </div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {exactReady.map((p) => (
                    <PairCard
                      key={p.vehicle.vehicle_id}
                      entry={p}
                      badge={
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
                          <CheckCircle2 className="h-3 w-3" /> Ready
                        </span>
                      }
                    />
                  ))}
                </ul>
              )}
            </section>
          )}

          <section aria-label="Blocked pairs">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Blocked
              <span className="font-data text-xs font-bold text-foreground-secondary">
                ({blockedList.length})
              </span>
            </h2>
            {blockedList.length === 0 ? (
              <div className="rounded-3xl border border-border/60 bg-surface">
                <EmptyState
                  icon={CheckCircle2}
                  title={isCustomWindow ? "Nothing blocked in this window" : "Nothing blocked today"}
                  description="Every vehicle has a cleared driver for this window."
                  variant="relief"
                  size="compact"
                />
              </div>
            ) : (
              <>
              <ul className="grid gap-3 md:grid-cols-2">
                {pagedBlocked.map((b) => (
                  <BlockedCard
                    key={b.vehicle.vehicle_id}
                    vehicle={b.vehicle}
                    driver={b.driver}
                    badge={
                      (b.clashes || []).length > 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger/10 px-3 py-1 text-xs font-bold text-danger">
                          <AlertTriangle className="h-3 w-3" /> Blocked · Needs Attention
                        </span>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-danger/10 px-3 py-1 text-xs font-bold text-danger">
                          Blocked
                        </span>
                      )
                    }
                    reason={b.block_reason}
                    action={b.action}
                    clashes={b.clashes || []}
                  />
                ))}
              </ul>
              <Pager
                page={safeBlockedPage}
                pageCount={blockedPageCount}
                onPage={setBlockedPage}
                label="blocked"
              />
              </>
            )}
          </section>

          <div className="rounded-3xl border border-border/60 bg-muted/20 p-4 text-sm">
            <p className="font-bold text-foreground">Unpaired resources</p>
            <p className="mt-1 text-xs font-medium text-foreground-secondary">
              {data?.counts?.unpaired_vehicles || 0} vehicle(s) without a usable driver
              {" · "}
              {data?.counts?.unassigned_drivers || 0} driver(s) not assigned to any vehicle.
              A free vehicle plus a free driver is not dispatchable until they are paired.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/fleet/assignments"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/60 bg-surface px-3.5 text-xs font-bold text-foreground transition-colors hover:border-primary/40"
              >
                Manage pairings <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <Link
                href="/dispatch"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border/60 bg-surface px-3.5 text-xs font-bold text-foreground transition-colors hover:border-primary/40"
              >
                View dispatch board <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// --- Shared card pieces (Operate mode: one shell, status carried by badge) ---

/** "06:00:00" wall-clock shift string -> "6:00 AM" for duty display. */
function fmtShift(value) {
  if (value == null) return "—";
  const m = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(value);
  const hour = Number(m[1]);
  return `${hour % 12 || 12}:${m[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

/** "8:00 AM" short clock for trip chips. */
function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
}

function clashLabel(c) {
  return c.dispatch_number || (c.dispatch_id ? `DSP-${c.dispatch_id}` : "Dispatch");
}

function fmtRange(c) {
  const dep = fmtTime(c.scheduled_departure);
  return c.scheduled_arrival ? `${dep}–${fmtTime(c.scheduled_arrival)}` : `from ${dep}`;
}

/** Exact-window overlap verdict, composed from the first clash (same wording). */
function overlapReason(c) {
  return `Already dispatched (${clashLabel(c)}) in this window.`;
}

/**
 * Has-trips ordering: entries with an unfinished trip first (earliest
 * departure wins), already-finished entries last. Relative to now, so at
 * 2 PM the 2:30 trip outranks the 8 AM one.
 */
function byTripUrgency(a, b) {
  const now = Date.now();
  const split = (e) => {
    const list = e.clashes || [];
    const live = list.some((c) => {
      const end = c.scheduled_arrival
        ? new Date(c.scheduled_arrival).getTime()
        : new Date(c.scheduled_departure).getTime() + 60 * 60 * 1000;
      return end > now;
    });
    const first = list.length
      ? Math.min(...list.map((c) => new Date(c.scheduled_departure).getTime()))
      : 0;
    return { live, first };
  };
  const x = split(a);
  const y = split(b);
  if (x.live !== y.live) return x.live ? -1 : 1;
  return x.first - y.first;
}

function PairHead({ vehicle, badge }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/40 bg-muted/60 text-xs font-black text-foreground">
          <CarFront className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">
            {vehicle.plate_number || vehicle.vehicle_name}
            {vehicle.seating_capacity ? ` · ${vehicle.seating_capacity} pax` : ""}
          </p>
          <p className="text-xs font-medium text-foreground-secondary">
            {vehicle.vehicle_name}
            {vehicle.category_name ? ` · ${vehicle.category_name}` : ""}
          </p>
        </div>
      </div>
      {badge}
    </div>
  );
}

function DriverLine({ entry }) {
  return (
    <div className="mt-3 flex items-center gap-2.5 border-t border-border/40 pt-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-[11px] font-bold text-primary">
        {initials(entry.driver?.name, "DR")}
      </div>
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <User className="h-3.5 w-3.5 text-foreground-muted" aria-hidden="true" />
          {entry.driver?.name || "—"}
        </p>
        <p className="text-xs font-medium text-foreground-secondary">
          {entry.pairing_kind === "substitute" ? "Substitute" : "Designated pair"}
          {entry.duty_window ? ` · Duty ${fmtShift(entry.duty_window.start)}–${fmtShift(entry.duty_window.end)}` : ""}
        </p>
      </div>
    </div>
  );
}

function PairCard({ entry, badge, children }) {
  return (
    <li className="rounded-3xl border border-border/60 bg-surface p-4 shadow-xs">
      <PairHead vehicle={entry.vehicle} badge={badge} />
      <DriverLine entry={entry} />
      {entry.pairing_note && (
        <p className="mt-2 text-xs font-medium text-foreground-secondary">{entry.pairing_note}</p>
      )}
      {children}
    </li>
  );
}

/** Per-trip rows: number + time range + dispatch link. */
function ClashChips({ clashes }) {
  return (
    <ul className="mt-3 space-y-1.5 border-t border-border/40 pt-3">
      {(clashes || []).map((c) => (
        <li
          key={c.dispatch_id}
          className="flex items-center justify-between gap-2 rounded-xl bg-muted/20 px-3 py-2"
        >
          <span className="text-xs font-bold text-foreground">
            {clashLabel(c)}
            <span className="ml-2 font-medium text-foreground-secondary">{fmtRange(c)}</span>
          </span>
          <Link
            href="/dispatch"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-primary hover:underline"
          >
            View Dispatch <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function BlockedCard({ vehicle, driver, badge, reason, action, clashes }) {
  const tripCount = (clashes || []).length;
  return (
    <li className="rounded-3xl border border-border/60 bg-surface p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-foreground">
            {vehicle.plate_number || vehicle.vehicle_name}
            {vehicle.seating_capacity ? ` · ${vehicle.seating_capacity} pax` : ""}
          </p>
          <p className="text-xs font-medium text-foreground-secondary">
            {vehicle.vehicle_name}
            {vehicle.category_name ? ` · ${vehicle.category_name}` : ""}
            {driver?.name ? ` · ${driver.name}` : ""}
          </p>
        </div>
        {badge}
      </div>
      <p className="mt-2 text-xs font-semibold text-foreground">{reason}</p>
      {/* Secondary trip warning: collapsed by default. Wording is deliberately
          non-committal ("may be affected") — reassignment authority lives with
          the dispatch/incident flow, not this read board. */}
      {tripCount > 0 && (
        <details className="mt-2 rounded-xl border border-warning/30 bg-warning/[0.06] px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-warning">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {tripCount} scheduled trip{tripCount === 1 ? "" : "s"} today — may be affected
          </summary>
          <ClashChips clashes={clashes} />
        </details>
      )}
      {action ? (
        <Link
          href={action.href}
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-xs font-bold text-white transition-colors hover:bg-primary/90 dark:text-slate-950"
        >
          {action.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : (
        <p className="mt-3 text-xs font-medium text-foreground-secondary">
          No immediate override — resolve the blocker above first.
        </p>
      )}
    </li>
  );
}

function Pager({ page, pageCount, onPage, label }) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-center gap-1.5">
      <Button
        variant="outline"
        size="icon"
        disabled={page <= 1}
        onClick={() => onPage(Math.max(1, page - 1))}
        aria-label={`Previous ${label} page`}
        className="h-8 w-8 cursor-pointer rounded-xl"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onPage(n)}
          aria-label={`${label} page ${n}`}
          aria-current={n === page ? "page" : undefined}
          className={cn(
            "h-8 min-w-8 cursor-pointer rounded-xl px-2 text-xs font-bold transition-colors",
            n === page
              ? "bg-primary text-white dark:text-slate-950"
              : "text-foreground-secondary hover:bg-hover hover:text-foreground"
          )}
        >
          {n}
        </button>
      ))}
      <Button
        variant="outline"
        size="icon"
        disabled={page >= pageCount}
        onClick={() => onPage(Math.min(pageCount, page + 1))}
        aria-label={`Next ${label} page`}
        className="h-8 w-8 cursor-pointer rounded-xl"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
