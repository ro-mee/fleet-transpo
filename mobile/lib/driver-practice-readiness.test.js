import { describe, expect, it, vi } from 'vitest';
import { loadPracticeReadiness } from './driver-practice-readiness';
const setup = () => ({ actorId: '4', isCurrent: () => true, now: () => 1000, getItem: vi.fn(async () => null), read: vi.fn(async () => []) });
describe('read-only practice readiness', () => {
  it('checks real owned work and strict queues without mutating or draining them', async () => {
    const io = setup(); expect(await loadPracticeReadiness(io)).toMatchObject({ available: true, hasAssignment: false, hasPendingSubmission: false, emergency: false, responderWork: false, checkedAt: 1000 });
    expect(io.read.mock.calls.map(([p]) => p)).toEqual(['/api/mobile/driver/trips', '/api/mobile/driver/submissions', '/api/driver/incidents?role=responder']);
    for (const [, options] of io.read.mock.calls) expect(options).toMatchObject({ queueOnFailure: false, skipQueueDrain: true, cargoActorId: '4' });
  });
  it('refuses missing, malformed, unavailable or account-changed information', async () => {
    for (const patch of [{ actorId: null }, { isCurrent: () => false }, { getItem: async () => '{' }, { read: async () => ({ error: 'unavailable' }) }, { read: async () => { throw new Error('offline'); } }]) expect((await loadPracticeReadiness({ ...setup(), ...patch })).available).toBe(false);
  });
  it('blocks real queued work before requesting any live endpoint', async () => {
    const io = setup(); io.getItem.mockResolvedValueOnce(JSON.stringify([{ method: 'POST', path: '/api/driver/incidents' }]));
    expect(await loadPracticeReadiness(io)).toMatchObject({ available: true, hasPendingSubmission: true });
    expect(io.read).not.toHaveBeenCalled();
  });
  it('recognizes an assigned trip, an unresolved incident and responder work', async () => {
    const io = setup();
    io.read.mockImplementation(async p => p.includes('trips') ? [{ trip_status: 'Driver Accepted' }] : p.includes('submissions') ? [{ category: 'Incident', status: 'Open' }] : [{ status: 'Open' }]);
    expect(await loadPracticeReadiness(io)).toMatchObject({ available: true, hasAssignment: true, emergency: true, responderWork: true });
  });
});
