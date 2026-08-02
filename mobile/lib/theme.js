/**
 * Semantic tokens from docs/design-system.md (light theme).
 *
 * Colors are referenced by role, never by raw value, so a dark theme can be
 * added later without touching screens.
 *
 * Typography note: the design system specifies Archivo, IBM Plex Sans, and IBM
 * Plex Mono. Those are not bundled yet — the sizes and weights below match the
 * spec, but the family falls back to the platform default until the font
 * packages are added.
 */

export const colors = {
  background: "#F1F1ED",
  surface: "#FFFFFF",
  border: "#DFE1DB",
  foreground: "#1A1D21",
  foregroundSecondary: "#5C636F",
  foregroundMuted: "#9AA0AA",
  primary: "#B53A1E",
  accent: "#F2B900",
  success: "#157A4D",
  warning: "#8A5A00",
  danger: "#B5281A",
  info: "#2A6CB0",
};

// Tinted backgrounds for status pills. Kept beside the roles they pair with so
// a new status cannot invent its own colour.
export const statusSurfaces = {
  success: "#E6F4EC",
  warning: "#FFF2D7",
  info: "#E9F2FB",
  danger: "#FBE9E7",
  neutral: "#EFEFEA",
};

/** 4px scale from the design system. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
};

export const radius = {
  marker: 4,
  control: 8,
  card: 12,
  pill: 999,
};

/**
 * Maps a trip_status value to a semantic role.
 *
 * Statuses come from the chk_trip_status constraint in
 * supabase/migrations/012_status_constraints.sql. Anything unrecognised falls
 * back to neutral rather than throwing — an unexpected status should still
 * render.
 */
export function tripStatusTone(status) {
  switch (status) {
    case "Completed":
      return "success";
    case "Trip Started":
    case "En Route":
    case "Arrived":
    case "In Progress":
    case "Driver Accepted":
      return "warning";
    case "Pending":
    case "Approved":
    case "Assigned":
    case "Vehicle Assigned":
    case "Driver Assigned":
    case "Dispatched":
      return "info";
    case "Cancelled":
      return "danger";
    default:
      return "neutral";
  }
}

/** Minimum touch target for a touch-first context, per the design system. */
export const TOUCH_TARGET = 44;
