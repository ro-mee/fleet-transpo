import { it, expect } from 'vitest';
import { isReturnCandidate, rankReturnMatches } from './dispatch-return.service';

it('excludes same/assigned/cancelled/out-of-window/capacity-mismatched candidates', () => {
  const base = { request_id: 2, fleet_status: 'Pending', vehicle_id: null, driver_id: null, pickup_datetime: '2026-09-16T12:00:00+08:00', passenger_count: 2 };
  const ctx = { outboundId: 1, releaseAt: +new Date('2026-09-16T10:00:00+08:00'), windowEnd: +new Date('2026-09-16T14:00:00+08:00'), vehicleCapacity: 4 };
  expect(isReturnCandidate({ ...base, request_id: 1 }, ctx)).toBe(false);
  expect(isReturnCandidate({ ...base, fleet_status: 'Cancelled' }, ctx)).toBe(false);
  expect(isReturnCandidate({ ...base, vehicle_id: 9 }, ctx)).toBe(false);
  expect(isReturnCandidate({ ...base, pickup_datetime: '2026-09-16T09:00:00+08:00' }, ctx)).toBe(false);
  expect(isReturnCandidate({ ...base, pickup_datetime: '2026-09-16T15:00:00+08:00' }, ctx)).toBe(false);
  expect(isReturnCandidate({ ...base, passenger_count: 9 }, ctx)).toBe(false);
  expect(isReturnCandidate(base, ctx)).toBe(true);
  // Cross-midnight pickup inside the window is included.
  expect(isReturnCandidate({ ...base, pickup_datetime: '2026-09-17T01:00:00+08:00' }, { ...ctx, windowEnd: +new Date('2026-09-17T02:00:00+08:00') })).toBe(true);
});

it('ranks reliability first, never letting efficiency override feasibility', () => {
  const ranked = rankReturnMatches([
    { requestId: 3, feasibility: 'TIGHT', transferMinutes: 5, pickupAt: 3 },
    { requestId: 2, feasibility: 'SAFE', transferMinutes: 25, pickupAt: 2 },
    { requestId: 4, feasibility: 'INFEASIBLE', transferMinutes: 1, pickupAt: 1 },
  ]);
  expect(ranked.map(r => r.requestId)).toEqual([2, 3, 4]);
});
