import { createHash } from 'node:crypto';
import { manifestSchema, requestManifestEnvelopeSchema, cargoServiceSchema } from '@/lib/cargo/contracts';

export function cargoError(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}
const fail = (code, message, status) => { throw cargoError(code, message, status); };
const nonblank = value => typeof value === 'string' && value.trim().length > 0;

// A future approved server configuration provider must supply this contract.
// There is deliberately no environment parser or installed operational mapping.
export function assertCargoConfiguration(config) {
  if (!config || !nonblank(config.dataApprovalRef) || !nonblank(config.privacyApprovalRef) || config.schemaReady !== true ||
      (config.simulated && !['test', 'development'].includes(config.environment))) {
    fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo manifest intake is not configured.', 503);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const hashManifest = manifest => createHash('sha256').update(JSON.stringify(canonical(manifest))).digest('hex');
const reference = row => ({ kind: 'REQUEST', id: row.request_cargo_manifest_revision_id, revision: row.revision, hash: row.manifest_hash });

export function adaptSupplyManifest(row, serviceCode) {
  if (!cargoServiceSchema.safeParse(serviceCode).success) fail('CARGO_SERVICE_REQUIRED', 'An approved cargo service mapping is required.');
  return manifestSchema.parse({
    manifest_ref: { kind: 'SUPPLY', id: row.supply_manifest_revision_id, revision: row.manifest_revision, hash: row.manifest_hash },
    source_ref: { system: 'SCM', organization_id: row.source_organization_id, external_request_id: row.external_request_id },
    service_code: serviceCode,
    lines: row.manifest_snapshot?.lines?.map(line => ({
      line_id: line.external_line_id, name: line.description || line.sku_ref,
      quantity_basis: 'TRANSPORT_PACKAGE', expected_quantity: String(line.transport_package_count), unit: 'packages', reference_image_ref: null, handling: line.handling || [],
    })),
  });
}

export async function resolveTripManifest(tripId, db) {
  const { rows } = await db.query(`SELECT d.request_id, d.service_type, r.load_type, r.source_system, r.external_request_id, st.service_code, d.dispatch_id
    FROM trips t JOIN dispatchschedules d ON d.dispatch_id=t.dispatch_id
    LEFT JOIN transportation_requests r ON r.request_id=d.request_id
    LEFT JOIN service_types st ON st.service_type_id=r.service_type_id WHERE t.trip_id=$1`, [tripId]);
  if (!rows.length) return null;
  const trip = rows[0];
  if (trip.service_type === 'SUPPLY_DELIVERY') {
    if (trip.request_id != null) fail('CARGO_LINKAGE_CONFLICT', 'Cargo trip source linkage conflicts.');
    const result = await db.query(`SELECT m.*, s.source_organization_id, s.external_request_id
      FROM supply_dispatch_allocations a JOIN supply_shipments s ON s.supply_shipment_id=a.supply_shipment_id
      JOIN supply_manifest_revisions m ON m.supply_shipment_id=a.supply_shipment_id AND m.manifest_revision=a.manifest_revision
      WHERE a.dispatch_id=$1 AND a.allocation_status='ASSIGNED' AND a.manifest_revision=s.current_manifest_revision`, [trip.dispatch_id]);
    if (result.rows.length !== 1) fail('CARGO_MANIFEST_REQUIRED', 'A current cargo manifest is required.');
    const row = result.rows[0];
    const mappings = db.cargoConfig?.supplyServices?.filter(mapping => mapping.system === 'SCM' && mapping.organization_id === row.source_organization_id && mapping.external_request_id === row.external_request_id && nonblank(mapping.approval_ref)) || [];
    return adaptSupplyManifest(row, mappings.length === 1 ? mappings[0].service_code : null);
  }
  if (trip.load_type === 'Passenger') return null;
  if (trip.request_id == null || trip.load_type !== 'Cargo') fail('CARGO_LINKAGE_CONFLICT', 'Cargo trip source linkage is missing.');
  // Candidate table is deliberately not queried before schema readiness.
  if (db.cargoConfig?.schemaReady !== true) fail('CARGO_MANIFEST_REQUIRED', 'An item manifest is required for this cargo request.');
  const result = await db.query('SELECT * FROM request_cargo_manifest_revisions WHERE request_id=$1 ORDER BY revision DESC LIMIT 1', [trip.request_id]);
  const row = result.rows[0];
  if (!row) fail('CARGO_MANIFEST_REQUIRED', 'An item manifest is required for this cargo request.');
  const view = manifestSchema.parse({ ...row.manifest_snapshot, manifest_ref: reference(row) });
  if (view.source_ref.system !== trip.source_system || view.source_ref.external_request_id !== trip.external_request_id || view.service_code !== trip.service_code || hashManifest(row.manifest_snapshot) !== row.manifest_hash) fail('CARGO_LINKAGE_CONFLICT', 'Cargo manifest identity does not match its request.');
  return view;
}

export async function ingestRequestManifest(input, principal, db) {
  assertCargoConfiguration(db?.cargoConfig);
  if (!principal || !['PMS', 'POS'].includes(principal.system) || !nonblank(principal.organization_id) || !principal.capabilities?.includes('cargo:manifest:write')) fail('CARGO_SOURCE_FORBIDDEN', 'This source cannot attach a request manifest.', 403);
  const parsed = requestManifestEnvelopeSchema.safeParse(input);
  if (!parsed.success) fail('CARGO_INVALID_MANIFEST', 'Invalid cargo manifest.', 400);
  const envelope = parsed.data, source = envelope.manifest.source_ref;
  if (source.system !== principal.system || source.organization_id !== principal.organization_id) fail('CARGO_SOURCE_FORBIDDEN', 'Manifest source does not match authenticated source.', 403);
  const scopes = db.cargoConfig.requestOwnership?.filter(scope => scope.system === principal.system && scope.external_request_id === source.external_request_id) || [];
  if (scopes.length !== 1 || scopes[0].organization_id !== principal.organization_id) fail('CARGO_SOURCE_SCOPE_REQUIRED', 'Trusted request organization ownership is required.', 403);
  if (envelope.manifest.lines.some(line => line.quantity_basis === 'UNIT') && !nonblank(scopes[0].unitContractApprovalRef)) fail('CARGO_UNIT_CONTRACT_REQUIRED', 'Unit-level quantities require an approved source contract.', 503);
  // Photo ownership/retention does not exist yet. Never accept arbitrary private IDs as approved references.
  if (envelope.manifest.lines.some(line => line.reference_image_ref !== null)) fail('CARGO_REFERENCE_POLICY_REQUIRED', 'Source image references are not enabled.', 503);
  const manifestHash = hashManifest(envelope.manifest);
  return db.withTransaction(async tx => {
    const request = (await tx.query(`SELECT r.*, st.service_code FROM transportation_requests r
      JOIN service_types st ON st.service_type_id=r.service_type_id
      WHERE r.source_system=$1 AND r.external_request_id=$2 FOR UPDATE OF r`, [principal.system, source.external_request_id])).rows[0];
    if (!request || request.deleted_at) fail('CARGO_REQUEST_NOT_FOUND', 'Cargo request was not found.', 404);
    if (request.load_type !== 'Cargo' || request.service_code !== envelope.manifest.service_code) fail('CARGO_SERVICE_CONFLICT', 'Manifest service does not match the cargo request.');
    // Serialize events across requests as well as revisions of this request.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([principal.system, principal.organization_id, envelope.event_id])]);
    const replay = (await tx.query(`SELECT * FROM request_cargo_manifest_revisions
      WHERE source_system=$1 AND source_organization_id=$2 AND source_event_id=$3`, [principal.system, principal.organization_id, envelope.event_id])).rows[0];
    if (replay) {
      if (replay.request_id !== request.request_id || replay.revision !== envelope.revision || replay.manifest_hash !== manifestHash) fail('CARGO_REPLAY_CONFLICT', 'This source event has different manifest content.');
      return { manifest_ref: reference(replay), replayed: true };
    }
    const latest = (await tx.query('SELECT * FROM request_cargo_manifest_revisions WHERE request_id=$1 ORDER BY revision DESC LIMIT 1', [request.request_id])).rows[0];
    if (envelope.revision !== (latest?.revision || 0) + 1) fail('CARGO_REVISION_CONFLICT', 'Manifest revisions must arrive in order.');
    if (latest && (latest.source_system !== principal.system || latest.source_organization_id !== principal.organization_id)) fail('CARGO_SOURCE_FORBIDDEN', 'Manifest ownership cannot change.', 403);
    // Task 5 will implement custody and reference invalidation. No guessed-table SQL.
    if (latest) fail('CARGO_REVISION_REVIEW_REQUIRED', 'Manifest changes require custody checks and rescheduling review.');
    const dispatches = await tx.query('SELECT dispatch_id FROM dispatchschedules WHERE request_id=$1 FOR UPDATE', [request.request_id]);
    if (dispatches.rows.length) fail('CARGO_REVISION_REVIEW_REQUIRED', 'Dispatched work requires custody checks before attaching an item manifest.');
    const row = (await tx.query(`INSERT INTO request_cargo_manifest_revisions
      (request_id,revision,manifest_hash,source_system,source_organization_id,source_external_request_id,source_event_id,manifest_snapshot)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`, [request.request_id, envelope.revision, manifestHash, principal.system, principal.organization_id, source.external_request_id, envelope.event_id, JSON.stringify(envelope.manifest)])).rows[0];
    return { manifest_ref: reference(row), replayed: false };
  });
}
