import { loadEnvLocal } from './load-env.mjs';
loadEnvLocal();
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE_URL = 'http://localhost:3000';

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

    // --- 1. SETUP CONTROLLED TEST DATA ---
    console.log("Setting up controlled test data...");
    
    const { rows: driverRows } = await pool.query(`
      WITH new_emp AS (
        INSERT INTO employees (first_name, last_name, email) VALUES ('Analytics', 'Driver', 'analytics_driver_' || EXTRACT(EPOCH FROM NOW()) || '@example.com') RETURNING employee_id
      )
      INSERT INTO drivers (employee_id, license_number)
      SELECT employee_id, 'DL-ANA-' || EXTRACT(EPOCH FROM NOW()) FROM new_emp
      RETURNING driver_id
    `);
    const driverId = driverRows[0].driver_id;

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
    const res = await fetch(`${BASE_URL}/api/admin/analytics/fuel?month=${testMonth}`);
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
    const resPrev = await fetch(`${BASE_URL}/api/admin/analytics/fuel?month=${prevMonth}`);
    const dataPrev = await resPrev.json();

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
      process.exit(1);
    }

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    pool.end();
  }
}

runTests();
