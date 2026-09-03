import { query, withTransaction } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { toCalendarDay } from "@/lib/dates";
import { isOwnedFuelReceiptUrl } from "@/lib/fuel/receipt-storage";
import { ACTIVE_FUEL_TRIP_STATUSES, fuelFulfillmentError, fuelTankCapacityError, fuelTypeMismatch } from "@/lib/fuel/request-policy";
import { computeFuelFlags, detectDuplicateReceipt } from "@/lib/fuel/transaction-integrity";
import { authorizeCompanyCardForDriver } from "@/lib/auth/company-cards";

/**
 * POST /api/mobile/fuel
 *
 * Mobile fuel report submission.
 *
 * Per mobile/README.md the client may not choose its own driver_id, vehicle_id,
 * or trip_id. driver_id comes from the token; vehicle_id and trip_id are
 * derived from the driver's own recent trips. A client-supplied vehicle_id is
 * verified against that set rather than trusted.
 */

// Columns the client may set. vehicle_id, trip_id, driver_id and created_by are
// all derived server-side and deliberately absent.
const WRITABLE_COLUMNS = [
  "station_name",
  "liters",
  "amount",
  "fuel_date",
  "receipt_url",
  "client_submission_id",
  "payment_method",
  "company_card_id",
];

// Matches the tabs on the web review screen in src/app/(dashboard)/fuel/page.js.
// A mobile submission always enters the queue as Pending.
const SUBMITTED_STATUS = "Pending";

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);

    if (body.liters === undefined) return err("liters is required", 400);
    if (body.amount === undefined) return err("amount is required", 400);
    const fuelRequestId = Number(body.fuel_request_id);
    if (!Number.isInteger(fuelRequestId) || fuelRequestId <= 0) {
      return err("An approved fuel request is required", 400);
    }
    if (!body.fuel_date) return err("fuel_date is required", 400);
    if (typeof body.receipt_url !== "string" || !body.receipt_url.trim()) {
      return err("A receipt photo is required to verify the fuel report", 400);
    }
    if (!isOwnedFuelReceiptUrl(body.receipt_url, session.user.driverId)) {
      return err("The receipt photo is not a valid upload for this driver", 400);
    }
    if (typeof body.client_submission_id !== "string" || !/^[0-9a-z-]{16,64}$/i.test(body.client_submission_id)) {
      return err("client_submission_id is required", 400);
    }
    const fuelDay = toCalendarDay(body.fuel_date);
    if (!fuelDay || Number.isNaN(new Date(fuelDay).getTime())) return err("fuel_date must be a valid date", 400);

    const liters = Number(body.liters);
    const amount = Number(body.amount);
    if (!Number.isFinite(liters) || liters <= 0) {
      return err("liters must be a positive number", 400);
    }
    if (liters > 1000) return err("liters exceeds the maximum allowed per fuel report", 400);
    if (!Number.isFinite(amount) || amount <= 0) {
      return err("amount must be a positive number", 400);
    }
    if (amount > 1000000) return err("amount exceeds the maximum allowed per fuel report", 400);

    const VALID_PAYMENT_METHODS = ['Company Card', 'Cash', 'Personal Card', 'Other'];
    if (body.payment_method && !VALID_PAYMENT_METHODS.includes(body.payment_method)) {
      return err("Invalid payment method", 400);
    }

    if (body.payment_method === 'Company Card') {
      if (!body.company_card_id) return err("company_card_id is required when payment method is Company Card", 400);
    } else {
      if (body.company_card_id) return err("company_card_id must be null for non-Company Card payments", 400);
    }

    if (body.station_name !== undefined && String(body.station_name).length > 255) return err("station_name is too long", 400);
    const receiptFuelType = typeof body.receipt_fuel_type === "string" && body.receipt_fuel_type.trim()
      ? body.receipt_fuel_type.trim().slice(0, 50)
      : null;

    // Resolve the vehicle from the driver's own trips. Anything the client sent
    // is treated as a request, not a fact — the driver_id predicate is what
    // makes another driver's trip unusable here.
    let trip;
    if (body.trip_id !== undefined && body.trip_id !== null) {
      const tripId = Number(body.trip_id);
      if (!Number.isInteger(tripId)) return err("Invalid trip id", 400);

      const { rows } = await query(
        `SELECT t.trip_id, t.vehicle_id, v.fuel_type, v.mileage, v.tank_capacity_l, v.fuel_level
           FROM trips t
           JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
          WHERE t.trip_id = $1 AND t.driver_id = $2 AND t.deleted_at IS NULL
            AND t.trip_status = ANY($3::text[])
          LIMIT 1`,
        [tripId, session.user.driverId, ACTIVE_FUEL_TRIP_STATUSES]
      );
      // Same 404 for another driver's trip as for a nonexistent one.
      if (!rows[0]) return err("Trip not found", 404);
      trip = rows[0];
    } else {
      // No trip named: prefer a live trip, then the driver's current vehicle assignment.
      const { rows } = await query(
        `SELECT t.trip_id, t.vehicle_id, v.fuel_type, v.mileage, v.tank_capacity_l, v.fuel_level
           FROM trips t
           JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
          WHERE t.driver_id = $1
            AND t.deleted_at IS NULL
            AND t.trip_status = ANY($2::text[])
          ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC
          LIMIT 1`,
        [session.user.driverId, ACTIVE_FUEL_TRIP_STATUSES]
      );
      trip = rows[0];
      if (!trip) {
        const { rows: assignments } = await query(
          `SELECT NULL::int AS trip_id, a.vehicle_id, v.fuel_type, v.mileage, v.tank_capacity_l, v.fuel_level
             FROM driver_vehicle_assignments a
             JOIN vehicles v ON v.vehicle_id = a.vehicle_id AND v.deleted_at IS NULL
            WHERE a.driver_id = $1 AND a.assigned_from <= CURRENT_DATE
              AND (a.assigned_until IS NULL OR a.assigned_until >= CURRENT_DATE)
            ORDER BY a.assigned_from DESC
            LIMIT 1`,
          [session.user.driverId]
        );
        trip = assignments[0];
      }
      if (!trip) return err("No vehicle is currently assigned to you", 409);
    }

    if (
      body.vehicle_id !== undefined &&
      body.vehicle_id !== null &&
      Number(body.vehicle_id) !== trip.vehicle_id
    ) {
      return err("Fuel can only be reported for your assigned vehicle", 403);
    }

    // --- Receipt scan history: preserve original AI extraction for audit ---
    const receiptScanData = body.receipt_scan_data != null && typeof body.receipt_scan_data === "object"
      ? body.receipt_scan_data
      : null;
    const receiptTransactionId = typeof body.receipt_transaction_id === "string"
      ? body.receipt_transaction_id.trim().slice(0, 64) || null
      : (receiptScanData?.transaction_id
          ? String(receiptScanData.transaction_id).trim().slice(0, 64)
          : null);

    // --- Compute deterministic anomaly flags ---
    const pricePerLiter = Number((amount / liters).toFixed(2));
    const flags = computeFuelFlags({
      receiptFuelType,
      vehicleFuelType: trip.fuel_type,
      pricePerLiter,
      liters,
      tankCapacityL: trip.tank_capacity_l,
      fuelLevel: trip.fuel_level,
      receiptScanData,
      submittedValues: { liters, amount, station_name: body.station_name },
    });

    const columns = [];
    const values = [];
    for (const key of WRITABLE_COLUMNS) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }

    columns.push("price_per_liter", "odometer", "fuel_type", "vehicle_id", "trip_id", "driver_id", "created_by", "status", "fuel_request_id");
    if (receiptFuelType) columns.push("receipt_fuel_type");
    columns.push("receipt_scan_data", "flags", "receipt_transaction_id");
    values.push(
      pricePerLiter,
      trip.mileage,
      trip.fuel_type || "Unspecified",
      trip.vehicle_id,
      trip.trip_id,
      session.user.driverId,
      session.user.employeeId,
      SUBMITTED_STATUS,
      fuelRequestId
    );
    if (receiptFuelType) values.push(receiptFuelType);
    values.push(
      receiptScanData ? JSON.stringify(receiptScanData) : null,
      Object.keys(flags).length > 0 ? JSON.stringify(flags) : null,
      receiptTransactionId
    );

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const record = await withTransaction(async (tx) => {
      // Validate Company Card if applicable
      if (body.payment_method === 'Company Card') {
        await authorizeCompanyCardForDriver({
          tx,
          companyCardId: body.company_card_id,
          employeeId: session.user.employeeId,
          vehicleId: trip.vehicle_id
        });
      }

      const { rows: requests } = await tx.query(
        `SELECT * FROM fuelrequests
          WHERE fuel_request_id = $1 AND driver_id = $2 AND vehicle_id = $3
          FOR UPDATE`,
        [fuelRequestId, session.user.driverId, trip.vehicle_id]
      );
      const { rows: duplicate } = await tx.query(
        `SELECT * FROM fuelrecords
          WHERE driver_id = $1 AND client_submission_id = $2 AND deleted_at IS NULL
          LIMIT 1`,
        [session.user.driverId, body.client_submission_id]
      );
      if (duplicate[0]) return duplicate[0];

      const policyError = fuelFulfillmentError(requests[0], liters);
      if (policyError) {
        const error = new Error(policyError);
        error.status = requests[0] ? 409 : 404;
        throw error;
      }
      if (fuelDay.slice(0, 7) !== toCalendarDay(requests[0].allocation_month).slice(0, 7)) {
        const error = new Error("The receipt date must be within the fuel request's allocation month");
        error.status = 409;
        throw error;
      }
      const estimatedCurrentLiters = trip.tank_capacity_l != null && trip.fuel_level != null
        ? Number(trip.tank_capacity_l) * (Number(trip.fuel_level) / 100)
        : NaN;
      const tankError = fuelTankCapacityError({
        tankCapacityL: trip.tank_capacity_l,
        estimatedCurrentLiters,
        liters,
      });
      if (tankError) {
        const error = new Error(tankError);
        error.status = 409;
        throw error;
      }

      // --- Content-based duplicate detection ---
      const duplicateResult = await detectDuplicateReceipt(tx, {
        receiptTransactionId,
        stationName: body.station_name,
        fuelDate: fuelDay,
        liters,
        amount,
        vehicleId: trip.vehicle_id,
      });
      if (duplicateResult.exact) {
        const error = new Error("This receipt appears to have already been submitted");
        error.status = 409;
        throw error;
      }
      if (duplicateResult.possible) {
        flags.possible_duplicate = true;
      }

      const { rows } = await tx.query(
        `INSERT INTO fuelrecords (${columns.join(", ")}) VALUES (${placeholders})
         RETURNING *`,
        values
      );
      await tx.query(
        `UPDATE fuelrequests
            SET status = 'Fulfilled', fulfilled_at = NOW(), updated_at = NOW()
          WHERE fuel_request_id = $1`,
        [fuelRequestId]
      );
      return rows[0];
    });
    return ok(record, 201);
  } catch (e) {
    if (e?.status) return err(e.message, e.status);
    if (e?.code === "23505") return err("This fuel request already has a receipt", 409);
    return handleError(e);
  }
}
