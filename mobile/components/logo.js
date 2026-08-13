import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";

/**
 * FleetOps Logo — matches Stitch FleetOps prototype branding:
 * Deep Indigo badge with truck icon, "FleetOps" in Inter Bold
 */
export function Logo({ size = 48, showText = true, style }) {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, style]}>
      <View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size * 0.25,
            backgroundColor: colors.primary,
          },
        ]}
      >
        <Ionicons name="car-sport" size={size * 0.55} color={colors.onPrimary} />
      </View>

      {showText && (
        <View style={styles.textGroup}>
          <Text style={[styles.brandText, { color: colors.primary }]}>
            FleetOps
          </Text>
          <Text style={[styles.subText, { color: colors.onSurfaceVariant }]}>
            DRIVER COMPANION
          </Text>
        </View>
      )}
    </View>
  );
}

/**
 * BrandBar — top brand header strip used on the consent and auth screens.
 * Matches the Stitch FleetOps TopAppBar design.
 */
export function BrandBar() {
  const { colors } = useTheme();
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
      <Logo size={40} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  badge: {
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  textGroup: { justifyContent: "center" },
  brandText: {
    fontSize: 20,
    fontFamily: fonts.displayBold,
    lineHeight: 28,
    letterSpacing: -0.5,
  },
  subText: {
    fontSize: 10,
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  bar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
