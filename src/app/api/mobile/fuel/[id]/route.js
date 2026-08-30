import { query, withTransaction } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { toCalendarDay } from "@/lib/dates";
import { isOwnedFuelReceiptUrl } from "@/lib/fuel/receipt-storage";
import { fuelAllocationError } from "@/lib/fuel/request-policy";
import { computeFuelFlags, detectDuplicateReceipt } from "@/lib/fuel/transaction-integrity";

const WRITABLE_COLUMNS = [
  "station_name",
  "liters",
  "amount",
  "fuel_date",
  "receipt_url",
  "receipt_fuel_type",
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
      `SELECT fr.fuel_record_id, fr.status, fr.liters, fr.amount, fr.fuel_date, fr.fuel_request_id,
              fr.vehicle_id, fr.receipt_scan_data, fr.receipt_transaction_id,
              r.approved_liters, r.allocation_month,
              v.fuel_type AS vehicle_fuel_type, v.tank_capacity_l, v.fuel_level
         FROM fuelrecords fr
         JOIN vehicles v ON v.vehicle_id = fr.vehicle_id AND v.deleted_at IS NULL
         LEFT JOIN fuelrequests r ON r.fuel_request_id = fr.fuel_request_id
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
    if (existing[0].fuel_request_id) {
      const allocationError = fuelAllocationError(
        existing[0].approved_liters,
        body.liters ?? existing[0].liters
      );
      if (allocationError) return err(allocationError, 400);
      const receiptDay = toCalendarDay(body.fuel_date ?? existing[0].fuel_date);
      if (!receiptDay || receiptDay.slice(0, 7) !== toCalendarDay(existing[0].allocation_month).slice(0, 7)) {
        return err("The receipt date must be within the fuel request's allocation month", 409);
      }
    }
    if (body.amount !== undefined && (!Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0)) return err("amount must be a positive number", 400);
    if (Number(body.amount) > 1000000) return err("amount exceeds the maximum allowed per fuel report", 400);
    if (body.fuel_date !== undefined && Number.isNaN(new Date(body.fuel_date).getTime())) return err("fuel_date must be a valid date", 400);
    if (body.station_name !== undefined && String(body.station_name).length > 255) return err("station_name is too long", 400);
  if (body.receipt_fuel_type !== undefined) {
    body.receipt_fuel_type = typeof body.receipt_fuel_type === "string" && body.receipt_fuel_type.trim()
      ? body.receipt_fuel_type.trim().slice(0, 50)
      : null;
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

    const liters = Number(body.liters ?? existing[0].liters);
    const amount = Number(body.amount ?? existing[0].amount);
    const pricePerLiter = Number((amount / liters).toFixed(2));
    
    if (body.liters !== undefined || body.amount !== undefined) {
      updates.push(`price_per_liter = $${idx++}`);
      values.push(pricePerLiter);
    }

    if (updates.length === 0) {
      return err("No valid fields provided for update", 400);
    }
    
    const receiptScanData = body.receipt_scan_data != null && typeof body.receipt_scan_data === "object"
      ? body.receipt_scan_data
      : existing[0].receipt_scan_data;
      
    const receiptTransactionId = typeof body.receipt_transaction_id === "string"
      ? body.receipt_transaction_id.trim().slice(0, 64) || null
      : (body.receipt_scan_data?.transaction_id
          ? String(body.receipt_scan_data.transaction_id).trim().slice(0, 64)
          : existing[0].receipt_transaction_id);

    const flags = computeFuelFlags({
      receiptFuelType: body.receipt_fuel_type ?? existing[0].receipt_fuel_type,
      vehicleFuelType: existing[0].vehicle_fuel_type,
      pricePerLiter,
      liters,
      tankCapacityL: existing[0].tank_capacity_l,
      fuelLevel: existing[0].fuel_level,
      receiptScanData,
      submittedValues: {
        liters,
        amount,
        station_name: body.station_name ?? existing[0].station_name
      },
    });

    updates.push(`receipt_scan_data = $${idx++}`);
    values.push(receiptScanData ? JSON.stringify(receiptScanData) : null);
    
    updates.push(`receipt_transaction_id = $${idx++}`);
    values.push(receiptTransactionId);

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

    const updatedRecord = await withTransaction(async (tx) => {
      // Content-based duplicate detection
      const duplicateResult = await detectDuplicateReceipt(tx, {
        receiptTransactionId,
        stationName: body.station_name ?? existing[0].station_name,
        fuelDate: body.fuel_date ?? existing[0].fuel_date,
        liters,
        amount,
        vehicleId: existing[0].vehicle_id,
        excludeDriverId: session.user.driverId,
      });
      if (duplicateResult.exact) {
        const error = new Error("This receipt appears to have already been submitted");
        error.status = 409;
        throw error;
      }
      if (duplicateResult.possible) {
        flags.possible_duplicate = true;
      }
      
      updates.push(`flags = $${idx++}`);
      values.push(Object.keys(flags).length > 0 ? JSON.stringify(flags) : null);

      const { rows } = await tx.query(
        `UPDATE fuelrecords 
         SET ${updates.join(", ")}
         WHERE fuel_record_id = $${idParam} AND driver_id = $${driverParam} AND status = 'Rejected'
         RETURNING *`,
        values
      );
      return rows[0];
    });

    if (!updatedRecord) return err("Fuel report is no longer rejected and cannot be resubmitted", 409);

    return ok(updatedRecord);
  } catch (e) {
    return handleError(e);
  }
}
