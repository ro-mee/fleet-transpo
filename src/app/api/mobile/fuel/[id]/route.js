import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { validateOdometerReading } from "@/lib/vehicles/odometer";
import { isOwnedFuelReceiptUrl } from "@/lib/fuel/receipt-storage";

const WRITABLE_COLUMNS = [
  "station_name",
  "liters",
  "amount",
  "odometer",
  "fuel_date",
  "receipt_url",
];

const SUBMITTED_STATUS = "Pending";

export async function PUT(req, { params }) {
  try {
    const session = await requireDriver(req);
    const rawId = (await params).id;
    const id = String(rawId).replace(/^fuel_/, "");
    if (!/^\d+$/.test(id)) return err("Invalid fuel record id", 400);
    const body = await parseBody(req);

    // Verify ownership and status
    const { rows: existing } = await query(
      `SELECT fr.fuel_record_id, fr.status, fr.liters, fr.amount, v.mileage
         FROM fuelrecords fr
         JOIN vehicles v ON v.vehicle_id = fr.vehicle_id AND v.deleted_at IS NULL
        WHERE fr.fuel_record_id = $1 AND fr.driver_id = $2 AND fr.deleted_at IS NULL`,
      [id, session.user.driverId]
    );

    if (!existing.length) {
      return err("Fuel record not found or you do not have permission to edit it", 404);
    }

    if (existing[0].status?.toLowerCase() !== "rejected") {
      return err("Only rejected fuel reports can be resubmitted", 400);
    }

    if (typeof body.receipt_url !== "string" || !body.receipt_url.trim()) {
      return err("A receipt photo is required to verify the fuel report", 400);
    }
    if (!isOwnedFuelReceiptUrl(body.receipt_url, session.user.driverId)) return err("The receipt photo is not a valid upload for this driver", 400);
    if (body.liters !== undefined && (!Number.isFinite(Number(body.liters)) || Number(body.liters) <= 0)) return err("liters must be a positive number", 400);
    if (Number(body.liters) > 1000) return err("liters exceeds the maximum allowed per fuel report", 400);
    if (body.amount !== undefined && (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0)) return err("amount must be a positive number", 400);
    if (Number(body.amount) > 1000000) return err("amount exceeds the maximum allowed per fuel report", 400);
    if (body.fuel_date !== undefined && Number.isNaN(new Date(body.fuel_date).getTime())) return err("fuel_date must be a valid date", 400);
    if (body.station_name !== undefined && String(body.station_name).length > 255) return err("station_name is too long", 400);
    if (body.odometer !== undefined) {
      const odo = validateOdometerReading({ reading: body.odometer, currentMileage: existing[0]?.mileage });
      if (!odo.ok) return err(odo.error, 400);
    }

    const updates = [];
    const values = [];
    let idx = 1;

    for (const col of WRITABLE_COLUMNS) {
      if (body[col] !== undefined) {
        updates.push(`${col} = $${idx++}`);
        values.push(body[col]);
      }
    }

    if (body.liters !== undefined || body.amount !== undefined) {
      const liters = Number(body.liters ?? existing[0].liters);
      const amount = Number(body.amount ?? existing[0].amount);
      updates.push(`price_per_liter = $${idx++}`);
      values.push(Number((amount / liters).toFixed(2)));
    }

    if (updates.length === 0) {
      return err("No valid fields provided for update", 400);
    }

    // Automatically set status back to Pending
    updates.push(`status = $${idx++}`);
    values.push(SUBMITTED_STATUS);
    
    // Clear rejection reason
    updates.push(`rejection_reason = $${idx++}`);
    values.push(null);

    updates.push(`updated_by = $${idx++}`);
    values.push(session.user.employeeId);

    updates.push(`updated_at = $${idx++}`);
    values.push(new Date().toISOString());

    const idParam = idx++;
    values.push(id);
    const driverParam = idx++;
    values.push(session.user.driverId);

    const { rows } = await query(
      `UPDATE fuelrecords 
       SET ${updates.join(", ")}
       WHERE fuel_record_id = $${idParam} AND driver_id = $${driverParam} AND status = 'Rejected'
       RETURNING *`,
      values
    );

    if (!rows[0]) return err("Fuel report is no longer rejected and cannot be resubmitted", 409);

    return ok(rows[0]);
  } catch (e) {
    return handleError(e);
  }
}
