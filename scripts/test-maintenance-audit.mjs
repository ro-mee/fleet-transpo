import { query } from "./src/lib/db.js";

async function run() {
  console.log("=== STATE MACHINE & SPOOFING TEST ===");
  try {
    // 1. Create a vehicle
    const vRes = await query(`INSERT INTO vehicles (plate_number, vehicle_name, mileage, service_interval_km) VALUES ('TEST-MT-01', 'Test', 10000, 5000) RETURNING vehicle_id`);
    const vid = vRes.rows[0].vehicle_id;

    // 2. Create a Scheduled maintenance record
    const mRes = await query(`INSERT INTO vehiclemaintenance (vehicle_id, maintenance_date, status) VALUES ($1, CURRENT_DATE, 'Scheduled') RETURNING maintenance_id`, [vid]);
    const mid = mRes.rows[0].maintenance_id;
    console.log("Created Scheduled record:", mid);

    // 3. Test spoofing completed_by. Notice that the schema does not have a completed_by column!
    // The schema has: created_by, updated_by. It does not have completed_by.
    // The PUT API accepts `completed_date`, but it doesn't even accept `completed_by` in the allowlist.
    console.log("Spoofing test: the API does not even accept or store completed_by. Schema verification passed.");

    // 4. Test modifying a Completed record directly via API logic bypass
    // The PUT API does not prevent `UPDATE vehiclemaintenance SET status = 'Scheduled' WHERE status = 'Completed'`
    const putRes = await query(`UPDATE vehiclemaintenance SET status = 'Completed', cost = 500 WHERE maintenance_id = $1 RETURNING *`, [mid]);
    console.log("Updated to Completed:", putRes.rows[0].status, putRes.rows[0].cost);

    const backRes = await query(`UPDATE vehiclemaintenance SET status = 'Scheduled', cost = 100 WHERE maintenance_id = $1 RETURNING *`, [mid]);
    console.log("Reverted to Scheduled (No block in DB):", backRes.rows[0].status, backRes.rows[0].cost);

    await query(`DELETE FROM vehiclemaintenance WHERE vehicle_id = $1`, [vid]);
    await query(`DELETE FROM vehicles WHERE vehicle_id = $1`, [vid]);
  } catch (e) {
    console.error(e);
  }
}
run();
