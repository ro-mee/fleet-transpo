import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { View, Keyboard, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePathname } from "expo-router";
import { getMilestoneConfig, isRouteMatch } from "../../lib/coach-marks";
import { useIsDriving } from "../../lib/tracking";
import {
  isCoachMarkCompleted,
  setCoachMarkCompleted,
  resetAllCoachMarks,
} from "../../lib/coach-mark-storage";
import CoachMarkOverlay from "./CoachMarkOverlay";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

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
  isDriving: false,
});

export function CoachMarkProvider({ children, driverId }) {
  // Driving Safety Lock (Capstone: Driver In-App Guide §7.1). Read from the
  // hook, never a prop: the previous version accepted an `isDriving` prop that
  // its only call site never passed, so the lock could never engage. No caller
  // can forget an internal hook.
  const isDriving = useIsDriving();

  // Mirrored so the post-await re-check in triggerMilestone reads the CURRENT
  // value. The closure's `isDriving` comes from the render that started the
  // call, and reading coach-mark storage is async — motion can begin while a
  // trigger is in flight, and this is a safety gate, so a passed check must not
  // be allowed to stand on a stale reading.
  //
  // useLayoutEffect rather than writing through during render: layout effects
  // flush synchronously at commit, before control returns to the event loop, so
  // a pending AsyncStorage continuation cannot interleave and read a stale
  // value. Same guarantee, without mutating a ref during render.
  const isDrivingRef = useRef(isDriving);
  useLayoutEffect(() => {
    isDrivingRef.current = isDriving;
  }, [isDriving]);

  // Used to reject targets that measured outside the safe viewport — the same
  // bounds CoachMarkTarget scrolls against.
  const insets = useSafeAreaInsets();

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

  // Which milestone owns the screen, held in a ref rather than read from the
  // `activeMilestoneKey` state above. Two reasons:
  //   1. The non-pre-emption guard below must be accurate the instant it runs.
  //      State lags by a render, which is exactly the window two triggers in
  //      the same tick would slip through.
  //   2. `triggerMilestone` stays out of the deps of the screens' trigger
  //      effects (inspection.js, fuel-report.js, …). If its identity changed on
  //      every milestone transition those effects would re-fire.
  // Every writer of `activeMilestoneKey` below sets this in the same tick.
  const activeKeyRef = useRef(null);

  const activeMilestone = useMemo(
    () => getMilestoneConfig(activeMilestoneKey),
    [activeMilestoneKey]
  );
  const currentStep = activeMilestone?.steps?.[currentStepIndex] || null;

  // ── Target ownership ──────────────────────────────────────────────────────
  // A target id can be live more than once: `inspection.remarks` mounts once per
  // FAILED checklist item, so two FAILs register the same id twice. Before this,
  // last-measure-wins silently overwrote the first, and unmounting *either*
  // deleted the shared registration outright.
  //
  // Now every registration carries the token of the instance that made it, the
  // newest live one wins, and an unmount removes only its own — promoting the
  // survivor rather than clearing the id.
  const seqRef = useRef(0);
  const registrationsRef = useRef(new Map()); // targetId -> Map<token, {seq, layout, route}>

  // Publishes the winning registration for `targetId` — or removes the id once
  // nothing live holds it. Ownership bookkeeping lives in the ref above, so this
  // is the only place `targets` state is written.
  const commitWinner = useCallback((targetId) => {
    const byToken = registrationsRef.current.get(targetId);
    let winner = null;
    if (byToken) {
      for (const entry of byToken.values()) {
        if (!winner || entry.seq > winner.seq) winner = entry;
      }
    }

    setTargets((prev) => {
      if (!winner) {
        if (!prev[targetId]) return prev;
        const next = { ...prev };
        delete next[targetId];
        return next;
      }
      const existing = prev[targetId];
      if (
        existing &&
        existing.x === winner.layout.x &&
        existing.y === winner.layout.y &&
        existing.width === winner.layout.width &&
        existing.height === winner.layout.height &&
        existing.route === winner.route
      ) {
        return prev;
      }
      return {
        ...prev,
        [targetId]: {
          ...winner.layout,
          route: winner.route,
        },
      };
    });
  }, []);

  // Target registration with route stamping, dimension validation and ownership
  const registerTarget = useCallback((targetId, layout, route, token, instanceId) => {
    if (!targetId || !layout) return;
    if (layout.width <= 0 || layout.height <= 0) return;

    const targetRoute = route || layout.route || pathname;

    let byToken = registrationsRef.current.get(targetId);
    if (!byToken) {
      byToken = new Map();
      registrationsRef.current.set(targetId, byToken);
    }

    let previous = null;
    for (const entry of byToken.values()) {
      if (!previous || entry.seq > previous.seq) previous = entry;
    }

    byToken.set(token, {
      seq: (seqRef.current += 1),
      layout,
      route: targetRoute,
      instanceId,
    });

    // Two live mounts under one id is legitimate for `inspection.remarks`, but
    // only when they agree — different bounds mean the spotlight will jump
    // between them as each re-measures, which is always an authoring mistake.
    if (__DEV__ && byToken.size > 1 && previous) {
      const p = previous.layout;
      const moved =
        p.x !== layout.x ||
        p.y !== layout.y ||
        p.width !== layout.width ||
        p.height !== layout.height;
      if (moved) {
        console.warn(
          `[coach-marks] Two live targets share the id "${targetId}" with ` +
            `different bounds (${p.x},${p.y} ${p.width}x${p.height} vs ` +
            `${layout.x},${layout.y} ${layout.width}x${layout.height}). The ` +
            `spotlight follows whichever measured last — give the target id to ` +
            `one instance only. This one: instance ${instanceId ?? "unknown"} ` +
            `on ${targetRoute}. Previous: instance ` +
            `${previous.instanceId ?? "unknown"} on ${previous.route}. ` +
            `Live instances under this id: ${byToken.size}.`,
          // Which mount is behind the second registration is not visible from
          // the bounds alone — an instance that is mounted but covered, or one
          // whose registration outlived its mount, both look like this. The
          // stack says whether it came from a mount effect, a settle timer, or
          // a native measure callback that had already outlived its screen.
          `Registering stack:\n${new Error().stack}`
        );
      }
    }

    commitWinner(targetId);
  }, [pathname, commitWinner]);

  const unregisterTarget = useCallback((targetId, token) => {
    if (!targetId) return;
    const byToken = registrationsRef.current.get(targetId);
    if (!byToken) return;

    if (token != null) {
      // Only the owning instance's unmount removes its own registration. A
      // duplicate unmounting must not delete what another live instance holds.
      if (!byToken.delete(token)) return;
    } else {
      // Called without a token: a single unambiguous owner.
      byToken.clear();
    }

    if (byToken.size === 0) registrationsRef.current.delete(targetId);
    commitWinner(targetId);
  }, [commitWinner]);

  // Compute layout for the active step:
  // Must have positive dimensions, match the current route, and be on screen.
  const activeTargetLayout = useMemo(() => {
    if (!currentStep?.targetId) return null;
    const layout = targets[currentStep.targetId];
    if (!layout) return null;
    if (layout.width <= 0 || layout.height <= 0) return null;
    if (layout.route && !isRouteMatch(pathname, layout.route)) return null;

    // Positive bounds are not enough: a card scrolled out of view measures
    // positively too, and the overlay would then dim the whole screen with the
    // cutout pointing at nothing.
    //
    // Rejected only when the box is ENTIRELY outside the safe viewport — the
    // same bounds CoachMarkTarget scrolls against. A partially visible target
    // must still present, because the auto-scroll is gated on
    // `isCurrentActiveTarget` (independent of overlay visibility): it runs, the
    // target re-registers at its settled position, and the mark appears then.
    const minSafeY = (insets?.top || 0) + 40;
    const maxSafeY = SCREEN_HEIGHT - (insets?.bottom || 0) - 80;
    if (layout.y + layout.height <= minSafeY) return null;
    if (layout.y >= maxSafeY) return null;

    return layout;
  }, [currentStep?.targetId, targets, pathname, insets]);

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

  // Whether a guide is on screen right now, mirrored into a ref.
  //
  // The non-pre-emption guard below reads this, and it must not become a
  // dependency of triggerMilestone: its identity is in the deps of the screens'
  // trigger effects, and this value changes on every target measurement (the
  // settling ticks re-register continuously). The callback body only ever runs
  // after this render, so the mirror is current by then — including on the
  // render where the driver navigates, which is exactly when it matters.
  //
  // Written in a layout effect for the same reason as isDrivingRef above: it
  // lands at commit, before anything that could read it.
  const overlayVisibleRef = useRef(false);
  useLayoutEffect(() => {
    overlayVisibleRef.current = shouldShowOverlay;
  }, [shouldShowOverlay]);

  /**
   * Clears the open guide WITHOUT recording it as completed.
   *
   * For when a guide is taken away rather than finished — currently only the
   * Driving Safety Lock. A tip the driver never got to read must not be burned
   * permanently, so it returns the next time its trigger fires.
   */
  const abandonActiveMilestone = useCallback(() => {
    activeKeyRef.current = null;
    setActiveMilestoneKey(null);
    setCurrentStepIndex(0);
    setStepContext(null);
  }, []);

  // Triggering with driver isolation, driving safety check, and a
  // no-pre-emption rule
  const triggerMilestone = useCallback(
    async (milestoneKey, context = null) => {
      if (!milestoneKey) return false;

      // Driving Safety Lock: coach marks are suppressed while moving
      if (isDriving) {
        return false;
      }

      // Never pre-empt a guide the driver is looking at. Home mounts and shows
      // `welcome`; two seconds later the SOS tip used to replace it, so the
      // greeting was never read AND never marked complete — it only appeared on
      // a later launch. The same race let `pretrip_complete` cut off an open
      // `pretrip_remarks`.
      //
      // Scoped to what is on screen, not to "a milestone is active": a guide
      // left behind by navigation, or one whose target never registered, is
      // hidden — and blocking on it would wedge the guide for the screen the
      // driver is actually on, since an invisible guide offers nothing to
      // dismiss. Either way the pre-empted or superseded guide is left
      // incomplete, so it returns the next time its trigger fires.
      if (overlayVisibleRef.current) return false;

      const config = getMilestoneConfig(milestoneKey);
      if (!config) return false;

      const claimedBefore = activeKeyRef.current;

      const alreadyDone = await isCoachMarkCompleted(
        config.key,
        config.version,
        driverId
      );
      if (alreadyDone) {
        return false;
      }

      // Compared against what it was before the await, rather than merely
      // checked for presence: that storage read is async, so another trigger can
      // claim the screen while this one is resolving. Comparing also lets a
      // stale key — a guide left behind on another route — through, which a
      // plain presence check would wrongly treat as a claim.
      if (activeKeyRef.current !== claimedBefore) return false;

      // And re-check the lock itself, for the same reason: it may have engaged
      // during the read.
      if (isDrivingRef.current) return false;

      // Set synchronously, before the state lands, so the guard above is
      // accurate for anything that fires before the next render.
      activeKeyRef.current = config.key;
      setStepContext(context);
      setCurrentStepIndex(0);
      setActiveMilestoneKey(config.key);
      return true;
    },
    [driverId, isDriving]
  );

  const completeActiveMilestone = useCallback(async () => {
    // Read the ref, not the state: it is the authoritative record of which
    // milestone owns the screen, and keeping `activeMilestoneKey` out of the
    // deps leaves this callback stable across milestone transitions.
    const key = activeKeyRef.current;
    if (!key) return;

    const config = getMilestoneConfig(key);
    if (config) {
      await setCoachMarkCompleted(config.key, config.version, driverId);
    }

    // The await above yields. If something else took the screen meanwhile — a
    // route change triggering the next guide, or the driving lock abandoning
    // it — that milestone owns the state now and clearing it here would leave a
    // ref set with no guide on screen, blocking every future trigger.
    if (activeKeyRef.current !== key) return;

    activeKeyRef.current = null;
    setActiveMilestoneKey(null);
    setCurrentStepIndex(0);
    setStepContext(null);
  }, [driverId]);

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
    activeKeyRef.current = null;
    setActiveMilestoneKey(null);
    setCurrentStepIndex(0);
    setStepContext(null);
    return success;
  }, [driverId]);

  // The dismissal half of the Driving Safety Lock. Spec §7.1 suppresses marks
  // "until the vehicle is stationary" — but the hazard is not only the next mark
  // appearing, it is the one already on screen: a dimmed scrim over the map
  // while the driver pulls away. Abandoned rather than completed, so a tip the
  // driver never got to read returns once parked.
  useEffect(() => {
    // A deliberate, justified exception to set-state-in-effect: taking the open
    // guide down IS this effect's purpose rather than a side effect of it. It
    // has no render-derived form — the milestone must be cleared without being
    // recorded as completed, so it cannot simply be computed away while
    // rendering, and the clearing has to reach state that later triggers read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isDriving) abandonActiveMilestone();
  }, [isDriving, abandonActiveMilestone]);

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
    // Exposed so screens can respect the lock themselves — DriverSos.js already
    // destructures this for its "only once stationary" delay.
    isDriving,
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
