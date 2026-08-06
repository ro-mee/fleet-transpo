"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import {
  getDriverAssignments,
  assignDriverVehicle,
  releaseDriverAssignment,
} from "@/services/driver-assignment.service";
import { getVehicles } from "@/services/vehicle.service";
import { getDrivers } from "@/services/driver.service";
import { CarFront, User, Link2, Unlink, Loader2, History, Info } from "lucide-react";

// Custodial pairing card (migration 017), shared by the driver and vehicle detail
// pages. One component with a `side` prop rather than two near-identical ones:
// the pairing is symmetric — /api/driver-assignments takes the same
// {driver_id, vehicle_id} either way — so only the labels and which id is fixed
// actually differ.
//
// This is deliberately NOT the per-trip assignment. It records who is normally
// responsible for a car (fuel, cleanliness, damage). A dispatch that departs from
// it raises a warning, never a block.

const COPY = {
  driver: {
    title: "Assigned Vehicle",
    icon: CarFront,
    empty: "No vehicle is permanently assigned to this driver.",
    pickLabel: "Assign a vehicle",
    pickPlaceholder: "Select a vehicle",
    note: "The vehicle this driver is normally responsible for. Dispatch can still use a different one — it just flags the change.",
  },
  vehicle: {
    title: "Assigned Driver",
    icon: User,
    empty: "No driver is permanently responsible for this vehicle.",
    pickLabel: "Assign a driver",
    pickPlaceholder: "Select a driver",
    note: "The driver normally accountable for this vehicle's fuel, cleanliness, and condition.",
  },
};

/**
 * @param {object}  props
 * @param {"driver"|"vehicle"} props.side  which record this card is rendered on
 * @param {number}  props.id               that record's driver_id or vehicle_id
 * @param {boolean} props.canManage        caller's can("driver_assignments","create")
 */
export function AssignedVehicleCard({ side, id, canManage = false }) {
  const copy = COPY[side];
  const HeadIcon = copy.icon;
  const queryClient = useQueryClient();

  const [picked, setPicked] = useState("");
  const [releasing, setReleasing] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  // Set when the API answers 409 because the vehicle is held by someone else —
  // holds the payload needed to re-send the same request with force: true.
  const [displacing, setDisplacing] = useState(null);

  const filters = side === "driver" ? { driver_id: id } : { vehicle_id: id };

  const { data, isLoading } = useQuery({
    queryKey: ["driver-assignments", side, id, "history"],
    queryFn: () => getDriverAssignments({ ...filters, history: 1 }),
    enabled: !!id,
  });

  const all = data?.assignments ?? [];
  const active = all.find((a) => a.assigned_until == null) ?? null;
  const past = all.filter((a) => a.assigned_until != null);

  // Only needed to populate the picker, so don't fetch it for a read-only viewer.
  // Both list endpoints answer with a bare array, not a wrapped envelope.
  const { data: options } = useQuery({
    queryKey: ["driver-assignments-options", side],
    queryFn: () => (side === "driver" ? getVehicles() : getDrivers()),
    enabled: canManage && !active,
  });

  const choices = useMemo(() => {
    const rows = Array.isArray(options) ? options : [];
    return rows.map((r) =>
      side === "driver"
        ? {
            value: String(r.vehicle_id),
            label: [r.plate_number, r.vehicle_name].filter(Boolean).join(" · ") || `Vehicle #${r.vehicle_id}`,
          }
        : {
            // /api/drivers nests the person under `employees`; the assignment
            // endpoint returns the same name flattened. Read both.
            value: String(r.driver_id),
            label:
              `${r.employees?.first_name || r.first_name || ""} ${r.employees?.last_name || r.last_name || ""}`.trim() ||
              `Driver #${r.driver_id}`,
          }
    );
  }, [options, side]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["driver-assignments"] });
    // The queue's warning chips are derived from these pairings server-side.
    queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
  };

  const assignMutation = useMutation({
    mutationFn: (vars) =>
      assignDriverVehicle(
        side === "driver"
          ? { driver_id: id, vehicle_id: Number(vars.otherId), force: vars.force }
          : { driver_id: Number(vars.otherId), vehicle_id: id, force: vars.force }
      ),
    onSuccess: () => {
      toast.success("Assignment saved");
      setPicked("");
      setDisplacing(null);
      invalidate();
    },
    onError: (err, vars) => {
      // 409 + requires_force means another driver currently holds this vehicle.
      // Ask before displacing them rather than silently taking the car.
      if (err.status === 409 && err.data?.requires_force) {
        setDisplacing({ otherId: vars.otherId, message: err.message, current: err.data.current_assignment });
        return;
      }
      toast.error(err.message || "Failed to save assignment");
    },
  });

  const releaseMutation = useMutation({
    mutationFn: (assignmentId) => releaseDriverAssignment(assignmentId, "Released"),
    onSuccess: () => {
      toast.success("Assignment released");
      setReleasing(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to release assignment");
      setReleasing(null);
    },
  });

  const busy = assignMutation.isPending || releaseMutation.isPending;

  const activeLabel = active
    ? side === "driver"
      ? [active.plate_number, active.vehicle_name].filter(Boolean).join(" · ") || `Vehicle #${active.vehicle_id}`
      : `${active.first_name || ""} ${active.last_name || ""}`.trim() || `Driver #${active.driver_id}`
    : null;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <HeadIcon className="w-4 h-4 text-primary" /> {copy.title}
          </span>
          {active && <Badge variant="success">Assigned</Badge>}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="h-20 rounded-xl bg-muted animate-pulse" />
        ) : active ? (
          <div className="p-4 rounded-xl bg-muted/30 border border-border space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">{activeLabel}</span>
              {side === "driver" && active.vehicle_status && (
                <Badge variant={active.vehicle_status === "Available" ? "success" : "warning"}>
                  {active.vehicle_status}
                </Badge>
              )}
            </div>
            <p className="text-xs text-foreground-secondary">
              Since {formatDate(active.assigned_from)}
              {active.notes ? ` · ${active.notes}` : ""}
            </p>
            {canManage && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setReleasing(active)}
                className="mt-1"
              >
                <Unlink className="w-3.5 h-3.5 mr-1.5" /> Release
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-foreground-secondary">{copy.empty}</p>
            {canManage && (
              <div className="space-y-2">
                <Select value={picked || undefined} onValueChange={setPicked}>
                  <SelectTrigger className="w-full text-left font-normal truncate">
                    <SelectValue placeholder={copy.pickPlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!picked || busy}
                  onClick={() => assignMutation.mutate({ otherId: picked })}
                >
                  {assignMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</>
                  ) : (
                    <><Link2 className="w-3.5 h-3.5 mr-1.5" /> {copy.pickLabel}</>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-foreground-muted flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>{copy.note}</span>
        </p>

        {past.length > 0 && (
          <div className="pt-1 border-t border-border">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="text-xs text-foreground-secondary hover:text-foreground flex items-center gap-1.5 py-1.5 transition-colors"
              aria-expanded={showHistory}
            >
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              {showHistory ? "Hide" : "Show"} previous assignments ({past.length})
            </button>
            {showHistory && (
              <ul className="space-y-1.5 mt-1">
                {past.map((a) => (
                  <li key={a.assignment_id} className="text-xs text-foreground-secondary flex flex-wrap gap-x-2">
                    <span className="font-medium text-foreground">
                      {side === "driver"
                        ? a.plate_number || `Vehicle #${a.vehicle_id}`
                        : `${a.first_name || ""} ${a.last_name || ""}`.trim() || `Driver #${a.driver_id}`}
                    </span>
                    <span>
                      {formatDate(a.assigned_from)} – {formatDate(a.assigned_until)}
                    </span>
                    {a.release_reason && <span className="text-foreground-muted">({a.release_reason})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!releasing}
        onOpenChange={(open) => !open && setReleasing(null)}
        title="Release this assignment?"
        message="The pairing is closed and kept in history. Both sides become free to reassign. This does not affect any scheduled trips."
        confirmLabel="Release"
        variant="warning"
        onConfirm={() => releasing && releaseMutation.mutate(releasing.assignment_id)}
      />

      <ConfirmDialog
        open={!!displacing}
        onOpenChange={(open) => !open && setDisplacing(null)}
        title="Reassign this vehicle?"
        message={displacing?.message || "This vehicle is already assigned to another driver."}
        confirmLabel="Reassign"
        variant="warning"
        onConfirm={() =>
          displacing && assignMutation.mutate({ otherId: displacing.otherId, force: true })
        }
      />
    </Card>
  );
}
