import { StyleSheet, Text, View } from "react-native";
import { fonts } from "../../lib/theme";
import { useSettings } from "../../lib/settings-context";
import { FleetOpsMark, FleetOpsWordmark } from "../logo";
import { onboardingTheme } from "./onboardingTheme";

export function OnboardingHeader({ step = "1/2", compact = false }) {
  const { settings } = useSettings();
  const variant = settings.highContrast ? 'highContrastDark' : 'dark';

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      {/* Brand Left */}
      <View style={styles.brandGroup} accessible accessibilityRole="image" accessibilityLabel="FleetOps, Driver Companion">
        <View style={styles.brandGroup} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <FleetOpsMark size={compact ? 35 : 40} variant={variant} />
          <View style={styles.brandTextGroup}>
            <FleetOpsWordmark size={compact ? 20 : 23} variant={variant} />
            <Text style={[styles.brandSubtitle, compact && styles.brandSubtitleCompact, { color: settings.highContrast ? '#FFFFFF' : '#A6C7B8' }]}>
              DRIVER COMPANION
            </Text>
          </View>
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
    gap: 12,
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
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandTextGroup: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  brandSubtitle: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 9.5,
    lineHeight: 11,
    letterSpacing: 1.4,
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
