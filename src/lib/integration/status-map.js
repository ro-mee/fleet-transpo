import { RESERVATION_LIFECYCLE as L } from "@/lib/constants";

// Status translation between Fleet-internal vocabulary and the SHARED vocabulary
// the Booking subsystem understands.
//
// Fleet has fine-grained internal states (Under Review, Scheduled, Assigned,
// ...). Booking does not need — and should not depend on — Fleet's
// internal granularity. This map collapses Fleet states into a small, stable set
// of externally-meaningful states so we can evolve Fleet internals without
// breaking the Booking contract.
//
// SHARED (outbound) vocabulary sent to Booking:
//   RECEIVED   — Fleet has the request, not yet acted on
//   ACCEPTED   — Fleet will fulfill it
//   SCHEDULED  — a vehicle/driver is assigned and it's on the schedule
//   IN_TRANSIT — the trip is underway
//   COMPLETED  — the trip finished
//   CANCELLED  — cancelled before or after assignment

export const EXTERNAL_STATUS = {
  RECEIVED: "RECEIVED",
  ACCEPTED: "ACCEPTED",
  SCHEDULED: "SCHEDULED",
  IN_TRANSIT: "IN_TRANSIT",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
};

const FLEET_TO_EXTERNAL = {
  [L.PENDING]: EXTERNAL_STATUS.RECEIVED,
  [L.SCHEDULED]: EXTERNAL_STATUS.SCHEDULED,
  [L.ASSIGNED]: EXTERNAL_STATUS.SCHEDULED,
  [L.IN_PROGRESS]: EXTERNAL_STATUS.IN_TRANSIT,
  [L.COMPLETED]: EXTERNAL_STATUS.COMPLETED,
  [L.CANCELLED]: EXTERNAL_STATUS.CANCELLED,
};

/**
 * Map a Fleet-internal status to the shared vocabulary sent to Booking.
 * Unknown statuses fall back to RECEIVED so we never emit a Fleet-internal
 * string across the boundary.
 */
export function toExternalStatus(fleetStatus) {
  return FLEET_TO_EXTERNAL[fleetStatus] || EXTERNAL_STATUS.RECEIVED;
}

// Reverse hint: how an inbound Booking status maps onto Fleet's starting point.
// Booking only ever hands us work that is "requested" — Fleet decides the rest —
// so everything inbound lands at Pending unless already terminal.
export function fleetStatusFromBooking(bookingStatus) {
  const normalized = String(bookingStatus || "").toLowerCase();
  if (normalized === "cancelled" || normalized === "canceled") return L.CANCELLED;
  if (normalized === "rejected") return L.CANCELLED;
  return L.PENDING;
}
