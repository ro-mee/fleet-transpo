import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { validateOdometerReading } from "@/lib/vehicles/odometer";
import { writeAudit } from "@/lib/audit";

export async function GET(req, { params }) {
  try {
    await requirePermission(req, "fuel", "read_all");
    const { id } = await params;
    const { rows } = await query(
      `SELECT 
        fr.*,
        row_to_json(v.*) as vehicles,
        json_build_object(
          'driver_id', d.driver_id,
          'license_number', d.license_number,
          'employees', json_build_object(
            'first_name', e.first_name,
            'last_name', e.last_name
          )
        ) as drivers
      FROM fuelrecords fr
      LEFT JOIN vehicles v ON fr.vehicle_id = v.vehicle_id
      LEFT JOIN drivers d ON fr.driver_id = d.driver_id
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      WHERE fr.fuel_record_id = $1 AND fr.deleted_at IS NULL`,
      [id]
    );

    if (!rows.length) return err("Fuel record not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

const WRITABLE = new Set([
  "vehicle_id", "driver_id", "trip_id", "liters", "amount", "price_per_liter",
  "odometer", "fuel_type", "fuel_date", "station_name", "receipt_url",
  "status", "rejection_reason", "notes",
]);

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "fuel", "update");
    const { id } = await params;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      vehicle_id: { type: "id", label: "Vehicle" },
      driver_id: { type: "id", label: "Driver" },
      trip_id: { type: "id", label: "Trip" },
      liters: { type: "positiveNumber", label: "Liters" },
      amount: { type: "positiveNumber", label: "Total amount" },
      price_per_liter: { type: "positiveNumber", label: "Price per liter" },
      odometer: { type: "positiveNumber", label: "Odometer" },
      fuel_type: { maxLength: 50, label: "Fuel type" },
      fuel_date: { type: "date", label: "Fuel date" },
      station_name: { maxLength: 255, label: "Station name" },
      receipt_url: { maxLength: 2000, label: "Receipt image" },
      status: { maxLength: 30, label: "Status" },
      rejection_reason: { maxLength: 500, label: "Rejection reason" },
      notes: { maxLength: 500, label: "Notes" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const { rows: before } = await query(
      `SELECT status, approved_at, vehicle_id FROM fuelrecords WHERE fuel_record_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!before.length) return err("Fuel record not found", 404);

    const keys = Object.keys(body).filter((k) => WRITABLE.has(k));
    if (keys.length === 0) return err("No fields to update", 400);

    if (body.odometer !== undefined) {
      const { rows: vehicleRows } = await query(
        `SELECT mileage FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
        [body.vehicle_id ?? before[0].vehicle_id]
      );
      const odo = validateOdometerReading({
        reading: body.odometer,
        currentMileage: vehicleRows[0]?.mileage,
      });
      if (!odo.ok) return err(odo.error, 400);
    }

    const prev = before[0].status;
    if (body.status && body.status !== prev) {
      if (prev === "Completed") return err("Completed fuel records cannot change status.", 409);
      if (body.status === "Rejected" && !(body.rejection_reason || "").trim()) {
        return err("A rejection reason is required when rejecting.", 400);
      }
    }

    if (body.status === "Approved") {
      body.approved_by = session.user.employeeId;
      body.approved_at = new Date().toISOString();
      body.rejection_reason = null;
    }
    body.updated_by = session.user.employeeId;

    const values = keys.map((k) => body[k]);

    if (body.status === "Approved") {
      keys.push("approved_by");
      values.push(body.approved_by);
      keys.push("approved_at");
      values.push(body.approved_at);
      if (!keys.includes("rejection_reason")) {
        keys.push("rejection_reason");
        values.push(null);
      }
    }

    keys.push("updated_by");
    values.push(body.updated_by);
    keys.push("updated_at");
    values.push(new Date().toISOString());

    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    values.push(id);

    const { rows } = await query(
      `UPDATE fuelrecords SET ${setClause} WHERE fuel_record_id = $${values.length} RETURNING *`,
      values
    );

    if (!rows.length) return err("Fuel record not found or already deleted", 404);

    // Compliance audit: record who approved/rejected and why. Best-effort by
    // design — writeAudit never throws, so a failed audit can't block the
    // status change itself.
    const newStatus = rows[0].status;
    if (body.status && newStatus !== prev && ["Approved", "Rejected"].includes(newStatus)) {
      await writeAudit(req, session, {
        action: "update",
        resource: "fuelrecords",
        resourceId: rows[0].fuel_record_id,
        oldValues: { status: prev, rejection_reason: before[0].rejection_reason ?? null },
        newValues: {
          status: newStatus,
          rejection_reason: rows[0].rejection_reason ?? null,
          approved_by: rows[0].approved_by ?? null,
          approved_at: rows[0].approved_at ?? null,
        },
      });
    }

    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function DELETE(req, { params }) {
  try {
    await requirePermission(req, "fuel", "delete");
    const { id } = await params;

    const { rows } = await query(
      `UPDATE fuelrecords SET deleted_at = NOW() WHERE fuel_record_id = $1 RETURNING *`,
      [id]
    );

    if (!rows.length) return err("Fuel record not found", 404);
    return ok({ message: "Fuel record archived successfully" });
  } catch (e) { return handleError(e); }
}
