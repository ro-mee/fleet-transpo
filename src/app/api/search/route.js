import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

// Command-palette global search. Runs a bounded ILIKE search across the four
// master entities the operator navigates most, each returning a small top-N so
// a keystroke stays fast even with a full fleet behind it. Only rows a logged-in
// user could legitimately reach are returned; the client groups by `type` and
// links straight to the detail page.

const LIMIT = 5;

export async function GET(req) {
  try {
    await requireAuth(req, "*");
    const q = new URL(req.url).searchParams.get("q")?.trim() || "";
    if (q.length < 2) return ok([]);

    const term = `%${q}%`;
    const results = [];

    // Reservations / transport requests
    const res = await query(
      `SELECT request_id AS id, reservation_number AS label, guest_name AS subtitle,
              pickup_datetime, fleet_status
         FROM transportation_requests
        WHERE deleted_at IS NULL
          AND (reservation_number ILIKE $1 OR guest_name ILIKE $1 OR booking_reference ILIKE $1)
        ORDER BY pickup_datetime DESC
        LIMIT ${LIMIT}`,
      [term]
    );
    for (const r of res.rows) {
      results.push({ type: "reservation", href: `/reservations/${r.id}`, ...r });
    }

    // Dispatches
    const dis = await query(
      `SELECT dispatch_id AS id, dispatch_number AS label, status, scheduled_departure
         FROM dispatchschedules
        WHERE deleted_at IS NULL
          AND dispatch_number ILIKE $1
        ORDER BY scheduled_departure DESC
        LIMIT ${LIMIT}`,
      [term]
    );
    for (const d of dis.rows) {
      results.push({ type: "dispatch", href: `/dispatch/${d.id}`, ...d });
    }

    // Drivers (name lives on employees)
    const drv = await query(
      `SELECT d.driver_id AS id, e.first_name || ' ' || e.last_name AS label,
              d.driver_status AS subtitle, e.first_name
         FROM drivers d
         JOIN employees e ON e.employee_id = d.employee_id
        WHERE d.deleted_at IS NULL AND e.deleted_at IS NULL
          AND (e.first_name ILIKE $1 OR e.last_name ILIKE $1
               OR (e.first_name || ' ' || e.last_name) ILIKE $1)
        ORDER BY e.last_name
        LIMIT ${LIMIT}`,
      [term]
    );
    for (const v of drv.rows) {
      results.push({ type: "driver", href: `/drivers/${v.id}`, ...v });
    }

    // Vehicles
    const veh = await query(
      `SELECT vehicle_id AS id, plate_number AS label, vehicle_name || ' ' || model AS subtitle,
              vehicle_status
         FROM vehicles
        WHERE deleted_at IS NULL
          AND (plate_number ILIKE $1 OR vehicle_name ILIKE $1 OR model ILIKE $1)
        ORDER BY vehicle_name
        LIMIT ${LIMIT}`,
      [term]
    );
    for (const v of veh.rows) {
      results.push({ type: "vehicle", href: `/fleet/vehicles/${v.id}`, ...v });
    }

    return ok(results);
  } catch (e) {
    return handleError(e);
  }
}
