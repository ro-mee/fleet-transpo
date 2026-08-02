import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { syncVehicleStatus } from "@/services/status.service";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { findReservationConflicts } from "@/lib/scheduling/conflicts";

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
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "reception_staff", "restaurant_staff", "concierge"]);
    const body = await parseBody(req);

    const errors = validateBody(body, {
      guest_name: { maxLength: 100, label: "Guest name" },
      guest_phone: { type: "phone", label: "Guest phone" },
      guest_email: { type: "email", label: "Guest email" },
      pickup_location: { required: true, maxLength: 255, label: "Pickup location" },
      dropoff_location: { maxLength: 255, label: "Dropoff location" },
      reservation_date: { required: true, type: "date", label: "Reservation date" },
      pickup_time: { required: true, type: "time", label: "Pickup time" },
      estimated_return_time: { type: "time", label: "Estimated return time" },
      purpose: { maxLength: 255, label: "Purpose" },
      passenger_count: { type: "seating", label: "Passenger count" },
      notes: { maxLength: 1000, label: "Notes" },
      vehicle_id: { type: "id", label: "Vehicle" },
      driver_id: { type: "id", label: "Driver" },
      service_type_id: { type: "id", label: "Service type" },
      booking_channel_id: { type: "id", label: "Booking channel" },
      external_booking_id: { maxLength: 100, label: "External booking ID" },
      integration_source: { maxLength: 50, label: "Integration source" },
      room_number: { maxLength: 50, label: "Room number" },
      status: { maxLength: 30, label: "Status" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const allowedKeys = new Set([
      "guest_id", "guest_name", "guest_phone", "guest_email", "pickup_location_id",
      "pickup_location", "dropoff_location_id", "dropoff_location", "reservation_date",
      "pickup_time", "estimated_return_time", "purpose", "passenger_count", "notes",
      "vehicle_id", "driver_id", "service_type_id", "booking_channel_id",
      "external_booking_id", "integration_source", "room_number", "bill_to_room",
      "status", "reservation_number",
    ]);
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) delete body[key];
    }

    const k = Object.keys(body), v = Object.values(body);
    // Block double-booking: reject if this vehicle or driver already has an
    // overlapping active reservation in the requested pickup/return window.
    // Only enforced when a vehicle/driver is assigned at creation time.
    if ((body.vehicle_id || body.driver_id) && body.reservation_date && body.pickup_time) {
      const conflicts = await findReservationConflicts({
        vehicleId: body.vehicle_id || null,
        driverId: body.driver_id || null,
        date: body.reservation_date,
        pickupTime: body.pickup_time,
        returnTime: body.estimated_return_time || null,
      });
      if (conflicts.length > 0) {
        const c = conflicts[0];
        const who = c.vehicle_id && c.vehicle_id === body.vehicle_id ? "vehicle" : "driver";
        return err(`This ${who} already has a reservation (#${c.reservation_id}) that overlaps the requested time.`, 409);
      }
    }
    const { rows } = await query(`INSERT INTO vehiclereservations (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    if (rows[0]?.vehicle_id && ["Approved","Pending"].includes(rows[0].status)) await syncVehicleStatus(rows[0].vehicle_id);
    await writeAudit(req, session, { action: "create", resource: "vehiclereservations", resourceId: rows[0]?.reservation_id, newValues: rows[0] });
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
