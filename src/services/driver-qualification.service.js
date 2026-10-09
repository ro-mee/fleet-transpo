import { query, withTransaction } from '@/lib/db';
import { writeAuditRequired } from '@/lib/audit';
import { rolesFor } from '@/lib/auth/permissions';
import { normalizeRoleName } from '@/lib/auth/role-names';

const columns = 'qualification_id, driver_id, qualification_group AS "group", status, policy_version, verified_by, verified_at, reason, version, created_at, updated_at';
const positiveId = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
function fail(message, status, code) { throw Object.assign(new Error(message), { status, code }); }

export async function loadDriverQualifications(driverIds, db = { query }) {
  if (!Array.isArray(driverIds) || driverIds.some(id => !positiveId(id))) fail('Valid driver IDs are required.', 400, 'QUALIFICATION_INVALID');
  const ids = [...new Set(driverIds)];
  const result = new Map(ids.map(id => [id, []]));
  if (!ids.length) return result;
  const { rows } = await db.query(`SELECT ${columns} FROM driver_service_qualifications
    WHERE driver_id = ANY($1::integer[]) AND driver_id IN (SELECT driver_id FROM drivers WHERE deleted_at IS NULL)
    ORDER BY driver_id, qualification_group`, [ids]);
  for (const row of rows) result.get(Number(row.driver_id))?.push(row);
  return result;
}

export async function setDriverQualification({ driverId, group, status, policyVersion, reason, expectedVersion } = {}, session) {
  const actor = session?.user?.employeeId;
  if (!positiveId(actor) || !rolesFor('driver_qualifications', 'manage').includes(normalizeRoleName(session?.user?.role))) {
    fail('You cannot manage driver qualifications.', 403, 'QUALIFICATION_FORBIDDEN');
  }
  if (!positiveId(driverId) || !['PASSENGER', 'CARGO'].includes(group) || !['ACTIVE', 'SUSPENDED', 'REVOKED'].includes(status)
    || typeof reason !== 'string' || !reason.trim() || reason.length > 2000
    || (policyVersion != null && (typeof policyVersion !== 'string' || !policyVersion.trim() || policyVersion.length > 128))
    || (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0))) {
    fail('Valid qualification details and a reason are required.', 400, 'QUALIFICATION_INVALID');
  }
  const configuredPolicy = process.env.DRIVER_QUALIFICATION_POLICY_VERSION;
  if (status === 'ACTIVE' && (!configuredPolicy?.trim() || policyVersion !== configuredPolicy)) {
    fail('An approved qualification policy version must be configured.', 503, 'QUALIFICATION_POLICY_DISABLED');
  }
  return withTransaction(async tx => {
    // Lock the parent even for the first approval: an absent qualification row cannot be locked.
    const driver = await tx.query('SELECT driver_id FROM drivers WHERE driver_id=$1 AND deleted_at IS NULL FOR UPDATE', [driverId]);
    if (!driver.rows[0]) fail('Driver not found.', 404, 'QUALIFICATION_DRIVER_NOT_FOUND');
    const existing = await tx.query(`SELECT ${columns} FROM driver_service_qualifications WHERE driver_id=$1 AND qualification_group=$2 FOR UPDATE`, [driverId, group]);
    const old = existing.rows[0];
    if (expectedVersion !== undefined && expectedVersion !== (old?.version ?? 0)) {
      fail('This qualification changed. Reload before reviewing it.', 409, 'QUALIFICATION_STALE');
    }
    const { rows } = await tx.query(`INSERT INTO driver_service_qualifications
      (driver_id, qualification_group, status, policy_version, verified_by, verified_at, reason)
      VALUES($1,$2,$3,$4,$5,CASE WHEN $3='ACTIVE' THEN NOW() ELSE NULL END,$6)
      ON CONFLICT(driver_id,qualification_group) DO UPDATE SET
        status=EXCLUDED.status, policy_version=COALESCE(EXCLUDED.policy_version,driver_service_qualifications.policy_version),
        verified_by=CASE WHEN EXCLUDED.status='ACTIVE' THEN EXCLUDED.verified_by ELSE driver_service_qualifications.verified_by END,
        verified_at=CASE WHEN EXCLUDED.status='ACTIVE' THEN EXCLUDED.verified_at ELSE driver_service_qualifications.verified_at END,
        reason=EXCLUDED.reason, version=driver_service_qualifications.version+1, updated_at=NOW()
      RETURNING ${columns}`, [driverId, group, status, policyVersion ?? null, status === 'ACTIVE' ? actor : null, reason.trim()]);
    const current = rows[0];
    await tx.query(`INSERT INTO driver_service_qualification_events
      (qualification_id,driver_id,actor_id,old_group,new_group,old_status,new_status,reason,policy_version,version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [current.qualification_id, driverId, actor, old?.group ?? null, group, old?.status ?? null, status, reason.trim(), current.policy_version, current.version]);
    await writeAuditRequired(tx, null, session, {
      action: 'qualification_update', resource: 'driver_qualifications', resourceId: driverId,
      oldValues: old ? { status: old.status, version: old.version } : null,
      newValues: { status, version: current.version, driver_id: driverId },
    });
    return current;
  });
}
