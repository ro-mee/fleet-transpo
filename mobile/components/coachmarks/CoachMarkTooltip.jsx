import React, { useEffect } from "react";
import { StyleSheet, Text, View, Pressable, AccessibilityInfo } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../lib/theme-context";
import { fonts, TOUCH_TARGET } from "../../lib/theme";
import { moderateScale } from "../../lib/scaling";
import { TOOLTIP_MAX_WIDTH } from "../../lib/spotlight-geometry";

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
  allowBack = true,
  onNext,
  onPrev,
  onSkip,
  arrowPosition = "top", // 'top' | 'bottom' | 'left' | 'right' | 'none'
  arrowOffset = 40,
  style,
  compact = false,
  badge = null,
  onMeasure,
}) {
  const { colors, scheme } = useTheme();
  const isDark = scheme === "dark";

  const showStepCounter = totalSteps > 1;
  const showBack = allowBack && stepIndex > 0;
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
    <View
      style={[styles.wrapper, compact && styles.compactWrapper, style]}
      // Report the card's real height so placement can stop guessing it. The
      // card grows with copy length, the step counter and the action row, and
      // every `Text` here scales with the system font scale.
      onLayout={
        onMeasure
          ? (event) => onMeasure(event.nativeEvent.layout.height)
          : undefined
      }
    >
      {/* Arrow pointing UP (when tooltip is positioned below target) */}
      {arrowPosition === "top" && (
        <View
          style={[
            styles.arrowTop,
            {
              // `arrowOffset` is the arrow's CENTRE and is already bounded
              // within the card by `resolveArrowOffset`. The bare 280 that used
              // to cap it here was not a property of the card at all: on a 412dp
              // screen it stopped the arrow while the card reached 356.8, so any
              // target on the right of the screen got an arrow aimed at empty
              // card.
              left: Math.max(0, arrowOffset - 9),
              borderBottomColor: cardBg,
            },
          ]}
        />
      )}

      {/* Arrow pointing LEFT (when tooltip is docked to the right of target) */}
      {arrowPosition === "left" && (
        <View
          style={[
            styles.arrowLeft,
            {
              top: Math.max(10, arrowOffset - 8),
              borderRightColor: cardBg,
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
          compact && styles.compactCard,
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

        {/* Emergency / Action Badge */}
        {badge === "emergency" && (
          <View
            style={[
              styles.emergencyBadge,
              {
                backgroundColor: isDark
                  ? "rgba(239, 68, 68, 0.15)"
                  : "rgba(220, 38, 38, 0.08)",
                borderColor: isDark
                  ? "rgba(239, 68, 68, 0.30)"
                  : "rgba(220, 38, 38, 0.18)",
              },
            ]}
          >
            <Ionicons
              name="alert-circle"
              size={moderateScale(13)}
              color={isDark ? "#F87171" : "#DC2626"}
            />
            <Text
              style={[
                styles.emergencyBadgeText,
                { color: isDark ? "#F87171" : "#DC2626" },
              ]}
            >
              EMERGENCY ACTION
            </Text>
          </View>
        )}

        {/* Title */}
        <Text
          style={[
            styles.title,
            compact && styles.compactTitle,
            { color: colors.onSurface },
          ]}
        >
          {title}
        </Text>

        {/* Body Text */}
        <Text
          style={[
            styles.body,
            compact && styles.compactBody,
            { color: colors.onSurfaceVariant },
          ]}
        >
          {body}
        </Text>

        {/* Action Footer */}
        <View style={[styles.footer, compact && styles.compactFooter]}>
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

          <View style={[styles.btnRow, compact && styles.compactBtnRow]}>
            {showBack && (
              <Pressable
                onPress={onPrev}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.secBtn,
                  compact && styles.compactSecBtn,
                  pressed && {
                    backgroundColor: isDark
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(40, 84, 72, 0.06)",
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Go back to previous tip"
              >
                <Text style={[styles.secBtnText, compact && styles.compactBtnText, { color: colors.onSurfaceVariant }]}>
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
                  compact && styles.compactSecBtn,
                  pressed && {
                    backgroundColor: isDark
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(40, 84, 72, 0.06)",
                  },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Skip this guide"
              >
                <Text style={[styles.secBtnText, compact && styles.compactBtnText, { color: colors.onSurfaceVariant }]}>
                  Skip
                </Text>
              </Pressable>
            )}

            <Pressable
              onPress={onNext}
              hitSlop={4}
              style={({ pressed }) => [
                styles.primaryBtn,
                compact && styles.compactPrimaryBtn,
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
              <Text style={[styles.primaryBtnText, compact && styles.compactBtnText, { color: colors.onPrimary }]}>
                {actionText}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>

      {/* Arrow pointing RIGHT (when tooltip is docked to the left of target) */}
      {arrowPosition === "right" && (
        <View
          style={[
            styles.arrowRight,
            {
              top: arrowOffset - 8,
              borderLeftColor: cardBg,
            },
          ]}
        />
      )}

      {/* Arrow pointing DOWN (when tooltip is positioned above target) */}
      {arrowPosition === "bottom" && (
        <View
          style={[
            styles.arrowBottom,
            {
              left: arrowOffset - 9,
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
    maxWidth: moderateScale(TOOLTIP_MAX_WIDTH),
    alignSelf: "center",
    zIndex: 9999,
  },
  compactWrapper: {
    width: "auto",
    maxWidth: moderateScale(240),
    alignSelf: "auto",
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
  compactCard: {
    padding: moderateScale(12),
    borderRadius: moderateScale(14),
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
  emergencyBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: moderateScale(7),
    paddingVertical: moderateScale(3),
    borderRadius: moderateScale(6),
    borderWidth: 1,
    gap: moderateScale(4),
    marginBottom: moderateScale(6),
  },
  emergencyBadgeText: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: moderateScale(10),
    letterSpacing: 0.5,
    fontWeight: "700",
  },
  title: {
    fontFamily: fonts.displayBold || fonts.bodySemiBold,
    fontSize: moderateScale(16),
    lineHeight: moderateScale(22),
    letterSpacing: -0.3,
    marginBottom: moderateScale(6),
  },
  compactTitle: {
    fontSize: moderateScale(14),
    lineHeight: moderateScale(18),
    marginBottom: moderateScale(4),
  },
  body: {
    fontFamily: fonts.body,
    fontSize: moderateScale(13.5),
    lineHeight: moderateScale(19.5),
    marginBottom: moderateScale(16),
  },
  compactBody: {
    fontSize: moderateScale(12),
    lineHeight: moderateScale(16.5),
    marginBottom: moderateScale(10),
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: moderateScale(2),
  },
  compactFooter: {
    marginTop: 0,
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
  compactBtnRow: {
    gap: moderateScale(6),
  },
  secBtn: {
    minHeight: TOUCH_TARGET,
    paddingHorizontal: moderateScale(12),
    borderRadius: moderateScale(10),
    justifyContent: "center",
    alignItems: "center",
  },
  compactSecBtn: {
    minHeight: moderateScale(32),
    paddingHorizontal: moderateScale(8),
    borderRadius: moderateScale(8),
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
  compactPrimaryBtn: {
    minHeight: moderateScale(32),
    paddingHorizontal: moderateScale(12),
    borderRadius: moderateScale(8),
  },
  primaryBtnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: moderateScale(13.5),
  },
  compactBtnText: {
    fontSize: moderateScale(12),
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
  arrowLeft: {
    position: "absolute",
    left: -8,
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderRightWidth: 8,
    borderLeftWidth: 0,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    zIndex: 10,
  },
  arrowRight: {
    position: "absolute",
    right: -8,
    width: 0,
    height: 0,
    backgroundColor: "transparent",
    borderStyle: "solid",
    borderTopWidth: 8,
    borderBottomWidth: 8,
    borderLeftWidth: 8,
    borderRightWidth: 0,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    zIndex: 10,
  },
});

export default CoachMarkTooltip;
