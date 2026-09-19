import React, { useRef, useCallback, useEffect, useState } from "react";
import { View, Dimensions, Keyboard, InteractionManager } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import { useCoachMarks } from "./CoachMarkProvider";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

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
  const insets = useSafeAreaInsets();
  let pathname = "/";
  try {
    const raw = usePathname();
    if (raw) pathname = raw;
  } catch {
    pathname = "/";
  }

  const { registerTarget, unregisterTarget, activeMilestone, currentStep } = useCoachMarks();
  const isCurrentActiveTarget = Boolean(currentStep?.targetId && currentStep.targetId === effectiveId);

  const measureAndRegister = useCallback(() => {
    if (!containerRef.current || !effectiveId) return;

    containerRef.current.measureInWindow((x, y, width, height) => {
      // Validate positive dimensions
      if (width <= 0 || height <= 0) return;

      const minSafeY = (insets?.top || 0) + 40;
      const maxSafeY = SCREEN_HEIGHT - (insets?.bottom || 0) - 80;

      // Guard: On Android during initial layout/mount, measureInWindow can return
      // y <= 0 even though insets.top is positive. Re-measure on next frame if unsettled.
      if (y <= 0 && (insets?.top || 0) > 0) {
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.measureInWindow((rx, ry, rw, rh) => {
              if (rw > 0 && rh > 0) {
                registerTarget(
                  effectiveId,
                  { x: rx, y: ry, width: rw, height: rh, radius, padding },
                  pathname,
                  token
                );
              }
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
        setTimeout(() => {
          if (containerRef.current) {
            containerRef.current.measureInWindow((nx, ny, nw, nh) => {
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
                  token
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
        token
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
  ]);

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

  // Cleanup on unmount: immediately unregisters target so it cannot persist
  // across screens. Scoped to this mount's token, so one of two instances
  // sharing an id cannot delete the other's live registration.
  useEffect(() => {
    return () => {
      if (effectiveId) {
        unregisterTarget(effectiveId, token);
      }
    };
  }, [effectiveId, unregisterTarget, token]);

  const onLayout = useCallback(() => {
    if (isCurrentActiveTarget) {
      requestAnimationFrame(measureAndRegister);
    } else {
      measureAndRegister();
    }
  }, [isCurrentActiveTarget, measureAndRegister]);

  return (
    <View
      ref={containerRef}
      onLayout={onLayout}
      collapsable={false}
      style={style}
    >
      {children}
    </View>
  );
}

export default CoachMarkTarget;

