const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8');
const dbUrlMatch = env.match(/DATABASE_URL=(.*)/);
const dbUrl = dbUrlMatch ? dbUrlMatch[1].trim() : process.env.DATABASE_URL;
process.env.DATABASE_URL = dbUrl;
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  try {
    console.log("Updating Jack's recent trip to Assigned...");
    const res = await pool.query(`
      UPDATE trips
      SET trip_status = 'Assigned'
      WHERE trip_id = 430 AND driver_id = 21
      RETURNING trip_id, trip_status;
    `);
    console.log("Updated:", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
run();
