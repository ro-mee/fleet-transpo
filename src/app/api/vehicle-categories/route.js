import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { writeAudit, writeAuditRequired } from "@/lib/audit";

const DEFAULT_HOTEL_CATEGORIES = [
  { category_name: "VIP Guest Transport", description: "Executive SUVs & Luxury Vehicles for VIP Guest Pickups" },
  { category_name: "Guest Shuttle & Airport Transfer", description: "Passenger Vans & Minibuses for Group Transfers" },
  { category_name: "Hotel Operations & Logistics", description: "Cargo Pickups & Vans for Housekeeping & Kitchen Supplies" },
  { category_name: "Staff & Employee Transport", description: "Shuttle Buses & Vans for Hotel Employee Shift Transport" },
];

// Client-writable columns for vehiclecategories. Column names are never taken
// from the request body — that would allow SQL injection via crafted keys.
const CATEGORY_WRITABLE = [
  "category_name",
  "description",
  "base_rate",
  "per_km_rate",
  "per_hour_rate",
  "image_url",
  "status",
];
// Excludes the legacy category seating_capacity column; seats belong to vehicles.
const CATEGORY_COLUMNS = [
  "category_id", "category_name", "description", "base_rate", "per_km_rate",
  "per_hour_rate", "image_url", "status", "created_at", "updated_at", "deleted_at",
].join(", ");

export async function GET(req) {
  try {
    const session = await requirePermission(req, "categories", "read");
    let { rows } = await query(
      `SELECT ${CATEGORY_COLUMNS} FROM vehiclecategories WHERE status = 'Active' AND deleted_at IS NULL ORDER BY category_name`
    );

    // Auto-seed default Hotel categories if none exist in database
    if (!rows || rows.length === 0) {
      let insertedCount = 0;
      for (const cat of DEFAULT_HOTEL_CATEGORIES) {
        try {
          const seeded = await query(
            `INSERT INTO vehiclecategories (category_name, description, status)
             VALUES ($1, $2, 'Active') RETURNING category_id`,
            [cat.category_name, cat.description]
          );
          insertedCount += seeded.rows.length;
        } catch (seedErr) {
          console.warn("Auto-seed category skipped:", seedErr);
        }
      }
      if (insertedCount > 0) {
        await writeAudit(req, session, {
          action: "system_seed",
          resource: "vehiclecategories",
          newValues: { source: "default_categories", count: insertedCount, outcome: "inserted" },
        });
      }
      const seeded = await query(
        `SELECT ${CATEGORY_COLUMNS} FROM vehiclecategories WHERE status = 'Active' AND deleted_at IS NULL ORDER BY category_name`
      );
      rows = seeded.rows;
    }

    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "categories", "create");
    const body = await parseBody(req);

    const errors = validateBody(body, {
      category_name: { required: true, maxLength: 100, label: "Category name" },
      description: { maxLength: 500, label: "Description" },
      status: { maxLength: 30, label: "Status" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const keys = [];
    const values = [];
    for (const key of CATEGORY_WRITABLE) {
      if (body[key] !== undefined) {
        keys.push(key);
        values.push(body[key]);
      }
    }
    if (keys.length === 0) return err("No valid fields provided", 400);
    const cols = keys.join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const row = await withTransaction(async (tx) => {
      const { rows } = await tx.query(`INSERT INTO vehiclecategories (${cols}) VALUES (${placeholders}) RETURNING ${CATEGORY_COLUMNS}`, values);
      await writeAuditRequired(tx, req, session, {
        action: "create", resource: "vehiclecategories", resourceId: rows[0]?.category_id,
        newValues: { changed_fields: keys, outcome: "created" },
      });
      return rows[0];
    });
    return ok(row, 201);
  } catch (e) { return handleError(e); }
}
