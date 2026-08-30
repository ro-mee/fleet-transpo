import { loadEnvLocal } from "./load-env.mjs";
loadEnvLocal();
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("--- PHASE 2: VERIFY CATEGORY A CLAIM ---");
    
    // Create vehicle
    const { rows: vRows } = await client.query(`
      INSERT INTO vehicles (plate_number, vehicle_name, fuel_efficiency_kmpl) 
      VALUES ('CLEAN-1', 'Test Van', 10) RETURNING vehicle_id
    `);
    const vid = vRows[0].vehicle_id;
    
    // 1. Insert a perfectly clean transaction
    const { rows: cleanRows } = await client.query(`
      INSERT INTO fuelrecords (vehicle_id, driver_id, status, amount, liters, fuel_date, client_submission_id, flags)
      VALUES ($1, 1, 'Pending', 1000, 20, '2026-09-01', 'sub-clean', '{}')
      RETURNING fuel_record_id
    `, [vid]);
    
    const cleanId = cleanRows[0].fuel_record_id;
    
    // Check if it appears in the Exceptions query (Active Review Queue)
    const { rows: q1 } = await client.query(`
      SELECT f.fuel_record_id
      FROM fuelrecords f
      WHERE f.deleted_at IS NULL
        AND f.fuel_date >= '2026-09-01'::date
        AND f.fuel_date < '2026-10-01'::date
        AND f.flags IS NOT NULL
        AND f.flags::text != '{}'::text
        AND f.status = 'Pending'
    `);
    
    const isCleanInQueue = q1.some(r => r.fuel_record_id === cleanId);
    console.log(`Clean transaction in Review Queue? ${isCleanInQueue}`);
    
    // Check if it appears in Analytics
    const { rows: q2 } = await client.query(`
      SELECT COALESCE(SUM(amount), 0) AS total_spend
      FROM fuelrecords
      WHERE deleted_at IS NULL
        AND status IN ('Approved', 'Completed')
        AND vehicle_id = $1
    `, [vid]);
    console.log(`Clean transaction (Pending) in Analytics? ${q2[0].total_spend > 0}`);
    
    if (!isCleanInQueue && q2[0].total_spend == 0) {
      console.log("✅ CATEGORY A CONFIRMED: Clean transaction is orphaned (invisible to both Queue and Analytics).");
    }
    
    // ---------------------------------------------------------
    // Phase 3: State-Machine (Closed Re-resolution)
    // ---------------------------------------------------------
    console.log("\n--- PHASE 3: STATE MACHINE VERIFICATION ---");
    // Insert an Approved transaction
    const { rows: appRows } = await client.query(`
      INSERT INTO fuelrecords (vehicle_id, driver_id, status, amount, liters, fuel_date, client_submission_id)
      VALUES ($1, 1, 'Approved', 1000, 20, '2026-09-01', 'sub-approved-1')
      RETURNING fuel_record_id
    `, [vid]);
    const approvedId = appRows[0].fuel_record_id;
    
    // Emulate /resolve API updating an already Approved record
    const { rows: resolveRows } = await client.query(`
      UPDATE fuelrecords
      SET status = 'Rejected', review_remarks = 'Malicious override'
      WHERE fuel_record_id = $1 AND deleted_at IS NULL
      RETURNING status
    `, [approvedId]);
    
    if (resolveRows.length > 0 && resolveRows[0].status === 'Rejected') {
      console.log("✅ CATEGORY B CONFIRMED: Approved transaction CAN be re-resolved to Rejected via API.");
    }
    
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
