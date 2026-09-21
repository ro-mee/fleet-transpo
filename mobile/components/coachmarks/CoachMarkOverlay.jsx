import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  useWindowDimensions,
  Animated,
  AccessibilityInfo,
  BackHandler,
  Easing,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../lib/theme-context";
import CoachMarkTooltip from "./CoachMarkTooltip";
import CoachMarkSimulationPanel from "./simulation/CoachMarkSimulationPanel";
import {
  DEFAULT_PADDING,
  resolveSpotlightShape,
} from "../../lib/spotlight-geometry";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

/**
 * CoachMarkOverlay
 *
 * Fullscreen dimmed scrim with a transparent cutout around the measured production
 * target, subtle theme-derived contour, and an attached operational tooltip.
 *
 * Adheres strictly to:
 * - REAL PASSTHROUGH: a shaped blocking scrim leaves the spotlight hole
 *   uncovered for interactive steps (pointerEvents="none"). The hole follows the
 *   target's declared shape, so a round control is highlighted with a circle.
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
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const SCREEN_WIDTH = windowWidth || Dimensions.get("window").width;
  const SCREEN_HEIGHT = windowHeight || Dimensions.get("window").height;

  const [reduceMotion, setReduceMotion] = useState(false);
  const [handoffStepId, setHandoffStepId] = useState(null);
  const inSimulationHandoff = Boolean(
    step?.presentation === "simulation" &&
    handoffStepId === step?.id
  );

  // `measureInWindow` reports WINDOW coordinates; the spotlight is drawn inside
  // this overlay's own container. Those are the same space only while that
  // container sits exactly at the window origin, and it need not: the
  // provider's container also holds a layout-participating sibling above the
  // navigator, and any parent padding, inset or transform moves it. When it
  // does, EVERY cutout is out by the same delta — which is exactly a highlight
  // that is inaccurate on all of them, at every step.
  //
  // Measuring the container and subtracting its origin makes the two spaces
  // agree by construction. At the window origin this subtracts zero, so it
  // cannot regress a case that already lines up.
  const containerRef = useRef(null);
  const [containerOrigin, setContainerOrigin] = useState({ x: 0, y: 0 });

  const adoptOrigin = (x, y) => {
    // Rounded to whole dp to kill sub-pixel jitter between re-measures.
    // Clamping happens at read time below (originX/originY), not here, so no
    // stale or Hot-Reload-preserved state can ever offset a cutout: even a
    // −39.11 carried over from an older bundle renders as 0.
    const nx = Math.round(x);
    const ny = Math.round(y);
    setContainerOrigin((prev) =>
      prev.x === nx && prev.y === ny ? prev : { x: nx, y: ny }
    );
  };

  useEffect(() => {
    const node = containerRef.current;
    if (!node?.measureInWindow) return undefined;
    let cancelled = false;
    const measure = () => {
      node.measureInWindow((x, y) => {
        if (cancelled) return;
        adoptOrigin(x, y);
      });
    };
    measure();
    // Re-sync after the route transition settles: an overlay that mounts
    // mid-slide measures a transient origin and would otherwise keep it until
    // rotation. One delayed recheck per step, cancelled on unmount/step change.
    const settleTimer = setTimeout(measure, 350);
    const sub = Dimensions.addEventListener?.("change", measure);
    return () => {
      cancelled = true;
      clearTimeout(settleTimer);
      sub?.remove?.();
    };
  }, [step?.targetId]);

  // Spotlight geometry with 8dp breathing room.
  // The effective origin is clamped at READ time (not only when adopted):
  // window coordinates of a fullscreen container can never rest negative — a
  // negative value is a mid-transition frame (route slide ≈ status-bar
  // height; device log showed 0 ↔ −39.11 on the same target) or state carried
  // over by Fast Refresh from an older bundle. Clamping here means no stored
  // value, however stale, can ever offset a cutout by ~39dp again.
  const originX = Math.max(0, containerOrigin.x);
  const originY = Math.max(0, containerOrigin.y);
  const pad = targetLayout?.padding ?? DEFAULT_PADDING;
  const rawX = (targetLayout?.x ?? 0) - originX;
  const rawY = (targetLayout?.y ?? 0) - originY;
  const rawW = targetLayout?.width ?? 0;
  const rawH = targetLayout?.height ?? 0;

  const spotX = Math.max(0, rawX - pad);
  const spotY = Math.max(0, rawY - pad);

  // The hole takes the target's declared shape rather than always being a
  // rectangle: a control that declares `radius = shortSide / 2` is saying it is
  // round, and the radius scales with the padding so the hole does not flatten
  // it into a rounded square. See `lib/spotlight-geometry.js` for the rule and
  // why it is `radius + padding` rather than a tuned constant.
  const {
    holeW: spotW,
    holeH: spotH,
    holeRadius,
  } = resolveSpotlightShape({
    width: rawW,
    height: rawH,
    radius: targetLayout?.radius,
    padding: pad,
    maxWidth: SCREEN_WIDTH - spotX,
    maxHeight: SCREEN_HEIGHT - spotY,
  });

  // Enough to reach every screen edge from any hole position, so the border
  // always paints the full surrounding scrim.
  // (Removed 2026-09-21: see the scrim comment below — painting the dim with
  // a giant border on a hole-sized view fills the target itself dark on
  // device. Kept out; do not reintroduce without a device run proving the
  // surroundings dim and the hole stays clear.)

  // Device-side confirmation that the two coordinate spaces agree. Prints the
  // container origin next to the bounds it was subtracted from, so a run that
  // still looks off says which side moved rather than needing another guess.
  // Deduped: a settling target re-measures several times per step.
  const geometryLogRef = useRef(null);
  useEffect(() => {
    if (!__DEV__ || !targetLayout) return;
    const signature = [
      step?.targetId ?? "none",
      `${originX},${originY}`,
      `${targetLayout.x},${targetLayout.y},${targetLayout.width},${targetLayout.height}`,
    ].join("|");
    if (geometryLogRef.current === signature) return;
    geometryLogRef.current = signature;
    console.warn("[coachmarks] spotlight geometry", {
      targetId: step?.targetId ?? null,
      origin: { x: originX, y: originY },
      rawOrigin: containerOrigin,
      measured: {
        x: targetLayout.x,
        y: targetLayout.y,
        w: targetLayout.width,
        h: targetLayout.height,
      },
      spotlight: { x: spotX, y: spotY, w: spotW, h: spotH },
      shape: {
        declaredRadius: targetLayout.radius ?? null,
        holeRadius,
        // A hole is circular only when its radius reaches half its short side.
        // The shape itself cannot be asserted by the suite, so this line is how
        // a device run confirms it.
        circular: holeRadius >= Math.min(spotW, spotH) / 2,
      },
      insets: { top: insets?.top ?? null, bottom: insets?.bottom ?? null },
    });
  }, [
    targetLayout,
    containerOrigin,
    originX,
    originY,
    step,
    spotX,
    spotY,
    spotW,
    spotH,
    holeRadius,
    insets,
  ]);

  // Animated values for smooth bounds transitions and restrained arrival pulse
  const [animX] = useState(() => new Animated.Value(spotX));
  const [animY] = useState(() => new Animated.Value(spotY));
  const [animW] = useState(() => new Animated.Value(spotW));
  const [animH] = useState(() => new Animated.Value(spotH));
  const [pulseAnim] = useState(() => new Animated.Value(0.25));
  const [tooltipOpacity] = useState(() => new Animated.Value(0));
  const [overlayFade] = useState(() => new Animated.Value(0));

  // Edges of the animated box, for the two scrim rectangles that sit on the far
  // side of the cutout. Derived once rather than inline, so a render does not
  // build a fresh animated node every time.
  const animRight = useMemo(() => Animated.add(animX, animW), [animX, animW]);
  const animBottom = useMemo(() => Animated.add(animY, animH), [animY, animH]);

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

        // ONE restrained emphasis pulse on arrival with cubic easing
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.90,
            duration: 320,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.28,
            duration: 400,
            easing: Easing.inOut(Easing.quad),
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
  // Welcome is intentionally non-intrusive. Let navigation tabs remain
  // reachable so a driver can choose Map immediately after resetting tips;
  // every targeted/protected coach mark keeps its normal blocking geometry.
  const isWelcomeCard = milestone?.key === "welcome";

  // If there's no target (e.g. Welcome card), render centered card over full scrim
  if (!targetLayout) {
    return (
      <View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, styles.rootOverlay]}
      >
        <Animated.View
          pointerEvents={isWelcomeCard ? "box-none" : "auto"}
          style={[StyleSheet.absoluteFill, { opacity: overlayFade }]}
        >
          <View
            pointerEvents={isWelcomeCard ? "box-none" : "auto"}
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
              allowBack={step.allowBack !== false}
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
  const isSimulation = step.presentation === "simulation";
  const isPassthrough = step.interaction === "passthrough";
  const cutoutPointerEvents = isSimulation
    ? (inSimulationHandoff ? "none" : "auto")
    : (isPassthrough ? "none" : "auto");

  const simulationStyle = isTargetInLowerHalf
    ? {
        position: "absolute",
        top: safeTop + 12,
      }
    : {
        position: "absolute",
        top: Math.min(
          spotY + spotH + 14,
          SCREEN_HEIGHT - safeBottom - 420
        ),
      };

  return (
    <View
      ref={containerRef}
      pointerEvents="box-none"
      style={[StyleSheet.absoluteFill, styles.rootOverlay]}
    >
      <Animated.View
        pointerEvents="box-none"
        style={[StyleSheet.absoluteFill, { opacity: overlayFade }]}
      >
        {/* ── Scrim: four dimmed rectangles around the hole ── */}
        {/* The dim MUST be painted by rectangles surrounding the hole, never by
            a border on a hole-sized view: React Native draws borders inside the
            view bounds, so a ~1200dp border on a hole-sized box fills the
            target itself dark and leaves the surroundings undimmed — an
            inverted spotlight, device-confirmed 2026-09-21 on the incident
            walkthrough (target darkened, surroundings clear, contour visibly
            separated from the dark box). The four rectangles meet edge to
            edge with no overlap, so the semi-transparent scrim shows no
            seams, and they double as the touch blockers outside the hole
            (the hole itself stays open for passthrough steps via the cutout
            shim below). Accepted trade-off: the hole is square again — round
            controls keep their round local contour, which carries the shape
            cue. A truly round hole needs a native mask (react-native-svg)
            and its own rebuild; that is a separate task, not this fix. */}
        {/* Top Blocker */}
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.scrimRect,
            {
              top: 0,
              left: 0,
              right: 0,
              height: animY,
              backgroundColor: scrimBg,
            },
          ]}
        />
        {/* Bottom Blocker */}
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.scrimRect,
            {
              top: animBottom,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: scrimBg,
            },
          ]}
        />
        {/* Left Blocker */}
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.scrimRect,
            {
              top: animY,
              left: 0,
              width: animX,
              height: animH,
              backgroundColor: scrimBg,
            },
          ]}
        />
        {/* Right Blocker */}
        <Animated.View
          pointerEvents="auto"
          style={[
            styles.scrimRect,
            {
              top: animY,
              left: animRight,
              right: 0,
              height: animH,
              backgroundColor: scrimBg,
            },
          ]}
        />

        {/* ── Spotlight Cutout: hit-test shim over the hole, not paint ── */}
        {/* Its radius mirrors the target's shape so the touch area matches the
            local contour; it draws nothing — the four dimmed rectangles above
            leave the hole uncovered. */}
        <Animated.View
          pointerEvents={cutoutPointerEvents}
          style={[
            styles.spotlightCutout,
            {
              left: animX,
              top: animY,
              width: animW,
              height: animH,
              borderRadius: holeRadius,
            },
          ]}
        />

        {/* ── Operational Tooltip / Safe Micro-Simulation ── */}
        <Animated.View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { opacity: tooltipOpacity }]}
        >
          {isSimulation && !inSimulationHandoff ? (
            <CoachMarkSimulationPanel
              step={step}
              style={simulationStyle}
              onHandoff={() => setHandoffStepId(step?.id || null)}
              onSkip={() => setHandoffStepId(step?.id || null)}
            />
          ) : isSimulation && inSimulationHandoff ? (
            <View
              pointerEvents="none"
              style={[
                styles.handoffCue,
                tooltipStyle,
                {
                  backgroundColor: isDark ? "#17221D" : "#FFFFFF",
                  borderColor: isDark
                    ? "rgba(166, 199, 184, 0.20)"
                    : "rgba(40, 84, 72, 0.12)",
                },
              ]}
            >
              <Text style={[styles.handoffTitle, { color: colors.onSurface }]}>
                Now scan your receipt
              </Text>
              <Text
                style={[
                  styles.handoffBody,
                  { color: colors.onSurfaceVariant },
                ]}
              >
                Tap the highlighted Scan receipt option when you&apos;re ready.
              </Text>
            </View>
          ) : (
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
              allowBack={step.allowBack !== false}
              arrowPosition={tooltipArrowPos}
              arrowOffset={arrowOffset}
              style={tooltipStyle}
              onNext={onNext}
              onPrev={onPrev}
              onSkip={onSkip}
            />
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  rootOverlay: {
    zIndex: 99999,
    // Keep the Map coach mark above the Android TomTom WebView surface.
    elevation: 1000,
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
  handoffCue: {
    width: "90%",
    maxWidth: 340,
    alignSelf: "center",
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 6,
  },
  handoffTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  handoffBody: {
    fontSize: 12.5,
    lineHeight: 18,
  },
});

export default CoachMarkOverlay;
