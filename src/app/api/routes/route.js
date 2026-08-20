import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

// Allowed client field -> real routes column. Column names are never taken
// from the request body — that would allow SQL injection via crafted keys.
const ROUTE_WRITABLE = {
  route_name: "route_name",
  origin: "origin",
  destination: "destination",
  origin_location_id: "origin_location_id",
  destination_location_id: "destination_location_id",
  distance_km: "estimated_distance",
  estimated_distance: "estimated_distance",
  estimated_duration_minutes: "estimated_duration",
  estimated_duration: "estimated_duration",
  status: "status",
};

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT r.*, row_to_json(ol.*) as origin_location, row_to_json(dl.*) as destination_location FROM routes r LEFT JOIN locations ol ON r.origin_location_id = ol.location_id LEFT JOIN locations dl ON r.destination_location_id = dl.location_id WHERE r.deleted_at IS NULL AND r.status = 'Active'`;
    const params = []; let idx = 1;
    const search = sp.get("search"); if (search) { sql += ` AND (r.route_name ILIKE $${idx} OR r.origin ILIKE $${idx} OR r.destination ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    sql += " ORDER BY r.route_name";
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const body = await parseBody(req);

    const errors = validateBody(body, {
      route_name: { required: true, maxLength: 150, label: "Route name" },
      origin: { required: true, maxLength: 255, label: "Origin" },
      destination: { required: true, maxLength: 255, label: "Destination" },
      origin_location_id: { type: "id", label: "Origin location" },
      destination_location_id: { type: "id", label: "Destination location" },
      distance_km: { type: "positiveNumber", label: "Distance (km)" },
      estimated_duration_minutes: { type: "positiveNumber", label: "Estimated duration" },
      base_fare: { type: "positiveNumber", label: "Base fare" },
      per_km_rate: { type: "positiveNumber", label: "Per-km rate" },
      status: { maxLength: 30, label: "Status" },
      route_type: { maxLength: 30, label: "Route type" },
      is_active: { label: "Active" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const columns = [];
    const values = [];
    for (const [field, column] of Object.entries(ROUTE_WRITABLE)) {
      if (body[field] !== undefined) {
        columns.push(column);
        values.push(body[field]);
      }
    }
    if (columns.length === 0) return err("No valid fields provided", 400);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(`INSERT INTO routes (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`, values);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
