import { assessVehicleReadiness } from './readiness-adapter';
import { shouldGroundVehicle } from '@/lib/driver/grounding';
import { toCalendarDay } from '@/lib/dates';
import { SUPPORTED_LICENSE_CLASSES } from '@/lib/drivers/license-eligibility';

// Only server queries clear maintenance and safety. Callers pass their database
// handle so commissioning and final dispatch commits can use the same locks.
export async function loadRoadReadiness({ vehicleRow, pickupAt, returnAt, now, query }) {
  const vehicleId = vehicleRow?.vehicle_id;
  const start = new Date(pickupAt ?? now);
  const end = new Date(returnAt ?? start);
  const last = end > start ? new Date(end.getTime() - 1) : start;
  const [{ rows: documentRows }, { rows: maintenance }, { rows: incidents }] = await Promise.all([
    query(`SELECT document_type, verification_status, verified_by, verified_at, expiry_date::text AS expiry_date, deleted_at
      FROM vehicledocuments WHERE vehicle_id=$1 AND deleted_at IS NULL`, [vehicleId]),
    query(`SELECT maintenance_id FROM vehiclemaintenance WHERE vehicle_id=$1 AND deleted_at IS NULL
      AND (status IN ('In Progress','Pending Inspection') OR
        (status = 'Scheduled' AND (maintenance_date <= $4::date OR
          (maintenance_date <= $3::date AND COALESCE(completed_date,maintenance_date) >= $2::date))))`,
    [vehicleId,toCalendarDay(start),toCalendarDay(last),toCalendarDay(now)]),
    query(`SELECT incident_type,severity,vehicle_id FROM driverincidents
      WHERE vehicle_id=$1 AND deleted_at IS NULL AND status <> 'Resolved'`, [vehicleId]),
  ]);
  const args = { vehicleRow, documentRows, maintenanceClear:maintenance.length === 0,
    safetyClear:!incidents.some(i=>shouldGroundVehicle({incidentType:i.incident_type,severity:i.severity,vehicleId})) };
  const current = assessVehicleReadiness({...args, now});
  const departure = assessVehicleReadiness({...args, now:start});
  const arrival = assessVehicleReadiness({...args, now:last});
  const blockers = [...new Set([...current.blockers,...departure.blockers,...arrival.blockers])];
  if (!String(vehicleRow?.fleet_asset_code ?? '').trim()) blockers.push('ASSET_CODE_MISSING');
  if (!Number.isSafeInteger(Number(vehicleRow?.category_id)) || Number(vehicleRow.category_id) <= 0) blockers.push('CATEGORY_MISSING');
  if (!SUPPORTED_LICENSE_CLASSES.includes(vehicleRow?.required_license_class)) blockers.push('LICENSE_CLASS_MISSING');
  return {ready:blockers.length === 0, blockers};
}

export function roadReadinessConflict(result) {
  return {type:'road_readiness',severity:'blocking',message:`Vehicle road readiness needs review: ${result.blockers.join(', ')}.`,detail:{blockers:result.blockers}};
}
