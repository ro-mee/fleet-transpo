import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { useColorScheme, LayoutAnimation, UIManager, Platform } from "react-native";
import { palettes, typeFor, statusSurfaces, elevationFor, m3 } from "./theme";
import { useSettings } from "./settings-context";

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
export function ThemeProvider({ children, scheme: initialForced }) {
  const { settings } = useSettings();
  const system = useColorScheme();
  const [forced, setForced] = useState(initialForced);

  const scheme = forced || (system === "dark" ? "dark" : "light");

  const toggleColorScheme = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setForced((prev) => {
      if (prev) {
        return prev === "dark" ? "light" : "dark";
      }
      return system === "dark" ? "light" : "dark";
    });
  }, [system]);

  const value = useMemo(() => {
    let paletteKey = scheme;
    if (settings.highContrast) {
      paletteKey = scheme === 'dark' ? 'highContrastDark' : 'highContrastLight';
    }
    const colors = palettes[paletteKey];

    let textScale = 1;
    if (settings.textSize === 'small') textScale = 0.85;
    else if (settings.textSize === 'large') textScale = 1.15;

    return {
      scheme,
      colorScheme: scheme,
      toggleColorScheme,
      colors,
      type: typeFor(colors, textScale),
      statusSurfaces: statusSurfaces(colors),
      elevation: elevationFor(scheme === "dark"),
      m3: m3(colors),
    };
  }, [scheme, toggleColorScheme, settings.highContrast, settings.textSize]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
