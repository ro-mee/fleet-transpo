import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

const DEFAULT_HOTEL_CATEGORIES = [
  { category_name: "VIP Guest Transport", description: "Executive SUVs & Luxury Vehicles for VIP Guest Pickups", seating_capacity: 7 },
  { category_name: "Guest Shuttle & Airport Transfer", description: "Passenger Vans & Minibuses for Group Transfers", seating_capacity: 14 },
  { category_name: "Hotel Operations & Logistics", description: "Cargo Pickups & Vans for Housekeeping & Kitchen Supplies", seating_capacity: 3 },
  { category_name: "Staff & Employee Transport", description: "Shuttle Buses & Vans for Hotel Employee Shift Transport", seating_capacity: 18 },
];

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
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
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
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

    const keys = Object.keys(body);
    const values = Object.values(body);
    const cols = keys.join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO vehiclecategories (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
