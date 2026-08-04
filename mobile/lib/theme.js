/**
 * Semantic tokens from docs/design-system.md (light theme).
 *
 * Colors are referenced by role, never by raw value, so a dark theme can be
 * added later without touching screens.
 *
 * Typography carries the dispatch-floor character of the web app: Archivo for
 * headings, IBM Plex Sans for interface copy, and IBM Plex Mono for data,
 * codes, and labels. Font assets are loaded once in app/_layout.js.
 */

export const colors = {
  background: "#F1F1ED",
  surface: "#FFFFFF",
  border: "#DFE1DB",
  hover: "#F2F2F0",
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
 * Typeface roles from docs/design-system.md §3.2. Font family strings match the
 * exported names from @expo-google-fonts/*, loaded in app/_layout.js.
 */
export const fonts = {
  display: "Archivo_600SemiBold",
  displayBold: "Archivo_700Bold",
  body: "IBMPlexSans_400Regular",
  bodyMedium: "IBMPlexSans_500Medium",
  bodySemiBold: "IBMPlexSans_600SemiBold",
  data: "IBMPlexMono_500Medium",
  dataSemiBold: "IBMPlexMono_600SemiBold",
};

/** Type scale matching the design-system roles. */
export const type = {
  pageTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 29,
    color: colors.foreground,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 23,
    color: colors.foreground,
  },
  cardTitle: {
    fontFamily: fonts.display,
    fontSize: 16,
    lineHeight: 21,
    color: colors.foreground,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.foregroundSecondary,
  },
  supporting: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foregroundSecondary,
  },
  data: {
    fontFamily: fonts.data,
    fontSize: 13,
    lineHeight: 18,
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  label: {
    fontFamily: fonts.data,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.foregroundSecondary,
  },
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
