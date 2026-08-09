const { Client } = require('pg');
const fs = require('fs');

async function run() {
  const envFile = fs.readFileSync('.env.local', 'utf8');
  let dbUrl = '';
  envFile.split('\n').forEach(line => {
    if (line.startsWith('DATABASE_URL=')) dbUrl = line.split('=')[1].trim();
  });

  const client = new Client({ connectionString: dbUrl });
  try {
    await client.connect();
    console.log("Connected to database. Cleaning up orphans...");

    // 1. Delete notifications referencing test employees
    await client.query(`
      DELETE FROM notifications 
      WHERE employee_id IN (SELECT employee_id FROM employees WHERE first_name = 'TEST' AND last_name = 'DRIVER')
    `);
    console.log("Cleared test notifications.");

    // 2. Delete test dispatches
    await client.query(`
      DELETE FROM dispatchschedules 
      WHERE dispatch_number LIKE 'TEST-DISP-%'
    `);
    console.log("Cleared test dispatch schedules.");

    // 3. Delete test reservations
    await client.query(`
      DELETE FROM vehiclereservations 
      WHERE pickup_location = 'TEST-LOCATION'
    `);
    console.log("Cleared test reservations.");

    // 4. Delete test drivers
    await client.query(`
      DELETE FROM drivers 
      WHERE employee_id IN (SELECT employee_id FROM employees WHERE first_name = 'TEST' AND last_name = 'DRIVER')
    `);
    console.log("Cleared test drivers.");

    // 5. Delete test employees
    await client.query(`
      DELETE FROM employees 
      WHERE first_name = 'TEST' AND last_name = 'DRIVER'
    `);
    console.log("Cleared test employees.");

    // 6. Delete test vehicles
    await client.query(`
      DELETE FROM vehicles 
      WHERE vehicle_name = 'TEST-VEHICLE'
    `);
    console.log("Cleared test vehicles.");

    // 7. Delete test vehicle categories
    await client.query(`
      DELETE FROM vehiclecategories 
      WHERE category_name = 'TEST-CAT'
    `);
    console.log("Cleared test vehicle categories.");

    console.log("\nALL TEST ORPHANS CLEANED UP SUCCESSFULLY!");

  } catch (err) {
    console.error("Cleanup failed with error:", err);
  } finally {
    await client.end();
  }
}
run();
