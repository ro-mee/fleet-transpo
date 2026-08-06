import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { loadVehicleTravelContext, vehicleCanTravel } from "@/lib/uvvrp/uvvrp.service";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { searchParams } = new URL(req.url);

    let sql = `SELECT v.*, row_to_json(vc.*) as vehiclecategories
               FROM vehicles v
               LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
               WHERE v.vehicle_status = 'Available' AND v.deleted_at IS NULL`;
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
    const pickupAt = searchParams.get("pickup_at");
    const returnAt = searchParams.get("return_at");
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

    return ok(available);
  } catch (e) { return handleError(e); }
}
