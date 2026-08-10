/**
 * FleetOps Mobile — Material Design 3 design tokens adapted for "Premium Hospitality".
 *
 * Midnight Emerald & Warm Sand Theme.
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

// ---- Shape (dp) ----
export const radius = {
  none: 0,
  xs: 4,
  sm: 6,
  control: 8, // Sharpened from 12 for a more ticket/editorial look
  card: 8,    // Sharpened from 16
  lg: 16,     // Sharpened from 24
  pill: 999,
};

// ---- Typefaces ----
export const fonts = {
  display: "Archivo_600SemiBold",
  displayBold: "Archivo_700Bold",
  body: "IBMPlexSans_400Regular",
  bodyMedium: "IBMPlexSans_500Medium",
  bodySemiBold: "IBMPlexSans_600SemiBold",
  data: "IBMPlexMono_500Medium",
  dataSemiBold: "IBMPlexMono_600SemiBold",
};

// ---- The Midnight Emerald Palette ----
const light = {
  // Midnight Emerald Theme
  primary: "#0A2A26",         // Midnight Emerald
  onPrimary: "#FFFFFF",
  primaryContainer: "#E6EFEE",
  onPrimaryContainer: "#0A2A26",
  
  secondary: "#00D4FF",       // Electric Cyan
  onSecondary: "#0A2A26",
  secondaryContainer: "#E0FAFF",
  onSecondaryContainer: "#005566",

  tertiary: "#8C8377",        // Muted Taupe
  onTertiary: "#FFFFFF",
  tertiaryContainer: "#EAE5DF",
  onTertiaryContainer: "#3D3833",

  error: "#FF3B30",           // Signal Red
  onError: "#FFFFFF",
  errorContainer: "#FFEBEA",
  onErrorContainer: "#80120C",

  background: "#F7F6F2",      // Warm Sand
  onBackground: "#0A2A26",    // Deep Green Text
  
  surface: "#FFFFFF",         // Pure White Cards
  onSurface: "#0A2A26",
  surfaceVariant: "#EFECE5",  // Slightly darker sand for accents
  onSurfaceVariant: "#596664",
  
  surfaceContainerLow: "#FFFFFF",
  surfaceContainer: "#F7F6F2",
  surfaceContainerHigh: "#EFECE5",
  
  outline: "#D8D4CC",         // Crisp dividers
  outlineVariant: "#E6E2D8",
  
  inverseSurface: "#0A2A26",
  inverseOnSurface: "#F7F6F2",
  inversePrimary: "#00D4FF",
  
  shadow: "#0A2A26",          // Colored shadow for elegance
  scrim: "#000000",
  surfaceTint: "#0A2A26",

  // Semantic roles
  foreground: "#0A2A26",
  foregroundSecondary: "#596664",
  foregroundMuted: "#889491",
  border: "#D8D4CC",
  borderStrong: "#B0ACA3",
  hover: "#F2F0E9",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#FF3B30",
  info: "#00D4FF",
  edge: "#0A2A26",
};

const dark = {
  primary: "#00D4FF",         // Electric Cyan pops on dark
  onPrimary: "#041412",
  primaryContainer: "#0A2A26",
  onPrimaryContainer: "#00D4FF",
  
  secondary: "#0A2A26",
  onSecondary: "#FFFFFF",
  secondaryContainer: "#113A35",
  onSecondaryContainer: "#BBEBE6",

  error: "#FF453A",
  onError: "#041412",
  errorContainer: "#4A0E0A",
  onErrorContainer: "#FFB4AB",

  background: "#08100F",      // Very deep black/green
  onBackground: "#F7F6F2",
  
  surface: "#0D1B19",         // Slightly lifted
  onSurface: "#F7F6F2",
  surfaceVariant: "#162825",
  onSurfaceVariant: "#A5B5B2",
  
  surfaceContainerLow: "#08100F",
  surfaceContainer: "#0D1B19",
  surfaceContainerHigh: "#162825",
  
  outline: "#2A3A38",
  outlineVariant: "#1B2A28",
  
  inverseSurface: "#F7F6F2",
  inverseOnSurface: "#08100F",
  inversePrimary: "#0A2A26",
  
  shadow: "#000000",
  scrim: "#000000",
  surfaceTint: "#00D4FF",

  foreground: "#F7F6F2",
  foregroundSecondary: "#A5B5B2",
  foregroundMuted: "#6B7D7A",
  border: "#2A3A38",
  borderStrong: "#455956",
  hover: "#1A2C2A",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#FF453A",
  info: "#00D4FF",
  edge: "#00D4FF",
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
  return {
    success: c === dark ? "#023D26" : "#E5F7ED",
    warning: c === dark ? "#4A2F00" : "#FFF7E0",
    info: c === dark ? "#003A4A" : "#E0F9FF",
    danger: c === dark ? "#4A0E0A" : "#FFEBEA",
    neutral: c === dark ? "#162825" : "#EFECE5",
  };
}

export const statusSurfacesLight = statusSurfaces(light);

export function typeFor(c = colors) {
  return {
    display: {
      fontFamily: fonts.displayBold,
      fontSize: 32,
      lineHeight: 38,
      letterSpacing: -1, // Tighter editorial tracking
      color: c.onBackground,
    },
    headline: {
      fontFamily: fonts.displayBold,
      fontSize: 28,
      lineHeight: 34,
      letterSpacing: -0.8,
      color: c.onBackground,
    },
    pageTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.5,
      color: c.onBackground,
    },
    titleLarge: {
      fontFamily: fonts.display,
      fontSize: 20,
      lineHeight: 26,
      letterSpacing: -0.2,
      color: c.onBackground,
    },
    sectionTitle: {
      fontFamily: fonts.display,
      fontSize: 16,
      lineHeight: 20,
      letterSpacing: 0,
      textTransform: "uppercase",
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
      fontSize: 15,
      lineHeight: 22,
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
    caption: {
      fontFamily: fonts.bodyMedium,
      fontSize: 12,
      lineHeight: 16,
      color: c.onSurfaceVariant,
    },
  };
}

export const type = typeFor(light);

export function elevationFor(isDark = false) {
  return {
    level0: { shadowColor: "#0A2A26", shadowOpacity: 0, elevation: 0 },
    level1: {
      shadowColor: "#0A2A26",
      shadowOpacity: isDark ? 0.4 : 0.04, // Much softer shadows for premium feel
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    level2: {
      shadowColor: "#0A2A26",
      shadowOpacity: isDark ? 0.5 : 0.08,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4,
    },
    level3: {
      shadowColor: "#0A2A26",
      shadowOpacity: isDark ? 0.6 : 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
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

export const TOUCH_TARGET = 48;
