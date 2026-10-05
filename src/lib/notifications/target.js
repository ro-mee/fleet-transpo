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
  // New-device sign-in notices (new-device-alert.js). reference_id carries the
  // employee's own id, which the route ignores — it only has to be non-null for
  // the href to resolve at all.
  security: () => `/settings/security`,
};

const DRIVER_ROUTES = {
  dispatch: () => `/driver/trips`,
  trip: () => `/driver/trips`,
  vehicle: () => `/driver`,
  driver: () => `/driver/profile`,
  incident: () => `/driver/incidents`,
  leave_request: () => `/driver/schedule`,
  // End Duty reminders (end-duty-reminder.service.js). Web has no equivalent of
  // the mobile End Duty screen, so this lands on the driver area rather than a
  // page that would have to grow a second implementation of the same flow. Only
  // DRIVER_ROUTES carries it: a staff role has no duty to end, so STAFF_ROUTES
  // deliberately omits it and a staff tap resolves to null (mark-read).
  duty: () => `/driver`,
};

const MECHANIC_ROUTES = {
  maintenance: (id) => `/mechanic/work-orders/${id}`,
  mechanic_maintenance: (id) => `/mechanic/work-orders/${id}`,
  incident: () => `/mechanic/problems`,
  vehicle: (id) => `/mechanic/vehicles/${id}`,
};

/** @param {object} notification notification row (reference_type, reference_id, link) */
export function getNotificationHref(notification = {}, role) {
  const { reference_type: type, reference_id: id, link } = notification;

  if (typeof link === "string" && link.startsWith("/")) return link;

  if (!type || id == null) return null;

  if (role === "driver") {
    return DRIVER_ROUTES[type] ? DRIVER_ROUTES[type]() : null;
  }

  // Mechanic-audience rows MUST be written with reference_type
  // "mechanic_maintenance" so staff taps on the same WO keep resolving to
  // /fleet/vehicles/:id.
  if (role === "mechanic") return MECHANIC_ROUTES[type] ? MECHANIC_ROUTES[type](id) : null;

  const build = STAFF_ROUTES[type];
  if (!build) return null;
  const href = build(id);
  return getRequiredRolesForPath(href).includes(role) ? href : null;
}