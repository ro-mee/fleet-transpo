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
  duty: { label: "Duty", tone: "info" },
  fuel: { label: "Fuel", tone: "warning" },
};

const SEVERITY = {
  Critical: { label: "Critical", tone: "danger" },
  Major: { label: "Major", tone: "danger" },
  Moderate: { label: "Moderate", tone: "warning" },
  Minor: { label: "Minor", tone: "info" },
};

function mobileNotificationMeta(notification = {}) {
  const { reference_type: type, reference_id: id, severity: sev } = notification;
  const category = CATEGORY[type] || (type ? { label: type, tone: "neutral" } : null);
  const severity = sev ? SEVERITY[sev] || { label: sev, tone: "neutral" } : null;
  return { category, severity, referenceId: id };
}

const ICONS = {
  incident: 'warning-outline', dispatch: 'navigate-outline', trip: 'car-outline',
  maintenance: 'build-outline', vehicle: 'car-outline', driver: 'person-outline',
  document: 'document-text-outline', reservation: 'calendar-outline', uvvrp: 'calendar-outline', duty: 'clipboard-outline', fuel: 'water-outline',
};
const LEGACY = {
  trip_assigned: { icon: 'car-outline', tone: 'primary' },
  trip_cancelled: { icon: 'close-circle-outline', tone: 'danger' },
  trip_updated: { icon: 'refresh-outline', tone: 'info' },
  fuel_alert: { icon: 'water-outline', tone: 'warning' },
  dispatch_message: { icon: 'megaphone-outline', tone: 'primary' },
};

export function mobileNotificationAppearance(notification = {}) {
  const meta = mobileNotificationMeta(notification);
  const legacy = LEGACY[notification.type];
  const eventTone = ['Alert', 'Emergency'].includes(notification.type) ? 'danger' : notification.type === 'Warning' ? 'warning' : null;
  return {
    ...meta,
    icon: legacy?.icon || ICONS[notification.reference_type] || 'notifications-outline',
    tone: meta.severity?.tone || eventTone || legacy?.tone || meta.category?.tone || 'primary',
  };
}

export function notificationTimeLabel(value, now = new Date()) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Time unavailable';
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString([], { month: 'short', day: 'numeric', ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `${day} · ${time}`;
}
