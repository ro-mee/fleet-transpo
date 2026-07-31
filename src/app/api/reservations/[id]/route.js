import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus } from "@/services/status.service";

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
  try {
    await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`UPDATE vehiclereservations SET ${k.map((k,i)=>`${k} = $${i+1}`).join(", ")} WHERE reservation_id = $${k.length+1} RETURNING *`, [...v, id]);
    if (!rows[0]) return err("Reservation not found", 404);
    if (rows[0]?.vehicle_id) await syncVehicleStatus(rows[0].vehicle_id);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
