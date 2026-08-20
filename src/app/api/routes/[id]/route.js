import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

const routeWriteSchema = {
  route_name: { maxLength: 150, label: "Route name" },
  origin: { maxLength: 255, label: "Origin" },
  destination: { maxLength: 255, label: "Destination" },
  origin_location_id: { type: "id", label: "Origin location" },
  destination_location_id: { type: "id", label: "Destination location" },
  distance_km: { type: "positiveNumber", label: "Distance (km)" },
  estimated_duration_minutes: { type: "positiveNumber", label: "Estimated duration" },
  base_fare: { type: "positiveNumber", label: "Base fare" },
  per_km_rate: { type: "positiveNumber", label: "Per-km rate" },
  status: { maxLength: 30, label: "Status" },
  route_type: { maxLength: 30, label: "Route type" },
  is_active: { label: "Active" },
};

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

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rows } = await query(`SELECT r.*, row_to_json(ol.*) as origin_location, row_to_json(dl.*) as destination_location FROM routes r LEFT JOIN locations ol ON r.origin_location_id = ol.location_id LEFT JOIN locations dl ON r.destination_location_id = dl.location_id WHERE r.route_id = $1 AND r.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return err("Route not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const id = (await params).id;
    const body = await parseBody(req);

    const errors = validateBody(body, routeWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const columns = [];
    const values = [];
    for (const [field, column] of Object.entries(ROUTE_WRITABLE)) {
      if (body[field] !== undefined) {
        columns.push(`${column} = $${columns.length + 1}`);
        values.push(body[field]);
      }
    }
    if (columns.length === 0) return err("No valid fields provided", 400);
    values.push(id);
    const { rows } = await query(`UPDATE routes SET ${columns.join(", ")} WHERE route_id = $${values.length} RETURNING *`, values);
    if (!rows[0]) return err("Route not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin"]);
    const id = (await params).id;
    const { rowCount } = await query(`UPDATE routes SET deleted_at = NOW(), status = 'Inactive' WHERE route_id = $1`, [id]);
    if (!rowCount) return err("Route not found", 404);
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}
