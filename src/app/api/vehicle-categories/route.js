import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

const DEFAULT_HOTEL_CATEGORIES = [
  { category_name: "VIP Guest Transport", description: "Executive SUVs & Luxury Vehicles for VIP Guest Pickups", seating_capacity: 7 },
  { category_name: "Guest Shuttle & Airport Transfer", description: "Passenger Vans & Minibuses for Group Transfers", seating_capacity: 14 },
  { category_name: "Hotel Operations & Logistics", description: "Cargo Pickups & Vans for Housekeeping & Kitchen Supplies", seating_capacity: 3 },
  { category_name: "Staff & Employee Transport", description: "Shuttle Buses & Vans for Hotel Employee Shift Transport", seating_capacity: 18 },
];

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

export async function GET(req) {
  try {
    await requirePermission(req, "categories", "read");
    let { rows } = await query(
      `SELECT * FROM vehiclecategories WHERE status = 'Active' AND deleted_at IS NULL ORDER BY category_name`
    );

    // Auto-seed default Hotel categories if none exist in database
    if (!rows || rows.length === 0) {
      for (const cat of DEFAULT_HOTEL_CATEGORIES) {
        try {
          await query(
            `INSERT INTO vehiclecategories (category_name, description, seating_capacity, status)
             VALUES ($1, $2, $3, 'Active')`,
            [cat.category_name, cat.description, cat.seating_capacity]
          );
        } catch (seedErr) {
          console.warn("Auto-seed category skipped:", seedErr);
        }
      }
      const seeded = await query(
        `SELECT * FROM vehiclecategories WHERE status = 'Active' AND deleted_at IS NULL ORDER BY category_name`
      );
      rows = seeded.rows;
    }

    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requirePermission(req, "categories", "create");
    const body = await parseBody(req);

    const errors = validateBody(body, {
      category_name: { required: true, maxLength: 100, label: "Category name" },
      description: { maxLength: 500, label: "Description" },
      seating_capacity: { type: "seating", label: "Seating capacity" },
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
    const { rows } = await query(
      `INSERT INTO vehiclecategories (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
