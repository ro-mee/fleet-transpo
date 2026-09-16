import React, { useEffect, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Dimensions,
  Animated,
  AccessibilityInfo,
  BackHandler,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../lib/theme-context";
import CoachMarkTooltip from "./CoachMarkTooltip";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/**
 * CoachMarkOverlay
 *
 * Fullscreen dimmed scrim with a transparent cutout around the measured production
 * target, subtle theme-derived contour, and an attached operational tooltip.
 *
 * Adheres strictly to:
 * - REAL PASSTHROUGH: 4-rectangle blocking scrim leaves the spotlight hole
 *   uncovered for interactive steps (pointerEvents="none").
 * - PROTECTED ACTIONS: Protected CTA buttons (SOS, Start Trip) have cutout
 *   pointerEvents="auto", requiring "Got it" to advance without forcing the action.
 * - VISUALS: Theme forest-green primary contour, no neon #00E676, single arrival pulse.
 * - ACCESSIBILITY: BackHandler dismiss on Android, respects reduce motion.
 */
export function CoachMarkOverlay({
  milestone,
  step,
  stepIndex = 0,
  totalSteps = 1,
  targetLayout,
  stepContext,
  onNext,
  onPrev,
  onSkip,
  onDismiss,
}) {
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const isDark = scheme === "dark";

  const [reduceMotion, setReduceMotion] = useState(false);

  // Spotlight geometry with 8dp breathing room
  const pad = targetLayout?.padding ?? 8;
  const rawX = targetLayout?.x ?? 0;
  const rawY = targetLayout?.y ?? 0;
  const rawW = targetLayout?.width ?? 0;
  const rawH = targetLayout?.height ?? 0;

  const spotX = Math.max(0, rawX - pad);
  const spotY = Math.max(0, rawY - pad);
  const spotW = Math.max(0, Math.min(SCREEN_WIDTH - spotX, rawW + pad * 2));
  const spotH = Math.max(0, Math.min(SCREEN_HEIGHT - spotY, rawH + pad * 2));
  const radius = targetLayout?.radius ?? 12;

  // Animated values for smooth bounds transitions and restrained arrival pulse
  const [animX] = useState(() => new Animated.Value(spotX));
  const [animY] = useState(() => new Animated.Value(spotY));
  const [animW] = useState(() => new Animated.Value(spotW));
  const [animH] = useState(() => new Animated.Value(spotH));
  const [pulseAnim] = useState(() => new Animated.Value(0.25));
  const [tooltipOpacity] = useState(() => new Animated.Value(0));
  const [overlayFade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  // Android hardware back button dismisses coach mark
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onDismiss?.();
      return true;
    });
    return () => sub.remove();
  }, [onDismiss]);

  // Initial overlay entrance fade
  useEffect(() => {
    overlayFade.setValue(0);
    Animated.timing(overlayFade, {
      toValue: 1,
      duration: reduceMotion ? 80 : 200,
      useNativeDriver: true,
    }).start();
  }, [overlayFade, reduceMotion]);

  // Spotlight repositioning & single arrival pulse (NO infinite loop)
  useEffect(() => {
    if (!targetLayout) return;

    if (reduceMotion) {
      animX.setValue(spotX);
      animY.setValue(spotY);
      animW.setValue(spotW);
      animH.setValue(spotH);
      tooltipOpacity.setValue(1);
      pulseAnim.setValue(0.5);
      return;
    }

    // Fade tooltip out slightly, interpolate bounds, fade tooltip in, and pulse once on arrival
    Animated.timing(tooltipOpacity, {
      toValue: 0,
      duration: 100,
      useNativeDriver: true,
    }).start(() => {
      Animated.parallel([
        Animated.timing(animX, {
          toValue: spotX,
          duration: 240,
          useNativeDriver: false,
        }),
        Animated.timing(animY, {
          toValue: spotY,
          duration: 240,
          useNativeDriver: false,
        }),
        Animated.timing(animW, {
          toValue: spotW,
          duration: 240,
          useNativeDriver: false,
        }),
        Animated.timing(animH, {
          toValue: spotH,
          duration: 240,
          useNativeDriver: false,
        }),
      ]).start(() => {
        Animated.timing(tooltipOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }).start();

        // ONE restrained emphasis pulse on arrival
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.85,
            duration: 320,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.25,
            duration: 380,
            useNativeDriver: true,
          }),
        ]).start();
      });
    });
  }, [
    spotX,
    spotY,
    spotW,
    spotH,
    animX,
    animY,
    animW,
    animH,
    pulseAnim,
    tooltipOpacity,
    reduceMotion,
    targetLayout,
  ]);

  if (!milestone || !step) return null;

  const bodyText =
    typeof step.dynamicBody === "function"
      ? step.dynamicBody(stepContext)
      : step.body;

  // Scrim color: dark translucent preserving underlying visual context
  const scrimBg = isDark ? "rgba(10, 15, 13, 0.76)" : "rgba(15, 25, 20, 0.65)";

  // If there's no target (e.g. Welcome card), render centered card over full scrim
  if (!targetLayout) {
    return (
      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, styles.rootOverlay]}
      >
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: overlayFade }]}
        >
          <View
            pointerEvents="auto"
            style={[StyleSheet.absoluteFill, { backgroundColor: scrimBg }]}
          />
          <View style={styles.centerCardWrap} pointerEvents="box-none">
            <CoachMarkTooltip
              title={step.title}
              body={bodyText}
              stepIndex={stepIndex}
              totalSteps={totalSteps}
              actionText={step.actionText || "Got it"}
              canSkip={step.canSkip}
              arrowPosition="none"
              onNext={onNext}
              onPrev={onPrev}
              onSkip={onSkip}
            />
          </View>
        </Animated.View>
      </View>
    );
  }

  // Tooltip placement calculation:
  // Maintain approx 14dp gap between spotlight and tooltip
  const safeTop = insets?.top || 0;
  const safeBottom = insets?.bottom || 0;
  const spaceBelow = SCREEN_HEIGHT - (spotY + spotH) - safeBottom;
  const spaceAbove = spotY - safeTop;

  // Prefer placing below if space allows (~180dp needed for tooltip), otherwise above
  const isTargetInLowerHalf = spaceBelow < 190 && spaceAbove >= spaceBelow;
  const tooltipArrowPos = isTargetInLowerHalf ? "bottom" : "top";

  const tooltipWidth = Math.min(SCREEN_WIDTH * 0.9, 340);
  const tooltipLeft = (SCREEN_WIDTH - tooltipWidth) / 2;
  const targetCenterX = spotX + spotW / 2;
  const arrowOffset = Math.max(
    24,
    Math.min(targetCenterX - tooltipLeft, tooltipWidth - 24)
  );

  const tooltipStyle = isTargetInLowerHalf
    ? {
        position: "absolute",
        bottom: Math.min(
          SCREEN_HEIGHT - spotY + 14,
          SCREEN_HEIGHT - safeTop - 200
        ),
      }
    : {
        position: "absolute",
        top: Math.max(
          safeTop + 10,
          Math.min(spotY + spotH + 14, SCREEN_HEIGHT - safeBottom - 180)
        ),
      };

  // Interaction mode handling:
  // - "passthrough": Cutout is pointerEvents="none" so touches reach the real control underneath.
  // - "blocked": Cutout is pointerEvents="auto" to protect against accidental execution (SOS, Start Trip).
  // - "observe": Cutout is pointerEvents="auto" to keep user focused on Got it / Next.
  const isPassthrough = step.interaction === "passthrough";
  const cutoutPointerEvents = isPassthrough ? "none" : "auto";

  return (
    <View
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, styles.rootOverlay]}
    >
      <Animated.View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, { opacity: overlayFade }]}
      >
        {/* ── Scrim 4 Rectangles: Surrounding the cutout ── */}
        {/* Top Blocker */}
        <View
          pointerEvents="auto"
          style={[
            styles.scrimRect,
            {
              top: 0,
              left: 0,
              right: 0,
              height: spotY,
              backgroundColor: scrimBg,
            },
          ]}
        />
        {/* Bottom Blocker */}
        <View
          pointerEvents="auto"
          style={[
            styles.scrimRect,
            {
              top: spotY + spotH,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: scrimBg,
            },
          ]}
        />
        {/* Left Blocker */}
        <View
          pointerEvents="auto"
          style={[
            styles.scrimRect,
            {
              top: spotY,
              left: 0,
              width: spotX,
              height: spotH,
              backgroundColor: scrimBg,
            },
          ]}
        />
        {/* Right Blocker */}
        <View
          pointerEvents="auto"
          style={[
            styles.scrimRect,
            {
              top: spotY,
              left: spotX + spotW,
              right: 0,
              height: spotH,
              backgroundColor: scrimBg,
            },
          ]}
        />

        {/* ── Spotlight Cutout: Structurally leaves target hole uncovered for passthrough ── */}
        <View
          pointerEvents={cutoutPointerEvents}
          style={[
            styles.spotlightCutout,
            {
              left: spotX,
              top: spotY,
              width: spotW,
              height: spotH,
              borderRadius: radius,
            },
          ]}
        >
          {/* Theme forest-green primary contour border & subtle glow */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: radius,
                borderWidth: 2,
                borderColor: colors.primary,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.5,
                shadowRadius: 6,
                opacity: pulseAnim,
              },
            ]}
          />
        </View>

        {/* ── Operational Tooltip Card ── */}
        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { opacity: tooltipOpacity }]}
        >
          <CoachMarkTooltip
            title={step.title}
            body={bodyText}
            stepIndex={stepIndex}
            totalSteps={totalSteps}
            actionText={
              step.actionText ||
              (stepIndex === totalSteps - 1 ? "Got it" : "Next →")
            }
            canSkip={step.canSkip}
            arrowPosition={tooltipArrowPos}
            arrowOffset={arrowOffset}
            style={tooltipStyle}
            onNext={onNext}
            onPrev={onPrev}
            onSkip={onSkip}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootOverlay: {
    zIndex: 99999,
  },
  scrimRect: {
    position: "absolute",
  },
  spotlightCutout: {
    position: "absolute",
    backgroundColor: "transparent",
  },
  centerCardWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});

export default CoachMarkOverlay;
