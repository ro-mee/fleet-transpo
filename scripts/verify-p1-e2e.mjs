import { loadEnvLocal } from './load-env.mjs';
loadEnvLocal();
import pg from 'pg';
import { signAccessToken, signRefreshToken, hashToken, REFRESH_TOKEN_TTL_SECONDS } from '../src/lib/auth/mobile-token.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BASE_URL = 'http://localhost:3000';

// Trailing slashes stripped. `.env` sets this WITH one
// (`https://<ref>.supabase.co/`) and every receipt_url below appends
// `/storage/v1/...`, so the value used to come out with a doubled separator.
// isOwnedFuelImageUrl matches the path as a RAW PREFIX
// (src/lib/fuel/receipt-storage.js:188), so `//storage/...` failed ownership on
// every scenario and the endpoint answered 400 before it read any fuel data —
// which is why Scenario A reported a receipt problem rather than a result.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321').replace(/\/+$/, '');

// ---------------------------------------------------------------------------
// Throwaway rows are tracked so the finally block can soft-delete them.
//
// This runs against the LIVE database. Before mandatory email OTP an abandoned
// fixture was junk; now it is an account on a reserved `@example.com` domain
// that can neither sign in (the login gate refuses it) nor be removed through
// the UI. Runs are timestamped, so every run used to add a fresh one.
//
// Soft-delete, not DELETE, matching verify-cancel-cascade / verify-trip-status /
// verify-quickwins: `drivers.employee_id` carries no ON DELETE CASCADE, so a
// hard delete would need an ordered unwinding across most of the schema.
//
// driver_vehicle_assignments, fuelallocations and fuelrequests have no
// `deleted_at` column and so cannot be swept; they hang off parents that are
// soft-deleted and go inert with them.
// ---------------------------------------------------------------------------
const createdEmployeeIds = [];
const createdDriverIds = [];
const createdVehicleIds = [];

async function cleanup() {
  const softDeletes = [
    // fuelrecords first: it carries driver_id and vehicle_id.
    ["fuelrecords", `driver_id = ANY($1::int[])`, createdDriverIds],
    ["vehicles", `vehicle_id = ANY($1::int[])`, createdVehicleIds],
    ["drivers", `driver_id = ANY($1::int[])`, createdDriverIds],
    ["employees", `employee_id = ANY($1::int[])`, createdEmployeeIds],
  ];
  for (const [table, where, ids] of softDeletes) {
    if (!ids.length) continue;
    const { rowCount } = await pool.query(
      `UPDATE ${table} SET deleted_at = NOW() WHERE ${where} AND deleted_at IS NULL`,
      [ids]
    );
    if (rowCount) console.log(`cleanup: soft-deleted ${rowCount} ${table} row(s)`);
  }

  // The bearer tokens minted below are real credentials, so they are destroyed
  // rather than soft-deleted — matching soft-delete-otp-collision.mjs:117.
  // Left in place they would outlive the fixture as valid 30-day sessions
  // against a soft-deleted account.
  if (createdEmployeeIds.length) {
    const { rowCount } = await pool.query(
      `DELETE FROM mobile_refresh_tokens WHERE employee_id = ANY($1::int[])`,
      [createdEmployeeIds]
    );
    if (rowCount) console.log(`cleanup: deleted ${rowCount} mobile_refresh_tokens row(s)`);
  }
}

// Mint a bearer token the API will actually accept.
//
// signAccessToken alone is not enough. resolveCurrentIdentity re-reads
// `auth_version` and requires a live, unrevoked row in `mobile_refresh_tokens`
// for the token's familyId (src/lib/api/utils.js:151-175), so a hand-signed
// token 401s with "Session expired. Please sign in again." however correct its
// signature is. This mirrors POST /api/mobile/auth/login (route.js:248-272),
// minus the password and OTP steps — which a reserved-domain fixture can never
// pass, because the OTP gate fails closed on `@example.com`.
async function mintDriverToken({ employee_id, driver_id, auth_version }) {
  const { token: refreshToken, familyId } = await signRefreshToken({
    employeeId: employee_id,
    authVersion: auth_version,
  });
  const accessToken = await signAccessToken({
    employeeId: employee_id,
    role: "driver",
    driverId: driver_id,
    authVersion: auth_version,
    familyId,
  });
  await pool.query(
    `INSERT INTO mobile_refresh_tokens
       (employee_id, token_hash, family_id, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5, $6)`,
    [employee_id, hashToken(refreshToken), familyId, REFRESH_TOKEN_TTL_SECONDS, null, "verify-p1-e2e"]
  );
  return accessToken;
}

// Open a fresh Approved fuel request for a vehicle.
//
// `uq_fuelrequests_open_vehicle` (supabase/migrations/066:55) allows only ONE
// request per vehicle with status Pending or Approved. A successful submission
// resolves its request to 'Fulfilled' and steps out of that predicate — but a
// REJECTED submission leaves its request open, and Scenario C is rejected by
// design (409, the tank only has so much room). That stranded request is what
// the F3 insert then collided with.
//
// Retiring the stranded request first is what an approver would have to do
// before raising a new one for the same vehicle, so the harness does the same
// rather than weakening the index. `Rejected`, not `Fulfilled`: no fuel was
// delivered, and `fuelrequests_status_check` (schema.sql:581) permits only
// Pending/Approved/Rejected/Fulfilled — the first two are in the index
// predicate, so they would not clear it.
async function openFuelRequest(driverId, vehicleId, liters) {
  await pool.query(
    `UPDATE fuelrequests SET status = 'Rejected', updated_at = NOW()
      WHERE vehicle_id = $1 AND status IN ('Pending', 'Approved')`,
    [vehicleId]
  );
  const { rows } = await pool.query(`
    INSERT INTO fuelrequests (driver_id, vehicle_id, status, requested_liters, recommended_liters, approved_liters, allocation_month)
    VALUES ($1, $2, 'Approved', $3, $3, $3, date_trunc('month', CURRENT_DATE))
    RETURNING fuel_request_id
  `, [driverId, vehicleId, liters]);
  return rows[0].fuel_request_id;
}

// ---------------------------------------------------------------------------
// Assertions.
//
// Until now every scenario only `console.log`ged its response. That is how four
// stacked defects survived in this file: a fixture with no role, a token with no
// refresh family, a doubled URL separator and a stranded fuel request all looked
// identical in a terminal to a clean pass — the run "completed" either way.
// Nothing here failed, so nothing here was verified.
//
// check() records rather than throws, so one wrong response cannot hide the
// scenarios after it — the run's value is the whole picture of what the API did.
// ---------------------------------------------------------------------------
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    return true;
  }
  const suffix = detail === undefined ? "" : ` — ${detail}`;
  console.log(`  ❌ ${label}${suffix}`);
  failures.push(`${label}${suffix}`);
  return false;
}

// POST /api/mobile/fuel returns the inserted fuelrecords row flat (route.js:279
// `RETURNING *`, then ok(row, 201) at :292) — it is NOT wrapped in a `record`
// envelope. Errors are `{ error: <message> }` via err() (api/utils.js:282).
// JSONB arrives parsed, but a string is tolerated so an assertion can never
// itself throw and turn a wrong flag into a crashed run.
function flagsOf(data) {
  const raw = data?.flags;
  if (raw == null) return {};
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

function hasFlag(data, flag) {
  return flagsOf(data)[flag] === true;
}

async function runTests() {
  console.log("Starting Fuel Verification Tests...");

  try {
    // 1. Setup Test Data
    //
    // The fixtures must carry a real role. `resolveCurrentIdentity`
    // (src/lib/api/utils.js:146) rejects any identity whose role_name is null,
    // so a role-less employee makes every bearer request 401 — which is how
    // this script spent its life failing at Scenario A and leaking a fixture on
    // every run. Resolved rather than hard-coded, and refused loudly when
    // absent, so a missing role fails here instead of three steps later
    // disguised as an authentication problem.
    const { rows: roleRows } = await pool.query(
      `SELECT role_id FROM roles WHERE role_name = 'driver'`
    );
    if (!roleRows.length) {
      throw new Error("No 'driver' role in roles — cannot build an authenticating fixture.");
    }
    const driverRoleId = roleRows[0].role_id;

    // The CTE returns `auth_version` as well as the ids, because the token has
    // to carry the value `resolveCurrentIdentity` will re-read from this same row.
    const { rows: driverRows } = await pool.query(`
      WITH new_emp AS (
        INSERT INTO employees (first_name, last_name, email, role_id) VALUES ('Test', 'Driver', 'testdriver1-' || EXTRACT(EPOCH FROM NOW()) || '@example.com', $1) RETURNING employee_id, auth_version
      ),
      new_driver AS (
        INSERT INTO drivers (employee_id, license_number, license_expiry)
        SELECT employee_id, 'DL-TEST-001', '2030-12-31' FROM new_emp
        RETURNING driver_id, employee_id
      )
      SELECT d.driver_id, d.employee_id, e.auth_version
        FROM new_driver d JOIN new_emp e ON e.employee_id = d.employee_id
    `, [driverRoleId]);
    const driver1 = driverRows[0];
    createdDriverIds.push(driver1.driver_id);
    createdEmployeeIds.push(driver1.employee_id);

    const { rows: driver2Rows } = await pool.query(`
      WITH new_emp AS (
        INSERT INTO employees (first_name, last_name, email, role_id) VALUES ('Test', 'Driver2', 'testdriver2-' || EXTRACT(EPOCH FROM NOW()) || '@example.com', $1) RETURNING employee_id, auth_version
      ),
      new_driver AS (
        INSERT INTO drivers (employee_id, license_number, license_expiry)
        SELECT employee_id, 'DL-TEST-002', '2030-12-31' FROM new_emp
        RETURNING driver_id, employee_id
      )
      SELECT d.driver_id, d.employee_id, e.auth_version
        FROM new_driver d JOIN new_emp e ON e.employee_id = d.employee_id
    `, [driverRoleId]);
    const driver2 = driver2Rows[0];
    createdDriverIds.push(driver2.driver_id);
    createdEmployeeIds.push(driver2.employee_id);

    const { rows: vehicleRows } = await pool.query(`
      INSERT INTO vehicles (plate_number, vehicle_name, fuel_type, tank_capacity_l, fuel_efficiency_kmpl, fuel_level, mileage)
      VALUES ('TST-' || CAST(CAST(EXTRACT(EPOCH FROM NOW()) AS INT) AS VARCHAR), 'Test Diesel Van', 'Diesel', 80, 10, 20, 10000),
             ('TSG-' || CAST(CAST(EXTRACT(EPOCH FROM NOW()) AS INT) AS VARCHAR), 'Test Gas Car', 'Gasoline', 50, 15, 30, 5000)
      RETURNING vehicle_id, plate_number, fuel_type
    `);
    const vehicleDiesel = vehicleRows[0];
    const vehicleGas = vehicleRows[1];
    createdVehicleIds.push(vehicleDiesel.vehicle_id, vehicleGas.vehicle_id);

    // Create assignments
    await pool.query(`
      INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, assigned_from)
      VALUES ($1, $2, CURRENT_DATE), ($3, $4, CURRENT_DATE)
    `, [driver1.driver_id, vehicleDiesel.vehicle_id, driver2.driver_id, vehicleGas.vehicle_id]);

    await pool.query(`
      INSERT INTO fuelallocations (vehicle_id, allocation_month, allocated_liters)
      VALUES ($1, date_trunc('month', CURRENT_DATE), 500),
             ($2, date_trunc('month', CURRENT_DATE), 500)
    `, [vehicleDiesel.vehicle_id, vehicleGas.vehicle_id]);

    // Create Fuel Requests
    const req1 = await openFuelRequest(driver1.driver_id, vehicleDiesel.vehicle_id, 50);
    const req2 = await openFuelRequest(driver2.driver_id, vehicleGas.vehicle_id, 50);

    const token1 = await mintDriverToken(driver1);
    const token2 = await mintDriverToken(driver2);

    // Helper to call API
    async function submitFuel(token, payload) {
      const res = await fetch(`${BASE_URL}/api/mobile/fuel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      return { status: res.status, data };
    }

    // --- Scenario A: Normal Transaction (AI matches driver)
    console.log("\n--- Testing Scenario A: Normal Transaction ---");
    const payloadA = {
      fuel_request_id: req1,
      fuel_date: new Date().toISOString(),
      receipt_url: `${supabaseUrl}/storage/v1/object/sign/fuel-receipts/${driver1.driver_id}/receipt.jpg?token=123`,
      client_submission_id: 'sub-normal-001-test',
      station_name: 'Petron',
      liters: 40,
      amount: 2600,
      receipt_fuel_type: 'Diesel',
      receipt_scan_data: {
        station_name: { value: 'Petron', confidence: 0.99 },
        liters: { value: 40, confidence: 0.98 },
        total_amount: { value: 2600, confidence: 0.99 },
        fuel_type: { value: 'Diesel', confidence: 0.95 }
      }
    };
    
    const resA = await submitFuel(token1, payloadA);
    console.log("Scenario A Response:", resA.status, resA.data);

    // Scenario A is the control: AI values match what the driver submitted, the
    // price is ordinary and the fuel type is right, so nothing should be flagged.
    // If this is red, every scenario under it is measuring a broken baseline.
    check("A: normal transaction is accepted", resA.status === 201, `got ${resA.status} ${JSON.stringify(resA.data)}`);
    check("A: a fuel record came back", Number.isFinite(resA.data?.fuel_record_id), `fuel_record_id=${resA.data?.fuel_record_id}`);
    check("A: record is stored with the submitted status", resA.data?.status === "Pending", `status=${resA.data?.status}`);
    check("A: the submitted values are what is stored", Number(resA.data?.liters) === 40 && Number(resA.data?.amount) === 2600, `liters=${resA.data?.liters} amount=${resA.data?.amount}`);
    check("A: no anomaly flags are raised", Object.keys(flagsOf(resA.data)).length === 0, `flags=${JSON.stringify(flagsOf(resA.data))}`);

    // --- Scenario B: Driver Corrects AI
    console.log("\n--- Testing Scenario B: Driver Corrects AI ---");
    const reqB = await openFuelRequest(driver1.driver_id, vehicleDiesel.vehicle_id, 50);

    const payloadB = {
      fuel_request_id: reqB,
      fuel_date: new Date().toISOString(),
      receipt_url: `${supabaseUrl}/storage/v1/object/sign/fuel-receipts/${driver1.driver_id}/receipt2.jpg?token=123`,
      client_submission_id: 'sub-edit-001-test',
      station_name: 'Petron',
      liters: 42, // Driver edited from 40
      amount: 2600,
      receipt_scan_data: {
        station_name: { value: 'Petron', confidence: 0.99 },
        liters: { value: 40, confidence: 0.98 },
        total_amount: { value: 2600, confidence: 0.99 }
      }
    };
    const resB = await submitFuel(token1, payloadB);
    console.log("Scenario B Response:", resB.status, resB.data);

    // B changes liters 40 → 42 after the AI read 40, so the provenance of the
    // edit is the whole point: the flag must carry both numbers, not just that
    // *something* changed.
    check("B: driver correction is accepted", resB.status === 201, `got ${resB.status} ${JSON.stringify(resB.data)}`);
    check("B: driver_edited flag is raised", hasFlag(resB.data, "driver_edited"), `flags=${JSON.stringify(flagsOf(resB.data))}`);
    check("B: the edit records AI 40 → submitted 42",
      flagsOf(resB.data).edited_fields?.liters?.ai === 40 && flagsOf(resB.data).edited_fields?.liters?.submitted === 42,
      `edited_fields=${JSON.stringify(flagsOf(resB.data).edited_fields)}`);
    check("B: the driver's corrected value is what gets stored", Number(resB.data?.liters) === 42, `liters=${resB.data?.liters}`);

    // --- Scenario C: Cross-Driver Duplicate ---
    console.log("\n--- Testing Scenario C: Cross-Driver Duplicate ---");
    const payloadC = {
      fuel_request_id: req2,
      fuel_date: payloadA.fuel_date,
      receipt_url: `${supabaseUrl}/storage/v1/object/sign/fuel-receipts/${driver2.driver_id}/receipt3.jpg?token=123`,
      client_submission_id: 'sub-dup-001-test',
      station_name: 'Petron',
      liters: 40,
      amount: 2600
    };
    const resC = await submitFuel(token2, payloadC);
    console.log("Scenario C Response:", resC.status, resC.data);

    // Scenario C is named "Cross-Driver Duplicate" but CANNOT reach duplicate
    // detection as written, so its 409 does not mean what the name claims.
    //
    // Inside withTransaction the tank-capacity gate (route.js:250) runs before
    // detectDuplicateReceipt (:262). This fixture submits 40 L into vehicleGas —
    // a 50 L tank at 30% full, so ~35 L of space — and is refused on capacity
    // before any duplicate logic runs. Worse, even reaching it would not 409:
    // Tier 2 of detectDuplicateReceipt is explicitly non-rejecting, it only sets
    // possible_duplicate (transaction-integrity.js:118-134).
    //
    // So these assertions pin the rule that actually fires and refuse to let a
    // bare "409" stand in for the duplicate rule. Any 409 counting as a pass is
    // exactly how this scenario looked healthy while testing nothing.
    check("C: over-capacity submission is refused", resC.status === 409, `got ${resC.status} ${JSON.stringify(resC.data)}`);
    check("C: the refusal is the tank-capacity rule",
      typeof resC.data?.error === "string" && /tank|capacity|quantity/i.test(resC.data.error),
      `error=${JSON.stringify(resC.data?.error)}`);
    console.log("  ⚠️  C never reaches the duplicate rule it is named for — see the comment above.");

    // --- Scenario D: Wrong Fuel Type ---
    console.log("\n--- Testing Scenario D: Wrong Fuel Type ---");
    const reqD = await openFuelRequest(driver1.driver_id, vehicleDiesel.vehicle_id, 20);

    const payloadD = {
      fuel_request_id: reqD,
      fuel_date: new Date().toISOString(),
      receipt_url: `${supabaseUrl}/storage/v1/object/sign/fuel-receipts/${driver1.driver_id}/receipt4.jpg?token=123`,
      client_submission_id: 'sub-wrongfuel-001-test',
      station_name: 'Shell',
      liters: 20,
      amount: 1200,
      receipt_fuel_type: 'Gasoline' // Vehicle is Diesel
    };
    const resD = await submitFuel(token1, payloadD);
    console.log("Scenario D Response:", resD.status, resD.data);

    // D is a Gasoline receipt against a Diesel vehicle: accepted, never refused.
    // The flag is informational (transaction-integrity.js:43-45) and a 409 here
    // would be a policy change, not a cleanup.
    check("D: wrong fuel type is accepted", resD.status === 201, `got ${resD.status} ${JSON.stringify(resD.data)}`);
    check("D: fuel_type_mismatch flag is raised", hasFlag(resD.data, "fuel_type_mismatch"), `flags=${JSON.stringify(flagsOf(resD.data))}`);

    // --- Scenario E: Suspicious Price ---
    console.log("\n--- Testing Scenario E: Suspicious Price ---");
    const reqE = await openFuelRequest(driver1.driver_id, vehicleDiesel.vehicle_id, 10);

    const payloadE = {
      fuel_request_id: reqE,
      fuel_date: new Date().toISOString(),
      receipt_url: `${supabaseUrl}/storage/v1/object/sign/fuel-receipts/${driver1.driver_id}/receipt5.jpg?token=123`,
      client_submission_id: 'sub-price-001-test',
      station_name: 'Caltex',
      liters: 10,
      amount: 1500 // 150/L (Too high)
    };
    const resE = await submitFuel(token1, payloadE);
    console.log("Scenario E Response:", resE.status, resE.data);

    // E is 1500 / 10 L = 150 per liter, above the 120 default ceiling
    // (transaction-integrity.js:37-51). Like D, flagged rather than refused.
    check("E: suspicious price is accepted", resE.status === 201, `got ${resE.status} ${JSON.stringify(resE.data)}`);
    check("E: price_anomaly flag is raised", hasFlag(resE.data, "price_anomaly"), `flags=${JSON.stringify(flagsOf(resE.data))}`);

    // --- Scenario F: Exact Duplicate (Same driver, same transaction ID) ---
    console.log("\n--- Testing Scenario F: Exact Duplicate Retry ---");
    const resF1 = await submitFuel(token1, payloadE);
    console.log("Scenario F1 Response (Same client_submission_id):", resF1.status, resF1.data);

    // F1 replays E byte for byte. The early return on a matching
    // client_submission_id (route.js:228-234) must hand back the ORIGINAL row —
    // a second record here would mean a retrying client double-counts fuel.
    check("F1: replaying a submission id is idempotent", resF1.status === 201, `got ${resF1.status} ${JSON.stringify(resF1.data)}`);
    check("F1: the replay returns the original record, not a new one",
      resF1.data?.fuel_record_id === resE.data?.fuel_record_id,
      `F1=${resF1.data?.fuel_record_id} E=${resE.data?.fuel_record_id}`);

    const payloadF2 = { ...payloadE, client_submission_id: 'sub-price-002-test', receipt_transaction_id: 'receipt-12345' };
    const reqF2 = await openFuelRequest(driver1.driver_id, vehicleDiesel.vehicle_id, 10);
    payloadF2.fuel_request_id = reqF2;

    const resF2 = await submitFuel(token1, payloadF2);
    console.log("Scenario F2 Response (Submit first time with transaction ID):", resF2.status, resF2.data);

    check("F2: a new submission id is accepted", resF2.status === 201, `got ${resF2.status} ${JSON.stringify(resF2.data)}`);
    check("F2: it creates a NEW record rather than replaying E",
      resF2.data?.fuel_record_id !== resE.data?.fuel_record_id,
      `F2=${resF2.data?.fuel_record_id} E=${resE.data?.fuel_record_id}`);
    check("F2: receipt_transaction_id is stored", resF2.data?.receipt_transaction_id === "receipt-12345", `receipt_transaction_id=${resF2.data?.receipt_transaction_id}`);

    // KNOWN GAP — this assertion is expected to FAIL, and failing is its job.
    //
    // F2 matches E on exactly the Tier 2 predicate (station Caltex, same date,
    // 10 L, 1500) and Tier 1 cannot fire because receipt-12345 has not been seen
    // yet, so detectDuplicateReceipt returns { possible: true } and route.js:276
    // sets flags.possible_duplicate. That value is then thrown away: route.js:206
    // serialises `flags` into `values` BEFORE the transaction, so the INSERT at
    // :279 writes the pre-mutation copy and the flag never reaches the row.
    //
    // This is a defect in src/, not in this harness, which is why it is asserted
    // rather than worked around. Fixing it changes real stored records, so it is
    // left visible here for a deliberate decision instead of a silent patch.
    check("F2: Tier 2 possible-duplicate flag is persisted (KNOWN GAP)",
      hasFlag(resF2.data, "possible_duplicate"),
      "route.js:206 serialises `flags` before route.js:276 sets flags.possible_duplicate, so the INSERT writes the pre-mutation copy and the flag is discarded");

    const payloadF3 = { ...payloadF2, client_submission_id: 'sub-price-003-test' };
    const reqF3 = await openFuelRequest(driver2.driver_id, vehicleGas.vehicle_id, 10);
    payloadF3.fuel_request_id = reqF3;
    payloadF3.receipt_url = `${supabaseUrl}/storage/v1/object/sign/fuel-receipts/${driver2.driver_id}/receipt5.jpg?token=123`;

    const resF3 = await submitFuel(token2, payloadF3);
    console.log("Scenario F3 Response (Same transaction ID, cross driver):", resF3.status, resF3.data);

    // F3 is the real cross-driver duplicate test — Tier 1, keyed on the receipt
    // transaction id F2 just stored. Unlike Tier 2 this one IS meant to block,
    // and a second driver is the only way to prove the check is not scoped to
    // the submitting driver. (10 L into vehicleGas fits: ~35 L of space.)
    check("F3: reusing a receipt transaction id across drivers is refused", resF3.status === 409, `got ${resF3.status} ${JSON.stringify(resF3.data)}`);
    check("F3: the refusal names the duplicate receipt",
      typeof resF3.data?.error === "string" && /already been submitted/i.test(resF3.data.error),
      `error=${JSON.stringify(resF3.data?.error)}`);

    // --- Verify DB Records ---
    console.log("\n--- Verifying DB Records ---");
    const { rows: records } = await pool.query(`
      SELECT fuel_record_id, client_submission_id, status, flags, receipt_scan_data, station_name, liters, amount
      FROM fuelrecords
      WHERE driver_id IN ($1, $2)
      ORDER BY fuel_record_id ASC
    `, [driver1.driver_id, driver2.driver_id]);
    
    console.table(records.map(r => ({
      id: r.fuel_record_id,
      client_id: r.client_submission_id,
      status: r.status,
      station: r.station_name,
      liters: r.liters,
      flags: JSON.stringify(r.flags),
      scanData: r.receipt_scan_data ? 'Present' : 'None'
    })));

    // The response is not the whole contract — a refused submission that still
    // commits its INSERT would be invisible above, and a retry that stored two
    // rows would look like a clean 201. These read the table itself.
    const bySubmission = new Map(records.map((r) => [r.client_submission_id, r]));

    // A, B, D, E and F2 each write exactly one row; C and F3 are refused.
    check("DB: exactly the five accepted submissions were stored",
      records.length === 5,
      `found ${records.length}: ${records.map((r) => r.client_submission_id).join(", ")}`);

    // A 409 must be a rollback, not a partial write.
    for (const refused of ["sub-dup-001-test", "sub-price-003-test"]) {
      check(`DB: the refused submission "${refused}" left no row behind`,
        !bySubmission.has(refused),
        `row id ${bySubmission.get(refused)?.fuel_record_id}`);
    }

    // F1's replay must not have inserted a second copy of E.
    check("DB: the F1 replay did not store a second copy",
      records.filter((r) => r.client_submission_id === "sub-price-001-test").length === 1,
      `found ${records.filter((r) => r.client_submission_id === "sub-price-001-test").length}`);

    // The same contract as the F2 assertion above, read from the stored column
    // rather than the response. The pair is what distinguishes "the row never
    // received the flag" from "the row has it and the serialiser dropped it on
    // the way out" — both are red today, and that is the defect.
    const storedF2 = bySubmission.get("sub-price-002-test");
    check("DB: F2's stored row carries possible_duplicate (KNOWN GAP)",
      storedF2?.flags?.possible_duplicate === true,
      `stored flags=${JSON.stringify(storedF2?.flags ?? null)}`);

    // --- Summary ---
    const checks = failures.length;
    console.log(`\n${checks === 0 ? "🎉 ALL CHECKS PASSED" : `⚠️  ${checks} CHECK(S) FAILED`}`);
    for (const f of failures) console.log(`   - ${f}`);
    if (checks) {
      // exitCode, not exit(): process.exit() terminates immediately and would
      // skip the finally block, leaking the fixtures on exactly the runs that
      // are already going wrong.
      process.exitCode = 1;
    }

  } catch (err) {
    console.error("Test failed:", err);
    process.exitCode = 1;
  } finally {
    // Reported, never thrown: a cleanup failure must not replace the result the
    // run was actually here to produce.
    try {
      await cleanup();
    } catch (err) {
      console.error("cleanup failed — fixture rows may remain:", err.message);
    }
    await pool.end();
  }
}

runTests();
