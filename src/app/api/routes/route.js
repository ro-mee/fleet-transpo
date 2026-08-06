import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

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

    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO routes (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
