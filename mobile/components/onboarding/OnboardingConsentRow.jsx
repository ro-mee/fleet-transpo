import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../lib/theme";
import { onboardingTheme } from "./onboardingTheme";

export function OnboardingConsentRow({
  checked = false,
  onToggle,
  compact = false,
  style,
}) {
  const { colors } = onboardingTheme;

  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.container,
        compact && styles.containerCompact,
        pressed && styles.pressed,
        style,
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel="I agree to the Terms and Conditions and Privacy Policy"
    >
      {/* Checkbox squircle */}
      <View
        style={[
          styles.checkbox,
          compact && styles.checkboxCompact,
          checked && styles.checkboxChecked,
        ]}
      >
        {checked && (
          <Ionicons
            name="checkmark"
            size={compact ? 13 : 15}
            color="#031B1B"
          />
        )}
      </View>

      {/* Legal Label */}
      <Text style={[styles.label, compact && styles.labelCompact]}>
        I agree to the{" "}
        <Text style={styles.linkText}>Terms and Conditions</Text>
        {" "}and{" "}
        <Text style={styles.linkText}>Privacy Policy</Text>
      </Text>

      {/* Trailing Chevron */}
      <View style={styles.chevronWrap}>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={colors.chevron}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: onboardingTheme.colors.surface,
    borderWidth: 1,
    borderColor: onboardingTheme.colors.surfaceBorder,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.24,
    shadowRadius: 5,
    elevation: 3,
  },
  containerCompact: {
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "rgba(120, 224, 210, 0.45)",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxCompact: {
    width: 20,
    height: 20,
    borderRadius: 5,
  },
  checkboxChecked: {
    backgroundColor: onboardingTheme.colors.aqua,
    borderColor: onboardingTheme.colors.aqua,
  },
  label: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 17,
    color: onboardingTheme.colors.textPrimary,
  },
  labelCompact: {
    fontSize: 12,
    lineHeight: 15.5,
  },
  linkText: {
    fontFamily: fonts.displaySemiBold,
    color: onboardingTheme.colors.mint,
  },
  chevronWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
});
