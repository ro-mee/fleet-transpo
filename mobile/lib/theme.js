import { moderateScale } from './scaling';
/**
 * FleetOps Driver Companion — Design Tokens
 * Based exactly on Stitch FleetOps Tactical design system.
 *
 * Primary: #000666 (Deep Indigo)
 * Primary Container: #1A237E
 * Secondary: #046B5E (Tactical Teal)
 * Background: #FCF9F8 (Warm White)
 */

// ---- 8-point spacing grid ----
export const space = {
  xs: moderateScale(4),
  sm: moderateScale(8),
  md: moderateScale(12),
  base: moderateScale(16),
  lg: moderateScale(20),
  xl: moderateScale(24),
  xxl: moderateScale(32),
  xxxl: moderateScale(40),
};

// ---- Shape (dp) ----
export const radius = {
  none: 0,
  xs: moderateScale(2),
  sm: moderateScale(4),
  control: moderateScale(8),
  card: moderateScale(12),
  lg: moderateScale(16),
  xl: moderateScale(20),
  pill: 999,
};

// ---- Typefaces (Inter matches Stitch spec) ----
export const fonts = {
  display: "Inter_700Bold",
  displayBold: "Inter_700Bold",
  body: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemiBold: "Inter_600SemiBold",
  data: "Inter_500Medium",
  dataSemiBold: "Inter_600SemiBold",
};

// ---- Stitch FleetOps Tactical Palette — Light Mode ----
const light = {
  // Primary — Deep Indigo
  primary: "#000666",
  onPrimary: "#FFFFFF",
  primaryContainer: "#1A237E",
  onPrimaryContainer: "#8690EE",

  // Secondary — Tactical Teal
  secondary: "#046B5E",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#9DEFDE",
  onSecondaryContainer: "#0F6F62",

  // Tertiary — Dark Neutral
  tertiary: "#191B1C",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#2D3031",
  onTertiaryContainer: "#969899",

  // Error / SOS
  error: "#BA1A1A",
  onError: "#FFFFFF",
  errorContainer: "#FFDAD6",
  onErrorContainer: "#93000A",

  // Background & Surface
  background: "#F5F5F5",
  onBackground: "#121212",

  surface: "#F5F5F5",
  onSurface: "#121212",
  surfaceBright: "#F5F5F5",
  surfaceDim: "#DCD9D9",

  surfaceVariant: "#E5E2E1",
  onSurfaceVariant: "#454652",

  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#F6F3F2",
  surfaceContainer: "#F0EDED",
  surfaceContainerHigh: "#EAE7E7",
  surfaceContainerHighest: "#E5E2E1",

  // Outline
  outline: "#767683",
  outlineVariant: "#C6C5D4",

  // Inverse
  inverseSurface: "#303030",
  inverseOnSurface: "#F3F0EF",
  inversePrimary: "#BDC2FF",

  shadow: "#000666",
  scrim: "#000000",
  surfaceTint: "#4C56AF",

  // Semantic
  foreground: "#1B1C1C",
  foregroundSecondary: "#454652",
  foregroundMuted: "#767683",
  border: "#C6C5D4",
  borderStrong: "#767683",
  hover: "#F0EDED",
  success: "#046B5E",
  warning: "#D97706",
  danger: "#BA1A1A",
  info: "#000666",
  edge: "#000666",
};

// ---- Dark Mode ----
const dark = {
  primary: "#BDC2FF",
  onPrimary: "#000767",
  primaryContainer: "#1A237E",
  onPrimaryContainer: "#E0E0FF",

  secondary: "#84D5C5",
  onSecondary: "#003730",
  secondaryContainer: "#005046",
  onSecondaryContainer: "#9DEFDE",

  tertiary: "#C5C7C8",
  onTertiary: "#2D3031",
  tertiaryContainer: "#444748",
  onTertiaryContainer: "#E1E3E4",

  error: "#FFB4AB",
  onError: "#690005",
  errorContainer: "#93000A",
  onErrorContainer: "#FFDAD6",

  background: "#121212",
  onBackground: "#F5F5F5",

  surface: "#121212",
  onSurface: "#F5F5F5",
  surfaceBright: "#121212",
  surfaceDim: "#141415",

  surfaceVariant: "#454652",
  onSurfaceVariant: "#C6C5D4",

  surfaceContainerLowest: "#0F0F10",
  surfaceContainerLow: "#1B1C1E",
  surfaceContainer: "#1F2023",
  surfaceContainerHigh: "#2A2B2D",
  surfaceContainerHighest: "#353638",

  outline: "#8F909A",
  outlineVariant: "#454652",

  inverseSurface: "#E5E2E1",
  inverseOnSurface: "#303031",
  inversePrimary: "#000666",

  shadow: "#000000",
  scrim: "#000000",
  surfaceTint: "#BDC2FF",

  foreground: "#E5E2E1",
  foregroundSecondary: "#C6C5D4",
  foregroundMuted: "#8F909A",
  border: "#454652",
  borderStrong: "#8F909A",
  hover: "#2A2B2D",
  success: "#84D5C5",
  warning: "#FBBF24",
  danger: "#FFB4AB",
  info: "#BDC2FF",
  edge: "#BDC2FF",
};

export const palettes = { light, dark };

// Backward-compatible default export
export const colors = light;

// MD3 semantic aliases
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

export function statusSurfaces(c = colors) {
  const isDark = c === dark;
  return {
    success: isDark ? "#003730" : "#D6F5EC",
    warning: isDark ? "#4A2F00" : "#FEF3C7",
    info: isDark ? "#1A237E" : "#E0E0FF",
    danger: isDark ? "#690005" : "#FFDAD6",
    neutral: isDark ? "#2A2B2D" : "#F0EDED",
  };
}

export const statusSurfacesLight = statusSurfaces(light);

export function typeFor(c = colors) {
  return {
    display: {
      fontFamily: fonts.displayBold,
      fontSize: moderateScale(44),
      lineHeight: moderateScale(52),
      letterSpacing: -1,
      color: c.onBackground,
    },
    headlineLg: {
      fontFamily: fonts.displayBold,
      fontSize: moderateScale(32),
      lineHeight: moderateScale(40),
      color: c.onBackground,
    },
    headlineLgMobile: {
      fontFamily: fonts.displayBold,
      fontSize: moderateScale(28),
      lineHeight: moderateScale(36),
      color: c.onBackground,
    },
    headlineMd: {
      fontFamily: fonts.bodySemiBold,
      fontSize: moderateScale(24),
      lineHeight: moderateScale(32),
      color: c.onBackground,
    },
    titleLg: {
      fontFamily: fonts.bodySemiBold,
      fontSize: moderateScale(20),
      lineHeight: moderateScale(28),
      color: c.onBackground,
    },
    bodyLg: {
      fontFamily: fonts.body,
      fontSize: moderateScale(18),
      lineHeight: moderateScale(28),
      color: c.onSurface,
    },
    bodyMd: {
      fontFamily: fonts.body,
      fontSize: moderateScale(16),
      lineHeight: moderateScale(24),
      color: c.onSurface,
    },
    labelLg: {
      fontFamily: fonts.bodySemiBold,
      fontSize: moderateScale(14),
      lineHeight: moderateScale(20),
      letterSpacing: 0.1,
      color: c.onSurface,
    },
    labelMd: {
      fontFamily: fonts.bodyMedium,
      fontSize: moderateScale(12),
      lineHeight: moderateScale(16),
      color: c.onSurfaceVariant,
    },
    // Legacy aliases
    body: {
      fontFamily: fonts.body,
      fontSize: moderateScale(16),
      lineHeight: moderateScale(24),
      color: c.onSurfaceVariant,
    },
    supporting: {
      fontFamily: fonts.body,
      fontSize: moderateScale(14),
      lineHeight: moderateScale(20),
      color: c.onSurfaceVariant,
    },
    data: {
      fontFamily: fonts.data,
      fontSize: moderateScale(14),
      lineHeight: moderateScale(20),
      color: c.onSurface,
      fontVariant: ["tabular-nums"],
    },
    label: {
      fontFamily: fonts.dataSemiBold,
      fontSize: moderateScale(12),
      lineHeight: moderateScale(16),
      letterSpacing: 0.5,
      textTransform: "uppercase",
      color: c.onSurfaceVariant,
    },
    caption: {
      fontFamily: fonts.bodyMedium,
      fontSize: moderateScale(12),
      lineHeight: moderateScale(16),
      color: c.onSurfaceVariant,
    },
    pageTitle: {
      fontFamily: fonts.displayBold,
      fontSize: moderateScale(24),
      lineHeight: moderateScale(32),
      color: c.onBackground,
    },
    cardTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: moderateScale(16),
      lineHeight: moderateScale(22),
      color: c.onSurface,
    },
    sectionTitle: {
      fontFamily: fonts.dataSemiBold,
      fontSize: moderateScale(12),
      lineHeight: moderateScale(16),
      letterSpacing: 1,
      textTransform: "uppercase",
      color: c.onSurfaceVariant,
    },
  };
}

export const type = typeFor(light);

export function elevationFor(isDark = false) {
  return {
    level0: { shadowColor: "#000", shadowOpacity: 0, elevation: 0 },
    level1: {
      shadowColor: "#000",
      shadowOpacity: isDark ? 0.3 : 0.05,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    level2: {
      shadowColor: "#000",
      shadowOpacity: isDark ? 0.4 : 0.08,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    level3: {
      shadowColor: "#000",
      shadowOpacity: isDark ? 0.5 : 0.12,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 8,
    },
  };
}

export const shadows = {
  card: elevationFor(false).level1,
  raised: elevationFor(false).level2,
  none: { elevation: 0, shadowOpacity: 0 },
};

export function tripStatusTone(status) {
  switch (status) {
    case "Completed":
      return "success";
    case "Trip Started":
    case "At Pickup":
    case "Passenger Onboard":
    case "En Route":
    case "Drop-off":
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

export const TOUCH_TARGET = moderateScale(48);
