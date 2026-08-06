import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { predictFleet, USAGE_WINDOW_DAYS } from "@/lib/ai/predictive-maintenance";

/**
 * GET /api/ai/predictive-maintenance
 *
 * Scores every active vehicle on two independent service due-dates — elapsed
 * days and accumulated kilometres — and returns them sorted by whichever
 * arrives first.
 *
 * Computed server-side. The previous implementation fetched
 * /api/vehicles?limit=500 into the browser to perform a date comparison, which
 * shipped the whole fleet to any authenticated caller: that route is bare
 * requireAuth with no role list, so a driver could retrieve it even though the
 * pages consuming it are role-gated. This route matches the page gate in
 * src/lib/auth/permissions.js:32.
 *
 * Not persisted. Inputs change on every trip, so a stored snapshot would only
 * add staleness. The trade-off is no history or trending — that would need a
 * persistence layer and is deliberately out of scope.
 */

// Two CTEs and one pass over vehicles, rather than a query per vehicle.
// Explicit columns, not v.*: the row shape is the engine's input contract and a
// schema change should surface here, not silently alter a prediction. For the
// same reason the list carries only what predictVehicle actually reads —
// service_interval_km, service_interval_days and vehicle_status were selected
// and never consumed, which reads as "the engine considers the interval" when
// it in fact consumes only the derived next_service_* columns. vehicle_status
// still does its work in the WHERE clause below.
//
// IS DISTINCT FROM, not <>: a NULL vehicle_status makes `<> 'Decommissioned'`
// evaluate to NULL rather than true, so every vehicle whose status was never
// set was silently dropped from the fleet — invisible on the page, with no
// error anywhere. Same three-valued trap on maintenance_type in the history
// CTE, where a NULL type made the row count toward total_count but never toward
// corrective_count, quietly lowering the vehicle's corrective ratio.
const FLEET_SQL = `
WITH usage AS (
  SELECT vehicle_id,
         SUM(distance)                    AS km_90d,
         COUNT(*)                         AS trip_count,
         COUNT(DISTINCT DATE(end_time))   AS active_days
    FROM trips
   WHERE trip_status = 'Completed'
     AND deleted_at IS NULL
     AND end_time > NOW() - ($1 || ' days')::INTERVAL
   GROUP BY vehicle_id
),
history AS (
  SELECT vehicle_id,
         COUNT(*) FILTER (WHERE maintenance_type IS DISTINCT FROM 'Routine') AS corrective_count,
         COUNT(*)                                                            AS total_count
    FROM vehiclemaintenance
   WHERE deleted_at IS NULL
     AND status = 'Completed'
     AND maintenance_date > NOW() - INTERVAL '365 days'
   GROUP BY vehicle_id
)
SELECT v.vehicle_id, v.plate_number, v.vehicle_name, v.mileage,
       v.next_service_date, v.next_service_mileage, v.last_service_date,
       u.km_90d, u.trip_count, u.active_days,
       h.corrective_count, h.total_count
  FROM vehicles v
  LEFT JOIN usage   u ON u.vehicle_id = v.vehicle_id
  LEFT JOIN history h ON h.vehicle_id = v.vehicle_id
 WHERE v.deleted_at IS NULL
   AND v.vehicle_status IS DISTINCT FROM 'Decommissioned'
`;

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const { rows } = await query(FLEET_SQL, [String(USAGE_WINDOW_DAYS)]);
    // One clock for the whole fleet, so two vehicles cannot be scored against
    // instants milliseconds apart and land on different sides of a boundary.
    const { predictions, summary } = predictFleet(rows, new Date());
    return ok({ predictions, summary });
  } catch (e) {
    return handleError(e);
  }
}
