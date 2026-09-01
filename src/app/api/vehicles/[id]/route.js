import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, normalizePlate, toVehicleTitleCase } from "@/lib/validation/helpers";
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
 * The only columns a request body may write.
 *
 * Enumerated rather than derived from Object.keys(body): these names become SQL
 * identifiers, and identifiers cannot be parameterized the way values can. The
 * write schema above is not a substitute — validatePayload walks the schema's
 * own keys, never the body's, so an undeclared key is never rejected by
 * validation and would previously have reached Postgres as a column name.
 *
 * deleted_at is deliberately absent: archiving goes through DELETE, so a PUT
 * has no business soft-deleting or resurrecting a vehicle. So are mileage,
 * fuel_level and last_service_date, each owned by a flow with its own rules —
 * the trip routes clamp mileage forward with GREATEST, and the maintenance
 * recompute owns the service dates.
 *
 * Kept in step with the identical list in ../route.js. Adding a field means
 * adding it to both routes and to both write schemas.
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

export async function GET(req, { params }) {
  try {
    await requirePermission(req, "vehicles", "read_all");
    const id = (await params).id;
    const { rows: vehicleRows } = await query(
      `SELECT v.*, row_to_json(vc.*) as vehiclecategories
       FROM vehicles v
       LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
       WHERE v.vehicle_id = $1 AND v.deleted_at IS NULL LIMIT 1`,
      [id]
    );
    if (!vehicleRows[0]) return err("Vehicle not found", 404);

    const vehicle = vehicleRows[0];

    // Fetch attached vehicle documents
    const { rows: docRows } = await query(
      `SELECT * FROM vehicledocuments WHERE vehicle_id = $1 AND deleted_at IS NULL ORDER BY document_id ASC`,
      [id]
    );
    vehicle.documents = docRows || [];

    return ok(vehicle);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requirePermission(req, "vehicles", "update");
    const id = (await params).id;
    const body = await parseBody(req);
    const { documents, ...vehicleData } = body;

    const errors = validateBody(vehicleData, vehicleWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    if (vehicleData.plate_number) vehicleData.plate_number = normalizePlate(vehicleData.plate_number);
    if (vehicleData.vehicle_name) vehicleData.vehicle_name = toVehicleTitleCase(vehicleData.vehicle_name);
    if (vehicleData.manufacturer) vehicleData.manufacturer = toVehicleTitleCase(vehicleData.manufacturer);

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

    // Reachable in a way the POST is not: no field is required on a PUT, so a
    // body of nothing but unknown keys leaves the allowlist empty and would
    // otherwise produce `SET  WHERE`, a syntax error rather than a clear 400.
    if (keys.length === 0) {
      return err("No writable fields were provided.", 400);
    }

    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const { rows } = await query(
      `UPDATE vehicles SET ${setClause} WHERE vehicle_id = $${keys.length + 1} AND deleted_at IS NULL RETURNING *`,
      [...values, id]
    );
    if (!rows[0]) return err("Vehicle not found", 404);

    const updatedVehicle = rows[0];

    // Upsert attached vehicle documents
    if (Array.isArray(documents) && documents.length > 0) {
      for (const doc of documents) {
        if (!doc.document_type) continue;

        const { rows: existingDocs } = await query(
          `SELECT document_id FROM vehicledocuments WHERE vehicle_id = $1 AND document_type = $2 AND deleted_at IS NULL LIMIT 1`,
          [id, doc.document_type]
        );

        if (existingDocs.length > 0) {
          await query(
            `UPDATE vehicledocuments
             SET document_number = $1, file_url = $2, expiry_date = $3, status = $4, updated_at = NOW()
             WHERE document_id = $5`,
            [
              doc.document_number?.trim() || null,
              doc.file_url || null,
              doc.expiry_date || null,
              doc.status || "Active",
              existingDocs[0].document_id,
            ]
          );
        } else if (doc.file_url || doc.expiry_date || doc.document_number) {
          await query(
            `INSERT INTO vehicledocuments (vehicle_id, document_type, document_number, file_url, expiry_date, status)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              id,
              doc.document_type,
              doc.document_number?.trim() || null,
              doc.file_url || null,
              doc.expiry_date || null,
              doc.status || "Active",
            ]
          );
        }
      }
    }

    if (updatedVehicle.vehicle_status !== "Decommissioned" && vehicleData.registration_expiry !== undefined) {
      const { syncVehicleStatus } = await import("@/services/status.service");
      await syncVehicleStatus(id);
    }

    return ok(updatedVehicle);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    const session = await requirePermission(req, "vehicles", "delete");
    const id = (await params).id;
    const { rowCount } = await query(
      `UPDATE vehicles SET deleted_at = NOW() WHERE vehicle_id = $1`,
      [id]
    );
    if (rowCount === 0) return err("Vehicle not found", 404);
    await writeAudit(req, session, { action: "delete", resource: "vehicles", resourceId: id });
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}
