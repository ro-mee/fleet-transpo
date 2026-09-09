import React from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { moderateScale } from "../lib/scaling";
import { useTheme } from "../lib/theme-context";
import { TOUCH_TARGET } from "../lib/theme";
import { clayMaterials } from "../lib/clay";

/**
 * Clay menu row — the exact anatomy established on the Profile tab: forest
 * clayTile icon, label, chevron, softened divider, ≥48dp row, pressed/hover
 * state. Extracted so every clay menu (Profile sections, Personal Information
 * hub rows) reuses one row instead of inventing siblings.
 */
export default function ClayMenuRow({ title, icon, onPress, isLast = false }) {
  const { colors, type, scheme } = useTheme();
  const mats = clayMaterials(scheme === "dark");
  return (
    <Pressable
      style={({ hovered, pressed }) => [
        styles.menuRow,
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.outlineVariant + "40" },
        (hovered || pressed) && { backgroundColor: colors.surfaceContainerHigh, borderRadius: 14 },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.menuRowLeft}>
        <View style={[styles.menuIconTile, mats.clayTile, { backgroundColor: colors.primaryContainer, shadowColor: colors.shadow }]}>
          <Ionicons name={icon} size={18} color={colors.onPrimaryContainer} />
        </View>
        <Text style={[type.bodyMd, styles.menuTitle, { color: colors.onSurface }]}>{title}</Text>
      </View>
      <View style={styles.menuRowRight}>
        <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  menuRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: moderateScale(9),
    paddingHorizontal: 8,
    minHeight: TOUCH_TARGET,
  },
  menuRowLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  menuIconTile: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  menuTitle: {},
  menuRowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
});
