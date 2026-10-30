import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
const source = readFileSync('mobile/app/(app)/(tabs)/map.js', 'utf8');
const code = source.slice(source.indexOf('function getOperationalRadarMarkers'), source.indexOf('export const MAP_EMPTY_STATES'));
const build = trips => runInNewContext(`${code};getOperationalRadarMarkers({lat:14.6,lng:121},trips,'Passenger')`, { trips, DEMO_ENTITY_MODE: false, haversineKm: () => 1, resolveDriverWorkspace: () => ({ tripReady: true }), isCargoLoad: () => false });
it('never assigns a made-up road ETA to a real pending assignment', () => {
  const [marker] = build([{ trip_id: 7, origin_latitude: 14.61, origin_longitude: 121.01 }]);
  expect(marker.distanceKm).toBe(1); expect(marker.etaMinutes).toBeUndefined();
});
it('does not place unresolved or out-of-range pickup coordinates on the map', () => {
  expect(build([{ trip_id: 7 }, { trip_id: 8, origin_latitude: 100, origin_longitude: 121 }, { trip_id: 9, origin_latitude: '', origin_longitude: '' }, { trip_id: 10, origin_latitude: 14.6, origin_longitude: 121, pickup_location_provenance: 'pending_review' }])).toHaveLength(0);
});
