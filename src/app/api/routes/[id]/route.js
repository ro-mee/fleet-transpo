import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

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
    await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`UPDATE routes SET ${k.map((k,i)=>`${k} = $${i+1}`).join(", ")} WHERE route_id = $${k.length+1} RETURNING *`, [...v, id]);
    if (!rows[0]) return err("Route not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rowCount } = await query(`UPDATE routes SET deleted_at = NOW(), status = 'Inactive' WHERE route_id = $1`, [id]);
    if (!rowCount) return err("Route not found", 404);
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}
