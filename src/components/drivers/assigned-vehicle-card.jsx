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
import { getSubstituteSchedules } from "@/services/substitute-driver.service";
import { getVehicles } from "@/services/vehicle.service";
import { getDrivers } from "@/services/driver.service";
import { CarFront, User, Link2, Unlink, Loader2, History, Info, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

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
  const [displacingVehicleId, setDisplacingVehicleId] = useState(null);

  // When a reassignment would displace the current holder, also check whether
  // that vehicle has a substitute driver actively covering it today. If so, we
  // surface it in the confirm dialog before letting the manager override it.
  const { data: substitutesData } = useQuery({
    queryKey: ["driver-assignments-substitute", displacingVehicleId],
    queryFn: () => getSubstituteSchedules({ vehicle_id: displacingVehicleId }),
    enabled: !!displacingVehicleId,
  });

  const coveringSubstitute = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
    return (substitutesData?.schedules ?? []).find((s) => {
      if (s.effective_until != null && todayKey > s.effective_until) return false;
      if (s.effective_from != null && todayKey < s.effective_from) return false;
      return true;
    }) ?? null;
  }, [substitutesData]);

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
      setDisplacingVehicleId(null);
      invalidate();
    },
    onError: (err, vars) => {
      // 409 + requires_force means another driver currently holds this vehicle.
      // Ask before displacing them rather than silently taking the car.
      if (err.status === 409 && err.data?.requires_force) {
        setDisplacing({ otherId: vars.otherId, message: err.message, current: err.data.current_assignment });
        setDisplacingVehicleId(Number(vars.otherId));
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
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-hover text-foreground-secondary shadow-xs">
                <HeadIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="pt-1.5 text-[13px] leading-relaxed text-foreground-secondary">{copy.empty}</p>
            </div>
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

      <Dialog
        open={!!displacing}
        onOpenChange={(open) => {
          if (!open) {
            setDisplacing(null);
            setDisplacingVehicleId(null);
          }
        }}
      >
        <DialogContent className="max-w-md w-[95vw] md:w-[440px] p-0 overflow-hidden rounded-3xl bg-surface border border-border/80 shadow-2xl">
          <div className="p-6 pb-4">
            <div className="flex items-start gap-3.5">
              <div className={`w-11 h-11 rounded-2xl ${coveringSubstitute ? "bg-warning/10 border-warning/30 text-warning" : "bg-muted border-border text-foreground-secondary"} border flex items-center justify-center shrink-0 shadow-2xs`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 pt-0.5">
                <h3 className="text-base font-bold text-foreground tracking-tight">
                  Reassign this vehicle?
                </h3>
                <p className="text-xs text-foreground-secondary mt-1 leading-relaxed">
                  {displacing?.message || "This vehicle is currently assigned to another active driver."}
                </p>
              </div>
            </div>

            {coveringSubstitute && (
              <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="leading-relaxed">
                  Active substitute coverage in effect:{" "}
                  <strong className="font-bold">
                    {[coveringSubstitute.first_name, coveringSubstitute.last_name].filter(Boolean).join(" ") ||
                      `driver #${coveringSubstitute.substitute_driver_id}`}
                  </strong>
                  {coveringSubstitute.effective_until
                    ? ` (until ${coveringSubstitute.effective_until}).`
                    : " (open-ended)."}{" "}
                  Reassigning will override this temporary coverage.
                </span>
              </div>
            )}
          </div>

          <div className="px-6 py-3.5 border-t border-border/70 bg-surface/90 backdrop-blur-md flex items-center justify-end gap-2.5">
            <Button variant="outline" size="sm" onClick={() => { setDisplacing(null); setDisplacingVehicleId(null); }} className="text-xs h-9 px-4">
              Cancel
            </Button>
            <Button
              variant="warning"
              size="sm"
              onClick={() => {
                displacing && assignMutation.mutate({ otherId: displacing.otherId, force: true });
                setDisplacing(null);
                setDisplacingVehicleId(null);
              }}
              className="text-xs h-9 px-4 font-semibold shadow-xs"
            >
              Reassign Vehicle
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
