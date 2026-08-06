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
import { Send, Info } from "lucide-react";

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
  const { data: pairingData } = useQuery({
    queryKey: ["driver-assignments", "active"],
    queryFn: () => getDriverAssignments(),
  });

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
  }, [request, options, vehicles, drivers, pairingData, seatsTooFew, reqCategoryId]);

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

  return (
    <>
      <DialogHeader>
        <DialogTitle>Assign Resources</DialogTitle>
        <DialogDescription>
          {`${request.reservation_number || `REQ-${request.request_id}`} · pickup ${formatDateTime(request.pickup_datetime)}`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 px-6 pt-4">
        <div>
          <label className="text-sm font-medium text-foreground">Vehicle &amp; Driver</label>
          {requiredClass && (
            <p className="mt-0.5 text-xs text-foreground-muted">
              {requiredClass} only — the class this request was booked as.
            </p>
          )}
          <Select value={selection} onValueChange={setSelection}>
            <SelectTrigger className="mt-1.5">
              <SelectValue
                placeholder={
                  loadingVehicles || loadingDrivers ? "Loading…" : "Select a vehicle"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {allOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {request.passenger_count > 1 && (
            <p className="mt-1 text-xs text-foreground-muted">
              Needs seating for {request.passenger_count}.
            </p>
          )}
          {hiddenCount > 0 && (
            <p className="mt-1 text-xs text-foreground-muted">
              {hiddenCount} available {hiddenCount === 1 ? "vehicle isn't" : "vehicles aren't"}{" "}
              listed — {requiredClass ? "a different class, " : ""}too few seats for this request,
              no assigned driver, or that driver is off duty.
            </p>
          )}
        </div>

        {selectedOpt?.isPinned && (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 w-4 h-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="min-w-0 text-sm text-foreground-secondary">
                {selectedOpt.tooSmall
                  ? `${selectedOpt.plate} seats too few for ${passengers} passengers, so it isn't in the list above. Saving this will be refused — pick a larger vehicle.`
                  : selectedOpt.wrongCategory
                    ? `${selectedOpt.plate} isn't a ${requiredClass} vehicle, so it isn't in the list above. The existing assignment is kept as it is.`
                    : selectedOpt.isRealPairing
                      ? `${selectedOpt.driverName} is off duty, so this pairing isn't in the list above. The existing assignment is kept as it is.`
                      : selectedOpt.driverId
                        ? `${selectedOpt.plate} and ${selectedOpt.driverName} are not a permanent pairing. This assignment is kept as it is.`
                        : `${selectedOpt.plate} has no driver assigned. Assign one on the vehicle's page, or keep this as a vehicle-only assignment.`}
              </p>
            </div>
          </div>
        )}

        <ConflictBlock conflicts={blocking} />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onClose?.()}>
          Cancel
        </Button>
        {blocking.length > 0 && (
          <Button variant="destructive" disabled={isPending} onClick={() => submit(true)}>
            Override &amp; Assign
          </Button>
        )}
        <Button disabled={isPending || !selection} onClick={() => submit(false)}>
          <Send className="w-4 h-4 mr-2" />
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
