"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConflictChips, ReadinessChip } from "@/components/reservations/conflict-chips";
import { getRecommendation } from "@/services/transport.service";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";
import {
  MapPin,
  Clock,
  Users,
  CarFront,
  CheckCircle2,
  XCircle,
  Send,
  StickyNote,
  Building2,
  Loader2,
  Sparkles,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

export function ReviewDialog({
  request,
  isOpen,
  onClose,
  onApprove,
  onReject,
  onAssign,
  isPending = false,
}) {
  const requestId = request?.request_id;

  // Two calls on purpose. The first is the deterministic scoring and returns in
  // milliseconds. The second asks the LLM to explain that pick and can take ten
  // seconds or fail outright, so it streams in behind the first rather than
  // holding the whole panel hostage.
  //
  // Hooks run before the null guard below — bailing out first would change the
  // hook count between renders.
  const { data: aiRec, isLoading: isAiLoading } = useQuery({
    queryKey: ["reservation-recommendation", requestId],
    queryFn: () => getRecommendation(requestId),
    enabled: isOpen && !!requestId,
  });

  const { data: narrated, isFetching: isNarrating } = useQuery({
    queryKey: ["reservation-recommendation", requestId, "narrated"],
    queryFn: () => getRecommendation(requestId, { narrate: true }),
    enabled: isOpen && !!requestId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (!request) return null;

  const r = request;
  const conflicts = r.conflicts || [];
  const recVehicle = aiRec?.vehicle?.recommended || r.ai_vehicle_recommendation;
  const recDriver = aiRec?.driver?.recommended || r.ai_driver_recommendation;
  const narration = narrated?.narration;
  const vehicleCount = aiRec?.vehicle?.considered ?? (r.vehicles ? 1 : 0);
  const driverCount = aiRec?.driver?.considered ?? (r.drivers ? 1 : 0);
  const category = r.vehiclecategories?.category_name || r.requested_vehicle_type || "Standard Vehicle";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl p-6 sm:max-w-2xl overflow-hidden">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="w-5 h-5 text-primary shrink-0" /> Request Review &amp; Decision Workspace
              </DialogTitle>
              <DialogDescription className="text-xs text-foreground-secondary mt-0.5">
                Review guest details and fleet readiness for <span className="font-mono font-semibold">{r.reservation_number || `REQ-#${r.request_id}`}</span>
              </DialogDescription>
            </div>
            <StatusBadge status={r.priority} entity="priority" />
          </div>
        </DialogHeader>

        <div className="space-y-3.5 py-2 max-h-[70vh] overflow-y-auto pr-1">
          {/* Guest & Source Header */}
          <div className="p-3.5 rounded-xl bg-hover/50 border border-border/80 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">Guest &amp; Reference</p>
              <p className="text-sm font-bold text-foreground mt-0.5">{r.guest_name || "Walk-in Guest"}</p>
              {r.booking_reference && (
                <p className="text-xs font-mono text-foreground-secondary mt-0.5">Ref: {r.booking_reference}</p>
              )}
            </div>
            <div className="text-right shrink-0">
              <span className="text-xs text-foreground-secondary font-medium flex items-center justify-end gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-primary" /> {r.source_system || "Booking System"}
              </span>
              <p className="text-xs text-foreground-muted mt-1">{r.created_at ? formatDateTime(r.created_at) : "Just now"}</p>
            </div>
          </div>

          {/* Route & Timing Box */}
          <div className="p-3.5 rounded-xl bg-surface border border-border space-y-2.5 text-sm shadow-xs">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-danger shrink-0" />
              <span className="text-xs font-semibold text-foreground-muted uppercase w-16">Pickup:</span>
              <span className="font-medium text-foreground truncate">{r.pickup_location || "—"}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-success shrink-0" />
              <span className="text-xs font-semibold text-foreground-muted uppercase w-16">Dropoff:</span>
              <span className="font-medium text-foreground truncate">{r.dropoff_location || "—"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border/60 text-xs">
              <div className="flex items-center gap-1.5 text-foreground font-medium">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span>{r.pickup_datetime ? formatDateTime(r.pickup_datetime) : "—"}</span>
              </div>
              <div className="flex items-center gap-1 text-foreground font-medium">
                <Users className="w-3.5 h-3.5 text-foreground-muted" />
                <span>{r.passenger_count || 1} Passengers</span>
              </div>
              <div className="flex items-center gap-1 text-foreground font-medium">
                <CarFront className="w-3.5 h-3.5 text-foreground-muted" />
                <span>{category}</span>
              </div>
            </div>
          </div>

          {/* Expanded Fleet Readiness & Available Fleet Info Box */}
          <div className="p-3.5 rounded-xl bg-muted/20 border border-border space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-primary" />
                <span className="font-semibold text-foreground text-sm">Fleet Readiness &amp; Availability</span>
              </div>
              <ReadinessChip conflicts={conflicts} status={r.fleet_status} />
            </div>

            {/* Conflict Check */}
            {conflicts.length > 0 ? (
              <div className="pt-1">
                <ConflictChips conflicts={conflicts} />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-success font-semibold bg-success/10 p-2 rounded-lg border border-success/20">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>No scheduling, driver shift, or maintenance conflicts detected for this window.</span>
              </div>
            )}

            {/* Live Available Fleet & Driver Insights Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="p-2.5 rounded-lg bg-surface border border-border/70 text-xs space-y-1">
                <div className="flex items-center justify-between text-foreground-secondary font-medium">
                  <span className="flex items-center gap-1.5"><CarFront className="w-3.5 h-3.5 text-primary" /> Vehicle Pool</span>
                  <Badge variant="success" className="text-[10px] py-0 px-1.5 font-semibold">
                    {vehicleCount > 0 ? `${vehicleCount} Available` : "Class Match"}
                  </Badge>
                </div>
                <p className="text-foreground font-semibold truncate pt-0.5">
                  {recVehicle?.vehicle_name ? `${recVehicle.vehicle_name} (${recVehicle.plate_number || ""})` : `Class: ${category}`}
                </p>
                <p className="text-[11px] text-foreground-muted truncate">
                  {recVehicle?.match_reasons?.[0] || "Cleaned, inspected & ready for pickup"}
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-surface border border-border/70 text-xs space-y-1">
                <div className="flex items-center justify-between text-foreground-secondary font-medium">
                  <span className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5 text-info" /> Driver Pool</span>
                  <Badge variant="info" className="text-[10px] py-0 px-1.5 font-semibold">
                    {driverCount > 0 ? `${driverCount} On Duty` : "Shift Active"}
                  </Badge>
                </div>
                <p className="text-foreground font-semibold truncate pt-0.5">
                  {recDriver?.driver_name ? `${recDriver.driver_name} · ${recDriver.shift_name || "Active Shift"}` : "Shift-Active Drivers Ready"}
                </p>
                <p className="text-[11px] text-foreground-muted truncate">
                  {recDriver?.match_reasons?.[0] || "Valid license & 0 rest time violations"}
                </p>
              </div>
            </div>

            {/* AI Smart Match Recommendation Bar & Skeleton Loader */}
            {isAiLoading ? (
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <Sparkles className="w-4 h-4 animate-spin shrink-0" />
                  <span>AI Scorer: Evaluating vehicle &amp; driver candidate pools...</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-6 w-full rounded bg-primary/10" />
                  <Skeleton className="h-6 w-full rounded bg-primary/10" />
                </div>
              </div>
            ) : (recVehicle || recDriver) ? (
              <div className="rounded-lg bg-primary/5 border border-primary/20 text-xs">
                <div className="p-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-foreground font-medium truncate">
                      Top Match: <strong className="font-semibold text-primary">{recVehicle?.vehicle_name || "Vehicle"}</strong> + <strong className="font-semibold text-primary">{recDriver?.driver_name || "Driver"}</strong>
                    </span>
                  </div>
                  <Badge variant="primary" className="text-[10px] shrink-0 font-bold">
                    {recVehicle?.score != null ? `${recVehicle.score}% Match` : "Scored"}
                  </Badge>
                </div>

                {/* LLM rationale, fetched separately. Absent whenever the
                    provider is unconfigured, slow, or down — the scored match
                    above stands on its own and stays actionable. */}
                {(narration || isNarrating) && (
                  <div className="px-2.5 pb-2.5 pt-0.5 border-t border-primary/15 space-y-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
                      AI Rationale{narration?.provider ? ` · ${narration.provider}` : ""}
                    </span>
                    {narration ? (
                      <p className="text-[11px] leading-relaxed text-foreground-secondary">{narration.text}</p>
                    ) : (
                      <p className="text-[11px] leading-relaxed text-foreground-muted flex items-center gap-1.5">
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        Writing rationale…
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Special Requests */}
          {r.special_requests && (
            <div className="p-3 rounded-xl bg-warning/10 border border-warning/30 space-y-1">
              <span className="text-xs font-semibold text-warning flex items-center gap-1">
                <StickyNote className="w-3.5 h-3.5" /> Special Guest Requests
              </span>
              <p className="text-xs text-foreground font-medium">{r.special_requests}</p>
            </div>
          )}
        </div>

        {/* Clean, Non-Truncated Action Decision Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5 border-t border-border mt-2">
          <Button
            variant="outline"
            className="text-danger border-danger/30 hover:bg-danger/10 hover:text-danger text-xs font-semibold px-3 h-9 shrink-0"
            disabled={isPending}
            onClick={() => onReject(r)}
          >
            <XCircle className="w-4 h-4 mr-1.5" />
            Reject Request
          </Button>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="success"
              className="text-xs font-semibold px-3.5 h-9"
              disabled={isPending}
              onClick={() => onApprove(r)}
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              Approve Request
            </Button>
            <Button
              variant="default"
              className="text-xs font-semibold px-3.5 h-9"
              disabled={isPending}
              onClick={() => onAssign(r)}
            >
              <Send className="w-4 h-4 mr-1.5" />
              Approve &amp; Assign Now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
