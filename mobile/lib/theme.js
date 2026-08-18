import { moderateScale } from './scaling';
/**
 * FleetOps Driver Companion — Design Tokens
 * Based exactly on Stitch FleetOps Tactical design system.
 *
 * Primary: #285448 (Forest Green)
 * Primary Container: #DCE9E3
 * Secondary: #8A632C (Antique Brass)
 * Background: #F5F2EC (Warm Ivory)
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

// ---- Typefaces (design-system spec: Archivo + IBM Plex) ----
export const fonts = {
  display: "PlusJakartaSans_700Bold",
  displayBold: "PlusJakartaSans_700Bold",
  displaySemiBold: "PlusJakartaSans_600SemiBold",
  body: "PlusJakartaSans_400Regular",
  bodyMedium: "PlusJakartaSans_500Medium",
  bodySemiBold: "PlusJakartaSans_600SemiBold",
  data: "IBMPlexMono_500Medium",
  dataSemiBold: "IBMPlexMono_600SemiBold",
};

// ---- Stitch FleetOps Tactical Palette — Light Mode ----
const light = {
  // Primary — Deep Indigo
  primary: "#285448",
  onPrimary: "#FFFFFF",
  primaryContainer: "#DCE9E3",
  onPrimaryContainer: "#17382F",

  // Secondary — Tactical Teal
  secondary: "#8A632C",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#F1E7D6",
  onSecondaryContainer: "#5A3D18",

  // Tertiary — Dark Neutral
  tertiary: "#9D4F3F",
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#F4DDD6",
  onTertiaryContainer: "#71352A",

  // Error / SOS
  error: "#A84340",
  onError: "#FFFFFF",
  errorContainer: "#F4DDD9",
  onErrorContainer: "#752825",

  // Background & Surface
  background: "#F5F2EC",
  onBackground: "#1F2925",

  surface: "#FFFDFC",
  onSurface: "#1F2925",
  surfaceBright: "#FFFFFF",
  surfaceDim: "#DEDAD1",

  surfaceVariant: "#EDEAE3",
  onSurfaceVariant: "#53615A",

  surfaceContainerLowest: "#FFFFFF",
  surfaceContainerLow: "#FBF8F3",
  surfaceContainer: "#F4F0E9",
  surfaceContainerHigh: "#ECE7DE",
  surfaceContainerHighest: "#E3DED5",

  // Outline
  outline: "#68736D",
  outlineVariant: "#D8D5CC",

  // Inverse
  inverseSurface: "#24302B",
  inverseOnSurface: "#F5F1E9",
  inversePrimary: "#A9C8B9",

  shadow: "#16251F",
  scrim: "#000000",
  surfaceTint: "#285448",

  // Semantic
  foreground: "#1F2925",
  foregroundSecondary: "#53615A",
  foregroundMuted: "#68736D",
  border: "#D8D5CC",
  borderStrong: "#68736D",
  hover: "#F4F0E9",
  success: "#286B54",
  warning: "#9A4E3C",
  danger: "#A84340",
  info: "#3F6A7C",
  edge: "#285448",
};

// ---- Dark Mode ----
const dark = {
  primary: "#A6C7B8",
  onPrimary: "#103A30",
  primaryContainer: "#285448",
  onPrimaryContainer: "#DDEBE5",

  secondary: "#D2A765",
  onSecondary: "#3B280D",
  secondaryContainer: "#59431F",
  onSecondaryContainer: "#F3E4C6",

  tertiary: "#E0A08E",
  onTertiary: "#4A2118",
  tertiaryContainer: "#6E382C",
  onTertiaryContainer: "#F7DDD5",

  error: "#F2A39C",
  onError: "#5B1617",
  errorContainer: "#7A2828",
  onErrorContainer: "#FFDAD7",

  background: "#111816",
  onBackground: "#F5F1E9",

  surface: "#19211E",
  onSurface: "#F5F1E9",
  surfaceBright: "#2A3530",
  surfaceDim: "#111816",

  surfaceVariant: "#35423B",
  onSurfaceVariant: "#C2CBC4",

  surfaceContainerLowest: "#0D1311",
  surfaceContainerLow: "#151D1A",
  surfaceContainer: "#1C2521",
  surfaceContainerHigh: "#25302B",
  surfaceContainerHighest: "#303D37",

  outline: "#97A39C",
  outlineVariant: "#35423B",

  inverseSurface: "#E8E4DC",
  inverseOnSurface: "#27312D",
  inversePrimary: "#285448",

  shadow: "#000000",
  scrim: "#000000",
  surfaceTint: "#A6C7B8",

  foreground: "#F5F1E9",
  foregroundSecondary: "#C2CBC4",
  foregroundMuted: "#97A39C",
  border: "#35423B",
  borderStrong: "#97A39C",
  hover: "#25302B",
  success: "#82BEA3",
  warning: "#E5A080",
  danger: "#F2A39C",
  info: "#8DB9C9",
  edge: "#A6C7B8",
};

const highContrastLight = {
  ...light,
  onSurface: "#000000",
  onBackground: "#000000",
  surface: "#FFFFFF",
  background: "#FFFFFF",
  primary: "#000444",
  outline: "#000000",
  outlineVariant: "#000000",
  border: "#000000",
  borderStrong: "#000000",
  foreground: "#000000",
  foregroundSecondary: "#000000",
  foregroundMuted: "#000000",
};

const highContrastDark = {
  ...dark,
  onSurface: "#FFFFFF",
  onBackground: "#FFFFFF",
  surface: "#000000",
  background: "#000000",
  primary: "#FFFFFF",
  onPrimary: "#000000",
  outline: "#FFFFFF",
  outlineVariant: "#FFFFFF",
  border: "#FFFFFF",
  borderStrong: "#FFFFFF",
  foreground: "#FFFFFF",
  foregroundSecondary: "#FFFFFF",
  foregroundMuted: "#FFFFFF",
};

export const palettes = { light, dark, highContrastLight, highContrastDark };

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
    success: isDark ? "#23483B" : "#DDEEE6",
    warning: isDark ? "#503C1E" : "#F6E8CF",
    info: isDark ? "#263F4B" : "#DDEAF0",
    danger: isDark ? "#552D2B" : "#F4DDD9",
    neutral: isDark ? "#222C27" : "#EDEAE3",
  };
}

export const statusSurfacesLight = statusSurfaces(light);

export function typeFor(c = colors, scale = 1) {
  const sc = (size) => moderateScale(size) * scale;
  return {
    display: {
      fontFamily: fonts.displayBold,
      fontSize: sc(44),
      lineHeight: sc(52),
      letterSpacing: -1,
      color: c.onBackground,
    },
    headlineLg: {
      fontFamily: fonts.displayBold,
      fontSize: sc(32),
      lineHeight: sc(40),
      color: c.onBackground,
    },
    headlineLgMobile: {
      fontFamily: fonts.displayBold,
      fontSize: sc(28),
      lineHeight: sc(36),
      color: c.onBackground,
    },
    headlineMd: {
      fontFamily: fonts.bodySemiBold,
      fontSize: sc(24),
      lineHeight: sc(32),
      color: c.onBackground,
    },
    titleLg: {
      fontFamily: fonts.bodySemiBold,
      fontSize: sc(20),
      lineHeight: sc(28),
      color: c.onBackground,
    },
    bodyLg: {
      fontFamily: fonts.body,
      fontSize: sc(18),
      lineHeight: sc(28),
      color: c.onSurface,
    },
    bodyMd: {
      fontFamily: fonts.body,
      fontSize: sc(16),
      lineHeight: sc(24),
      color: c.onSurface,
    },
    labelLg: {
      fontFamily: fonts.bodySemiBold,
      fontSize: sc(14),
      lineHeight: sc(20),
      letterSpacing: 0.1,
      color: c.onSurface,
    },
    labelMd: {
      fontFamily: fonts.bodyMedium,
      fontSize: sc(12),
      lineHeight: sc(16),
      color: c.onSurfaceVariant,
    },
    // Legacy aliases
    body: {
      fontFamily: fonts.body,
      fontSize: sc(16),
      lineHeight: sc(24),
      color: c.onSurfaceVariant,
    },
    supporting: {
      fontFamily: fonts.body,
      fontSize: sc(14),
      lineHeight: sc(20),
      color: c.onSurfaceVariant,
    },
    data: {
      fontFamily: fonts.data,
      fontSize: sc(14),
      lineHeight: sc(20),
      color: c.onSurface,
      fontVariant: ["tabular-nums"],
    },
    label: {
      fontFamily: fonts.dataSemiBold,
      fontSize: sc(12),
      lineHeight: sc(16),
      letterSpacing: 0.5,
      color: c.onSurfaceVariant,
    },
    caption: {
      fontFamily: fonts.bodyMedium,
      fontSize: sc(12),
      lineHeight: sc(16),
      color: c.onSurfaceVariant,
    },
    pageTitle: {
      fontFamily: fonts.displayBold,
      fontSize: sc(24),
      lineHeight: sc(32),
      color: c.onBackground,
    },
    cardTitle: {
      fontFamily: fonts.bodySemiBold,
      fontSize: sc(16),
      lineHeight: sc(22),
      color: c.onSurface,
    },
    sectionTitle: {
      fontFamily: fonts.dataSemiBold,
      fontSize: sc(12),
      lineHeight: sc(16),
      letterSpacing: 1,
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
