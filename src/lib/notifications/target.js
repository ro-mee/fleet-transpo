import { getRequiredRolesForPath } from "@/lib/auth/permissions";

// Resolve where a notification should navigate a user when tapped.
//
// Notifications fan out to different roles with different home areas (staff
// dashboard vs /driver), and reference targets are role-gated, so the href is
// resolved here with the caller's role in mind. A reference the user's role
// cannot open resolves to `null`, so a tap falls back to marking read instead
// of triggering a guard redirect loop.

const STAFF_ROUTES = {
  reservation: (id) => `/reservations/${id}`,
  dispatch: (id) => `/dispatch/${id}`,
  trip: (id) => `/trips/${id}`,
  vehicle: (id) => `/fleet/vehicles/${id}`,
  maintenance: (id) => `/fleet/vehicles/${id}`,
  document: () => `/fleet/documents`,
  driver: (id) => `/drivers/${id}`,
  incident: () => `/incidents`,
  leave_request: () => `/drivers/leave`,
};

const DRIVER_ROUTES = {
  dispatch: () => `/driver/trips`,
  trip: () => `/driver/trips`,
  vehicle: () => `/driver`,
  driver: () => `/driver/profile`,
  incident: () => `/driver/incidents`,
  leave_request: () => `/driver/schedule`,
};

/** @param {object} notification notification row (reference_type, reference_id, link) */
export function getNotificationHref(notification = {}, role) {
  const { reference_type: type, reference_id: id, link } = notification;

  if (typeof link === "string" && link.startsWith("/")) return link;

  if (!type || id == null) return null;

  if (role === "driver") {
    return DRIVER_ROUTES[type] ? DRIVER_ROUTES[type]() : null;
  }

  const build = STAFF_ROUTES[type];
  if (!build) return null;
  const href = build(id);
  return getRequiredRolesForPath(href).includes(role) ? href : null;
}