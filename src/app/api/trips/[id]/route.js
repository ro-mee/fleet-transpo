import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { TRIP_WRITABLE } from "../route";

export async function GET(req, { params }) {
  try {
    await requirePermission(req, "trips", "read_all");
    const id = (await params).id;
    const { rows } = await query(`SELECT ${TRIPS_SELECT} ${TRIPS_JOINS} WHERE t.trip_id = $1 AND t.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requirePermission(req, "trips", "update_all");
    const id = (await params).id;
    const body = await parseBody(req);
    const columns = [];
    const values = [];
    for (const key of TRIP_WRITABLE) {
      if (body[key] !== undefined) {
        columns.push(`${key} = $${columns.length + 1}`);
        values.push(body[key]);
      }
    }
    if (columns.length === 0) return err("No valid fields provided", 400);
    values.push(id);
    const { rows } = await query(`UPDATE trips SET ${columns.join(", ")} WHERE trip_id = $${values.length} RETURNING *`, values);
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
