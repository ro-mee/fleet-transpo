import { inspectionSignalsForVehicles } from "@/services/maintenance-evidence.service";
import { query } from "@/lib/db";
import { normalizeRoleName } from "@/lib/auth/role-names";
import { predictFleet, USAGE_WINDOW_DAYS } from "@/lib/ai/predictive-maintenance";

// Actual sources are the completion writer's resolveEstimateDistance vocabulary.
// Legacy distance alone has no provenance; a valid odometer pair can establish it.
const FLEET_SQL = `
WITH recent_trips AS (
 SELECT t.*,
   CASE WHEN start_time >= $2::timestamptz - ($1 || ' days')::interval AND start_time <= end_time THEN
     CASE
       WHEN distance_provenance = 'odometer'
         AND start_odometer >= 0 AND end_odometer > start_odometer AND end_odometer <= 2000000
         AND actual_distance_km = end_odometer - start_odometer THEN actual_distance_km
       WHEN distance_provenance IN ('trip-distance','gps-trail')
         AND actual_distance_km > 0 AND actual_distance_km <= 2000000 THEN actual_distance_km
       WHEN distance_provenance IS NULL AND actual_distance_km IS NULL
         AND start_odometer >= 0 AND end_odometer > start_odometer AND end_odometer <= 2000000 THEN end_odometer - start_odometer
     END
   END AS measured_km
 FROM trips t
 WHERE trip_status='Completed' AND deleted_at IS NULL
   AND end_time > $2::timestamptz - ($1 || ' days')::interval AND end_time <= $2::timestamptz
), usage AS (
 SELECT vehicle_id, SUM(measured_km) AS km_90d, COUNT(*) AS trip_count,
   COUNT(measured_km) AS valid_trip_count,
   COUNT(DISTINCT (end_time AT TIME ZONE 'Asia/Manila')::date) FILTER(WHERE measured_km IS NOT NULL) AS active_days,
   MIN(GREATEST($2::timestamptz - ($1 || ' days')::interval,LEAST(COALESCE(start_time,end_time),end_time))) AS observation_start,
   $2::timestamptz AS observation_end,
   EXTRACT(EPOCH FROM ($2::timestamptz - MIN(GREATEST($2::timestamptz - ($1 || ' days')::interval,LEAST(COALESCE(start_time,end_time),end_time)))))/86400 AS observation_days
 FROM recent_trips GROUP BY vehicle_id
), history AS (
 SELECT vehicle_id,
   COUNT(*) FILTER(WHERE maintenance_type IS DISTINCT FROM 'Routine') AS corrective_count,
   COUNT(*) AS total_count
 FROM vehiclemaintenance WHERE deleted_at IS NULL AND status='Completed'
   AND maintenance_date > ($2::timestamptz AT TIME ZONE 'Asia/Manila')::date - 365
 GROUP BY vehicle_id
), plans AS (
 SELECT p.vehicle_id,jsonb_agg(to_jsonb(p) || jsonb_build_object('active_work_order',active.work_order) ORDER BY service_code) AS service_plans
 FROM vehicle_service_plans p
 LEFT JOIN LATERAL (
   SELECT jsonb_build_object('maintenance_id',vm.maintenance_id,'status',vm.status,'maintenance_date',vm.maintenance_date,
     'assigned_mechanic_id',vm.assigned_mechanic_id,'service_plan_version',vm.service_plan_version) AS work_order
   FROM vehiclemaintenance vm WHERE vm.service_plan_id=p.plan_id AND vm.vehicle_id=p.vehicle_id
     AND vm.deleted_at IS NULL AND vm.status IN ('Scheduled','In Progress','Pending Inspection')
     AND ($3::int IS NULL OR vm.assigned_mechanic_id=$3::int) LIMIT 1
 ) active ON true GROUP BY p.vehicle_id
)
SELECT v.vehicle_id,v.plate_number,v.vehicle_name,v.mileage,
       v.next_service_date,v.next_service_mileage,v.last_service_date,
       u.km_90d,u.trip_count,u.valid_trip_count,u.active_days,u.observation_start,u.observation_end,u.observation_days,
       h.corrective_count,h.total_count,COALESCE(p.service_plans,'[]'::jsonb) AS service_plans,
       reading.observed_at AS latest_reading_at,reading.source AS latest_reading_source
 FROM vehicles v
 LEFT JOIN usage u ON u.vehicle_id=v.vehicle_id
 LEFT JOIN history h ON h.vehicle_id=v.vehicle_id
 LEFT JOIN plans p ON p.vehicle_id=v.vehicle_id
 LEFT JOIN LATERAL (
   SELECT observed_at,source FROM (
     SELECT o.observed_at,'manual_observation'::text AS source
     FROM vehicle_odometer_observations o
     WHERE o.vehicle_id=v.vehicle_id AND o.reading_km=v.mileage
       AND o.reading_km BETWEEN 0 AND 2000000 AND o.observed_at <= o.recorded_at
       AND o.recorded_at <= $2::timestamptz
     UNION ALL
     SELECT COALESCE(c.committed_at,r.observed_at),
       CASE WHEN c.committed_at IS NOT NULL THEN 'trip_odometer_photo' ELSE 'trip_odometer' END
     FROM trips t
     CROSS JOIN LATERAL (VALUES('start',t.start_odometer,t.start_time),('end',t.end_odometer,t.end_time)) r(stage,reading_km,observed_at)
     LEFT JOIN trip_odometer_captures c ON c.trip_id=t.trip_id AND c.vehicle_id=t.vehicle_id
       AND c.stage=r.stage AND c.state='committed' AND c.committed_at <= $2::timestamptz AND c.reading_km=r.reading_km
     WHERE t.vehicle_id=v.vehicle_id AND t.deleted_at IS NULL AND t.trip_status IS DISTINCT FROM 'Cancelled'
       AND (r.stage='start' OR t.trip_status='Completed') AND r.reading_km=v.mileage
       AND r.reading_km BETWEEN 0 AND 2000000 AND r.observed_at <= $2::timestamptz
   ) observations ORDER BY observed_at DESC,source LIMIT 1
 ) reading ON true
 WHERE v.deleted_at IS NULL AND v.vehicle_status IS DISTINCT FROM 'Decommissioned'
`;

export async function getMaintenanceOutlook(user, now = new Date(), executor = { query }) {
  const mechanic = normalizeRoleName(user?.role) === "mechanic";
  const sql = mechanic ? `${FLEET_SQL}
   AND EXISTS(SELECT 1 FROM vehiclemaintenance vm WHERE vm.vehicle_id=v.vehicle_id AND vm.assigned_mechanic_id=$3 AND vm.deleted_at IS NULL)` : FLEET_SQL;
  const values = [String(USAGE_WINDOW_DAYS), now, mechanic ? user.employeeId : null];
  const { rows } = await executor.query(sql, values);
  const result=predictFleet(rows, now);
  const signals=await inspectionSignalsForVehicles(executor,result.predictions.map(p=>Number(p.vehicle_id)),user,now);
  result.predictions=result.predictions.map(p=>({...p,signals:signals.get(Number(p.vehicle_id)) ?? []}));
  return result;
}
