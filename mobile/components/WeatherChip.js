import React from "react";
import { StyleSheet, View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { moldedMaterials } from "./clay/molded-materials";

/**
 * Compact ambient weather chip for the Home header — claymorphism edition.
 * Features pill-shaped soft elevation, white top edge gleam, shaded bottom edge,
 * and a tactile molded icon disc matching the Home header's clay avatar and bell.
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
  const { colors, scheme } = useTheme();
  if (!value) return null;

  const isDark = scheme === "dark";
  const mats = moldedMaterials(isDark);

  const iconColor =
    value.condition === "night" || value.icon === "moon"
      ? colors.info
      : ["sunny", "partly-sunny", "thunderstorm"].includes(value.icon)
        ? colors.secondary
        : colors.info;

  const shadow = {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: isDark ? 0.35 : 0.16,
    shadowRadius: 8,
    elevation: 4,
  };

  return (
    <View
      style={[
        styles.chip,
        shadow,
        mats.clayPill,
        {
          backgroundColor: colors.surfaceContainerLow,
          width: compact ? 128 : 148,
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${value.temperature} Celsius, ${value.label}, ${value.condition || value.icon.replaceAll('-', ' ')}`}
    >
      <View
        style={[
          styles.iconDisc,
          shadow,
          mats.clayTile,
          {
            backgroundColor: isDark
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.03)",
          },
        ]}
      >
        <Ionicons
          name={value.condition === "night" ? "moon" : value.icon}
          size={compact ? 18 : 20}
          color={iconColor}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
        <Text style={[styles.temperature, { color: colors.onSurface }]}>
          {value.temperature}C
        </Text>
        {/* Location/condition stays on one line — long place names ellipsize
            rather than wrapping and growing the header row. */}
        <Text
          style={[styles.label, { color: colors.onSurfaceVariant }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {value.label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    paddingHorizontal: 8,
    paddingVertical: 5,
    minHeight: 44,
    borderRadius: 22,
  },
  iconDisc: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  temperature: {
    fontFamily: fonts.displayBold,
    fontSize: 14,
    lineHeight: 17,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 10.5,
    lineHeight: 13,
    maxWidth: 96,
  },
});

