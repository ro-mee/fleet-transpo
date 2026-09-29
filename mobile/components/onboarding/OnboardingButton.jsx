import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../lib/theme";
import { onboardingTheme } from "./onboardingTheme";

export function OnboardingButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  compact = false,
  icon = "arrow-forward",
  style,
}) {
  const { colors } = onboardingTheme;

  const content = (
    <View style={[styles.innerContent, compact && styles.innerContentCompact]}>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={disabled ? colors.buttonDisabledText : colors.buttonText}
        />
      ) : (
        <>
          <Text
            style={[
              styles.label,
              compact && styles.labelCompact,
              disabled ? styles.labelDisabled : styles.labelEnabled,
            ]}
          >
            {label}
          </Text>
          <Ionicons
            name={icon}
            size={compact ? 16 : 18}
            color={disabled ? colors.buttonDisabledText : colors.buttonText}
          />
        </>
      )}
    </View>
  );

  if (disabled) {
    return (
      <View
        style={[
          styles.buttonBase,
          styles.buttonDisabled,
          compact && styles.buttonBaseCompact,
          style,
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.buttonBase,
        compact && styles.buttonBaseCompact,
        pressed && styles.buttonPressed,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
    >
      <LinearGradient
        colors={colors.buttonGrad}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.gradient, compact && styles.gradientCompact]}
      >
        {content}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    width: "100%",
    borderRadius: 999,
    overflow: "hidden",
    shadowColor: "#57D7D4",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  buttonBaseCompact: {
    borderRadius: 999,
  },
  buttonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  buttonDisabled: {
    backgroundColor: onboardingTheme.colors.buttonDisabled,
    shadowOpacity: 0,
    elevation: 0,
  },
  gradient: {
    width: "100%",
    height: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  gradientCompact: {
    height: 46,
  },
  innerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    paddingHorizontal: 20,
  },
  innerContentCompact: {
    height: 46,
    gap: 6,
    paddingHorizontal: 16,
  },
  label: {
    fontFamily: fonts.displayBold,
    fontSize: 15.5,
    letterSpacing: 0.2,
  },
  labelCompact: {
    fontSize: 14.5,
  },
  labelEnabled: {
    color: onboardingTheme.colors.buttonText,
  },
  labelDisabled: {
    color: onboardingTheme.colors.buttonDisabledText,
  },
});
