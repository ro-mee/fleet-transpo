import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { writeAuditRequired } from '@/lib/audit';
import { receiptSchema, decisionSchema, validateReceiptAgainstManifest } from '@/lib/cargo/contracts';
import { deriveCargoState, matchesCargoAuthorityProof } from '@/lib/cargo/execution-state';
import { cargoError, resolveTripManifest } from './cargo-manifest.service';
import { canTransitionTrip, isPreStartTripStatus } from '@/lib/scheduling/trip-state';
import { AuthError } from '@/lib/api/utils';
import { assertCargoStorageConfiguration, assertCargoDriver, loadExecutionForUpdate, insertReceipt, appendCargoDecision, appendManualCargoDecision, cargoPayloadHash } from './cargo-execution.repository';
import { manualDecisionSchema, manualAuthorityProofSchema } from '@/lib/cargo/manual-decision';
import { rolesFor } from '@/lib/auth/permissions';

const fail = (code, message, status = 409) => { throw cargoError(code, message, status); };
const disabled = async () => fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo execution authority is not configured.', 503);
// Only an explicitly constructed nonproduction service can bind a transaction.
// No request field, environment value or runtime setter installs a provider.
const lifecycleTransactions = new WeakMap();
export function cargoLifecycleEnabled(tx) {
  return lifecycleTransactions.has(tx) || (process.env.CARGO_LIFECYCLE_MODE ?? 'OFF') !== 'OFF';
}
export async function prepareCargoLifecycle(tx) {
  if (!cargoLifecycleEnabled(tx)) return false;
  if (!lifecycleTransactions.has(tx) || process.env.NODE_ENV === 'production') throw new AuthError('Cargo execution authority is not configured.', 503, 'CARGO_CONFIGURATION_REQUIRED');
  await tx.query('LOCK TABLE drivers IN SHARE ROW EXCLUSIVE MODE');
  return true;
}
export async function assertCargoCheckpoint(trip, transition, tx) {
  if (!cargoLifecycleEnabled(tx)) return null;
  if (!lifecycleTransactions.has(tx) || process.env.NODE_ENV === 'production') throw new AuthError('Cargo execution authority is not configured.', 503, 'CARGO_CONFIGURATION_REQUIRED');
  try { return await lifecycleTransactions.get(tx)(trip, transition, tx); }
  catch (error) {
    if (error.code?.startsWith('CARGO_')) throw new AuthError(error.message, error.status, error.code);
    throw error;
  }
}
export const submitCargoReceipt = disabled;
export const recordSourceDecision = disabled;
export const clearCargoDeparture = disabled;
export const getCargoExecution = disabled;
export const recordManualCargoDecision = disabled;
export const recordCargoEvidenceUpload = disabled;
const json = value => JSON.parse(JSON.stringify(value));
const parse = (schema, input) => { const result = schema.safeParse(input); if (!result.success) fail('CARGO_INVALID_INPUT', 'Invalid cargo command.', 400); return result.data; };
const clearanceSchema = z.object({ receipt_id: z.string().uuid(), expected_version: z.number().int().positive(), reason: z.string().trim().min(1).max(2000) }).strict();
// Trip Started is travel TO pickup. Loaded cargo, legacy progress and terminal
// states must not accept new source instructions or pickup recounts.
const beforeCustody = status => ['Trip Started', 'At Pickup'].includes(status);
const atDelivery = status => ['Drop-off', 'Arrived'].includes(status);

/** Explicit simulated fixture seam. No operational provider is installed. */
export function createCargoExecutionService({ db, config, authorizeFleet, authorizeStaffRead, authorizeManualRecord, authorizeLifecycle, resolveManualAuthority, resolveSafetyProof, resolveReceiverProof } = {}) {
  const configured = () => {
    assertCargoStorageConfiguration(config);
    if (config.simulated !== true || process.env.NODE_ENV === 'production' || !['test', 'development'].includes(config.environment) ||
      !config.safetyApprovalRef?.trim() || !config.fleetApprovalRef?.trim() || typeof db?.withTransaction !== 'function') {
      fail('CARGO_CONFIGURATION_REQUIRED', 'Simulated cargo execution needs explicit nonproduction configuration.', 503);
    }
  };
  configured();
  async function transact(tripId, actor, mode, work) {
    configured();
    if (!Number.isSafeInteger(tripId) || tripId <= 0) fail('CARGO_TRIP_NOT_FOUND', 'Cargo trip was not found.', 404);
    if (mode === 'source' && (!actor?.capabilities?.includes('cargo:decision:write') || typeof actor.subject !== 'string' || !actor.subject.trim() || actor.subject.length > 255)) fail('CARGO_SOURCE_FORBIDDEN', 'Source authority is required.', 403);
    if (mode === 'fleet' && (actor?.user?.role === 'driver' || !Number.isSafeInteger(actor?.user?.employeeId))) fail('CARGO_FLEET_FORBIDDEN', 'Fleet authority is required.', 403);
    const result = await db.withTransaction(async base => {
      const tx = { ...base, cargoConfig: config, cargoTripId: tripId, cargoActor: actor };
      // Compose with dispatch evidence: fleet table before driver row, then trip,
      // dispatch/manifest and execution. Never upgrade the drivers lock afterward.
      await tx.query('LOCK TABLE drivers IN SHARE ROW EXCLUSIVE MODE');
      await tx.query('SELECT driver_id FROM drivers WHERE driver_id=(SELECT driver_id FROM trips WHERE trip_id=$1) FOR UPDATE', [tripId]);
      const trip = (await tx.query('SELECT * FROM trips WHERE trip_id=$1 AND deleted_at IS NULL FOR UPDATE', [tripId])).rows[0];
      if (!trip) fail('CARGO_TRIP_NOT_FOUND', 'Cargo trip was not found.', 404);
      await tx.query('SELECT dispatch_id FROM dispatchschedules WHERE dispatch_id=$1 FOR UPDATE', [trip.dispatch_id]);
      if (mode === 'driver') await assertCargoDriver(tripId, actor, tx);
      if (mode === 'manual') {
        if (!config.manualDecisionApprovalRef?.trim() || !authorizeManualRecord || !resolveManualAuthority) fail('CARGO_CONFIGURATION_REQUIRED', 'Manual source authority is not configured.', 503);
        if (!rolesFor('cargo','manual_decision').includes(actor?.user?.role) || actor?.user?.role === 'driver' || !Number.isSafeInteger(actor?.user?.employeeId)) fail('CARGO_SOURCE_FORBIDDEN', 'Approved manual recording authority is required.', 403);
        const employee = (await tx.query('SELECT employee_id FROM employees WHERE employee_id=$1 FOR SHARE', [actor.user.employeeId])).rows[0];
        if (!employee || await authorizeManualRecord({ session: actor, trip, tx, approvalRef: config.manualDecisionApprovalRef }) !== true) fail('CARGO_SOURCE_FORBIDDEN', 'Approved manual recording authority is required.', 403);
        tx.cargoManualRecordApproved = true;
      }
      if (mode === 'staffRead') {
        const employee = Number.isSafeInteger(actor?.user?.employeeId) && (await tx.query('SELECT employee_id FROM employees WHERE employee_id=$1 FOR SHARE', [actor.user.employeeId])).rows[0];
        if (!employee || !config.staffReadApprovalRef?.trim() || !authorizeStaffRead || await authorizeStaffRead({ session: actor, tripId, trip, tx, approvalRef: config.staffReadApprovalRef }) !== true) fail('CARGO_FORBIDDEN', 'Approved staff cargo read authority is required.', 403);
      }
      if (mode === 'fleet') {
        const employee = (await tx.query('SELECT employee_id FROM employees WHERE employee_id=$1 FOR SHARE', [actor.user.employeeId])).rows[0];
        if (!employee || !authorizeFleet || await authorizeFleet({ session: actor, trip, tx, approvalRef: config.fleetApprovalRef }) !== true) fail('CARGO_FLEET_FORBIDDEN', 'Fleet authority is required.', 403);
      }
      let execution = (await tx.query('SELECT * FROM cargo_trip_executions WHERE trip_id=$1 FOR UPDATE', [tripId])).rows[0];
      if (mode === 'source' && execution && (actor.system !== execution.manifest.source_ref.system || actor.organization_id !== execution.manifest.source_ref.organization_id)) fail('CARGO_SOURCE_FORBIDDEN', 'Cargo belongs to another source.', 403);
      return work({ tx, trip, execution, createExecution: async () => execution ??= await loadExecutionForUpdate(tripId, tx) });
    });
    // Persist a sanitized late-attempt audit, then report refusal outside commit.
    if (result?.lateDecision) fail('CARGO_CUSTODY_LOCKED', 'Cargo custody prevents a new source decision.');
    return result;
  }
  const requireExecution = execution => { if (!execution) fail('CARGO_TRIP_NOT_FOUND', 'Cargo execution was not found.', 404); };
  async function rowsFor(execution, tx) {
    const receipts = (await tx.query('SELECT DISTINCT ON (stage) * FROM cargo_receipts WHERE execution_id=$1 ORDER BY stage,execution_version DESC LIMIT 2', [execution.execution_id])).rows;
    const pickup = receipts.find(row => row.stage === 'PICKUP') ?? null, delivery = receipts.find(row => row.stage === 'DELIVERY') ?? null;
    const decision = pickup ? (await tx.query('SELECT * FROM cargo_decisions WHERE receipt_id=$1 ORDER BY execution_version DESC LIMIT 1', [pickup.receipt_id])).rows[0] ?? null : null;
    if (decision) {
      const provenance = (await tx.query('SELECT to_jsonb(p) AS provenance FROM cargo_manual_decision_provenance p WHERE decision_id=$1', [decision.decision_id])).rows[0]?.provenance;
      if (provenance) decision.manual_provenance = provenance;
    }
    const clearance = (await tx.query('SELECT * FROM cargo_fleet_clearances WHERE execution_id=$1 ORDER BY version DESC LIMIT 1', [execution.execution_id])).rows[0] ?? null;
    return { pickup, delivery, decision, clearance };
  }
  async function view(execution, tx, fresh = {}) {
    const records = await rowsFor(execution, tx);
    if (records.delivery) {
      const saved = (await tx.query("SELECT response FROM cargo_execution_commands WHERE receipt_id=$1 AND command_kind='RECEIPT'", [records.delivery.receipt_id])).rows[0];
      records.delivery.receiver_proof = approvedProof(fresh.receiverProof ?? saved?.response?.delivery_receipt?.receiver_proof, 'RECEIVER_CONFIRMATION', records.delivery, config.receivingApprovalRef);
    }
    if (records.clearance) {
      const saved = (await tx.query("SELECT response FROM cargo_execution_commands WHERE clearance_id=$1 AND command_kind='CLEARANCE'", [records.clearance.clearance_id])).rows[0];
      records.clearance.safety_proof = approvedProof(fresh.safetyProof ?? saved?.response?.fleet_clearance?.safety_proof, 'POST_LOAD_SECUREMENT', records.pickup, config.safetyApprovalRef);
      const trip = (await tx.query('SELECT driver_id,vehicle_id FROM trips WHERE trip_id=$1', [execution.trip_id])).rows[0];
      const binding = fresh.assignment ?? saved?.response?.fleet_clearance?.assignment;
      records.clearance.assignment = binding ?? null;
      if (!binding || !Number.isSafeInteger(binding.driver_id) || !Number.isSafeInteger(binding.vehicle_id) || binding.driver_id !== trip?.driver_id || binding.vehicle_id !== trip?.vehicle_id) records.clearance.safety_proof = null;
    }
    const feedback = (await tx.query('SELECT status AS state,last_error_code FROM cargo_feedback_outbox WHERE execution_id=$1 ORDER BY execution_version DESC,created_at DESC LIMIT 1', [execution.execution_id])).rows[0] ?? { state: 'PENDING', last_error_code: null };
    return json({ execution_id: execution.execution_id, trip_id: execution.trip_id, version: execution.version, manifest: execution.manifest,
      pickup_receipt: records.pickup, delivery_receipt: records.delivery, source_decision: records.decision, fleet_clearance: records.clearance,
      ...deriveCargoState({ manifest: execution.manifest, ...records }), feedback });
  }
  async function replay(execution, kind, key, hash, tx) {
    const old = (await tx.query('SELECT * FROM cargo_execution_commands WHERE execution_id=$1 AND command_kind=$2 AND command_key=$3', [execution.execution_id, kind, key])).rows[0];
    if (old && old.payload_hash !== hash) fail('CARGO_REPLAY_CONFLICT', 'Command identity already has different content.');
    return old?.response;
  }
  async function save(execution, kind, key, hash, record, actor, tx, fresh) {
    const response = await view(execution, tx, fresh), commandId = randomUUID();
    if (kind === 'EVIDENCE') response.evidence_upload = { evidence_id: record.evidence_id };
    const audit = await writeAuditRequired(tx, null, kind === 'DECISION' ? null : actor, { action: `cargo_${kind.toLowerCase()}`, resource: 'cargo_execution', resourceId: execution.trip_id,
      newValues: { command_id: commandId, execution_id: execution.execution_id, kind, source: kind === 'DECISION' ? execution.manifest.source_ref.system : 'FLEET' } });
    if (!audit?.log_id) throw new Error('Required cargo audit was not persisted.');
    await tx.query(`INSERT INTO cargo_execution_commands(command_id,execution_id,command_kind,command_key,payload_hash,receipt_id,decision_id,clearance_id,audit_log_id,response,evidence_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [commandId, execution.execution_id, kind, key, hash, kind === 'EVIDENCE' ? null : record.receipt_id, ['DECISION','MANUAL_DECISION'].includes(kind) ? record.decision_id : null, kind === 'CLEARANCE' ? record.clearance_id : null, audit.log_id, JSON.stringify(response), kind === 'EVIDENCE' ? record.evidence_id : null]);
    return response;
  }
  const updated = async (execution, tx) => (await tx.query('SELECT * FROM cargo_trip_executions WHERE execution_id=$1', [execution.execution_id])).rows[0];
  function approvedProof(candidate, kind, receipt, approvalRef) {
    return matchesCargoAuthorityProof(candidate, kind, receipt) && candidate.approval_ref === approvalRef && candidate.simulated === true && candidate.method === 'simulated-fixture' ? candidate : null;
  }
  async function checkpoint(identity, { to, session, patch = {} }, tx) {
    configured();
    if (!config.lifecycleApprovalRef?.trim() || !authorizeLifecycle) return disabled();
    // Drivers TABLE is acquired by prepareCargoLifecycle before any parent row.
    await tx.query('SELECT driver_id FROM drivers WHERE driver_id=(SELECT driver_id FROM trips WHERE trip_id=$1) FOR UPDATE', [identity.trip_id]);
    const trip = (await tx.query('SELECT * FROM trips WHERE trip_id=$1 AND deleted_at IS NULL FOR UPDATE', [identity.trip_id])).rows[0];
    if (!trip) fail('CARGO_TRIP_NOT_FOUND', 'Cargo trip was not found.', 404);
    if (session?.user?.role === 'driver') await assertCargoDriver(trip.trip_id, session, tx);
    else if (!Number.isSafeInteger(session?.user?.employeeId) || !(await tx.query('SELECT employee_id FROM employees WHERE employee_id=$1 FOR SHARE', [session.user.employeeId])).rows[0]
      || await authorizeLifecycle({ session, trip, to, tx, approvalRef: config.lifecycleApprovalRef }) !== true) fail('CARGO_FORBIDDEN', 'Approved cargo lifecycle authority is required.', 403);
    if (['driver_id', 'vehicle_id', 'dispatch_id'].some(key => identity[key] !== undefined && Number(identity[key]) !== Number(trip[key]))) fail('CARGO_ASSIGNMENT_CHANGED', 'Trip assignment changed. Reload before continuing.');
    const dispatch = (await tx.query('SELECT * FROM dispatchschedules WHERE dispatch_id=$1', [trip.dispatch_id])).rows[0];
    if (!dispatch) fail('CARGO_LINKAGE_CONFLICT', 'Trip dispatch is missing.');
    if (dispatch.request_id) await tx.query('SELECT request_id FROM transportation_requests WHERE request_id=$1 FOR UPDATE', [dispatch.request_id]);
    const lockedDispatch = (await tx.query('SELECT * FROM dispatchschedules WHERE dispatch_id=$1 FOR UPDATE', [trip.dispatch_id])).rows[0];
    if (lockedDispatch?.request_id !== dispatch.request_id) fail('CARGO_LINKAGE_CONFLICT', 'Trip source changed during the checkpoint.');
    const manifest = await resolveTripManifest(trip.trip_id, tx);
    if (!manifest) return null;
    const execution = (await tx.query('SELECT * FROM cargo_trip_executions WHERE trip_id=$1 FOR UPDATE', [trip.trip_id])).rows[0];
    if (execution && cargoPayloadHash(manifest) !== cargoPayloadHash(execution.manifest)) fail('CARGO_MANIFEST_CONFLICT', 'The current manifest differs from the recorded execution.');
    const current = execution ? await view(execution, tx) : null;
    const reassign = ['driver_id', 'vehicle_id', 'dispatch_id'].some(key => patch[key] !== undefined && Number(patch[key]) !== Number(trip[key]));
    if (to === 'Reassign' || to === 'Cancelled' || reassign) {
      // An observation is not proof of physical custody. With no approved
      // handover policy, require review from the first recorded pickup onward.
      if (current?.pickup_receipt || !(isPreStartTripStatus(trip.trip_status) || beforeCustody(trip.trip_status))) fail('CARGO_CUSTODY_REVIEW_REQUIRED', 'Cargo custody needs review before cancellation or reassignment.');
      if (current?.fleet_clearance) fail('CARGO_CUSTODY_REVIEW_REQUIRED', 'Existing cargo clearance requires review.');
    }
    if (to !== 'Reassign' && to !== 'Completed') {
      const hop = canTransitionTrip(trip.trip_status, to);
      if (!hop.ok) fail('CARGO_TRANSITION_CONFLICT', hop.reason);
    }
    // Driver classification is gated at assignment (validatePairAvailability);
    // trip transitions never re-check it.
    if (['Passenger Onboard', 'En Route', 'In Progress', 'Drop-off', 'Arrived', 'Completed'].includes(to)) {
      if (!current?.pickup_receipt) fail('CARGO_PICKUP_REQUIRED', 'Verify cargo at pickup.');
      if (!current.can_depart) fail('CARGO_PICKUP_NOT_CLEARED', 'Current source acceptance, Fleet clearance and securement are required.');
    }
    if (['Arrived', 'Completed'].includes(to) && !current?.can_complete) fail('CARGO_RECEIVER_CONFIRMATION_REQUIRED', 'Current delivery and approved receiver confirmation are required.');
    const audit = await writeAuditRequired(tx, null, session, { action: 'cargo_checkpoint', resource: 'trips', resourceId: trip.trip_id,
      newValues: { trip_id: trip.trip_id, execution_id: execution?.execution_id ?? null, transition: to, driver_id: trip.driver_id, vehicle_id: trip.vehicle_id } });
    if (!audit?.log_id) throw new Error('Required cargo checkpoint audit was not persisted.');
    return current;
  }
  return {
    bindLifecycleTransaction: base => {
      configured();
      if (!config.lifecycleApprovalRef?.trim() || !authorizeLifecycle) fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo lifecycle authority is not configured.', 503);
      const tx = { ...base, cargoConfig: config };
      lifecycleTransactions.set(tx, checkpoint);
      return tx;
    },
    manualDecisionAvailable: () => Boolean(config.manualDecisionApprovalRef?.trim() && authorizeManualRecord && resolveManualAuthority),
    recordCargoEvidenceUpload: (tripId, evidenceId, session) => transact(tripId, session, 'driver', async ({ execution, tx }) => {
      requireExecution(execution);
      if (!z.string().uuid().safeParse(evidenceId).success) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo evidence was not found.', 404);
      const row = (await tx.query("SELECT * FROM cargo_evidence WHERE evidence_id=$1 AND execution_id=$2 AND state IN ('READY','ATTACHED')", [evidenceId,execution.execution_id])).rows[0];
      if (!row || row.uploader_employee_id !== session.user.employeeId || row.uploader_driver_id !== session.user.driverId) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo evidence was not found.', 404);
      const old = await replay(execution, 'EVIDENCE', evidenceId, row.content_hash, tx);
      if (old) return old;
      return save(execution, 'EVIDENCE', evidenceId, row.content_hash, row, session, tx);
    }),
    recordManualCargoDecision: (tripId, input, session) => transact(tripId, session, 'manual', async ({ trip, execution, tx }) => {
      requireExecution(execution);
      const payload = parse(manualDecisionSchema, input);
      const receipt = (await tx.query('SELECT * FROM cargo_receipts WHERE receipt_id=$1 AND execution_id=$2', [payload.receipt_id,execution.execution_id])).rows[0];
      if (!receipt) fail('CARGO_RECEIPT_NOT_FOUND', 'Cargo receipt was not found.', 404);
      const hash = cargoPayloadHash({ payload, employeeId: session.user.employeeId });
      const old = await replay(execution, 'MANUAL_DECISION', payload.event_id, hash, tx);
      if (old) return old;
      if (!beforeCustody(trip.trip_status)) fail('CARGO_CUSTODY_LOCKED', 'Cargo custody prevents a new manual decision.');
      const current = await rowsFor(execution, tx);
      if (receipt.stage !== 'PICKUP' || current.pickup?.receipt_id !== receipt.receipt_id) fail('CARGO_RECEIPT_STALE', 'Manual decisions require the latest pickup.');
      if (payload.manifest_hash !== receipt.manifest_hash || payload.manifest_hash !== execution.manifest.manifest_ref.hash) fail('CARGO_MANIFEST_CONFLICT', 'Decision manifest does not match receipt.');
      const resolved = manualAuthorityProofSchema.safeParse(await resolveManualAuthority({ input: payload, session, trip, execution, receipt, tx, approvalRef: config.manualDecisionApprovalRef }));
      if (!resolved.success) fail('CARGO_SOURCE_FORBIDDEN', 'Independently verified source communication is required.', 403);
      const authority = resolved.data;
      if (authority.approval_ref !== config.manualDecisionApprovalRef || cargoPayloadHash(authority.source_ref) !== cargoPayloadHash(execution.manifest.source_ref) || authority.receipt_id !== receipt.receipt_id || authority.manifest_hash !== payload.manifest_hash || authority.action !== payload.action || authority.reason !== payload.reason || authority.approver_identity !== payload.approver_identity || authority.approver_reference !== payload.approver_reference || authority.communicated_at !== payload.communicated_at || cargoPayloadHash(authority.evidence_ids) !== cargoPayloadHash(payload.communication_evidence_ids)) {
        fail('CARGO_SOURCE_FORBIDDEN', 'Source communication does not authorize this decision.', 403);
      }
      const evidence = (await tx.query("SELECT evidence_id FROM cargo_evidence WHERE execution_id=$1 AND evidence_id=ANY($2::uuid[]) AND state IN ('READY','ATTACHED') FOR SHARE", [execution.execution_id,authority.evidence_ids])).rows;
      if (evidence.length !== authority.evidence_ids.length) fail('CARGO_EVIDENCE_NOT_FOUND', 'Cargo communication evidence was not found.', 404);
      const row = await appendManualCargoDecision(payload, session, authority, tx);
      return save(await updated(execution, tx), 'MANUAL_DECISION', payload.event_id, hash, row, session, tx);
    }),
    submitCargoReceipt: (tripId, input, session) => transact(tripId, session, 'driver', async ({ tx, trip, createExecution }) => {
      const payload = parse(receiptSchema, input), execution = await createExecution();
      const hash = cargoPayloadHash({ payload, employeeId: session.user.employeeId, driverId: session.user.driverId });
      const old = await replay(execution, 'RECEIPT', payload.submission_id, hash, tx); if (old) return old;
      if (payload.stage === 'PICKUP' ? !beforeCustody(trip.trip_status) : !atDelivery(trip.trip_status)) fail('CARGO_CUSTODY_LOCKED', 'This cargo observation is not allowed at the current trip stage.');
      if (cargoPayloadHash(payload.manifest_ref) !== cargoPayloadHash(execution.manifest.manifest_ref)) fail('CARGO_MANIFEST_CONFLICT', 'The manifest has changed.');
      try { validateReceiptAgainstManifest(payload, execution.manifest); } catch { fail('CARGO_INVALID_RECEIPT', 'Observe the current manifest lines.', 400); }
      if (payload.stage === 'DELIVERY') {
        const current = await view(execution, tx);
        if (!current.can_depart) fail('CARGO_PICKUP_NOT_CLEARED', 'Current pickup acceptance and Fleet clearance are required.');
      }
      // A lower-level historic receipt without a service snapshot cannot be
      // retroactively assigned a newly derived original response.
      const existing = (await tx.query('SELECT receipt_id FROM cargo_receipts WHERE execution_id=$1 AND submission_id=$2', [execution.execution_id, payload.submission_id])).rows[0];
      if (existing) fail('CARGO_REPLAY_SNAPSHOT_REQUIRED', 'Original command response is unavailable.');
      const row = await insertReceipt(payload, session, tx);
      const receiverProof = payload.stage === 'DELIVERY' && resolveReceiverProof ? approvedProof(await resolveReceiverProof({ receipt: row, trip, tx, approvalRef: config.receivingApprovalRef }), 'RECEIVER_CONFIRMATION', row, config.receivingApprovalRef) : null;
      return save(await updated(execution, tx), 'RECEIPT', payload.submission_id, hash, row, session, tx, { receiverProof });
    }),
    recordSourceDecision: (tripId, input, principal) => transact(tripId, principal, 'source', async ({ tx, trip, execution }) => {
      requireExecution(execution); const payload = parse(decisionSchema, input);
      const receipt = (await tx.query('SELECT * FROM cargo_receipts WHERE receipt_id=$1 AND execution_id=$2', [payload.receipt_id, execution.execution_id])).rows[0];
      if (!receipt) fail('CARGO_RECEIPT_NOT_FOUND', 'Cargo receipt was not found.', 404);
      const hash = cargoPayloadHash({ payload, principal: principal.subject });
      const old = await replay(execution, 'DECISION', payload.event_id, hash, tx); if (old) return old;
      if (!beforeCustody(trip.trip_status)) {
        await writeAuditRequired(tx, null, null, { action: 'cargo_decision_late', resource: 'cargo_execution', resourceId: tripId, newValues: { reason_code: 'CARGO_CUSTODY_LOCKED', execution_id: execution.execution_id, event_id: payload.event_id, source: principal.system } });
        return { lateDecision: true };
      }
      const current = await rowsFor(execution, tx);
      if (receipt.stage !== 'PICKUP' || current.pickup?.receipt_id !== receipt.receipt_id) fail('CARGO_RECEIPT_STALE', 'Source decisions require the latest pickup.');
      const inbox = (await tx.query('SELECT event_id FROM cargo_decision_inbox WHERE source_system=$1 AND source_organization_id=$2 AND event_id=$3', [principal.system, principal.organization_id, payload.event_id])).rows[0];
      if (inbox) fail('CARGO_REPLAY_CONFLICT', 'Source event already belongs to an earlier command.');
      const row = await appendCargoDecision(payload, principal, tx);
      return save(await updated(execution, tx), 'DECISION', payload.event_id, hash, row, principal, tx);
    }),
    clearCargoDeparture: (tripId, input, session) => transact(tripId, session, 'fleet', async ({ tx, trip, execution }) => {
      requireExecution(execution); const payload = parse(clearanceSchema, input);
      const key = `${payload.receipt_id}:${payload.expected_version}`, hash = cargoPayloadHash({ payload, employeeId: session.user.employeeId });
      const old = await replay(execution, 'CLEARANCE', key, hash, tx); if (old) return old;
      if (!beforeCustody(trip.trip_status)) fail('CARGO_CUSTODY_LOCKED', 'Cargo custody prevents new clearance.');
      const current = await rowsFor(execution, tx);
      if (execution.version !== payload.expected_version || current.pickup?.receipt_id !== payload.receipt_id) fail('CARGO_RECEIPT_STALE', 'Refresh the pickup before Fleet review.');
      const state = deriveCargoState({ manifest: execution.manifest, ...current });
      if (['AWAITING_DECISION', 'REJECTED'].includes(state.pickup_state) || current.decision?.action === 'WAIT') fail('CARGO_SOURCE_DECISION_REQUIRED', 'Current source acceptance is required.');
      const safetyProof = resolveSafetyProof ? approvedProof(await resolveSafetyProof({ receipt: current.pickup, trip, tx, approvalRef: config.safetyApprovalRef }), 'POST_LOAD_SECUREMENT', current.pickup, config.safetyApprovalRef) : null;
      if (!safetyProof) fail('CARGO_SECUREMENT_REQUIRED', 'Approved post-load safety and securement evidence is required.');
      const next = (await tx.query('UPDATE cargo_trip_executions SET version=version+1,updated_at=now() WHERE execution_id=$1 RETURNING *', [execution.execution_id])).rows[0];
      const row = (await tx.query(`INSERT INTO cargo_fleet_clearances(execution_id,receipt_id,decision_id,authorized_employee_id,version,manifest_hash,safety_evidence_ref,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [execution.execution_id, payload.receipt_id, current.decision?.decision_id ?? null, session.user.employeeId, next.version, execution.manifest.manifest_ref.hash, safetyProof.reference, payload.reason])).rows[0];
      return save(next, 'CLEARANCE', key, hash, row, session, tx, { safetyProof, assignment: { driver_id: trip.driver_id, vehicle_id: trip.vehicle_id } });
    }),
    getCargoExecution: (tripId, session) => transact(tripId, session, session?.user?.role === 'driver' ? 'driver' : 'staffRead', async ({ execution, tx }) => { requireExecution(execution); return view(execution, tx); }),
  };
}
