import { query } from '@/lib/db';
import { evaluateDispatchCandidate, serviceEnd } from '@/services/dispatch-radar.service';
import { resolveRequestEstimate } from '@/services/route-resolver.service';

// Phase 4B — sequential return-trip matching (not pooling, no route change).
// Finds an existing unassigned booking the same pair could serve after the
// outbound trip. Bounded by time window, candidate cap and deadline.
// Cross-midnight candidates within the window are included. Partial coverage
// is disclosed. Proximity shortlists; only road-transfer evidence confirms.
export function isReturnCandidate(followOn, { outboundId, releaseAt, windowEnd, vehicleCapacity = null }) {
  if (!followOn || Number(followOn.request_id) === Number(outboundId)) return false;
  if (!['Pending', 'Scheduled'].includes(followOn.fleet_status)) return false;
  if (followOn.vehicle_id != null || followOn.driver_id != null) return false;
  const pickup = +new Date(followOn.pickup_datetime);
  if (!Number.isFinite(pickup)) return false;
  if (releaseAt != null && pickup < releaseAt) return false;
  if (windowEnd != null && pickup > windowEnd) return false;
  if (vehicleCapacity != null && Number(followOn.passenger_count) > Number(vehicleCapacity)) return false;
  return true;
}

// Reliability first, then transfer burden, then workload. Efficiency never
// overrides a hard conflict or higher-priority coverage harm.
export function rankReturnMatches(matches) {
  const verdictRank = v => (v === 'SAFE' ? 0 : v === 'TIGHT' ? 1 : v === 'UNKNOWN' ? 2 : 3);
  return [...matches].sort((a, b) =>
    verdictRank(a.feasibility) - verdictRank(b.feasibility)
    || (a.transferMinutes ?? Infinity) - (b.transferMinutes ?? Infinity)
    || (a.pickupAt ?? Infinity) - (b.pickupAt ?? Infinity));
}

export async function findReturnMatches({ outboundId, vehicleId, driverId, timeWindowHours = 4, candidateCap = 10, now = new Date(), deadline = Date.now() + 20_000, evaluate = evaluateDispatchCandidate } = {}) {
  if (!Number.isSafeInteger(Number(outboundId)) || !Number.isSafeInteger(Number(vehicleId)) || !Number.isSafeInteger(Number(driverId)))
    throw new Error('Valid outbound, vehicle and driver IDs are required.');
  const windowHours = Math.min(Math.max(Number(timeWindowHours) || 4, 1), 12);
  const cap = Math.min(Math.max(Number(candidateCap) || 10, 1), 20);
  const { rows: outboundRows } = await query(`SELECT * FROM transportation_requests WHERE request_id=$1 AND deleted_at IS NULL`, [outboundId]);
  const outbound = outboundRows[0];
  if (!outbound) throw new Error('Outbound reservation not found.');
  if (['Cancelled', 'Completed'].includes(outbound.fleet_status)) throw new Error('Outbound trip is closed; return matching is unavailable.');
  const estimate = await resolveRequestEstimate(outbound, { query }, { persistRoute: false }).catch(() => null);
  const end = serviceEnd(outbound, estimate);
  const releaseAt = end ? +end : null;
  if (releaseAt == null || !Number.isFinite(releaseAt)) {
    return { matches: [], releaseAt: null, releaseSource: null, coverage: { evaluated: 0, cap, complete: true }, note: 'Release time could not be verified; no confirmed match is returned.' };
  }
  const windowEnd = releaseAt + windowHours * 3_600_000;
  const { rows: vehicleRows } = await query(`SELECT seating_capacity FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL`, [vehicleId]);
  const capacity = vehicleRows[0]?.seating_capacity ?? null;
  const { rows: candidates } = await query(`SELECT tr.* FROM transportation_requests tr
    WHERE tr.deleted_at IS NULL AND tr.fleet_status IN ('Pending','Scheduled')
      AND tr.vehicle_id IS NULL AND tr.driver_id IS NULL AND tr.request_id<>$1
      AND tr.pickup_datetime >= $2::timestamptz AND tr.pickup_datetime <= $3::timestamptz
      AND NOT EXISTS (SELECT 1 FROM dispatchschedules ds WHERE ds.request_id=tr.request_id AND ds.deleted_at IS NULL AND ds.status IN ('Scheduled','In Progress'))
    ORDER BY tr.pickup_datetime LIMIT $4`, [outboundId, new Date(releaseAt).toISOString(), new Date(windowEnd).toISOString(), cap]);
  const matches = [];
  let evaluated = 0, complete = true;
  const routeMemo = new Map();
  for (const followOn of candidates) {
    if (Date.now() >= deadline) { complete = false; break; }
    if (!isReturnCandidate(followOn, { outboundId, releaseAt, windowEnd, vehicleCapacity: capacity })) continue;
    try {
      const followEstimate = await resolveRequestEstimate(followOn, { query }, { persistRoute: false }).catch(() => null);
      const evidence = await evaluate({ request: followOn, estimate: followEstimate, vehicleId: Number(vehicleId), driverId: Number(driverId), now, deadline, routeMemo });
      evaluated += 1;
      if (evidence?.feasibility?.verdict === 'INFEASIBLE') continue;
      matches.push({
        requestId: followOn.request_id, pickupAt: followOn.pickup_datetime,
        feasibility: evidence.feasibility?.verdict ?? 'UNKNOWN',
        transferMinutes: evidence.scheduleEvidence?.transferMinutes ?? null,
        usableSlackMinutes: evidence.scheduleEvidence?.usableSlackMinutes ?? null,
        releaseAt: evidence.scheduleEvidence?.releaseAt ?? null,
        reasons: (evidence.feasibility?.reasons ?? []).slice(0, 2),
      });
    } catch { evaluated += 1; }
  }
  return {
    matches: rankReturnMatches(matches).slice(0, 5).map(m => ({ ...m, reviewHref: `/reservations/${m.requestId}` })),
    releaseAt: new Date(releaseAt).toISOString(), releaseSource: 'scheduled',
    outbound: { requestId: outbound.request_id, destination: outbound.dropoff_location ?? null },
    coverage: { evaluated, cap, complete, windowHours },
    note: complete ? 'No match found within the evaluated scope; this does not prove none exists fleet-wide.' : 'Search stopped at the deadline; coverage is partial.',
  };
}
