const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envFile = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
let dbUrl = '';
for (const line of envFile.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) {
    dbUrl = line.replace('DATABASE_URL=', '').trim();
  }
}

const pool = new Pool({ connectionString: dbUrl });

async function check() {
  const res = await pool.query(`
    SELECT t.trip_id, t.trip_status, r.origin, r.destination,
           ol.latitude AS origin_lat, ol.longitude AS origin_lng,
           dl.latitude AS dest_lat, dl.longitude AS dest_lng
      FROM trips t
      LEFT JOIN routes r ON r.route_id = t.route_id
      LEFT JOIN locations ol ON ol.location_id = r.origin_location_id
      LEFT JOIN locations dl ON dl.location_id = r.destination_location_id
     ORDER BY t.trip_id DESC
     LIMIT 10
  `);
  console.log("DB Trips output:", JSON.stringify(res.rows, null, 2));

  const locs = await pool.query(`SELECT * FROM locations LIMIT 10`);
  console.log("Locations table sample:", JSON.stringify(locs.rows, null, 2));

  await pool.end();
}

check().catch(err => {
  console.error(err);
  pool.end();
});
