import { loadEnvLocal } from "./scripts/load-env.mjs";
loadEnvLocal();
import { query } from "./src/lib/db.js";

async function run() {
  try {
    const { rows: vehicles } = await query(`
      SELECT vehicle_id, plate_number, image_url 
      FROM vehicles 
      WHERE image_url IS NOT NULL
    `);
    console.log("Vehicles with images:", vehicles);
    
    const { rows: assignments } = await query(`
      SELECT * FROM driver_vehicle_assignments 
      WHERE assigned_until IS NULL
    `);
    console.log("Active assignments:", assignments);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
