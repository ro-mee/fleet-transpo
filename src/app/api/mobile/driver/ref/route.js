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
 * - driverAllowedStatuses: statuses a driver may advance a trip through the
 *   semantic endpoints (accept / start / at-pickup / onboard / enroute /
 *   dropoff / complete) — the `action` on each nextStatus step names the route.
 * - nextStatus: for a given current status, the label + status of the next
 *   action the driver can take (or null if none).
 *
 * The server owns the lifecycle; the client only renders what this returns.
 */
const DRIVER_ALLOWED_STATUSES = [
  TRIP_STATUS.DRIVER_ACCEPTED,
  TRIP_STATUS.TRIP_STARTED,
  TRIP_STATUS.AT_PICKUP,
  TRIP_STATUS.PASSENGER_ONBOARD,
  TRIP_STATUS.EN_ROUTE,
  TRIP_STATUS.DROP_OFF,
  TRIP_STATUS.COMPLETED,
];

// The driver-facing action chain, in the order a driver performs it. The next
// available action for a status is the first entry whose `from` is reachable
// and forward-moving from the current status. The route also tells the client
// which semantic endpoint to hit (each advances through the transition layer).
const ACTION_FLOW = [
  { from: TRIP_STATUS.ASSIGNED, to: TRIP_STATUS.DRIVER_ACCEPTED, label: "Accept trip", action: "accept" },
  { from: TRIP_STATUS.DRIVER_ACCEPTED, to: TRIP_STATUS.TRIP_STARTED, label: "Start trip", action: "start" },
  { from: TRIP_STATUS.TRIP_STARTED, to: TRIP_STATUS.AT_PICKUP, label: "At pickup", action: "at-pickup" },
  { from: TRIP_STATUS.AT_PICKUP, to: TRIP_STATUS.PASSENGER_ONBOARD, label: "Passenger onboard", action: "onboard" },
  { from: TRIP_STATUS.PASSENGER_ONBOARD, to: TRIP_STATUS.EN_ROUTE, label: "Mark en route", action: "enroute" },
  { from: TRIP_STATUS.EN_ROUTE, to: TRIP_STATUS.DROP_OFF, label: "Drop off", action: "dropoff" },
  { from: TRIP_STATUS.DROP_OFF, to: TRIP_STATUS.COMPLETED, label: "Complete trip", action: "complete" },
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
    TRIP_STATUS.AT_PICKUP,
    TRIP_STATUS.PASSENGER_ONBOARD,
    TRIP_STATUS.EN_ROUTE,
    TRIP_STATUS.DROP_OFF,
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
      map[step.from] = { status: step.to, label: step.label, action: step.action };
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
        "At Pickup": "warning",
        "Passenger Onboard": "warning",
        "En Route": "warning",
        "Drop-off": "warning",
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
