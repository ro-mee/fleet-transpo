import { createCargoExecutionCore } from './cargo-execution.core';
import { cargoError } from './cargo-manifest.service';
import { AuthError } from '@/lib/api/utils';

const fail = (code, message, status = 409) => { throw cargoError(code, message, status); };
const disabled = async () => fail('CARGO_CONFIGURATION_REQUIRED', 'Cargo execution authority is not configured.', 503);
async function internalRuntime() { return (await import('./cargo-internal-execution.service')).getInternalCargoExecutionService(); }
// Only an explicitly constructed nonproduction service can bind a transaction.
// No request field, environment value or runtime setter installs a provider.
const lifecycleTransactions = new WeakMap();
const preparedLifecycleTransactions = new WeakSet();
export function cargoLifecycleEnabled(tx) {
  return lifecycleTransactions.has(tx) && process.env.NODE_ENV !== 'production';
}
export async function prepareCargoLifecycle(tx) {
  if (!preparedLifecycleTransactions.has(tx)) {
    // Serialize guarded writes before parent locks and freeze legacy pair classifications.
    await tx.query(cargoLifecycleEnabled(tx)
      ? 'LOCK TABLE drivers IN SHARE ROW EXCLUSIVE MODE'
      : 'LOCK TABLE drivers, vehicles IN SHARE ROW EXCLUSIVE MODE');
    preparedLifecycleTransactions.add(tx);
  }
  return cargoLifecycleEnabled(tx);
}
export async function assertCargoDispatchCheckpoint(dispatchId, transition, tx) {
  await prepareCargoLifecycle(tx);
  if (!cargoLifecycleEnabled(tx)) {
    const stored = (await tx.query(`SELECT ds.dispatch_id, ds.request_id, ds.service_type,
      tr.request_id AS stored_request_id, tr.load_type,tr.source_system FROM dispatchschedules ds
      LEFT JOIN LATERAL (SELECT request_id, load_type,source_system FROM transportation_requests
        WHERE request_id=ds.request_id AND deleted_at IS NULL FOR SHARE) tr ON TRUE
      WHERE ds.dispatch_id=$1 AND ds.deleted_at IS NULL FOR SHARE OF ds`, [dispatchId])).rows[0];
    if (!stored) throw new AuthError('Dispatch not found.', 404);
    if (stored.request_id != null && stored.stored_request_id == null) throw new AuthError('Dispatch source linkage is missing.', 409, 'CARGO_LINKAGE_CONFLICT');
    if (stored.service_type === 'SUPPLY_DELIVERY' || (stored.load_type === 'Cargo' && stored.source_system !== 'INTERNAL')) throw new AuthError('Cargo execution authority is not configured.', 503, 'CARGO_CONFIGURATION_REQUIRED');
    if (stored.load_type != null && !['Passenger','Cargo'].includes(stored.load_type)) throw new AuthError('Dispatch load authority could not be resolved.', 409, 'CARGO_LINKAGE_CONFLICT');
  }
  const trips = (await tx.query('SELECT * FROM trips WHERE dispatch_id=$1 AND deleted_at IS NULL ORDER BY trip_id', [dispatchId])).rows;
  for (const trip of trips.filter(row => !['Completed', 'Cancelled'].includes(row.trip_status))) await assertCargoCheckpoint(trip, transition, tx);
}
export async function assertCargoCheckpoint(trip, transition, tx) {
  if (!Number.isSafeInteger(Number(trip?.trip_id)) || Number(trip.trip_id) <= 0) throw new AuthError('Invalid trip identity.', 400, 'CARGO_INVALID_INPUT');
  await prepareCargoLifecycle(tx);
  // Bound fixtures retain their driver-before-trip row ordering and full proof checks.
  if (!cargoLifecycleEnabled(tx)) {
    const { rows } = await tx.query(`SELECT t.trip_id, t.dispatch_id, ds.dispatch_id AS stored_dispatch_id,
      ds.request_id, tr.request_id AS stored_request_id, ds.service_type, tr.load_type,tr.source_system,
      d.driver_type, v.operational_use
      FROM trips t
      LEFT JOIN LATERAL (SELECT dispatch_id, request_id, service_type FROM dispatchschedules
        WHERE dispatch_id=t.dispatch_id AND deleted_at IS NULL FOR SHARE) ds ON TRUE
      LEFT JOIN LATERAL (SELECT request_id, load_type,source_system FROM transportation_requests
        WHERE request_id=ds.request_id AND deleted_at IS NULL FOR SHARE) tr ON TRUE
      LEFT JOIN drivers d ON d.driver_id=t.driver_id AND d.deleted_at IS NULL
      LEFT JOIN vehicles v ON v.vehicle_id=t.vehicle_id AND v.deleted_at IS NULL
      WHERE t.trip_id=$1 AND t.deleted_at IS NULL FOR UPDATE OF t`, [trip.trip_id]);
    const stored = rows[0];
    if (!stored) throw new AuthError('Trip not found.', 404, 'CARGO_TRIP_NOT_FOUND');
    if ((stored.dispatch_id != null && stored.stored_dispatch_id == null) || (stored.request_id != null && stored.stored_request_id == null)) {
      throw new AuthError('Trip source linkage is missing.', 409, 'CARGO_LINKAGE_CONFLICT');
    }
    if (stored.load_type === 'Cargo' && stored.source_system === 'INTERNAL' && stored.service_type !== 'SUPPLY_DELIVERY') {
      const runtime = await internalRuntime();
      try { return await runtime.checkpoint(trip, transition, tx); }
      catch (error) { if (error.code?.startsWith('CARGO_')) throw new AuthError(error.message,error.status,error.code); throw error; }
    }
    if (stored.service_type === 'SUPPLY_DELIVERY' || stored.load_type === 'Cargo') throw new AuthError('Cargo execution authority is not configured.', 503, 'CARGO_CONFIGURATION_REQUIRED');
    if (transition.patch?.dispatch_id !== undefined && Number(transition.patch.dispatch_id) !== Number(stored.dispatch_id)) {
      const proposed = (await tx.query(`SELECT ds.dispatch_id AS stored_dispatch_id, ds.request_id, ds.service_type,
        tr.request_id AS stored_request_id, tr.load_type FROM dispatchschedules ds
        LEFT JOIN LATERAL (SELECT request_id, load_type FROM transportation_requests
          WHERE request_id=ds.request_id AND deleted_at IS NULL FOR SHARE) tr ON TRUE
        WHERE ds.dispatch_id=$1 AND ds.deleted_at IS NULL FOR SHARE OF ds`, [transition.patch.dispatch_id])).rows[0];
      if (!proposed || (proposed.request_id != null && proposed.stored_request_id == null)) throw new AuthError('Proposed trip source linkage is missing.', 409, 'CARGO_LINKAGE_CONFLICT');
      if (proposed.service_type === 'SUPPLY_DELIVERY' || proposed.load_type === 'Cargo') throw new AuthError('Cargo execution authority is not configured.', 503, 'CARGO_CONFIGURATION_REQUIRED');
      if (proposed.load_type != null && proposed.load_type !== 'Passenger') throw new AuthError('Proposed trip load authority could not be resolved.', 409, 'CARGO_LINKAGE_CONFLICT');
    }
    if (stored.load_type === 'Passenger') return null;
    if (stored.load_type == null && stored.driver_type === 'Passenger' && stored.operational_use === 'Passenger') return null;
    throw new AuthError('Trip load authority could not be resolved.', 409, 'CARGO_LINKAGE_CONFLICT');
  }
  try { return await lifecycleTransactions.get(tx)(trip, transition, tx); }
  catch (error) {
    if (error.code?.startsWith('CARGO_')) throw new AuthError(error.message, error.status, error.code);
    throw error;
  }
}
export const submitCargoReceipt = async (tripId,input,session) => session?.user ? (await internalRuntime()).submitCargoReceipt(tripId,input,session) : disabled();
export const recordSourceDecision = disabled;
export const clearCargoDeparture = disabled;
export const getCargoExecution = async (tripId,session) => session?.user ? (await internalRuntime()).getCargoExecution(tripId,session) : disabled();
export const recordManualCargoDecision = disabled;
export const recordCargoEvidenceUpload = async (tripId,id,session) => session?.user ? (await internalRuntime()).recordCargoEvidenceUpload(tripId,id,session) : disabled();
export const reviewInternalCargo = async (tripId,input,session) => session?.user ? (await internalRuntime()).reviewInternalCargo(tripId,input,session) : disabled();

export function createCargoExecutionService(options = {}) {
  const core = createCargoExecutionCore({ ...options, internal: false });
  return { ...core, bindLifecycleTransaction: base => { const bound = core.bindLifecycleTransaction(base); lifecycleTransactions.set(bound.tx, bound.checkpoint); return bound.tx; } };
}
