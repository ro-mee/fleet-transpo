import { describe, expect, it } from 'vitest';
import { observationIsFresh, localGpsState } from './map-freshness';

describe('observation age for guidance', () => {
  const now = Date.parse('2026-10-21T04:00:00Z');
  it.each([null, undefined, '', 'invalid', now + 31000, now - 90001])('refuses absent, invalid, future or expired evidence: %s', at => {
    expect(observationIsFresh(at, now, 90000)).toBe(false);
  });
  it('uses capture time rather than a later network response time', () => {
    expect(observationIsFresh('2026-10-21T03:58:00Z', now, 90000)).toBe(false);
    expect(observationIsFresh('2026-10-21T03:59:59Z', now, 90000)).toBe(true);
  });
  it('expires route ETA independently after five minutes', () => {
    expect(observationIsFresh(now - 300001, now, 300000)).toBe(false);
    expect(observationIsFresh(now - 240000, now, 300000)).toBe(true);
  });
  it('distinguishes current, delayed, lost and explicit watcher failure', () => {
    expect(localGpsState(now - 1500, null, now)).toBe('fresh');
    expect(localGpsState(now - 45000, null, now)).toBe('delayed');
    expect(localGpsState(now - 91000, null, now)).toBe('lost');
    expect(localGpsState(now - 1500, 'Permission revoked', now)).toBe('lost');
    expect(localGpsState(null, null, now)).toBe('lost');
  });
});
