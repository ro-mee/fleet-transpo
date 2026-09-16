import React, { useRef, useCallback, useEffect } from "react";
import { View, Dimensions, Keyboard } from "react-native";
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
  const insets = useSafeAreaInsets();
  let pathname = "/";
  try {
    const raw = usePathname();
    if (raw) pathname = raw;
  } catch {
    pathname = "/";
  }

  const { registerTarget, unregisterTarget, activeMilestone } = useCoachMarks();

  const measureAndRegister = useCallback(() => {
    if (!containerRef.current || !effectiveId) return;

    containerRef.current.measureInWindow((x, y, width, height) => {
      // Validate positive dimensions
      if (width <= 0 || height <= 0) return;

      const minSafeY = (insets?.top || 0) + 40;
      const maxSafeY = SCREEN_HEIGHT - (insets?.bottom || 0) - 80;

      // Check if target is out of safe visible viewport
      const isPartiallyHidden = y < minSafeY || (y + height) > maxSafeY;
      if (isPartiallyHidden && scrollRef?.current) {
        if (typeof scrollRef.current.scrollTo === "function") {
          const delta = y < minSafeY ? y - minSafeY : (y + height) - maxSafeY;
          scrollRef.current.scrollTo({
            y: Math.max(0, delta),
            animated: true,
          });
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
                  pathname
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
        pathname
      );
    });
  }, [effectiveId, insets, radius, padding, registerTarget, scrollRef, pathname]);

  // Re-measure when activeMilestone activates or changes
  useEffect(() => {
    measureAndRegister();
  }, [activeMilestone, measureAndRegister]);

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

  // Cleanup on unmount: immediately unregisters target so it cannot persist across screens
  useEffect(() => {
    return () => {
      if (effectiveId) {
        unregisterTarget(effectiveId);
      }
    };
  }, [effectiveId, unregisterTarget]);

  return (
    <View
      ref={containerRef}
      onLayout={measureAndRegister}
      collapsable={false}
      style={style}
    >
      {children}
    </View>
  );
}

export default CoachMarkTarget;
