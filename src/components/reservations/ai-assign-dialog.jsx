"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConflictChips, ReadinessChip } from "@/components/reservations/conflict-chips";
import { AiRecommendationPanel } from "@/components/reservations/ai-recommendation-panel";
import { formatDateTime } from "@/lib/utils";
import {
  MapPin,
  Clock,
  Users,
  CarFront,
  CheckCircle2,
  StickyNote,
  Building2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

// AI-Assisted Assignment — the one action for accepting a request.
//
// There is no standalone review/approve step anymore: a request opens straight
// into assignment, backed by the deterministic Smart Dispatch scorer. The scorer
// picks the best eligible vehicle+driver pair, the LLM writes a short rationale
// behind it (best-effort, nullable), and a single "Accept & Assign" commits the
// pair (Pending → Scheduled → Assigned, auto-creating the dispatch).
//
// The dialog is a thin shell over the shared AiRecommendationPanel — the SAME
// panel the reservation detail page renders inline — so the advisor, narration,
// regenerate, swap, conflict handling and the accept action live in exactly one
// place. The panel owns fetch + assignment; this dialog only frames it with the
// request context and forwards the outcome (`onAssigned`) to the caller.
export function AiAssignDialog({
  request,
  isOpen,
  onClose,
  canAssign = false,
  onAssigned,
  alreadyAssigned = false,
}) {
  const requestId = request?.request_id;
  if (!request) return null;

  const r = request;
  const conflicts = r.conflicts || [];
  const category = r.vehiclecategories?.category_name || r.requested_vehicle_type || "Standard Vehicle";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl p-4 sm:p-6 w-[95vw] sm:max-w-5xl max-h-[95vh] flex flex-col overflow-hidden">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                <Sparkles className="w-5 h-5 text-primary shrink-0" /> AI-Assisted Assignment
              </DialogTitle>
              <DialogDescription className="text-xs text-foreground-secondary mt-0.5">
                Assign resources to <span className="font-mono font-semibold">{r.reservation_number || `REQ-#${r.request_id}`}</span> with the Smart Dispatch recommendation
              </DialogDescription>
            </div>
            <StatusBadge status={r.priority} entity="priority" />
          </div>
        </DialogHeader>

        <div className="py-2 flex-1 overflow-y-auto pr-1 -mr-1 grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* Left Column: Request Details */}
          <div className="space-y-3.5 flex flex-col">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-danger shrink-0" />
                  <span className="text-xs font-semibold text-foreground-muted uppercase w-16 shrink-0">Pickup:</span>
                  <span className="font-medium text-foreground truncate">{r.pickup_location || "—"}</span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-success shrink-0" />
                  <span className="text-xs font-semibold text-foreground-muted uppercase w-16 shrink-0">Dropoff:</span>
                  <span className="font-medium text-foreground truncate">{r.dropoff_location || "—"}</span>
                </div>
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

            {/* Fleet Readiness */}
            <div className="p-3.5 rounded-xl bg-muted/20 border border-border space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-foreground text-sm">Fleet Readiness &amp; Availability</span>
                </div>
                <ReadinessChip conflicts={conflicts} status={r.fleet_status} />
              </div>
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

          {/* Right Column: Shared recommendation panel */}
          <div className="flex flex-col h-full pl-0 lg:pl-6 lg:border-l lg:border-border/60">
            <AiRecommendationPanel
              requestId={requestId}
              pickupAt={r.pickup_datetime}
              canAssign={canAssign}
              alreadyAssigned={alreadyAssigned}
              onAssigned={onAssigned}
              hideHeader={true}
              compact={true}
              className="h-full flex flex-col"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
