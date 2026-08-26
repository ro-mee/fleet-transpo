import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Central severity/status grammar for the whole dashboard.
// Heat grammar: danger = act now, warning = act this cycle, info = watch,
// success = healthy, primary = in motion/emphasis, secondary = neutral.
const ENTITY_MAPS = {
  severity: {
    critical: "danger",
    high: "danger",
    medium: "warning",
    low: "info",
  },
  risk: {
    overdue: "danger",
    critical: "danger",
    high: "warning",
    medium: "info",
    low: "success",
    healthy: "success",
  },
  vehicle: {
    available: "success",
    "in use": "warning",
    "under maintenance": "warning",
    "out of service": "danger",
    "registration expired": "danger",
    reserved: "info",
  },
  driver: {
    available: "success",
    "on trip": "warning",
    "off duty": "secondary",
    "on leave": "info",
    suspended: "danger",
    inactive: "secondary",
  },
  // All 16 TRIP_STATUS values from src/lib/constants.js (migration 012 CHECK),
  // lowercased, so every trip state colors consistently.
  trip: {
    pending: "warning",
    approved: "default",
    assigned: "info",
    "vehicle assigned": "info",
    "driver assigned": "info",
    dispatched: "info",
    "driver accepted": "info",
    "trip started": "info",
    "at pickup": "info",
    "passenger onboard": "primary",
    "in progress": "primary",
    "en route": "primary",
    "drop-off": "primary",
    arrived: "success",
    completed: "success",
    cancelled: "secondary",
    scheduled: "info",
  },
  // `transportation_requests` 9-status lifecycle (migration 016).
  reservation: {
    pending: "warning",
    approved: "success",
    rejected: "danger",
    confirmed: "success",
    scheduled: "info",
    assigned: "info",
    dispatched: "info",
    "checked out": "info",
    "in progress": "primary",
    returned: "success",
    completed: "success",
    cancelled: "secondary",
  },
  fuel: {
    pending: "warning",
    approved: "success",
    rejected: "danger",
    fulfilled: "success",
    completed: "success",
  },
  dispatch: {
    "pending reassignment": "danger",
    scheduled: "info",
    "in progress": "warning",
    completed: "success",
    cancelled: "secondary",
  },
  route: {
    active: "success",
    inactive: "secondary",
  },
  maintenance: {
    scheduled: "info",
    "in progress": "warning",
    completed: "success",
    done: "success",
    cancelled: "secondary",
  },
  // driverincidents lifecycle. Code only produces Open (DB default,
  // migration 030) and Resolved (incidents page); the rest are defensive
  // entries for the same ladder.
  incident: {
    open: "warning",
    pending: "warning",
    "in progress": "warning",
    resolved: "success",
    closed: "secondary",
  },
  // driver_leave_requests: Pending → Approved/Declined (review actions in
  // drivers/leave). Cancelled is defensive — drivers delete pending requests.
  leave: {
    pending: "warning",
    approved: "success",
    declined: "danger",
    cancelled: "secondary",
  },
  // Reservation priority is Urgent/High/Medium/Low (migration 016). Maintenance
  // still uses Critical/High/Normal/Low, so both vocabularies live here. Derived
  // queue priority (migration 026) adds Overdue/Future on top of those levels.
  priority: {
    urgent: "danger",
    critical: "danger",
    overdue: "danger",
    high: "warning",
    medium: "secondary",
    normal: "secondary",
    low: "info",
    future: "secondary",
  },
};

// Global fallback for statuses with no entity context. Entity maps are
// authoritative: lookup() tries the entity map first, so contradictions here
// (e.g. global "cancelled" = danger vs the neutral secondary used by every
// entity lifecycle, or global "high" = danger vs priority.high = warning)
// only surface when a caller passes no entity — and then the generic heat
// reading is the safest default.
const GLOBAL_STATUS_MAP = {
  completed: "success",
  done: "success",
  passed: "success",
  approved: "success",
  confirmed: "success",
  returned: "success",
  available: "success",
  active: "success",
  healthy: "success",

  assigned: "info",
  dispatched: "info",
  scheduled: "info",
  "in progress": "info",
  "en route": "info",
  "driver accepted": "info",
  "trip started": "info",
  "checked out": "info",
  "under review": "info",

  pending: "warning",
  "in use": "warning",
  "under maintenance": "warning",
  medium: "warning",
  warning: "warning",

  cancelled: "danger",
  rejected: "danger",
  suspended: "danger",
  "out of service": "danger",
  "registration expired": "danger",
  overdue: "danger",
  critical: "danger",
  urgent: "danger",
  high: "danger",

  "off duty": "secondary",
  inactive: "secondary",
  low: "info",
};

function lookup(status, entity) {
  if (!status) return null;
  const s = String(status).toLowerCase();

  // Try entity-specific map first
  if (entity && ENTITY_MAPS[entity]) {
    const found = ENTITY_MAPS[entity][s];
    if (found) return found;
  }

  // Fallback to global map or search all entity maps
  if (GLOBAL_STATUS_MAP[s]) return GLOBAL_STATUS_MAP[s];

  for (const mapName of Object.keys(ENTITY_MAPS)) {
    if (ENTITY_MAPS[mapName][s]) {
      return ENTITY_MAPS[mapName][s];
    }
  }

  return null;
}

export function statusVariant(status, entity) {
  return lookup(status, entity) || "info";
}

// Static (compile-safe) chip classes per tone for icon rails/boxes.
// Text halves use the AA-safe -700 inks — these render at 10-12px on tinted
// chips, where the base status colors sit ~2.2-2.5:1 and fail WCAG 1.4.3.
export const TONE_CHIP = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success-700",
  warning: "bg-warning/10 text-warning-700",
  danger: "bg-danger/10 text-danger-700",
  info: "bg-info/10 text-info-700",
  secondary: "bg-hover text-foreground-secondary",
};

export const TONE_TEXT = {
  primary: "text-primary",
  success: "text-success-700",
  warning: "text-warning-700",
  danger: "text-danger-700",
  info: "text-info-700",
  secondary: "text-foreground-secondary",
};

export const TONE_RAIL = {
  primary: "border-l-primary",
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
};

export function severityTone(severity) {
  const variant = lookup(severity, "severity");
  if (variant === "danger") return "danger";
  if (variant === "warning") return "warning";
  if (variant === "info") return "info";
  return "info";
}

/**
 * Tone for a maintenance risk band, resolved through the same map the badge
 * uses so a chip and its badge can never disagree.
 *
 * Callers that render predictions should decide "is this vehicle even
 * scheduled" before asking for a tone — an unpredicted vehicle bands as `low`
 * and would come back success green. See isUnscheduled in
 * src/lib/ai/predictive-maintenance.js.
 */
export function riskTone(risk) {
  return lookup(risk, "risk") || "success";
}

export function StatusBadge({ status, entity, severity, className, label, ...props }) {
  const value = severity ?? status;
  const variant = severity
    ? lookup(severity, "severity")
    : lookup(status, entity);
  return (
    <Badge
      variant={variant || "outline"}
      className={cn(severity && "capitalize", className)}
      {...props}
    >
      {label ?? value}
    </Badge>
  );
}
