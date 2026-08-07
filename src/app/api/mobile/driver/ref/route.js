import { requireDriver, ok, handleError } from "@/lib/api/utils";
import { TRIP_STATUS } from "@/lib/constants";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";

/**
 * GET /api/mobile/driver/ref
 *
 * Driver-reference data: the single source of truth the mobile app uses to
 * render trip statuses and status-transition controls, instead of hardcoding
 * the state machine client-side.
 *
 * - statusGroups: how the trips list is bucketed (pending / active / completed).
 * - driverAllowedStatuses: statuses a driver may SET via PUT /api/trips/:id/status.
 * - nextStatus: for a given current status, the label + status of the next
 *   action the driver can take (or null if none).
 *
 * The server owns the lifecycle; the client only renders what this returns.
 */
const DRIVER_ALLOWED_STATUSES = [
  TRIP_STATUS.DRIVER_ACCEPTED,
  TRIP_STATUS.TRIP_STARTED,
  TRIP_STATUS.EN_ROUTE,
  TRIP_STATUS.ARRIVED,
  TRIP_STATUS.COMPLETED,
];

// The driver-facing action chain, in the order a driver performs it. The next
// available action for a status is the first entry whose `from` is reachable
// and forward-moving from the current status.
const ACTION_FLOW = [
  { from: TRIP_STATUS.DRIVER_ACCEPTED, to: TRIP_STATUS.TRIP_STARTED, label: "Start trip" },
  { from: TRIP_STATUS.TRIP_STARTED, to: TRIP_STATUS.EN_ROUTE, label: "Mark en route" },
  { from: TRIP_STATUS.EN_ROUTE, to: TRIP_STATUS.ARRIVED, label: "Mark arrived" },
  { from: TRIP_STATUS.ARRIVED, to: TRIP_STATUS.COMPLETED, label: "Complete trip" },
];

const STATUS_GROUPS = {
  pending: [
    TRIP_STATUS.PENDING,
    TRIP_STATUS.APPROVED,
    TRIP_STATUS.ASSIGNED,
    TRIP_STATUS.VEHICLE_ASSIGNED,
    TRIP_STATUS.DRIVER_ASSIGNED,
    TRIP_STATUS.DISPATCHED,
  ],
  active: [
    TRIP_STATUS.DRIVER_ACCEPTED,
    TRIP_STATUS.TRIP_STARTED,
    TRIP_STATUS.EN_ROUTE,
    TRIP_STATUS.ARRIVED,
    TRIP_STATUS.IN_PROGRESS,
  ],
  completed: [TRIP_STATUS.COMPLETED, TRIP_STATUS.CANCELLED],
};

// Precomputed map of current status -> next driver action. The server owns the
// lifecycle, so the client can render the correct "what's next" button without
// re-implementing canTransitionTrip.
function buildNextStatusMap() {
  const map = {};
  for (const step of ACTION_FLOW) {
    const check = canTransitionTrip(step.from, step.to);
    if (check.ok) {
      map[step.from] = { status: step.to, label: step.label };
    }
  }
  return map;
}

export async function GET(req) {
  try {
    await requireDriver(req);
    return ok({
      statusGroups: STATUS_GROUPS,
      driverAllowedStatuses: DRIVER_ALLOWED_STATUSES,
      nextStatus: buildNextStatusMap(),
      tones: {
        Completed: "success",
        "Trip Started": "warning",
        "En Route": "warning",
        Arrived: "warning",
        "In Progress": "warning",
        "Driver Accepted": "warning",
        Pending: "info",
        Approved: "info",
        Assigned: "info",
        "Vehicle Assigned": "info",
        "Driver Assigned": "info",
        Dispatched: "info",
        Cancelled: "danger",
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
