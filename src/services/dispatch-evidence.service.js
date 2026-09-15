import { query, withTransaction } from '@/lib/db';
import { AuthError } from '@/lib/api/utils';

// Hash operational inputs, never save exact standby coordinates in an audit record.
export async function readDispatchRevision({ driverId, vehicleId, requestId = null, tripId = null }, db = { query }) {
  const { rows } = await db.query(`SELECT md5(jsonb_build_object(
    'driver',(SELECT to_jsonb(d) FROM drivers d WHERE driver_id=$1),
    'vehicle',(SELECT to_jsonb(v) FROM vehicles v WHERE vehicle_id=$2),
    'tripGps',(SELECT to_jsonb(g) FROM gpstracking g WHERE g.trip_id=$4 AND g.vehicle_id=$2 ORDER BY g.recorded_at DESC,g.tracking_id DESC LIMIT 1),
    'maintenance',(SELECT jsonb_agg(to_jsonb(m) ORDER BY maintenance_id) FROM vehiclemaintenance m WHERE vehicle_id=$2),
    'routes',(SELECT jsonb_agg(to_jsonb(r) ORDER BY route_id) FROM routes r),
    'locations',(SELECT jsonb_agg(to_jsonb(l) ORDER BY location_id) FROM locations l),
    'policy',(SELECT jsonb_agg(to_jsonb(s) ORDER BY setting_key) FROM system_settings s WHERE setting_key IN ('dispatch_policy','uvvrp_policy')),
    'dispatches',(SELECT jsonb_agg(to_jsonb(ds) ORDER BY dispatch_id) FROM dispatchschedules ds WHERE driver_id=$1 OR vehicle_id=$2),
    'pairs',(SELECT jsonb_agg(to_jsonb(a) ORDER BY assignment_id) FROM driver_vehicle_assignments a WHERE driver_id=$1 OR vehicle_id=$2),
    'substitutes',(SELECT jsonb_agg(to_jsonb(s) ORDER BY vehicle_id,effective_from) FROM substitute_vehicle_schedules s WHERE substitute_driver_id=$1 OR vehicle_id=$2),
    'shifts',(SELECT jsonb_agg(to_jsonb(s) ORDER BY schedule_id) FROM driver_work_schedules s WHERE driver_id=$1),
    'leave',(SELECT jsonb_agg(to_jsonb(l) ORDER BY leave_request_id) FROM driver_leave_requests l WHERE driver_id=$1),
    'attendance',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attendance_id) FROM driverattendance a WHERE driver_id=$1),
    'consent',(SELECT jsonb_agg(to_jsonb(c) ORDER BY accepted_at) FROM driver_consents c WHERE driver_id=$1),
    'employee',(SELECT to_jsonb(e) FROM employees e JOIN drivers d USING(employee_id) WHERE d.driver_id=$1),
    'sessions',(SELECT jsonb_agg(jsonb_build_array(m.id,m.revoked_at,m.expires_at) ORDER BY m.id) FROM mobile_refresh_tokens m JOIN drivers d USING(employee_id) WHERE d.driver_id=$1),
    'trips',(SELECT jsonb_agg(to_jsonb(t) ORDER BY trip_id) FROM trips t WHERE driver_id=$1 OR vehicle_id=$2),
    'incidents',(SELECT jsonb_agg(to_jsonb(i) ORDER BY incident_id) FROM driverincidents i WHERE driver_id=$1 OR responder_driver_id=$1 OR vehicle_id=$2),
    'requests',(SELECT jsonb_agg((to_jsonb(r) - ARRAY['fleet_status','updated_at','derived_priority','priority_updated_at','ai_vehicle_recommendation','ai_driver_recommendation']) || jsonb_build_object('fleet_status',CASE WHEN r.fleet_status IN ('Pending','Scheduled') THEN 'Actionable' ELSE r.fleet_status END) ORDER BY r.request_id)
      FROM transportation_requests r WHERE r.request_id=$3 OR r.request_id IN (SELECT request_id FROM dispatchschedules WHERE driver_id=$1 OR vehicle_id=$2))
  )::text) AS revision`, [driverId,vehicleId,requestId,tripId]);
  return rows[0]?.revision;
}

export async function commitDispatchEvidence(token, write) {
  if (!token?.revision) throw new AuthError('Refresh the dispatch evidence before assigning.',409,'EVIDENCE_REQUIRED');
  return withTransaction(async tx => {
    // ponytail: brief fleet-wide write lock for this small fleet; replace with ordered
    // per-resource locks if assignment contention becomes measurable. No provider I/O here.
    await tx.query(`LOCK TABLE drivers,vehicles,vehiclecategories,dispatchschedules,driver_vehicle_assignments,
      substitute_vehicle_schedules,driver_work_schedules,driver_leave_requests,driverattendance,
      driver_consents,employees,mobile_refresh_tokens,trips,driverincidents,transportation_requests,
      routes,locations,vehiclemaintenance,system_settings,gpstracking
      IN SHARE ROW EXCLUSIVE MODE`);
    if (!Number.isFinite(new Date(token.expiresAt).getTime()) || new Date(token.expiresAt).getTime() <= Date.now() || await readDispatchRevision(token,tx) !== token.revision)
      throw new AuthError('Dispatch evidence changed. Refresh and review this pair again.',409,'STALE_DISPATCH_EVIDENCE');
    return write(tx);
  });
}
