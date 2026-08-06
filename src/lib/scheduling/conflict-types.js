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
};
