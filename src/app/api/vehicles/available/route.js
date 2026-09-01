import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";
import { loadVehicleTravelContext, vehicleCanTravel } from "@/lib/uvvrp/uvvrp.service";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";
import { driverBlockReason } from "@/lib/scheduling/driver-schedule";

export async function GET(req) {
  try {
    await requirePermission(req, "vehicles", "read_all");
    const { searchParams } = new URL(req.url);

    // `Reserved` / `In Use` are not reasons to hide a vehicle from a *windowed*
    // search. status.service.js writes those when the vehicle has an open
    // booking/dispatch — a whole-day flag, not a slot one. So a vehicle out at
    // 1pm still reads as Reserved/In Use for an 8pm search, and this endpoint
    // used to drop it. The NOT EXISTS below already answers the real question
    // ("is it taken during THIS window?") precisely, so when a window is given
    // it supersedes the coarse status flag. Without a window there is nothing
    // to compare against, so the strict reading stands.
    //
    // Only true vehicle conditions stay excluded either way: Under Maintenance,
    // Decommissioned and Registration Expired. Availability is otherwise decided
    // by slot overlap (below) plus travel-date pair-coupled checks
    // (`vehicleCanTravel`: coding/UVVRP, registration/insurance, paired driver).
    const pickupAt = searchParams.get("pickup_at");
    const returnAt = searchParams.get("return_at");
    const statuses = pickupAt ? `ARRAY['Available','Reserved','In Use']` : `ARRAY['Available']`;

    let sql = `SELECT v.*, row_to_json(vc.*) as vehiclecategories
               FROM vehicles v
               LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
               WHERE v.vehicle_status = ANY(${statuses}) AND v.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    const category_id = searchParams.get("category_id");
    if (category_id) { sql += ` AND v.category_id = $${idx++}`; params.push(+category_id); }

    const min_capacity = searchParams.get("min_capacity");
    if (min_capacity) { sql += ` AND v.seating_capacity >= $${idx++}`; params.push(+min_capacity); }

    const fuel_type = searchParams.get("fuel_type");
    if (fuel_type) { sql += ` AND v.fuel_type = $${idx++}`; params.push(fuel_type); }

    // Time-window conflict exclusion: omit vehicles already dispatched in the
    // requested slot so the pair card never proposes an occupied resource.
    // Half-open overlap: departure < return_at AND arrival > pickup_at.
    if (pickupAt) {
      const end = returnAt || pickupAt;
      sql += `
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules ds
          WHERE ds.vehicle_id = v.vehicle_id
            AND ds.deleted_at IS NULL
            AND ds.status = ANY(ARRAY['Scheduled','In Progress'])
            AND ds.scheduled_departure < $${idx++}::timestamptz
            AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $${idx++}::timestamptz
        )`;
      params.push(end, pickupAt);
    }

    const { rows } = await query(sql, params);

    // Travel-date, pair-coupled availability. The date is the proposed
    // `pickup_at` (a future booking must not be blocked by today's coding); when
    // absent, fall back to today. A vehicle is hidden if it cannot travel on
    // that date (coding, registration/insurance) OR its paired driver cannot.
    const codingDate = pickupAt ? new Date(pickupAt) : new Date();
    const ctx = await loadVehicleTravelContext(codingDate);
    const available = (rows || []).filter((v) => vehicleCanTravel(v, ctx));

    // Work-schedule / leave blocking for the pair. The effective driver is the
    // custodian, or the substitute covering the date (loadVehicleTravelContext
    // already substituted it into ctx.pairings). A vehicle whose driver has no
    // schedule, a rest day, approved leave, or an out-of-shift window is hidden
    // — the pair cannot operate in this slot. Custodianless vehicles have no
    // driver to check and stay listed.
    if (pickupAt && available.length) {
      const effectiveIds = (ctx.pairings || [])
        .filter((p) => p.vehicle_id != null)
        .map((p) => p.driver_id)
        .filter(Boolean);
      const scheduleCtx = await loadDriverScheduleContext(effectiveIds);
      const pickup = new Date(pickupAt);
      const returnDate = returnAt ? new Date(returnAt) : null;
      const pairByVehicle = new Map(
        (ctx.pairings || [])
          .filter((p) => p.vehicle_id != null && p.driver_id != null)
          .map((p) => [Number(p.vehicle_id), Number(p.driver_id)])
      );
      const filtered = [];
      for (const v of available) {
        const driverId = pairByVehicle.get(Number(v.vehicle_id));
        if (driverId == null) {
          filtered.push(v);
          continue;
        }
        const block = driverBlockReason({ driverId, pickup, returnAt: returnDate, ctx: scheduleCtx });
        if (block?.blocked) continue;
        filtered.push(v);
      }
      return ok(filtered);
    }

    return ok(available);
  } catch (e) { return handleError(e); }
}
