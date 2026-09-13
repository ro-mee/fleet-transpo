import React, { memo } from "react";
import { StyleSheet, View, Text, Image } from "react-native";
import { useTheme } from "../lib/theme-context";
import { fonts } from "../lib/theme";
import { moldedMaterials } from "./clay/molded-materials";

// Meteocons Fill static art (see mobile/assets/images/weather/ATTRIBUTION.md).
// Static requires so Metro bundles exactly these files — keep in sync with
// WEATHER_ICON_KEYS in mobile/lib/weather-chip.js (the test locks this).
// Shared with the map standby weather card, which renders the same chip model.
export const METEOCON_ASSETS = {
  "clear-day": require("../assets/images/weather/clear-day.png"),
  "clear-night": require("../assets/images/weather/clear-night.png"),
  "mostly-clear-day": require("../assets/images/weather/mostly-clear-day.png"),
  "mostly-clear-night": require("../assets/images/weather/mostly-clear-night.png"),
  "partly-cloudy-day": require("../assets/images/weather/partly-cloudy-day.png"),
  "partly-cloudy-night": require("../assets/images/weather/partly-cloudy-night.png"),
  overcast: require("../assets/images/weather/overcast.png"),
  fog: require("../assets/images/weather/fog.png"),
  drizzle: require("../assets/images/weather/drizzle.png"),
  rain: require("../assets/images/weather/rain.png"),
  snow: require("../assets/images/weather/snow.png"),
  thunderstorms: require("../assets/images/weather/thunderstorms.png"),
};

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
 * Memoized: the Home header re-renders on a 30s tick (GPS-age caption), and
 * the chip's props are a stable derivation — without memo every tick would
 * recompute the clay shadows for an unchanged pill.
 *
 * @param {object|null} props.value  the derivation from weatherChipFor()
 *   ({ icon: Meteocons key, temperature, label, isNight }) — null renders
 *   nothing. The full-color art carries its own colors, so no glyph tinting;
 *   temperature/label keep theme tokens.
 */
function WeatherChip({ value, compact = false }) {
  const { colors, scheme } = useTheme();
  const art = value ? METEOCON_ASSETS[value.icon] : null;
  if (!value || !art) return null;

  const isDark = scheme === "dark";
  const mats = moldedMaterials(isDark);
  // No disc backdrop: the art renders directly in the row at near-disc size
  // so the small glyph stays clearly visible.
  const artSize = compact ? 30 : 32;
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
      accessibilityLabel={`${value.temperature} Celsius, ${value.label}, ${value.icon.replaceAll("-", " ")}`}
    >
      <Image
        source={art}
        resizeMode="contain"
        accessible={false}
        style={{ width: artSize, height: artSize }}
      />
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>
        <Text style={[styles.temperature, { color: colors.onSurface }]}>
          {value.temperature}
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

export default memo(WeatherChip);

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
