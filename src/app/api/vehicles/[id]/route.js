import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rows } = await query(
      `SELECT v.*, row_to_json(vc.*) as vehiclecategories
       FROM vehicles v
       LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
       WHERE v.vehicle_id = $1 AND v.deleted_at IS NULL LIMIT 1`,
      [id]
    );
    if (!rows[0]) return err("Vehicle not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const { documents, ...vehicleData } = body;

    // Sanitize empty strings to null to prevent PostgreSQL "invalid input syntax for type date: ''"
    Object.keys(vehicleData).forEach((k) => {
      if (vehicleData[k] === "" || vehicleData[k] === undefined) {
        vehicleData[k] = null;
      }
    });

    const keys = Object.keys(vehicleData);
    const values = Object.values(vehicleData);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const { rows } = await query(
      `UPDATE vehicles SET ${setClause} WHERE vehicle_id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    if (!rows[0]) return err("Vehicle not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rowCount } = await query(
      `UPDATE vehicles SET deleted_at = NOW() WHERE vehicle_id = $1`,
      [id]
    );
    if (rowCount === 0) return err("Vehicle not found", 404);
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}
