import React, { useEffect } from "react";
import { StyleSheet, Text, View, Pressable, AccessibilityInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { moderateScale } from "../../lib/scaling";

/**
 * CoachMarkTooltip
 *
 * Tactile molded clay card presenting the operational explanation and navigation
 * controls, with a synchronized arrow pointing toward the spotlight cutout.
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
  const isWelcome = arrowPosition === "none";

  // Harmonized background color ensuring 100% arrow-to-card color continuity
  const cardBg = isDark ? "#17221D" : "#FFFFFF";

  // Announce title and guidance body to screen readers (TalkBack / VoiceOver)
  useEffect(() => {
    if (title && body) {
      AccessibilityInfo.announceForAccessibility(`${title}. ${body}`);
    }
  }, [title, body]);

  return (
    <View style={[styles.wrapper, style]}>
      {/* Arrow pointing UP (when tooltip is positioned below target) */}
      {arrowPosition === "top" && (
        <View
          style={[
            styles.arrowTop,
            {
              left: Math.max(16, Math.min(arrowOffset - 9, 280)),
              borderBottomColor: cardBg,
            },
          ]}
        />
      )}

      {/* Main Tactile Tooltip Card */}
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[
          styles.card,
          {
            backgroundColor: cardBg,
            borderColor: isDark ? "rgba(166, 199, 184, 0.20)" : "rgba(40, 84, 72, 0.12)",
            borderTopColor: isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.95)",
            borderBottomColor: isDark ? "rgba(0, 0, 0, 0.35)" : "rgba(40, 84, 72, 0.10)",
            shadowColor: isDark ? "#000000" : "#1B4332",
          },
        ]}
      >
        {/* First-Launch Welcome Header Badge */}
        {isWelcome && (
          <View
            style={[
              styles.welcomeBadge,
              {
                backgroundColor: isDark
                  ? "rgba(74, 222, 128, 0.12)"
                  : "rgba(40, 84, 72, 0.08)",
                borderColor: isDark
                  ? "rgba(74, 222, 128, 0.25)"
                  : "rgba(40, 84, 72, 0.15)",
              },
            ]}
          >
            <Ionicons
              name="compass-outline"
              size={moderateScale(22)}
              color={colors.primary}
            />
          </View>
        )}

        {/* Title */}
        <Text style={[styles.title, { color: colors.onSurface }]}>{title}</Text>

        {/* Body Text */}
        <Text style={[styles.body, { color: colors.onSurfaceVariant }]}>{body}</Text>

        {/* Action Footer */}
        <View style={styles.footer}>
          {showStepCounter ? (
            <View style={styles.stepBadge}>
              <View style={styles.dotsRow}>
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.progressDot,
                      i === stepIndex
                        ? [styles.progressDotActive, { backgroundColor: colors.primary }]
                        : [
                            styles.progressDotInactive,
                            {
                              backgroundColor: isDark
                                ? "rgba(255, 255, 255, 0.20)"
                                : "rgba(0, 0, 0, 0.12)",
                            },
                          ],
                    ]}
                  />
                ))}
              </View>
              <Text style={[styles.stepCounter, { color: colors.outline }]}>
                {stepIndex + 1} / {totalSteps}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          <View style={styles.btnRow}>
            {showBack && (
              <Pressable
                onPress={onPrev}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.secBtn,
                  pressed && {
                    backgroundColor: isDark
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(40, 84, 72, 0.06)",
                  },
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
                hitSlop={8}
                style={({ pressed }) => [
                  styles.secBtn,
                  pressed && {
                    backgroundColor: isDark
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(40, 84, 72, 0.06)",
                  },
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
              hitSlop={4}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: colors.primary,
                  borderColor: isDark
                    ? "rgba(255, 255, 255, 0.16)"
                    : "rgba(255, 255, 255, 0.32)",
                },
                pressed && { opacity: 0.90, transform: [{ scale: 0.97 }] },
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

      {/* Arrow pointing DOWN (when tooltip is positioned above target) */}
      {arrowPosition === "bottom" && (
        <View
          style={[
            styles.arrowBottom,
            {
              left: Math.max(16, Math.min(arrowOffset - 9, 280)),
              borderTopColor: cardBg,
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
    borderRadius: moderateScale(18),
    borderWidth: 1.2,
    borderTopWidth: 1.8,
    borderBottomWidth: 1.8,
    padding: moderateScale(18),
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 9,
  },
  welcomeBadge: {
    width: moderateScale(38),
    height: moderateScale(38),
    borderRadius: moderateScale(12),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: moderateScale(12),
  },
  title: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: moderateScale(16),
    lineHeight: moderateScale(22),
    letterSpacing: -0.3,
    marginBottom: moderateScale(6),
  },
  body: {
    fontFamily: fonts.body,
    fontSize: moderateScale(13.5),
    lineHeight: moderateScale(19.5),
    marginBottom: moderateScale(16),
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: moderateScale(2),
  },
  stepBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(4),
  },
  progressDot: {
    height: moderateScale(4),
    borderRadius: moderateScale(2),
  },
  progressDotActive: {
    width: moderateScale(14),
  },
  progressDotInactive: {
    width: moderateScale(4),
  },
  stepCounter: {
    fontFamily: fonts.dataSemiBold || fonts.bodyMedium,
    fontSize: moderateScale(12),
    letterSpacing: 0.4,
  },
  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(8),
  },
  secBtn: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: moderateScale(12),
    borderRadius: moderateScale(10),
    justifyContent: "center",
    alignItems: "center",
  },
  secBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(13.5),
  },
  primaryBtn: {
    minHeight: moderateScale(40),
    paddingHorizontal: moderateScale(18),
    borderRadius: moderateScale(12),
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 2,
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

