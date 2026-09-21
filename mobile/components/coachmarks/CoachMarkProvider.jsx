import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { View, Keyboard, Dimensions, useWindowDimensions } from "react-native";
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

// ── Why the guide is published through THREE contexts, not one ─────────────
// A context's value is compared by identity, so one value object means every
// consumer re-renders whenever ANY coach-mark field changes. It was also built
// as a plain object literal, so it changed identity on every provider render —
// a route change, a window resize, a keyboard event or one target re-measuring
// all woke every consumer, including the always-mounted pieces (the tab bar,
// the SOS button, the connectivity banner).
//
// The fields are partitioned by HOW OFTEN they change, not by what they are
// about:
//
//   Actions — callbacks only. Stable across step transitions and target
//             re-measures, which is where the churn was. It does still move on
//             a route change or a driving-lock flip, and that is deliberate —
//             see the note on the delegates below. Half the consumers are in
//             this group (see `useCoachMarkActions`).
//   Status  — which milestone owns the screen, whether the vehicle is moving,
//             and the Map-tour reservation flags. Moves on milestone
//             transitions only, not on step changes or re-measures.
//   State   — the current step, its measured rectangle and the presentation
//             generation. Genuinely volatile: this is exactly what step
//             transitions and settling re-measures are supposed to move.
//
// `useCoachMarks()` still returns all three merged, so a consumer that needs
// more than one group is unaffected; it is the narrower hooks that carry the
// win.
const CoachMarkActionsContext = createContext({
  triggerMilestone: () => Promise.resolve(false),
  triggerMapIntroFromTab: () => Promise.resolve(false),
  registerTarget: () => {},
  unregisterTarget: () => {},
  notifyInteraction: () => {},
  nextStep: () => {},
  prevStep: () => {},
  skip: () => {},
  dismiss: () => {},
  dismissCoachMark: () => {},
  resetTips: () => Promise.resolve(false),
});

const CoachMarkStatusContext = createContext({
  activeMilestone: null,
  mapIntroPending: false,
  mapIntroAwaitingTap: false,
  isDriving: false,
});

const CoachMarkStateContext = createContext({
  currentStepIndex: 0,
  currentStep: null,
  stepContext: null,
  activeTargetLayout: null,
  activePresentationId: 0,
  currentRoute: "/",
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
  const { height: windowHeight } = useWindowDimensions();

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

  // ── Presentation Generation / Freshness Gate ──────────────────────────────
  // An overlay may never render from a target rectangle measured before the
  // current step activation. Every milestone trigger or step change increments
  // this generation. The overlay only presents once the active target publishes
  // a measurement matching `activePresentationId`.
  const [activePresentationId, setActivePresentationId] = useState(0);
  const activePresentationIdRef = useRef(0);

  const bumpPresentationId = useCallback(() => {
    const next = activePresentationIdRef.current + 1;
    activePresentationIdRef.current = next;
    setActivePresentationId(next);
    return next;
  }, []);

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
  const [mapIntroPending, setMapIntroPending] = useState(false);
  const [mapIntroAwaitingTap, setMapIntroAwaitingTap] = useState(false);
  const mapIntroPendingRef = useRef(false);
  const mapIntroAwaitingTapRef = useRef(false);
  const mapIntroAttemptRef = useRef(0);
  const interactionSatisfiedRef = useRef(null);

  const activeMilestone = useMemo(
    () => getMilestoneConfig(activeMilestoneKey),
    [activeMilestoneKey]
  );
  const currentStep = activeMilestone?.steps?.[currentStepIndex] || null;

  useEffect(() => {
    interactionSatisfiedRef.current = null;
  }, [activeMilestoneKey, currentStepIndex]);

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
  const registrationsRef = useRef(new Map()); // targetId -> Map<token, {seq, layout, route, instanceId, presentationId}>

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
        existing.route === winner.route &&
        existing.presentationId === winner.presentationId
      ) {
        return prev;
      }
      return {
        ...prev,
        [targetId]: {
          ...winner.layout,
          route: winner.route,
          presentationId: winner.presentationId,
        },
      };
    });
  }, []);

  // Target registration with route stamping, dimension validation, ownership and freshness generation
  const registerTarget = useCallback((targetId, layout, route, token, instanceId, presentationId) => {
    if (!targetId || !layout) return;
    if (layout.width <= 0 || layout.height <= 0) return;

    const targetRoute = route || layout.route || pathname;
    const targetPresentationId = presentationId ?? layout.presentationId ?? null;

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
      presentationId: targetPresentationId,
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
  // Must have positive dimensions, match the current route, match the active
  // presentation generation, and lie at least partly inside the window.
  //
  // ── Why the spotlight is not presenting (dev only) ────────────────────────
  // Presentation is gated entirely on this result, and EVERY way of failing it
  // used to be a silent `return null`. That is what made a measurement that
  // never landed indistinguishable from a trigger that never fired: the
  // milestone can be claimed, on the right route, with the right step current,
  // and still present nothing at all — so a trigger-side fix and a measurement
  // fix look identical from the device. The reason is computed here as plain
  // data and reported from the effect below, because a ref must not be touched
  // during render (`react-hooks/refs`).
  const spotlight = useMemo(() => {
    const rejected = (reason, detail = null) => ({ layout: null, reason, detail });

    if (!currentStep?.targetId) {
      // No target on this step: the card presents centred, which is a success.
      return { layout: null, reason: null, detail: null };
    }
    const layout = targets[currentStep.targetId];
    if (!layout) {
      return rejected("target never registered", {
        registered: Object.keys(targets),
      });
    }
    if (layout.width <= 0 || layout.height <= 0) {
      return rejected("target measured zero-size", { layout });
    }
    if (layout.route && !isRouteMatch(pathname, layout.route)) {
      return rejected("target belongs to another route", {
        targetRoute: layout.route,
      });
    }

    // Freshness invariant: an overlay may never render from a target rectangle
    // measured before the current step activation. The registration must carry
    // the active presentation generation. Reported rather than a bare `null`, so
    // a stale registration shows up in the diagnostic below instead of silently
    // looking like a target that never measured.
    if (layout.presentationId !== activePresentationId) {
      return rejected("target registered by a stale presentation", {
        registeredPresentationId: layout.presentationId ?? null,
        activePresentationId,
      });
    }

    // Positive bounds are not enough: a card scrolled out of view measures
    // positively too, and the overlay would then dim the whole screen with the
    // cutout pointing at nothing. That — a box lying ENTIRELY outside the window
    // — is the whole of what is rejected here.
    //
    // This used to be `insets.top + 40` / `SCREEN_HEIGHT - insets.bottom - 80`,
    // and that slack is what refused the first Map spotlight. A top-anchored
    // target legitimately sits at the top of the screen: on device,
    // `map.standby_status` measured y=16, height=49.8 — entirely visible — while
    // the gate demanded its bottom edge clear `insets.top + 40` = 79.1. Because
    // the header declares `top: insets.top + 16`, its settled box is
    // `insets.top + 16 .. insets.top + 66`, which clears that bar by only 26px;
    // the refusal happened because the target's own insets had not settled when
    // it measured while the provider's already had. Testing against the window
    // makes presentation independent of that race.
    //
    // Partially visible targets must still present: the auto-scroll is gated on
    // `isCurrentActiveTarget` (independent of overlay visibility), so it runs,
    // the target re-registers at its settled position, and the mark appears
    // then. Hence a whole-box test rather than a margin.
    const SCREEN_HEIGHT = windowHeight || Dimensions.get("window").height;
    if (layout.y + layout.height <= 0) {
      return rejected("target entirely above the window", {
        y: layout.y,
        height: layout.height,
      });
    }
    if (layout.y >= SCREEN_HEIGHT) {
      return rejected("target entirely below the window", {
        y: layout.y,
        SCREEN_HEIGHT,
      });
    }

    return { layout, reason: null, detail: null };
  }, [
    currentStep?.targetId,
    targets,
    pathname,
    windowHeight,
    activePresentationId,
  ]);

  const activeTargetLayout = spotlight.layout;

  // Deduped by signature: the memo above re-runs on every re-measure, so a raw
  // log would bury the first — and only informative — line under its own
  // repeats. `console.warn` matches this app's existing diagnostic idiom. The
  // latch clears as soon as the spotlight presents, so a later regression on the
  // same step reports again rather than staying silent.
  const rejectReasonRef = useRef(null);
  useEffect(() => {
    if (!__DEV__) return;
    const signature = spotlight.reason
      ? `${spotlight.reason}|${currentStep?.targetId || "none"}`
      : null;
    if (!signature) {
      rejectReasonRef.current = null;
      return;
    }
    if (rejectReasonRef.current === signature) return;
    rejectReasonRef.current = signature;
    console.warn(`[coachmarks] spotlight not presenting — ${spotlight.reason}`, {
      milestone: activeMilestoneKey,
      targetId: currentStep?.targetId || null,
      pathname,
      detail: spotlight.detail,
    });
  }, [spotlight, currentStep?.targetId, activeMilestoneKey, pathname]);

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
    if (activeKeyRef.current === "map_intro") {
      mapIntroAwaitingTapRef.current = true;
      setMapIntroAwaitingTap(true);
    }
    // Clear the synchronous guard with the owner ref so an intentional Map
    // handoff cannot see the just-abandoned Welcome overlay for one tick.
    overlayVisibleRef.current = false;
    activeKeyRef.current = null;
    setActiveMilestoneKey(null);
    setCurrentStepIndex(0);
    setStepContext(null);
    interactionSatisfiedRef.current = null;
    bumpPresentationId();
  }, [bumpPresentationId]);

  // Triggering with driver isolation, driving safety check, and a
  // no-pre-emption rule
  const triggerMilestone = useCallback(
    async (milestoneKey, context = null) => {
      if (!milestoneKey) return false;

      // An intentional Map-tab visit owns the first Map tour. Do not let a
      // Home focus trigger claim the screen while that reservation is async.
      if (
        milestoneKey !== "map_intro" &&
        (mapIntroPendingRef.current || activeKeyRef.current === "map_intro")
      ) {
        return false;
      }

      // Map-intro owns the first intentional Map visit. Keep the existing
      // live-trip trigger from winning the async storage race while that
  // map-specific reservation is pending or active.
      if (
        milestoneKey === "live_trip" &&
        (mapIntroPendingRef.current ||
          mapIntroAwaitingTapRef.current ||
          activeKeyRef.current === "map_intro")
      ) {
        return false;
      }

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

      if (
        milestoneKey === "live_trip" &&
        (mapIntroPendingRef.current ||
          mapIntroAwaitingTapRef.current ||
          activeKeyRef.current === "map_intro")
      ) {
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
      if (
        milestoneKey !== "map_intro" &&
        (mapIntroPendingRef.current || activeKeyRef.current === "map_intro")
      ) {
        return false;
      }

      // Set synchronously, before the state lands, so the guard above is
      // accurate for anything that fires before the next render.
      activeKeyRef.current = config.key;
      setStepContext(context);
      setCurrentStepIndex(0);
      setActiveMilestoneKey(config.key);
      const nextPresentationId = activePresentationIdRef.current + 1;
      activePresentationIdRef.current = nextPresentationId;
      setActivePresentationId(nextPresentationId);
      return true;
    },
    [driverId, isDriving]
  );

  // Intentional Map-tab entry point. This is deliberately separate from the
  // generic trigger so programmatic navigation and screen focus cannot start
  // the first Map tour, and so the live-trip trigger cannot pre-empt it while
  // AsyncStorage is being checked.
  const triggerMapIntroFromTab = useCallback(
    async (context = { source: "map-tab" }) => {
      const config = getMilestoneConfig("map_intro");
      if (!config) return false;
      if (mapIntroPendingRef.current || activeKeyRef.current === config.key) {
        return false;
      }
      if (activeKeyRef.current === "welcome") {
        // Resetting tips can immediately show Home's welcome card. A direct
        // Map-tab tap is an explicit choice to start the Map tour instead.
        abandonActiveMilestone();
      } else if (overlayVisibleRef.current) {
        return false;
      }

      mapIntroAwaitingTapRef.current = false;
      setMapIntroAwaitingTap(false);

      const attempt = mapIntroAttemptRef.current + 1;
      mapIntroAttemptRef.current = attempt;
      mapIntroPendingRef.current = true;
      setMapIntroPending(true);

      try {
        const alreadyDone = await isCoachMarkCompleted(
          config.key,
          config.version,
          driverId
        );
        if (
          alreadyDone ||
          overlayVisibleRef.current ||
          mapIntroAttemptRef.current !== attempt
        ) {
          return false;
        }

        activeKeyRef.current = config.key;
        setStepContext(context);
        setCurrentStepIndex(0);
        setActiveMilestoneKey(config.key);
        return true;
      } finally {
        if (mapIntroAttemptRef.current === attempt) {
          mapIntroPendingRef.current = false;
          setMapIntroPending(false);
        }
      }
    },
    [abandonActiveMilestone, driverId]
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
    interactionSatisfiedRef.current = null;
    if (key === "map_intro") {
      mapIntroAwaitingTapRef.current = false;
      setMapIntroAwaitingTap(false);
    }
    bumpPresentationId();
  }, [driverId, bumpPresentationId]);

  const nextStep = useCallback(async () => {
    if (!activeMilestoneKey) return;
    const config = getMilestoneConfig(activeMilestoneKey);
    if (!config) return;

    if (
      currentStep?.requiresInteraction &&
      interactionSatisfiedRef.current !== currentStep.id
    ) {
      return;
    }

    if (currentStepIndex < config.steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
      bumpPresentationId();
    } else {
      await completeActiveMilestone();
    }
  }, [
    activeMilestoneKey,
    currentStep,
    currentStepIndex,
    completeActiveMilestone,
    bumpPresentationId,
  ]);

  const prevStep = useCallback(() => {
    if (currentStep?.allowBack === false) return;
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
      bumpPresentationId();
    }
  }, [currentStep, currentStepIndex, bumpPresentationId]);

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

      // Fuel scan intro handoff: the simulation never opens the camera.
      // The real production card opens it, and the guide merely observes that tap.
      if (
        targetId === "fuel.scan_entry" &&
        currentStep.targetId === "fuel.scan_entry" &&
        data?.action === "open_real_scanner"
      ) {
        await completeActiveMilestone();
        return;
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
        if (currentStep.requiresInteraction) {
          if (data?.success !== true) return;
          interactionSatisfiedRef.current = currentStep.id;
        }
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
    mapIntroAttemptRef.current += 1;
    mapIntroPendingRef.current = false;
    mapIntroAwaitingTapRef.current = false;
    overlayVisibleRef.current = false;
    activeKeyRef.current = null;
    interactionSatisfiedRef.current = null;
    setMapIntroPending(false);
    setMapIntroAwaitingTap(false);
    setActiveMilestoneKey(null);
    setCurrentStepIndex(0);
    setStepContext(null);
    bumpPresentationId();
    return success;
  }, [driverId, bumpPresentationId]);

  // Dev-only coach-mark diagnostic log when active target layout settles
  useEffect(() => {
    if (__DEV__ && activeMilestoneKey && currentStep?.targetId && activeTargetLayout) {
      console.log(
        `[coach-marks] ACTIVE ${currentStep.targetId}\n` +
          `presentation=${activePresentationId}\n` +
          `route=${pathname}\n` +
          `measured=(${activeTargetLayout.x},${activeTargetLayout.y} ${activeTargetLayout.width}x${activeTargetLayout.height})`
      );
    }
  }, [
    activeMilestoneKey,
    currentStep?.targetId,
    activeTargetLayout,
    activePresentationId,
    pathname,
  ]);

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
    if (isDriving && activeKeyRef.current !== "map_intro") {
      abandonActiveMilestone();
    }
  }, [isDriving, abandonActiveMilestone]);

  // ── Stable handles for the three step-dependent callbacks ─────────────────
  // `nextStep`, `prevStep` and `notifyInteraction` all close over the current
  // step, so their identity changes on every step transition. Published raw,
  // they would re-create the actions value each time and drag every
  // actions-only consumer back into re-rendering on every step — which is the
  // exact cost the split exists to remove.
  //
  // So the actions context carries stable delegates that read the latest
  // definition out of a ref. This changes nothing about what the callback does:
  // the ref is written at commit, and these are only ever reached from an event
  // handler, so a call always runs the definition from the render on screen.
  // Written in a layout effect for the same reason as the other ref mirrors in
  // this file — it lands at commit, before anything that could read it.
  //
  // `triggerMilestone` is deliberately left raw for the opposite reason: it
  // closes over `isDriving`, and several screens trigger it from an effect whose
  // only other deps are their own local state (inspection.js:61, incidents.js:71,
  // fuel-report.js:183). That identity change is what re-runs those effects the
  // moment the driving lock releases, so a guide suppressed while moving appears
  // once parked. Freezing it would strand those triggers until something
  // unrelated changed. `registerTarget` is left raw for the same shape of
  // reason — it carries the route — and costs nothing, because CoachMarkTarget
  // lists `pathname` as a dep of its own measurement callback anyway.
  const stepCallbacksRef = useRef(null);
  useLayoutEffect(() => {
    stepCallbacksRef.current = { nextStep, prevStep, notifyInteraction };
  }, [nextStep, prevStep, notifyInteraction]);

  // Optional calls rather than bare ones: nothing can reach a delegate before
  // the layout effect above has run, but a null-safe call costs nothing and
  // removes the need for a reader to prove that.
  const stableNextStep = useCallback(
    (...args) => stepCallbacksRef.current?.nextStep?.(...args),
    []
  );
  const stablePrevStep = useCallback(
    (...args) => stepCallbacksRef.current?.prevStep?.(...args),
    []
  );
  const stableNotifyInteraction = useCallback(
    (...args) => stepCallbacksRef.current?.notifyInteraction?.(...args),
    []
  );

  const actions = useMemo(
    () => ({
      triggerMilestone,
      triggerMapIntroFromTab,
      registerTarget,
      unregisterTarget,
      notifyInteraction: stableNotifyInteraction,
      nextStep: stableNextStep,
      prevStep: stablePrevStep,
      skip,
      dismiss,
      dismissCoachMark: dismiss,
      resetTips,
    }),
    [
      triggerMilestone,
      triggerMapIntroFromTab,
      registerTarget,
      unregisterTarget,
      stableNotifyInteraction,
      stableNextStep,
      stablePrevStep,
      skip,
      dismiss,
      resetTips,
    ]
  );

  const status = useMemo(
    () => ({
      activeMilestone: activeMilestoneKey,
      mapIntroPending,
      mapIntroAwaitingTap,
      // Exposed so screens can respect the lock themselves — DriverSos.js
      // already destructures this for its "only once stationary" delay.
      isDriving,
    }),
    [activeMilestoneKey, mapIntroPending, mapIntroAwaitingTap, isDriving]
  );

  const state = useMemo(
    () => ({
      currentStepIndex,
      currentStep,
      stepContext,
      activeTargetLayout,
      activePresentationId,
      currentRoute: pathname,
    }),
    [
      currentStepIndex,
      currentStep,
      stepContext,
      activeTargetLayout,
      activePresentationId,
      pathname,
    ]
  );

  return (
    <CoachMarkActionsContext.Provider value={actions}>
      <CoachMarkStatusContext.Provider value={status}>
        <CoachMarkStateContext.Provider value={state}>
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
        </CoachMarkStateContext.Provider>
      </CoachMarkStatusContext.Provider>
    </CoachMarkActionsContext.Provider>
  );
}

/**
 * The callbacks only. A consumer that just tells the guide something has
 * happened — start this tour, the driver did this, reset the tips — subscribes
 * here, and is then never re-rendered by a step transition, a re-measure or a
 * milestone change: this value only moves on a route change or a driving-lock
 * flip, both of which are moments the consumer wants to hear about anyway.
 */
export function useCoachMarkActions() {
  return useContext(CoachMarkActionsContext);
}

/**
 * Which milestone owns the screen, whether the vehicle is moving, and the
 * Map-tour reservation flags. Changes on milestone transitions, not on step
 * changes or target re-measures.
 */
export function useCoachMarkStatus() {
  return useContext(CoachMarkStatusContext);
}

/**
 * The current step and its measured target rectangle. The volatile group —
 * subscribe only if the component genuinely has to know where the guide is.
 */
export function useCoachMarkState() {
  return useContext(CoachMarkStateContext);
}

/**
 * All three groups merged, for a consumer that needs more than one of them.
 * Because it subscribes to every context, this re-renders on step transitions
 * and target re-measures — prefer the narrower hooks above.
 */
export function useCoachMarks() {
  const actions = useContext(CoachMarkActionsContext);
  const status = useContext(CoachMarkStatusContext);
  const state = useContext(CoachMarkStateContext);
  return useMemo(
    () => ({ ...actions, ...status, ...state }),
    [actions, status, state]
  );
}
