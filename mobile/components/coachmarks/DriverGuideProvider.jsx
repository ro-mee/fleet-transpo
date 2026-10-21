import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from '../../lib/api';
import { loadPracticeReadiness } from '../../lib/driver-practice-readiness';
import { useAuth } from '../../lib/auth';
import { useDriverProfile } from '../../lib/driver-profile';
import { useIsDriving, usePosterStatus } from '../../lib/tracking';
import { captureCargoSession, isCurrentCargoSession } from '../../lib/cargo-sync';
import { createDriverGuideController } from '../../lib/driver-guide-controller';
import { useDriverPractice } from '../../lib/use-driver-practice';
import { readGuideProgress, writeGuideProgress, resetDriverGuideProgress, resetAllCoachMarks, isCoachMarkCompleted } from '../../lib/coach-mark-storage';
import CoachMarkOverlay from './CoachMarkOverlay';

const legacyGuides = { welcome: 'welcome', preshift: 'duty.start', end_duty: 'duty.end', trip_readiness: 'trip.readiness', sos: 'sos', incident: 'incident.report', fuel_scan_intro: 'fuel.receipt', fuel_scan_verify: 'fuel.receipt', live_trip: 'map.controls', map_intro: 'map.controls' };
const emptyFrame = { active: null, target: null, presentationId: 0, error: null };

export default function DriverGuideProvider({ children, driverId, contexts }) {
  const { user } = useAuth();
  const { profile, serverConfirmed } = useDriverProfile();
  const route = usePathname() || '/';
  const poster = usePosterStatus(), isDriving = useIsDriving();
  const [frame, setFrame] = useState(emptyFrame);
  const snapshot = useRef({}), flags = useRef({}), mounted = useRef(true), startEpoch = useRef(0), checking = useRef(false);
  const getContext = useCallback(() => {
    const value = snapshot.current;
    const work = flags.current.work;
    const freshWork = work?.available === true && work.actorId === value.session?.actorId && work.sessionGeneration === value.sessionGeneration && Date.now() - work.checkedAt <= 30000;
    return { ...flags.current, ...value, hasAssignment: freshWork ? work.hasAssignment : undefined, hasPendingSubmission: freshWork ? work.hasPendingSubmission : undefined, foreground: AppState.currentState === 'active', emergency: flags.current.sosOpen === true || /^\/incident\//.test(value.route || '') ? true : freshWork ? work.emergency : undefined, responderWork: freshWork ? work.responderWork : undefined, actorConfirmed: value.actorId != null && isCurrentCargoSession(value.session), contextValid: value.serverConfirmed === true && (flags.current.contextRoute !== value.route || flags.current.contextValid !== false) };
  }, []);
  const { practiceSession, startPractice, dispatchPractice, endPractice } = useDriverPractice({ getContext });
  const [controller] = useState(() => createDriverGuideController({
    getContext, onChange: value => { if (mounted.current) setFrame(value); },
    storage: {
      read: readGuideProgress, write: writeGuideProgress,
      legacy: async (keys, actorId) => Object.fromEntries(await Promise.all(keys.map(async key => [key, await isCoachMarkCompleted(key, 1, actorId)]))),
      reset: async actorId => (await resetDriverGuideProgress(actorId)) && (await resetAllCoachMarks(actorId)),
    },
  }));
  useLayoutEffect(() => {
    if (snapshot.current.actorId !== (driverId == null ? null : String(driverId))) flags.current = {};
    snapshot.current = { actorId: driverId == null ? null : String(driverId), session: captureCargoSession(user?.employeeId), sessionGeneration: captureCargoSession(user?.employeeId)?.generation, workspace: profile?.driverType === 'Cargo' ? 'cargo' : profile?.driverType === 'Passenger' ? 'passenger' : 'unclassified', serverConfirmed, route, motion: { speedMs: poster.motionSpeedMs, observedAt: poster.motionFixAt ? new Date(poster.motionFixAt).getTime() : null, movingHold: isDriving } };
    controller.reconcile();
  }, [controller, driverId, user?.employeeId, profile?.driverType, serverConfirmed, route, poster.motionSpeedMs, poster.motionFixAt, isDriving]);
  useEffect(() => {
    mounted.current = true;
    const timer = setInterval(controller.reconcile, 1000);
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') { startEpoch.current++; controller.interrupt(); endPractice(); }
    });
    return () => { mounted.current = false; clearInterval(timer); listener.remove(); };
  }, [controller, endPractice]);
  const updateGuideContext = useCallback(patch => { flags.current = { ...flags.current, ...patch }; controller.reconcile(); }, [controller]);
  const interruptGuidance = useCallback(() => { startEpoch.current++; controller.interrupt(); endPractice(); }, [controller, endPractice]);
  const refreshPracticeContext = useCallback(async () => {
    const session = snapshot.current.session;
    if (!session || !isCurrentCargoSession(session)) return false;
    const result = await loadPracticeReadiness({ actorId: session.actorId, isCurrent: () => mounted.current && isCurrentCargoSession(session), getItem: key => AsyncStorage.getItem(key), read: apiFetch });
    if (!mounted.current || !isCurrentCargoSession(session)) return false;
    flags.current = { ...flags.current, work: { ...result, actorId: session.actorId, sessionGeneration: session.generation } };
    return result.available;
  }, []);
  const beginPractice = useCallback(async args => {
    if (checking.current) return { allowed: false, reason: 'checking_work' };
    checking.current = true; const requestEpoch = startEpoch.current;
    try {
      if (!await refreshPracticeContext() || requestEpoch !== startEpoch.current) return { allowed: false, reason: 'refresh_required' };
      return startPractice(args);
    } finally { checking.current = false; }
  }, [refreshPracticeContext, startPractice]);
  useEffect(() => {
    const check = () => { if (AppState.currentState === 'active') void refreshPracticeContext(); };
    check();
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [driverId, user?.employeeId, route, refreshPracticeContext]);
  const triggerMilestone = useCallback((key, context) => {
    if (!key || key.startsWith('tour_') || key === 'offline') return Promise.resolve(false);
    const id = key === 'pretrip' || key === 'pretrip_remarks' || key === 'pretrip_complete'
      ? context?.mode === 'preshift' ? 'inspection.daily' : 'inspection.quick'
      : legacyGuides[key];
    return id ? controller.requestGuide({ guideId: id, variant: getContext().workspace, context }) : Promise.resolve(false);
  }, [controller, getContext]);
  const actions = useMemo(() => ({
    requestGuide: controller.requestGuide, replayGuide: controller.replayGuide,
    recordGuideEvent: controller.recordGuideEvent, updateGuideContext, interruptGuidance,
    triggerMilestone, triggerMapIntroFromTab: () => Promise.resolve(false),
    registerTarget: controller.registerTarget, unregisterTarget: controller.unregisterTarget,
    notifyInteraction: () => false, nextStep: controller.complete, prevStep: () => false,
    skip: controller.dismiss, dismiss: controller.dismiss, dismissCoachMark: controller.interrupt,
    resetTips: controller.resetTips, isTourShortcutActive: () => false, setTutorialTransition: () => false,
    startPractice: beginPractice, dispatchPractice: dispatchPractice, endPractice: endPractice,
  }), [controller, updateGuideContext, interruptGuidance, triggerMilestone, beginPractice, dispatchPractice, endPractice]);
  const status = useMemo(() => ({ guideVersion2: true, guideError: frame.error, activeMilestone: frame.active?.guide.id || null, isDriving, mapIntroPending: false, mapIntroAwaitingTap: false, walkthroughActive: false, tutorialTransitioning: false, pendingTourDestination: null, practiceSession: practiceSession, workspace: profile?.driverType === 'Cargo' ? 'cargo' : profile?.driverType === 'Passenger' ? 'passenger' : 'unclassified' }), [frame.active, frame.error, isDriving, practiceSession, profile?.driverType]);
  const state = useMemo(() => ({ currentStepIndex: frame.active?.stepIndex || 0, currentStep: frame.active?.step || null, stepContext: frame.active?.context, activeTargetLayout: frame.target, activePresentationId: frame.presentationId, currentRoute: route }), [frame, route]);
  const { Actions, Status, State } = contexts;
  return <Actions.Provider value={actions}><Status.Provider value={status}><State.Provider value={state}>
    <View style={{ flex: 1 }} pointerEvents="box-none">
      {children}
      {frame.active && (!frame.active.step.targetId || frame.target) ? <CoachMarkOverlay milestone={{ ...frame.active.guide, key: frame.active.guide.id }} step={frame.active.step} stepContext={frame.active.context} targetLayout={frame.target} totalSteps={frame.active.guide.steps.length} onNext={controller.complete} onSkip={controller.dismiss} onDismiss={controller.dismiss} /> : null}
    </View>
  </State.Provider></Status.Provider></Actions.Provider>;
}
