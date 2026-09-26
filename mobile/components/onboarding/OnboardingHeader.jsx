import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../lib/theme";
import { onboardingTheme } from "./onboardingTheme";

export function OnboardingHeader({ step = "1/2", compact = false }) {
  const { colors } = onboardingTheme;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {/* Brand Left */}
      <View style={styles.brandGroup}>
        <View style={[styles.logoSquircle, compact && styles.logoSquircleCompact]}>
          <Ionicons
            name="car-sport"
            size={compact ? 18 : 21}
            color={colors.mint}
          />
        </View>
        <View style={styles.brandTextGroup}>
          <Text style={[styles.brandTitle, compact && styles.brandTitleCompact]}>
            FleetOps
          </Text>
          <Text style={[styles.brandSubtitle, compact && styles.brandSubtitleCompact]}>
            DRIVER COMPANION
          </Text>
        </View>
      </View>

      {/* Step Badge Right */}
      <View style={[styles.stepBadge, compact && styles.stepBadgeCompact]}>
        <Text style={[styles.stepText, compact && styles.stepTextCompact]}>
          {step}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 8,
  },
  containerCompact: {
    paddingHorizontal: 16,
    paddingTop: 3,
    paddingBottom: 5,
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoSquircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#0E3836",
    borderWidth: 1,
    borderColor: "rgba(120, 224, 210, 0.32)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  logoSquircleCompact: {
    width: 35,
    height: 35,
    borderRadius: 10,
  },
  brandTextGroup: {
    justifyContent: "center",
  },
  brandTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 23,
    lineHeight: 26,
    color: onboardingTheme.colors.textPrimary,
    letterSpacing: -0.3,
  },
  brandTitleCompact: {
    fontSize: 20,
    lineHeight: 23,
  },
  brandSubtitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 9.5,
    lineHeight: 11,
    letterSpacing: 1.4,
    color: onboardingTheme.colors.aqua,
    marginTop: 1,
  },
  brandSubtitleCompact: {
    fontSize: 8.5,
    lineHeight: 10,
    letterSpacing: 1.1,
    marginTop: 0,
  },
  stepBadge: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#113233",
    borderWidth: 1,
    borderColor: "rgba(120, 224, 210, 0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  stepBadgeCompact: {
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  stepText: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 11.5,
    color: onboardingTheme.colors.mint,
    letterSpacing: 0.4,
  },
  stepTextCompact: {
    fontSize: 10.5,
  },
});
