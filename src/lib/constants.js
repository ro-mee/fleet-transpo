export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "FleetOps";
export const APP_DESCRIPTION = process.env.NEXT_PUBLIC_APP_DESCRIPTION || "AI-Driven Fleet Transportation Management System";

export const ROLES = {
  ADMIN: "admin",
  FLEET_MANAGER: "fleet_manager",
  DISPATCHER: "dispatcher",
  DRIVER: "driver",
  MANAGEMENT: "management",
  SYSTEM_ADMIN: "system_admin",
};

export const ROLE_IDS = {
  system_admin: 1,
  fleet_manager: 2,
  dispatcher: 3,
  driver: 4,
  management: 7,
  admin: 9,
};

export const REGISTRATION_ROLES = [
  { id: 1, name: "System Admin", value: "system_admin" },
  { id: 2, name: "Fleet Manager", value: "fleet_manager" },
  { id: 3, name: "Dispatcher", value: "dispatcher" },
  { id: 4, name: "Driver", value: "driver" },
  { id: 7, name: "Management", value: "management" },
  { id: 9, name: "FleetOps Admin", value: "admin" },
];

export const VEHICLE_STATUS = {
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  IN_USE: "In Use",
  UNDER_MAINTENANCE: "Under Maintenance",
  DECOMMISSIONED: "Decommissioned",
  REGISTRATION_EXPIRED: "Registration Expired",
};

export const RESERVATION_STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  DISPATCHED: "Dispatched",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
};

// Fleet lifecycle for a transportation request received from the Booking
// subsystem. This is the queue/dispatch state machine — kept in sync with the
// chk_transport_fleet_status CHECK in migration 016 and enforced by
// src/lib/scheduling/reservation-state.js.
//
// Strict linear chain:
//   Pending → Scheduled → Assigned → In Progress → Completed
// Cancelled is reachable from any non-terminal state.
export const RESERVATION_LIFECYCLE = {
  PENDING: "Pending",
  SCHEDULED: "Scheduled",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// Queue priority. Mirrors chk_transport_priority (migration 016). Booking sends
// 'Normal'; normalizePriority() in src/lib/integration/contracts.js maps it to
// 'Medium' at the anti-corruption boundary.
export const RESERVATION_PRIORITY = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

// Derived priority for the Smart Transportation Queue. NOT set by humans —
// recomputed from time-to-pickup + VIP/emergency/overdue by
// src/lib/scheduling/priority.js. Mirrors chk_transport_derived_priority
// (migration 026). Overdue is the top of the queue; Future is only shown under
// the Upcoming tab.
export const DERIVED_PRIORITY = {
  OVERDUE: "Overdue",
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  NORMAL: "Normal",
  FUTURE: "Future",
};

// Sort rank for the queue: Overdue first, Future last. Never shown in the UI
// as a label; it only drives ordering.
export const DERIVED_PRIORITY_RANK = {
  [DERIVED_PRIORITY.OVERDUE]: 1,
  [DERIVED_PRIORITY.CRITICAL]: 2,
  [DERIVED_PRIORITY.HIGH]: 3,
  [DERIVED_PRIORITY.MEDIUM]: 4,
  [DERIVED_PRIORITY.NORMAL]: 5,
  [DERIVED_PRIORITY.FUTURE]: 6,
};

// Timeline event types written to reservation_events (migration 016). Every
// status transition and operator action appends one row via
// recordReservationEvent() in src/services/reservation-events.service.js.
export const RESERVATION_EVENT = {
  CREATED: "created",
  VEHICLE_RECOMMENDED: "vehicle_recommended",
  DRIVER_RECOMMENDED: "driver_recommended",
  VEHICLE_ASSIGNED: "vehicle_assigned",
  DRIVER_ASSIGNED: "driver_assigned",
  DISPATCH_CREATED: "dispatch_created",
  TRIP_STARTED: "trip_started",
  PASSENGER_PICKED_UP: "passenger_picked_up",
  PASSENGER_DROPPED_OFF: "passenger_dropped_off",
  TRIP_COMPLETED: "trip_completed",
  DISPATCH_CLOSED: "dispatch_closed",
  CANCELLED: "cancelled",
  RESCHEDULED: "rescheduled",
};

export const DISPATCH_STATUS = {
  PENDING_REASSIGNMENT: "Pending Reassignment",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const TRIP_STATUS = {
  ASSIGNED: "Assigned",
  PENDING: "Pending",
  APPROVED: "Approved",
  VEHICLE_ASSIGNED: "Vehicle Assigned",
  DRIVER_ASSIGNED: "Driver Assigned",
  DISPATCHED: "Dispatched",
  DRIVER_ACCEPTED: "Driver Accepted",
  TRIP_STARTED: "Trip Started",
  AT_PICKUP: "At Pickup",
  PASSENGER_ONBOARD: "Passenger Onboard",
  EN_ROUTE: "En Route",
  DROP_OFF: "Drop-off",
  ARRIVED: "Arrived",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const DRIVER_STATUS = {
  AVAILABLE: "Available",
  ON_TRIP: "On Trip",
  OFF_DUTY: "Off Duty",
  ON_LEAVE: "On Leave",
  SUSPENDED: "Suspended",
};

export const MAINTENANCE_TYPE = {
  ROUTINE: "Routine",
  REPAIR: "Repair",
  INSPECTION: "Inspection",
  EMERGENCY: "Emergency",
};

export const MAINTENANCE_STATUS = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const FUEL_TYPE = {
  GASOLINE: "Gasoline",
  DIESEL: "Diesel",
  ELECTRIC: "Electric",
  HYBRID: "Hybrid",
};

export const NOTIFICATION_CHANNELS = {
  IN_APP: "in_app",
  EMAIL: "email",
  PUSH: "push",
};

// Notification events the system actually produces (DB triggers + incident
// handling). The preferences screen and /api/notifications/preferences both
// validate against this list. Channel defaults are what a fresh user gets for
// each event before they customize.
export const NOTIFICATION_EVENTS = {
  reservation_approved: {
    label: "Reservation Approved",
    defaults: { in_app: true, email: true, push: true },
  },
  dispatch_created: {
    label: "Dispatch Created",
    defaults: { in_app: true, email: true, push: true },
  },
  trip_completed: {
    label: "Trip Completed",
    defaults: { in_app: true, email: false, push: false },
  },
  maintenance_due: {
    label: "Maintenance Due",
    defaults: { in_app: true, email: true, push: true },
  },
  document_expiring: {
    label: "Document Expiring",
    defaults: { in_app: true, email: true, push: false },
  },
  registration_overdue: {
    label: "Registration Overdue",
    defaults: { in_app: true, email: true, push: true },
  },
  license_expired: {
    label: "License Expired",
    defaults: { in_app: true, email: true, push: true },
  },
  incident_urgent: {
    label: "Urgent Incident",
    defaults: { in_app: true, email: true, push: true },
  },
};

export const SERVICE_TYPES = {
  AIRPORT_TRANSFER: "Airport Transfer",
  CITY_TOUR: "City Tour",
  HOTEL_SHUTTLE: "Hotel Shuttle",
  POINT_TO_POINT: "Point-to-Point",
  FOOD_DELIVERY: "Food Delivery",
  STAFF_TRANSPORT: "Staff Transport",
  SUPPLY_RUN: "Supply Run",
  EVENT_TRANSPORT: "Event Transport",
  VALET_SERVICE: "Valet Service",
};

export const BOOKING_CHANNELS = {
  FRONT_DESK: "Front Desk",
  CONCIERGE: "Concierge",
  RESTAURANT_POS: "Restaurant POS",
  ONLINE_BOOKING: "Online Booking",
  PHONE: "Phone",
  WALK_IN: "Walk-in",
};

export const INTEGRATION_SOURCES = {
  PMS: "PMS",
  POS: "POS",
  RESTO_BOOKING: "RestoBooking",
  WEB: "Web",
};

export const INTEGRATION_DIRECTION = {
  INBOUND: "inbound",
  OUTBOUND: "outbound",
};

export const INTEGRATION_STATUS = {
  PENDING: "pending",
  PROCESSED: "processed",
  FAILED: "failed",
  SKIPPED: "skipped",
};

export const EXPORT_FORMATS = {
  PDF: "pdf",
  EXCEL: "excel",
  CSV: "csv",
};

export const REPORT_PERIODS = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
};
