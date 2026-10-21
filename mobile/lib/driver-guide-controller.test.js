import { describe, expect, it, vi } from 'vitest';
import { createDriverGuideController } from './driver-guide-controller';
const make = () => {
  let time = 100000;
  let context = { actorId: '17', workspace: 'cargo', actorConfirmed: true, contextValid: true, foreground: true, emergency: false, responderWork: false, route: '/', motion: { speedMs: 0, observedAt: 99900, movingHold: false } };
  const storage = { read: vi.fn(async () => ({ available: true, record: null })), legacy: vi.fn(async () => ({})), write: vi.fn(async () => true), reset: vi.fn(async () => true) };
  const onChange = vi.fn();
  const controller = createDriverGuideController({ getContext: () => context, storage, onChange, now: () => time });
  return { controller, storage, onChange, patch: p => { context = { ...context, ...p }; controller.reconcile(); }, clock: n => { time = n; controller.reconcile(); } };
};
describe('independent guide orchestration', () => {
  it('Welcome completion neither chains tutorials nor navigates', async () => {
    const h = make(); expect(await h.controller.requestGuide({ guideId: 'welcome', variant: 'common' })).toBe(true);
    await h.controller.complete(); expect(h.controller.getState().active).toBeNull();
    expect(h.storage.write.mock.calls.at(-1)[1].status).toBe('completed');
    expect(await h.controller.requestGuide({ guideId: 'welcome', variant: 'common' })).toBe(false);
  });
  it('requires a real target and fresh measurements after claiming its guide', async () => {
    const h = make(); expect(await h.controller.requestGuide({ guideId: 'duty.start', variant: 'common' })).toBe(false);
    h.controller.registerTarget('home.preshift_start', { x: 10, y: 100, width: 100, height: 44 }, '/', Symbol('target'));
    expect(await h.controller.requestGuide({ guideId: 'duty.start', variant: 'common' })).toBe(true);
    expect(h.controller.getState().target).toBeNull();
    const gen = h.controller.getState().presentationId;
    h.controller.registerTarget('home.preshift_start', { x: 10, y: 100, width: 100, height: 44, presentationId: gen }, '/', Symbol('active'));
    expect(h.controller.getState().target.width).toBe(100);
  });
  it('rechecks movement, identity and route after storage awaits', async () => {
    for (const patch of [{ actorId: '18' }, { route: '/map' }, { motion: { speedMs: 2, observedAt: 99999 } }]) {
      const h = make(); let release;
      h.storage.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const pending = h.controller.requestGuide({ guideId: 'welcome', variant: 'common' });
      h.patch(patch); release({ available: true, record: null });
      expect(await pending).toBe(false); expect(h.controller.getState().active).toBeNull();
    }
  });
  it('allows one owner and cancels without false completion on interruption', async () => {
    const h = make(); await h.controller.requestGuide({ guideId: 'welcome', variant: 'common' });
    expect(await h.controller.requestGuide({ guideId: 'sos', variant: 'common', source: 'manual' })).toBe(false);
    h.patch({ foreground: false }); expect(h.controller.getState().active).toBeNull();
    expect(h.storage.write.mock.calls.some(([, r]) => r.status === 'completed')).toBe(false);
  });
  it('preserves dismissed replay outcomes until an explicit new outcome', async () => {
    const h = make(); h.storage.read.mockResolvedValue({ available: true, record: { status: 'dismissed', source: 'guide', updatedAt: 1 } });
    expect(await h.controller.requestGuide({ guideId: 'welcome', variant: 'common' })).toBe(false);
    expect(await h.controller.replayGuide({ guideId: 'welcome', variant: 'common' })).toBe(true);
    h.controller.interrupt(); expect(h.storage.write).not.toHaveBeenCalled();
  });
  it('does not advance from failed, unrelated or stale interaction events', async () => {
    const h = make(); await h.controller.replayGuide({ guideId: 'cargo.departure', variant: 'cargo' });
    const before = h.controller.getState().active;
    h.controller.recordGuideEvent({ sessionId: 'wrong', type: 'submit', outcome: { success: true } });
    expect(h.controller.getState().active).toBe(before);
  });
  it('keeps target ownership scoped to mounted instances', () => {
    const h = make(); const a = Symbol('a'), b = Symbol('b');
    h.controller.registerTarget('t', { x: 10, y: 100, width: 100, height: 44 }, '/', a);
    h.controller.registerTarget('t', { x: 20, y: 100, width: 100, height: 44 }, '/', b);
    h.controller.unregisterTarget('t', a); expect(h.controller.hasTarget('t', '/')).toBe(true);
    h.controller.unregisterTarget('t', b); expect(h.controller.hasTarget('t', '/')).toBe(false);
  });
  it('reports reset/write failure instead of success and does not reset another driver', async () => {
    const h = make(); await h.controller.replayGuide({ guideId: 'welcome', variant: 'common' });
    h.storage.write.mockResolvedValue(false); expect(await h.controller.dismiss()).toBe(false);
    expect(h.controller.getState().error).toContain('save');
    h.storage.reset.mockResolvedValue(false); expect(await h.controller.resetTips()).toBe(false);
    expect(h.storage.reset).toHaveBeenCalledWith('17');
  });
});
