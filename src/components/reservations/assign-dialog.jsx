"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ConflictBlock } from "@/components/reservations/conflict-block";
import { getAvailableVehicles } from "@/services/vehicle.service";
import { getDrivers } from "@/services/driver.service";
import { getDriverAssignments } from "@/services/driver-assignment.service";
import { formatDateTime } from "@/lib/utils";
import { Send, Info, Car, UserCheck, CheckCircle2, Search } from "lucide-react";
import { FloatingField } from "@/components/ui/field";

// Name off either shape: /api/drivers nests the person under `employees`,
// /api/driver-assignments returns the same columns flattened.
const personName = (r) =>
  `${r?.employees?.first_name || r?.first_name || ""} ${r?.employees?.last_name || r?.last_name || ""}`.trim() ||
  (r?.driver_id ? `Driver #${r.driver_id}` : "another driver");

// Commit a vehicle and/or driver to an approved request.
//
// The endpoint refuses a blocking conflict with 409 unless { force: true }. Those
// conflicts arrive on the thrown error's `data.conflicts` (see lib/api/client)
// and are shown here with an explicit override button — the dispatcher sees
// exactly what they are overriding, and the server records the override on the
// timeline. Reference lists load only while the dialog is open.
//
// The inner form is keyed by request id below, so the select seeds from whatever
// is already assigned via a useState initializer. Syncing that with an effect
// instead would be a cascading render (react-hooks/set-state-in-effect).
//
// The dispatcher picks a vehicle and its custodial driver (migration 017) as one
// atomic choice, because that is how the yard actually works: a car comes with the
// person responsible for it. There is deliberately no way to substitute a different
// driver here — changing who is responsible for a car is done on the vehicle's own
// page, where it updates the permanent record instead of quietly applying to one trip.
//
// The list only offers pairings that can actually be assigned: vehicle available and
// big enough, driver on duty. Anything the server would refuse is left out rather
// than shown and blocked, and the footnote reports how many were dropped.
//
// It also restricts the list to the class the request was booked as. Unlike the
// others this is not a server rule — no conflict type covers it, so nothing would
// refuse a VIP arrival sent out in a housekeeping van. `vehiclecategories` encodes
// who a trip is for, not what shape the vehicle is, so crossing classes puts a guest
// in the wrong car while every technical check passes. A request the resolver could
// not classify carries a null category and is deliberately left unfiltered — the
// dispatcher decides, rather than being shown an empty list built on a guess.
function AssignForm({ request, onClose, onSubmit, isPending, conflictError }) {
  // "<vehicleId>:<driverId>" — the custodial pair chosen. Seeded from whatever is
  // already on the request; the form is keyed by request id so a remount reseeds.
  const [selection, setSelection] = useState(
    request?.vehicle_id || request?.driver_id
      ? `${request.vehicle_id ?? ""}:${request.driver_id ?? ""}`
      : ""
  );

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery({
    queryKey: ["available-vehicles", request?.pickup_datetime],
    queryFn: () =>
      getAvailableVehicles(
        request?.pickup_datetime
          ? { pickup_at: request.pickup_datetime, ...(request.scheduled_arrival ? { return_at: request.scheduled_arrival } : {}) }
          : {}
      ),
  });
  const { data: drivers = [], isLoading: loadingDrivers } = useQuery({
    queryKey: ["drivers", { status: "Available", pickup_at: request?.pickup_datetime }],
    queryFn: () =>
      getDrivers({
        status: "Available",
        ...(request?.pickup_datetime ? { pickup_at: request.pickup_datetime } : {}),
      }),
  });
  // Active custodial pairings (migration 017). Without these the dispatcher has
  // to open each vehicle's page to find out who is responsible for it.
  const { data: pairingData, isLoading: loadingPairings } = useQuery({
    queryKey: ["driver-assignments", "active"],
    queryFn: () => getDriverAssignments(),
  });

  // The reference lists load async; until they do, `vehicles`/`drivers`/`rows`
  // are all empty and any attribution ("paired", "off duty", "wrong class")
  // computed from them is a guess that will flash and flip the moment data
  // lands. Gate the pinned attribution on data being ready so the dialog never
  // shows a warning it is about to retract.
  const sourcesLoading = loadingVehicles || loadingDrivers || loadingPairings;

  // Same floor the server uses: an absent or zero passenger_count means one seat.
  const passengers = Number(request?.passenger_count) || 1;

  // Too small for this request. Mirrors the CAPACITY_MISMATCH rule in
  // lib/scheduling/conflicts.js, which is BLOCKING there — the server would refuse
  // such an assignment with a 409, so offering it here is a dead end. Note the
  // `> 0` guard: that rule treats a missing or zero capacity as UNKNOWN rather than
  // as too small, and this must not be stricter than the check it mirrors.
  //
  // useCallback because both memos below depend on it; a fresh closure each render
  // would invalidate them every time.
  const seatsTooFew = useCallback(
    (v) => {
      const seats = Number(v?.seating_capacity) || 0;
      return seats > 0 && seats < passengers;
    },
    [passengers]
  );

  // The class this request was booked as. Hoisted out of the memos below so both
  // read the same value and neither takes a dependency on the whole request.
  const reqCategoryId = request?.requested_category_id ?? null;

  // One option per custodial pairing whose vehicle is available, big enough, of the
  // booked class, and whose driver is on duty. All four are filters, not labels:
  // none of these can be assigned, so offering them would only be a dead end. The
  // footnote accounts for whatever this drops.
  const options = useMemo(() => {
    const rows = pairingData?.assignments ?? [];
    const vById = new Map(vehicles.map((v) => [v.vehicle_id, v]));
    const onDuty = new Set(drivers.map((d) => d.driver_id));

    return rows
      .filter((a) => {
        const v = vById.get(a.vehicle_id);
        return (
          v &&
          onDuty.has(a.driver_id) &&
          !seatsTooFew(v) &&
          // A null category means the resolver could not classify the request, so
          // every class stays offered rather than none.
          (reqCategoryId == null || v.category_id === reqCategoryId)
        );
      })
      .map((a) => {
        const v = vById.get(a.vehicle_id);
        return {
          value: `${a.vehicle_id}:${a.driver_id}`,
          vehicleId: a.vehicle_id,
          driverId: a.driver_id,
          plate: v.plate_number,
          driverName: personName(a),
          label:
            `${v.plate_number}` +
            (v.seating_capacity ? ` · ${v.seating_capacity} seats` : "") +
            (v.model ? ` · ${v.model}` : "") +
            ` · ${personName(a)}`,
        };
      })
      .sort((a, b) => a.plate.localeCompare(b.plate));
  }, [vehicles, drivers, pairingData, seatsTooFew, reqCategoryId]);

  // A request may already hold a combination that is not a current pairing — made
  // before this dialog changed, or through the API. Show it rather than silently
  // dropping it. An already-assigned vehicle may be absent from the available list,
  // so each label resolves through a fallback chain and is never blank.
  const pinned = useMemo(() => {
    if (!request?.vehicle_id && !request?.driver_id) return null;
    const key = `${request.vehicle_id ?? ""}:${request.driver_id ?? ""}`;
    if (options.some((o) => o.value === key)) return null;

    const rows = pairingData?.assignments ?? [];
    const v = vehicles.find((x) => x.vehicle_id === request.vehicle_id);
    const vRow = rows.find((a) => a.vehicle_id === request.vehicle_id);
    const d = drivers.find((x) => x.driver_id === request.driver_id);
    const dRow = rows.find((a) => a.driver_id === request.driver_id);

    const plate =
      v?.plate_number ||
      vRow?.plate_number ||
      request.plate_number ||
      (request.vehicle_id ? `Vehicle #${request.vehicle_id}` : "No vehicle");
    // The stub keeps personName on its `Driver #<id>` branch when neither list has
    // the driver, rather than its "another driver" last resort.
    const driverName = request.driver_id
      ? personName(d ?? dRow ?? { driver_id: request.driver_id })
      : "No driver";

    // While the reference lists load, any attribution would be a guess that
    // flashes then flips. Suppress the pinned card entirely until the data is
    // there — the dropdown's own "Loading…" placeholder covers this moment, so
    // nothing transient is rendered that a settled state would retract.
    if (sourcesLoading) return null;

    // Tested against the raw pairing rows, not `options` — `options` excludes
    // off-duty pairings, so asking it would report a genuine pairing as "not
    // paired" whenever its driver happened to be off duty today.
    const isRealPairing = rows.some(
      (a) => a.vehicle_id === request.vehicle_id && a.driver_id === request.driver_id
    );

    // The one pinned state the server will actually refuse: capacity is BLOCKING, so
    // re-saving this assignment returns 409. Said plainly here, because the fix is a
    // different vehicle — not something the dispatcher can wait out or override away.
    const tooSmall = Boolean(v) && seatsTooFew(v);

    // Class mismatch is filtered out of the list but is not a server conflict, so a
    // correctly-paired, on-duty, big-enough vehicle can land here for this reason
    // alone. Checked before the off-duty branch below, which would otherwise blame
    // the driver for a vehicle-class decision.
    const wrongCategory =
      Boolean(v) && reqCategoryId != null && v.category_id !== reqCategoryId;

    return {
      value: key,
      vehicleId: request.vehicle_id ?? null,
      driverId: request.driver_id ?? null,
      plate,
      driverName,
      isPinned: true,
      isRealPairing,
      tooSmall,
      wrongCategory,
      label:
        `${plate} · ${driverName} · current — ` +
        (tooSmall
          ? "too few seats"
          : wrongCategory
            ? "wrong class"
            : isRealPairing
              ? "driver off duty"
              : "not paired"),
    };
  }, [request, options, vehicles, drivers, pairingData, seatsTooFew, reqCategoryId, sourcesLoading]);

  const allOptions = pinned ? [pinned, ...options] : options;

  const selectedOpt = allOptions.find((o) => o.value === selection) ?? null;

  // The booked class, named so a short list explains itself. Resolved from the
  // request's own join, falling back to the raw string the booking sent when the
  // resolver could not classify it — and to nothing at all when neither exists,
  // which is exactly when the list is unfiltered.
  const requiredClass =
    reqCategoryId != null
      ? request?.vehiclecategories?.category_name || request?.requested_vehicle_type || "Requested class"
      : null;

  // Available vehicles no row offers — either nobody is paired to them, or that
  // pairing's driver is off duty. Counted against allOptions rather than options: a
  // pinned vehicle is visible at the top of the list, so counting it as "not listed"
  // would make the footnote contradict the list right above it.
  const offeredVehicleIds = new Set(allOptions.map((o) => o.vehicleId));
  const hiddenCount = vehicles.filter((v) => !offeredVehicleIds.has(v.vehicle_id)).length;

  const [searchQuery, setSearchQuery] = useState("");

  const filteredOptions = allOptions.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const plate = (o.plateNumber || o.plate || "").toLowerCase();
    const model = (o.model || "").toLowerCase();
    const driver = (o.driverName || "").toLowerCase();
    return plate.includes(q) || model.includes(q) || driver.includes(q);
  });

  const submit = (force) => {
    const [v, d] = selection.split(":");
    onSubmit?.({
      request,
      vehicleId: v ? Number(v) : null,
      driverId: d ? Number(d) : null,
      force,
    });
  };

  const blocking = conflictError?.data?.conflicts || [];
  const loading = loadingVehicles || loadingDrivers || loadingPairings;

  return (
    <>
      <DialogHeader className="border-b border-border/40 px-6 pb-4">
        <DialogTitle className="text-base font-bold">Assign Resources</DialogTitle>
        <DialogDescription className="text-xs mt-0.5">
          {`${request.reservation_number || `REQ-${request.request_id}`} · pickup ${formatDateTime(request.pickup_datetime)}`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 px-6 pt-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-foreground-secondary">
            Vehicle &amp; Driver Assignment
          </label>
          {requiredClass && (
            <Badge variant="outline" className="text-[11px] font-semibold text-primary">
              {requiredClass} only
            </Badge>
          )}
        </div>

        {allOptions.length > 3 && (
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-foreground-muted" />
            <input
              type="text"
              placeholder="Search by plate, model, or driver..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 text-xs h-9 bg-surface/80 border border-border/80 rounded-xl focus:border-primary focus:outline-hidden"
            />
          </div>
        )}

        <div className="max-h-[250px] space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex h-24 w-full items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 text-xs font-medium text-foreground-muted">
              Loading available vehicles...
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="flex h-24 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 p-4 text-center">
              <p className="text-xs font-semibold text-foreground">No available pairs found</p>
              <p className="text-[11px] text-foreground-muted mt-0.5">
                Try clearing your search query or check driver schedules.
              </p>
            </div>
          ) : (
            filteredOptions.map((o) => {
              const isSelected = selection === o.value;
              const plateText = o.plateNumber || o.plate || "Vehicle";
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSelection(o.value)}
                  className={`w-full text-left p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between group ${
                    isSelected
                      ? "border-primary bg-primary/10 ring-2 ring-primary/20 shadow-xs"
                      : "border-border/60 bg-surface/60 hover:bg-hover hover:border-border"
                  }`}
                >
                  <div className="space-y-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-lg border border-border/80 bg-surface px-2.5 py-0.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
                        {plateText}
                      </span>
                      {o.model && (
                        <span className="text-xs font-bold text-foreground truncate max-w-[160px]">
                          {o.model}
                        </span>
                      )}
                      {o.seats && (
                        <span className="text-[11px] font-semibold text-foreground-muted bg-muted/60 px-2 py-0.5 rounded-full">
                          {o.seats} seats
                        </span>
                      )}
                      {o.isPinned && (
                        <span className="text-[11px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
                          Current Assignment
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-foreground-secondary pt-0.5">
                      <UserCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="font-semibold truncate">{o.driverName || "Assigned Driver"}</span>
                    </div>
                  </div>
                  <div className="shrink-0 pl-2">
                    {isSelected ? (
                      <CheckCircle2 className="w-5 h-5 text-primary" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border border-border/80 group-hover:border-primary/50 transition-colors" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {selectedOpt?.isPinned && (
          <div className="rounded-2xl border border-warning/30 bg-warning/5 p-3">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="min-w-0 text-xs text-foreground-secondary leading-relaxed">
                {selectedOpt.tooSmall
                  ? `${selectedOpt.plate} seats too few for ${passengers} passengers. Pick a larger vehicle.`
                  : selectedOpt.wrongCategory
                    ? `${selectedOpt.plate} isn't a ${requiredClass} vehicle. The existing assignment is kept.`
                    : selectedOpt.isRealPairing
                      ? `${selectedOpt.driverName} is off duty.`
                      : selectedOpt.driverId
                        ? `${selectedOpt.plate} and ${selectedOpt.driverName} are not a permanent pairing.`
                        : `${selectedOpt.plate} has no driver assigned.`}
              </p>
            </div>
          </div>
        )}

        <ConflictBlock conflicts={blocking} />
      </div>

      <DialogFooter className="px-6 py-4 border-t border-border/40">
        <Button variant="outline" onClick={() => onClose?.()}>
          Cancel
        </Button>
        {blocking.length > 0 && (
          <Button variant="destructive" disabled={isPending} onClick={() => submit(true)}>
            Override &amp; Assign
          </Button>
        )}
        <Button disabled={isPending || !selection} onClick={() => submit(false)} className="gap-2">
          <Send className="w-4 h-4" />
          {isPending ? "Assigning…" : "Assign"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function AssignDialog({ request, onClose, ...rest }) {
  return (
    <Dialog open={Boolean(request)} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent>
        {request && (
          <AssignForm key={request.request_id} request={request} onClose={onClose} {...rest} />
        )}
      </DialogContent>
    </Dialog>
  );
}
