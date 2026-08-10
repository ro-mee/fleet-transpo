"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getAvailableVehicles } from "@/services/vehicle.service";
import { getDrivers } from "@/services/driver.service";
import { getDriverAssignments } from "@/services/driver-assignment.service";
import { formatDateTime } from "@/lib/utils";
import { Save, Shuffle, UserCheck, CheckCircle2, Search, Users, AlertCircle, CarFront } from "lucide-react";

const TITLES = {
  assign: {
    title: "Reassign Dispatch",
    description: "Swap the vehicle and driver committed to this dispatch.",
  },
  notes: { title: "Dispatch Notes", description: "Free-text notes carried with this dispatch." },
};

function AssignBody({ dispatch, onClose, onSubmit, isPending }) {
  const departure = dispatch?.scheduled_departure;
  const returnAt = dispatch?.scheduled_arrival || null;
  const passengers = Number(dispatch?.transportation_requests?.passenger_count) || 1;

  const [selection, setSelection] = useState(() =>
    dispatch?.vehicle_id || dispatch?.driver_id
      ? `${dispatch.vehicle_id ?? ""}:${dispatch.driver_id ?? ""}`
      : ""
  );
  const [searchQuery, setSearchQuery] = useState("");

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery({
    queryKey: ["available-vehicles", departure],
    queryFn: () =>
      getAvailableVehicles(
        departure
          ? { pickup_at: departure, ...(returnAt ? { return_at: returnAt } : {}) }
          : {}
      ),
  });
  const { data: drivers = [], isLoading: loadingDrivers } = useQuery({
    queryKey: ["drivers", { status: "Available", pickup_at: departure }],
    queryFn: () =>
      getDrivers({
        status: "Available",
        ...(departure ? { pickup_at: departure } : {}),
      }),
  });
  const { data: pairingData, isLoading: loadingPairings } = useQuery({
    queryKey: ["driver-assignments", "active"],
    queryFn: () => getDriverAssignments(),
  });

  const seatsTooFew = (v) => {
    const seats = Number(v?.seating_capacity) || 0;
    return seats > 0 && seats < passengers;
  };

  const vById = new Map(vehicles.map((v) => [v.vehicle_id, v]));
  const onDuty = new Set(drivers.map((d) => d.driver_id));

  const options = (pairingData?.assignments ?? [])
    .filter((a) => {
      const v = vById.get(a.vehicle_id);
      return v && onDuty.has(a.driver_id) && !seatsTooFew(v);
    })
    .map((a) => {
      const v = vById.get(a.vehicle_id);
      const driverName =
        `${a?.employees?.first_name || a?.first_name || ""} ${a?.employees?.last_name || a?.last_name || ""}`.trim() ||
        `Driver #${a.driver_id}`;
      return {
        value: `${a.vehicle_id}:${a.driver_id}`,
        vehicleId: a.vehicle_id,
        driverId: a.driver_id,
        plateNumber: v.plate_number,
        model: v.model || "Standard Vehicle",
        seats: v.seating_capacity,
        driverName,
      };
    })
    .sort((a, b) => a.plateNumber.localeCompare(b.plateNumber));

  const filteredOptions = options.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.plateNumber.toLowerCase().includes(q) ||
      o.model.toLowerCase().includes(q) ||
      o.driverName.toLowerCase().includes(q)
    );
  });

  const unchanged =
    String(dispatch?.vehicle_id ?? "") === selection.split(":")[0] &&
    String(dispatch?.driver_id ?? "") === selection.split(":")[1];

  const submit = () => {
    const [v, d] = selection.split(":");
    const patch = {};
    if (v) patch.vehicle_id = Number(v);
    if (d) patch.driver_id = Number(d);
    onSubmit?.({ dispatch, patch });
  };

  const loading = loadingVehicles || loadingDrivers || loadingPairings;

  return (
    <>
      <div className="space-y-4 px-6 pt-2 pb-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-foreground-secondary">
            Select Custodial Pair (Vehicle &amp; Driver)
          </label>
          {passengers > 1 && (
            <Badge variant="outline" className="gap-1 text-[11px] font-semibold text-primary">
              <Users className="w-3 h-3" />
              Min. {passengers} Seats Required
            </Badge>
          )}
        </div>

        {options.length > 3 && (
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-foreground-muted" />
            <Input
              placeholder="Search by plate number, model, or driver..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-xs h-9 bg-surface/80 border-border/80 rounded-xl"
            />
          </div>
        )}

        <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex h-28 w-full items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 text-xs font-medium text-foreground-muted">
              Loading available pairs…
            </div>
          ) : filteredOptions.length === 0 ? (
            <div className="flex h-28 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 p-4 text-center">
              <AlertCircle className="w-5 h-5 text-warning mb-1" />
              <p className="text-xs font-semibold text-foreground">No matching pairs available</p>
              <p className="text-[11px] text-foreground-muted mt-0.5">
                {options.length === 0
                  ? "No eligible vehicles & drivers are currently on duty."
                  : "Try clearing your search query."}
              </p>
            </div>
          ) : (
            filteredOptions.map((o) => {
              const isSelected = selection === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSelection(o.value)}
                  className={`w-full text-left p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between group ${
                    isSelected
                      ? "border-primary bg-primary/10 shadow-xs ring-2 ring-primary/20"
                      : "border-border/60 bg-surface/60 hover:bg-hover hover:border-border"
                  }`}
                >
                  <div className="space-y-1 min-w-0 pr-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center rounded-lg border border-border/80 bg-surface px-2.5 py-0.5 font-data text-xs font-bold tracking-wide text-foreground shadow-2xs">
                        {o.plateNumber}
                      </span>
                      <span className="text-xs font-bold text-foreground truncate max-w-[180px]">
                        {o.model}
                      </span>
                      {o.seats && (
                        <span className="text-[11px] font-semibold text-foreground-muted bg-muted/60 px-2 py-0.5 rounded-full">
                          {o.seats} seats
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-foreground-secondary pt-0.5">
                      <UserCheck className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span className="font-semibold truncate">{o.driverName}</span>
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

        <p className="text-[11px] text-foreground-muted leading-relaxed">
          Pick the vehicle and its assigned driver together. Reassigning will automatically flip
          interrupted dispatches back to <span className="font-bold text-foreground">Scheduled</span> status.
        </p>
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button variant="outline" onClick={() => onClose?.()}>
          Cancel
        </Button>
        <Button disabled={isPending || !selection || unchanged} onClick={submit} className="gap-2">
          <Shuffle className="w-4 h-4" />
          {isPending ? "Reassigning…" : "Reassign Pair"}
        </Button>
      </DialogFooter>
    </>
  );
}

function NotesBody({ dispatch, onClose, onSubmit, isPending }) {
  const [notes, setNotes] = useState(dispatch?.notes || "");
  const unchanged = (dispatch?.notes || "") === notes;

  return (
    <>
      <div className="space-y-2 px-6 pt-4">
        <label className="text-sm font-medium text-foreground" htmlFor="dispatch-notes">
          Notes
        </label>
        <Input
          id="dispatch-notes"
          value={notes}
          maxLength={1000}
          placeholder="e.g. Guest requested a stop at the pharmacy"
          onChange={(e) => setNotes(e.target.value)}
        />
        <p className="text-xs text-foreground-muted">{notes.length}/1000</p>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onClose?.()}>
          Cancel
        </Button>
        <Button
          disabled={isPending || unchanged}
          onClick={() => onSubmit?.({ dispatch, patch: { notes: notes || null } })}
        >
          <Save className="w-4 h-4 mr-2" />
          {isPending ? "Saving…" : "Save Notes"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function DispatchEditDialog({ dispatch, mode, onClose, ...rest }) {
  const copy = TITLES[mode] || TITLES.notes;

  return (
    <Dialog open={Boolean(dispatch && mode)} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden rounded-3xl border-border/80 bg-surface shadow-2xl">
        {dispatch && mode && (
          <div className="space-y-4 py-4">
            <DialogHeader className="border-b border-border/40 px-6 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 shadow-2xs">
                  <Shuffle className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold text-foreground">{copy.title}</DialogTitle>
                  <DialogDescription className="text-xs mt-0.5 text-foreground-muted">
                    {`${dispatch.dispatch_number || `DSP-${dispatch.dispatch_id}`}${
                      dispatch.scheduled_departure
                        ? ` · departs ${formatDateTime(dispatch.scheduled_departure)}`
                        : ""
                    }`}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
            {mode === "notes" ? (
              <NotesBody
                key={`notes-${dispatch.dispatch_id}`}
                dispatch={dispatch}
                onClose={onClose}
                {...rest}
              />
            ) : (
              <AssignBody
                key={`assign-${dispatch.dispatch_id}`}
                dispatch={dispatch}
                onClose={onClose}
                {...rest}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
