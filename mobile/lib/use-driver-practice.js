import { useCallback, useEffect, useRef, useState } from 'react';
import { createPracticeSession, reducePractice } from './driver-practice';
import { evaluateGuideEligibility } from './driver-guide-policy';

export function useDriverPractice({ getContext, now = Date.now }) {
  const [practiceSession, setPracticeSession] = useState(null);
  const owner = useRef(null), epoch = useRef(0), enteredHost = useRef(false);
  const endPractice = useCallback(() => { epoch.current++; owner.current = null; enteredHost.current = false; setPracticeSession(null); }, []);
  const isValid = useCallback(session => {
    const context = getContext();
    if (context.route === '/profile/guide-practice') enteredHost.current = true;
    return session.actorId === String(context.actorId) && session.sessionGeneration === context.sessionGeneration &&
      (!enteredHost.current || context.route === '/profile/guide-practice') &&
      now() < session.expiresAt && evaluateGuideEligibility({ ...context, kind: 'practice', now: now(), parkedConfirmed: true, knownMotionAtEntry: session.knownMotionAtEntry }).allowed;
  }, [getContext, now]);
  const startPractice = useCallback(({ topic, variant, parkedConfirmed = false } = {}) => {
    const context = getContext();
    if (variant !== context.workspace) return { allowed: false, reason: 'workspace_mismatch' };
    const eligibility = evaluateGuideEligibility({ ...context, kind: 'practice', now: now(), parkedConfirmed });
    if (!eligibility.allowed || owner.current) return { allowed: false, reason: owner.current ? 'practice_active' : eligibility.reason };
    const session = createPracticeSession({ id: `practice-${now()}-${++epoch.current}`, epoch: epoch.current, actorId: context.actorId, topic, variant, now: now(), eligibility });
    if (!session) return { allowed: false, reason: 'practice_unavailable' };
    owner.current = { ...session, sessionGeneration: context.sessionGeneration }; enteredHost.current = false;
    setPracticeSession(owner.current); return { allowed: true };
  }, [getContext, now]);
  const dispatchPractice = useCallback(event => {
    const current = owner.current;
    if (!current || !isValid(current)) { endPractice(); return false; }
    const next = reducePractice(current, event, now());
    owner.current = next; setPracticeSession(next);
    return next !== current && next !== null;
  }, [endPractice, isValid, now]);
  useEffect(() => {
    const timer = setInterval(() => { if (owner.current && !isValid(owner.current)) endPractice(); }, 1000);
    return () => { clearInterval(timer); owner.current = null; };
  }, [endPractice, isValid]);
  return { practiceSession, startPractice, dispatchPractice, endPractice };
}
