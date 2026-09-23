import { loadEnvLocal } from './load-env.mjs';
loadEnvLocal();
import pg from 'pg';
import { signAccessToken, signRefreshToken, hashToken, REFRESH_TOKEN_TTL_SECONDS } from '../src/lib/auth/mobile-token.js';
import { rolesFor } from '../src/lib/auth/permissions.js';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Throwaway rows are tracked so the finally block can soft-delete them.
//
// This runs against the LIVE database, and it used to leave its own employee
// behind on EVERY run: the "CLEANUP ANY PREVIOUS TEST DATA" block below swept
// fuelrecords and trips but never the `analytics_driver_<epoch>@example.com`
// account it creates. Under mandatory email OTP that abandoned row is an
// account that can neither sign in (the login gate refuses reserved domains)
// nor be removed through the UI.
//
// Soft-delete, not DELETE, matching verify-cancel-cascade / verify-trip-status /
// verify-quickwins: `drivers.employee_id` carries no ON DELETE CASCADE, so a
// hard delete would need an ordered unwinding across most of the schema.
// ---------------------------------------------------------------------------
const createdEmployeeIds = [];
const createdDriverIds = [];
const createdVehicleIds = [];

async function cleanup() {
  const softDeletes = [
    ["fuelrecords", `driver_id = ANY($1::int[])`, createdDriverIds],
    ["trips", `driver_id = ANY($1::int[])`, createdDriverIds],
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
// Without this the script sends no credentials at all, so both fetches below
// came back 401 — which /api/admin/analytics/fuel used to report as a 500, so
// the harness spent its life failing on what looked like a server fault. The
// endpoint is `requirePermission(request, "reports", "read")`.
//
// signAccessToken alone is not enough: resolveCurrentIdentity re-reads
// `auth_version` and requires a live, unrevoked row in `mobile_refresh_tokens`
// for the token's familyId (src/lib/api/utils.js:151-175). This mirrors
// POST /api/mobile/auth/login (route.js:248-272), minus the password and OTP
// steps a reserved-domain fixture can never pass.
async function mintToken({ employee_id, role_name, auth_version }) {
  const { token: refreshToken, familyId } = await signRefreshToken({
    employeeId: employee_id,
    authVersion: auth_version,
  });
  const accessToken = await signAccessToken({
    employeeId: employee_id,
    role: role_name,
    driverId: null,
    authVersion: auth_version,
    familyId,
  });
  await pool.query(
    `INSERT INTO mobile_refresh_tokens
       (employee_id, token_hash, family_id, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::INTERVAL, $5, $6)`,
    [employee_id, hashToken(refreshToken), familyId, REFRESH_TOKEN_TTL_SECONDS, null, "verify-p2-analytics"]
  );
  return accessToken;
}

async function runTests() {
  console.log("Starting P2 Fuel Analytics Verification...");

  const testMonth = new Date().toISOString().substring(0, 7); // e.g., '2026-08'
  const prevMonthDate = new Date();
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  const prevMonth = prevMonthDate.toISOString().substring(0, 7);

  try {
    // --- 0. CLEANUP ANY PREVIOUS TEST DATA ---
    console.log("Cleaning previous test data...");
    await pool.query(`UPDATE fuelrecords SET deleted_at = NOW() WHERE client_submission_id LIKE 'sub-ana-%'`);
    await pool.query(`UPDATE trips SET deleted_at = NOW() WHERE distance IN (50, 200, 500) AND driver_id IN (SELECT driver_id FROM drivers WHERE license_number LIKE 'DL-ANA-%')`);
    // The two statements above never covered the employee and driver rows, which
    // is why every run leaked one more account. Sweep prior runs here so this
    // script is idempotent rather than accumulating; the finally block handles
    // the rows this run creates.
    await pool.query(`
      UPDATE drivers SET deleted_at = NOW()
       WHERE license_number LIKE 'DL-ANA-%' AND deleted_at IS NULL`);
    // Tokens first: they are keyed to the employee, and a prior run's row would
    // otherwise outlive the account it authenticates as a valid 30-day session.
    await pool.query(`
      DELETE FROM mobile_refresh_tokens
       WHERE employee_id IN (SELECT employee_id FROM employees
                              WHERE email LIKE 'analytics_driver_%@example.com')`);
    await pool.query(`
      UPDATE employees SET deleted_at = NOW()
       WHERE email LIKE 'analytics_driver_%@example.com' AND deleted_at IS NULL`);

    // --- 1. SETUP CONTROLLED TEST DATA ---
    console.log("Setting up controlled test data...");

    // The fixture needs a role that may read reports, and that role has to come
    // from the same matrix the route enforces — hard-coding "admin" would drift
    // the day the grant moves. super_admin is filtered out deliberately: it is an
    // explicit bypass in rolesFor (permissions.js:343), so a fixture holding it
    // would pass even if every real role had lost the grant.
    const reportRoles = rolesFor("reports", "read").filter((r) => r !== "super_admin");
    const { rows: roleRows } = await pool.query(
      `SELECT role_id, role_name FROM roles WHERE role_name = ANY($1::text[])`,
      [reportRoles]
    );
    const reportRole = reportRoles
      .map((name) => roleRows.find((r) => r.role_name === name))
      .find(Boolean);
    if (!reportRole) {
      throw new Error(
        `No role in \`roles\` satisfies reports:read (${reportRoles.join(", ") || "none"}) — cannot build an authenticating fixture.`
      );
    }
    console.log(`Fixture role: ${reportRole.role_name}.`);

    const { rows: driverRows } = await pool.query(`
      WITH new_emp AS (
        INSERT INTO employees (first_name, last_name, email, role_id) VALUES ('Analytics', 'Driver', 'analytics_driver_' || EXTRACT(EPOCH FROM NOW()) || '@example.com', $1) RETURNING employee_id, auth_version, role_id
      ),
      new_driver AS (
        INSERT INTO drivers (employee_id, license_number)
        SELECT employee_id, 'DL-ANA-' || EXTRACT(EPOCH FROM NOW()) FROM new_emp
        RETURNING driver_id, employee_id
      )
      SELECT d.driver_id, d.employee_id, e.auth_version,
             (SELECT role_name FROM roles WHERE role_id = e.role_id) AS role_name
        FROM new_driver d JOIN new_emp e ON e.employee_id = d.employee_id
    `, [reportRole.role_id]);
    const driverId = driverRows[0].driver_id;
    createdDriverIds.push(driverId);
    createdEmployeeIds.push(driverRows[0].employee_id);
    const token = await mintToken(driverRows[0]);
    const authHeader = { Authorization: `Bearer ${token}` };

    // Vehicle A: Baseline 8 km/L
    const { rows: vehARows } = await pool.query(`
      INSERT INTO vehicles (plate_number, vehicle_name, fuel_efficiency_kmpl, tank_capacity_l)
      VALUES ('ANA-A-' || CAST(CAST(EXTRACT(EPOCH FROM NOW()) AS INT) AS VARCHAR), 'Vehicle A', 8, 50)
      RETURNING vehicle_id
    `);
    const vehicleA = vehARows[0].vehicle_id;

    // Vehicle B: Baseline 10 km/L
    const { rows: vehBRows } = await pool.query(`
      INSERT INTO vehicles (plate_number, vehicle_name, fuel_efficiency_kmpl, tank_capacity_l)
      VALUES ('ANA-B-' || CAST(CAST(EXTRACT(EPOCH FROM NOW()) AS INT) AS VARCHAR), 'Vehicle B', 10, 60)
      RETURNING vehicle_id
    `);
    const vehicleB = vehBRows[0].vehicle_id;
    createdVehicleIds.push(vehicleA, vehicleB);

    // Insert trips for Vehicle A (Current Month): Trip 1 (50km), Trip 2 (50km)
    await pool.query(`
      INSERT INTO trips (vehicle_id, driver_id, distance, trip_status, start_time, end_time)
      VALUES 
        ($1, $2, 50, 'Completed', NOW(), NOW()),
        ($1, $2, 50, 'Completed', NOW(), NOW())
    `, [vehicleA, driverId]);

    // Insert trip for Vehicle B (Current Month): 200km
    await pool.query(`
      INSERT INTO trips (vehicle_id, driver_id, distance, trip_status, start_time, end_time)
      VALUES ($1, $2, 200, 'Completed', NOW(), NOW())
    `, [vehicleB, driverId]);

    // Insert trip for Vehicle A (Previous Month): 500km
    await pool.query(`
      INSERT INTO trips (vehicle_id, driver_id, distance, trip_status, start_time, end_time)
      VALUES ($1, $2, 500, 'Completed', NOW() - INTERVAL '1 month', NOW() - INTERVAL '1 month')
    `, [vehicleA, driverId]);

    // Insert Fuel Purchases for Vehicle A (Current Month): 40L, 2600
    await pool.query(`
      INSERT INTO fuelrecords (vehicle_id, driver_id, liters, amount, status, fuel_date, client_submission_id)
      VALUES ($1, $2, 40, 2600, 'Approved', CURRENT_DATE, 'sub-ana-a-current')
    `, [vehicleA, driverId]);

    // Insert Fuel Purchases for Vehicle B (Current Month): 50L, 3000
    await pool.query(`
      INSERT INTO fuelrecords (vehicle_id, driver_id, liters, amount, status, fuel_date, client_submission_id)
      VALUES ($1, $2, 50, 3000, 'Approved', CURRENT_DATE, 'sub-ana-b-current')
    `, [vehicleB, driverId]);

    // Insert Fuel Purchases for Vehicle A (Previous Month): 60L, 3500
    await pool.query(`
      INSERT INTO fuelrecords (vehicle_id, driver_id, liters, amount, status, fuel_date, client_submission_id)
      VALUES ($1, $2, 60, 3500, 'Approved', CURRENT_DATE - INTERVAL '1 month', 'sub-ana-a-prev')
    `, [vehicleA, driverId]);

    // Insert PENDING Fuel Purchase for Vehicle A (Current Month): 10L, 600 (Should be EXCLUDED from totals)
    await pool.query(`
      INSERT INTO fuelrecords (vehicle_id, driver_id, liters, amount, status, fuel_date, client_submission_id)
      VALUES ($1, $2, 10, 600, 'Pending', CURRENT_DATE, 'sub-ana-a-pending')
    `, [vehicleA, driverId]);

    console.log("Test data inserted successfully.");

    // --- 2. FETCH ANALYTICS (Current Month) ---
    console.log(`\nFetching Analytics for Current Month (${testMonth})...`);
    const res = await fetch(`${BASE_URL}/api/admin/analytics/fuel?month=${testMonth}`, {
      headers: authHeader,
    });
    const data = await res.json();
    
    if (res.status !== 200) {
      throw new Error(`API returned ${res.status}: ${JSON.stringify(data)}`);
    }

    // --- 3. ASSERTIONS ---
    console.log("\nValidating Overview Metrics...");
    // Expected spend: 2600 (Veh A) + 3000 (Veh B) = 5600. Pending 600 excluded. Prev month 3500 excluded.
    let passed = true;
    if (data.overview.total_spend === 5600) {
      console.log("✅ Monthly Fuel Spend is correct (5600)");
    } else {
      console.log(`❌ Monthly Fuel Spend is WRONG. Expected 5600, got ${data.overview.total_spend}`);
      passed = false;
    }

    if (data.overview.total_liters === 90) { // 40 + 50
      console.log("✅ Monthly Liters is correct (90)");
    } else {
      console.log(`❌ Monthly Liters is WRONG. Expected 90, got ${data.overview.total_liters}`);
      passed = false;
    }

    console.log("\nValidating Vehicle Metrics...");
    const statA = data.vehicles.find(v => v.vehicle_id === vehicleA);
    const statB = data.vehicles.find(v => v.vehicle_id === vehicleB);

    if (statA && statA.estimated_kmpl === 2.5) {
      console.log("✅ Vehicle A Estimated Efficiency is correct (2.5 km/L)"); // 100km / 40L
    } else {
      console.log(`❌ Vehicle A Estimated Efficiency is WRONG. Expected 2.5, got ${statA?.estimated_kmpl}`);
      passed = false;
    }

    if (statB && statB.estimated_kmpl === 4.0) {
      console.log("✅ Vehicle B Estimated Efficiency is correct (4.0 km/L)"); // 200km / 50L
    } else {
      console.log(`❌ Vehicle B Estimated Efficiency is WRONG. Expected 4.0, got ${statB?.estimated_kmpl}`);
      passed = false;
    }

    // --- 4. FETCH ANALYTICS (Previous Month) ---
    console.log(`\nFetching Analytics for Previous Month (${prevMonth})...`);
    const resPrev = await fetch(`${BASE_URL}/api/admin/analytics/fuel?month=${prevMonth}`, {
      headers: authHeader,
    });
    const dataPrev = await resPrev.json();

    // The first fetch checked its status; this one did not, so an auth failure or
    // a 500 here would have surfaced as "Previous Month Fuel Spend is WRONG.
    // Expected 3500, got undefined" — a data problem that was not one. Fail on
    // the transport instead of letting it masquerade as an assertion failure.
    if (resPrev.status !== 200) {
      throw new Error(`API returned ${resPrev.status} for ${prevMonth}: ${JSON.stringify(dataPrev)}`);
    }

    if (dataPrev.overview.total_spend === 3500) {
      console.log("✅ Previous Month Fuel Spend is correct (3500)");
    } else {
      console.log(`❌ Previous Month Fuel Spend is WRONG. Expected 3500, got ${dataPrev.overview.total_spend}`);
      passed = false;
    }

    if (passed) {
      console.log("\n🎉 ALL TESTS PASSED! Analytics API logic is verified.");
    } else {
      console.log("\n⚠️ SOME TESTS FAILED.");
      // exitCode, not exit(): process.exit() terminates immediately and would
      // skip the finally block, leaking the fixtures on exactly the runs that
      // are already going wrong.
      process.exitCode = 1;
    }

  } catch (err) {
    console.error("Test execution failed:", err);
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
