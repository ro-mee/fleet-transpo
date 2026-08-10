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
  sm: 6,
  control: 12,
  card: 16,
  lg: 24,
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
  // MD3 core adapted for Web UI alignment
  primary: "#111827",
  onPrimary: "#FFFFFF",
  primaryContainer: "#e5e7eb",
  onPrimaryContainer: "#111827",
  secondary: "#4b5563",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#e5e7eb",
  onSecondaryContainer: "#111827",
  tertiary: "#6b7280",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#f3f4f6",
  onTertiaryContainer: "#111827",
  error: "#ef4444",
  onError: "#FFFFFF",
  errorContainer: "#fef2f2",
  onErrorContainer: "#7f1d1d",
  background: "#f3f3f3",
  onBackground: "#111827",
  surface: "#ffffff",
  onSurface: "#111827",
  surfaceVariant: "#e5e7eb",
  onSurfaceVariant: "#4b5563",
  surfaceContainerLow: "#ffffff",
  surfaceContainer: "#f9fafb",
  surfaceContainerHigh: "#f3f4f6",
  outline: "#d1d5db",
  outlineVariant: "#e5e7eb",
  inverseSurface: "#111827",
  inverseOnSurface: "#f3f3f3",
  inversePrimary: "#f5f5f5",
  shadow: "#000000",
  scrim: "#000000",
  surfaceTint: "#111827",

  // FleetOps semantic roles
  foreground: "#111827",
  foregroundSecondary: "#4b5563",
  foregroundMuted: "#6b7280",
  border: "#d1d5db",
  borderStrong: "#9ca3af",
  hover: "#f3f4f6",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  edge: "#111827",
};

const dark = {
  // MD3 core adapted for Web UI alignment
  primary: "#f5f5f5",
  onPrimary: "#111111",
  primaryContainer: "#262626",
  onPrimaryContainer: "#f5f5f5",
  secondary: "#a3a3a3",
  onSecondary: "#111111",
  secondaryContainer: "#262626",
  onSecondaryContainer: "#f5f5f5",
  tertiary: "#6b7280",
  onTertiary: "#111111",
  tertiaryContainer: "#242424",
  onTertiaryContainer: "#f5f5f5",
  error: "#ef4444",
  onError: "#111111",
  errorContainer: "#7f1d1d",
  onErrorContainer: "#fef2f2",
  background: "#111111",
  onBackground: "#f5f5f5",
  surface: "#1a1a1a",
  onSurface: "#f5f5f5",
  surfaceVariant: "#2a2a2a",
  onSurfaceVariant: "#a3a3a3",
  surfaceContainerLow: "#111111",
  surfaceContainer: "#1a1a1a",
  surfaceContainerHigh: "#242424",
  outline: "#2a2a2a",
  outlineVariant: "#404040",
  inverseSurface: "#f5f5f5",
  inverseOnSurface: "#111111",
  inversePrimary: "#111827",
  shadow: "#000000",
  scrim: "#000000",
  surfaceTint: "#f5f5f5",

  // FleetOps semantic roles
  foreground: "#f5f5f5",
  foregroundSecondary: "#a3a3a3",
  foregroundMuted: "#6b7280",
  border: "#2a2a2a",
  borderStrong: "#404040",
  hover: "#242424",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  edge: "#f5f5f5",
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
    success: c === dark ? "#064e3b" : "#ecfdf5",
    warning: c === dark ? "#78350f" : "#fffbeb",
    info: c === dark ? "#1e3a5f" : "#eff6ff",
    danger: c === dark ? "#7f1d1d" : "#fef2f2",
    neutral: c === dark ? "#242424" : "#f3f4f6",
  };
}

// Backward-compatible (light).
export const statusSurfacesLight = statusSurfaces(light);

/** MD3 type scale. `c` is the active palette's on-surface colour. */
export function typeFor(c = colors) {
  return {
    display: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      lineHeight: 40,
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
      fontSize: 22,
      lineHeight: 28,
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
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: c.onSurfaceVariant,
    },
    caption: {
      fontFamily: fonts.bodyMedium,
      fontSize: 11,
      lineHeight: 14,
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
