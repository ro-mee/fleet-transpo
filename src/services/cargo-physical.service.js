import { query } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';
import { getDispatchPolicy } from './dispatch-settings.service';
import { adaptRequestManifest } from './cargo-manifest.service';
import { evaluateCargoPhysicalLoad } from '@/lib/cargo/physical-load';
import { cargoPhysicalPolicy, cargoPhysicalConflict } from '@/lib/cargo/physical-policy';

const unavailable = (code, blocker) => ({ eligible: false, load_checks_pass: false, status: 'UNKNOWN', code, blocker,
  usable_payload_kg: null, remaining_payload_kg: null, totals: { gross_weight_kg: null, nominal_volume_m3: null },
  checks: [{ id: 'physical_evidence', status: 'UNKNOWN', reason: blocker }], limitations: [], rule_version: null });

export async function readRequestCargoManifests(requestIds, db = { query }) {
  const { rows } = await db.query(`SELECT r.*, st.service_code, m.request_cargo_manifest_revision_id, m.revision,
    m.manifest_hash, m.manifest_snapshot, m.source_organization_id
    FROM transportation_requests r LEFT JOIN service_types st ON st.service_type_id=r.service_type_id
    LEFT JOIN LATERAL (SELECT * FROM request_cargo_manifest_revisions cm WHERE cm.request_id=r.request_id ORDER BY revision DESC LIMIT 1) m ON TRUE
    WHERE r.request_id=ANY($1::int[]) AND r.deleted_at IS NULL`, [requestIds]);
  return rows;
}

/** One request-bound loader shared by advisory and locked commit paths. */
export async function loadCargoPhysicalAssessments(request, vehicleIds, { db = { query }, policy: storedPolicy, now = new Date(), sourceRows, profileRows } = {}) {
  if (request?.load_type !== 'Cargo') return { policy: cargoPhysicalPolicy(), results: new Map() };
  const policy = cargoPhysicalPolicy(storedPolicy ?? await getDispatchPolicy(db));
  if (policy.mode === 'OFF') return { policy, results: new Map() };
  const ids = [...new Set(vehicleIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
  const missing = result => ({ policy, results: new Map(ids.map(id => [id, { ...result, mode: policy.mode }])) });
  if (!policy.configured) return missing(unavailable('CARGO_PHYSICAL_POLICY_REQUIRED', 'Cargo physical checks require a versioned policy and the recorded source, vehicle-standard and mass-basis approvals.'));
  if (!Number.isSafeInteger(Number(request.request_id)) || Number(request.request_id) <= 0) return missing(unavailable('CARGO_MANIFEST_REQUIRED', 'A persisted Cargo request and item manifest are required.'));
  const rows = sourceRows ?? await readRequestCargoManifests([Number(request.request_id)], db);
  const row = rows.find(value => Number(value.request_id) === Number(request.request_id));
  if (!row?.manifest_snapshot) return missing(unavailable('CARGO_MANIFEST_REQUIRED', 'Cargo contents have not been saved by the source. Assignment requires a current physical manifest.'));
  let manifest;
  try { manifest = adaptRequestManifest(row, row); }
  catch (error) {
    if (!error.code?.startsWith('CARGO_')) throw error;
    return missing(unavailable(error.code, error.message));
  }
  const profiles = profileRows ?? (await db.query(`SELECT p.*, v.vehicle_status FROM vehicle_cargo_profiles p
    JOIN vehicles v ON v.vehicle_id=p.vehicle_id AND v.deleted_at IS NULL WHERE p.vehicle_id=ANY($1::int[])`, [ids])).rows;
  return { policy, manifest, results: new Map(ids.map(id => {
    const profile = profiles.find(value => Number(value.vehicle_id) === id);
    const result = evaluateCargoPhysicalLoad({ manifest, profile, declaredWeightKg: row.cargo_weight_kg, now });
    const requiredUntil = Math.max(+new Date(now), +new Date(row.pickup_datetime ?? now), +new Date(request.scheduled_arrival ?? now));
    if (profile && (!Number.isFinite(requiredUntil) || +new Date(profile.verification_valid_until) <= requiredUntil)) {
      result.checks.push({ id: 'profile_service_window', status: 'BLOCK', reason: 'Cargo capability verification must cover the complete planned service window.' });
      result.eligible = false; result.load_checks_pass = false; result.status = 'BLOCK';
      result.code = 'CARGO_PROFILE_SERVICE_WINDOW'; result.blocker = 'Cargo capability verification must cover the complete planned service window.';
    }
    return [id, { ...result, mode: policy.mode }];
  })) };
}

// Queue polls load manifests/profiles once, then use the same per-pair rules.
export async function loadCargoPhysicalBatch(requests, { db = { query }, policy, now = new Date() } = {}) {
  const cargo = requests.filter(request => request.load_type === 'Cargo' && request.vehicle_id);
  const rollout = cargoPhysicalPolicy(policy);
  if (!cargo.length || rollout.mode === 'OFF') return new Map();
  const sourceRows = rollout.configured ? await readRequestCargoManifests(cargo.map(request => Number(request.request_id)), db) : [];
  const profileRows = rollout.configured ? (await db.query(`SELECT p.*, v.vehicle_status FROM vehicle_cargo_profiles p
    JOIN vehicles v ON v.vehicle_id=p.vehicle_id AND v.deleted_at IS NULL WHERE p.vehicle_id=ANY($1::int[])`,
  [[...new Set(cargo.map(request => Number(request.vehicle_id)))]] )).rows : [];
  const out = new Map();
  for (const request of cargo) {
    const context = await loadCargoPhysicalAssessments(request, [request.vehicle_id], { db, policy, now, sourceRows, profileRows });
    out.set(Number(request.request_id), context.results.get(Number(request.vehicle_id)));
  }
  return out;
}

export async function assertCargoPhysicalAssignment({ requestId, vehicleId, returnAt }, db, now = new Date()) {
  if (!requestId || !vehicleId) return null;
  const policy = await getDispatchPolicy(db);
  if (cargoPhysicalPolicy(policy).mode === 'OFF') return null;
  const { rows } = await db.query('SELECT request_id,load_type FROM transportation_requests WHERE request_id=$1 AND deleted_at IS NULL', [requestId]);
  if (!rows[0]) throw new AuthError('The Cargo request is no longer available.', 409, 'CARGO_REQUEST_NOT_FOUND');
  const context = await loadCargoPhysicalAssessments({ ...rows[0], scheduled_arrival: returnAt }, [vehicleId], { db, policy, now });
  const result = context.results.get(Number(vehicleId));
  const conflict = cargoPhysicalConflict(result, context.policy);
  if (conflict?.severity === 'blocking') throw new AuthError(conflict.message, 409, conflict.code);
  return result;
}
