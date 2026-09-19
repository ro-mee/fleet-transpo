import { query } from '@/lib/db';
import { getGpsHealth } from '@/lib/gps';
import { EVIDENCE_TYPES, projectEvidenceFacts, usableRecordIdentity } from '@/lib/dispatch/evidence-contract';
import { evaluateDispatchCandidate } from '@/services/dispatch-radar.service';
import { resolveRequestEstimate } from '@/services/route-resolver.service';
import { getDispatchPolicy } from '@/services/dispatch-settings.service';
import { comparePairEvidence } from '@/lib/dispatch/recommendation-ranking';

// Scoped evidence resolvers (Phase B1). Every query selects explicit
// display-safe columns only (allowlist at SQL level) and is scoped to the
// reservation/pair under review. Positive ("clear") results report the
// evaluated scope — never the underlying collection (no leave history, no
// unrelated work orders).
async function driverName(db, driverId) {
  const { rows } = await db.query(
    `SELECT TRIM(COALESCE(e.first_name,'') || ' ' || COALESCE(e.last_name,'')) AS name
       FROM drivers d LEFT JOIN employees e ON e.employee_id=d.employee_id AND e.deleted_at IS NULL
      WHERE d.driver_id=$1 AND d.deleted_at IS NULL`, [driverId]);
  return rows[0]?.name?.trim() || `Driver #${driverId}`;
}

async function vehiclePlate(db, vehicleId) {
  const { rows } = await db.query(
    `SELECT plate_number FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL`, [vehicleId]);
  return rows[0]?.plate_number ?? `Vehicle #${vehicleId}`;
}

export async function resolveScheduleConflict(db, { driverId, vehicleId, requestId, pickupAt, endAt }) {
  const { rows } = await db.query(
    `SELECT dispatch_id, dispatch_number, status, scheduled_departure, scheduled_arrival
       FROM dispatchschedules
      WHERE deleted_at IS NULL AND status IN ('Scheduled','In Progress','Driver Accepted')
        AND (driver_id=$1 OR vehicle_id=$2) AND request_id IS DISTINCT FROM $3
        AND scheduled_departure < $5::timestamptz
        AND COALESCE(scheduled_arrival, scheduled_departure) > $4::timestamptz
      ORDER BY scheduled_departure LIMIT 1`,
    [driverId, vehicleId, requestId, pickupAt, endAt]);
  const hit = rows[0];
  if (!hit) return { verdict: 'clear', evaluatedWindow: { pickupAt, endAt } };
  return {
    verdict: 'blocked',
    existingDispatchNumber: hit.dispatch_number ?? `DSP-${hit.dispatch_id}`,
    existingDeparture: hit.scheduled_departure, existingArrival: hit.scheduled_arrival,
    expectedRelease: hit.scheduled_arrival ?? hit.scheduled_departure,
    requestedPickup: pickupAt, requestedEnd: endAt,
  };
}

export async function resolveLeave(db, { driverId, pickupAt, endAt }) {
  // No usable driver means the question cannot be asked, so it must not be
  // answered. The query below would otherwise run as `driver_id = 0`, match no
  // row, and fall through to verdict:'clear' — an all-clear for a driver nobody
  // looked up, which is the one direction of error that matters in a proof whose
  // purpose is to support a block. Null facts instead, which the drawer renders as
  // "—": no claim either way. Same rule as resolvePairing and resolveGps.
  const driver = usableRecordIdentity(driverId);
  if (driver == null) return { verdict: null, overlapsBooking: null };
  // Overlapping approved leave only — never leave history.
  const { rows } = await db.query(
    `SELECT status, start_date, end_date FROM driver_leave_requests
      WHERE driver_id=$1 AND status='Approved' AND deleted_at IS NULL
        AND start_date <= ($3::timestamptz AT TIME ZONE 'Asia/Manila')::date
        AND end_date >= ($2::timestamptz AT TIME ZONE 'Asia/Manila')::date
      ORDER BY start_date LIMIT 1`, [driver, pickupAt, endAt]);
  if (!rows[0]) return { verdict: 'clear', evaluatedWindow: { pickupAt, endAt }, overlapsBooking: false };
  return { verdict: 'blocked', status: rows[0].status, startDate: rows[0].start_date, endDate: rows[0].end_date, overlapsBooking: true };
}

export async function resolveMaintenance(db, { vehicleId }) {
  // Blocking work orders only — no descriptions, remarks, costs, history.
  const { rows } = await db.query(
    `SELECT maintenance_id, maintenance_type, status, maintenance_date FROM vehiclemaintenance
      WHERE vehicle_id=$1 AND deleted_at IS NULL AND status <> 'Completed'
      ORDER BY maintenance_date DESC LIMIT 3`, [vehicleId]);
  if (!rows.length) return { verdict: 'clear' };
  const first = rows[0];
  return {
    verdict: 'blocked', maintenanceId: first.maintenance_id, type: first.maintenance_type,
    status: first.status, maintenanceDate: first.maintenance_date,
    availability: 'Under Maintenance',
  };
}

export async function resolveIncident(db, { incidentId = null, recordId = null }) {
  // Identity + status only — never description, location, or actions taken.
  const id = recordId ?? incidentId;
  const { rows } = await db.query(
    `SELECT incident_id, incident_type, severity, status, incident_date FROM driverincidents
      WHERE incident_id=$1 AND deleted_at IS NULL`, [id]);
  if (!rows[0]) throw new Error('Record not found.');
  const r = rows[0];
  return { verdict: 'blocked', incidentId: r.incident_id, type: r.incident_type, severity: r.severity, status: r.status, incidentDate: r.incident_date };
}

// Compliance covers two unrelated record families and the two return different
// facts, so the ref must say which one it is about. It used to infer that from
// `vehicleId != null`, and since every pair-path compliance ref carries a
// vehicleId, a DRIVER-LICENCE proof took the vehicle branch and reported the
// vehicle's registration/insurance — a proof whose content is unrelated to the
// claim it exists to support. Branch on the stated subject instead, and refuse
// rather than guess when it is absent (a ref minted before the field existed).
export async function resolveCompliance(db, { vehicleId, driverId, bookingDate, subject }) {
  const items = [];
  if (subject !== 'vehicle' && subject !== 'driver') {
    const e = new Error('This compliance proof does not state which record it covers.');
    e.code = 'UNSCOPED';
    throw e;
  }
  if (subject === 'vehicle') {
    const { rows } = await db.query(
      `SELECT plate_number, registration_expiry, insurance_expiry FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL`, [vehicleId]);
    const v = rows[0];
    if (!v) throw new Error('Record not found.');
    for (const [field, expiry] of [['registration', v.registration_expiry], ['insurance', v.insurance_expiry]]) {
      const expired = expiry && Number.isFinite(+new Date(expiry)) && +new Date(expiry) < +new Date(bookingDate);
      items.push({ field, expiry, status: expired ? 'EXPIRED' : 'VALID' });
    }
    const bad = items.find(i => i.status === 'EXPIRED');
    if (bad) return { verdict: 'blocked', subject: 'vehicle', subjectName: v.plate_number, ...bad, bookingDate, items };
    return { verdict: 'clear', subject: 'vehicle', subjectName: v.plate_number, bookingDate, items };
  }
  if (driverId == null) throw new Error('Record not found.');
  const { rows } = await db.query(
    `SELECT license_expiry FROM drivers WHERE driver_id=$1 AND deleted_at IS NULL`, [driverId]);
  if (!rows[0]) throw new Error('Record not found.');
  const expired = rows[0].license_expiry && +new Date(rows[0].license_expiry) < +new Date(bookingDate);
  const item = { field: 'license', expiry: rows[0].license_expiry, status: expired ? 'EXPIRED' : 'VALID' };
  return { verdict: expired ? 'blocked' : 'clear', subject: 'driver', bookingDate, ...item, items: [item] };
}

export async function resolveCapacity(db, { vehicleId, passengerCount }) {
  const { rows } = await db.query(
    `SELECT plate_number, seating_capacity FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL`, [vehicleId]);
  if (!rows[0]) throw new Error('Record not found.');
  const fits = rows[0].seating_capacity == null || Number(rows[0].seating_capacity) >= Number(passengerCount);
  return {
    verdict: fits ? 'clear' : 'blocked', plate: rows[0].plate_number,
    requestedSeats: Number(passengerCount), passengerCount: Number(passengerCount),
    recordedSeats: rows[0].seating_capacity == null ? null : Number(rows[0].seating_capacity),
    result: fits ? 'Eligible' : 'Not eligible',
  };
}

export async function resolvePairing(db, { vehicleId, driverId, pickupDate }) {
  // Null driver means not evaluated, exactly as in resolveGps. Without this the
  // queries below ran with driver_id = NULL, matched nothing, and the fallthrough
  // asserted pairingState:'none' — a definitive negative, rendered as "Pairing:
  // none / Result: Blocking", for a pairing that was never looked up. Both facts
  // are null instead, which the drawer renders as "—": no claim either way, and
  // no new verdict string, since the drawer prints any unrecognized one verbatim.
  if (driverId == null) return { verdict: null, pairingState: null };
  const { rows } = await db.query(
    `SELECT assignment_id, assigned_from FROM driver_vehicle_assignments
      WHERE vehicle_id=$1 AND driver_id=$2 AND assigned_until IS NULL`, [vehicleId, driverId]);
  if (rows[0]) return { verdict: 'clear', pairingState: 'active-standing', effectiveDate: rows[0].assigned_from };
  const { rows: subs } = await db.query(
    `SELECT effective_from, effective_until FROM substitute_vehicle_schedules
      WHERE vehicle_id=$1 AND substitute_driver_id=$2 AND deleted_at IS NULL
        AND effective_from <= $3::date AND effective_until >= $3::date LIMIT 1`,
    [vehicleId, driverId, pickupDate]);
  if (subs[0]) return { verdict: 'clear', pairingState: 'substitute', effectiveDate: subs[0].effective_from };
  return { verdict: 'blocked', pairingState: 'none' };
}

export async function resolveVehicleStatus(db, { vehicleId, note = null }) {
  const { rows } = await db.query(
    `SELECT plate_number, vehicle_status FROM vehicles WHERE vehicle_id=$1 AND deleted_at IS NULL`, [vehicleId]);
  if (!rows[0]) throw new Error('Record not found.');
  return { verdict: 'clear', plate: rows[0].plate_number, status: rows[0].vehicle_status, finding: note };
}

export async function resolveGps(db, { driverId, horizon }) {
  // Timestamp only — never coordinates. Null driver means not evaluated.
  if (driverId == null) return { verdict: 'clear', health: null, observedAt: null, horizon: horizon ?? null, etaMinutes: null, etaValid: false };
  const { rows } = await db.query(
    `SELECT last_location_update FROM drivers WHERE driver_id=$1 AND deleted_at IS NULL`, [driverId]);
  const observedAt = rows[0]?.last_location_update ?? null;
  const health = getGpsHealth(observedAt, Date.now());
  return { verdict: 'clear', health: health.label, observedAt, horizon: horizon ?? null, etaMinutes: null, etaValid: false };
}

const RESOLVERS = {
  [EVIDENCE_TYPES.SCHEDULE_CONFLICT]: resolveScheduleConflict,
  [EVIDENCE_TYPES.LEAVE]: resolveLeave,
  [EVIDENCE_TYPES.MAINTENANCE]: resolveMaintenance,
  [EVIDENCE_TYPES.INCIDENT]: resolveIncident,
  [EVIDENCE_TYPES.COMPLIANCE]: resolveCompliance,
  [EVIDENCE_TYPES.CAPACITY]: resolveCapacity,
  [EVIDENCE_TYPES.PAIRING]: resolvePairing,
  [EVIDENCE_TYPES.VEHICLE_STATUS]: resolveVehicleStatus,
  [EVIDENCE_TYPES.GPS]: resolveGps,
  [EVIDENCE_TYPES.COMPARISON]: resolveComparison,
};

// Option A vs B from live server evaluation (B4). Codes, bands and facts
// only — ranking scores or order values are never exposed.
export async function resolveComparison(db, refData, ctx, deps = {}) {
  const evaluate = deps.evaluate ?? evaluateDispatchCandidate;
  const estimateFor = deps.estimateFor ?? resolveRequestEstimate;
  const policyFor = deps.policyFor ?? getDispatchPolicy;
  const compare = deps.compare ?? comparePairEvidence;
  const [vB, dB] = String(refData.recordId ?? '').split(':').map(Number);
  if (!Number.isSafeInteger(refData.vehicleId) || !Number.isSafeInteger(refData.driverId) || !Number.isSafeInteger(vB) || !Number.isSafeInteger(dB))
    throw new Error('Invalid comparison reference.');
  const request = ctx.requestRow;
  if (!request) throw new Error('Reservation not found.');
  const deadline = Date.now() + 8000;
  const routeMemo = new Map();
  const estimate = await estimateFor(request, { query: db.query ?? query }, { persistRoute: false }).catch(() => null);
  const policy = await policyFor();
  const [evA, evB] = await Promise.all([
    evaluate({ request, estimate, vehicleId: refData.vehicleId, driverId: refData.driverId, now: new Date(), deadline, routeMemo }),
    evaluate({ request, estimate, vehicleId: vB, driverId: dB, now: new Date(), deadline, routeMemo }),
  ]);
  const compared = compare(
    { ...evA, vehicle_id: refData.vehicleId, driver_id: refData.driverId },
    { ...evB, vehicle_id: vB, driver_id: dB }, policy);
  const side = (ev, vehicleId, driverId) => ({
    vehicleId, driverId,
    reliability: ev?.feasibility?.verdict ?? 'UNKNOWN',
    transferMinutes: ev?.scheduleEvidence?.transferMinutes ?? null,
    workload: ev?.workloadEvidence?.complete
      ? { serviceDate: ev.workloadEvidence.serviceDate, totalTrips: ev.workloadEvidence.totalTrips ?? ev.workloadEvidence.scheduledTrips ?? null }
      : null,
    standing: ev?.reason_type === 'designated' ? 'Standing pair' : 'Non-standing',
    decision: ev?.decisionEvidence?.code ?? compared?.code ?? null,
  });
  return {
    verdict: 'clear',
    optionA: side(evA, refData.vehicleId, refData.driverId),
    optionB: side(evB, vB, dB),
    hierarchy: ['Reliability', 'Efficiency', 'Workload when applicable', 'Standing preference'],
  };
}

export async function resolveEvidence(db, refData, ctx, dbOverride = null) {
  const { proofType } = refData;
  const resolver = (dbOverride ?? RESOLVERS)[proofType];
  if (!resolver) {
    const e = new Error('This evidence type is not available yet.');
    e.code = 'INACTIVE';
    throw e;
  }
  // Accept the lib/db query function or a {query} object (tests/mocks).
  const store = typeof db === 'function' ? { query: db } : db;
  const facts = await resolver(store, { ...refData, ...ctx });
  if (refData.driverId != null && facts.driverName === undefined) facts.driverName = await driverName(store, refData.driverId).catch(() => null);
  if (refData.vehicleId != null && facts.plate === undefined) facts.plate = await vehiclePlate(store, refData.vehicleId).catch(() => null);
  return projectEvidenceFacts(proofType, facts);
}

export { query };
