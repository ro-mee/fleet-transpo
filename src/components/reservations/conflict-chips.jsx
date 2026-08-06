import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { CONFLICT_LABEL, CONFLICT_SEVERITY } from "@/lib/scheduling/conflict-types";
import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";
import {
  AlertTriangle,
  CalendarX,
  CarFront,
  IdCard,
  Sparkles,
  UserX,
  Users,
  Wrench,
} from "lucide-react";

// Chip vocabulary for the queue and the dispatch board.
//
// The conflict *rules* live server-side in lib/scheduling/conflicts.js; this file
// only decides how a finding looks. Keeping the icon/label map here means a new
// conflict type added to CONFLICT_TYPE renders with a sensible fallback rather
// than crashing an unrelated page.
const CHIP_ICON = {
  vehicle_conflict: CarFront,
  driver_conflict: Users,
  maintenance_conflict: Wrench,
  driver_unavailable: UserX,
  license_expired: IdCard,
  registration_expired: CalendarX,
  capacity_mismatch: Users,
  vehicle_not_assigned_to_driver: CarFront,
};

/** A finding only escalates the UI if it actually blocks. */
const isBlocking = (c) => c?.severity !== CONFLICT_SEVERITY.WARNING;

/** One chip per finding, with the server's message as the tooltip. */
export function ConflictChips({ conflicts = [], max = 3, className }) {
  if (!conflicts.length) return null;

  // Blocking findings first, so a truncated list never hides the one that stops
  // the dispatch behind an advisory chip.
  const ordered = [...conflicts].sort((a, b) => Number(isBlocking(b)) - Number(isBlocking(a)));
  const shown = ordered.slice(0, max);
  const hidden = ordered.length - shown.length;

  return (
    <div className={className}>
      {shown.map((c, i) => {
        const Icon = CHIP_ICON[c.type] || AlertTriangle;
        return (
          <Tooltip key={`${c.type}-${i}`} content={c.message}>
            <Badge
              variant={c.severity === "warning" ? "warning" : "danger"}
              className="mr-1.5 mb-1.5 gap-1 cursor-default"
            >
              <Icon className="w-3 h-3" aria-hidden="true" />
              {CONFLICT_LABEL[c.type] || "Conflict"}
            </Badge>
          </Tooltip>
        );
      })}
      {hidden > 0 && (
        <Tooltip content={ordered.slice(max).map((c) => c.message).join(" · ")}>
          {/* Only red if something blocking is actually hidden behind it. */}
          <Badge
            variant={ordered.slice(max).some(isBlocking) ? "danger" : "warning"}
            className="mr-1.5 mb-1.5 cursor-default"
          >
            +{hidden} more
          </Badge>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Readiness chip — what this request is waiting on, in priority order:
 *   Conflict Detected    — something blocking was found; the dispatcher must look.
 *   Check Assignment     — advisory findings only; worth a glance, not a stop.
 *   AI Ready             — an advisor recommendation is cached and still applicable.
 *   Needs Review         — genuinely un-triaged: Pending or Under Review.
 *   Awaiting Assignment  — reviewed and approved, no vehicle/driver yet.
 *   (nothing)            — assigned or terminal; the status badge already says it.
 *
 * Conflict wins over AI Ready deliberately: a cached recommendation that predates
 * a newly-detected conflict must not read as "good to go".
 *
 * Severity matters here. This used to escalate on `conflicts.length` alone, which
 * was harmless while every rule was blocking — but the custodial-pairing rule
 * (migration 017) is advisory, and a driver taking a different car is a normal
 * day. Rendering that as a red "Conflict Detected" would train dispatchers to
 * ignore the chip that means a dispatch will actually be refused.
 *
 * `status` is what stops this from contradicting the status badge beside it. The
 * chip used to fall through to "Needs Review" whenever there was no conflict and
 * no recommendation — which rendered "Needs Review" directly under an `Approved`
 * or `Scheduled` badge, telling the dispatcher to review something they had
 * already reviewed. Readiness only has a useful answer before assignment, so past
 * that point the chip stays out of the way.
 */
export function ReadinessChip({ conflicts = [], hasRecommendation = false, status }) {
  if (conflicts.some(isBlocking)) {
    return (
      <Badge variant="danger" className="gap-1">
        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        Conflict Detected
      </Badge>
    );
  }
  if (conflicts.length) {
    return (
      <Badge variant="warning" className="gap-1">
        <AlertTriangle className="w-3 h-3" aria-hidden="true" />
        Check Assignment
      </Badge>
    );
  }
  if (hasRecommendation) {
    return (
      <Badge variant="info" className="gap-1">
        <Sparkles className="w-3 h-3" aria-hidden="true" />
        AI Ready
      </Badge>
    );
  }

  // Undecided: nobody has ruled on this request yet.
  if (status === L.PENDING || status === L.UNDER_REVIEW) {
    return (
      <Badge variant="secondary" className="gap-1">
        <Sparkles className="w-3 h-3" aria-hidden="true" />
        Needs Review
      </Badge>
    );
  }

  // Decided, not yet crewed. The gap is the actionable fact.
  if (status === L.APPROVED || status === L.SCHEDULED) {
    return (
      <Badge variant="warning" className="gap-1">
        <UserX className="w-3 h-3" aria-hidden="true" />
        Awaiting Assignment
      </Badge>
    );
  }

  // Assigned / In Progress / Completed / Rejected / Cancelled — nothing to add.
  return null;
}
