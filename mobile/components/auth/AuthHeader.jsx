// mobile/components/auth/AuthHeader.jsx
import { StyleSheet, Text, View } from "react-native";
import { ClayTile } from "../clay";
import { useTheme } from "../../lib/theme-context";
import { fonts } from "../../lib/theme";
import { moderateScale } from "../../lib/scaling";

/**
 * AuthHeader — the shared FleetOps auth brand block.
 *
 * Extracted from the block that was duplicated byte-for-byte across
 * login / forgot-password / reset-password. It deliberately does NOT render
 * a back button: every screen keeps its own, above this block.
 */
export function AuthHeader({ icon, title, tagline }) {
  const { colors } = useTheme();
  return (
    <View style={styles.brand}>
      <ClayTile
        icon={icon}
        size="lg"
        backgroundColor={colors.primary}
        color={colors.onPrimary}
        style={styles.logoTile}
      />
      <Text style={[styles.appName, { color: colors.primary }]}>{title}</Text>
      <Text style={[styles.tagline, { color: colors.onSurfaceVariant }]}>{tagline}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: "center",
    gap: moderateScale(8),
    marginBottom: moderateScale(4),
  },
  logoTile: {
    marginBottom: moderateScale(4),
  },
  appName: {
    fontSize: moderateScale(28),
    fontFamily: fonts.displayBold,
    lineHeight: moderateScale(36),
    textAlign: "center",
  },
  tagline: {
    fontSize: moderateScale(16),
    fontFamily: fonts.body,
    lineHeight: moderateScale(24),
    textAlign: "center",
  },
});
