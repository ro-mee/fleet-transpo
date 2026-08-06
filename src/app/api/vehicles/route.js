import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizePlate, normalizeName } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";

const vehicleWriteSchema = {
  plate_number: { required: true, type: "plate", label: "Plate number", maxLength: 12 },
  vehicle_name: { required: true, type: "name", label: "Vehicle type/name", maxLength: 100 },
  model: { maxLength: 100, label: "Model" },
  manufacturer: { maxLength: 100, label: "Make/brand" },
  year: { type: "year", label: "Year model" },
  color: { maxLength: 50, label: "Color" },
  seating_capacity: { type: "seating", label: "Passenger capacity" },
  category_id: { type: "id", label: "Vehicle category" },
  purchase_price: { type: "positiveNumber", label: "Purchase price" },
  purchase_date: { type: "date", label: "Purchase date" },
  insurance_expiry: { type: "date", label: "Insurance expiry" },
  registration_expiry: { type: "date", label: "Registration expiry" },
  next_service_date: { type: "date", label: "Next service date" },
  next_service_mileage: { type: "positiveNumber", label: "Next service mileage" },
  // min 1, not 0: NULL means "this axis does not predict", 0 would mean "due
  // immediately, forever". See vehicles.service_interval_km in migration 018.
  service_interval_km: { type: "positiveNumber", label: "Service interval (km)", min: 1, integer: true },
  service_interval_days: { type: "positiveNumber", label: "Service interval (days)", min: 1, integer: true },
  fuel_type: { maxLength: 30, label: "Fuel type" },
  vehicle_status: { maxLength: 30, label: "Status" },
};

/**
 * The only columns a request body may write, in the order they are inserted.
 *
 * Enumerated rather than derived from Object.keys(body): these names become SQL
 * identifiers, and identifiers cannot be parameterized the way values can. The
 * write schema above is not a substitute — validatePayload walks the schema's
 * own keys, never the body's, so an undeclared key is never rejected by
 * validation and would previously have reached Postgres as a column name.
 *
 * Every entry is a real vehicles column and matches the write schema one for
 * one; this table carries no aliases. Adding a field means adding it in both
 * places, and here in both vehicle routes.
 *
 * The vehicles table has further columns that are deliberately absent —
 * mileage, fuel_level, last_service_date, deleted_at — because each is owned by
 * a specific flow (the trip routes clamp mileage forward with GREATEST, the
 * maintenance recompute owns the service dates, DELETE owns the soft delete).
 * Letting a general-purpose vehicle write reach them would bypass those rules.
 */
const WRITABLE_COLUMNS = [
  "plate_number",
  "vehicle_name",
  "model",
  "manufacturer",
  "year",
  "color",
  "seating_capacity",
  "category_id",
  "purchase_price",
  "purchase_date",
  "insurance_expiry",
  "registration_expiry",
  "next_service_date",
  "next_service_mileage",
  "service_interval_km",
  "service_interval_days",
  "fuel_type",
  "vehicle_status",
];

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"]);
    const { searchParams } = new URL(req.url);

    let sql = `SELECT v.*, row_to_json(vc.*) as vehiclecategories
               FROM vehicles v
               LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
               WHERE v.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    const status = searchParams.get("status");
    if (status) { sql += ` AND v.vehicle_status = $${idx++}`; params.push(status); }

    const category_id = searchParams.get("category_id");
    if (category_id) { sql += ` AND v.category_id = $${idx++}`; params.push(+category_id); }

    const search = searchParams.get("search");
    if (search) {
      sql += ` AND (v.plate_number ILIKE $${idx} OR v.vehicle_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += " ORDER BY v.vehicle_id DESC";

    const page = parseInt(searchParams.get("page"));
    const pageSize = parseInt(searchParams.get("pageSize"));
    if (page && pageSize) {
      sql += ` LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(pageSize, (page - 1) * pageSize);
    }

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const body = await parseBody(req);

    // Separate documents array from vehicle attributes
    const { documents, ...vehicleData } = body;

    // Validate fields before inserting
    const errors = validateBody(vehicleData, vehicleWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    if (vehicleData.plate_number) vehicleData.plate_number = normalizePlate(vehicleData.plate_number);
    if (vehicleData.vehicle_name) vehicleData.vehicle_name = normalizeName(vehicleData.vehicle_name);

    // Built from the allowlist rather than from the body's own keys. Empty
    // strings and undefined become null on the way, to avoid PostgreSQL's
    // "invalid input syntax for type date: ''".
    const keys = [];
    const values = [];
    for (const column of WRITABLE_COLUMNS) {
      if (!(column in vehicleData)) continue;
      const value = vehicleData[column];
      keys.push(column);
      values.push(value === "" || value === undefined ? null : value);
    }

    const cols = keys.join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");

    const { rows } = await query(
      `INSERT INTO vehicles (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    const newVehicle = rows[0];

    // Insert linked documents into vehicledocuments table
    if (Array.isArray(documents) && documents.length > 0 && newVehicle?.vehicle_id) {
      for (const doc of documents) {
        if (!doc.document_type || (!doc.file_url && !doc.expiry_date && !doc.document_number)) continue;
        try {
          await query(
            `INSERT INTO vehicledocuments (vehicle_id, document_type, document_number, file_url, expiry_date, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              newVehicle.vehicle_id,
              doc.document_type,
              doc.document_number?.trim() || null,
              doc.file_url || null,
              doc.expiry_date || null,
              doc.status || "Active",
            ]
          );
        } catch (docErr) {
          console.warn("Failed to insert vehicle document:", docErr);
        }
      }
    }

    await writeAudit(req, session, {
      action: "create",
      resource: "vehicles",
      resourceId: newVehicle?.vehicle_id,
      newValues: newVehicle,
    });

    return ok(newVehicle, 201);
  } catch (e) { return handleError(e); }
}
