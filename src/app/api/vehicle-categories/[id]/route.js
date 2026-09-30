import { withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { writeAuditRequired } from "@/lib/audit";

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
    const session = await requirePermission(req, "categories", "update");
    const id = Number((await params).id);
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
    const row = await withTransaction(async (tx) => {
      const { rows: before } = await tx.query(`SELECT status FROM vehiclecategories WHERE category_id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!before[0]) return null;
      const { rows } = await tx.query(
        `UPDATE vehiclecategories SET ${setClause.join(", ")} WHERE category_id = $${values.length} AND deleted_at IS NULL RETURNING *`,
        values
      );
      if (!rows[0]) return null;
      await writeAuditRequired(tx, req, session, {
        action: "update", resource: "vehiclecategories", resourceId: id,
        oldValues: { status: before[0].status },
        newValues: { changed_fields: CATEGORY_WRITABLE.filter((key) => body[key] !== undefined), status: rows[0].status },
      });
      return rows[0];
    });
    if (!row) return err("Category not found", 404);
    return ok(row);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    const session = await requirePermission(req, "categories", "delete");
    const id = Number((await params).id);
    const archived = await withTransaction(async (tx) => {
      const { rows: before } = await tx.query(`SELECT status FROM vehiclecategories WHERE category_id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!before[0]) return false;
      const { rows } = await tx.query(
        `UPDATE vehiclecategories SET deleted_at = NOW(), status = 'Inactive' WHERE category_id = $1 AND deleted_at IS NULL RETURNING category_id`,
        [id]
      );
      if (!rows[0]) return false;
      await writeAuditRequired(tx, req, session, {
        action: "delete", resource: "vehiclecategories", resourceId: id,
        oldValues: { status: before[0].status }, newValues: { status: "Inactive", deleted_at: true, outcome: "archived" },
      });
      return true;
    });
    if (!archived) return err("Category not found", 404);
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}
