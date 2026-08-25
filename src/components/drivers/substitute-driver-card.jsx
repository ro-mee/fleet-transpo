"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import {
  getSubstituteSchedules,
  createSubstituteSchedule,
  deleteSubstituteSchedule,
} from "@/services/substitute-driver.service";
import { getDrivers } from "@/services/driver.service";
import {
  UserCheck, UserPlus, Trash2, Loader2, CalendarDays, Info, Infinity as InfinityIcon,
} from "lucide-react";

/**
 * Substitute driver coverage for a vehicle (migration 032).
 *
 * A vehicle whose designated custodian is suspended or otherwise unavailable
 * must not be recommended/dispatched to anyone until a substitute is explicitly
 * scheduled. This card lets fleet managers pick a day (or open-ended range)
 * and a substitute driver — restricted to drivers with NO currently assigned
 * custodial vehicle — so the vehicle can be recommended again on those dates.
 */
export function SubstituteDriverCard({ id, canManage = false }) {
  const queryClient = useQueryClient();

  const [driverId, setDriverId] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [removing, setRemoving] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["substitute-schedules", id],
    queryFn: () => getSubstituteSchedules({ vehicle_id: id }),
    enabled: !!id,
  });

  const schedules = data?.schedules ?? [];

  // Substitutes must be drivers with no currently-assigned custodial vehicle.
  const { data: driverOptions } = useQuery({
    queryKey: ["drivers", "unassigned", "Available"],
    queryFn: () => getDrivers({ status: "Available", unassigned: 1 }),
    enabled: canManage,
  });

  const driverChoices = useMemo(() => {
    const rows = Array.isArray(driverOptions) ? driverOptions : [];
    return rows.map((d) => ({
      value: String(d.driver_id),
      label:
        `${d.employees?.first_name || d.first_name || ""} ${d.employees?.last_name || d.last_name || ""}`.trim() ||
        `Driver #${d.driver_id}`,
    }));
  }, [driverOptions]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["substitute-schedules"] });
    // The recommendation / queue chips derive from these schedules server-side.
    queryClient.invalidateQueries({ queryKey: ["reservation-recommendation"] });
    queryClient.invalidateQueries({ queryKey: ["transport-requests"] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createSubstituteSchedule({
        vehicle_id: id,
        substitute_driver_id: Number(driverId),
        ...(from ? { effective_from: from } : {}),
        ...(until ? { effective_until: until } : {}),
        ...(notes ? { notes } : {}),
      }),
    onSuccess: () => {
      toast.success("Substitute driver scheduled");
      setDriverId("");
      setFrom("");
      setUntil("");
      setNotes("");
      invalidate();
    },
    onError: (e) => toast.error(e.message || "Failed to schedule substitute driver"),
  });

  const removeMutation = useMutation({
    mutationFn: (scheduleId) => deleteSubstituteSchedule(scheduleId),
    onSuccess: () => {
      toast.success("Substitute schedule removed");
      setRemoving(null);
      invalidate();
    },
    onError: (e) => {
      toast.error(e.message || "Failed to remove substitute schedule");
      setRemoving(null);
    },
  });

  const canSubmit = driverId && !createMutation.isPending;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-primary" /> Substitute Driver
          </span>
          {schedules.length > 0 && <Badge variant="outline">{schedules.length}</Badge>}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <p className="text-[11px] text-foreground-muted flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>
            When this vehicle{"'"}s designated driver is suspended or unavailable, the vehicle stays
            hidden from recommendations until a substitute is scheduled here. The substitute must
            have no vehicle of their own.
          </span>
        </p>

        {isLoading ? (
          <div className="h-20 rounded-xl bg-muted animate-pulse" />
        ) : schedules.length > 0 ? (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li
                key={s.substitute_id}
                className="p-3 rounded-xl bg-muted/30 border border-border space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {`${s.first_name || ""} ${s.last_name || ""}`.trim() || `Driver #${s.substitute_driver_id}`}
                  </span>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-foreground-muted hover:text-danger"
                      disabled={removeMutation.isPending}
                      onClick={() => setRemoving(s)}
                      aria-label="Remove substitute schedule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
                <p className="text-[11px] text-foreground-secondary flex items-center gap-1.5">
                  <CalendarDays className="w-3 h-3 shrink-0" />
                  {s.effective_until == null ? (
                    <span>Effective {formatDate(s.effective_from)} · open-ended</span>
                  ) : (
                    <span>
                      {formatDate(s.effective_from)} – {formatDate(s.effective_until)}
                    </span>
                  )}
                  {s.notes && <span className="text-foreground-muted">· {s.notes}</span>}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-foreground-secondary">No substitute driver scheduled for this vehicle.</p>
        )}

        {canManage && (
          <div className="pt-1 border-t border-border space-y-3">
            <div className="space-y-2">
              <Select value={driverId || undefined} onValueChange={setDriverId}>
                <SelectTrigger className="w-full text-left font-normal truncate">
                  <SelectValue placeholder="Select substitute driver (no assigned car)" />
                </SelectTrigger>
                <SelectContent>
                  {driverChoices.length === 0 ? (
                    <SelectItem value="__none__" disabled>No unassigned drivers available</SelectItem>
                  ) : (
                    driverChoices.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>

              <div className="grid grid-cols-2 gap-2">
                <DatePicker
                  id="from"
                  label="From"
                  value={from}
                  onChange={(val) => setFrom(val || "")}
                />
                <DatePicker
                  id="until"
                  label="Until (optional)"
                  value={until}
                  onChange={(val) => setUntil(val || "")}
                />
              </div>

              <Input
                type="text"
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />

              <div className="flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-foreground-muted flex items-center gap-1">
                  <InfinityIcon className="w-3 h-3" /> leaving &quot;Until&quot; blank = open-ended
                </span>
                <Button size="sm" disabled={!canSubmit} onClick={() => createMutation.mutate()}>
                  {createMutation.isPending ? (
                    <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</>
                  ) : (
                    <><UserPlus className="w-3.5 h-3.5 mr-1.5" /> Schedule Substitute</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remove this substitute schedule?"
        message="The vehicle will stop appearing in recommendations on these dates until another substitute is scheduled. This does not affect any scheduled trips."
        confirmLabel="Remove"
        variant="warning"
        onConfirm={() => removing && removeMutation.mutate(removing.substitute_id)}
      />
    </Card>
  );
}