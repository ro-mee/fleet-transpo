import { describe, expect, it } from 'vitest';
import { getGpsHealth, GPS_FRESH_MS, GPS_DELAYED_MS } from '@/lib/gps';
import { DEFAULT_DISPATCH_POLICY } from '@/lib/dispatch-policy';
import { requestLocationContext, qualifiedGps, resolveLocationRelevance, MAX_GPS_ACCURACY_M, MAX_CLOCK_SKEW_MS } from './location-relevance';
import { dispatchDecision, evidenceExpired } from './decision';
import { conversationEvidence, evidenceSummary } from './conversation';
import { makePair, immediatePair, repositioningPair, makeRequest, makeRecommendation } from './fleetmate-fixtures';

// Groups H (temporal reasoning) and I (GPS relevance) of the FleetMate scenario
// matrix.
//
// Scope note: these drive the deterministic temporal/GPS qualification
// (location-relevance.js) and the projection FleetMate narrates, then assert the
// evidence-only answer's honesty about what is and is not live. Model prose is
// not asserted here.

const NOW = new Date('2026-09-17T02:00:00.000Z'); // 10:00 Asia/Manila, 2026-09-17
const at = minutes => new Date(NOW.getTime() + minutes * 60_000).toISOString();
// A fix observed 30 SECONDS ago — inside GPS_FRESH_MS (90s), so a default fix
// is qualified. `at()` is in minutes and is only for pickup times.
const freshFix = (over = {}) => ({ latitude: 14.5995, longitude: 120.9842, accuracy: 12, observed_at: new Date(NOW.getTime() - 30_000).toISOString(), ...over });
const project = (pairs, { recommended, noneReasons = [], selectedPair = null } = {}) =>
  conversationEvidence(makeRequest(), makeRecommendation({ candidates: pairs, recommended, noneReasons }), selectedPair);

describe('H. Temporal reasoning', () => {
  const horizon = (minutes, over = {}) =>
    requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(minutes), ...over }, NOW).horizon;

  it('FM-TEMP-001 each horizon band is decided by time-to-pickup and the Manila service date', () => {
    expect(horizon(-10)).toBe('OVERDUE');
    expect(horizon(10)).toBe('LAST_MINUTE');
    expect(horizon(30)).toBe('LAST_MINUTE');   // inclusive upper edge of highMinutes
    expect(horizon(60)).toBe('NEAR_DISPATCH');
    expect(horizon(90)).toBe('NEAR_DISPATCH'); // inclusive upper edge of the short-notice horizon
    expect(horizon(300)).toBe('SAME_DAY');
    expect(horizon(24 * 60)).toBe('FUTURE');
  });

  it('FM-TEMP-002 an unactionable or untimed request is INACTIVE, not a favourable horizon', () => {
    const done = requestLocationContext({ fleet_status: 'Completed', pickup_datetime: at(60) }, NOW);
    expect(done).toMatchObject({ horizon: 'INACTIVE', reasonCode: 'REQUEST_NOT_ACTIONABLE', urgency: 'SCHEDULED' });

    const untimed = requestLocationContext({ fleet_status: 'Pending', pickup_datetime: null }, NOW);
    expect(untimed).toMatchObject({ horizon: 'INACTIVE', reasonCode: 'PICKUP_TIME_UNKNOWN', urgency: 'SCHEDULED' });
    expect(untimed.pickupAt).toBeNull();
  });

  it('FM-TEMP-003 the reason code names why the horizon applies, and never invents a live window', () => {
    expect(requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(300) }, NOW).reasonCode).toBe('FUTURE_PLANNING');
    expect(requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(-10) }, NOW).reasonCode).toBe('OVERDUE_REQUEST');
    expect(requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(10) }, NOW).reasonCode).toBe('PICKUP_WITHIN_HORIZON');
    expect(requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(10) }, NOW).urgency).toBe('SHORT_NOTICE');
    expect(requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(300) }, NOW).urgency).toBe('SCHEDULED');
  });

  it('FM-TEMP-004 the next boundary is in the future while a horizon remains ahead', () => {
    for (const minutes of [10, 60, 300, 1440]) {
      const { nextBoundaryAt } = requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(minutes) }, NOW);
      expect(nextBoundaryAt).not.toBeNull();
      expect(+new Date(nextBoundaryAt)).toBeGreaterThan(NOW.getTime());
    }
    // An already-overdue request has no horizon left to expire against. The
    // contract reports that as null rather than inventing a boundary, so an
    // overdue pair carries no temporal expiry (evidenceExpired skips nulls).
    const overdue = { ...makePair(), temporalContext: requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(-10) }, NOW) };
    expect(overdue.temporalContext.nextBoundaryAt).toBeNull();
    expect(evidenceExpired(overdue, NOW.getTime())).toBe(false);
  });

  it('FM-TEMP-005 a FUTURE, SAME_DAY or REPOSITION evaluation never uses live location', () => {
    const future = resolveLocationRelevance({ request: { fleet_status: 'Pending', pickup_datetime: at(300) }, now: NOW, readyNow: true, fix: freshFix() });
    expect(future).toMatchObject({ mode: 'SCHEDULED', liveLocationAllowed: false, liveLocationUsed: false, originType: 'NONE', reasonCode: 'FUTURE_PLANNING' });
    expect(future).not.toHaveProperty('gpsHealth');

    const repo = resolveLocationRelevance({
      request: { fleet_status: 'Pending', pickup_datetime: at(10) }, now: NOW, readyNow: true, fix: freshFix(),
      preceding: { dispatch_id: 412, origin: 'Anito Lodge', label: 'Previous drop-off', availableAt: at(-5) },
    });
    expect(repo).toMatchObject({ mode: 'REPOSITION', liveLocationAllowed: false, liveLocationUsed: false, originType: 'PREVIOUS_TRIP_DESTINATION', reasonCode: 'PRECEDING_COMMITMENT' });
    expect(repo).not.toHaveProperty('gpsHealth');

    const untimed = resolveLocationRelevance({ request: { fleet_status: 'Pending', pickup_datetime: null }, now: NOW, readyNow: true, fix: freshFix() });
    expect(untimed).toMatchObject({ mode: 'SCHEDULED', reasonCode: 'PICKUP_TIME_UNKNOWN', liveLocationUsed: false });
  });

  it('FM-TEMP-006 an immediate window without verified standby records that as the reason', () => {
    const ctx = resolveLocationRelevance({ request: { fleet_status: 'Pending', pickup_datetime: at(10) }, now: NOW, readyNow: false, fix: freshFix() });
    expect(ctx).toMatchObject({ mode: 'IMMEDIATE', liveLocationAllowed: false, liveLocationUsed: false, reasonCode: 'STANDBY_NOT_VERIFIED', originType: 'NONE' });
    // No qualified fix was consumed, so no expiry may be minted.
    expect(ctx.evidenceExpiresAt).toBeNull();
  });

  it('FM-TEMP-007 a past boundary expires the pair, downgrading it out of a confirmable state', () => {
    const pair = immediatePair({ proximityExpiresAt: at(-60) });
    expect(evidenceExpired(pair, NOW.getTime())).toBe(true);
    const decision = dispatchDecision(pair, { now: NOW.getTime() });
    expect(decision.stale).toBe(true);
    expect(decision.state).toBe('INSUFFICIENT_DATA');
    expect(decision.canConfirm).toBe(false);
    expect(decision.canReview).toBe(false);
  });

  it('FM-TEMP-008 a stale evaluation is not narrated as ready, and future answers are labelled schedule-based', () => {
    const pair = immediatePair({ proximityExpiresAt: at(-60) });
    const stale = project([pair]);
    const staleAnswer = evidenceSummary(stale, 'Is this ready?');
    expect(staleAnswer).toContain('some required evidence is unverified');
    expect(staleAnswer).not.toContain('the recorded checks passed');

    const future = project([makePair()]);
    // A comparison question on a FUTURE evaluation is prefixed so the answer is
    // never mistaken for a live read.
    expect(evidenceSummary(future, 'Why is this better?')).toContain('Based on the current schedule.');
  });

  it('FM-TEMP-009 an unexpired future boundary leaves the pair confirmable', () => {
    const pair = makePair();
    expect(evidenceExpired(pair, NOW.getTime())).toBe(false);
    expect(dispatchDecision(pair, { now: NOW.getTime() }).state).toBe('ALL_CLEAR');
  });
});

describe('I. GPS relevance and recovery', () => {
  it('FM-GPS-001 the four health labels are decided by fix age, and no timestamp is "No signal"', () => {
    const now = NOW.getTime();
    expect(getGpsHealth(at(0), now).label).toBe('Fresh');
    expect(getGpsHealth(new Date(now - GPS_FRESH_MS).toISOString(), now).label).toBe('Fresh');
    expect(getGpsHealth(new Date(now - GPS_FRESH_MS - 1).toISOString(), now).label).toBe('Delayed');
    expect(getGpsHealth(new Date(now - GPS_DELAYED_MS).toISOString(), now).label).toBe('Delayed');
    expect(getGpsHealth(new Date(now - GPS_DELAYED_MS - 1).toISOString(), now).label).toBe('Offline');
    expect(getGpsHealth(null, now).label).toBe('No signal');
    expect(getGpsHealth(undefined, now).key).toBe('no-signal');
  });

  it('FM-GPS-002 only a fresh, accurate, in-range fix is qualified, and it mints its own expiry', () => {
    const fix = freshFix();
    const qualified = qualifiedGps(fix, NOW);
    expect(qualified).toMatchObject({ eligible: true, gpsHealth: 'Fresh' });
    expect(+new Date(qualified.expiresAt)).toBe(+new Date(fix.observed_at) + GPS_FRESH_MS);
  });

  it('FM-GPS-003 a Delayed or Offline fix is never qualified, however accurate it is', () => {
    expect(qualifiedGps(freshFix({ observed_at: new Date(NOW.getTime() - GPS_FRESH_MS - 1).toISOString() }), NOW))
      .toMatchObject({ eligible: false, gpsHealth: 'Delayed', expiresAt: null });
    expect(qualifiedGps(freshFix({ observed_at: new Date(NOW.getTime() - GPS_DELAYED_MS - 1).toISOString() }), NOW))
      .toMatchObject({ eligible: false, gpsHealth: 'Offline', expiresAt: null });
  });

  it('FM-GPS-004 an imprecise, missing or malformed fix is not qualified', () => {
    expect(qualifiedGps(freshFix({ accuracy: MAX_GPS_ACCURACY_M + 1 }), NOW).eligible).toBe(false);
    expect(qualifiedGps(freshFix({ accuracy: MAX_GPS_ACCURACY_M }), NOW).eligible).toBe(true); // inclusive edge
    expect(qualifiedGps(freshFix({ accuracy: 0 }), NOW).eligible).toBe(false);
    expect(qualifiedGps(freshFix({ accuracy: null }), NOW).eligible).toBe(false);
    expect(qualifiedGps(freshFix({ accuracy: '' }), NOW).eligible).toBe(false);
    expect(qualifiedGps(freshFix({ latitude: null }), NOW).eligible).toBe(false);
    expect(qualifiedGps(freshFix({ latitude: 999 }), NOW).eligible).toBe(false);
  });

  it('FM-GPS-005 a fix dated beyond the allowed clock skew is not qualified', () => {
    const future = new Date(NOW.getTime() + MAX_CLOCK_SKEW_MS + 1).toISOString();
    // Fresh by age (negative age clamps to 0) but not trustworthy as "now".
    expect(qualifiedGps(freshFix({ observed_at: future }), NOW)).toMatchObject({ eligible: false, gpsHealth: 'Fresh' });
    const withinSkew = new Date(NOW.getTime() + MAX_CLOCK_SKEW_MS).toISOString();
    expect(qualifiedGps(freshFix({ observed_at: withinSkew }), NOW).eligible).toBe(true);
  });

  it('FM-GPS-006 an immediate window with a qualified fix records live use, its origin and its expiry', () => {
    const ctx = resolveLocationRelevance({ request: { fleet_status: 'Pending', pickup_datetime: at(10) }, now: NOW, readyNow: true, fix: freshFix() });
    expect(ctx).toMatchObject({
      mode: 'IMMEDIATE', liveLocationAllowed: true, liveLocationUsed: true,
      originType: 'CURRENT_GPS', reasonCode: 'PICKUP_WITHIN_HORIZON', gpsHealth: 'Fresh',
    });
    expect(+new Date(ctx.evidenceExpiresAt)).toBeGreaterThan(NOW.getTime());
  });

  it('FM-GPS-007 an immediate window with an unqualified fix names GPS qualification, not the driver', () => {
    const stale = resolveLocationRelevance({ request: { fleet_status: 'Pending', pickup_datetime: at(10) }, now: NOW, readyNow: true, fix: freshFix({ observed_at: new Date(NOW.getTime() - GPS_DELAYED_MS - 1).toISOString() }) });
    expect(stale).toMatchObject({ mode: 'IMMEDIATE', liveLocationAllowed: true, liveLocationUsed: false, originType: 'NONE', reasonCode: 'GPS_NOT_QUALIFIED', gpsHealth: 'Offline' });
    expect(stale.evidenceExpiresAt).toBeNull();
  });

  it('FM-GPS-008 gpsHealth reaches the projection label-only, and its absence is not missing evidence', () => {
    const evidence = project([immediatePair({ gpsHealth: 'Delayed' }), makePair({ vehicle_id: 2, driver_id: 2 })]);
    const live = evidence.pairs.find(p => p.vehicleId === 1);
    const future = evidence.pairs.find(p => p.vehicleId === 2);
    expect(live.gpsHealth).toBe('Delayed');
    expect(future).not.toHaveProperty('gpsHealth');
    // Absence on a FUTURE evaluation must not degrade the pair's own verdict.
    expect(future.state).toBe('ALL_CLEAR');
    // Labels only — never a raw fix.
    expect(JSON.stringify(evidence)).not.toMatch(/latitude|longitude|accuracy|standby_/);
  });

  it('FM-GPS-009 a Fresh label never restores an expired live ETA, and the pair drops to unverified', () => {
    const pair = immediatePair({ gpsHealth: 'Fresh', proximityExpiresAt: at(-60) });
    const evidence = project([pair]);
    expect(evidence.pairs[0].gpsHealth).toBe('Fresh');
    expect(evidence.pairs[0].livePickupEta).toBeNull();
    expect(evidence.pairs[0].state).toBe('INSUFFICIENT_DATA');
    expect(pair.dispatchContext.liveLocationUsed).toBe(true);
    // Health says the fix was readable; expiry says the estimate is no longer usable.
    expect(evidenceSummary(evidence, 'What is the ETA?')).toContain('live pickup ETA is unavailable');
  });

  it('FM-GPS-010 a live ETA is reported as live, and a predicted transfer is never called one', () => {
    const live = project([immediatePair({ etaMinutes: 12 })]);
    expect(live.pairs[0].livePickupEta).toMatchObject({ etaMinutes: 12 });
    expect(live.pairs[0].travelToPickupMinutes).toBe(12);
    expect(evidenceSummary(live, 'What is the ETA?')).toContain('live pickup ETA is 12 minutes');

    const predicted = project([repositioningPair()]);
    expect(predicted.pairs[0].livePickupEta).toBeNull();
    expect(predicted.pairs[0].travelToPickupMinutes).toBe(20);
    expect(evidenceSummary(predicted, 'What is the ETA?')).toContain('this is not a live ETA');
    expect(evidenceSummary(predicted, 'What is the ETA?')).not.toContain('live pickup ETA is 20');
  });

  it('FM-GPS-011 the short-notice horizon that gates live evidence matches the configured policy', () => {
    const boundary = DEFAULT_DISPATCH_POLICY.shortNoticeHorizonMinutes;
    expect(requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(boundary) }, NOW).reasonCode).toBe('PICKUP_WITHIN_HORIZON');
    expect(requestLocationContext({ fleet_status: 'Pending', pickup_datetime: at(boundary + 1) }, NOW).reasonCode).toBe('FUTURE_PLANNING');
  });
});
