import { memo } from "react";
import { Image, StyleSheet } from "react-native";

const OFF_DUTY_IMAGE = require("../assets/images/off-duty.webp");

const styles = StyleSheet.create({
  // Override both native asset dimensions; aspectRatio alone retains its height.
  base: { flexShrink: 0, alignSelf: "center" },
  compact: { width: 44, height: 44 * 714 / 800 },
  card: { width: 88, height: 88 * 714 / 800 },
  hero: { width: 132, height: 132 * 714 / 800 },
});

const SIZE_STYLES = {
  compact: styles.compact,
  card: styles.card,
  hero: styles.hero,
};

function OffDutyIllustration({ size = "card", style }) {
  return (
    <Image
      source={OFF_DUTY_IMAGE}
      resizeMode="contain"
      accessible={false}
      style={[styles.base, SIZE_STYLES[size] || styles.card, style]}
    />
  );
}

export default memo(OffDutyIllustration);
