import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
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
  next_service_date: { type: "date", label: "Next service date" },
  next_service_mileage: { type: "positiveNumber", label: "Next service mileage" },
  fuel_type: { maxLength: 30, label: "Fuel type" },
  vehicle_status: { maxLength: 30, label: "Status" },
};

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
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
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const id = (await params).id;
    const body = await parseBody(req);
    const { documents, ...vehicleData } = body;

    const errors = validateBody(vehicleData, vehicleWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    if (vehicleData.plate_number) vehicleData.plate_number = normalizePlate(vehicleData.plate_number);
    if (vehicleData.vehicle_name) vehicleData.vehicle_name = normalizeName(vehicleData.vehicle_name);

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
    const session = await requireAuth(req, ["system_admin", "admin"]);
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
