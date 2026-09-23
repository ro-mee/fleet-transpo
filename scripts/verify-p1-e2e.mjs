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

    // --- Scenario B: Driver Corrects AI
    console.log("\\n--- Testing Scenario B: Driver Corrects AI ---");
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

    // --- Scenario C: Cross-Driver Duplicate ---
    console.log("\\n--- Testing Scenario C: Cross-Driver Duplicate ---");
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

    // --- Scenario D: Wrong Fuel Type ---
    console.log("\\n--- Testing Scenario D: Wrong Fuel Type ---");
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

    // --- Scenario E: Suspicious Price ---
    console.log("\\n--- Testing Scenario E: Suspicious Price ---");
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

    // --- Scenario F: Exact Duplicate (Same driver, same transaction ID) ---
    console.log("\\n--- Testing Scenario F: Exact Duplicate Retry ---");
    const resF1 = await submitFuel(token1, payloadE);
    console.log("Scenario F1 Response (Same client_submission_id):", resF1.status, resF1.data);
    
    const payloadF2 = { ...payloadE, client_submission_id: 'sub-price-002-test', receipt_transaction_id: 'receipt-12345' };
    const reqF2 = await openFuelRequest(driver1.driver_id, vehicleDiesel.vehicle_id, 10);
    payloadF2.fuel_request_id = reqF2;
    
    const resF2 = await submitFuel(token1, payloadF2);
    console.log("Scenario F2 Response (Submit first time with transaction ID):", resF2.status, resF2.data);
    
    const payloadF3 = { ...payloadF2, client_submission_id: 'sub-price-003-test' };
    const reqF3 = await openFuelRequest(driver2.driver_id, vehicleGas.vehicle_id, 10);
    payloadF3.fuel_request_id = reqF3;
    payloadF3.receipt_url = `${supabaseUrl}/storage/v1/object/sign/fuel-receipts/${driver2.driver_id}/receipt5.jpg?token=123`;
    
    const resF3 = await submitFuel(token2, payloadF3);
    console.log("Scenario F3 Response (Same transaction ID, cross driver):", resF3.status, resF3.data);

    // --- Verify DB Records ---
    console.log("\\n--- Verifying DB Records ---");
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

  } catch (err) {
    console.error("Test failed:", err);
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
