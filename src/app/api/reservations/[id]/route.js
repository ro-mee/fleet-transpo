import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";

const JOIN_SELECT = `vr.*,
  row_to_json(v.*) as vehicles,
  row_to_json(d.*) as drivers,
  row_to_json(st.*) as service_types,
  row_to_json(bc.*) as booking_channels,
  row_to_json(pl.*) as pickup_location,
  row_to_json(dl.*) as dropoff_location,
  (SELECT json_agg(ds.*) FROM dispatchschedules ds WHERE ds.reservation_id = vr.reservation_id) as dispatchschedules`;

const JOINS = `FROM vehiclereservations vr
  LEFT JOIN vehicles v ON vr.vehicle_id = v.vehicle_id
  LEFT JOIN drivers d ON vr.driver_id = d.driver_id
  LEFT JOIN service_types st ON vr.service_type_id = st.service_type_id
  LEFT JOIN booking_channels bc ON vr.booking_channel_id = bc.channel_id
  LEFT JOIN locations pl ON vr.pickup_location_id = pl.location_id
  LEFT JOIN locations dl ON vr.dropoff_location_id = dl.location_id`;

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rows } = await query(`SELECT ${JOIN_SELECT} ${JOINS} WHERE vr.reservation_id = $1 AND vr.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return err("Reservation not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
  return err("Legacy reservation writes are deprecated. Create/update reservations through the Booking integration flow (POST /api/integration/transport-requests and its lifecycle endpoints).", 410);
}
