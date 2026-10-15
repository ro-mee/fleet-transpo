import { describe, expect, it } from 'vitest';
import { parseTripDeepLink, resolveTripReturnRoute } from './trip-deep-link';

describe('bubble return link', () => {
  it('parses the encoded app return identity', () => {
    expect(parseTripDeepLink('fleetops:///redirect-trip?tripId=%37%30%31')).toEqual({ tripId: '701' });
  });
  it.each(['fleetops:///redirect-trip', 'fleetops:///redirect-trip?tripId=', 'fleetops:///redirect-trip?tripId=1&tripId=2', 'fleetops:///redirect-trip?tripId=%', 'fleetops:///redirect-trip?tripId=../1', 'fleetops:///redirect-trip?tripId=0', 'fleetops://evil/redirect-trip?tripId=701', 'https://example.com/redirect-trip?tripId=701', 'fleetops:///trip/701', null])('rejects an unsafe or missing link %s', url => {
    expect(parseTripDeepLink(url)).toBeNull();
  });
  it.each(['701', '702', null])('returns only to Map regardless of the server assignment %s', activeTripId => {
    expect(resolveTripReturnRoute({ requestedId: '701', activeTripId })).toBe('/(app)/(tabs)/map');
  });
});
