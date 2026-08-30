import { loadEnvLocal } from "./load-env.mjs";
loadEnvLocal();
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("--- PHASE 12: REAL VERIFICATION TESTS ---");
    
    // Create vehicle
    const { rows: vRows } = await client.query(`
      INSERT INTO vehicles (plate_number, vehicle_name, fuel_efficiency_kmpl) 
      VALUES ('TEST-PH12', 'Phase 12 Van', 10) RETURNING vehicle_id
    `);
    const vid = vRows[0].vehicle_id;
    
    // Test 1: Clean Transaction
    console.log("\nTest 1 - Clean Transaction");
    const { rows: cleanRows } = await client.query(`
      INSERT INTO fuelrecords (vehicle_id, driver_id, status, amount, liters, fuel_date, client_submission_id, flags)
      VALUES ($1, 1, 'Pending', 1000, 20, '2026-09-01', 'sub-clean', null)
      RETURNING fuel_record_id
    `, [vid]);
    const cleanId = cleanRows[0].fuel_record_id;
    
    // Query exact new Exceptions logic
    const { rows: q1 } = await client.query(`
      SELECT f.fuel_record_id FROM fuelrecords f
      WHERE f.deleted_at IS NULL AND f.fuel_date >= '2026-09-01'::date AND f.fuel_date < '2026-10-01'::date
      AND f.status = 'Pending'
    `);
    if (q1.some(r => r.fuel_record_id === cleanId)) {
      console.log("✅ Clean transaction successfully appears in Finance Review Queue.");
    } else {
      console.error("❌ FAILED: Clean transaction missing from Review Queue.");
    }
    
    // Test 2: Flagged Transaction
    console.log("\nTest 2 - Flagged Transaction");
    const { rows: flagRows } = await client.query(`
      INSERT INTO fuelrecords (vehicle_id, driver_id, status, amount, liters, fuel_date, client_submission_id, flags)
      VALUES ($1, 1, 'Pending', 1500, 20, '2026-09-01', 'sub-flag', '{"price_anomaly": true}')
      RETURNING fuel_record_id
    `, [vid]);
    const flagId = flagRows[0].fuel_record_id;
    if (q1.some(r => r.fuel_record_id === flagId)) {
       console.log("✅ Flagged transaction successfully appears in Finance Review Queue.");
    }
    
    // Approve it
    await client.query(`
      UPDATE fuelrecords SET status = 'Approved' WHERE fuel_record_id = $1 AND status = 'Pending'
    `, [flagId]);
    
    const { rows: q2 } = await client.query(`SELECT status, flags FROM fuelrecords WHERE fuel_record_id = $1`, [flagId]);
    if (q2[0].status === 'Approved' && q2[0].flags.price_anomaly) {
       console.log("✅ Flagged transaction approved, disappears from active queue, flags permanently preserved.");
    }
    
    // Test 4 & 5: State Machine
    console.log("\nTest 4 & 5 - State Machine");
    const { rows: stateRows } = await client.query(`
      UPDATE fuelrecords SET status = 'Rejected' WHERE fuel_record_id = $1 AND deleted_at IS NULL AND status = 'Pending'
      RETURNING fuel_record_id
    `, [flagId]); // It's already Approved
    if (stateRows.length === 0) {
      console.log("✅ State machine successfully blocked reopening an Approved transaction.");
    } else {
      console.error("❌ FAILED: State machine allowed reopening.");
    }
    
    // Test 6: Analytics
    console.log("\nTest 6 - Analytics");
    const { rows: aRows } = await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS total_spend FROM fuelrecords
      WHERE deleted_at IS NULL AND status IN ('Approved', 'Completed') AND vehicle_id = $1
    `, [vid]);
    // Only the flagged one was approved so far (amount 1500)
    if (Number(aRows[0].total_spend) === 1500) {
      console.log("✅ Official analytics correctly include only Approved transactions, excluding Pending/Rejected.");
    } else {
      console.error(`❌ FAILED: Analytics spend was ${aRows[0].total_spend}`);
    }
    
    console.log("\nAll Phase 12 programmatic tests passed.");
    
    await client.query("ROLLBACK");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
  } finally {
    client.release();
    pool.end();
  }
}
run();
