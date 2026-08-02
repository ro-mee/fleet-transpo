"use client";

import { useState } from "react";
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
import { formatDateTime, formatDistance } from "@/lib/utils";
import { CheckCircle2, PlayCircle, TriangleAlert } from "lucide-react";

// Starting and completing a trip both stop here for an odometer reading.
//
// The reading is the one field a dispatcher cannot infer from the screen — it
// comes off the dashboard of the actual vehicle — and it is what the completion
// endpoint subtracts to derive trip distance, which in turn feeds fuel economy
// and mileage-based service scheduling. A trip closed without it leaves those
// NULL, so the board asks rather than guesses.
//
// Both actions submit to the TRIP endpoints, never to PUT /api/dispatch/[id]/
// status: only the trip routes advance the originating request and write its
// timeline. Those endpoints move the dispatch row's own status themselves.
const COPY = {
  start: {
    title: "Start Trip",
    description: "Record the reading shown on the vehicle before it departs.",
    label: "Starting odometer",
    action: "Start Trip",
    icon: PlayCircle,
  },
  complete: {
    title: "Complete Trip",
    description: "Record the reading on arrival. The distance travelled is derived from it.",
    label: "Ending odometer",
    action: "Complete Trip",
    icon: CheckCircle2,
  },
};

// pg returns DECIMAL as a string.
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function OdometerBody({ dispatch, mode, onClose, onSubmit, isPending }) {
  const copy = COPY[mode];
  const trip = dispatch?.latest_trip || null;
  const vehicle = dispatch?.vehicles || null;

  const startOdo = num(trip?.start_odometer);
  const lastKnown = num(vehicle?.mileage);

  // Seeded from the best reading we already hold, so the common case is a
  // confirmation rather than data entry. Keyed by dispatch id upstream, so the
  // initializer runs per dispatch and no effect is needed.
  const [value, setValue] = useState(() => {
    const seed = mode === "start" ? (startOdo ?? lastKnown) : (lastKnown ?? startOdo);
    return seed != null ? String(seed) : "";
  });

  const entered = num(value);
  const distance = mode === "complete" && entered != null && startOdo != null
    ? entered - startOdo
    : null;

  // The completion endpoint computes end - start and only stores the result when
  // positive; a reading below the start would silently drop distance to NULL.
  const tooLow = mode === "complete" && entered != null && startOdo != null && entered < startOdo;
  const invalid = entered == null || entered < 0 || tooLow;

  const submit = () => {
    if (invalid) return;
    onSubmit?.({
      dispatch,
      mode,
      body:
        mode === "start"
          ? { odometer: entered }
          : { end_odometer: entered, start_odometer: startOdo ?? 0 },
    });
  };

  return (
    <>
      <div className="space-y-3 px-6 pt-4">
        <div>
          <label className="text-sm font-medium text-foreground" htmlFor="trip-odometer">
            {copy.label} (km)
          </label>
          <Input
            id="trip-odometer"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.1"
            className="mt-1.5"
            value={value}
            autoFocus
            placeholder="e.g. 84210"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isPending && submit()}
          />
        </div>

        <dl className="space-y-1 rounded-lg bg-hover/50 px-3 py-2 text-xs">
          {vehicle && (
            <div className="flex justify-between gap-3">
              <dt className="text-foreground-muted">Vehicle</dt>
              <dd className="truncate text-foreground-secondary">
                {vehicle.plate_number}
                {vehicle.model ? ` · ${vehicle.model}` : ""}
              </dd>
            </div>
          )}
          {lastKnown != null && (
            <div className="flex justify-between gap-3">
              <dt className="text-foreground-muted">Last recorded</dt>
              <dd className="font-data text-foreground-secondary">{formatDistance(lastKnown)}</dd>
            </div>
          )}
          {mode === "complete" && (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-foreground-muted">Departed at</dt>
                <dd className="font-data text-foreground-secondary">
                  {startOdo != null ? formatDistance(startOdo) : "not recorded"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-foreground-muted">Distance travelled</dt>
                <dd className="font-data text-foreground">
                  {distance != null && distance >= 0 ? formatDistance(distance) : "—"}
                </dd>
              </div>
            </>
          )}
          {trip?.start_time && mode === "complete" && (
            <div className="flex justify-between gap-3">
              <dt className="text-foreground-muted">Started</dt>
              <dd className="text-foreground-secondary">{formatDateTime(trip.start_time)}</dd>
            </div>
          )}
        </dl>

        {tooLow ? (
          <p className="flex items-start gap-1.5 text-xs text-danger">
            <TriangleAlert className="mt-0.5 w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            The ending reading is below the starting reading ({formatDistance(startOdo)}). Distance
            would not be recorded.
          </p>
        ) : mode === "complete" && startOdo == null ? (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            No starting reading was recorded for this trip, so distance cannot be derived from it.
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onClose?.()}>
          Cancel
        </Button>
        <Button
          variant={mode === "complete" ? "success" : "default"}
          disabled={isPending || invalid}
          onClick={submit}
        >
          <copy.icon className="w-4 h-4 mr-2" />
          {isPending ? "Saving…" : copy.action}
        </Button>
      </DialogFooter>
    </>
  );
}

export function TripOdometerDialog({ dispatch, mode, onClose, ...rest }) {
  const copy = COPY[mode] || COPY.start;
  const open = Boolean(dispatch && mode && dispatch.latest_trip?.trip_id);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose?.()}>
      <DialogContent>
        {open && (
          <>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>
                {`${dispatch.dispatch_number || `DSP-${dispatch.dispatch_id}`} · ${copy.description}`}
              </DialogDescription>
            </DialogHeader>
            <OdometerBody
              key={`${mode}-${dispatch.dispatch_id}`}
              dispatch={dispatch}
              mode={mode}
              onClose={onClose}
              {...rest}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
