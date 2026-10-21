import { beforeEach, describe, expect, it, vi } from 'vitest';
const { data, storage } = vi.hoisted(() => {
  const data = new Map();
  return { data, storage: { getItem: vi.fn(async key => data.get(key) ?? null), setItem: vi.fn(async (key, value) => { data.set(key, value); }), removeItem: vi.fn(async key => { data.delete(key); }), multiRemove: vi.fn(async keys => keys.forEach(key => data.delete(key))) } };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
import { readGuideProgress, writeGuideProgress, resetGuideProgress, resetDriverGuideProgress } from './coach-mark-storage';
import { guideProgressKey } from './driver-guide-progress';
const scope = { actorId: '17', guideId: 'welcome', variant: 'common', version: 1 };
beforeEach(() => { data.clear(); vi.clearAllMocks(); });
describe('scoped guidance persistence', () => {
  it('reads honest missing state and saves only guidance records', async () => {
    expect(await readGuideProgress(scope)).toEqual({ available: true, record: null });
    expect(await writeGuideProgress(scope, { status: 'dismissed', source: 'guide', updatedAt: 10 })).toBe(true);
    expect((await readGuideProgress(scope)).record.status).toBe('dismissed');
    expect(await writeGuideProgress(scope, { status: 'completed', source: 'guide', updatedAt: 20, trip: { id: 9 } })).toBe(false);
    expect((await readGuideProgress(scope)).record.status).toBe('dismissed');
  });
  it('serializes writes and never replaces an explicit outcome with seen', async () => {
    await Promise.all([writeGuideProgress(scope, { status: 'completed', source: 'guide', updatedAt: 10 }), writeGuideProgress(scope, { status: 'seen', source: 'guide', updatedAt: 11 })]);
    expect((await readGuideProgress(scope)).record.status).toBe('completed');
  });
  it('fences expired sessions before writes and reports persistence errors', async () => {
    expect(await writeGuideProgress({ ...scope, isCurrent: () => false }, { status: 'seen', source: 'guide', updatedAt: 10 })).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    storage.getItem.mockRejectedValueOnce(new Error('disk unavailable'));
    expect(await readGuideProgress(scope)).toEqual({ available: false, record: null });
    storage.removeItem.mockRejectedValueOnce(new Error('disk unavailable'));
    expect(await resetGuideProgress(scope)).toBe(false);
  });
  it('resets only this driver and leaves business storage and other drivers alone', async () => {
    data.set(guideProgressKey(scope), 'record'); data.set(guideProgressKey({ ...scope, actorId: '18' }), 'other'); data.set('@cargo_form:17:9:PICKUP', 'real count');
    expect(await resetDriverGuideProgress('17')).toBe(true);
    expect(data.has(guideProgressKey(scope))).toBe(false);
    expect(data.get(guideProgressKey({ ...scope, actorId: '18' }))).toBe('other');
    expect(data.get('@cargo_form:17:9:PICKUP')).toBe('real count');
  });
});
