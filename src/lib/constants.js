export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "FleetOps";
export const APP_DESCRIPTION = process.env.NEXT_PUBLIC_APP_DESCRIPTION || "AI-Driven Fleet Transportation Management System";

export const ROLES = {
  ADMIN: "admin",
  FLEET_MANAGER: "fleet_manager",
  DISPATCHER: "dispatcher",
  DRIVER: "driver",
  RECEPTION_STAFF: "reception_staff",
  RESTAURANT_STAFF: "restaurant_staff",
  CONCIERGE: "concierge",
  MANAGEMENT: "management",
  SYSTEM_ADMIN: "system_admin",
};

export const VEHICLE_STATUS = {
  AVAILABLE: "Available",
  IN_USE: "In Use",
  UNDER_MAINTENANCE: "Under Maintenance",
  OUT_OF_SERVICE: "Out of Service",
  RESERVED: "Reserved",
};

export const RESERVATION_STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

export const TRIP_STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  VEHICLE_ASSIGNED: "Vehicle Assigned",
  DRIVER_ASSIGNED: "Driver Assigned",
  DISPATCHED: "Dispatched",
  DRIVER_ACCEPTED: "Driver Accepted",
  TRIP_STARTED: "Trip Started",
  EN_ROUTE: "En Route",
  ARRIVED: "Arrived",
  COMPLETED: "Completed",
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
