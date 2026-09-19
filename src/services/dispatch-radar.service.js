import { query } from '@/lib/db';
import { resolveRouteEndpoints } from '@/services/route-resolver.service';
import { GPS_FRESH_MS,isValidCoordinate } from '@/lib/gps';
import { LOCATION_POLICY_VERSION, requestLocationContext, resolveLocationRelevance } from '@/lib/dispatch/location-relevance';
import { standbyState } from '@/services/standby.service';
import { resolveDeadheadMinutes } from '@/services/route-feasibility-context.service';
import { evaluateRouteFeasibility } from '@/lib/scheduling/route-feasibility';
import { detectRequestConflicts } from '@/lib/scheduling/conflicts';
import { loadDriverScheduleContext } from '@/services/driver-schedule.service';
import { driverBlockReason } from '@/lib/scheduling/driver-schedule';
import { buildRouteCacheKey } from '@/lib/routing/route-cache';
import { toCalendarDay } from '@/lib/dates';
import { dispatchDecision } from '@/lib/dispatch/decision';
import { getDispatchPolicy } from '@/services/dispatch-settings.service';
import { rankDispatchPairs } from '@/lib/dispatch/recommendation-ranking';

const unknown = reason => ({ verdict: 'UNKNOWN', reasons: [reason] });
const minutes = value => value == null || value === '' || !Number.isFinite(Number(value)) || Number(value) <= 0 ? null : Number(value);
async function knownLeg(origin,destination) {
  const endpoints = await resolveRouteEndpoints({ query },{ origin,destination });
  const point = row => isValidCoordinate(row?.latitude,row?.longitude) ? { lat:Number(row.latitude),lng:Number(row.longitude) } : null;
  return { origin:point(endpoints?.originLocation),destination:point(endpoints?.destinationLocation) };
}

export function serviceEnd(request, estimate) {
  const pickup = new Date(request?.pickup_datetime).getTime();
  const explicit = request?.scheduled_arrival ? new Date(request.scheduled_arrival).getTime() : NaN;
  const duration = minutes(estimate?.durationMin ?? request?.estimated_duration);
  return Number.isFinite(explicit) && explicit > pickup ? new Date(explicit) :
    Number.isFinite(pickup) && duration != null ? new Date(pickup + duration * 60_000) : null;
}

// Evaluate one already-paired candidate. The same operation is used at assignment.
export async function evaluateDispatchCandidate({ request, vehicleId, driverId, estimate, now = new Date(), includePosition = false, deadline = Date.now()+25_000, routeMemo = new Map(), tentativeCommitments = [], policy: suppliedPolicy, excludeTripId = null }) {
  const policy = suppliedPolicy ?? await getDispatchPolicy();
  const preparationMinutes = Math.max(policy.safetyBufferMinutes,policy.bufferFloorMinutes);
  // Only the owned-trip start route supplies excludeTripId, after its start-window gate.
  if (excludeTripId) request = {...request,fleet_status:'Scheduled'};
  const trustedDeparture = excludeTripId ? {at:now,source:'itinerary'} : null;
  const temporalContext = requestLocationContext(request, now, trustedDeparture, policy);
  const routeExpiries = temporalContext.nextBoundaryAt ? [+new Date(temporalContext.nextBoundaryAt)] : [];
  const routeFor = async (origin,destination,departAt) => {
    if (!origin || !destination) return Promise.resolve({ minutes:null,provenance:'unknown' });
    const key = buildRouteCacheKey(origin,destination,{ departAt });
    if (!routeMemo.has(key)) routeMemo.set(key,resolveDeadheadMinutes(origin,destination,{ departAt,strict:true,deadline }));
    const route = await routeMemo.get(key);
    const computedAt = new Date(route?.computedAt).getTime();
    if (Number.isFinite(computedAt)) routeExpiries.push(computedAt+GPS_FRESH_MS);
    if (route?.minutes != null && (!Number.isFinite(computedAt) || computedAt+GPS_FRESH_MS <= Date.now()))
      return {...route,minutes:null,provenance:'unknown'};
    return route;
  };
  const end = serviceEnd(request, estimate);
  const pickup = new Date(request.pickup_datetime).getTime();
  const { conflicts, checks } = await detectRequestConflicts({ ...request, scheduled_arrival: end?.toISOString() }, { vehicleId, driverId, strict: true, includeEvidence:true, policy });
  const blocking = conflicts.filter(c => c.severity === 'blocking');
  const { rows: persistedCommitments } = await query(`SELECT ds.dispatch_id,ds.driver_id,ds.vehicle_id,ds.status,
      ds.scheduled_departure,ds.scheduled_arrival,completed.actual_end,tr.pickup_location,tr.dropoff_location
    FROM dispatchschedules ds LEFT JOIN transportation_requests tr ON tr.request_id=ds.request_id AND tr.deleted_at IS NULL
    LEFT JOIN LATERAL (SELECT MAX(t.end_time) AS actual_end FROM trips t WHERE t.dispatch_id=ds.dispatch_id AND t.deleted_at IS NULL AND t.trip_status='Completed') completed ON TRUE
    WHERE ds.deleted_at IS NULL AND ds.status IN ('Scheduled','In Progress','Completed')
      AND (ds.driver_id=$1 OR ds.vehicle_id=$2) AND ($3::int IS NULL OR ds.request_id IS DISTINCT FROM $3)
      AND ($4::int IS NULL OR ds.dispatch_id<>$4)
    ORDER BY ds.scheduled_departure`, [driverId,vehicleId,request.request_id ?? null,request.dispatch_id ?? null]);
  const commitments = [...persistedCommitments, ...tentativeCommitments.filter(c =>
    String(c.request_id) !== String(request.request_id) &&
    (Number(c.driver_id) === Number(driverId) || Number(c.vehicle_id) === Number(vehicleId)))]
    .sort((a,b) => new Date(a.scheduled_departure)-new Date(b.scheduled_departure) || String(a.dispatch_id).localeCompare(String(b.dispatch_id)));
  for (const c of commitments.filter(c => c.tentative)) {
    const start = new Date(c.scheduled_departure).getTime(), finish = new Date(c.scheduled_arrival).getTime();
    if (!Number.isFinite(finish) || !end) continue;
    if (start < end.getTime() && finish > pickup) blocking.push({ severity:'blocking',type:'tentative_overlap',message:`Driver or vehicle overlaps proposed request #${c.request_id}.`,detail:{request_id:c.request_id,driver_id:c.driver_id,vehicle_id:c.vehicle_id} });
  }
  const previousFor = (key,id) => commitments.filter(c => Number(c[key]) === Number(id) && new Date(c.scheduled_departure).getTime() < pickup).at(-1);
  const prevDriver = previousFor('driver_id',driverId), prevVehicle = previousFor('vehicle_id',vehicleId);
  const previous = [prevDriver,prevVehicle].filter(Boolean);
  let preceding = null;
  let releaseAt = null, releaseSource = null;
  if (previous.length) {
    const finish = c => c.status === 'Completed' ? c.actual_end : c.scheduled_arrival;
    const latest = previous.sort((a,b) => +new Date(finish(b)) - +new Date(finish(a)))[0];
    const available = finish(latest) ? new Date(finish(latest)).getTime() : NaN;
    releaseAt = Number.isFinite(available) ? new Date(available).toISOString() : null;
    releaseSource = latest.status === 'Completed' ? 'recorded completion' : 'scheduled';
    // Completed history explains the gap, but does not predict today's position.
    const meaningful = latest.status !== 'Completed';
    const leg = meaningful && prevDriver?.dispatch_id === prevVehicle?.dispatch_id && Number.isFinite(available)
      && !(latest.status === 'In Progress' && available < new Date(now).getTime())
      ? await knownLeg(latest.dropoff_location,request.pickup_location) : null;
    if (meaningful) preceding = { dispatch_id: latest.dispatch_id,
      availableAt: Number.isFinite(available) ? new Date(available).toISOString() : null,
      origin: prevDriver?.dispatch_id === prevVehicle?.dispatch_id && Number.isFinite(available)
        ? leg?.origin : null,
      label: latest.dropoff_location };
  }
  const immediate = temporalContext.urgency === 'SHORT_NOTICE';
  const state = immediate && !preceding ? await standbyState(driverId, {query}, excludeTripId) : null;
  // At trip start, mobile tracking has moved from standby to this owned trip.
  const tripFix = state && excludeTripId ? (await query(`SELECT g.latitude,g.longitude,g.accuracy,g.recorded_at AS observed_at
    FROM gpstracking g JOIN trips t ON t.trip_id=g.trip_id
    WHERE t.trip_id=$1 AND t.driver_id=$2 AND t.vehicle_id=$3 AND g.vehicle_id=$3
      AND t.deleted_at IS NULL AND t.trip_status IN ('Dispatched','Driver Accepted')
    ORDER BY g.recorded_at DESC,g.tracking_id DESC LIMIT 1`, [excludeTripId,driverId,vehicleId])).rows[0] : null;
  const standbyReady = !!(state?.session_live && state.standby_tracking_enabled
    && state.location_source === 'standby' && Number(state.location_vehicle_id) === Number(vehicleId));
  const ready = !!(state?.checked_in && state.consented && !state.busy && (excludeTripId ? tripFix : standbyReady));
  const fix = excludeTripId ? tripFix : state ? { latitude: state.standby_latitude, longitude: state.standby_longitude,
    observed_at: state.location_observed_at, accuracy: state.location_accuracy_m } : null;
  const dispatchContext = resolveLocationRelevance({ request,now,preceding,readyNow:ready,fix,policy,trustedDeparture });
  const release = releaseAt ? +new Date(releaseAt) : null;
  const result = { temporalContext, evidenceExpiresAt:temporalContext.nextBoundaryAt, scheduleEvidence: {
    previousDriverDispatchId:prevDriver?.dispatch_id ?? null, previousVehicleDispatchId:prevVehicle?.dispatch_id ?? null,
    releaseAt, releaseSource,
    gapMinutes:release == null ? null : Math.round((pickup-release)/60_000),
    transferMinutes:null, preparationMinutes, usableSlackMinutes:null,
    uncertainty:preceding ? (preceding.origin ? null : 'Preceding release or resource positioning is unverified.') : previous.length ? 'Previous trip completed; departure positioning needs verification.' : 'No preceding booking recorded; departure arrangements need verification.',
  }, dispatchContext, checks, evaluated:true, readiness: 'REVIEW_REQUIRED', feasibility: unknown('Route evidence needs review.'), hardConflicts: blocking,
    advisories:conflicts.filter(c => c.severity !== 'blocking'), reviewable:false };
  if (blocking.length) {
    result.feasibility = { verdict: 'INFEASIBLE', reasons: blocking.map(c => c.message) };
    return result;
  }
  const origin = dispatchContext.liveLocationUsed ? { lat: Number(fix.latitude), lng: Number(fix.longitude) } : preceding?.origin;
  const departAt = preceding?.availableAt ? new Date(Math.max(new Date(preceding.availableAt).getTime(),new Date(now).getTime())) : now;
  // The duty re-check covers the span the driver is committed, from release to
  // trip end. driverBlockReason only knows ONE day's shift/break (the span-start
  // day), so a multi-day span false-positives on that day's lunch break: RS-W3JU
  // ran a Sat 9AM → Sun 8PM span against Saturday's 12-1PM break and withheld a
  // driver whose Sun 8PM trip fits its own day. Only re-check same-day spans;
  // the trip-day [pickup → arrival] check in detectRequestConflicts stays
  // authoritative across days (Dispatch.md "Availability is decided by the window").
  if (origin && end && toCalendarDay(departAt) === toCalendarDay(end)) {
    const ctx = await loadDriverScheduleContext([driverId]);
    const duty = driverBlockReason({ driverId,pickup:departAt,returnAt:end,ctx });
    if (duty?.blocked) {
      result.feasibility = { verdict:'INFEASIBLE',reasons:[duty.reason] };
      result.hardConflicts.push({ severity:'blocking',type:'duty_window',message:duty.reason });
      return result;
    }
  }
  const endpoints = origin || commitments.length ? await knownLeg(request.pickup_location,request.dropoff_location) : null;
  const route = { ...(await routeFor(origin,endpoints?.origin,departAt)) };
  if (dispatchContext.liveLocationUsed && route.minutes != null) {
    const expiresAt = new Date(Math.min(new Date(dispatchContext.evidenceExpiresAt).getTime(),new Date(route.computedAt).getTime()+GPS_FRESH_MS)).toISOString();
    if (new Date(expiresAt).getTime() >= Date.now()) {
      result.proximity = { etaMinutes:route.minutes,distanceKm:route.distanceKm ?? null,distanceBasis:'ROUTED',
        source: route.provenance === 'cached' ? 'tomtom-cached' : 'tomtom-live-traffic',
        gpsObservedAt: fix.observed_at,routeComputedAt:route.computedAt,expiresAt };
      if (includePosition) result.position = { latitude:Number(fix.latitude),longitude:Number(fix.longitude),expiresAt };
    } else { route.minutes = null; dispatchContext.liveLocationUsed = false; }
  }
  if (preceding) result.expectedRoute = { etaMinutes:route.minutes,source:route.provenance,computedAt:route.computedAt ?? null, departAt:new Date(departAt).toISOString(), basis:'Predicted transfer from preceding destination' };
  result.scheduleEvidence.transferMinutes = route.minutes ?? null;
  result.scheduleEvidence.usableSlackMinutes = route.minutes == null ? null : Math.round((pickup - +new Date(departAt))/60_000 - route.minutes - preparationMinutes);
  result.scheduleEvidence.pickupMarginMinutes = route.minutes == null ? null : Math.round((pickup - +new Date(departAt))/60_000 - route.minutes);
  if (result.proximity) result.scheduleEvidence.uncertainty = null;
  if (!end) { result.feasibility = unknown('Service completion time is unknown.'); return result; }
  const passenger = ['TomTom','Manual'].includes(estimate?.source) || request.scheduled_arrival ? (end.getTime()-pickup)/60_000 : null;
  const nextFor = (key,id) => commitments.find(c => c.status !== 'Completed' && Number(c[key])===Number(id) && new Date(c.scheduled_departure).getTime() >= pickup);
  const nexts = [...new Map([nextFor('driver_id',driverId),nextFor('vehicle_id',vehicleId)].filter(Boolean).map(c => [c.dispatch_id,c])).values()];
  const verdicts = [];
  for (const next of nexts.length ? nexts : [null]) {
    const nextLeg = next ? await knownLeg(request.dropoff_location,next.pickup_location) : null;
    const reposition = next ? await routeFor(nextLeg.origin,nextLeg.destination,end) : null;
    verdicts.push({ ...evaluateRouteFeasibility({ now:departAt,pickupAt:request.pickup_datetime,
      deadheadMinutes:route.minutes,passengerMinutes:passenger,nextPickupAt:next?.scheduled_departure,
      repositionMinutes:reposition?.minutes,safetyBufferMinutes:preparationMinutes,
      // The deadhead leg is only material evidence when the journey has a
      // known start (preceding destination or live position). A scheduled
      // pair with no preceding commitment is judged on the knowable static
      // legs instead of warning about an unknowable ETA.
      deadheadRequired: origin != null || preceding != null || dispatchContext.mode !== 'SCHEDULED' }),
      nextDispatchId:next?.dispatch_id ?? null,nextPickupAt:next?.scheduled_departure ?? null,
      deadheadMin:route.minutes,passengerMin:passenger,repositionMin:reposition?.minutes ?? null,
      provenance:{deadhead:route.provenance,passenger:estimate?.source === 'TomTom' ? 'snapshot' : 'unknown',reposition:reposition?.provenance ?? 'unknown'} });
    // Protect the following commitment even when the incoming leg is unknown.
    if (next && reposition?.minutes != null && end.getTime() + (reposition.minutes + preparationMinutes)*60_000 > new Date(next.scheduled_departure).getTime())
      verdicts.push({ ...verdicts.at(-1),verdict:'INFEASIBLE',reasons:[`Insufficient turnaround before dispatch #${next.dispatch_id}.`] });
  }
  const severity = { INFEASIBLE:0,UNKNOWN:1,TIGHT:2,SAFE:3 };
  result.downstream = verdicts.filter(v => v.nextDispatchId).map(v => ({...v}));
  result.feasibility = verdicts.sort((a,b) => severity[a.verdict]-severity[b.verdict])[0];
  result.feasibility.protectedDispatchIds = nexts.map(c => c.dispatch_id);
  result.scheduleEvidence.nextSlackMinutes = result.feasibility.turnaroundMin == null ? null : result.feasibility.turnaroundMin - preparationMinutes;
  // Name the unverified leg instead of overwriting every UNKNOWN with one
  // generic planning message: the dispatcher sees which trip leg is missing.
  if (result.feasibility.verdict === 'UNKNOWN') {
    const legs = result.feasibility.unknownLegs ?? [];
    const nextIds = nexts.map(c => c.dispatch_id);
    if (legs.includes('reposition') && nextIds.length)
      result.feasibility.reasons = [...result.feasibility.reasons, `Unverified turnaround before dispatch #${nextIds.join(', #')}.`];
    if (legs.includes('deadhead') && preceding)
      result.feasibility.reasons = [...result.feasibility.reasons, `Departing from trip #${preceding.dispatch_id}; travel to pickup is unverified.`];
  }
  if (routeExpiries.length) result.evidenceExpiresAt = new Date(Math.min(...routeExpiries)).toISOString();
  result.readiness = result.feasibility.verdict === 'SAFE' ? 'VERIFIED' : 'REVIEW_REQUIRED';
  result.reviewable = dispatchContext.reasonCode !== 'STANDBY_NOT_VERIFIED' && result.feasibility.verdict !== 'INFEASIBLE' && checks.every(c => c.status === 'verified');
  if (dispatchDecision(result).state !== 'ALL_CLEAR') result.readiness = 'REVIEW_REQUIRED';
  return result;
}

export async function applyDispatchRadar({ request, estimate, recommendation, now = new Date(), includePosition = false }) {
  const policy = await getDispatchPolicy();
  recommendation.policyVersion = LOCATION_POLICY_VERSION;
  recommendation.evaluatedAt = new Date(now).toISOString();
  recommendation.requestContext = requestLocationContext(request,now,null,policy);
  const candidates = recommendation.pair?.candidates ?? [];
  const deadline = Date.now()+25_000;
  const routeMemo = new Map();
  let index = 0;
  // ponytail: small fleet; four workers route every eligible pair, no distance shortlist.
  await Promise.all(Array.from({ length:Math.min(4,candidates.length) },async () => {
    while (index < candidates.length) {
      const pair = candidates[index++];
      for (const key of ['proximity','expectedRoute','position','hardConflicts','dispatchContext','readiness','feasibility','evidenceExpiresAt','checks','advisories','downstream','reviewable','temporalContext','scheduleEvidence','decisionEvidence']) delete pair[key];
      delete pair.distance_km; delete pair.estimated_pickup_minutes;
      for (const key of ['distance_from_pickup_km','position_basis','estimated_arrival_minutes','proximity_relevant']) delete pair.driver?.[key];
      pair.evaluated = Date.now() < deadline;
      try {
        if (!pair.evaluated) throw new Error('Evaluation deadline reached');
        Object.assign(pair,await evaluateDispatchCandidate({ request,estimate,vehicleId:pair.vehicle_id,driverId:pair.driver_id,now,includePosition,deadline,routeMemo,policy }));
      }
      catch { Object.assign(pair,{ evaluated:false,dispatchContext:resolveLocationRelevance({ request,now }),readiness:'REVIEW_REQUIRED',feasibility:unknown('Current schedule or location evidence could not be verified.') }); }
    }
  }));
  recommendation.evaluation = { evaluated:candidates.filter(pair=>pair.evaluated).length,total:candidates.length };
  for (const pair of candidates) {
    if (pair.proximity && new Date(pair.proximity.expiresAt).getTime() <= Date.now()) {
      delete pair.proximity; delete pair.position;
      pair.readiness = 'REVIEW_REQUIRED';
      pair.feasibility = unknown('Location or route evidence expired during evaluation.');
      pair.dispatchContext.liveLocationUsed = false;
    }
    if (pair.readiness !== 'VERIFIED') pair.checklist = [];
    if (pair.driver) { pair.driver.dispatchContext = pair.dispatchContext; pair.driver.readiness = pair.readiness; }
    if (pair.vehicle) pair.vehicle.readiness = pair.readiness;
  }
  rankDispatchPairs(candidates, policy);
  const safe = candidates.filter(c => c.feasibility?.verdict !== 'INFEASIBLE');
  recommendation.pair.recommended = safe[0] ?? null;
  recommendation.pair.alternate = safe[1] ?? null;
  recommendation.pair.none_reasons = [...(recommendation.pair.none_reasons ?? []), ...candidates.filter(c=>c.feasibility?.verdict==='INFEASIBLE').map(c=>({vehicle_id:c.vehicle_id,reason:c.feasibility.reasons.join(' ')}))];
  for (const kind of ['vehicle','driver']) recommendation[kind] = { recommended:safe[0]?.[kind] ?? null,alternate:safe[1]?.[kind] ?? null,considered:candidates.length };
  return recommendation;
}
