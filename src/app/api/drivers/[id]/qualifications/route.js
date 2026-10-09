import { z } from 'zod';
import { query } from '@/lib/db';
import { AuthError, requirePermission, parseBody, ok, handleError } from '@/lib/api/utils';
import { rolesFor } from '@/lib/auth/permissions';
import { setDriverQualification } from '@/services/driver-qualification.service';

const reviewSchema = z.object({
  group: z.enum(['PASSENGER', 'CARGO']),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']),
  policy_version: z.string().min(1).max(128).refine(value => Boolean(value.trim())).nullable().optional(),
  reason: z.string().trim().min(1).max(2000),
  expected_version: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict();

async function driverIdFrom(params) {
  const { id } = await params;
  const driverId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(driverId) || driverId < 1 || driverId > 2147483647) {
    throw new AuthError('A valid driver ID is required.', 400, 'QUALIFICATION_INVALID');
  }
  return driverId;
}

function qualificationError(error, req) {
  if (error.code?.startsWith('QUALIFICATION_') && [400, 403, 404, 409, 503].includes(error.status)) {
    return handleError(new AuthError(error.message, error.status, error.code), { req });
  }
  return handleError(error, { req, operation: 'Manage driver qualifications' });
}

export async function GET(req, { params }) {
  try {
    const session = await requirePermission(req, 'driver_qualifications', 'read');
    const driverId = await driverIdFrom(params);
    // One statement keeps current records and their history in the same snapshot.
    const { rows } = await query(`SELECT
      COALESCE((SELECT jsonb_agg(q ORDER BY q."group") FROM (
        SELECT q.qualification_id, q.qualification_group AS "group", q.status, q.policy_version,
          q.verified_by, q.verified_at, q.reason, q.version, q.created_at, q.updated_at,
          NULLIF(CONCAT_WS(' ', e.first_name, e.last_name), '') AS reviewer_name
        FROM driver_service_qualifications q LEFT JOIN employees e ON e.employee_id=q.verified_by
        WHERE q.driver_id=d.driver_id
      ) q), '[]'::jsonb) AS qualifications,
      COALESCE((SELECT jsonb_agg(h ORDER BY h.occurred_at DESC, h.version DESC) FROM (
        SELECT ev.*, NULLIF(CONCAT_WS(' ', e.first_name, e.last_name), '') AS actor_name
        FROM driver_service_qualification_events ev LEFT JOIN employees e ON e.employee_id=ev.actor_id
        WHERE ev.driver_id=d.driver_id
      ) h), '[]'::jsonb) AS history
      FROM drivers d WHERE d.driver_id=$1 AND d.deleted_at IS NULL`, [driverId]);
    if (!rows[0]) throw new AuthError('Driver not found.', 404, 'QUALIFICATION_DRIVER_NOT_FOUND');
    const configuredPolicy = process.env.DRIVER_QUALIFICATION_POLICY_VERSION;
    return ok({ data: {
      groups: ['PASSENGER', 'CARGO'].map(group => rows[0].qualifications.find(row => row.group === group)
        ?? { group, status: 'NOT_APPROVED', version: 0 }),
      history: rows[0].history,
      can_manage: rolesFor('driver_qualifications', 'manage').includes(session.user.role),
      configured_policy_version: configuredPolicy?.trim() ? configuredPolicy : null,
    } });
  } catch (error) {
    return qualificationError(error, req);
  }
}

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, 'driver_qualifications', 'manage');
    const driverId = await driverIdFrom(params);
    const parsed = reviewSchema.safeParse(await parseBody(req));
    if (!parsed.success) throw new AuthError('Choose a valid group and status, add a reason, and reload the current review version.', 400, 'QUALIFICATION_INVALID');
    const driver = await query('SELECT driver_id FROM drivers WHERE driver_id=$1 AND deleted_at IS NULL', [driverId]);
    if (!driver.rows[0]) throw new AuthError('Driver not found.', 404, 'QUALIFICATION_DRIVER_NOT_FOUND');
    const { group, status, policy_version, reason, expected_version } = parsed.data;
    const data = await setDriverQualification({ driverId, group, status, policyVersion: policy_version, reason, expectedVersion: expected_version }, session);
    return ok({ data });
  } catch (error) {
    return qualificationError(error, req);
  }
}
