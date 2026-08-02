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
import { formatDateTime } from "@/lib/utils";
import { Send } from "lucide-react";

// Commit a vehicle and/or driver to an approved request.
//
// The endpoint refuses a blocking conflict with 409 unless { force: true }. Those
// conflicts arrive on the thrown error's `data.conflicts` (see lib/api/client)
// and are shown here with an explicit override button — the dispatcher sees
// exactly what they are overriding, and the server records the override on the
// timeline. Reference lists load only while the dialog is open.
//
// The inner form is keyed by request id below, so the selects seed from whatever
// is already assigned via useState initializers. Syncing that with an effect
// instead would be a cascading render (react-hooks/set-state-in-effect).
function AssignForm({ request, onClose, onSubmit, isPending, conflictError }) {
  const [vehicleId, setVehicleId] = useState(
    request?.vehicle_id ? String(request.vehicle_id) : ""
  );
  const [driverId, setDriverId] = useState(
    request?.driver_id ? String(request.driver_id) : ""
  );

  const { data: vehicles = [], isLoading: loadingVehicles } = useQuery({
    queryKey: ["available-vehicles"],
    queryFn: () => getAvailableVehicles(),
  });
  const { data: drivers = [], isLoading: loadingDrivers } = useQuery({
    queryKey: ["drivers", { status: "Available" }],
    queryFn: () => getDrivers({ status: "Available" }),
  });

  const blocking = conflictError?.data?.conflicts || [];
  const submit = (force) =>
    onSubmit?.({
      request,
      vehicleId: vehicleId ? Number(vehicleId) : null,
      driverId: driverId ? Number(driverId) : null,
      force,
    });

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
          <label className="text-sm font-medium text-foreground">Vehicle</label>
          <Select value={vehicleId} onValueChange={setVehicleId}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder={loadingVehicles ? "Loading…" : "Select a vehicle"} />
            </SelectTrigger>
            <SelectContent>
              {vehicles.map((v) => (
                <SelectItem key={v.vehicle_id} value={String(v.vehicle_id)}>
                  {v.plate_number}
                  {v.seating_capacity ? ` · ${v.seating_capacity} seats` : ""}
                  {v.model ? ` · ${v.model}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {request.passenger_count > 1 && (
            <p className="mt-1 text-xs text-foreground-muted">
              Needs seating for {request.passenger_count}.
            </p>
          )}
        </div>

        <div>
          <label className="text-sm font-medium text-foreground">Driver</label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder={loadingDrivers ? "Loading…" : "Select a driver"} />
            </SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.driver_id} value={String(d.driver_id)}>
                  {d.employees?.first_name || d.first_name || "Driver"}{" "}
                  {d.employees?.last_name || d.last_name || `#${d.driver_id}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
        <Button disabled={isPending || (!vehicleId && !driverId)} onClick={() => submit(false)}>
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
