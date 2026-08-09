// Mobile notification presentation: what kind, where it came from, and how
// severe. Mirrors the web presentation helpers but returns mobile tones that
// the StatusPill component understands (danger / warning / info / success).
// Severity rides along on incident notifications from GET /api/notifications.

const CATEGORY = {
  incident: { label: "Incident Report", tone: "danger" },
  dispatch: { label: "Dispatch", tone: "info" },
  reservation: { label: "Reservation", tone: "success" },
  trip: { label: "Trip", tone: "info" },
  vehicle: { label: "Vehicle", tone: "info" },
  driver: { label: "Driver", tone: "info" },
  maintenance: { label: "Maintenance", tone: "warning" },
  document: { label: "Document", tone: "warning" },
  uvvrp: { label: "UVVRP", tone: "info" },
};

const SEVERITY = {
  Critical: { label: "Critical", tone: "danger" },
  Major: { label: "Major", tone: "danger" },
  Moderate: { label: "Moderate", tone: "warning" },
  Minor: { label: "Minor", tone: "info" },
};

export function mobileNotificationMeta(notification = {}) {
  const { reference_type: type, reference_id: id, severity: sev } = notification;
  const category = CATEGORY[type] || (type ? { label: type, tone: "neutral" } : null);
  const severity = sev ? SEVERITY[sev] || { label: sev, tone: "neutral" } : null;
  return { category, severity, referenceId: id };
}