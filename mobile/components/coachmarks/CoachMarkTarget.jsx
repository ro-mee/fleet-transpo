import React, { useRef, useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  View,
  Animated,
  Dimensions,
  useWindowDimensions,
  Keyboard,
  InteractionManager,
  Easing,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import { useIsFocused } from "@react-navigation/native";
import { useTheme } from "../../lib/theme-context";
import { useCoachMarks } from "./CoachMarkProvider";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

// Dev-only: distinguishes mounts of one target id in the duplicate-registration
// warning. The token is a Symbol, which logs as "Symbol(coach-mark-target)" and
// identifies nothing.
let instanceCounter = 0;

/**
 * CoachMarkTarget
 *
 * Wraps a production component to register its exact coordinates with the
 * CoachMarkProvider without modifying the underlying component or behavior.
 *
 * Adheres strictly to:
 * - ONE COACH MARK = ONE EXACT COMPONENT TARGET.
 * - Wraps the smallest meaningful control, never a parent card or ScrollView.
 * - Supports ScrollViews by scrolling targets into safe visible viewport before measuring.
 * - Re-measures dynamically when this target becomes the active step, capturing
 *   post-transition settles and async data updates (e.g. vehicle plate loading).
 * - Automatically unregisters on unmount to prevent cross-screen stale targets.
 *
 * @param {object} props
 * @param {string} [props.id] - Target identifier (e.g. "incident.category")
 * @param {string} [props.targetId] - Alias for props.id
 * @param {number} [props.radius=12] - Spotlight corner radius
 * @param {number} [props.padding=8] - Breathing room around the target in dp (6-8dp)
 * @param {React.RefObject} [props.scrollRef] - Optional ref to parent ScrollView for auto-scrolling
 * @param {React.ReactNode} props.children
 * @param {object} [props.style]
 */
export function CoachMarkTarget({
  id,
  targetId,
  radius = 12,
  padding = 8,
  scrollRef,
  children,
  style,
}) {
  const effectiveId = id || targetId;
  const containerRef = useRef(null);
  // Identity of THIS mount. A target id can be registered by more than one live
  // instance (`inspection.remarks` mounts once per failed item), and the
  // provider needs to tell them apart so an unmount removes only its own
  // registration. Stable for the life of the component.
  //
  // useState rather than useRef: the token is read during render (it sits in two
  // dep arrays), and reading a ref's `.current` during render is not allowed.
  // A lazy initializer gives the same stable per-instance value, with the
  // stability guaranteed by React rather than assumed.
  const [token] = useState(() => Symbol("coach-mark-target"));
  const [instanceId] = useState(() => (__DEV__ ? (instanceCounter += 1) : null));
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  // ── Who is allowed to register ────────────────────────────────────────────
  // Two facts invalidate an instance's measurements, and both are re-checked at
  // every registration rather than only where the work was scheduled.
  //
  //   Focus — an instance on a screen the driver cannot see must not register.
  //   That covers a covered stack screen, a background tab, and a route
  //   expo-router mounted ahead of time for `router.prefetch` (a PRELOAD is
  //   rendered by the native stack as an inactive Screen). Left ungated, such
  //   an instance publishes bounds for a screen nobody is looking at, and the
  //   provider keeps the newest registration — so the spotlight follows
  //   whichever instance measured last.
  //
  //   Mount — measureInWindow is a native round trip, and the scroll-settle
  //   timer fires 320ms later, so either can land after unmount. A registration
  //   that outlives its mount is never cleaned up: the provider keeps the entry
  //   forever and it stays eligible to win the spotlight.
  //
  // Mirrored into refs because those callbacks run after the render that
  // scheduled them, and layout effects land at commit — before a pending
  // continuation can read a stale value.
  const isFocused = useIsFocused();
  const mountedRef = useRef(true);
  const isFocusedRef = useRef(isFocused);
  const settleTimerRef = useRef(null);

  useLayoutEffect(() => {
    isFocusedRef.current = isFocused;
  }, [isFocused]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** The live values, for callbacks that outlived the render that made them. */
  const canRegister = useCallback(
    () => mountedRef.current && isFocusedRef.current,
    []
  );
  let pathname = "/";
  try {
    const raw = usePathname();
    if (raw) pathname = raw;
  } catch {
    pathname = "/";
  }

  const { registerTarget, unregisterTarget, activeMilestone, currentStep } = useCoachMarks();
  const isCurrentActiveTarget = Boolean(currentStep?.targetId && currentStep.targetId === effectiveId);

  // ── Bounded self-retry for a measurement that came back unusable ──────────
  //
  // The fixed settling ladder below assumes the target's geometry resolves
  // within ~480ms. A cold first render does not honour that: on a fresh install
  // the first Map visit is still constructing the WebView and fetching the trip
  // while this target mounts, so `measureInWindow` returns `y <= 0` or zero
  // dimensions, the provider rejects those bounds, and the ladder has already
  // spent itself — nothing measures again, so the spotlight never presents even
  // though the milestone is claimed and the step is correct.
  //
  // Retried only from the invalid branches, so a target that measures correctly
  // is never re-measured and never re-scrolled: the ScrollView auto-scroll path
  // is gated on `isPartiallyHidden`, and repeatedly re-entering it would re-fire
  // `scrollTo` and stack its 320ms settle timers.
  //
  // Held in a ref rather than called directly because `measureAndRegister` needs
  // this in its dep list, and a mutual reference between the two would not close.
  const retryRef = useRef({ deadline: 0, timer: null });
  const measureRef = useRef(null);

  const retryInvalidMeasurement = useCallback(() => {
    if (!isCurrentActiveTarget) return;
    const now = Date.now();
    if (retryRef.current.deadline === 0) retryRef.current.deadline = now + 4000;
    if (now >= retryRef.current.deadline) return;
    if (retryRef.current.timer != null) return;
    retryRef.current.timer = setTimeout(() => {
      retryRef.current.timer = null;
      if (!canRegister()) return;
      measureRef.current?.();
    }, 150);
  }, [isCurrentActiveTarget, canRegister]);

  const measureAndRegister = useCallback(() => {
    if (!containerRef.current || !effectiveId) return;

    // Nothing an unfocused instance measures is publishable, and once focus is
    // lost the registration is dropped outright (see the focus effect below),
    // so measuring here would only re-add what was just removed.
    if (!isFocused) return;

    containerRef.current.measureInWindow((x, y, width, height) => {
      if (!canRegister()) return;
      // Validate positive dimensions
      if (width <= 0 || height <= 0) {
        retryInvalidMeasurement();
        return;
      }

      const minSafeY = (insets?.top || 0) + 40;
      const SCREEN_HEIGHT = windowHeight || Dimensions.get("window").height;
      const maxSafeY = SCREEN_HEIGHT - (insets?.bottom || 0) - 80;

      // Guard: On Android during initial layout/mount, measureInWindow can return
      // y <= 0 even though insets.top is positive. Re-measure on next frame if unsettled.
      if (y <= 0 && (insets?.top || 0) > 0) {
        requestAnimationFrame(() => {
          if (!canRegister()) return;
          if (containerRef.current) {
            containerRef.current.measureInWindow((rx, ry, rw, rh) => {
              if (!canRegister()) return;
              // Still unsettled. Publishing `ry <= 0` would only be thrown out by
              // the provider's safe-viewport gate (`y + height <= insets.top + 40`),
              // so retry rather than register bounds that cannot present. This was
              // the silent dead end: the settling ladder had already spent itself,
              // so an unsettled first frame meant nothing ever measured again.
              if (ry <= 0 || rw <= 0 || rh <= 0) {
                retryInvalidMeasurement();
                return;
              }
              registerTarget(
                effectiveId,
                { x: rx, y: ry, width: rw, height: rh, radius, padding },
                pathname,
                token,
                instanceId
              );
            });
          }
        });
        return;
      }

      // Safe viewport handling: ONLY the active target should auto-scroll its parent ScrollView.
      // Inactive targets must never scroll while other steps are active.
      const isPartiallyHidden = y < minSafeY || (y + height) > maxSafeY;
      if (isCurrentActiveTarget && isPartiallyHidden && scrollRef?.current) {
        if (typeof scrollRef.current.scrollTo === "function") {
          // Attempt layout-relative scroll if available to compute precise offset
          if (typeof containerRef.current?.measureLayout === "function") {
            try {
              containerRef.current.measureLayout(
                scrollRef.current,
                (left, top) => {
                  scrollRef.current.scrollTo({
                    y: Math.max(0, top - 20),
                    animated: true,
                  });
                },
                () => {
                  const delta = y < minSafeY ? y - minSafeY : (y + height) - maxSafeY;
                  scrollRef.current.scrollTo({
                    y: Math.max(0, delta),
                    animated: true,
                  });
                }
              );
            } catch {
              const delta = y < minSafeY ? y - minSafeY : (y + height) - maxSafeY;
              scrollRef.current.scrollTo({
                y: Math.max(0, delta),
                animated: true,
              });
            }
          } else {
            const delta = y < minSafeY ? y - minSafeY : (y + height) - maxSafeY;
            scrollRef.current.scrollTo({
              y: Math.max(0, delta),
              animated: true,
            });
          }
        }
        // Wait for scroll animation to settle before registering final coordinates
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = null;
          if (!canRegister()) return;
          if (containerRef.current) {
            containerRef.current.measureInWindow((nx, ny, nw, nh) => {
              if (!canRegister()) return;
              if (nw > 0 && nh > 0) {
                registerTarget(
                  effectiveId,
                  {
                    x: nx,
                    y: ny,
                    width: nw,
                    height: nh,
                    radius,
                    padding,
                  },
                  pathname,
                  token,
                  instanceId
                );
              }
            });
          }
        }, 320);
        return;
      }

      registerTarget(
        effectiveId,
        {
          x,
          y,
          width,
          height,
          radius,
          padding,
        },
        pathname,
        token,
        instanceId
      );
    });
  }, [
    effectiveId,
    insets,
    radius,
    padding,
    registerTarget,
    scrollRef,
    pathname,
    isCurrentActiveTarget,
    token,
    instanceId,
    canRegister,
    isFocused,
    windowHeight,
    retryInvalidMeasurement,
  ]);

  // The retry timer calls through this, so it always measures with the current
  // closure rather than the one that scheduled it.
  useEffect(() => {
    measureRef.current = measureAndRegister;
  }, [measureAndRegister]);

  // A step change gets a fresh retry budget, and a pending timer is cleared so
  // it cannot measure on behalf of a step that is no longer current. The retry
  // container is captured rather than re-read in the cleanup: it is created once
  // and never reassigned, and reading `.current` at cleanup time is what
  // `react-hooks/exhaustive-deps` warns about.
  useEffect(() => {
    const retry = retryRef.current;
    retry.deadline = 0;
    return () => {
      if (retry.timer != null) {
        clearTimeout(retry.timer);
        retry.timer = null;
      }
    };
  }, [isCurrentActiveTarget, currentStep?.id]);

  // Re-measure when activeMilestone activates or changes
  useEffect(() => {
    measureAndRegister();
  }, [activeMilestone, measureAndRegister]);

  // Whenever this target becomes active, perform authoritative measurements
  // across animation and settling ticks to capture transitions and async data loads
  useEffect(() => {
    if (!isCurrentActiveTarget) return;

    // Immediate tick
    measureAndRegister();

    // After native interactions/transitions finish
    const task = InteractionManager.runAfterInteractions(() => {
      measureAndRegister();
    });

    // Staggered settling ticks for async data (e.g. vehiclePlate arriving)
    const t1 = setTimeout(measureAndRegister, 80);
    const t2 = setTimeout(measureAndRegister, 240);
    const t3 = setTimeout(measureAndRegister, 480);

    return () => {
      task?.cancel?.();
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isCurrentActiveTarget, measureAndRegister]);

  // Re-measure on keyboard and window dimension events
  useEffect(() => {
    const kShow = Keyboard.addListener("keyboardDidShow", measureAndRegister);
    const kHide = Keyboard.addListener("keyboardDidHide", measureAndRegister);
    const dChange = Dimensions.addEventListener("change", measureAndRegister);

    return () => {
      kShow.remove();
      kHide.remove();
      dChange.remove();
    };
  }, [measureAndRegister]);

  // Losing focus gives up the registration, because focus is what makes a
  // registration mean anything: a blurred instance's bounds describe a screen
  // the driver has left. Regaining focus re-registers — `isFocused` is in
  // `measureAndRegister`'s deps, so its identity change re-runs every
  // measurement effect below.
  useEffect(() => {
    if (isFocused) return undefined;
    if (effectiveId) {
      unregisterTarget(effectiveId, token);
    }
    return undefined;
  }, [isFocused, effectiveId, unregisterTarget, token]);

  // Cleanup on unmount: immediately unregisters target so it cannot persist
  // across screens. Scoped to this mount's token, so one of two instances
  // sharing an id cannot delete the other's live registration.
  useEffect(() => {
    return () => {
      // The scroll-settle timer is the one scheduled callback that outlives a
      // slow unmount by a fixed 320ms. Left running it would register after the
      // unregister below, and nothing would ever remove that entry.
      if (settleTimerRef.current != null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      if (effectiveId) {
        unregisterTarget(effectiveId, token);
      }
    };
  }, [effectiveId, unregisterTarget, token]);

  let colors = { primary: "#15483A" };
  let isDark = false;
  try {
    const theme = useTheme();
    if (theme?.colors) colors = theme.colors;
    if (theme?.scheme === "dark") isDark = true;
  } catch {
    // safe fallback if rendered outside theme provider
  }

  const [pulseAnim] = useState(() => new Animated.Value(0.25));

  useEffect(() => {
    if (!isCurrentActiveTarget) {
      pulseAnim.setValue(0.25);
      return;
    }
    Animated.sequence([
      Animated.timing(pulseAnim, {
        toValue: 0.9,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(pulseAnim, {
        toValue: 0.45,
        duration: 400,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [isCurrentActiveTarget, pulseAnim]);

  const onLayout = useCallback(() => {
    if (isCurrentActiveTarget) {
      requestAnimationFrame(measureAndRegister);
    } else {
      measureAndRegister();
    }
  }, [isCurrentActiveTarget, measureAndRegister]);

  return (
    <Animated.View
      ref={containerRef}
      onLayout={onLayout}
      collapsable={false}
      style={style}
    >
      {children}
      {isCurrentActiveTarget && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: -padding,
            left: -padding,
            right: -padding,
            bottom: -padding,
            borderRadius: radius + padding,
            borderWidth: 2,
            borderColor: colors.primary,
            shadowColor: colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.45,
            shadowRadius: 6,
            opacity: pulseAnim,
            zIndex: 999,
          }}
        >
          <View
            style={{
              position: "absolute",
              top: -3,
              left: -3,
              right: -3,
              bottom: -3,
              borderRadius: radius + padding + 3,
              borderWidth: 1.5,
              borderColor: isDark
                ? "rgba(74, 222, 128, 0.28)"
                : "rgba(40, 84, 72, 0.20)",
            }}
          />
        </Animated.View>
      )}
    </Animated.View>
  );
}

export default CoachMarkTarget;

