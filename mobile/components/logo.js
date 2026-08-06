import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, space } from "../lib/theme";

/**
 * FleetOps brand mark: a dark rounded square with a white car silhouette,
 * inherited from the web sidebar and login logos. Drawn with Views so the app
 * carries no icon dependency.
 */
export function LogoMark({ variant = "app", size = "sm" }) {
  const large = size === "lg";
  const bg = variant === "login" ? colors.primary : colors.foreground;

  return (
    <View
      style={[
        styles.mark,
        { backgroundColor: bg, borderRadius: large ? 18 : 8 },
        large ? styles.markLg : styles.markSm,
      ]}
      accessibilityLabel="FleetOps"
    >
      <View style={[styles.cabin, large ? styles.cabinLg : styles.cabinSm]} />
      <View style={[styles.body, large ? styles.bodyLg : styles.bodySm]} />
      <View
        style={[
          styles.wheel,
          large ? styles.wheelLg : styles.wheelSm,
          large ? styles.wheelLgPosL : styles.wheelPosL,
        ]}
      />
      <View
        style={[
          styles.wheel,
          large ? styles.wheelLg : styles.wheelSm,
          large ? styles.wheelLgPosR : styles.wheelPosR,
        ]}
      />
    </View>
  );
}

/** Signed-in top bar: brand mark + wordmark, with an optional right slot. */
export function BrandBar({ right }) {
  return (
    <View style={styles.bar}>
      <View style={styles.barBrand}>
        <LogoMark size="sm" />
        <Text style={styles.barName}>FleetOps</Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  markSm: { width: 28, height: 28 },
  markLg: { width: 64, height: 64 },
  // Cabin sits above and overlapping the body, front view.
  cabin: {
    position: "absolute",
    backgroundColor: colors.surface,
    borderRadius: 2,
  },
  cabinSm: { top: 8, left: 9, width: 10, height: 5 },
  cabinLg: { top: 18, left: 20, width: 23, height: 12, borderRadius: 4 },
  body: {
    position: "absolute",
    backgroundColor: colors.surface,
    borderRadius: 2,
  },
  bodySm: { top: 12, left: 5, width: 18, height: 6 },
  bodyLg: { top: 27, left: 11, width: 42, height: 14, borderRadius: 4 },
  // Wheels punch through the glyph in the mark's background colour.
  wheel: {
    position: "absolute",
    borderRadius: 99,
  },
  wheelSm: { width: 4, height: 4 },
  wheelLg: { width: 9, height: 9 },
  wheelPosL: { top: 16, left: 5.5 },
  wheelPosR: { top: 16, right: 5.5 },
  wheelLgPosL: { top: 37, left: 13 },
  wheelLgPosR: { top: 37, right: 13 },

  bar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  barBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  barName: {
    fontFamily: fonts.display,
    fontSize: 16,
    lineHeight: 20,
    color: colors.foreground,
  },
});
