import { query, withTransaction } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';
import { loadDriverQualifications } from './driver-qualification.service';
import { qualificationRollout, qualificationFinding } from '@/lib/drivers/qualification-rollout';
import { groupForService } from '@/lib/drivers/service-qualifications';

export async function loadQualificationContext(driverIds, db = { query }) {
  const rollout = qualificationRollout();
  if (rollout.mode === 'OFF') return null;
  // An invalid activation refuses work without depending on the new table.
  const qualifications = rollout.configured ? await loadDriverQualifications([...new Set(driverIds.map(Number).filter(id => Number.isSafeInteger(id) && id > 0))], db) : new Map();
  return { rollout, qualifications };
}

export function driverQualificationFinding(context, driverId, serviceCode) {
  return qualificationFinding({ serviceCode, qualifications: context?.qualifications?.get(Number(driverId)) ?? [],
    ...(context ? { rollout: context.rollout } : {}) });
}

export function qualificationSummary(context, driverId) {
  if (!context) return undefined;
  return ['PASSENGER', 'CARGO'].map(group => {
    const row = context.qualifications.get(Number(driverId))?.find(item => item.group === group);
    return { group, status: row?.status ?? 'NOT_APPROVED', policy_version: row?.policy_version ?? null, version: row?.version ?? 0 };
  });
}

export async function storedQualificationService(requestId, db = { query }) {
  if (qualificationRollout().mode === 'OFF' || !requestId) return null;
  const { rows } = await db.query(`SELECT st.service_code FROM transportation_requests r
    LEFT JOIN service_types st ON st.service_type_id=r.service_type_id AND st.deleted_at IS NULL
    WHERE r.request_id=$1 AND r.deleted_at IS NULL`, [requestId]);
  return rows[0]?.service_code ?? null;
}

export async function guardDriverQualification({ driverId, requestId = null, dispatchId = null, tripId = null, expectedDriverId = driverId, expectedDispatchId } = {}, db) {
  const rollout = qualificationRollout();
  if (rollout.mode === 'OFF') return null;
  if (!rollout.configured) throw new AuthError(qualificationFinding({ rollout }).message, 503, 'QUALIFICATION_POLICY_DISABLED');
  // Same parent-first order as the reviewer. This protects missing approval rows
  // as well as revocations until the caller commits its final write.
  if (rollout.mode === 'ENFORCE' && driverId) {
    await db.query('SELECT driver_id FROM drivers WHERE driver_id=$1 AND deleted_at IS NULL FOR UPDATE', [driverId]);
  }
  if (rollout.mode === 'ENFORCE' && tripId) {
    const { rows } = await db.query('SELECT driver_id, dispatch_id FROM trips WHERE trip_id=$1 AND deleted_at IS NULL FOR UPDATE', [tripId]);
    if (!rows[0] || Number(rows[0].driver_id) !== Number(expectedDriverId)
      || (expectedDispatchId !== undefined && Number(rows[0].dispatch_id) !== Number(expectedDispatchId)))
      throw new AuthError('The trip assignment changed. Reload before continuing.', 409, 'STALE_DISPATCH_EVIDENCE');
    dispatchId ??= rows[0].dispatch_id;
  }
  let serviceCode = null;
  if (requestId || dispatchId || tripId) {
    const { rows } = await db.query(`SELECT st.service_code FROM transportation_requests r
      LEFT JOIN service_types st ON st.service_type_id=r.service_type_id AND st.deleted_at IS NULL
      WHERE r.deleted_at IS NULL AND r.request_id = COALESCE($1::integer,
        (SELECT ds.request_id FROM dispatchschedules ds WHERE ds.dispatch_id = COALESCE($2::integer,
          (SELECT t.dispatch_id FROM trips t WHERE t.trip_id=$3::integer))))`, [requestId, dispatchId, tripId]);
    serviceCode = rows[0]?.service_code ?? null;
  }
  const context = await loadQualificationContext(driverId ? [driverId] : [], db);
  const finding = driverQualificationFinding(context, driverId, serviceCode);
  if (finding?.severity === 'blocking') throw new AuthError(finding.message, 409, finding.code);
  const qualification = context?.qualifications?.get(Number(driverId))?.find(row => row.group === groupForService(serviceCode));
  return { service_code: serviceCode, qualification_version: qualification?.version ?? 0, finding };
}

export async function withQualificationWrite(identity, write) {
  if (qualificationRollout().mode === 'OFF') return write({ query });
  return withTransaction(async tx => {
    await guardDriverQualification(identity, tx);
    return write(tx);
  });
}
