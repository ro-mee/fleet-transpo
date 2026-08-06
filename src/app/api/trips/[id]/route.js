import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rows } = await query(`SELECT ${TRIPS_SELECT} ${TRIPS_JOINS} WHERE t.trip_id = $1 AND t.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const id = (await params).id;
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`UPDATE trips SET ${k.map((k,i)=>`${k} = $${i+1}`).join(", ")} WHERE trip_id = $${k.length+1} RETURNING *`, [...v, id]);
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
