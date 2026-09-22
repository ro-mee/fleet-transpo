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
  TOOLTIP_MAX_WIDTH,
  isMeasuredBox,
  normalizeInsetsToMeasuredSpace,
  resolveArrowOffset,
  resolveSpotlightRect,
  resolveTooltipCardLeft,
  resolveTooltipCardWidth,
  toContainerSpace,
} from "../../lib/spotlight-geometry";
import { moderateScale } from "../../lib/scaling";
import { triggerDriverSos } from "../DriverSos";

// Used only until `CoachMarkTooltip` reports its real height. Placement budgets
// the card at a constant while the card is content-driven, so this is a starting
// guess, not a rule — see the placement block.
const DEFAULT_CARD_HEIGHT = 200;

// How long a step whose target has not been measured waits before the overlay
// gives up on the hole and presents its card centred instead.
//
// The wait exists so the card's first painted frame is already aligned rather
// than centred-then-hopping. The deadline exists because waiting forever is a
// dead end: the scrim alone has nothing to tap, so a target that can never be
// measured would leave the driver behind an undismissable dim. A fresh mount is
// the only case that waits at all (a step change has the previous step's rect to
// hold), and the target's own settling ladder measures within ~480ms, so this is
// well past a good measurement and well short of a driver noticing.
const GEOMETRY_HOLD_MS = 600;

// The floating bubble's arrow is placed within its own box. The bubble's height
// is not measured yet, so this bounds the arrow the way its height would once it
// is. It replaces the pair of bare 110/120 caps that used to sit here.
const BUBBLE_ARROW_EXTENT = 130;
const BUBBLE_ARROW_HALF_WIDTH = 8;
const BUBBLE_ARROW_MIN_INSET = 10;

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
  // True when `targetLayout` is the previous step's rect held across a step
  // change rather than a measurement of THIS step's target. Diagnostic only:
  // it distinguishes "the ring is mid-handoff" from "the measurement is wrong"
  // in the geometry log below, which are otherwise two identical-looking frames.
  heldLayout = false,
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
  // The card's real height, reported by `CoachMarkTooltip`. Placement used to
  // budget it at hard-coded 180/190/200dp while the card is content-driven and
  // no `Text` opts out of font scaling, so at a large system font scale the card
  // outgrew its budget and the clamp pushed it down over the hole it describes.
  //
  // Declared here, above the no-target early return below, because a hook must
  // run on every render — including the Welcome card's, which has no hole.
  const [cardHeight, setCardHeight] = useState(DEFAULT_CARD_HEIGHT);
  const [handoffStepId, setHandoffStepId] = useState(null);
  const inSimulationHandoff = Boolean(
    step?.presentation === "simulation" &&
    handoffStepId === step?.id
  );

  // This overlay's own container box, measured with `measureInWindow` — the same
  // API, and therefore the same space, as every target box the provider hands
  // in. Its ORIGIN is what converts a measured box into the LOCAL space this
  // overlay's `position: absolute` children are laid out in. See
  // `toContainerSpace` and the note at `activeLayout`.
  //
  // History worth not repeating: an earlier round SUBTRACTED this origin, then
  // removed the subtraction because the geometry log reported the origin as
  // `{x: 0, y: 0}` on the frames being read as "settled". Those were frames
  // where the container had not been measured at all — zeros are this state's
  // initial value, not a settled one. Measured, the origin is `{x: 0, y:
  // -39.11}`: the container's top edge sits a full status bar ABOVE the measured
  // origin. So the subtraction was correct and the log was misread, and deleting
  // it is what left every cutout a status bar too high.
  //
  // It is still NOT a validity gate: once measured the origin is never zero, so
  // gating on `origin.y === 0` discards precisely the layouts that are usable.
  // See the note at `activeLayout`.
  const containerRef = useRef(null);
  const [containerBox, setContainerBox] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const adoptContainerBox = (x, y, width, height) => {
    // Rounded to whole dp to kill sub-pixel jitter between re-measures. The
    // origin is applied at read time by `toContainerSpace`, so nothing here
    // needs to know what it is used for.
    const next = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
    setContainerBox((prev) =>
      prev.x === next.x &&
      prev.y === next.y &&
      prev.width === next.width &&
      prev.height === next.height
        ? prev
        : next
    );
  };

  useEffect(() => {
    const node = containerRef.current;
    if (!node?.measureInWindow) return undefined;
    let cancelled = false;
    const measure = () => {
      node.measureInWindow((x, y, width, height) => {
        if (cancelled) return;
        adoptContainerBox(x, y, width, height);
      });
    };
    measure();
    // Re-sync after the route transition settles: an overlay that mounts
    // mid-slide measures a transient origin and would otherwise keep it until
    // rotation.
    const settleTimer = setTimeout(measure, 350);
    const sub = Dimensions.addEventListener?.("change", measure);
    return () => {
      cancelled = true;
      clearTimeout(settleTimer);
      sub?.remove?.();
    };
    // Mount once, not per step. This origin is a property of the window and the
    // safe-area insets, not of the step being shown, and the overlay now stays
    // mounted across a milestone's steps — so re-running this per step only
    // re-adopted a mid-transition origin and stacked another 350ms timer, which
    // is a source of jitter in the hole it is supposed to stabilize. The
    // overlay still remounts on a route change, which is when this must run.
  }, []);

  // Spotlight geometry: symmetric breathing room, whole-dp edges, and a shape
  // taken from the target's own declaration. See `resolveSpotlightRect`.
  //
  // THE ORIGIN CORRECTION — reinstated 2026-09-22, and the missing piece through
  // five rounds. A box from `measureInWindow` is in the measured space; the hole
  // is drawn as a `position: absolute` child of THIS container, and is therefore
  // laid out in the container's LOCAL space. The two differ by the container's
  // own measured origin — `{x: 0, y: -39.11}` on this device — so a target box
  // used as-is puts the hole 39.11dp above the control it is meant to frame.
  //
  // Why it was removed, worth keeping: the container measures 853dp tall against
  // a window of 853.33, and that was read as "the two ARE one space". They are
  // not. Their heights agree to a third of a dp while their origins differ by a
  // full status bar — equal HEIGHT says nothing about the origin, and treating it
  // as proof is what let "lagpas / masyadong mataas" survive every earlier fix.
  // The matching heights are a coincidence of this device's two insets.
  //
  // The origin is NOT a settle signal and must not become a gate again. Once
  // measured it is never zero, so gating on `origin.y === 0` discards precisely
  // the layouts that are usable: it reported `rejectedMidTransition: true` on
  // every real frame while appearing to work only because it happened to be
  // holding a current box.
  const activeLayout = toContainerSpace({
    box: targetLayout,
    container: containerBox,
  });

  // The container is also the viewport these children are laid out in, so every
  // placement bound below is expressed against ITS box rather than the window's.
  // Leaving the window here is how the same 39.11dp offset creeps back into the
  // tooltip clamps after being taken out of the hole.
  const containerMeasured = isMeasuredBox(containerBox);
  const VIEW_W = containerMeasured ? containerBox.width : SCREEN_WIDTH;
  const VIEW_H = containerMeasured ? containerBox.height : SCREEN_HEIGHT;

  const pad = activeLayout?.padding ?? DEFAULT_PADDING;

  // The hole takes the target's declared shape rather than always being a
  // rectangle: a control that declares `radius = shortSide / 2` is saying it is
  // round, and the radius scales with the padding so the hole does not flatten
  // it into a rounded square. `resolveSpotlightRect` also keeps the target
  // concentric with the hole at a screen edge, and snaps both edges to whole dp
  // — the scrim is four abutting translucent rectangles, and a fractional
  // shared edge is what leaves a hairline where they meet.
  const {
    x: spotX,
    y: spotY,
    width: spotW,
    height: spotH,
    radius: holeRadius,
  } = resolveSpotlightRect({
    x: activeLayout?.x ?? 0,
    y: activeLayout?.y ?? 0,
    width: activeLayout?.width ?? 0,
    height: activeLayout?.height ?? 0,
    radius: activeLayout?.radius,
    padding: pad,
    screenWidth: VIEW_W,
    screenHeight: VIEW_H,
  });

  // `useSafeAreaInsets()` reads from a different API than `measureInWindow`, and
  // the two are reconciled by the container's offset from the window. The hole is
  // now in the container's LOCAL space (see `activeLayout`), so these clamps and
  // the hole they bound finally live in one space.
  //
  // An unmeasured container has height 0, which computes the offset as the whole
  // window and zeroes EVERY inset — on precisely the frames the hole is first
  // built from, since the first render precedes the first measurement. Unmeasured
  // means "no conversion available", so the raw window insets are used rather
  // than a conversion that is arithmetic nonsense.
  //
  // The `offset` derived here from the HEIGHT difference is not the container's
  // ORIGIN difference — 0.33dp against 39.11dp on this device — and whether these
  // insets need converting at all is unresolved. Deliberately left alone: it is
  // near-harmless as it stands, whereas guessing its direction wrong would pin
  // every tooltip to a screen edge. See `normalizeInsetsToMeasuredSpace`.
  const safeInsets = normalizeInsetsToMeasuredSpace({
    insets,
    windowHeight: SCREEN_HEIGHT,
    containerHeight:
      containerBox.height > 0 ? containerBox.height : SCREEN_HEIGHT,
  });

  // Enough to reach every screen edge from any hole position, so the border
  // always paints the full surrounding scrim.
  // (Removed 2026-09-21: see the scrim comment below — painting the dim with
  // a giant border on a hole-sized view fills the target itself dark on
  // device. Kept out; do not reintroduce without a device run proving the
  // surroundings dim and the hole stays clear.)

  // Device-side confirmation that the hole tracks the target. Prints the RAW
  // measured box beside the container-local one it became, the container origin
  // separating them, the resolved hole, and the insets actually applied — so a
  // run that still looks off names WHICH number moved instead of needing another
  // guess. If `spotlight.y` sits a status bar above `measuredWindow.y`,
  // `containerOrigin.y` is the number to read.
  // Deduped: a settling target re-measures several times per step.
  const geometryLogRef = useRef(null);
  useEffect(() => {
    if (!__DEV__ || !activeLayout) return;
    const signature = [
      step?.targetId ?? "none",
      `${targetLayout?.x},${targetLayout?.y},${targetLayout?.width},${targetLayout?.height}`,
      `${containerBox.x},${containerBox.y}`,
      heldLayout ? "held" : "measured",
    ].join("|");
    if (geometryLogRef.current === signature) return;
    geometryLogRef.current = signature;
    console.warn("[coachmarks] spotlight geometry", {
      targetId: step?.targetId ?? null,
      // `held` frames are the step-to-step handoff (the ring is still on the
      // previous target and is about to tween), not a mis-measurement of this
      // one. A `measured` frame whose box is wrong is the real defect.
      held: heldLayout,
      container: containerBox,
      containerOrigin: { x: containerBox.x, y: containerBox.y },
      measuredWindow: {
        x: targetLayout?.x ?? null,
        y: targetLayout?.y ?? null,
        w: targetLayout?.width ?? null,
        h: targetLayout?.height ?? null,
      },
      measuredLocal: {
        x: activeLayout.x,
        y: activeLayout.y,
        w: activeLayout.width,
        h: activeLayout.height,
      },
      spotlight: { x: spotX, y: spotY, w: spotW, h: spotH },
      viewport: { w: VIEW_W, h: VIEW_H },
      shape: {
        declaredRadius: activeLayout.radius ?? null,
        holeRadius,
        // Circular means a single round edge, not merely "fully rounded": a
        // 48x180 pill also reaches half its SHORT side, so the old
        // `holeRadius >= min(spotW, spotH) / 2` test reported the map's control
        // column as a circle. The shape itself cannot be asserted by the suite,
        // so this line is how a device run confirms it.
        circular: spotW === spotH && holeRadius >= spotW / 2,
      },
      // Window-space insets beside the measured-space ones actually applied.
      // When these differ, this container does not span the whole window.
      insets: {
        window: { top: insets?.top ?? null, bottom: insets?.bottom ?? null },
        applied: { top: safeInsets.top, bottom: safeInsets.bottom },
        offset: safeInsets.offset,
      },
    });
  }, [
    activeLayout,
    targetLayout,
    heldLayout,
    containerBox,
    step,
    spotX,
    spotY,
    spotW,
    spotH,
    holeRadius,
    VIEW_W,
    VIEW_H,
    insets,
    safeInsets.top,
    safeInsets.bottom,
    safeInsets.offset,
  ]);

  // Animated values for smooth bounds transitions and restrained arrival pulse
  const [animX] = useState(() => new Animated.Value(spotX));
  const [animY] = useState(() => new Animated.Value(spotY));
  const [animW] = useState(() => new Animated.Value(spotW));
  const [animH] = useState(() => new Animated.Value(spotH));
  const [pulseAnim] = useState(() => new Animated.Value(0.65));
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
  //
  // A milestone's FIRST presentation snaps; every later step tween. The anim
  // values are created on this component's first render, which for a fresh
  // milestone happens before the container has been measured — so their initial
  // value came from a box the origin correction could not be applied to, and
  // tweening from it drew the ring a status bar off for one frame before sliding
  // it home. Snapping on the first frame that has real geometry is what makes the
  // hole's first painted position already correct.
  // Which milestone was last presented, and at what box. Refs rather than state:
  // both are read and written only inside the effect below, and holding them in
  // state would mean a setState inside an effect body, which cascades a render
  // (`react-hooks/set-state-in-effect`) for a value nothing renders from.
  const presentedMilestoneRef = useRef(null);
  const presentedSpotRef = useRef(null);

  useEffect(() => {
    if (!targetLayout) return;

    const spotSignature = `${spotX}|${spotY}|${spotW}|${spotH}`;
    const milestoneKey = milestone?.key ?? null;

    if (presentedMilestoneRef.current !== milestoneKey) {
      presentedMilestoneRef.current = milestoneKey;
      animX.setValue(spotX);
      animY.setValue(spotY);
      animW.setValue(spotW);
      animH.setValue(spotH);
      tooltipOpacity.setValue(1);
      presentedSpotRef.current = spotSignature;
      return;
    }
    // Nothing moved: a re-measure that landed on the same box, or the handoff
    // rect being replaced by an identical measurement of the same control. The
    // fade-out/tween/fade-in below would still run and read as a flicker.
    if (presentedSpotRef.current === spotSignature) return;
    presentedSpotRef.current = spotSignature;

    if (reduceMotion) {
      animX.setValue(spotX);
      animY.setValue(spotY);
      animW.setValue(spotW);
      animH.setValue(spotH);
      tooltipOpacity.setValue(1);
      pulseAnim.setValue(0.65);
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
            toValue: 0.95,
            duration: 320,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.65,
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
    milestone?.key,
  ]);

  // ── Waiting for geometry, and when to stop waiting ────────────────────────
  //
  // While a step's target has not been measured there is no honest place to draw
  // the hole (see the gate below), so the overlay presents the scrim alone and
  // the card's first painted frame is already aligned. That is a wait, not a
  // state the driver should be able to reach — hence the deadline, recorded
  // against the step it belongs to.
  //
  // Keyed by step id rather than a boolean so no reset is needed: a new step's id
  // never matches a previous timeout, so the fallback cannot leak into a step
  // that has not itself waited out the deadline. Written only from the timer
  // callback, never synchronously in the effect body.
  const hasHoleGeometry = Boolean(targetLayout) && isMeasuredBox(containerBox);
  const stepNeedsHole = Boolean(step?.targetId);
  const [geometryTimeoutFor, setGeometryTimeoutFor] = useState(null);

  useEffect(() => {
    if (!stepNeedsHole || hasHoleGeometry) return undefined;
    const timer = setTimeout(
      () => setGeometryTimeoutFor(step?.id ?? null),
      GEOMETRY_HOLD_MS
    );
    return () => clearTimeout(timer);
  }, [stepNeedsHole, hasHoleGeometry, step?.id]);

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

  // The cutout is positioned relative to this container, so BOTH measurements
  // must exist before any hole geometry is meaningful. An unmeasured container
  // has no origin to subtract, and drawing with the raw box places the hole one
  // status bar (39.11dp) above its target. Waiting for both makes the hole's
  // FIRST appearance already correct, at the cost of it appearing one
  // measurement-frame later.
  //
  // Three outcomes, in order:
  //
  //   1. The step has no target (the Welcome card) — present centred immediately.
  //      That is a success case, not a missing measurement.
  //   2. Geometry is not ready — the SCRIM ONLY, no card. Rendering the centred
  //      card here instead is what made a step change look like a glitch: the
  //      card painted centred, then hopped to the target once the measurement
  //      landed. A card with no hole is also a card that is about to move.
  //   3. Geometry has not arrived by `GEOMETRY_HOLD_MS` — fall back to the
  //      centred card, so a target that cannot be measured leaves the driver a
  //      way out of the guide rather than an undismissable dim.
  //
  // `containerRef` is attached in EVERY branch below, and that is load-bearing:
  // if it were only on the targeted branch, the container could never be measured
  // while this gate held that branch shut, so the gate could never open.
  const centeredPresentation =
    !stepNeedsHole || geometryTimeoutFor === step.id;

  if (centeredPresentation) {
    return (
      <View
        ref={containerRef}
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

  // Waiting for the first measurement of this step's target. The dim is drawn so
  // the presentation does not flash in and out, but nothing in it takes a touch:
  // this is a frame or two of transition, and swallowing taps here would put a
  // blocking layer over the screen with no control in it to dismiss.
  if (!hasHoleGeometry) {
    return (
      <View
        ref={containerRef}
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.rootOverlay]}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: overlayFade }]}
        >
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: scrimBg }]}
          />
        </Animated.View>
      </View>
    );
  }

  // Tooltip placement calculation.
  //
  // `safeTop` / `safeBottom` are the insets that survive into the space the hole
  // lives in. Applying the window's raw insets here used a status bar that is not
  // inside that space — see `normalizeInsetsToMeasuredSpace`.
  //
  // Everything below is bounded by `VIEW_H` / `VIEW_W` — the CONTAINER's box —
  // because `spotY` / `spotX` are container-local now. Bounding them with the
  // window's dimensions instead would reintroduce the same 39.11dp origin offset
  // that was just removed from the hole.
  const safeTop = safeInsets.top;
  const safeBottom = safeInsets.bottom;

  const spaceBelow = VIEW_H - (spotY + spotH) - safeBottom;
  const spaceAbove = spotY - safeTop;
  const isTargetInLowerHalf =
    spaceBelow < cardHeight + 24 && spaceAbove >= spaceBelow;

  const isFloatingBubble =
    step?.presentation === "floating_bubble" ||
    step?.targetId === "incident.sos";

  let tooltipArrowPos = "top";
  let arrowOffset = 40;
  let tooltipStyle = {};

  if (isFloatingBubble) {
    const bubbleWidth = Math.min(235, Math.max(190, VIEW_W * 0.62));
    const targetCenterX = spotX + spotW / 2;
    const targetCenterY = spotY + spotH / 2;
    const isTargetOnRight = targetCenterX >= VIEW_W / 2;

    const spaceToLeft = spotX;
    const spaceToRight = VIEW_W - (spotX + spotW);

    if (isTargetOnRight && spaceToLeft >= bubbleWidth + 8) {
      // Compact bubble docked to the LEFT of the SOS medallion, pointing RIGHT directly at target
      tooltipArrowPos = "right";
      const desiredTop = targetCenterY - 60;
      const bubbleTop = Math.max(
        safeTop + 16,
        Math.min(desiredTop, VIEW_H - safeBottom - 180)
      );
      // The arrow lives in the bubble's own box, so it is bounded by that box
      // rather than by the bare 110/120 caps this used to carry.
      arrowOffset = resolveArrowOffset({
        targetCenter: targetCenterY,
        cardLeft: bubbleTop,
        cardWidth: BUBBLE_ARROW_EXTENT,
        halfWidth: BUBBLE_ARROW_HALF_WIDTH,
        minInset: BUBBLE_ARROW_MIN_INSET,
      });
      tooltipStyle = {
        position: "absolute",
        top: bubbleTop,
        right: VIEW_W - spotX + 10,
        width: bubbleWidth,
        maxWidth: bubbleWidth,
        alignSelf: "flex-end",
      };
    } else if (!isTargetOnRight && spaceToRight >= bubbleWidth + 8) {
      // Compact bubble docked to the RIGHT of the SOS medallion, pointing LEFT directly at target
      tooltipArrowPos = "left";
      const desiredTop = targetCenterY - 60;
      const bubbleTop = Math.max(
        safeTop + 16,
        Math.min(desiredTop, VIEW_H - safeBottom - 180)
      );
      // The arrow lives in the bubble's own box, so it is bounded by that box
      // rather than by the bare 110/120 caps this used to carry.
      arrowOffset = resolveArrowOffset({
        targetCenter: targetCenterY,
        cardLeft: bubbleTop,
        cardWidth: BUBBLE_ARROW_EXTENT,
        halfWidth: BUBBLE_ARROW_HALF_WIDTH,
        minInset: BUBBLE_ARROW_MIN_INSET,
      });
      tooltipStyle = {
        position: "absolute",
        top: bubbleTop,
        left: spotX + spotW + 10,
        width: bubbleWidth,
        maxWidth: bubbleWidth,
        alignSelf: "flex-start",
      };
    } else if (spaceAbove >= 140) {
      // Dock ABOVE target, pointing DOWN
      tooltipArrowPos = "bottom";
      const bubbleRight = Math.max(12, VIEW_W - (spotX + spotW));
      arrowOffset = resolveArrowOffset({
        targetCenter: targetCenterX,
        cardLeft: VIEW_W - bubbleRight - bubbleWidth,
        cardWidth: bubbleWidth,
        halfWidth: BUBBLE_ARROW_HALF_WIDTH,
        minInset: BUBBLE_ARROW_MIN_INSET,
      });
      tooltipStyle = {
        position: "absolute",
        bottom: Math.min(
          VIEW_H - spotY + 10,
          VIEW_H - safeTop - 180
        ),
        right: isTargetOnRight ? bubbleRight : undefined,
        left: !isTargetOnRight ? Math.max(12, spotX) : undefined,
        width: bubbleWidth,
        maxWidth: bubbleWidth,
      };
    } else {
      // Dock BELOW target, pointing UP
      tooltipArrowPos = "top";
      const bubbleRight = Math.max(12, VIEW_W - (spotX + spotW));
      arrowOffset = resolveArrowOffset({
        targetCenter: targetCenterX,
        cardLeft: VIEW_W - bubbleRight - bubbleWidth,
        cardWidth: bubbleWidth,
        halfWidth: BUBBLE_ARROW_HALF_WIDTH,
        minInset: BUBBLE_ARROW_MIN_INSET,
      });
      tooltipStyle = {
        position: "absolute",
        top: Math.max(
          safeTop + 10,
          Math.min(spotY + spotH + 10, VIEW_H - safeBottom - 180)
        ),
        right: isTargetOnRight ? bubbleRight : undefined,
        left: !isTargetOnRight ? Math.max(12, spotX) : undefined,
        width: bubbleWidth,
        maxWidth: bubbleWidth,
      };
    }
  } else {
    // Standard broad operational card (centered horizontally)
    tooltipArrowPos = isTargetInLowerHalf ? "bottom" : "top";

    // ONE shared width answer for the card and its arrow. The card is laid out
    // by `width: "90%"` plus a `maxWidth` that goes through `moderateScale`,
    // while this used to assume a raw 340 — and because the arrow is placed
    // relative to the card's left edge, the two disagreements compounded into
    // the arrow's aim.
    const tooltipWidth = resolveTooltipCardWidth({
      screenWidth: VIEW_W,
      maxCardWidth: moderateScale(TOOLTIP_MAX_WIDTH),
    });
    const tooltipLeft = resolveTooltipCardLeft({
      screenWidth: VIEW_W,
      cardWidth: tooltipWidth,
    });
    const targetCenterX = spotX + spotW / 2;
    // Was `Math.max(24, Math.min(targetCenterX - tooltipLeft, tooltipWidth - 24))`
    // against a hard 280 further down: a target on the right of the screen had
    // its arrow stop at empty card, ~35dp short on the device that was measured.
    arrowOffset = resolveArrowOffset({
      targetCenter: targetCenterX,
      cardLeft: tooltipLeft,
      cardWidth: tooltipWidth,
    });

    // Which side the card fits on, and both clamps, are expressed in the card's
    // real height — so a taller card moves rather than growing over the hole.
    tooltipStyle = isTargetInLowerHalf
      ? {
          position: "absolute",
          bottom: Math.min(
            VIEW_H - spotY + 14,
            VIEW_H - safeTop - cardHeight
          ),
        }
      : {
          position: "absolute",
          top: Math.max(
            safeTop + 10,
            Math.min(
              spotY + spotH + 14,
              VIEW_H - safeBottom - cardHeight
            )
          ),
        };
  }

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
          VIEW_H - safeBottom - 420
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
        >
          {/* Subtle luminous accent ring framing the spotlight target */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: holeRadius,
                borderWidth: 2,
                borderColor: isDark
                  ? "rgba(74, 222, 128, 0.85)"
                  : "rgba(46, 125, 82, 0.90)",
                opacity: pulseAnim,
              },
            ]}
          />
        </Animated.View>

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
              onMeasure={setCardHeight}
              compact={isFloatingBubble}
              badge={isFloatingBubble ? "emergency" : null}
              onNext={() => {
                if (step.id === "tour.sos.prompt") {
                  triggerDriverSos();
                }
                onNext?.();
              }}
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
