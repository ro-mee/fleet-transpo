import React from "react";
import { StyleSheet, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";

/**
 * Compact ambient weather chip for the Home header — informational context
 * only. Never a banner, toast, or notification: actionable driving issues
 * (off-route / traffic / GPS) own the ONE calm banner surface; weather stays
 * a small pill beside the notification bell (see the plan note, 2026-09-09).
 *
 * Passive by design: no press state, no badge, no animation, no skeleton —
 * and no chip at all when there is no truthful payload (offline, provider
 * failure, no position). Weather from a previous trip never reaches this
 * component: the caller applies the poster's trip-id staleness guard.
 *
 * @param {object|null} props.value  the derivation from weatherChipFor()
 *   ({ icon, temperature, label }) — null renders nothing.
 */
export default function WeatherChip({ value, compact = false }) {
  const { colors } = useTheme();
  if (!value) return null;

  return (
    <View
      style={[styles.chip, { backgroundColor: colors.surfaceContainerLow, shadowColor: colors.shadow, width: compact ? 112 : 158 }]}
      accessibilityRole="text"
      accessibilityLabel={`${value.temperature} Celsius, ${value.label}, ${value.condition || value.icon.replaceAll('-', ' ')}`}
    >
      <Ionicons name={value.condition === 'night' ? 'moon' : value.icon} size={compact ? 24 : 30} color={value.condition === 'night' || value.icon === 'moon' ? colors.info : ['sunny', 'partly-sunny', 'thunderstorm'].includes(value.icon) ? colors.secondary : colors.info} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.temperature, { color: colors.onSurface }]}>{value.temperature}C</Text>
        <Text style={[styles.label, { color: colors.onSurfaceVariant }]}>
          {value.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same compact-surface idiom as the header's other cards (radius, border,
  // subtle elevation) — content-fit, never full width.
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 9,
    minHeight: 52,
    borderRadius: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.17,
    shadowRadius: 9,
    elevation: 4,
  },
  temperature: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    lineHeight: 18,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 13,
    maxWidth: 110,
  },
});
