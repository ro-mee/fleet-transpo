import { createContext, useContext, useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { palettes, typeFor, statusSurfaces, elevationFor, m3 } from "./theme";

const ThemeContext = createContext(null);

/**
 * Resolves the active palette + derived tokens, following the system colour
 * scheme by default (MD3 dark-mode support). Screens may override `scheme` to
 * force light/dark.
 *
 * Provides:
 *   scheme        'light' | 'dark'
 *   colors        the active palette (all MD3 + FleetOps semantic roles)
 *   type          the active type scale
 *   statusSurfaces the active status pill tints
 *   elevation     the active elevation set
 *   m3            the MD3 semantic role map
 */
export function ThemeProvider({ children, scheme: forced }) {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const scheme = forced || system === "dark" ? "dark" : "light";

  const value = useMemo(() => {
    const colors = palettes[scheme];
    return {
      scheme,
      colors,
      type: typeFor(colors),
      statusSurfaces: statusSurfaces(colors),
      elevation: elevationFor(scheme === "dark"),
      m3: m3(colors),
    };
  }, [scheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
