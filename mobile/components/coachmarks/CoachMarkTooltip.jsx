import React from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { moderateScale } from "../../lib/scaling";

/**
 * CoachMarkTooltip
 *
 * Molded clay card presenting the operational explanation and navigation
 * controls, with an arrow pointing toward the spotlight cutout.
 */
export function CoachMarkTooltip({
  title,
  body,
  stepIndex = 0,
  totalSteps = 1,
  actionText = "Got it",
  canSkip = false,
  onNext,
  onPrev,
  onSkip,
  arrowPosition = "top", // 'top' | 'bottom' | 'none'
  arrowOffset = 40,
  style,
}) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";

  const showStepCounter = totalSteps > 1;
  const showBack = stepIndex > 0;

  return (
    <View style={[styles.wrapper, style]}>
      {/* Arrow pointing UP (when tooltip is below target) */}
      {arrowPosition === "top" && (
        <View
          style={[
            styles.arrowTop,
            {
              left: Math.max(16, Math.min(arrowOffset - 8, 280)),
              borderBottomColor: isDark ? "#222D28" : "#FFFFFF",
            },
          ]}
        />
      )}

      {/* Main Tooltip Card */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: isDark ? "#1E2A24" : "#FFFFFF",
            borderColor: isDark ? "rgba(166, 199, 184, 0.25)" : "rgba(40, 84, 72, 0.15)",
            shadowColor: "#000000",
          },
        ]}
      >
        {/* Title */}
        <Text style={[styles.title, { color: colors.onSurface }]}>{title}</Text>

        {/* Body Text */}
        <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{body}</Text>

        {/* Action Footer */}
        <View style={styles.footer}>
          {showStepCounter ? (
            <Text style={[styles.stepCounter, { color: colors.outline }]}>
              {stepIndex + 1} / {totalSteps}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <View style={styles.btnRow}>
            {showBack && (
              <Pressable
                onPress={onPrev}
                style={({ pressed }) => [
                  styles.secBtn,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Go back to previous tip"
              >
                <Text style={[styles.secBtnText, { color: colors.onSurfaceVariant }]}>
                  Back
                </Text>
              </Pressable>
            )}

            {canSkip && (
              <Pressable
                onPress={onSkip}
                style={({ pressed }) => [
                  styles.secBtn,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Skip this guide"
              >
                <Text style={[styles.secBtnText, { color: colors.onSurfaceVariant }]}>
                  Skip
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={onNext}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary },
                pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel={actionText}
            >
              <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>
                {actionText}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Arrow pointing DOWN (when tooltip is above target) */}
      {arrowPosition === "bottom" && (
        <View
          style={[
            styles.arrowBottom,
            {
              left: Math.max(16, Math.min(arrowOffset - 8, 280)),
              borderTopColor: isDark ? "#222D28" : "#FFFFFF",
            },
          ]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "90%",
    maxWidth: moderateScale(340),
    alignSelf: "center",
    zIndex: 9999,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: moderateScale(16),
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: moderateScale(16),
    lineHeight: moderateScale(22),
    letterSpacing: -0.2,
    marginBottom: moderateScale(6),
  },
  body: {
    fontFamily: fonts.body,
    fontSize: moderateScale(13.5),
    lineHeight: moderateScale(19),
    marginBottom: moderateScale(14),
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: moderateScale(4),
  },
  stepCounter: {
    fontFamily: fonts.dataSemiBold || fonts.bodyMedium,
    fontSize: moderateScale(12),
    letterSpacing: 0.5,
  },
  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(10),
  },
  secBtn: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: moderateScale(10),
    justifyContent: "center",
    alignItems: "center",
  },
  secBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(13.5),
  },
  primaryBtn: {
    minHeight: moderateScale(38),
    paddingHorizontal: moderateScale(16),
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  primaryBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(13.5),
  },
  arrowTop: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginBottom: -1,
  },
  arrowBottom: {
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 9,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
});

export default CoachMarkTooltip;
