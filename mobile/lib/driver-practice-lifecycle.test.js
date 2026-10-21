import { describe, expect, it, vi } from 'vitest';
import { nativeRender } from './test-helpers/native-render';
import * as practice from './driver-practice';
import * as policy from './driver-guide-policy';

describe('actual practice lifecycle hook', () => {
  it('ends rather than resumes after movement, assignment, background or session changes', async () => {
    for (const patch of [{ foreground: false }, { hasAssignment: true }, { emergency: true }, { sessionGeneration: 2 }, { actorId: '18' }, { motion: { speedMs: 2, observedAt: 99999 } }]) {
      let context = { now: 100000, actorId: '17', sessionGeneration: 1, actorConfirmed: true, workspace: 'cargo', contextValid: true, route: '/profile/help', foreground: true, emergency: false, responderWork: false, hasAssignment: false, hasPendingSubmission: false, motion: { speedMs: 0, observedAt: 99999, movingHold: false } };
      let tick;
      const h = await nativeRender(new URL('./use-driver-practice.js', import.meta.url), { name: 'useDriverPractice', props: { getContext: () => context, now: () => 100000 }, deps: { './driver-practice': practice, './driver-guide-policy': policy }, globals: { setInterval: callback => { tick = callback; return 1; }, clearInterval: vi.fn() } });
      await h.flushEffects();
      expect(h.result.startPractice({ topic: 'fuel.receipt', variant: 'cargo', parkedConfirmed: true })).toMatchObject({ allowed: true });
      h.render(); expect(h.result.practiceSession).not.toBeNull();
      context = { ...context, ...patch }; tick(); h.render();
      expect(h.result.practiceSession).toBeNull(); h.unmount();
    }
  });
  it('does not create a capability from a topic or route without parked confirmation', async () => {
    const h = await nativeRender(new URL('./use-driver-practice.js', import.meta.url), { name: 'useDriverPractice', props: { getContext: () => ({ actorId: '17', foreground: true, emergency: false, responderWork: false, actorConfirmed: true, workspace: 'cargo', contextValid: true, hasAssignment: false, hasPendingSubmission: false }), now: () => 100000 }, deps: { './driver-practice': practice, './driver-guide-policy': policy } });
    expect(h.result.startPractice({ topic: 'fuel.receipt', variant: 'cargo' }).allowed).toBe(false);
    h.render(); expect(h.result.practiceSession).toBeNull();
  });
});
