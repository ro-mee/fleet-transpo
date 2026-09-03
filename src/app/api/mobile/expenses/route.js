import { query, withTransaction } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { toCalendarDay } from "@/lib/dates";
import { authorizeCompanyCardForDriver } from "@/lib/auth/company-cards";

const WRITABLE_COLUMNS = [
  "client_submission_id",
  "category",
  "merchant_name",
  "amount",
  "currency",
  "expense_date",
  "payment_method",
  "company_card_id",
  "driver_edits"
];

const SUBMITTED_STATUS = "Pending";
const VALID_CATEGORIES = ['Toll', 'Parking', 'Meals', 'Lodging', 'Other'];
const VALID_PAYMENT_METHODS = ['Company Card', 'Cash', 'Personal Card', 'Other'];

export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);

    if (typeof body.client_submission_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.client_submission_id)) {
      return err("client_submission_id must be a valid UUID", 400);
    }
    if (!VALID_CATEGORIES.includes(body.category)) return err("Invalid category", 400);
    if (!VALID_PAYMENT_METHODS.includes(body.payment_method)) return err("Invalid payment method", 400);
    
    if (body.payment_method === 'Company Card') {
      if (!body.company_card_id) return err("company_card_id is required when payment method is Company Card", 400);
    } else {
      if (body.company_card_id) return err("company_card_id must be null for non-Company Card payments", 400);
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) return err("amount must be a positive number", 400);
    if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)) {
      return err("currency must be exactly 3 uppercase letters", 400);
    }
    if (!body.expense_date) return err("expense_date is required", 400);

    const expenseDay = toCalendarDay(body.expense_date);
    if (!expenseDay || Number.isNaN(new Date(expenseDay).getTime())) return err("expense_date must be a valid date", 400);

    // Trip Attribution (Phase 5)
    let tripId = null;
    let vehicleId = null;
    const flags = {};

    // 1. Check for Active Trip
    const { rows: trips } = await query(
      `SELECT t.trip_id, t.vehicle_id
         FROM trips t
        WHERE t.driver_id = $1
          AND t.deleted_at IS NULL
          AND t.trip_status IN ('In Progress', 'Scheduled', 'Dispatched')
        ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC
        LIMIT 1`,
      [session.user.driverId]
    );

    if (trips[0]) {
      tripId = trips[0].trip_id;
      vehicleId = trips[0].vehicle_id;
    } else {
      flags["NO_ACTIVE_TRIP"] = true;
      // 2. Check for Active Vehicle Assignment
      const { rows: assignments } = await query(
        `SELECT a.vehicle_id
           FROM driver_vehicle_assignments a
          WHERE a.driver_id = $1 AND a.assigned_from <= CURRENT_DATE
            AND (a.assigned_until IS NULL OR a.assigned_until >= CURRENT_DATE)
          ORDER BY a.assigned_from DESC
          LIMIT 1`,
        [session.user.driverId]
      );
      if (assignments[0]) {
        vehicleId = assignments[0].vehicle_id;
      } else {
        flags["NO_VEHICLE_ASSIGNMENT"] = true;
        flags["UNATTRIBUTED_EXPENSE"] = true;
      }
    }

    // Process Submission in Transaction
    const record = await withTransaction(async (tx) => {
      // Tier 0: Idempotency
      const { rows: duplicateSubmission } = await tx.query(
        `SELECT * FROM expense_records
          WHERE client_submission_id = $1
          LIMIT 1`,
        [body.client_submission_id]
      );
      if (duplicateSubmission[0]) return duplicateSubmission[0];

      // F-01 & F-02: Server-side Ownership and Trust Boundary
      const { rows: scans } = await tx.query(
        `SELECT * FROM expense_receipt_scans WHERE client_submission_id = $1 FOR UPDATE`,
        [body.client_submission_id]
      );
      const scanRecord = scans[0];
      if (!scanRecord) {
        const error = new Error("Receipt scan not found");
        error.status = 404;
        throw error;
      }
      if (scanRecord.driver_id !== session.user.driverId) {
        const error = new Error("This receipt belongs to another driver");
        error.status = 403;
        throw error;
      }
      if (!scanRecord.ocr_snapshot) {
        const error = new Error("Receipt scan is incomplete");
        error.status = 400;
        throw error;
      }
      if (scanRecord.is_submitted) {
        const error = new Error("This receipt has already been submitted");
        error.status = 409;
        throw error;
      }

      const authoritativeStorageKey = scanRecord.receipt_storage_key;
      const authoritativeSha256 = scanRecord.receipt_sha256;
      const authoritativeOcr = JSON.stringify(scanRecord.ocr_snapshot);

      // Validate Company Card if applicable
      if (body.payment_method === 'Company Card') {
        await authorizeCompanyCardForDriver({
          tx,
          companyCardId: body.company_card_id,
          employeeId: session.user.employeeId,
          vehicleId
        });
      }

      // Tier 1: Duplicate Receipt Hash
      const { rows: hashMatches } = await tx.query(
        `SELECT id FROM expense_records WHERE receipt_sha256 = $1 LIMIT 1`,
        [authoritativeSha256]
      );
      if (hashMatches[0]) flags["DUPLICATE_RECEIPT_HASH"] = true;

      // Tier 2: Company Card Duplicate
      if (body.payment_method === 'Company Card') {
        const { rows: cardDupes } = await tx.query(
          `SELECT id FROM expense_records
            WHERE company_card_id = $1
              AND merchant_name = $2
              AND amount = $3
              AND expense_date >= $4::timestamptz - INTERVAL '1 hour'
              AND expense_date <= $4::timestamptz + INTERVAL '1 hour'
            LIMIT 1`,
          [body.company_card_id, body.merchant_name, amount, body.expense_date]
        );
        if (cardDupes[0]) flags["POTENTIAL_CARD_DUPLICATE"] = true;
      }

      // Tier 3: Driver Duplicate
      const { rows: driverDupes } = await tx.query(
        `SELECT id FROM expense_records
          WHERE driver_id = $1
            AND merchant_name = $2
            AND amount = $3
            AND expense_date >= $4::timestamptz - INTERVAL '1 day'
            AND expense_date <= $4::timestamptz + INTERVAL '1 day'
          LIMIT 1`,
        [session.user.driverId, body.merchant_name, amount, body.expense_date]
      );
      if (driverDupes[0]) flags["POTENTIAL_DRIVER_DUPLICATE"] = true;

      // Tier 4: Cross-Driver Duplicate (F-06)
      const { rows: crossDriverDupes } = await tx.query(
        `SELECT id FROM expense_records
          WHERE driver_id != $1
            AND merchant_name = $2
            AND amount = $3
            AND expense_date >= $4::timestamptz - INTERVAL '1 day'
            AND expense_date <= $4::timestamptz + INTERVAL '1 day'
          LIMIT 1`,
        [session.user.driverId, body.merchant_name, amount, body.expense_date]
      );
      if (crossDriverDupes[0]) flags["CROSS_DRIVER_SIMILAR_EXPENSE"] = true;

      const columns = [];
      const values = [];
      for (const key of WRITABLE_COLUMNS) {
        if (body[key] !== undefined) {
          columns.push(key);
          if (typeof body[key] === "object" && body[key] !== null) {
            values.push(JSON.stringify(body[key]));
          } else {
            values.push(body[key]);
          }
        }
      }

      columns.push("driver_id", "trip_id", "vehicle_id", "status", "submitted_at", "receipt_uploaded_at", "receipt_storage_key", "receipt_sha256", "ocr_snapshot");
      values.push(
        session.user.driverId,
        tripId,
        vehicleId,
        SUBMITTED_STATUS,
        "now()",
        "now()",
        authoritativeStorageKey,
        authoritativeSha256,
        authoritativeOcr
      );

      if (Object.keys(flags).length > 0) {
        columns.push("flags");
        values.push(JSON.stringify(flags));
      }

      const placeholders = columns.map((col, i) => {
        // Special case for NOW() calls
        if (values[i] === "now()") return "NOW()";
        return `$${i + 1}`;
      });

      // Filter out 'now()' from parameter binding array, since we injected it into the SQL string
      const bindValues = values.filter(v => v !== "now()");

      // We need to map the $ indexes correctly after filtering
      let paramIdx = 1;
      const finalPlaceholders = values.map(v => v === "now()" ? "NOW()" : `$${paramIdx++}`).join(", ");

      const { rows } = await tx.query(
        `INSERT INTO expense_records (${columns.join(", ")}) VALUES (${finalPlaceholders})
         RETURNING *`,
        bindValues
      );

      await tx.query(
        `UPDATE expense_receipt_scans SET is_submitted = true, updated_at = NOW() WHERE client_submission_id = $1`,
        [body.client_submission_id]
      );

      return rows[0];
    });

    return ok(record, 201);
  } catch (e) {
    if (e?.status) return err(e.message, e.status);
    if (e?.code === "23505") return err("An expense with this submission ID already exists", 409);
    return handleError(e);
  }
}
