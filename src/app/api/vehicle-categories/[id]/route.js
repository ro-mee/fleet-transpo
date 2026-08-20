import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

// Client-writable columns for vehiclecategories. Column names are never taken
// from the request body — that would allow SQL injection via crafted keys.
const CATEGORY_WRITABLE = [
  "category_name",
  "description",
  "base_rate",
  "per_km_rate",
  "per_hour_rate",
  "seating_capacity",
  "image_url",
  "status",
];

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

    const setClause = [];
    const values = [];
    for (const key of CATEGORY_WRITABLE) {
      if (body[key] !== undefined) {
        setClause.push(`${key} = $${setClause.length + 1}`);
        values.push(body[key]);
      }
    }
    if (setClause.length === 0) return err("No valid fields provided", 400);
    values.push(id);
    const { rows } = await query(
      `UPDATE vehiclecategories SET ${setClause.join(", ")} WHERE category_id = $${values.length} RETURNING *`,
      values
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
