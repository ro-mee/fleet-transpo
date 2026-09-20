import React from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "../../../lib/theme-context";
import { moderateScale } from "../../../lib/scaling";
import DemoProgressHeader from "./DemoProgressHeader";
import CoachMarkDemoHost from "./CoachMarkDemoHost";

export default function CoachMarkSimulationPanel({
  step,
  onHandoff,
  onSkip,
  style,
}) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: isDark ? "#17221D" : "#FFFFFF",
          borderColor: isDark
            ? "rgba(166, 199, 184, 0.22)"
            : "rgba(40, 84, 72, 0.14)",
          shadowColor: isDark ? "#000" : colors.primary,
        },
        style,
      ]}
      accessibilityViewIsModal
    >
      <DemoProgressHeader
        title={step?.title || "Safe practice"}
        subtitle="Training only — no live fuel data is changed."
        onSkip={onSkip}
      />
      <CoachMarkDemoHost
        demoKey={step?.demoKey}
        onComplete={onHandoff}
        onSkip={onSkip}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "92%",
    maxWidth: moderateScale(380),
    alignSelf: "center",
    borderRadius: moderateScale(20),
    borderWidth: 1,
    padding: moderateScale(16),
    gap: moderateScale(14),
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 10,
    zIndex: 10000,
  },
});
