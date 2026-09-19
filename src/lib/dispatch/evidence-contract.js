import { createHmac, timingSafeEqual } from 'node:crypto';

// Phase B1 — evidence contract. Single owner of what the Evidence Drawer may
// display per proof type. Default-deny: only allowlisted fields leave the
// server; unknown/future columns are stripped, never passed through.
// comparison + trail are RESERVED types: recognized but unresolvable until
// their implementation phases land (endpoint rejects them).
export const EVIDENCE_TYPES = {
  SCHEDULE_CONFLICT: 'schedule_conflict',
  LEAVE: 'leave',
  MAINTENANCE: 'maintenance',
  INCIDENT: 'incident',
  COMPLIANCE: 'compliance',
  CAPACITY: 'capacity',
  PAIRING: 'pairing',
  VEHICLE_STATUS: 'vehicle_status',
  GPS: 'gps',
  COMPARISON: 'comparison',
  TRAIL: 'trail',
};

const ALL = Object.values(EVIDENCE_TYPES);
// trail stays inactive until B5. comparison activates in B4.
export const ACTIVE_EVIDENCE_TYPES = ALL.filter(t => t !== EVIDENCE_TYPES.TRAIL);

// Display-safe fields per type. Anything not listed is never returned.
// Privacy: no coordinates, descriptions, remarks, costs, attachments,
// reasons, history collections, HR notes, or unrelated rows.
export const EVIDENCE_ALLOWLISTS = {
  [EVIDENCE_TYPES.SCHEDULE_CONFLICT]: ['driverName', 'existingDispatchNumber', 'existingDeparture', 'existingArrival', 'expectedRelease', 'requestedPickup', 'requestedEnd', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.LEAVE]: ['driverName', 'status', 'startDate', 'endDate', 'overlapsBooking', 'evaluatedWindow', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.MAINTENANCE]: ['plate', 'maintenanceId', 'type', 'status', 'maintenanceDate', 'availability', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.INCIDENT]: ['incidentId', 'type', 'severity', 'status', 'incidentDate', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.COMPLIANCE]: ['subject', 'subjectName', 'field', 'expiry', 'bookingDate', 'status', 'items', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.CAPACITY]: ['plate', 'requestedSeats', 'passengerCount', 'recordedSeats', 'result', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.PAIRING]: ['plate', 'driverName', 'pairingState', 'effectiveDate', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.VEHICLE_STATUS]: ['plate', 'status', 'finding', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.GPS]: ['health', 'observedAt', 'horizon', 'etaMinutes', 'etaValid', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.COMPARISON]: ['optionA', 'optionB', 'hierarchy', 'sourceModule', 'verdict'],
  [EVIDENCE_TYPES.TRAIL]: [],
};

export const EVIDENCE_TITLES = {
  [EVIDENCE_TYPES.SCHEDULE_CONFLICT]: 'Schedule Conflict',
  [EVIDENCE_TYPES.LEAVE]: 'Leave Evidence',
  [EVIDENCE_TYPES.MAINTENANCE]: 'Maintenance Evidence',
  [EVIDENCE_TYPES.INCIDENT]: 'Incident Evidence',
  [EVIDENCE_TYPES.COMPLIANCE]: 'Compliance Block',
  [EVIDENCE_TYPES.CAPACITY]: 'Booking Requirement',
  [EVIDENCE_TYPES.PAIRING]: 'Pairing Evidence',
  [EVIDENCE_TYPES.VEHICLE_STATUS]: 'Vehicle Evidence',
  [EVIDENCE_TYPES.GPS]: 'Live Dispatch Evidence',
  [EVIDENCE_TYPES.COMPARISON]: 'Option Comparison',
  [EVIDENCE_TYPES.TRAIL]: 'Decision Trail',
};

export const MANAGING_MODULE = {
  [EVIDENCE_TYPES.SCHEDULE_CONFLICT]: 'Fleet Management',
  [EVIDENCE_TYPES.LEAVE]: 'Attendance & Leave',
  [EVIDENCE_TYPES.MAINTENANCE]: 'Fleet Management',
  [EVIDENCE_TYPES.INCIDENT]: 'Incidents',
  [EVIDENCE_TYPES.COMPLIANCE]: 'Fleet Management',
  [EVIDENCE_TYPES.CAPACITY]: 'Reservations',
  [EVIDENCE_TYPES.PAIRING]: 'Fleet Management',
  [EVIDENCE_TYPES.VEHICLE_STATUS]: 'Fleet Management',
  [EVIDENCE_TYPES.GPS]: 'Live Tracking',
  [EVIDENCE_TYPES.COMPARISON]: 'Dispatch Copilot',
  [EVIDENCE_TYPES.TRAIL]: 'Dispatch Copilot',
};

// A compliance proof covers one of TWO record families — a vehicle's
// registration/insurance, or a driver's licence — and the two queries return
// different facts entirely. The check id (clearance side) or the recovery code
// (block side) says which one the claim is about; the ref carries that answer so
// the resolver is TOLD it rather than left to infer it from whichever id happens
// to be non-null. Inferring is what made a licence proof report a vehicle:
// resolveCompliance took its vehicle branch before driverId was ever read, and
// every pair-path compliance ref carries a vehicleId. These tables are the single
// definition both mint sites and the resolver read.
export const COMPLIANCE_SUBJECT_BY_CHECK = {
  registration: 'vehicle', insurance: 'vehicle', license: 'driver',
};
export const COMPLIANCE_SUBJECT_BY_CODE = {
  REGISTRATION_EXPIRED: 'vehicle', INSURANCE_EXPIRED: 'vehicle', LICENSE_EXPIRED: 'driver',
};
const COMPLIANCE_SUBJECTS = ['vehicle', 'driver'];

// A record identity is usable only when it is a POSITIVE safe integer. A missing
// identity must never be mistaken for a real one, and the projection coerces ids
// with Number(): an absent driver therefore arrives as 0 (and Number(undefined)
// as NaN). 0 is the dangerous shape — `driver_id = 0` is a clean, valid query
// that matches no row, so every resolver that answers "clear" on an empty result
// answers "clear" to a question it was never able to ask. Absent and not-a-real-id
// are the same answer: no identity, no claim. Both mint sites and the resolvers
// read this one predicate rather than each re-deciding what counts as an id.
export function usableRecordIdentity(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const PURPOSE = 'fleet-dispatch-evidence-v1';
const REF_TTL_MS = 15 * 60_000;

function signPayload(payload) {
  const key = process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('Evidence signing is not configured.');
  return createHmac('sha256', key).update(`${PURPOSE}:${payload}`).digest('base64url');
}

// Opaque server-generated proof reference. Binds reservation + pair + type +
// record so the drawer can never be used to browse arbitrary records. Never
// assignment authority (distinct purpose string).
export function signEvidenceRef({ requestId, vehicleId = null, driverId = null, proofType, recordId = null, note = null, subject = null, evaluatedAt = new Date().toISOString() }) {
  if (!Object.values(EVIDENCE_TYPES).includes(proofType)) throw new Error('Unknown evidence type.');
  if (note != null && (typeof note !== 'string' || note.length > 200)) throw new Error('Invalid evidence note.');
  // Which record family the claim is scoped to. Validated here as well as at
  // verify time: an unvalidated field inside a signed payload is worse than no
  // field, because the signature then vouches for a value nothing ever read.
  if (subject != null && !COMPLIANCE_SUBJECTS.includes(subject)) throw new Error('Invalid evidence subject.');
  const payload = Buffer.from(JSON.stringify({
    v: 1, requestId: Number(requestId),
    vehicleId: vehicleId == null ? null : Number(vehicleId),
    driverId: driverId == null ? null : Number(driverId),
    proofType, recordId, note: note ?? null, subject,
    evaluatedAt, exp: Date.now() + REF_TTL_MS,
  })).toString('base64url');
  return `ev_${payload}.${signPayload(payload)}`;
}

export function verifyEvidenceRef(ref, { requestId = null } = {}) {
  const fail = code => { const e = new Error('Evidence reference is invalid.'); e.code = code; throw e; };
  try {
    if (typeof ref !== 'string' || !ref.startsWith('ev_') || ref.length > 4000) fail('TAMPERED');
    const [payload, mac, extra] = ref.slice(3).split('.');
    if (!payload || !mac || extra) fail('TAMPERED');
    const expected = Buffer.from(signPayload(payload));
    const actual = Buffer.from(mac);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('TAMPERED');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data?.v !== 1 || !Object.values(EVIDENCE_TYPES).includes(data?.proofType)) fail('TAMPERED');
    // Absence is allowed: a ref minted before subject existed still verifies and
    // is refused later, at resolve time, where the refusal can be rendered.
    if (data.subject != null && !COMPLIANCE_SUBJECTS.includes(data.subject)) fail('TAMPERED');
    if (!Number.isFinite(new Date(data.exp).getTime()) || new Date(data.exp).getTime() <= Date.now()) fail('EXPIRED');
    if (requestId != null && Number(data.requestId) !== Number(requestId)) fail('SCOPE');
    if (!ACTIVE_EVIDENCE_TYPES.includes(data.proofType)) fail('INACTIVE');
    return data;
  } catch (e) {
    if (e?.code) throw e;
    fail('TAMPERED');
  }
}

// Strip everything not allowlisted for the type. Default-deny.
export function projectEvidenceFacts(proofType, facts = {}) {
  const allowed = EVIDENCE_ALLOWLISTS[proofType] ?? [];
  return Object.fromEntries(allowed.filter(k => facts[k] !== undefined).map(k => [k, facts[k]]));
}

// Map a recovery action to the proof type that can prove it. Returns null
// when no proof type applies (chat fallback still explains these).
export function proofTypeForRecovery(recovery = {}) {
  switch (recovery.code) {
    case 'MAINTENANCE_CONFLICT': return EVIDENCE_TYPES.MAINTENANCE;
    case 'VEHICLE_STATUS': return EVIDENCE_TYPES.VEHICLE_STATUS;
    case 'UVVRP_RESTRICTED': return EVIDENCE_TYPES.VEHICLE_STATUS;
    case 'PAIRING': return EVIDENCE_TYPES.PAIRING;
    case 'CAPACITY_MISMATCH': return EVIDENCE_TYPES.CAPACITY;
    case 'LICENSE_EXPIRED':
    case 'REGISTRATION_EXPIRED':
    case 'INSURANCE_EXPIRED': return EVIDENCE_TYPES.COMPLIANCE;
    case 'DRIVER_UNAVAILABLE':
      // The recorded reason is evidence; the hint is a static template that
      // never reflects which record blocked the pair. Classifying on the hint
      // alone sent leave-sourced blocks to the schedule-conflict family, which
      // resolves a DIFFERENT record set (overlapping dispatchschedules) and can
      // legitimately come back clear — a drawer proving the opposite of the
      // chat. Test the recorded message first and the hint as fallback: exclusion
      // actions carry no message and put the reason in the hint.
      return /leave/i.test(recovery.message ?? recovery.hint ?? '')
        ? EVIDENCE_TYPES.LEAVE
        : EVIDENCE_TYPES.SCHEDULE_CONFLICT;
    case 'ROUTE_EVIDENCE': return EVIDENCE_TYPES.GPS;
    default: return null;
  }
}

// Map a verified check id to the proof type that can show its clearance.
// Returns null when no record-scoped proof exists (row still renders).
export function proofTypeForCheck(checkId) {
  switch (checkId) {
    case 'capacity': return EVIDENCE_TYPES.CAPACITY;
    case 'maintenance': return EVIDENCE_TYPES.MAINTENANCE;
    case 'pairing': return EVIDENCE_TYPES.PAIRING;
    case 'schedule': return EVIDENCE_TYPES.SCHEDULE_CONFLICT;
    case 'registration':
    case 'insurance':
    case 'license': return EVIDENCE_TYPES.COMPLIANCE;
    default: return null;
  }
}


// Mint clearance refs for verified checks on each pair (the symmetric
// available-side of exclusion proof). Blocked checks are already covered by
// recoveryActions; missing checks render without proof. Non-fatal without
// signing config. GPS rows are derived client-side from horizon + mode +
// gpsHealth.
export function attachClearanceProofs(evidence = {}, requestId, evaluatedAt = new Date().toISOString()) {
  for (const pair of evidence.pairs ?? []) {
    const clearance = [];
    for (const check of pair.checks ?? []) {
      if (check.status !== 'verified') {
        clearance.push({ checkId: check.id ?? null, label: check.label ?? 'Check', status: check.status, proof: null });
        continue;
      }
      const proofType = proofTypeForCheck(check.id);
      // The licence check is a DRIVER record while registration/insurance are the
      // vehicle's, and all three resolve to the same proof type. Carry the
      // subject so the drawer opens the record the check actually cleared.
      const subject = COMPLIANCE_SUBJECT_BY_CHECK[check.id] ?? null;
      let proof = null;
      if (proofType) {
        try {
          proof = {
            type: proofType,
            ref: signEvidenceRef({
              requestId, vehicleId: pair.vehicleId, driverId: pair.driverId,
              proofType,
              recordId: subject === 'driver' ? pair.driverId : pair.vehicleId ?? pair.driverId ?? null,
              subject, evaluatedAt,
            }),
          };
        } catch { proof = null; }
      }
      clearance.push({ checkId: check.id ?? null, label: check.label ?? 'Check', status: check.status, proof });
      if (check.id === 'schedule') {
        // A leave clearance proof is driver-scoped, so it needs a driver to be
        // about. Without one the lookup would run as `driver_id = 0`, match
        // nothing, and resolveLeave would answer "clear" — a clearance for a
        // driver nobody ever looked up, sitting under a check the drawer shows as
        // verified. Same rule as the recovery path: no usable identity, no ref.
        // The row still renders; it simply offers no Review action.
        const leaveDriver = usableRecordIdentity(pair.driverId);
        let leaveProof = null;
        if (leaveDriver != null) {
          try {
            leaveProof = {
              type: EVIDENCE_TYPES.LEAVE,
              ref: signEvidenceRef({
                requestId, vehicleId: pair.vehicleId, driverId: leaveDriver,
                proofType: EVIDENCE_TYPES.LEAVE, recordId: leaveDriver, evaluatedAt,
              }),
            };
          } catch { leaveProof = null; }
        }
        clearance.push({ checkId: 'leave', label: 'Leave', status: check.status, proof: leaveProof });
      }
    }
    pair.clearance = clearance;
    pair.clearanceMeta = {
      horizon: pair.temporalContext?.horizon ?? null,
      // The dispatch mode (IMMEDIATE / REPOSITION / SCHEDULED) is a separate
      // taxonomy from the horizon and is what decides whether live location was
      // applicable at all — REPOSITION never consults it. The inspector needs
      // the mode to say "not applicable" instead of "unknown". Read the
      // projected label first; raw pairs still carry the context.
      mode: pair.dispatchMode ?? pair.dispatchContext?.mode ?? null,
      gpsHealth: pair.gpsHealth ?? null,
      driverId: pair.driverId, vehicleId: pair.vehicleId,
      plate: pair.plate ?? null, driverName: pair.driverName ?? null,
    };
  }
  return evidence;
}

// Attach signed proof refs to pair recovery actions and exclusions.
// Non-fatal: without signing config, actions simply carry no proof.
// Incident blockers mint incident refs (record scope) instead of the generic
// vehicle-status proof, using the projected blocking incident ids.
export function attachEvidenceProofs(evidence = {}, requestId, evaluatedAt = new Date().toISOString()) {
  const sign = (action, pairCtx = {}) => {
    let proofType = proofTypeForRecovery(action);
    // The driver slot means "the driver this claim is about", inferred from
    // `record`. That inference is right for leave and for the driver-licence
    // family, but a pairing block is recorded as record:'schedule' holding the
    // VEHICLE id (decision.js puts ctx.vehicleId there, in both
    // recoveryForCheckId and recoveryActionForExclusion), so the inference read a
    // vehicle number as a driver. resolvePairing then queried
    // `vehicle_id=V AND driver_id=V`, matched nothing, and asserted
    // pairingState:'none' — a definitive negative from an unevaluated check —
    // while resolveEvidence attached the name of whichever driver happens to
    // share that number, the PAIRING allowlist admitting driverName. The pair
    // knows its real driver; take it from there, never from a vehicle id.
    let driverId = proofType === EVIDENCE_TYPES.PAIRING
      ? pairCtx.driverId ?? null
      : action.id != null && (action.record === 'driver' || action.record === 'schedule') ? action.id : null;
    // Compliance spans two record families and the resolver must be told which
    // one the claim is about: a licence block is the driver's record,
    // registration/insurance the vehicle's. Without this, resolveCompliance's
    // vehicle-first branch reported a vehicle's documents for a licence problem.
    const subject = proofType === EVIDENCE_TYPES.COMPLIANCE ? COMPLIANCE_SUBJECT_BY_CODE[action.code] ?? null : null;
    // Leave and the driver-licence family are driver-scoped records and every
    // other type is vehicle-scoped, so those two name the driver the same way the
    // clearance row does.
    let recordId = proofType === EVIDENCE_TYPES.LEAVE || subject === 'driver'
      ? driverId ?? action.id ?? null
      : action.vehicleId ?? action.id ?? null;
    let note = proofType === EVIDENCE_TYPES.VEHICLE_STATUS && action.code === 'UVVRP_RESTRICTED' ? (action.hint ?? null)?.slice(0, 200) : null;
    const incidentMatch = /incident\s*#?(\d+)/i.exec(action.message ?? '');
    const incidentId = pairCtx.incidentIds?.[0] ?? (incidentMatch ? Number(incidentMatch[1]) : null);
    if (action.code === 'VEHICLE_STATUS' && Number.isSafeInteger(incidentId)) {
      proofType = EVIDENCE_TYPES.INCIDENT;
      recordId = incidentId;
      note = null;
    }
    if (!proofType) return null;
    // A proof must carry the identity its record is scoped to, or it resolves the
    // WRONG record. A driver-sourced block (record 'driver' | 'schedule') whose
    // action carries no id is exactly that case: exclusion rows have a reason
    // string and a vehicle id but no driver (dispatch-radar.service.js pushes an
    // INFEASIBLE pair's reasons into none_reasons as `{vehicle_id, reason}`), so
    // recoveryActionForExclusion leaves `id: null`. Minting anyway resolves some
    // other identity's records, and every one of them is a FALSE CLEARANCE
    // against the narration the proof exists to support:
    //   leave    -> resolveLeave matches no row (`WHERE driver_id = NULL`) and
    //               answers "clear"
    //   schedule -> resolveScheduleConflict's `driver_id=$1 OR vehicle_id=$2`
    //               silently narrows to a vehicle-only check
    //   license  -> the subject lane keeps resolveCompliance on the driver branch,
    //               which then has no driver id to read
    // No identity therefore means no ref: the row renders with its reason and no
    // Review action. Vehicle-scoped blocks (maintenance, vehicle status, capacity,
    // incidents) are unaffected — their identity is the vehicle.
    // Pairing is the one driver-sourced action whose identity is really the
    // VEHICLE: decision.js records it as 'schedule' holding ctx.vehicleId, and its
    // driver comes from the pair (see `sign`). It is therefore judged on the
    // vehicle identity rather than on `id`, which for pairing is that same vehicle.
    const driverScoped = action.record === 'driver' || action.record === 'schedule';
    const identity = driverScoped
      ? proofType === EVIDENCE_TYPES.PAIRING
        ? usableRecordIdentity(action.vehicleId) ?? usableRecordIdentity(action.id)
        : usableRecordIdentity(action.id)
      : null;
    if (driverScoped && identity == null) return null;
    try {
      return {
        type: proofType,
        ref: signEvidenceRef({
          requestId,
          vehicleId: action.vehicleId ?? null,
          driverId,
          proofType,
          recordId,
          note,
          subject,
          evaluatedAt,
        }),
      };
    } catch { return null; }
  };
  for (const pair of evidence.pairs ?? []) {
    for (const action of pair.recoveryActions ?? []) action.proof = sign({ ...action, vehicleId: pair.vehicleId }, pair);
  }
  for (const exclusion of evidence.exclusions ?? []) {
    if (exclusion.recovery) exclusion.recovery.proof = sign(exclusion.recovery);
  }
  if (Array.isArray(evidence.recoveryActions)) {
    for (const action of evidence.recoveryActions) action.proof = sign(action);
  }
  return evidence;
}
