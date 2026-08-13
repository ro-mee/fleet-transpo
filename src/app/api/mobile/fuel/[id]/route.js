import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { validateOdometerReading } from "@/lib/vehicles/odometer";

const WRITABLE_COLUMNS = [
  "station_name",
  "liters",
  "amount",
  "price_per_liter",
  "odometer",
  "fuel_type",
  "fuel_date",
  "receipt_url",
];

const SUBMITTED_STATUS = "Pending";

export async function PUT(req, { params }) {
  try {
    const session = await requireDriver(req);
    const { id } = await params;
    const body = await parseBody(req);

    // Verify ownership and status
    const { rows: existing } = await query(
      `SELECT fuel_record_id, status FROM fuelrecords WHERE fuel_record_id = $1 AND driver_id = $2`,
      [id, session.user.driverId]
    );

    if (!existing.length) {
      return err("Fuel record not found or you do not have permission to edit it", 404);
    }

    if (existing[0].status?.toLowerCase() !== "rejected") {
      return err("Only rejected fuel reports can be resubmitted", 400);
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

    if (updates.length === 0) {
      return err("No valid fields provided for update", 400);
    }

    // Automatically set status back to Pending
    updates.push(`status = $${idx++}`);
    values.push(SUBMITTED_STATUS);
    
    // Clear rejection reason
    updates.push(`rejection_reason = $${idx++}`);
    values.push(null);

    values.push(id);
    values.push(session.user.driverId);

    const { rows } = await query(
      `UPDATE fuelrecords 
       SET ${updates.join(", ")}
       WHERE fuel_record_id = $${idx - 2} AND driver_id = $${idx - 1}
       RETURNING *`,
      values
    );

    return ok(rows[0]);
  } catch (e) {
    return handleError(e);
  }
}
