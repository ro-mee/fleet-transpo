// Pure conflict vocabulary: the type enum, severities, and display labels.
//
// Split out of conflicts.js for the same reason permissions.js was split out of
// role-guard.js — conflicts.js imports lib/db (pg), so a client component that
// only needs to *name* a finding would otherwise pull the database driver into
// the browser bundle. Nothing here imports anything.
//
// conflicts.js re-exports CONFLICT_TYPE, so server code and the verification
// harness keep importing it from there unchanged.

/** Conflict types surfaced to the queue UI. */
export const CONFLICT_TYPE = {
  VEHICLE_CONFLICT: "vehicle_conflict",
  DRIVER_CONFLICT: "driver_conflict",
  MAINTENANCE_CONFLICT: "maintenance_conflict",
  DRIVER_UNAVAILABLE: "driver_unavailable",
  LICENSE_EXPIRED: "license_expired",
  REGISTRATION_EXPIRED: "registration_expired",
  INSURANCE_EXPIRED: "insurance_expired",
  UVVRP_RESTRICTED: "uvvrp_restricted",
  CAPACITY_MISMATCH: "capacity_mismatch",
  VEHICLE_NOT_ASSIGNED_TO_DRIVER: "vehicle_not_assigned_to_driver",
  TRAVEL_BUFFER: "travel_buffer",
  // A prior commitment exists but the travel time to the next pickup could not
  // be determined, so the §4.8.3 buffer rule could not be evaluated. Distinct
  // from TRAVEL_BUFFER (which asserts a violation was found) and from the
  // no-prior-commitment case (which is genuinely nothing to gate on).
  TRAVEL_BUFFER_UNVERIFIED: "travel_buffer_unverified",
  // The caller's own travel estimate disagrees with the route the system
  // computed. The computed value is what the rule uses.
  TRAVEL_ETA_DIVERGENCE: "travel_eta_divergence",
};

export const CONFLICT_SEVERITY = { BLOCKING: "blocking", WARNING: "warning" };

// How each type is named in the UI — queue chips, dispatch board, calendar
// legend. Keyed off CONFLICT_TYPE so renaming a type surfaces here too.
export const CONFLICT_LABEL = {
  [CONFLICT_TYPE.VEHICLE_CONFLICT]: "Vehicle Conflict",
  [CONFLICT_TYPE.DRIVER_CONFLICT]: "Driver Conflict",
  [CONFLICT_TYPE.MAINTENANCE_CONFLICT]: "Maintenance Conflict",
  [CONFLICT_TYPE.DRIVER_UNAVAILABLE]: "Driver Unavailable",
  [CONFLICT_TYPE.LICENSE_EXPIRED]: "License Expired",
  [CONFLICT_TYPE.REGISTRATION_EXPIRED]: "Registration Expired",
  [CONFLICT_TYPE.INSURANCE_EXPIRED]: "Insurance Expired",
  [CONFLICT_TYPE.UVVRP_RESTRICTED]: "Number Coding Restricted",
  [CONFLICT_TYPE.CAPACITY_MISMATCH]: "Capacity Mismatch",
  [CONFLICT_TYPE.VEHICLE_NOT_ASSIGNED_TO_DRIVER]: "Not Driver's Vehicle",
  [CONFLICT_TYPE.TRAVEL_BUFFER]: "Travel Buffer",
  [CONFLICT_TYPE.TRAVEL_BUFFER_UNVERIFIED]: "Travel Buffer Not Verified",
  [CONFLICT_TYPE.TRAVEL_ETA_DIVERGENCE]: "Travel Estimate Disagrees",
};
