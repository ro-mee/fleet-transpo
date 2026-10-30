import { cargoError } from './cargo-manifest.service';
import { rolesFor } from '@/lib/auth/permissions';
import { normalizeRoleName } from '@/lib/auth/role-names';

export async function assertInternalCargoTrip(tripId, session, tx, { managerOnly = false, lifecycle = false } = {}) {
  const user = session?.user;
  if (!Number.isSafeInteger(tripId) || tripId < 1 || !Number.isSafeInteger(user?.employeeId)) throw cargoError('CARGO_FORBIDDEN', 'Cargo access is not permitted.', 403);
  const row = (await tx.query(`SELECT t.*, d.employee_id, d.deleted_at AS driver_deleted_at,
    r.request_id,r.load_type,r.source_system,r.external_request_id,
    e.status AS employee_status,ro.role_name AS stored_role,manifest.source_organization_id
    FROM trips t JOIN dispatchschedules ds ON ds.dispatch_id=t.dispatch_id AND ds.deleted_at IS NULL
    JOIN transportation_requests r ON r.request_id=ds.request_id AND r.deleted_at IS NULL
    LEFT JOIN LATERAL(SELECT source_organization_id FROM request_cargo_manifest_revisions WHERE request_id=r.request_id ORDER BY revision DESC LIMIT 1) manifest ON TRUE
    LEFT JOIN drivers d ON d.driver_id=t.driver_id
    JOIN employees e ON e.employee_id=$2 AND e.deleted_at IS NULL
    LEFT JOIN roles ro ON ro.role_id=e.role_id
    WHERE t.trip_id=$1 AND t.deleted_at IS NULL FOR SHARE OF e,r,ds`, [tripId, user.employeeId])).rows[0];
  if (!row) throw cargoError('CARGO_TRIP_NOT_FOUND', 'Cargo trip was not found.', 404);
  if (row.source_system !== 'INTERNAL' || row.load_type !== 'Cargo') throw cargoError('CARGO_CONFIGURATION_REQUIRED', 'This cargo source is not configured.', 503);
  if (row.source_organization_id !== 'fleetops') throw cargoError('CARGO_LINKAGE_CONFLICT','Internal cargo manifest ownership is missing.',409);
  const role = normalizeRoleName(row.stored_role);
  if (row.employee_status !== 'Active' || role !== user.role) throw cargoError('CARGO_FORBIDDEN', 'Cargo access has changed. Sign in again.', 403);
  if (role === 'driver' && !managerOnly) {
    if (row.driver_deleted_at != null || row.driver_id !== user.driverId || row.employee_id !== user.employeeId) throw cargoError('CARGO_TRIP_NOT_FOUND', 'Cargo trip was not found.', 404);
  } else if (!(lifecycle ? rolesFor('trips', 'update') : rolesFor('cargo', 'review_internal')).includes(role)) {
    throw cargoError('CARGO_FORBIDDEN', 'A Fleet Manager must review this cargo.', 403);
  }
  return row;
}
