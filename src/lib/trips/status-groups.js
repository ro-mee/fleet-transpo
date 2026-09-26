// Trip-status groups for the mobile driver APIs.
//
// WHY THIS FILE EXISTS: `PRE_START_TRIP_STATUSES` was already an inline literal
// in src/app/api/mobile/driver/inspections/route.js (as INSPECTION_TRIP_STATUSES)
// and the driver's active-trip list was already inline in
// src/app/api/mobile/driver/me/route.js:40. The Pre-Shift vehicle resolution
// needs the same active-trip list, and adding it there as written would have
// made a third copy — so both live here instead.
//
// NOT THE SAME AS @/lib/constants `LIVE_TRIP_STATUSES`, and the names are
// deliberately different so the two cannot be confused:
//   * constants.LIVE_TRIP_STATUSES (9 entries, INCLUDES "Dispatched") answers
//     "is this trip visible on the operational live map / does it have GPS?"
//   * DRIVER_ACTIVE_TRIP_STATUSES (8 entries, starts at "Driver Accepted")
//     answers "is this the trip the driver is currently working?" — a Dispatched
//     trip is offered to the driver, not yet in their hands.
// They differ by exactly that one status and are not interchangeable.
//
// Kept as plain strings rather than TRIP_STATUS constants because that is what
// the call sites being consolidated already used; the authoritative enum is the
// trip_status CHECK constraint in migration 012. The mobile app keeps its own
// copy (mobile/lib/trips-queue.js: PRE_START / IN_PROGRESS) because it cannot
// import from src/ — keep the values in step by hand.

// Before the driver has the trip in hand: the window in which a quick Pre-Trip
// inspection is meaningful and may be recorded.
export const PRE_START_TRIP_STATUSES = [
  "Pending", "Approved", "Assigned", "Vehicle Assigned", "Driver Assigned",
  "Dispatched", "Driver Accepted",
];

// The driver is actively working the trip.
export const DRIVER_ACTIVE_TRIP_STATUSES = [
  "Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard",
  "En Route", "Drop-off", "Arrived", "In Progress",
];
