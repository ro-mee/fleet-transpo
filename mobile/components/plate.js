import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../lib/theme-context";
import { fonts, space } from "../lib/theme";

/**
 * Vehicle identity as a physical plate.
 *
 * FleetOps renders the plate as the object a driver actually sees on the
 * vehicle — a paper plate with a hairline frame, mono lettering, and marker
 * screws — rather than another grey code string. This is the design system's
 * "license plate" domain pattern (docs/design-system.md, appendix), used only
 * in high-value spots: the active trip and pending assignment cards.
 */
export function Plate({ plate, size = "md" }) {
  const { colors } = useTheme();
  if (!plate) return null;
  const large = size === "lg";

  return (
    <View
      style={[
        styles.plate,
        { borderColor: colors.onSurface, backgroundColor: colors.surfaceContainerLow },
        large && styles.plateLg,
      ]}
      accessibilityLabel={`Vehicle plate ${plate}`}
    >
      <View style={[styles.screw, { backgroundColor: colors.outline }, styles.screwLeft, large && styles.screwLg]} />
      <View style={[styles.screw, { backgroundColor: colors.outline }, styles.screwRight, large && styles.screwLg]} />
      <Text
        style={[styles.text, { color: colors.onSurface }, large && styles.textLg]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {plate}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    borderWidth: 1.5,
    borderRadius: 6,
    height: 34,
    minWidth: 96,
    paddingHorizontal: space.base,
  },
  plateLg: {
    height: 46,
    minWidth: 148,
    paddingHorizontal: space.xl,
    borderRadius: 8,
  },
  text: {
    fontFamily: fonts.dataSemiBold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: 2,
    fontVariant: ["tabular-nums"],
  },
  textLg: {
    fontSize: 21,
    lineHeight: 26,
    letterSpacing: 3,
  },
  screw: {
    position: "absolute",
    top: 5,
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  screwLg: {
    top: 7,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  screwLeft: { left: 7 },
  screwRight: { right: 7 },
});

