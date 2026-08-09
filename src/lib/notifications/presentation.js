// Shared presentation grammar for notifications: what kind it is (type),
// where it came from (reference_type -> human category), and how bad it is
// (severity -> tone). Used by both the notification center page and the
// header dropdown.

const CATEGORY = {
  incident: { label: "Incident Report", chipClass: "bg-danger/10 text-danger" },
  dispatch: { label: "Dispatch", chipClass: "bg-primary/10 text-primary" },
  reservation: { label: "Reservation", chipClass: "bg-success/10 text-success" },
  trip: { label: "Trip", chipClass: "bg-info/10 text-info" },
  vehicle: { label: "Vehicle", chipClass: "bg-info/10 text-info" },
  driver: { label: "Driver", chipClass: "bg-info/10 text-info" },
  maintenance: { label: "Maintenance", chipClass: "bg-warning/10 text-warning" },
  document: { label: "Document", chipClass: "bg-warning/10 text-warning" },
  uvvrp: { label: "UVVRP", chipClass: "bg-primary/10 text-primary" },
};

/** @param {string} referenceType notification.reference_type */
export function notificationCategory(referenceType) {
  return (
    CATEGORY[referenceType] || {
      label: referenceType || undefined,
      chipClass: "bg-muted text-foreground-muted",
    }
  );
}

const SEVERITY = {
  Critical: { label: "Critical", chipClass: "bg-danger/10 text-danger" },
  Major: { label: "Major", chipClass: "bg-danger/10 text-danger" },
  Moderate: { label: "Moderate", chipClass: "bg-warning/10 text-warning" },
  Minor: { label: "Minor", chipClass: "bg-info/10 text-info" },
};

/** @param {string|null|undefined} severity notification.severity (incidents only) */
export function severityBadge(severity) {
  if (!severity) return null;
  return (
    SEVERITY[severity] || {
      label: severity,
      chipClass: "bg-muted text-foreground-muted",
    }
  );
}