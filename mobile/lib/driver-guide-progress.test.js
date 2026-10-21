import { describe, expect, it } from 'vitest';
import { guideProgressKey, nextGuideProgress, importLegacyGuideProgress, isGuideSuppressed } from './driver-guide-progress';

const scope = { actorId: '17', guideId: 'welcome', variant: 'common', version: 1 };
describe('driver guide progress', () => {
  it('isolates actors, workflow variants and content versions', () => {
    const k = guideProgressKey(scope);
    expect(k).toBe('fleetops.guide2.welcome.common.v1_17');
    for (const change of [{ actorId: '18' }, { variant: 'cargo' }, { version: 2 }]) expect(guideProgressKey({ ...scope, ...change })).not.toBe(k);
    for (const actorId of [null, undefined, '', '  ']) expect(() => guideProgressKey({ ...scope, actorId })).toThrow();
    expect(() => guideProgressKey({ ...scope, variant: 'unknown' })).toThrow();
  });
  it('distinguishes seen, dismissed and completed and preserves a prior replay outcome', () => {
    const seen = nextGuideProgress(null, 'seen', 10);
    expect(isGuideSuppressed(seen)).toBe(false);
    const dismissed = nextGuideProgress(seen, 'dismiss', 20);
    expect(dismissed.status).toBe('dismissed'); expect(isGuideSuppressed(dismissed)).toBe(true);
    expect(nextGuideProgress(dismissed, 'seen', 30)).toBe(dismissed);
    expect(nextGuideProgress(dismissed, 'interrupt', 30)).toBe(dismissed);
    expect(nextGuideProgress(seen, 'complete', 40).status).toBe('completed');
    expect(() => nextGuideProgress(null, 'submit-trip', 40)).toThrow();
  });
  it('does not claim mastery from old skip/completion booleans', () => {
    for (const value of ['completed', 'true', true]) expect(importLegacyGuideProgress(scope, { welcome: value }, 10)).toEqual({ status: 'dismissed', source: 'legacy_unknown_outcome', updatedAt: 10 });
    expect(importLegacyGuideProgress(scope, { welcome: false }, 10)).toBeNull();
    expect(importLegacyGuideProgress({ ...scope, guideId: 'cargo.departure', variant: 'cargo' }, { tour_fuel: 'completed' }, 10)).toBeNull();
  });
});
