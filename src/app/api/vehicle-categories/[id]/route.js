import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

export async function PUT(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const id = (await params).id;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      category_name: { maxLength: 100, label: "Category name" },
      description: { maxLength: 500, label: "Description" },
      seating_capacity: { type: "seating", label: "Seating capacity" },
      status: { maxLength: 30, label: "Status" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const keys = Object.keys(body);
    const values = Object.values(body);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const { rows } = await query(
      `UPDATE vehiclecategories SET ${setClause} WHERE category_id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    if (!rows[0]) return err("Category not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin"]);
    const id = (await params).id;
    const { rowCount } = await query(
      `UPDATE vehiclecategories SET deleted_at = NOW(), status = 'Inactive' WHERE category_id = $1`,
      [id]
    );
    if (rowCount === 0) return err("Category not found", 404);
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}
