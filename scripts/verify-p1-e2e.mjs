import { loadEnvLocal } from './load-env.mjs';
loadEnvLocal();
import pg from 'pg';
import { signAccessToken } from '../src/lib/auth/mobile-token.js';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BASE_URL = 'http://localhost:3000';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';

async function runTests() {
  console.log("Starting Fuel Verification Tests...");

  try {
    // 1. Setup Test Data
    const { rows: driverRows } = await pool.query(`
      WITH new_emp AS (
        INSERT INTO employees (first_name, last_name, email) VALUES ('Test', 'Driver', 'testdriver1-' || EXTRACT(EPOCH FROM NOW()) || '@example.com') RETURNING employee_id
      )
      INSERT INTO drivers (employee_id, license_number, license_expiry)
      SELECT employee_id, 'DL-TEST-001', '2030-12-31' FROM new_emp
      RETURNING driver_id, employee_id
    `);
    const driver1 = driverRows[0];

    const { rows: driver2Rows } = await pool.query(`
      WITH new_emp AS (
        INSERT INTO employees (first_name, last_name, email) VALUES ('Test', 'Driver2', 'testdriver2-' || EXTRACT(EPOCH FROM NOW()) || '@example.com') RETURNING employee_id
      )
      INSERT INTO drivers (employee_id, license_number, license_expiry)
      SELECT employee_id, 'DL-TEST-002', '2030-12-31' FROM new_emp
      RETURNING driver_id, employee_id
    `);
    const driver2 = driver2Rows[0];

    const { rows: vehicleRows } = await pool.query(`
      INSERT INTO vehicles (plate_number, vehicle_name, fuel_type, tank_capacity_l, fuel_efficiency_kmpl, fuel_level, mileage)
      VALUES ('TST-' || CAST(CAST(EXTRACT(EPOCH FROM NOW()) AS INT) AS VARCHAR), 'Test Diesel Van', 'Diesel', 80, 10, 20, 10000),
             ('TSG-' || CAST(CAST(EXTRACT(EPOCH FROM NOW()) AS INT) AS VARCHAR), 'Test Gas Car', 'Gasoline', 50, 15, 30, 5000)
      RETURNING vehicle_id, plate_number, fuel_type
    `);
    const vehicleDiesel = vehicleRows[0];
    const vehicleGas = vehicleRows[1];

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
    const { rows: requestRows } = await pool.query(`
      INSERT INTO fuelrequests (driver_id, vehicle_id, status, requested_liters, recommended_liters, approved_liters, allocation_month)
      VALUES ($1, $2, 'Approved', 50, 50, 50, date_trunc('month', CURRENT_DATE)),
             ($3, $4, 'Approved', 50, 50, 50, date_trunc('month', CURRENT_DATE))
      RETURNING fuel_request_id
    `, [driver1.driver_id, vehicleDiesel.vehicle_id, driver2.driver_id, vehicleGas.vehicle_id]);
    const req1 = requestRows[0].fuel_request_id;
    const req2 = requestRows[1].fuel_request_id;

    const token1 = await signAccessToken({ employeeId: driver1.employee_id, role: 'driver', driverId: driver1.driver_id });
    const token2 = await signAccessToken({ employeeId: driver2.employee_id, role: 'driver', driverId: driver2.driver_id });

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
    const { rows: reqBRows } = await pool.query(`
      INSERT INTO fuelrequests (driver_id, vehicle_id, status, requested_liters, recommended_liters, approved_liters, allocation_month)
      VALUES ($1, $2, 'Approved', 50, 50, 50, date_trunc('month', CURRENT_DATE)) RETURNING fuel_request_id
    `, [driver1.driver_id, vehicleDiesel.vehicle_id]);
    
    const payloadB = {
      fuel_request_id: reqBRows[0].fuel_request_id,
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
    const { rows: reqDRows } = await pool.query(`
      INSERT INTO fuelrequests (driver_id, vehicle_id, status, requested_liters, recommended_liters, approved_liters, allocation_month)
      VALUES ($1, $2, 'Approved', 20, 20, 20, date_trunc('month', CURRENT_DATE)) RETURNING fuel_request_id
    `, [driver1.driver_id, vehicleDiesel.vehicle_id]);

    const payloadD = {
      fuel_request_id: reqDRows[0].fuel_request_id,
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
    const { rows: reqERows } = await pool.query(`
      INSERT INTO fuelrequests (driver_id, vehicle_id, status, requested_liters, recommended_liters, approved_liters, allocation_month)
      VALUES ($1, $2, 'Approved', 10, 10, 10, date_trunc('month', CURRENT_DATE)) RETURNING fuel_request_id
    `, [driver1.driver_id, vehicleDiesel.vehicle_id]);

    const payloadE = {
      fuel_request_id: reqERows[0].fuel_request_id,
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
    const { rows: reqFRows } = await pool.query(`
      INSERT INTO fuelrequests (driver_id, vehicle_id, status, requested_liters, recommended_liters, approved_liters, allocation_month)
      VALUES ($1, $2, 'Approved', 10, 10, 10, date_trunc('month', CURRENT_DATE)) RETURNING fuel_request_id
    `, [driver1.driver_id, vehicleDiesel.vehicle_id]);
    payloadF2.fuel_request_id = reqFRows[0].fuel_request_id;
    
    const resF2 = await submitFuel(token1, payloadF2);
    console.log("Scenario F2 Response (Submit first time with transaction ID):", resF2.status, resF2.data);
    
    const payloadF3 = { ...payloadF2, client_submission_id: 'sub-price-003-test' };
    const { rows: reqF3Rows } = await pool.query(`
      INSERT INTO fuelrequests (driver_id, vehicle_id, status, requested_liters, recommended_liters, approved_liters, allocation_month)
      VALUES ($1, $2, 'Approved', 10, 10, 10, date_trunc('month', CURRENT_DATE)) RETURNING fuel_request_id
    `, [driver2.driver_id, vehicleGas.vehicle_id]);
    payloadF3.fuel_request_id = reqF3Rows[0].fuel_request_id;
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
    await pool.end();
  }
}

runTests();
