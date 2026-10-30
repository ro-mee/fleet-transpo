import React from "react";
import { Image, View, Text, StyleSheet } from "react-native";
import { useTheme } from "../lib/theme-context";
import { useSettings } from "../lib/settings-context";
import { fonts } from "../lib/theme";

const marks = {
  light: require("../assets/brand/mark-light.png"),
  dark: require("../assets/brand/mark-dark.png"),
  highContrastLight: require("../assets/brand/mark-high-contrast-light.png"),
  highContrastDark: require("../assets/brand/mark-high-contrast-dark.png"),
};
const inks = {
  light: "#073D30",
  dark: "#F7DFAB",
  highContrastLight: "#000000",
  highContrastDark: "#FFFFFF",
};
const wordmarks = {
  light: { source: require("../assets/brand/wordmark-light.png"), ratio: 264 / 70 },
  dark: { source: require("../assets/brand/wordmark-dark.png"), ratio: 264 / 65 },
};

function useBrandVariant(variant) {
  const { scheme } = useTheme();
  const { settings } = useSettings();
  return variant || (settings.highContrast
    ? (scheme === "dark" ? "highContrastDark" : "highContrastLight")
    : (scheme === "dark" ? "dark" : "light"));
}

/** Original Hotel Route texture, with plain vector variants for high contrast. */
export function FleetOpsMark({ size = 48, variant }) {
  const selected = useBrandVariant(variant);
  return (
    <Image
      source={marks[selected]}
      resizeMode="contain"
      fadeDuration={0}
      accessible={false}
      importantForAccessibility="no"
      style={[styles.mark, { width: size, height: size }]}
    />
  );
}

export function FleetOpsWordmark({ size = 28, variant }) {
  const selected = useBrandVariant(variant);
  const artwork = wordmarks[selected];
  if (artwork) {
    const height = size * 1.1;
    return <Image source={artwork.source} resizeMode="contain" fadeDuration={0} accessible={false}
      importantForAccessibility="no" style={{ width: height * artwork.ratio, height }} />;
  }
  return (
    <Text
      accessible={false}
      // The wordmark is artwork; surrounding copy still follows system text size.
      allowFontScaling={false}
      style={[styles.wordmark, { fontSize: size, lineHeight: size * 1.3, color: inks[selected] }]}
    >
      FleetOps
    </Text>
  );
}

export function Logo({ size = 48, showText = true, style, variant, subtitle = true }) {
  const { colors } = useTheme();
  return (
    <View accessible accessibilityLabel="FleetOps" style={[styles.container, style]}>
      <FleetOpsMark size={size} variant={variant} />
      {showText && (
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.textGroup}>
          <FleetOpsWordmark variant={variant} size={size < 40 ? 21 : 28} />
          {subtitle && (
            <Text style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>DRIVER COMPANION</Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  mark: { flexShrink: 0 },
  textGroup: { justifyContent: "center", flexShrink: 1 },
  wordmark: { fontFamily: fonts.displayBold, letterSpacing: -0.7 },
  subtitle: { fontFamily: fonts.bodyMedium, fontSize: 9, lineHeight: 14, letterSpacing: 1.4 },
});
