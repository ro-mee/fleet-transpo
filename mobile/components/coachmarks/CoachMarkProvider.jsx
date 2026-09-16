import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from "react";
import { View, Keyboard } from "react-native";
import { usePathname } from "expo-router";
import { getMilestoneConfig, isRouteMatch } from "../../lib/coach-marks";
import {
  isCoachMarkCompleted,
  setCoachMarkCompleted,
  resetAllCoachMarks,
} from "../../lib/coach-mark-storage";
import CoachMarkOverlay from "./CoachMarkOverlay";

const CoachMarkContext = createContext({
  activeMilestone: null,
  currentStepIndex: 0,
  currentStep: null,
  stepContext: null,
  activeTargetLayout: null,
  triggerMilestone: () => Promise.resolve(false),
  registerTarget: () => {},
  unregisterTarget: () => {},
  notifyInteraction: () => {},
  nextStep: () => {},
  prevStep: () => {},
  skip: () => {},
  dismiss: () => {},
  dismissCoachMark: () => {},
  resetTips: () => Promise.resolve(false),
  currentRoute: "/",
});

export function CoachMarkProvider({ children, driverId, isDriving = false }) {
  let pathname = "/";
  try {
    const rawPath = usePathname();
    if (rawPath) pathname = rawPath;
  } catch {
    pathname = "/";
  }

  const [activeMilestoneKey, setActiveMilestoneKey] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepContext, setStepContext] = useState(null);
  const [targets, setTargets] = useState({});

  const activeMilestone = useMemo(
    () => getMilestoneConfig(activeMilestoneKey),
    [activeMilestoneKey]
  );
  const currentStep = activeMilestone?.steps?.[currentStepIndex] || null;

  // Target registration with route stamping & dimension validation
  const registerTarget = useCallback((targetId, layout, route) => {
    if (!targetId || !layout) return;
    if (layout.width <= 0 || layout.height <= 0) return;

    const targetRoute = route || layout.route || pathname;

    setTargets((prev) => {
      const existing = prev[targetId];
      if (
        existing &&
        existing.x === layout.x &&
        existing.y === layout.y &&
        existing.width === layout.width &&
        existing.height === layout.height &&
        existing.route === targetRoute
      ) {
        return prev;
      }
      return {
        ...prev,
        [targetId]: {
          ...layout,
          route: targetRoute,
        },
      };
    });
  }, [pathname]);

  const unregisterTarget = useCallback((targetId) => {
    if (!targetId) return;
    setTargets((prev) => {
      if (!prev[targetId]) return prev;
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  }, []);

  // Compute layout for the active step:
  // Must have positive dimensions AND match the current route.
  const activeTargetLayout = useMemo(() => {
    if (!currentStep?.targetId) return null;
    const layout = targets[currentStep.targetId];
    if (!layout) return null;
    if (layout.width <= 0 || layout.height <= 0) return null;
    if (layout.route && !isRouteMatch(pathname, layout.route)) return null;
    return layout;
  }, [currentStep?.targetId, targets, pathname]);

  // Route validity for the active milestone
  const isCurrentRouteValid = isRouteMatch(pathname, activeMilestone?.route);

  // Overlay is presented ONLY if:
  // 1. Milestone is active and current route matches the milestone route
  // 2. Either the step has no target (e.g. Welcome card), OR the target is registered with valid bounds on the current screen
  const shouldShowOverlay = Boolean(
    activeMilestone &&
    isCurrentRouteValid &&
    (!currentStep?.targetId || activeTargetLayout !== null)
  );

  // Triggering with driver isolation and driving safety check
  const triggerMilestone = useCallback(
    async (milestoneKey, context = null) => {
      if (!milestoneKey) return false;

      // Driving Safety Lock: coach marks are suppressed while moving
      if (isDriving) {
        return false;
      }

      const config = getMilestoneConfig(milestoneKey);
      if (!config) return false;

      const alreadyDone = await isCoachMarkCompleted(
        config.key,
        config.version,
        driverId
      );
      if (alreadyDone) {
        return false;
      }

      setStepContext(context);
      setCurrentStepIndex(0);
      setActiveMilestoneKey(config.key);
      return true;
    },
    [driverId, isDriving]
  );

  const completeActiveMilestone = useCallback(async () => {
    if (activeMilestoneKey) {
      const config = getMilestoneConfig(activeMilestoneKey);
      if (config) {
        await setCoachMarkCompleted(config.key, config.version, driverId);
      }
    }
    setActiveMilestoneKey(null);
    setCurrentStepIndex(0);
    setStepContext(null);
  }, [activeMilestoneKey, driverId]);

  const nextStep = useCallback(async () => {
    if (!activeMilestoneKey) return;
    const config = getMilestoneConfig(activeMilestoneKey);
    if (!config) return;

    if (currentStepIndex < config.steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      await completeActiveMilestone();
    }
  }, [activeMilestoneKey, currentStepIndex, completeActiveMilestone]);

  const prevStep = useCallback(() => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  }, [currentStepIndex]);

  const skip = useCallback(async () => {
    await completeActiveMilestone();
  }, [completeActiveMilestone]);

  const dismiss = useCallback(async () => {
    await completeActiveMilestone();
  }, [completeActiveMilestone]);

  // Interaction-driven progression: observe real UI state changes
  const notifyInteraction = useCallback(
    async (targetId, data) => {
      if (!activeMilestoneKey || !currentStep) return;

      // Pre-Trip PASS/FAIL interaction
      if (
        targetId === "inspection.pass_fail" &&
        currentStep.targetId === "inspection.pass_fail"
      ) {
        const statusStr = String(data?.status || "").toUpperCase();
        if (statusStr === "FAIL") {
          // Driver chose FAIL: complete pretrip explanation and transition to remarks
          await completeActiveMilestone();
          setTimeout(() => {
            triggerMilestone("pretrip_remarks");
          }, 180);
          return;
        }
        if (statusStr === "PASS") {
          // Driver chose PASS: complete explanation
          await completeActiveMilestone();
          return;
        }
      }

      // Incident Category selection
      if (
        targetId === "incident.category" &&
        currentStep.targetId === "incident.category"
      ) {
        await nextStep();
        return;
      }

      // General passthrough interaction advancement
      if (
        currentStep.targetId === targetId &&
        currentStep.interaction === "passthrough"
      ) {
        await nextStep();
      }
    },
    [
      activeMilestoneKey,
      currentStep,
      completeActiveMilestone,
      triggerMilestone,
      nextStep,
    ]
  );

  const resetTips = useCallback(async () => {
    const success = await resetAllCoachMarks(driverId);
    setActiveMilestoneKey(null);
    setCurrentStepIndex(0);
    setStepContext(null);
    return success;
  }, [driverId]);

  const value = {
    activeMilestone: activeMilestoneKey,
    currentStepIndex,
    currentStep,
    stepContext,
    activeTargetLayout,
    triggerMilestone,
    registerTarget,
    unregisterTarget,
    notifyInteraction,
    nextStep,
    prevStep,
    skip,
    dismiss,
    dismissCoachMark: dismiss,
    resetTips,
    currentRoute: pathname,
  };

  return (
    <CoachMarkContext.Provider value={value}>
      <View style={{ flex: 1 }} pointerEvents="box-none">
        {children}
        {shouldShowOverlay && (
          <CoachMarkOverlay
            milestone={activeMilestone}
            step={currentStep}
            stepIndex={currentStepIndex}
            totalSteps={activeMilestone.steps.length}
            targetLayout={activeTargetLayout}
            stepContext={stepContext}
            onNext={nextStep}
            onPrev={prevStep}
            onSkip={skip}
            onDismiss={dismiss}
          />
        )}
      </View>
    </CoachMarkContext.Provider>
  );
}

export function useCoachMarks() {
  return useContext(CoachMarkContext);
}
