import { createHash } from 'node:crypto';
import { manifestSchema, receiptSchema, decisionSchema, cargoFeedbackSchema, validateReceiptAgainstManifest } from '@/lib/cargo/contracts';
import { assertCargoConfiguration, cargoError } from './cargo-manifest.service';

const fail = (code, message, status = 409) => { throw cargoError(code, message, status); };
const nonblank = value => typeof value === 'string' && value.trim().length > 0;
export function assertCargoStorageConfiguration(config) {
  assertCargoConfiguration(config);
  if (['receivingApprovalRef', 'retentionApprovalRef', 'sourceApprovalRef'].some(key => !nonblank(config[key])) ||
      (config.simulated && (process.env.NODE_ENV === 'production' || !['test', 'development'].includes(config.environment)))) {
    fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo storage authority is not configured.', 503);
  }
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export const cargoPayloadHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) fail('CARGO_INVALID_INPUT', 'Invalid cargo record.', 400);
  return result.data;
};

// actor is the authenticated server session, never a body field. Staff writes need a later dedicated interface.
export async function assertCargoDriver(tripId, actor, tx) {
  assertCargoStorageConfiguration(tx?.cargoConfig);
  const user = actor?.user;
  if (!Number.isSafeInteger(tripId) || tripId <= 0 || user?.role !== 'driver' || !Number.isSafeInteger(user.driverId) || !Number.isSafeInteger(user.employeeId)) fail('CARGO_TRIP_NOT_FOUND', 'Cargo trip was not found.', 404);
  const row = (await tx.query(`SELECT t.trip_id,t.dispatch_id,t.driver_id FROM trips t JOIN drivers d ON d.driver_id=t.driver_id
    WHERE t.trip_id=$1 AND t.deleted_at IS NULL AND d.driver_id=$2 AND d.employee_id=$3 FOR UPDATE OF t`, [tripId, user.driverId, user.employeeId])).rows[0];
  if (!row) fail('CARGO_TRIP_NOT_FOUND', 'Cargo trip was not found.', 404);
  return row;
}

export async function loadExecutionForUpdate(tripId, tx) {
  const trip = await assertCargoDriver(tripId, tx?.cargoActor, tx);
  const existing = (await tx.query('SELECT * FROM cargo_trip_executions WHERE trip_id=$1 FOR UPDATE', [tripId])).rows[0];
  if (existing) return existing;
  // Both branches use persisted dispatch linkage. The DB trigger independently checks it.
  const request = (await tx.query(`SELECT m.* FROM dispatchschedules d JOIN request_cargo_manifest_revisions m ON m.request_id=d.request_id
    WHERE d.dispatch_id=$1 AND d.service_type IS DISTINCT FROM 'SUPPLY_DELIVERY' ORDER BY m.revision DESC LIMIT 1 FOR UPDATE OF d`, [trip.dispatch_id])).rows[0];
  let manifest, allocationId = null;
  if (request) {
    manifest = parse(manifestSchema, { ...request.manifest_snapshot, manifest_ref: { kind: 'REQUEST', id: request.request_cargo_manifest_revision_id, revision: request.revision, hash: request.manifest_hash } });
  } else {
    const { resolveTripManifest } = await import('./cargo-manifest.service');
    manifest = await resolveTripManifest(tripId, tx);
    const allocations = (await tx.query(`SELECT supply_dispatch_allocation_id FROM supply_dispatch_allocations WHERE dispatch_id=$1 AND allocation_status='ASSIGNED' FOR UPDATE`, [trip.dispatch_id])).rows;
    if (manifest?.manifest_ref.kind !== 'SUPPLY' || allocations.length !== 1) fail('CARGO_MANIFEST_REQUIRED', 'A bound cargo manifest is required.');
    allocationId = allocations[0].supply_dispatch_allocation_id;
  }
  return (await tx.query(`INSERT INTO cargo_trip_executions(trip_id,request_manifest_id,supply_allocation_id,manifest)
    VALUES($1,$2,$3,$4::jsonb) RETURNING *`, [tripId, request?.request_cargo_manifest_revision_id || null, allocationId, JSON.stringify(manifest)])).rows[0];
}

export async function insertReceipt(input, actor, tx) {
  assertCargoStorageConfiguration(tx?.cargoConfig);
  const payload = parse(receiptSchema, input);
  const execution = await loadExecutionForUpdate(tx.cargoTripId, { ...tx, cargoActor: actor });
  const hash = cargoPayloadHash({ payload, employeeId: actor.user.employeeId, driverId: actor.user.driverId });
  const replay = (await tx.query('SELECT * FROM cargo_receipts WHERE execution_id=$1 AND submission_id=$2', [execution.execution_id, payload.submission_id])).rows[0];
  if (replay) {
    if (replay.payload_hash !== hash) fail('CARGO_REPLAY_CONFLICT', 'Submission was already used for different content.');
    return replay;
  }
  if (cargoPayloadHash(payload.manifest_ref) !== cargoPayloadHash(execution.manifest.manifest_ref)) fail('CARGO_MANIFEST_CONFLICT', 'The manifest has changed.');
  try { validateReceiptAgainstManifest(payload, execution.manifest); } catch { fail('CARGO_INVALID_RECEIPT', 'Observe every manifest line using its quantity basis.', 400); }
  const evidenceIds = payload.lines.flatMap(line => line.evidence_ids);
  if (new Set(evidenceIds).size !== evidenceIds.length) fail('CARGO_INVALID_EVIDENCE', 'Evidence may be attached once per receipt.', 400);
  for (const evidenceId of evidenceIds) {
    const row = (await tx.query(`SELECT evidence_id FROM cargo_evidence WHERE evidence_id=$1 AND execution_id=$2 AND submission_id=$3
      AND uploader_employee_id=$4 AND uploader_driver_id=$5 AND state='READY' FOR UPDATE`, [evidenceId, execution.execution_id, payload.submission_id, actor.user.employeeId, actor.user.driverId])).rows[0];
    if (!row) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo evidence was not found.', 404);
  }
  const row = (await tx.query(`INSERT INTO cargo_receipts(execution_id,stage,manifest_ref,manifest_hash,submission_id,payload_hash,payload,lines,
    reporter_employee_id,reporter_driver_id,observed_at,receiver_confirmation_ref,execution_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
  [execution.execution_id, payload.stage, JSON.stringify(payload.manifest_ref), payload.manifest_ref.hash, payload.submission_id, hash, JSON.stringify(payload), JSON.stringify(payload.lines), actor.user.employeeId, actor.user.driverId, payload.observed_at, payload.receiver_confirmation_ref, execution.version + 1])).rows[0];
  if (evidenceIds.length) await tx.query("UPDATE cargo_evidence SET state='ATTACHED',receipt_id=$1,updated_at=now() WHERE evidence_id=ANY($2::uuid[])", [row.receipt_id, evidenceIds]);
  const updated = (await tx.query('UPDATE cargo_trip_executions SET version=version+1,updated_at=now() WHERE execution_id=$1 RETURNING *', [execution.execution_id])).rows[0];
  await appendCargoFeedback({ execution: updated, eventType: payload.stage === 'PICKUP' ? 'PICKUP_RECORDED' : 'DELIVERY_RECORDED', receipt: row }, tx);
  if (payload.lines.some(line => line.issue_code !== null || line.condition === 'DAMAGED' || line.observed_quantity !== execution.manifest.lines.find(original => original.line_id === line.line_id).expected_quantity)) {
    await appendCargoFeedback({ execution: updated, eventType: 'DISCREPANCY_REPORTED', receipt: row }, tx);
  }
  return row;
}

export async function appendCargoDecision(input, principal, tx) {
  assertCargoStorageConfiguration(tx?.cargoConfig);
  const payload = parse(decisionSchema, input);
  if (!principal?.capabilities?.includes('cargo:decision:write') || !nonblank(principal.subject) || principal.subject.length > 255 || !nonblank(principal.organization_id)) fail('CARGO_SOURCE_FORBIDDEN', 'Source decision authority is required.', 403);
  const identity = (await tx.query('SELECT execution_id FROM cargo_receipts WHERE receipt_id=$1', [payload.receipt_id])).rows[0];
  if (!identity) fail('CARGO_RECEIPT_NOT_FOUND', 'Cargo receipt was not found.', 404);
  const execution = (await tx.query('SELECT * FROM cargo_trip_executions WHERE execution_id=$1 FOR UPDATE', [identity.execution_id])).rows[0];
  if (execution.manifest.source_ref.system !== principal.system || execution.manifest.source_ref.organization_id !== principal.organization_id) fail('CARGO_SOURCE_FORBIDDEN', 'Receipt belongs to another source.', 403);
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([principal.system, principal.organization_id, payload.event_id])]);
  const hash = cargoPayloadHash({ payload, principal: principal.subject });
  const replay = (await tx.query('SELECT * FROM cargo_decision_inbox WHERE source_system=$1 AND source_organization_id=$2 AND event_id=$3', [principal.system, principal.organization_id, payload.event_id])).rows[0];
  if (replay) {
    if (replay.payload_hash !== hash) fail('CARGO_REPLAY_CONFLICT', 'Source event was already used for different content.');
    return replay.response;
  }
  const receipt = (await tx.query('SELECT * FROM cargo_receipts WHERE receipt_id=$1', [payload.receipt_id])).rows[0];
  if (receipt.manifest_hash !== payload.manifest_hash || execution.manifest.manifest_ref.hash !== payload.manifest_hash) fail('CARGO_MANIFEST_CONFLICT', 'Decision manifest does not match receipt.');
  const row = (await tx.query(`INSERT INTO cargo_decisions(receipt_id,action,manifest_hash,source_system,source_organization_id,principal_ref,reason,event_id,payload_hash,payload,execution_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [payload.receipt_id, payload.action, payload.manifest_hash, principal.system, principal.organization_id, principal.subject, payload.reason, payload.event_id, hash, JSON.stringify(payload), execution.version + 1])).rows[0];
  // JSON response is the stable transport representation, including the first server timestamp.
  const response = JSON.parse(JSON.stringify(row));
  await tx.query(`INSERT INTO cargo_decision_inbox(source_system,source_organization_id,event_id,payload_hash,response,receipt_id,actor_ref,decision_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [principal.system, principal.organization_id, payload.event_id, hash, JSON.stringify(response), payload.receipt_id, principal.subject, row.decision_id]);
  const updated = (await tx.query('UPDATE cargo_trip_executions SET version=version+1,updated_at=now() WHERE execution_id=$1 RETURNING *', [execution.execution_id])).rows[0];
  await appendCargoFeedback({ execution: updated, eventType: 'SOURCE_DECISION_RECORDED', receipt, decision: row }, tx);
  return response;
}

export async function appendCargoFeedback({ execution, eventType, receipt = null, decision = null }, tx) {
  assertCargoStorageConfiguration(tx?.cargoConfig);
  const payload = parse(cargoFeedbackSchema, { execution_id: execution?.execution_id, execution_version: execution?.version,
    source_ref: execution?.manifest?.source_ref, manifest_ref: execution?.manifest?.manifest_ref, event_type: eventType,
    receipt: receipt ? { receipt_id: receipt.receipt_id, payload: receipt.payload } : null,
    decision: decision ? { decision_id: decision.decision_id, payload: decision.payload } : null });
  const bound = (await tx.query('SELECT * FROM cargo_trip_executions WHERE execution_id=$1 FOR UPDATE', [execution.execution_id])).rows[0];
  if (!bound || cargoPayloadHash(bound.manifest) !== cargoPayloadHash(execution.manifest)) fail('CARGO_EVENT_CONFLICT', 'Event does not match the locked execution.');
  // Never accept an otherwise well-formed foreign or invented receipt/decision object.
  if (receipt) {
    const stored = (await tx.query('SELECT payload FROM cargo_receipts WHERE receipt_id=$1 AND execution_id=$2', [receipt.receipt_id, execution.execution_id])).rows[0];
    if (!stored || cargoPayloadHash(stored.payload) !== cargoPayloadHash(receipt.payload)) fail('CARGO_EVENT_CONFLICT', 'Event receipt does not match.');
  }
  if (decision) {
    const stored = (await tx.query('SELECT payload FROM cargo_decisions WHERE decision_id=$1 AND receipt_id=$2', [decision.decision_id, receipt.receipt_id])).rows[0];
    if (!stored || cargoPayloadHash(stored.payload) !== cargoPayloadHash(decision.payload)) fail('CARGO_EVENT_CONFLICT', 'Event decision does not match.');
  }
  const hash = cargoPayloadHash(payload);
  const replay = (await tx.query(`SELECT event_id,payload_hash FROM cargo_feedback_outbox WHERE execution_id=$1 AND execution_version=$2
    AND event_type=$3 AND receipt_id IS NOT DISTINCT FROM $4::uuid`, [execution.execution_id, execution.version, eventType, receipt?.receipt_id || null])).rows[0];
  if (replay) {
    if (replay.payload_hash !== hash) fail('CARGO_REPLAY_CONFLICT', 'Event has different content.');
    return replay.event_id;
  }
  // Existing immutable events remain replayable after later receipts/decisions.
  // Only creation needs the current version; all source/record checks above
  // still apply before returning a historical event's stable identity.
  if (bound.version !== execution.version) fail('CARGO_EVENT_CONFLICT', 'New event does not match the current execution version.');
  return (await tx.query(`INSERT INTO cargo_feedback_outbox(execution_id,execution_version,source_system,source_organization_id,event_type,receipt_id,decision_id,payload,payload_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING event_id`, [execution.execution_id, execution.version, payload.source_ref.system, payload.source_ref.organization_id, eventType, receipt?.receipt_id || null, decision?.decision_id || null, JSON.stringify(payload), hash])).rows[0].event_id;
}
