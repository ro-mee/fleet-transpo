import { query } from "./src/lib/db.js";

async function run() {
  try {
    const { rows: drivers } = await query(`
      SELECT e.email, d.driver_id 
      FROM employees e 
      JOIN drivers d ON e.employee_id = d.employee_id 
      WHERE e.email = 'admin@gmail.com'
    `);
    
    console.log("Admin driver:", drivers[0]);

    if (drivers.length > 0) {
      const { rows: assignments } = await query(`
        SELECT * FROM driver_vehicle_assignments 
        WHERE driver_id = $1 AND assigned_until IS NULL
      `, [drivers[0].driver_id]);
      console.log("Assignments:", assignments);
      
      if (assignments.length > 0) {
        const { rows: vehicles } = await query(`
          SELECT vehicle_id, plate_number, image_url 
          FROM vehicles 
          WHERE vehicle_id = $1
        `, [assignments[0].vehicle_id]);
        console.log("Vehicle:", vehicles[0]);
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
