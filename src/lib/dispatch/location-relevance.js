import { GPS_FRESH_MS, getGpsHealth, isValidCoordinate } from '@/lib/gps';
import { DEFAULT_DISPATCH_POLICY } from '@/lib/dispatch-policy';
import { manilaDate } from './plan-window';

export const LOCATION_POLICY_VERSION = 'temporal-v2';
export const MAX_GPS_ACCURACY_M = 100;
export const MAX_CLOCK_SKEW_MS = 30_000;
const PRIVATE_STANDBY_FIELDS = new Set(['standby_latitude','standby_longitude','standby_session_family','standby_tracking_enabled',
  'location_observed_at','location_received_at','location_accuracy_m','location_source','location_vehicle_id']);
// Generic driver/dispatch/expense responses may embed d.*. Exact radar pins have
// their own scoped, explicitly shaped response; never disclose storage rows here.
export const omitStandbyStorage = (key,value) => PRIVATE_STANDBY_FIELDS.has(key) ? undefined : value;

export function requestLocationContext(request, now = new Date(), trustedDeparture = null, policy = DEFAULT_DISPATCH_POLICY) {
  const pickup = request?.pickup_datetime ? new Date(request.pickup_datetime).getTime() : NaN;
  const clock = new Date(now).getTime();
  const horizonMinutes = policy.shortNoticeHorizonMinutes;
  const actionable = ['Pending', 'Scheduled'].includes(request?.fleet_status ?? request?.status);
  // Only a server-resolved itinerary may supply this separate argument.
  const departure = trustedDeparture?.at ? new Date(trustedDeparture.at).getTime() : NaN;
  const due = trustedDeparture?.source === 'itinerary' && Number.isFinite(departure) && departure >= clock && departure - clock <=
    (policy.departureBufferMinutes + policy.earlyStartAllowanceMinutes) * 60_000;
  const immediate = actionable && Number.isFinite(pickup) && Number.isFinite(clock) &&
    (pickup - clock <= horizonMinutes * 60_000 || due);
  const valid = Number.isFinite(pickup) && Number.isFinite(clock);
  const lastMinute = Math.min(policy.highMinutes, horizonMinutes);
  const horizon = !actionable || !valid ? 'INACTIVE' : pickup < clock ? 'OVERDUE'
    : pickup - clock <= lastMinute * 60_000 ? 'LAST_MINUTE' : immediate ? 'NEAR_DISPATCH'
      : manilaDate(pickup) === manilaDate(clock) ? 'SAME_DAY' : 'FUTURE';
  const boundaries = valid && actionable ? [pickup + 1, pickup - lastMinute * 60_000, pickup - horizonMinutes * 60_000,
    +new Date(manilaDate(pickup) + 'T00:00:00+08:00'),
    ...(Number.isFinite(departure) ? [departure - (policy.departureBufferMinutes + policy.earlyStartAllowanceMinutes) * 60_000] : [])].filter(t => t > clock) : [];
  return {
    horizon, policyVersion: LOCATION_POLICY_VERSION, pickupAt: valid ? new Date(pickup).toISOString() : null,
    serviceDate: valid ? manilaDate(pickup) : null, evaluatedAt: Number.isFinite(clock) ? new Date(clock).toISOString() : null,
    nextBoundaryAt: boundaries.length ? new Date(Math.min(...boundaries)).toISOString() : null,
    urgency: immediate ? 'SHORT_NOTICE' : 'SCHEDULED', horizonMinutes,
    reasonCode: !actionable ? 'REQUEST_NOT_ACTIONABLE' : !Number.isFinite(pickup) ? 'PICKUP_TIME_UNKNOWN' :
      !immediate ? 'FUTURE_PLANNING' : pickup < clock ? 'OVERDUE_REQUEST' : due ? 'PLANNED_DEPARTURE_DUE' : 'PICKUP_WITHIN_HORIZON',
  };
}

export function qualifiedGps(fix, now = new Date()) {
  const observed = fix?.observed_at ? new Date(fix.observed_at).getTime() : NaN;
  const clock = new Date(now).getTime();
  const health = getGpsHealth(fix?.observed_at, clock);
  const accuracy = fix?.accuracy == null || fix.accuracy === '' ? NaN : Number(fix.accuracy);
  const eligible = [fix?.latitude,fix?.longitude,fix?.accuracy].every(value => ['number','string'].includes(typeof value)) && isValidCoordinate(fix?.latitude, fix?.longitude) && health.key === 'fresh' &&
    Number.isFinite(observed) && observed <= clock + MAX_CLOCK_SKEW_MS &&
    Number.isFinite(accuracy) && accuracy > 0 && accuracy <= MAX_GPS_ACCURACY_M;
  return { eligible, gpsHealth: health.label, expiresAt: eligible ? new Date(observed + GPS_FRESH_MS).toISOString() : null };
}

export function resolveLocationRelevance({ request, now = new Date(), preceding = null, readyNow = false, fix = null, policy = DEFAULT_DISPATCH_POLICY, trustedDeparture = null }) {
  const context = requestLocationContext(request, now, trustedDeparture, policy);
  const base = { policyVersion: LOCATION_POLICY_VERSION, liveLocationAllowed: false, liveLocationUsed: false, originType: 'NONE' };
  if (context.reasonCode === 'REQUEST_NOT_ACTIONABLE' || context.reasonCode === 'PICKUP_TIME_UNKNOWN')
    return { ...base, mode: 'SCHEDULED', reasonCode: context.reasonCode };
  if (preceding) return { ...base, mode: 'REPOSITION', originType: preceding.origin ? 'PREVIOUS_TRIP_DESTINATION' : 'NONE', reasonCode: preceding.origin ? 'PRECEDING_COMMITMENT' : 'PRECEDING_ORIGIN_UNKNOWN', originLabel: preceding.label ?? null, previousDispatchId: preceding.dispatch_id, availableAt: preceding.availableAt ?? null };
  if (context.urgency === 'SCHEDULED') return { ...base, mode: 'SCHEDULED', reasonCode: context.reasonCode };
  const gps = qualifiedGps(fix, now);
  return { ...base, mode: 'IMMEDIATE', liveLocationAllowed: readyNow, liveLocationUsed: readyNow && gps.eligible,
    originType: readyNow && gps.eligible ? 'CURRENT_GPS' : 'NONE',
    reasonCode: !readyNow ? 'STANDBY_NOT_VERIFIED' : !gps.eligible ? 'GPS_NOT_QUALIFIED' : context.reasonCode,
    gpsHealth: gps.gpsHealth, evidenceExpiresAt: readyNow ? gps.expiresAt : null };
}
