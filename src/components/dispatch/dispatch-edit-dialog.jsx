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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { getAvailableVehicles } from "@/services/vehicle.service";
import { getDrivers } from "@/services/driver.service";
import { formatDateTime } from "@/lib/utils";
import { Save, Shuffle } from "lucide-react";

// Edit one thing about an open dispatch: swap the vehicle, swap the driver, or
// change the notes. Three narrow forms rather than one wide edit screen, because
// each is a distinct decision a dispatcher makes mid-shift.
//
// All three submit to PUT /api/dispatch/[id], which re-syncs vehicle and driver
// status and re-checks the dispatch's trip. Reference lists load only while the
// dialog is open, and the form is keyed by dispatch id so useState initializers
// do the seeding (an effect would be a cascading render).
const TITLES = {
  vehicle: { title: "Reassign Vehicle", description: "Swap the vehicle committed to this dispatch." },
  driver: { title: "Reassign Driver", description: "Swap the driver committed to this dispatch." },
  notes: { title: "Dispatch Notes", description: "Free-text notes carried with this dispatch." },
};

function ReassignBody({ dispatch, mode, onClose, onSubmit, isPending }) {
  const isVehicle = mode === "vehicle";
  const [value, setValue] = useState(() => {
    const current = isVehicle ? dispatch?.vehicle_id : dispatch?.driver_id;
    return current ? String(current) : "";
  });

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery({
    queryKey: ["available-vehicles"],
    queryFn: () => getAvailableVehicles(),
    enabled: isVehicle,
  });
  const { data: drivers = [], isLoading: loadingDrivers } = useQuery({
    queryKey: ["drivers", { status: "Available" }],
    queryFn: () => getDrivers({ status: "Available" }),
    enabled: !isVehicle,
  });

  const loading = isVehicle ? loadingVehicles : loadingDrivers;
  const currentId = isVehicle ? dispatch?.vehicle_id : dispatch?.driver_id;
  const unchanged = String(currentId ?? "") === value;

  return (
    <>
      <div className="space-y-4 px-6 pt-4">
        <div>
          <label className="text-sm font-medium text-foreground">
            {isVehicle ? "Vehicle" : "Driver"}
          </label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger className="mt-1.5">
              <SelectValue
                placeholder={loading ? "Loading…" : `Select a ${isVehicle ? "vehicle" : "driver"}`}
              />
            </SelectTrigger>
            <SelectContent>
              {isVehicle
                ? vehicles.map((v) => (
                    <SelectItem key={v.vehicle_id} value={String(v.vehicle_id)}>
                      {v.plate_number}
                      {v.seating_capacity ? ` · ${v.seating_capacity} seats` : ""}
                      {v.model ? ` · ${v.model}` : ""}
                    </SelectItem>
                  ))
                : drivers.map((d) => (
                    <SelectItem key={d.driver_id} value={String(d.driver_id)}>
                      {d.employees?.first_name || d.first_name || "Driver"}{" "}
                      {d.employees?.last_name || d.last_name || `#${d.driver_id}`}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs text-foreground-muted">
            Only currently available {isVehicle ? "vehicles" : "drivers"} are listed. The dispatch
            keeps its schedule; the released {isVehicle ? "vehicle" : "driver"} returns to the pool.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onClose?.()}>
          Cancel
        </Button>
        <Button
          disabled={isPending || !value || unchanged}
          onClick={() =>
            onSubmit?.({
              dispatch,
              patch: isVehicle ? { vehicle_id: Number(value) } : { driver_id: Number(value) },
            })
          }
        >
          <Shuffle className="w-4 h-4 mr-2" />
          {isPending ? "Saving…" : "Reassign"}
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
      <DialogContent>
        {dispatch && mode && (
          <>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription>
                {`${dispatch.dispatch_number || `DSP-${dispatch.dispatch_id}`}${
                  dispatch.scheduled_departure
                    ? ` · departs ${formatDateTime(dispatch.scheduled_departure)}`
                    : ""
                }`}
              </DialogDescription>
            </DialogHeader>
            {mode === "notes" ? (
              <NotesBody
                key={`notes-${dispatch.dispatch_id}`}
                dispatch={dispatch}
                onClose={onClose}
                {...rest}
              />
            ) : (
              <ReassignBody
                key={`${mode}-${dispatch.dispatch_id}`}
                dispatch={dispatch}
                mode={mode}
                onClose={onClose}
                {...rest}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
