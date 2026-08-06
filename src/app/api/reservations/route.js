import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";

const JOIN_SELECT = `vr.*,
  row_to_json(v.*) as vehicles,
  row_to_json(d.*) as drivers,
  row_to_json(st.*) as service_types,
  row_to_json(bc.*) as booking_channels,
  row_to_json(pl.*) as pickup_location,
  row_to_json(dl.*) as dropoff_location`;

const JOINS = `FROM vehiclereservations vr
  LEFT JOIN vehicles v ON vr.vehicle_id = v.vehicle_id
  LEFT JOIN drivers d ON vr.driver_id = d.driver_id
  LEFT JOIN service_types st ON vr.service_type_id = st.service_type_id
  LEFT JOIN booking_channels bc ON vr.booking_channel_id = bc.channel_id
  LEFT JOIN locations pl ON vr.pickup_location_id = pl.location_id
  LEFT JOIN locations dl ON vr.dropoff_location_id = dl.location_id`;

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT ${JOIN_SELECT} ${JOINS} WHERE vr.deleted_at IS NULL`;
    const params = []; let idx = 1;
    for (const [key, col] of [["status","status"],["date","reservation_date"],["vehicle_id","vehicle_id"],["service_type_id","service_type_id"],["external_booking_id","external_booking_id"],["source_system","integration_source"]]) {
      const v = sp.get(key); if (v) { sql += ` AND vr.${col} = $${idx++}`; params.push(v); }
    }
    const fd = sp.get("from_date"), td = sp.get("to_date");
    if (fd) { sql += ` AND vr.reservation_date >= $${idx++}`; params.push(fd); }
    if (td) { sql += ` AND vr.reservation_date <= $${idx++}`; params.push(td); }
    sql += " ORDER BY vr.created_at DESC";
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "reception_staff", "restaurant_staff", "concierge"]);
  return err("Legacy reservation writes are deprecated. Create/update reservations through the Booking integration flow (POST /api/integration/transport-requests and its lifecycle endpoints).", 410);
}
