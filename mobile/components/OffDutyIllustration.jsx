import { memo } from "react";
import { Image, StyleSheet } from "react-native";

const OFF_DUTY_IMAGE = require("../assets/images/off-duty.webp");

const styles = StyleSheet.create({
  base: { aspectRatio: 1327 / 1185, flexShrink: 0 },
  compact: { width: 72 },
  card: { width: 152 },
  hero: { width: 220 },
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
