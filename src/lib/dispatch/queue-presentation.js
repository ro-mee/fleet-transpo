import { DISPATCH_STATUS, RESERVATION_LIFECYCLE } from "@/lib/constants";

const COPILOT_PRESENTATIONS = Object.freeze({
  "Ready for confirmation": { label: "Ready", status: "Ready", entity: "copilot" },
  "Review required": { label: "Review required", status: "Review required", entity: "copilot" },
  "Needs verification": { label: "Needs verification", status: "Needs verification", entity: "copilot" },
  Blocked: { label: "Blocked", status: "Blocked", entity: "copilot" },
  "Waiting for preceding request": { label: "Waiting", status: "Waiting", entity: "copilot" },
  "Not evaluated": { label: "Not evaluated", status: "Not evaluated", entity: "copilot" },
});

const RESERVATION_PRESENTATIONS = Object.freeze(
  Object.fromEntries(
    Object.values(RESERVATION_LIFECYCLE).map((status) => [
      status,
      { label: status, status, entity: "reservation" },
    ])
  )
);

const LIFECYCLE_STATES_THAT_SUPERSEDE_PROPOSALS = new Set([
  RESERVATION_LIFECYCLE.ASSIGNED,
  RESERVATION_LIFECYCLE.IN_PROGRESS,
  RESERVATION_LIFECYCLE.COMPLETED,
  RESERVATION_LIFECYCLE.CANCELLED,
]);

function reservationPresentation(status) {
  return Object.hasOwn(RESERVATION_PRESENTATIONS, status)
    ? RESERVATION_PRESENTATIONS[status]
    : null;
}

export function queuePresentation(request, bucket) {
  if (request?.dispatch_status === DISPATCH_STATUS.PENDING_REASSIGNMENT) {
    return {
      label: "Needs reassignment",
      status: DISPATCH_STATUS.PENDING_REASSIGNMENT,
      entity: "dispatch",
    };
  }

  const lifecycle = request?.fleet_status;
  if (LIFECYCLE_STATES_THAT_SUPERSEDE_PROPOSALS.has(lifecycle)) {
    return reservationPresentation(lifecycle);
  }

  if (Object.hasOwn(COPILOT_PRESENTATIONS, bucket)) {
    return COPILOT_PRESENTATIONS[bucket];
  }

  return reservationPresentation(lifecycle) ?? COPILOT_PRESENTATIONS["Not evaluated"];
}

export function bagSummary(request) {
  const count = request?.luggage_count;
  if (count == null) return "Bags not recorded";

  return `${count} ${Number(count) === 1 ? "bag" : "bags"}`;
}
