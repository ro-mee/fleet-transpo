/**
 * FleetOps Mobile — Material Design 3 design tokens.
 *
 * Tokens are referenced by role, never by raw value. Light and dark palettes are
 * provided; the active one is selected by a ThemeProvider in app/_layout.js and
 * exposed through useTheme(). Screens that import `colors`/`type` directly read
 * the light palette (kept for backward compatibility) while themed components
 * use the live palette.
 *
 * Spacing follows an 8-point grid. Type roles map to MD3 scale but keep the
 * dispatch-floor typefaces: Archivo (display), IBM Plex Sans (body), IBM Plex
 * Mono (data). Font assets are loaded once in app/_layout.js.
 */

// ---- 8-point spacing grid ----
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
};

// ---- MD3 shape (dp) ----
export const radius = {
  none: 0,
  xs: 4,
  sm: 8,
  control: 12,
  card: 16,
  lg: 28,
  pill: 999,
};

// ---- Typefaces (loaded in app/_layout.js) ----
export const fonts = {
  display: "Archivo_600SemiBold",
  displayBold: "Archivo_700Bold",
  body: "IBMPlexSans_400Regular",
  bodyMedium: "IBMPlexSans_500Medium",
  bodySemiBold: "IBMPlexSans_600SemiBold",
  data: "IBMPlexMono_500Medium",
  dataSemiBold: "IBMPlexMono_600SemiBold",
};

// ---- MD3 tonal palettes ----
const light = {
  primary: "#A6331A",
  onPrimary: "#FFFFFF",
  primaryContainer: "#FFDACF",
  onPrimaryContainer: "#3B0500",
  secondary: "#B53A1E",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#FFDACF",
  onSecondaryContainer: "#3B0500",
  tertiary: "#E9B100",
  onTertiary: "#3A2E00",
  tertiaryContainer: "#FFDE59",
  onTertiaryContainer: "#3A2E00",
  error: "#B02A1C",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD4",
  onErrorContainer: "#410000",
  background: "#FAF9F6",
  onBackground: "#1B1C18",
  surface: "#FAF9F6",
  onSurface: "#1B1C18",
  surfaceVariant: "#E7E2DE",
  onSurfaceVariant: "#49423E",
  surfaceContainerLow: "#F3F1ED",
  surfaceContainer: "#EDEBE6",
  surfaceContainerHigh: "#E7E5E0",
  outline: "#7B736F",
  outlineVariant: "#CBC5C0",
  inverseSurface: "#30312C",
  inverseOnSurface: "#F2F1EC",
  inversePrimary: "#FFB59B",
  shadow: "#000000",
  scrim: "#000000",
  surfaceTint: "#A6331A",

  // FleetOps semantic roles (kept for backward compatibility)
  foreground: "#1B1C18",
  foregroundSecondary: "#49423E",
  foregroundMuted: "#7B736F",
  border: "#CBC5C0",
  borderStrong: "#9A938E",
  hover: "#E7E5E0",
  success: "#147A4B",
  warning: "#8A5A00",
  danger: "#B02A1C",
  info: "#2A6CB0",
  edge: "#A6331A",
};

const dark = {
  primary: "#FFB59B",
  onPrimary: "#5B1700",
  primaryContainer: "#822C12",
  onPrimaryContainer: "#FFDACF",
  secondary: "#FFB59B",
  onSecondary: "#5B1700",
  secondaryContainer: "#8A2B14",
  onSecondaryContainer: "#FFDACF",
  tertiary: "#F4C000",
  onTertiary: "#3A2E00",
  tertiaryContainer: "#8A7200",
  onTertiaryContainer: "#FFDE59",
  error: "#FFB4AB",
  onError: "#690005",
  errorContainer: "#93000A",
  onErrorContainer: "#FFDAD4",
  background: "#12130F",
  onBackground: "#E3E3DD",
  surface: "#12130F",
  onSurface: "#E3E3DD",
  surfaceVariant: "#49423E",
  onSurfaceVariant: "#CBC5C0",
  surfaceContainerLow: "#1A1B17",
  surfaceContainer: "#1E1F1B",
  surfaceContainerHigh: "#292A25",
  outline: "#948D88",
  outlineVariant: "#49423E",
  inverseSurface: "#E3E3DD",
  inverseOnSurface: "#30312C",
  inversePrimary: "#A6331A",
  shadow: "#000000",
  scrim: "#000000",
  surfaceTint: "#FFB59B",

  // FleetOps semantic roles (dark variants)
  foreground: "#E3E3DD",
  foregroundSecondary: "#CBC5C0",
  foregroundMuted: "#948D88",
  border: "#49423E",
  borderStrong: "#948D88",
  hover: "#292A25",
  success: "#7BD3A3",
  warning: "#F4C000",
  danger: "#FFB4AB",
  info: "#9CC8FF",
  edge: "#FFB59B",
};

export const palettes = { light, dark };

// Backward-compatible default export (light) so existing screens keep working.
export const colors = light;

// MD3 semantic aliases (point at the active palette via useTheme).
export const m3 = (c) => ({
  primary: c.primary,
  onPrimary: c.onPrimary,
  primaryContainer: c.primaryContainer,
  onPrimaryContainer: c.onPrimaryContainer,
  secondary: c.secondary,
  onSecondary: c.onSecondary,
  secondaryContainer: c.secondaryContainer,
  onSecondaryContainer: c.onSecondaryContainer,
  background: c.background,
  onBackground: c.onBackground,
  surface: c.surface,
  onSurface: c.onSurface,
  surfaceVariant: c.surfaceVariant,
  onSurfaceVariant: c.onSurfaceVariant,
  surfaceContainerLow: c.surfaceContainerLow,
  surfaceContainer: c.surfaceContainer,
  surfaceContainerHigh: c.surfaceContainerHigh,
  outline: c.outline,
  outlineVariant: c.outlineVariant,
  inverseSurface: c.inverseSurface,
  inverseOnSurface: c.inverseOnSurface,
  inversePrimary: c.inversePrimary,
  error: c.error,
  onError: c.onError,
  errorContainer: c.errorContainer,
  onErrorContainer: c.onErrorContainer,
});

// Tinted backgrounds for status pills (per-palette semantic).
export function statusSurfaces(c = colors) {
  return {
    success: c.success === "#147A4B" ? "#E6F4EC" : "#1B3A2B",
    warning: c.warning === "#8A5A00" ? "#FFF2D7" : "#3A2E00",
    info: c.info === "#2A6CB0" ? "#E9F2FB" : "#17324A",
    danger: c.danger === "#B02A1C" ? "#FBE9E7" : "#3B0500",
    neutral: c === dark ? "#292A25" : "#EFEFEA",
  };
}

// Backward-compatible (light).
export const statusSurfacesLight = statusSurfaces(light);

/** MD3 type scale. `c` is the active palette's on-surface colour. */
export function typeFor(c = colors) {
  return {
    display: {
      fontFamily: fonts.displayBold,
      fontSize: 36,
      lineHeight: 44,
      letterSpacing: -0.5,
      color: c.onBackground,
    },
    headline: {
      fontFamily: fonts.displayBold,
      fontSize: 28,
      lineHeight: 36,
      letterSpacing: -0.3,
      color: c.onBackground,
    },
    pageTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 24,
      lineHeight: 32,
      letterSpacing: -0.3,
      color: c.onBackground,
    },
    titleLarge: {
      fontFamily: fonts.display,
      fontSize: 22,
      lineHeight: 28,
      color: c.onBackground,
    },
    sectionTitle: {
      fontFamily: fonts.display,
      fontSize: 18,
      lineHeight: 24,
      color: c.onBackground,
    },
    cardTitle: {
      fontFamily: fonts.display,
      fontSize: 16,
      lineHeight: 22,
      color: c.onBackground,
    },
    body: {
      fontFamily: fonts.body,
      fontSize: 14,
      lineHeight: 21,
      color: c.onSurfaceVariant,
    },
    supporting: {
      fontFamily: fonts.body,
      fontSize: 13,
      lineHeight: 19,
      color: c.onSurfaceVariant,
    },
    data: {
      fontFamily: fonts.data,
      fontSize: 13,
      lineHeight: 18,
      color: c.onSurface,
      fontVariant: ["tabular-nums"],
    },
    label: {
      fontFamily: fonts.data,
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: c.onSurfaceVariant,
    },
  };
}

// Backward-compatible (light).
export const type = typeFor(light);

/**
 * Elevation (dp) → MD3 tonal overlays + shadow. `isDark` chooses surface tint.
 */
export function elevationFor(isDark = false) {
  return {
    level0: { shadowColor: "#000", shadowOpacity: 0, elevation: 0 },
    level1: {
      shadowColor: "#000",
      shadowOpacity: isDark ? 0.4 : 0.08,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    level2: {
      shadowColor: "#000",
      shadowOpacity: isDark ? 0.5 : 0.12,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    level3: {
      shadowColor: "#000",
      shadowOpacity: isDark ? 0.6 : 0.16,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 9,
    },
  };
}

// Backward-compatible.
export const shadows = {
  card: elevationFor(false).level1,
  raised: elevationFor(false).level2,
  none: { elevation: 0, shadowOpacity: 0 },
};

/**
 * Maps a trip_status value to a semantic role. Statuses come from the
 * chk_trip_status constraint. Anything unrecognised falls back to neutral.
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

/** Minimum touch target for a touch-first context (MD3 recommends 48dp). */
export const TOUCH_TARGET = 48;
